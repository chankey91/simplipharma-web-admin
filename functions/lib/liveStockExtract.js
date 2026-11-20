"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeStockRows = mergeStockRows;
exports.extractStockFromFile = extractStockFromFile;
/**
 * Turn a vendor stock file (CSV, Excel, or PDF) into stock rows.
 * Gemini normalizes messy layouts. Column mapping is the fallback.
 */
const purchaseInvoiceExtract_1 = require("./purchaseInvoiceExtract");
const liveStockRank_1 = require("./liveStockRank");
const STOCK_PROMPT = `You extract live stock rows from an Indian pharmacy distributor stock list (Excel, CSV, or PDF).

Return ONLY valid JSON (no markdown fences):
{
  "rows": [
    {
      "productName": string,
      "pack": string|null,
      "manufacturer": string|null,
      "stockQty": number|null,
      "rate": number|null,
      "mrp": number|null,
      "scheme": string|null,
      "discountPercentage": number|null,
      "expiry": string|null
    }
  ]
}

Rules:
- One object per product that is actually listed. Do not invent products.
- productName is the medicine name only. Do not append pack, batch, or prices.
- stockQty is quantity on hand. Use 0 when the row is explicitly out of stock. Skip blank spacer rows and totals.
- rate is PTR / net rate / sale rate (the price we pay per unit), NOT MRP and NOT the line amount.
- mrp is printed MRP when present.
- scheme is the printed deal such as "10+1" or "5%". Use null when no deal is printed.
- discountPercentage is a percent number (5 means 5%) only when a discount column is shown. Do not copy it into scheme.
- pack is packing such as "10 TAB" or "15 ML".
- Ignore page headers, GST summaries, and grand totals.`;
const CHUNK_ROWS = 40;
const MAX_CHUNKS = 12;
const MAX_TABLE_LINES = 40000;
function mergeStockRows(current, extra) {
    return dedupeRows([...current, ...extra]);
}
async function extractStockFromFile(buffer, contentType, fileName, options) {
    const kind = fileKind(contentType, fileName);
    if (kind === 'pdf')
        return extractPdf(buffer, options);
    const table = kind === 'sheet' ? workbookToTable(buffer) : buffer.toString('utf8');
    return extractTable(table, options);
}
async function extractPdf(buffer, options) {
    const text = await (0, purchaseInvoiceExtract_1.extractTextFromPdf)(buffer);
    const catalog = parseItemCatalog(text);
    if (catalog.length >= 5) {
        return {
            rows: catalog,
            engine: 'columns',
            message: `Loaded ${catalog.length} products. This file lists items and packs under each manufacturer, and it has no stock quantity.`,
        };
    }
    const spaced = parseSpacedStockLines(text);
    if (spaced.length >= 5) {
        const hasRate = spaced.some((row) => row.rate != null);
        const base = hasRate
            ? `Loaded ${spaced.length} rows from the stock list.`
            : `Loaded ${spaced.length} rows. This list has quantity but no rate, so deals show who has stock, not a price.`;
        return {
            rows: spaced,
            engine: 'columns',
            message: sectionMessage(spaced, base),
        };
    }
    if (text.trim().length >= 40)
        return extractTable(text, options);
    try {
        const { text: raw, model } = await (0, purchaseInvoiceExtract_1.askGeminiPdf)(STOCK_PROMPT, buffer);
        const rows = normalizeRows(parseRowsJson(raw));
        return {
            rows,
            engine: 'gemini',
            model,
            message: rows.length
                ? 'Read the scanned stock PDF with Gemini.'
                : 'Gemini found no stock rows in the PDF.',
        };
    }
    catch (error) {
        return {
            rows: [],
            engine: 'none',
            message: `Could not read this PDF (${String((error === null || error === void 0 ? void 0 : error.message) || error).slice(0, 180)}).`,
        };
    }
}
async function extractTable(table, options) {
    const paddedLines = table
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+$/, ''))
        .filter((line) => line.trim().length > 0)
        .slice(0, MAX_TABLE_LINES);
    const lines = paddedLines.map((line) => line.trim());
    if (lines.length < 2) {
        return { rows: [], engine: 'none', message: 'The file has no stock rows.' };
    }
    if (!(options === null || options === void 0 ? void 0 : options.geminiOnly)) {
        const priced = parseTwoColumnPriceList(paddedLines.join('\n'));
        if (priced.length >= 5 && priced.some((row) => row.rate != null)) {
            return {
                rows: priced,
                engine: 'columns',
                message: `Loaded ${priced.length} products from a two-column price list. Rates are saved. This file has no stock quantity, so purchase ranking can use the price only.`,
            };
        }
    }
    const headerIndex = detectHeaderIndex(lines);
    const header = lines[headerIndex];
    const mapped = headerFields(header);
    const body = lines.slice(headerIndex + 1);
    // A recognised product column is more reliable than asking Gemini to redraw the sheet.
    // Gemini is reserved for files whose header row cannot be mapped.
    if (!(options === null || options === void 0 ? void 0 : options.geminiOnly) && mapped.has('productName')) {
        const rows = columnRows(header, body);
        if (rows.length > 0) {
            const missing = !mapped.has('stockQty') && !mapped.has('rate');
            const namedDiscount = rows.some((row) => row.discountPercentage != null);
            return {
                rows,
                engine: 'columns',
                message: missing
                    ? namedDiscount
                        ? `Loaded ${rows.length} products. The discount printed in the name was saved. This file has no purchase rate or stock quantity.`
                        : mapped.has('mrp')
                            ? `Loaded ${rows.length} products with MRP. This file has no purchase rate or stock quantity.`
                            : `Loaded ${rows.length} product names. This file has no stock or rate column, so these rows cannot be ranked on the purchase list.`
                    : `Loaded ${rows.length} rows from the column headers.`,
            };
        }
    }
    // Company name on its own row (often bold), then the products under it.
    const sectioned = !(options === null || options === void 0 ? void 0 : options.geminiOnly) ? parseSpacedStockLines(lines.join('\n')) : [];
    if (sectioned.length >= 5) {
        return {
            rows: sectioned,
            engine: 'columns',
            message: sectionMessage(sectioned, `Loaded ${sectioned.length} rows from the stock list.`),
        };
    }
    const chunkOffset = Math.max(0, (options === null || options === void 0 ? void 0 : options.geminiOffset) || 0);
    const chunkLimit = Math.max(1, (options === null || options === void 0 ? void 0 : options.geminiChunkLimit) || MAX_CHUNKS);
    const startLine = chunkOffset * CHUNK_ROWS;
    const window = body.slice(startLine, startLine + chunkLimit * CHUNK_ROWS);
    const chunks = [];
    for (let i = 0; i < window.length; i += CHUNK_ROWS)
        chunks.push(window.slice(i, i + CHUNK_ROWS));
    const geminiRows = [];
    let model = '';
    let geminiError = '';
    let processed = 0;
    for (const chunk of chunks) {
        if ((options === null || options === void 0 ? void 0 : options.geminiDeadlineMs) && Date.now() > options.geminiDeadlineMs)
            break;
        try {
            const prompt = `${STOCK_PROMPT}\n\n--- STOCK FILE ---\n${header}\n${chunk.join('\n')}`;
            const result = await (0, purchaseInvoiceExtract_1.askGeminiText)(prompt);
            model = result.model;
            geminiRows.push(...normalizeRows(parseRowsJson(result.text)));
            processed += 1;
        }
        catch (error) {
            geminiError = String((error === null || error === void 0 ? void 0 : error.message) || error);
            break;
        }
    }
    const consumedLines = startLine + processed * CHUNK_ROWS;
    const remaining = Math.max(0, body.length - consumedLines);
    if (processed > 0 && remaining > 0 && !geminiError) {
        return {
            rows: dedupeRows(geminiRows),
            engine: 'gemini',
            model,
            geminiContinue: { offset: chunkOffset + processed },
            message: `Read ${consumedLines} of ${body.length} lines. The rest continues in the next batch.`,
        };
    }
    if (geminiRows.length > 0) {
        const extra = remaining > 0 ? columnRows(header, body.slice(consumedLines)) : [];
        return {
            rows: dedupeRows([...geminiRows, ...extra]),
            engine: 'gemini',
            model,
            message: remaining > 0
                ? `Gemini read ${consumedLines} lines. The rest were read from the columns.`
                : `Gemini read ${consumedLines} lines.`,
        };
    }
    const fallback = columnRows(header, body);
    if (fallback.length > 0) {
        return {
            rows: fallback,
            engine: 'columns',
            message: geminiError
                ? `Gemini was unavailable (${geminiError.slice(0, 140)}). Rows were read from the column headers.`
                : 'Rows were read from the column headers.',
        };
    }
    return {
        rows: [],
        engine: 'none',
        message: geminiError
            ? `Could not read stock rows (${geminiError.slice(0, 160)}).`
            : 'Could not find product, stock, and rate columns.',
    };
}
function fileKind(contentType, fileName) {
    const name = fileName.toLowerCase();
    const type = contentType.toLowerCase();
    if (type.includes('pdf') || name.endsWith('.pdf'))
        return 'pdf';
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || type.includes('spreadsheet') || type.includes('excel')) {
        return 'sheet';
    }
    return 'csv';
}
function workbookToTable(buffer) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx');
    const book = XLSX.read(buffer, { type: 'buffer' });
    const parts = [];
    for (const name of book.SheetNames.slice(0, 3)) {
        const sheet = book.Sheets[name];
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        for (const row of grid) {
            if (!Array.isArray(row) || !row.some((cell) => String(cell || '').trim()))
                continue;
            parts.push(row.map((cell) => String(cell !== null && cell !== void 0 ? cell : '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t'));
        }
    }
    return parts.join('\n');
}
function headerFields(headerLine) {
    const header = splitCells(headerLine);
    const index = new Map();
    header.forEach((cell, i) => {
        for (const field of HEADER_FIELDS) {
            if (index.has(field.field))
                continue;
            if (field.field === 'rate' && /\bmrp\b/i.test(cell))
                continue;
            if (field.pattern.test(cell))
                index.set(field.field, i);
        }
    });
    return index;
}
function detectHeaderIndex(lines) {
    let best = 0;
    let score = -1;
    for (let i = 0; i < Math.min(lines.length, 25); i += 1) {
        const fields = headerFields(lines[i]);
        // Title rows such as an address full of commas must not beat Company / Product Name.
        let next = fields.size * 10;
        if (fields.has('productName'))
            next += 50;
        if (fields.has('stockQty') || fields.has('rate'))
            next += 20;
        if (next === 0) {
            const named = splitCells(lines[i]).filter((cell) => /[a-z]/i.test(cell)).length;
            next = named;
        }
        if (next > score) {
            score = next;
            best = i;
        }
    }
    return best;
}
function splitCells(line) {
    if (line.includes('\t'))
        return line.split('\t').map((cell) => cell.trim());
    if (line.includes(','))
        return splitCsv(line);
    return line.split(/\s{2,}/).map((cell) => cell.trim());
}
function splitCsv(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            quoted = !quoted;
            continue;
        }
        if (ch === ',' && !quoted) {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    cells.push(current.trim());
    return cells;
}
const HEADER_FIELDS = [
    { field: 'productName', pattern: /product|medicine|item name|description|particular|^name$|^item$|name\s*to\s*display|nametodisplay/i },
    { field: 'stockQty', pattern: /stock|qty|quantity|balance|closing|available|qoh/i },
    { field: 'rate', pattern: /ptr|rate|price|net/i },
    { field: 'mrp', pattern: /\bmrp\b/i },
    { field: 'scheme', pattern: /scheme|deal|offer/i },
    { field: 'discount', pattern: /disc|discount|cd\b/i },
    { field: 'pack', pattern: /pack/i },
    { field: 'manufacturer', pattern: /mfr|company|mfg|manufacturer/i },
    { field: 'expiry', pattern: /exp/i },
];
function columnRows(headerLine, body) {
    const index = headerFields(headerLine);
    if (!index.has('productName'))
        return [];
    const rows = [];
    for (const line of body) {
        const cells = splitCells(line);
        const productName = cells[index.get('productName')] || '';
        if (productName.length < 3 || /^total\b/i.test(productName))
            continue;
        const raw = { productName };
        for (const [field, at] of index)
            raw[field] = cells[at] || '';
        const parsed = normalizeRows([raw]);
        rows.push(...parsed);
    }
    return dedupeRows(rows);
}
function parseRowsJson(text) {
    let cleaned = text.trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence)
        cleaned = fence[1].trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start)
        cleaned = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.rows))
        return [];
    return parsed.rows.filter((row) => row && typeof row === 'object');
}
function normalizeRows(rawRows) {
    var _a, _b, _c;
    const out = [];
    for (const raw of rawRows) {
        const named = splitEmbeddedPack(textOf(raw.productName));
        const discounted = peelPrintedDiscount(named.productName);
        const productName = discounted.productName;
        if (!productName || productName.length < 3)
            continue;
        const schemeText = textOf(raw.scheme);
        const parsedScheme = parseScheme(schemeText);
        const discount = (_b = (_a = numberOf(raw.discountPercentage)) !== null && _a !== void 0 ? _a : parsedScheme.discountPercentage) !== null && _b !== void 0 ? _b : discounted.discountPercentage;
        const rate = numberOf(raw.rate);
        const stockQty = Math.max(0, (_c = numberOf(raw.stockQty)) !== null && _c !== void 0 ? _c : 0);
        const row = { productName, stockQty };
        const pack = textOf(raw.pack) || named.pack;
        const manufacturer = textOf(raw.manufacturer);
        const expiry = textOf(raw.expiry);
        const mrp = numberOf(raw.mrp);
        if (pack)
            row.pack = pack;
        if (manufacturer)
            row.manufacturer = manufacturer;
        if (expiry)
            row.expiry = expiry;
        if (rate != null)
            row.rate = rate;
        if (mrp != null)
            row.mrp = mrp;
        if (schemeText)
            row.scheme = schemeText;
        if (parsedScheme.schemePaidQty)
            row.schemePaidQty = parsedScheme.schemePaidQty;
        if (parsedScheme.schemeFreeQty)
            row.schemeFreeQty = parsedScheme.schemeFreeQty;
        if (discount != null && discount > 0)
            row.discountPercentage = discount;
        const effective = (0, liveStockRank_1.effectivePurchaseRate)(rate, row.schemePaidQty, row.schemeFreeQty, row.discountPercentage);
        if (effective != null)
            row.effectiveRate = effective;
        out.push(row);
    }
    return out;
}
function dedupeRows(rows) {
    var _a, _b;
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        const key = `${(row.manufacturer || '').toLowerCase()}|${row.productName.toLowerCase()}|${row.pack || ''}|${(_a = row.rate) !== null && _a !== void 0 ? _a : ''}|${(_b = row.mrp) !== null && _b !== void 0 ? _b : ''}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(row);
    }
    return out;
}
function sectionMessage(rows, base) {
    const companies = new Set(rows.map((row) => row.manufacturer).filter(Boolean));
    if (!companies.size)
        return base;
    return `${base} Manufacturer names were taken from the section headings.`;
}
function parseScheme(raw) {
    if (!raw)
        return {};
    const plus = raw.match(/(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)/);
    if (plus)
        return { schemePaidQty: Number(plus[1]), schemeFreeQty: Number(plus[2]) };
    const pct = raw.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct)
        return { discountPercentage: Number(pct[1]) };
    return {};
}
const SPACED_STOCK_LINE = /^(\d+)\s+(.*)\s+(-?\d+)\s+([A-Za-z][A-Za-z0-9]{1,10})$/;
/**
 * Marg-style printed price list: each Excel/PDF line is two fixed columns,
 * and each column is name, pack, then a rate. Company names sit in a column
 * until the next company in that same reading order (down the left column of
 * a page, then down the right).
 */
function parseTwoColumnPriceList(text) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+$/, ''))
        .filter((line) => line.trim().length > 0);
    const split = detectPriceColumnSplit(lines);
    if (!split)
        return [];
    const pages = [[]];
    for (const line of lines) {
        if (/^\s*price list\b/i.test(line)) {
            pages.push([]);
            continue;
        }
        pages[pages.length - 1].push(line);
    }
    let manufacturer = '';
    const rows = [];
    for (const page of pages) {
        const left = [];
        const right = [];
        for (const line of page) {
            if (line.length >= split - 2) {
                left.push(line.slice(0, split));
                right.push(line.slice(split));
            }
            else {
                left.push(line);
            }
        }
        for (const cell of [...left, ...right]) {
            const parsed = classifyPriceCell(cell);
            if (parsed.kind === 'company') {
                manufacturer = parsed.name;
                continue;
            }
            if (parsed.kind !== 'product')
                continue;
            const raw = {
                productName: parsed.name,
                stockQty: '0',
                rate: String(parsed.rate),
            };
            if (parsed.pack)
                raw.pack = parsed.pack;
            if (manufacturer)
                raw.manufacturer = manufacturer;
            rows.push(...normalizeRows([raw]));
        }
    }
    return rows.length >= 5 ? dedupeRows(rows) : [];
}
function detectPriceColumnSplit(lines) {
    const votes = new Map();
    for (const line of lines) {
        if (line.length < 110)
            continue;
        const from = Math.floor(line.length * 0.45);
        const to = Math.floor(line.length * 0.62);
        const region = line.slice(from, to);
        const gapPattern = / {3,}/g;
        let best = null;
        let gap;
        while ((gap = gapPattern.exec(region))) {
            if (gap.index == null)
                continue;
            if (!best || gap[0].length > best.len)
                best = { at: from + gap.index + gap[0].length, len: gap[0].length };
        }
        if (!best)
            continue;
        votes.set(best.at, (votes.get(best.at) || 0) + 1);
    }
    let split = 0;
    let count = 0;
    for (const [at, votesAt] of votes) {
        if (votesAt > count) {
            count = votesAt;
            split = at;
        }
    }
    return split >= 40 && count >= 20 ? split : 0;
}
function classifyPriceCell(raw) {
    var _a;
    const trimmed = raw.trim();
    if (!trimmed)
        return { kind: 'skip' };
    if (/^price list$/i.test(trimmed) || /^page\b/i.test(trimmed) || /^no\.\./i.test(trimmed) || /^continued/i.test(trimmed)) {
        return { kind: 'skip' };
    }
    if (/^-{6,}$/.test(trimmed.replace(/\s/g, '')))
        return { kind: 'skip' };
    if (/phone|gstin|e-?mail|branch office|head office|\bpin\b|medicine chamber/i.test(trimmed))
        return { kind: 'skip' };
    const price = trimmed.match(/(\d{1,7}(?:,\d{3})*\.\d{2})\s*$/);
    if (price) {
        const rate = Number(price[1].replace(/,/g, ''));
        const rest = trimmed.slice(0, (_a = price.index) !== null && _a !== void 0 ? _a : trimmed.length).replace(/\s+$/, '');
        const parts = rest.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
        let name = rest.trim();
        let pack = '';
        if (parts.length >= 2) {
            pack = parts[parts.length - 1];
            name = parts.slice(0, -1).join(' ');
        }
        if (name.length < 2 || /^rate$/i.test(name) || !Number.isFinite(rate))
            return { kind: 'skip' };
        return { kind: 'product', name, pack, rate };
    }
    const company = trimmed
        .replace(/\bRATE\b/gi, '')
        .replace(/-{3,}/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.\d{1,3}$/, '')
        .trim();
    if (company &&
        company.length >= 2 &&
        company.length <= 60 &&
        /[A-Za-z]/.test(company) &&
        !/\d+\.\d{2}/.test(company) &&
        !/\d{5,}/.test(company)) {
        return { kind: 'company', name: company };
    }
    return { kind: 'skip' };
}
const CATALOG_COMPANY = /^[A-Za-z][A-Za-z0-9 .&/'()-]*$/;
const CATALOG_PACK = /^(.*\S)\s+(\d+(?:\.\d+)?\s*(?:mml|ml|mg|gm|gms|g|kg)|\d+\s*[*x]\s*\d+|\d+\s*tabs?)$/i;
/** Eyehouse-style item list: "SNo. ITEM CODE ITEM DESCRIPTION", company name, then "1 CUBRIM-T 5ML". */
function parseItemCatalog(text) {
    if (!/item description/i.test(text) || !/s\s*no/i.test(text))
        return [];
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const rows = [];
    let manufacturer = '';
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (isCatalogNoise(line))
            continue;
        const company = catalogCompany(line);
        if (company) {
            manufacturer = company;
            continue;
        }
        const numbered = line.match(/^(\d+)\s+(.+)$/);
        if (!numbered)
            continue;
        const body = numbered[2].replace(/\s+/g, ' ').trim();
        if (isNumberedCompany(body, lines, i)) {
            manufacturer = body;
            continue;
        }
        const named = splitCatalogPack(body);
        if (named.productName.length < 2)
            continue;
        const raw = { productName: named.productName, stockQty: '0' };
        if (named.pack)
            raw.pack = named.pack;
        if (manufacturer)
            raw.manufacturer = manufacturer;
        rows.push(...normalizeRows([raw]));
    }
    return dedupeRows(rows);
}
function isCatalogNoise(line) {
    if (/^-{3,}$/.test(line))
        return true;
    if (/^continued\b/i.test(line))
        return true;
    if (/^list of items\b/i.test(line))
        return true;
    if (/^s\s*no\b/i.test(line))
        return true;
    if (/^page\b/i.test(line))
        return true;
    if (/\bphone\b/i.test(line))
        return true;
    if (/\bgstin\b/i.test(line))
        return true;
    if (/e-?mail/i.test(line))
        return true;
    if (/^eye house pharma$/i.test(line))
        return true;
    return /[,\d]/.test(line) && /,/.test(line) && !/^\d+\s+\S/.test(line);
}
function catalogCompany(line) {
    if (isCatalogNoise(line) || /^\d+\s+/.test(line))
        return null;
    const name = line.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60)
        return null;
    if (!CATALOG_COMPANY.test(name))
        return null;
    if (name.split(' ').length > 8)
        return null;
    return name;
}
function isNumberedCompany(body, lines, index) {
    if (/\d/.test(body) || splitCatalogPack(body).pack)
        return false;
    for (let j = index + 1; j < lines.length && j < index + 8; j += 1) {
        if (isCatalogNoise(lines[j]))
            continue;
        return /^1\s+\S/.test(lines[j]);
    }
    return false;
}
function splitCatalogPack(description) {
    let name = description.replace(/\s+/g, ' ').trim();
    const packs = [];
    for (let n = 0; n < 3; n += 1) {
        const match = name.match(CATALOG_PACK);
        if (!match || match[1].trim().length < 2)
            break;
        packs.unshift(match[2].replace(/\s+/g, '').toUpperCase());
        name = match[1].trim();
    }
    return { productName: name, pack: packs.join(' ') };
}
const HEADING_NOISE = /\b(stock|total|page|date|report|statement|particular|product|item|description|quantity|qty|rate|mrp|scheme|grand|continued|invoice|gst|opening|closing|balance|company|manufacturer|packing|pack|unit|s\.?\s*no|sr)\b/i;
/**
 * A company printed on its own row, usually in bold, covering the products until the next company.
 * "ALLERGAN" / "ABBOTT HEALTHCARE". Product rows and report titles do not match.
 */
function manufacturerHeading(line) {
    const cells = line
        .split('\t')
        .map((cell) => cell.trim())
        .filter(Boolean);
    if (cells.length !== 1)
        return null;
    const name = cells[0].replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 40)
        return null;
    if (/\d/.test(name))
        return null;
    if (!/^[A-Za-z][A-Za-z .&/'()-]*$/.test(name))
        return null;
    if (HEADING_NOISE.test(name))
        return null;
    if (name.split(' ').length > 6)
        return null;
    return name;
}
/**
 * Marg-style stock lines: "2 COMBIGAIN DROP 5ML 25 DRP".
 * A company heading above those lines is the manufacturer for each product until the next heading.
 */
function parseSpacedStockLines(text) {
    const rows = [];
    let manufacturer = '';
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const heading = manufacturerHeading(trimmed);
        if (heading) {
            manufacturer = heading;
            continue;
        }
        const match = trimmed.match(SPACED_STOCK_LINE);
        if (!match)
            continue;
        const raw = { productName: match[2], stockQty: match[3] };
        if (manufacturer)
            raw.manufacturer = manufacturer;
        rows.push(...normalizeRows([raw]));
    }
    return dedupeRows(rows);
}
/** "AZTOR 10 TAB                  1X10" keeps the medicine and stores 1X10 as the pack. */
function splitEmbeddedPack(name) {
    const parts = name
        .split(/\s{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
    const last = (parts[parts.length - 1] || '').replace(/\s+/g, '');
    if (parts.length >= 2 && /^(\d+x\d+|\d+(gm|g|ml|mg|s)|\d+')$/i.test(last)) {
        return { productName: parts.slice(0, -1).join(' ').replace(/\s+/g, ' '), pack: last.toUpperCase() };
    }
    const collapsed = name.replace(/\s+/g, ' ').trim();
    const peeled = collapsed.match(/^(.*\S)\s+(\d+\s*[*x]\s*\d*\.?\d+(?:\s*[*x]\s*\d+)?(?:\s*[A-Za-z]{1,6})?|\d+\s*(?:gm|g|ml)|\d+'?s|\d+')$/i);
    if (peeled && peeled[1].trim().length >= 3 && /[*x]|gm|ml/i.test(peeled[2])) {
        return { productName: peeled[1].trim(), pack: peeled[2].replace(/\s+/g, '').toUpperCase() };
    }
    return { productName: collapsed, pack: '' };
}
/** "AMOX DISC 10% 1*10 TAB" stores 10 as the discount and drops that phrase from the name. */
function peelPrintedDiscount(name) {
    const match = name.match(/\b(?:DISC(?:OUNT)?|DISV|DSIC|DIS)\s*\(?\s*(?:NET\s*\)?\s*)?(\d+(?:\.\d+)?)\s*%?|\(\s*DPCO\s*\)\s*(?:DSIC|DISC|DIS|D)?\s*(\d+(?:\.\d+)?)\s*%?/i);
    if (!match || match.index == null)
        return { productName: name };
    const discount = Number(match[1] || match[2]);
    if (!Number.isFinite(discount) || discount <= 0 || discount >= 100)
        return { productName: name };
    const productName = `${name.slice(0, match.index)} ${name.slice(match.index + match[0].length)}`
        .replace(/\(\s*DPCO\s*\)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (productName.length < 3)
        return { productName: name };
    return { productName, discountPercentage: discount };
}
function textOf(value) {
    if (value == null)
        return '';
    return String(value).trim();
}
function numberOf(value) {
    if (value == null || value === '')
        return undefined;
    const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, '').replace(/%/g, ''));
    return Number.isFinite(n) ? n : undefined;
}
//# sourceMappingURL=liveStockExtract.js.map