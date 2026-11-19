/**
 * Turn a vendor stock file (CSV, Excel, or PDF) into stock rows.
 * Gemini normalizes messy layouts. Column mapping is the fallback.
 */
import {
  askGeminiPdf,
  askGeminiText,
  extractTextFromPdf,
} from './purchaseInvoiceExtract';
import { effectivePurchaseRate } from './liveStockRank';

export type ExtractedStockRow = {
  productName: string;
  pack?: string;
  manufacturer?: string;
  stockQty: number;
  rate?: number;
  mrp?: number;
  scheme?: string;
  schemePaidQty?: number;
  schemeFreeQty?: number;
  discountPercentage?: number;
  expiry?: string;
  effectiveRate?: number;
};

export type StockExtractResult = {
  rows: ExtractedStockRow[];
  engine: 'gemini' | 'columns' | 'none';
  model?: string;
  message?: string;
};

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

export async function extractStockFromFile(
  buffer: Buffer,
  contentType: string,
  fileName: string
): Promise<StockExtractResult> {
  const kind = fileKind(contentType, fileName);
  if (kind === 'pdf') return extractPdf(buffer);
  const table = kind === 'sheet' ? workbookToTable(buffer) : buffer.toString('utf8');
  return extractTable(table);
}

async function extractPdf(buffer: Buffer): Promise<StockExtractResult> {
  const text = await extractTextFromPdf(buffer);
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
  if (text.trim().length >= 40) return extractTable(text);
  try {
    const { text: raw, model } = await askGeminiPdf(STOCK_PROMPT, buffer);
    const rows = normalizeRows(parseRowsJson(raw));
    return {
      rows,
      engine: 'gemini',
      model,
      message: rows.length
        ? 'Read the scanned stock PDF with Gemini.'
        : 'Gemini found no stock rows in the PDF.',
    };
  } catch (error: any) {
    return {
      rows: [],
      engine: 'none',
      message: `Could not read this PDF (${String(error?.message || error).slice(0, 180)}).`,
    };
  }
}

async function extractTable(table: string): Promise<StockExtractResult> {
  const lines = table
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8000);
  if (lines.length < 2) {
    return { rows: [], engine: 'none', message: 'The file has no stock rows.' };
  }

  const headerIndex = detectHeaderIndex(lines);
  const header = lines[headerIndex];
  const mapped = headerFields(header);
  const body = lines.slice(headerIndex + 1);
  // A recognised product column is more reliable than asking Gemini to redraw the sheet.
  // Gemini is reserved for files whose header row cannot be mapped.
  if (mapped.has('productName')) {
    const rows = columnRows(header, body);
    if (rows.length > 0) {
      const missing = !mapped.has('stockQty') && !mapped.has('rate');
      return {
        rows,
        engine: 'columns',
        message: missing
          ? `Loaded ${rows.length} product names. This file has no stock or rate column, so these rows cannot be ranked on the purchase list.`
          : `Loaded ${rows.length} rows from the column headers.`,
      };
    }
  }

  // Company name on its own row (often bold), then the products under it.
  const sectioned = parseSpacedStockLines(lines.join('\n'));
  if (sectioned.length >= 5) {
    return {
      rows: sectioned,
      engine: 'columns',
      message: sectionMessage(sectioned, `Loaded ${sectioned.length} rows from the stock list.`),
    };
  }
  const chunks: string[][] = [];
  for (let i = 0; i < body.length && chunks.length < MAX_CHUNKS; i += CHUNK_ROWS) {
    chunks.push(body.slice(i, i + CHUNK_ROWS));
  }

  const geminiRows: ExtractedStockRow[] = [];
  let model = '';
  let geminiError = '';
  for (const chunk of chunks) {
    try {
      const prompt = `${STOCK_PROMPT}\n\n--- STOCK FILE ---\n${header}\n${chunk.join('\n')}`;
      const result = await askGeminiText(prompt);
      model = result.model;
      geminiRows.push(...normalizeRows(parseRowsJson(result.text)));
    } catch (error: any) {
      geminiError = String(error?.message || error);
      break;
    }
  }

  if (geminiRows.length > 0) {
    const untouched = Math.max(0, body.length - chunks.length * CHUNK_ROWS);
    const extra = untouched > 0 ? columnRows(header, body.slice(chunks.length * CHUNK_ROWS)) : [];
    return {
      rows: dedupeRows([...geminiRows, ...extra]),
      engine: 'gemini',
      model,
      message:
        untouched > 0
          ? `Gemini read the first ${chunks.length * CHUNK_ROWS} rows. The rest were read from the columns.`
          : undefined,
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

function fileKind(contentType: string, fileName: string): 'pdf' | 'sheet' | 'csv' {
  const name = fileName.toLowerCase();
  const type = contentType.toLowerCase();
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || type.includes('spreadsheet') || type.includes('excel')) {
    return 'sheet';
  }
  return 'csv';
}

function workbookToTable(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const book = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of book.SheetNames.slice(0, 3)) {
    const sheet = book.Sheets[name];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
    for (const row of grid) {
      if (!Array.isArray(row) || !row.some((cell) => String(cell || '').trim())) continue;
      parts.push(row.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t'));
    }
  }
  return parts.join('\n');
}

function headerFields(headerLine: string): Map<string, number> {
  const header = splitCells(headerLine);
  const index = new Map<string, number>();
  header.forEach((cell, i) => {
    for (const field of HEADER_FIELDS) {
      if (index.has(field.field)) continue;
      if (field.field === 'rate' && /\bmrp\b/i.test(cell)) continue;
      if (field.pattern.test(cell)) index.set(field.field, i);
    }
  });
  return index;
}

function detectHeaderIndex(lines: string[]): number {
  let best = 0;
  let score = -1;
  for (let i = 0; i < Math.min(lines.length, 25); i += 1) {
    const fields = headerFields(lines[i]);
    // Title rows such as an address full of commas must not beat Company / Product Name.
    let next = fields.size * 10;
    if (fields.has('productName')) next += 50;
    if (fields.has('stockQty') || fields.has('rate')) next += 20;
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

function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  if (line.includes(',')) return splitCsv(line);
  return line.split(/\s{2,}/).map((cell) => cell.trim());
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
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

const HEADER_FIELDS: Array<{ field: keyof ExtractedStockRow | 'discount'; pattern: RegExp }> = [
  { field: 'productName', pattern: /product|medicine|item name|description|particular|^name$|^item$/i },
  { field: 'stockQty', pattern: /stock|qty|quantity|balance|closing|available|qoh/i },
  { field: 'rate', pattern: /ptr|rate|price|net/i },
  { field: 'mrp', pattern: /\bmrp\b/i },
  { field: 'scheme', pattern: /scheme|deal|offer/i },
  { field: 'discount', pattern: /disc|discount|cd\b/i },
  { field: 'pack', pattern: /pack/i },
  { field: 'manufacturer', pattern: /mfr|company|mfg|manufacturer/i },
  { field: 'expiry', pattern: /exp/i },
];

function columnRows(headerLine: string, body: string[]): ExtractedStockRow[] {
  const index = headerFields(headerLine);
  if (!index.has('productName')) return [];
  const rows: ExtractedStockRow[] = [];
  for (const line of body) {
    const cells = splitCells(line);
    const productName = cells[index.get('productName')!] || '';
    if (productName.length < 3 || /^total\b/i.test(productName)) continue;
    const raw: Record<string, string> = { productName };
    for (const [field, at] of index) raw[field] = cells[at] || '';
    const parsed = normalizeRows([raw]);
    rows.push(...parsed);
  }
  return dedupeRows(rows);
}

function parseRowsJson(text: string): Array<Record<string, unknown>> {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(cleaned) as { rows?: unknown };
  if (!Array.isArray(parsed.rows)) return [];
  return parsed.rows.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>;
}

function normalizeRows(rawRows: Array<Record<string, unknown>>): ExtractedStockRow[] {
  const out: ExtractedStockRow[] = [];
  for (const raw of rawRows) {
    const named = splitEmbeddedPack(textOf(raw.productName));
    const productName = named.productName;
    if (!productName || productName.length < 3) continue;
    const schemeText = textOf(raw.scheme);
    const parsedScheme = parseScheme(schemeText);
    const discount = numberOf(raw.discountPercentage) ?? parsedScheme.discountPercentage;
    const rate = numberOf(raw.rate);
    const stockQty = Math.max(0, numberOf(raw.stockQty) ?? 0);
    const row: ExtractedStockRow = { productName, stockQty };
    const pack = textOf(raw.pack) || named.pack;
    const manufacturer = textOf(raw.manufacturer);
    const expiry = textOf(raw.expiry);
    const mrp = numberOf(raw.mrp);
    if (pack) row.pack = pack;
    if (manufacturer) row.manufacturer = manufacturer;
    if (expiry) row.expiry = expiry;
    if (rate != null) row.rate = rate;
    if (mrp != null) row.mrp = mrp;
    if (schemeText) row.scheme = schemeText;
    if (parsedScheme.schemePaidQty) row.schemePaidQty = parsedScheme.schemePaidQty;
    if (parsedScheme.schemeFreeQty) row.schemeFreeQty = parsedScheme.schemeFreeQty;
    if (discount != null && discount > 0) row.discountPercentage = discount;
    const effective = effectivePurchaseRate(rate, row.schemePaidQty, row.schemeFreeQty, row.discountPercentage);
    if (effective != null) row.effectiveRate = effective;
    out.push(row);
  }
  return out;
}

function dedupeRows(rows: ExtractedStockRow[]): ExtractedStockRow[] {
  const seen = new Set<string>();
  const out: ExtractedStockRow[] = [];
  for (const row of rows) {
    const key = `${(row.manufacturer || '').toLowerCase()}|${row.productName.toLowerCase()}|${row.pack || ''}|${row.rate ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function sectionMessage(rows: ExtractedStockRow[], base: string): string {
  const companies = new Set(rows.map((row) => row.manufacturer).filter(Boolean));
  if (!companies.size) return base;
  return `${base} Manufacturer names were taken from the section headings.`;
}

function parseScheme(raw?: string): {
  schemePaidQty?: number;
  schemeFreeQty?: number;
  discountPercentage?: number;
} {
  if (!raw) return {};
  const plus = raw.match(/(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)/);
  if (plus) return { schemePaidQty: Number(plus[1]), schemeFreeQty: Number(plus[2]) };
  const pct = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { discountPercentage: Number(pct[1]) };
  return {};
}

const SPACED_STOCK_LINE = /^(\d+)\s+(.*)\s+(-?\d+)\s+([A-Za-z][A-Za-z0-9]{1,10})$/;

const HEADING_NOISE =
  /\b(stock|total|page|date|report|statement|particular|product|item|description|quantity|qty|rate|mrp|scheme|grand|continued|invoice|gst|opening|closing|balance|company|manufacturer|packing|pack|unit|s\.?\s*no|sr)\b/i;

/**
 * A company printed on its own row, usually in bold, covering the products until the next company.
 * "ALLERGAN" / "ABBOTT HEALTHCARE". Product rows and report titles do not match.
 */
function manufacturerHeading(line: string): string | null {
  const cells = line
    .split('\t')
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length !== 1) return null;
  const name = cells[0].replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) return null;
  if (/\d/.test(name)) return null;
  if (!/^[A-Za-z][A-Za-z .&/'()-]*$/.test(name)) return null;
  if (HEADING_NOISE.test(name)) return null;
  if (name.split(' ').length > 6) return null;
  return name;
}

/**
 * Marg-style stock lines: "2 COMBIGAIN DROP 5ML 25 DRP".
 * A company heading above those lines is the manufacturer for each product until the next heading.
 */
function parseSpacedStockLines(text: string): ExtractedStockRow[] {
  const rows: ExtractedStockRow[] = [];
  let manufacturer = '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = manufacturerHeading(trimmed);
    if (heading) {
      manufacturer = heading;
      continue;
    }
    const match = trimmed.match(SPACED_STOCK_LINE);
    if (!match) continue;
    const raw: Record<string, string> = { productName: match[2], stockQty: match[3] };
    if (manufacturer) raw.manufacturer = manufacturer;
    rows.push(...normalizeRows([raw]));
  }
  return dedupeRows(rows);
}

/** "AZTOR 10 TAB                  1X10" keeps the medicine and stores 1X10 as the pack. */
function splitEmbeddedPack(name: string): { productName: string; pack: string } {
  const parts = name
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const last = (parts[parts.length - 1] || '').replace(/\s+/g, '');
  if (parts.length >= 2 && /^(\d+x\d+|\d+(gm|g|ml|mg|s)|\d+')$/i.test(last)) {
    return { productName: parts.slice(0, -1).join(' ').replace(/\s+/g, ' '), pack: last.toUpperCase() };
  }
  const collapsed = name.replace(/\s+/g, ' ').trim();
  const peeled = collapsed.match(/^(.*\S)\s+(\d+\s*[*x]\s*\d+\s*(?:ml|mg)?|\d+\s*(?:gm|g|ml)|\d+'?s|\d+')$/i);
  if (peeled && peeled[1].trim().length >= 3) {
    return { productName: peeled[1].trim(), pack: peeled[2].replace(/\s+/g, '').toUpperCase() };
  }
  return { productName: collapsed, pack: '' };
}

function textOf(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function numberOf(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, '').replace(/%/g, ''));
  return Number.isFinite(n) ? n : undefined;
}
