"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeGstin = normalizeGstin;
exports.findGstinsInText = findGstinsInText;
exports.normalizeInvoiceDate = normalizeInvoiceDate;
exports.parseProductLineFromRawLine = parseProductLineFromRawLine;
exports.extractPotentialProductLines = extractPotentialProductLines;
exports.extractInvoiceFromFile = extractInvoiceFromFile;
/**
 * Invoice extraction for purchase-invoice ingest.
 * Prefer Gemini structured line items (medicine rows only).
 * Fallback: Vision OCR / pdf-parse text + heuristic line parser.
 */
const runtimeConfig_1 = require("./runtimeConfig");
const HEADERISH = /^(s\.?n|sn|#|hsn|gst|cgst|sgst|sub|invoice|bill|total|tax|date|qty|rate|amount|mrp|discount|net|particular|description|item|pack|exp|mfg|batch)/i;
const GSTIN_REGEX = /([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])/gi;
const BATCH_LIKE = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,28}$/;
function getGeminiModel() {
    return (0, runtimeConfig_1.getGeminiModel)();
}
const GEMINI_PROMPT = `You extract transactional line items from Indian pharmacy / pharmaceutical wholesale purchase invoices (GST tax invoices).

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "vendorHint": { "name": string|null, "gstin": string|null },
  "invoiceNumber": string|null,
  "invoiceDate": string|null,
  "notes": string|null,
  "lines": [
    {
      "productName": string,
      "packaging": string|null,
      "batchNumber": string|null,
      "receivedBatchNumber": string|null,
      "expiryMmYyyy": string|null,
      "quantity": number|null,
      "freeQuantity": number|null,
      "schemePaidQty": number|null,
      "schemeFreeQty": number|null,
      "mrp": number|null,
      "purchasePrice": number|null,
      "discountPercentage": number|null,
      "standardDiscount": number|null,
      "gstRate": number|null,
      "nonReturnable": boolean|null,
      "nrxDrug": boolean|null
    }
  ]
}

Rules:
- Include ONLY product/medicine rows from the item table (transactional stock lines).
- IGNORE completely: seller/buyer names & addresses, phone/email, GSTIN header blocks, IRN/QR, bank details, tax summary (CGST/SGST/IGST totals), grand total, round-off, signatures, page headers/footers, HSN-only summary rows without a product name.
- notes = short invoice-level remark/terms snippet when clearly printed (else null). Do not invent notes.
- invoiceDate as YYYY-MM-DD when possible; otherwise as printed.
- productName = medicine/product name as printed (do not append pack, batch, qty, or prices).
- packaging = pack size / packing as printed when present (e.g. "10 TAB", "15 ML", "1X10", "STRIP", "BOTTLE"). Do NOT put packaging inside productName. Use null if not shown.
- batchNumber = invoice / bill batch as printed. receivedBatchNumber only if the invoice shows a distinct physical/pack batch different from bill batch; else null.
- expiryMmYyyy as MM/YYYY or MM/YY when present on the row.
- purchasePrice = unit rate / PTR / net rate when present (NOT the line amount).
- mrp = printed MRP / MRP per unit when present.
- quantity = billed/paid quantity (not free/scheme qty). freeQuantity = free/scheme qty credited on this bill if shown. Both may be decimals (e.g. 1.5).
- schemePaidQty / schemeFreeQty = retailer deal like "10+1" or "Buy 10 Get 1" → paid=10, free=1. Use null if not shown as a scheme ratio (do not copy freeQuantity into schemeFreeQty unless a scheme ratio is explicit).
- discountPercentage = line trade/cash discount % on this bill when shown (CD / Disc %).
- standardDiscount = standard/MRP discount % when explicitly printed; else null (do not invent).
- gstRate = GST % for the line when shown (commonly 5, 12, 18, or 28). Use null if not on the row.
- nonReturnable = true only if the row/invoice marks non-returnable / NR for that item. nrxDrug = true only if marked NRX / Schedule H / H1 for that item. Otherwise null.
- If a field is missing or unclear, use null. Never invent medicines that are not on the invoice.
- Prefer the supplier (seller) GSTIN for vendorHint.gstin when multiple GSTINs appear.`;
function parseExpiryFromLine(line) {
    const m4 = line.match(/\b(0[1-9]|1[0-2])\/(\d{4})\b/);
    if (m4)
        return `${m4[1]}/${m4[2]}`;
    const m2 = line.match(/\b(0[1-9]|1[0-2])\/(\d{2})\b/);
    if (m2) {
        const yy = parseInt(m2[2], 10);
        const year = yy <= 30 ? 2000 + yy : 1900 + yy;
        return `${m2[1]}/${year}`;
    }
    return undefined;
}
function parseNumberToken(tok) {
    const n = parseFloat(tok.replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
}
function normalizeGstin(raw) {
    return raw.replace(/\s+/g, '').toUpperCase();
}
function findGstinsInText(text) {
    const seen = new Set();
    for (const m of text.matchAll(GSTIN_REGEX)) {
        const g = normalizeGstin(m[1]);
        if (g.length === 15)
            seen.add(g);
    }
    return [...seen];
}
function asFiniteNumber(v) {
    if (v == null || v === '')
        return undefined;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
}
function asNonEmptyString(v) {
    if (v == null)
        return undefined;
    const s = String(v).trim();
    return s ? s : undefined;
}
function asBooleanFlag(v) {
    if (v === true || v === false)
        return v;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === 'yes' || s === 'y' || s === '1')
            return true;
        if (s === 'false' || s === 'no' || s === 'n' || s === '0')
            return false;
    }
    return undefined;
}
function deriveStandardDiscount(mrp, purchasePrice, gstRate) {
    if (mrp == null || purchasePrice == null || mrp <= 0 || purchasePrice <= 0)
        return undefined;
    const gst = gstRate != null && gstRate >= 0 ? gstRate : 5;
    const priceWithGst = purchasePrice * (1 + gst / 100);
    const pct = (1 - priceWithGst / mrp) * 100;
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100)
        return undefined;
    return Math.round(pct * 100) / 100;
}
/** Normalize common Indian invoice date prints to YYYY-MM-DD for date inputs. */
function normalizeInvoiceDate(raw) {
    if (!raw)
        return undefined;
    const s = raw.trim();
    if (!s)
        return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s))
        return s;
    const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (dmy) {
        const dd = dmy[1].padStart(2, '0');
        const mm = dmy[2].padStart(2, '0');
        let yyyy = dmy[3];
        if (yyyy.length === 2) {
            const yy = parseInt(yyyy, 10);
            yyyy = String(yy <= 30 ? 2000 + yy : 1900 + yy);
        }
        return `${yyyy}-${mm}-${dd}`;
    }
    return s;
}
function normalizeGeminiLines(rawLines) {
    if (!Array.isArray(rawLines))
        return [];
    const out = [];
    let n = 0;
    for (const row of rawLines) {
        if (!row || typeof row !== 'object')
            continue;
        const r = row;
        const productName = asNonEmptyString(r.productName);
        if (!productName || productName.length < 2)
            continue;
        n += 1;
        const line = {
            lineId: `L${n}`,
            productName,
            confidence: 0.85,
        };
        const packaging = asNonEmptyString(r.packaging);
        if (packaging)
            line.packaging = packaging;
        const batch = asNonEmptyString(r.batchNumber);
        if (batch)
            line.batchNumber = batch;
        const receivedBatch = asNonEmptyString(r.receivedBatchNumber);
        if (receivedBatch)
            line.receivedBatchNumber = receivedBatch;
        const exp = asNonEmptyString(r.expiryMmYyyy);
        if (exp)
            line.expiryMmYyyy = exp;
        const qty = asFiniteNumber(r.quantity);
        if (qty !== undefined)
            line.quantity = Math.max(0, qty);
        const free = asFiniteNumber(r.freeQuantity);
        if (free !== undefined)
            line.freeQuantity = Math.max(0, free);
        const schemePaid = asFiniteNumber(r.schemePaidQty);
        if (schemePaid !== undefined && schemePaid > 0)
            line.schemePaidQty = Math.floor(schemePaid);
        const schemeFree = asFiniteNumber(r.schemeFreeQty);
        if (schemeFree !== undefined && schemeFree > 0)
            line.schemeFreeQty = Math.floor(schemeFree);
        const mrp = asFiniteNumber(r.mrp);
        if (mrp !== undefined)
            line.mrp = mrp;
        const rate = asFiniteNumber(r.purchasePrice);
        if (rate !== undefined)
            line.purchasePrice = rate;
        const disc = asFiniteNumber(r.discountPercentage);
        if (disc !== undefined)
            line.discountPercentage = disc;
        const std = asFiniteNumber(r.standardDiscount);
        if (std !== undefined)
            line.standardDiscount = std;
        const gst = asFiniteNumber(r.gstRate);
        if (gst !== undefined)
            line.gstRate = gst;
        const nr = asBooleanFlag(r.nonReturnable);
        if (nr === true)
            line.nonReturnable = true;
        const nrx = asBooleanFlag(r.nrxDrug);
        if (nrx === true)
            line.nrxDrug = true;
        if (line.standardDiscount == null) {
            const derived = deriveStandardDiscount(line.mrp, line.purchasePrice, line.gstRate);
            if (derived != null)
                line.standardDiscount = derived;
        }
        out.push(line);
    }
    return out;
}
function parseGeminiJson(text) {
    let cleaned = text.trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence)
        cleaned = fence[1].trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start)
        cleaned = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(cleaned);
    const vendorRaw = parsed.vendorHint && typeof parsed.vendorHint === 'object'
        ? parsed.vendorHint
        : {};
    const name = asNonEmptyString(vendorRaw.name);
    let gstin = asNonEmptyString(vendorRaw.gstin);
    if (gstin)
        gstin = normalizeGstin(gstin);
    const vendorHint = name || gstin
        ? Object.assign(Object.assign({}, (name ? { name } : {})), (gstin ? { gstin } : {})) : undefined;
    return {
        lines: normalizeGeminiLines(parsed.lines),
        vendorHint,
        invoiceNumber: asNonEmptyString(parsed.invoiceNumber),
        invoiceDate: normalizeInvoiceDate(asNonEmptyString(parsed.invoiceDate)),
        notes: asNonEmptyString(parsed.notes),
    };
}
function getGeminiApiKey() {
    return (0, runtimeConfig_1.getGeminiApiKey)() || '';
}
function getGcpProjectId() {
    return (0, runtimeConfig_1.getGeminiProject)() || '';
}
function getVertexLocation() {
    return (0, runtimeConfig_1.getGeminiLocation)();
}
/** Vertex (preferred, Cloud Billing) or AI Studio API key. */
function isGeminiConfigured() {
    return Boolean(getGcpProjectId()) || Boolean(getGeminiApiKey());
}
function toVertexParts(parts) {
    return parts.map((p) => {
        if ('text' in p)
            return { text: p.text };
        return {
            inlineData: {
                mimeType: p.inline_data.mime_type,
                data: p.inline_data.data,
            },
        };
    });
}
async function callGeminiVertex(parts) {
    var _a, _b, _c, _d, _e;
    const projectId = getGcpProjectId();
    if (!projectId)
        throw new Error('GCP project id not available for Vertex AI');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken === null || accessToken === void 0 ? void 0 : accessToken.token;
    if (!token)
        throw new Error('Failed to obtain Vertex AI access token');
    const model = getGeminiModel();
    const location = getVertexLocation();
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
        `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: toVertexParts(parts) }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
            },
        }),
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Vertex Gemini failed (${res.status}): ${errText.slice(0, 500)}`);
    }
    const json = (await res.json());
    if ((_a = json.error) === null || _a === void 0 ? void 0 : _a.message)
        throw new Error(json.error.message);
    const text = ((_e = (_d = (_c = (_b = json.candidates) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.parts) === null || _e === void 0 ? void 0 : _e.map((p) => p.text || '').join('')) || '';
    if (!text.trim())
        throw new Error('Vertex Gemini returned empty response');
    return { text, model: `vertex:${model}` };
}
async function callGeminiApiKey(parts) {
    var _a, _b, _c, _d, _e;
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        throw new Error('Gemini API key not configured');
    }
    const model = getGeminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
            },
        }),
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API key failed (${res.status}): ${errText.slice(0, 400)}`);
    }
    const json = (await res.json());
    if ((_a = json.error) === null || _a === void 0 ? void 0 : _a.message)
        throw new Error(json.error.message);
    const text = ((_e = (_d = (_c = (_b = json.candidates) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.parts) === null || _e === void 0 ? void 0 : _e.map((p) => p.text || '').join('')) || '';
    if (!text.trim())
        throw new Error('Gemini returned empty response');
    return { text, model };
}
async function callGemini(parts) {
    const errors = [];
    if (getGcpProjectId()) {
        try {
            return await callGeminiVertex(parts);
        }
        catch (e) {
            errors.push((e === null || e === void 0 ? void 0 : e.message) || String(e));
            console.error('Vertex Gemini failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    }
    if (getGeminiApiKey()) {
        try {
            return await callGeminiApiKey(parts);
        }
        catch (e) {
            errors.push((e === null || e === void 0 ? void 0 : e.message) || String(e));
            console.error('Gemini API key failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
        }
    }
    throw new Error(errors.length
        ? `Gemini unavailable: ${errors.join(' | ')}`
        : 'Gemini not configured (Vertex project or gemini.api_key)');
}
async function extractWithGeminiFromPdfBytes(buffer) {
    const { text, model } = await callGemini([
        { text: GEMINI_PROMPT },
        { inline_data: { mime_type: 'application/pdf', data: buffer.toString('base64') } },
    ]);
    const parsed = parseGeminiJson(text);
    return {
        model,
        rawText: text.slice(0, 8000),
        lines: parsed.lines,
        vendorHint: parsed.vendorHint,
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: parsed.invoiceDate,
        notes: parsed.notes,
        message: parsed.lines.length === 0
            ? 'Gemini found no medicine line items on the PDF. Add lines manually in review.'
            : undefined,
    };
}
async function extractWithGeminiFromImage(buffer, contentType) {
    const mime = contentType && contentType.startsWith('image/')
        ? contentType
        : 'image/jpeg';
    const { text, model } = await callGemini([
        { text: GEMINI_PROMPT },
        { inline_data: { mime_type: mime, data: buffer.toString('base64') } },
    ]);
    const parsed = parseGeminiJson(text);
    return {
        model,
        rawText: text.slice(0, 8000),
        lines: parsed.lines,
        vendorHint: parsed.vendorHint,
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: parsed.invoiceDate,
        notes: parsed.notes,
        message: parsed.lines.length === 0
            ? 'Gemini found no medicine line items. Add lines manually in review.'
            : undefined,
    };
}
async function extractWithGeminiFromText(invoiceText) {
    const { text, model } = await callGemini([
        {
            text: `${GEMINI_PROMPT}\n\n--- INVOICE TEXT ---\n${invoiceText.slice(0, 60000)}`,
        },
    ]);
    const parsed = parseGeminiJson(text);
    return {
        model,
        rawText: invoiceText,
        lines: parsed.lines,
        vendorHint: parsed.vendorHint,
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: parsed.invoiceDate,
        notes: parsed.notes,
        message: parsed.lines.length === 0
            ? 'Gemini found no medicine line items. Add lines manually in review.'
            : undefined,
    };
}
function parseProductLineFromRawLine(line) {
    const raw = line.trim();
    if (raw.length < 10)
        return null;
    if (HEADERISH.test(raw.slice(0, 20)))
        return null;
    if (/^[0-9\s,.-]+$/.test(raw) && !/[A-Za-z]{3}/.test(raw))
        return null;
    const expiryMmYyyy = parseExpiryFromLine(raw);
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length < 2)
        return null;
    let workingTokens = [...tokens];
    if (workingTokens.length >= 3 && /^\d{1,4}$/.test(workingTokens[0]) && /[A-Za-z]/.test(workingTokens[1])) {
        workingTokens = workingTokens.slice(1);
    }
    const nums = [];
    let i = workingTokens.length - 1;
    while (i >= 0) {
        const n = parseNumberToken(workingTokens[i]);
        if (n === undefined)
            break;
        nums.unshift(n);
        i--;
    }
    const textToks = workingTokens.slice(0, i + 1);
    if (textToks.length === 0)
        return null;
    let batchNumber = '';
    const nameParts = [];
    for (const t of textToks) {
        if (!batchNumber && BATCH_LIKE.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t) && t.length >= 4) {
            batchNumber = t;
            continue;
        }
        nameParts.push(t);
    }
    const productName = nameParts.join(' ').trim();
    if (productName.length < 3)
        return null;
    let quantity;
    let freeQuantity;
    let mrp;
    let purchasePrice;
    let discountPercentage;
    if (nums.length >= 1)
        quantity = Math.max(0, nums[0]);
    if (nums.length >= 2)
        purchasePrice = nums[1];
    if (nums.length >= 3)
        mrp = nums[2];
    if (nums.length >= 4 && nums[3] <= 100)
        discountPercentage = nums[3];
    const parsed = {
        raw,
        productName,
        confidence: 0.55,
    };
    if (batchNumber)
        parsed.batchNumber = batchNumber;
    if (expiryMmYyyy)
        parsed.expiryMmYyyy = expiryMmYyyy;
    if (quantity !== undefined)
        parsed.quantity = quantity;
    if (freeQuantity !== undefined)
        parsed.freeQuantity = freeQuantity;
    if (mrp !== undefined)
        parsed.mrp = mrp;
    if (purchasePrice !== undefined)
        parsed.purchasePrice = purchasePrice;
    if (discountPercentage !== undefined)
        parsed.discountPercentage = discountPercentage;
    const derived = deriveStandardDiscount(parsed.mrp, parsed.purchasePrice, parsed.gstRate);
    if (derived != null)
        parsed.standardDiscount = derived;
    return parsed;
}
function extractPotentialProductLines(fullText, maxLines = 150) {
    const lines = fullText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 12 && /\d/.test(l) && /[A-Za-z]/.test(l));
    const out = [];
    for (const line of lines) {
        const firstWord = line.split(/\s+/)[0] || '';
        if (HEADERISH.test(firstWord))
            continue;
        if (HEADERISH.test(line.slice(0, 24)))
            continue;
        out.push(line);
        if (out.length >= maxLines)
            break;
    }
    return out;
}
function linesFromText(text) {
    const rawLines = extractPotentialProductLines(text);
    const out = [];
    let n = 0;
    for (const line of rawLines) {
        const parsed = parseProductLineFromRawLine(line);
        if (!parsed)
            continue;
        n += 1;
        out.push(Object.assign(Object.assign({}, parsed), { lineId: `L${n}` }));
    }
    return out;
}
async function extractTextFromPdf(buffer) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return String((result === null || result === void 0 ? void 0 : result.text) || '');
    }
    finally {
        try {
            await parser.destroy();
        }
        catch (_a) {
            /* ignore */
        }
    }
}
async function extractTextFromImageOcr(buffer, contentType) {
    var _a, _b, _c;
    const apiKey = (0, runtimeConfig_1.getVisionApiKey)() || '';
    if (!apiKey)
        return null;
    const b64 = buffer.toString('base64');
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
    const body = {
        requests: [
            {
                image: { content: b64 },
                features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            },
        ],
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Vision OCR failed (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = (await res.json());
    const resp = (_a = json.responses) === null || _a === void 0 ? void 0 : _a[0];
    if ((_b = resp === null || resp === void 0 ? void 0 : resp.error) === null || _b === void 0 ? void 0 : _b.message)
        throw new Error(resp.error.message);
    return String(((_c = resp === null || resp === void 0 ? void 0 : resp.fullTextAnnotation) === null || _c === void 0 ? void 0 : _c.text) || '');
}
function mergeVendorHint(geminiHint, textGstins) {
    const gstin = (geminiHint === null || geminiHint === void 0 ? void 0 : geminiHint.gstin) || (textGstins === null || textGstins === void 0 ? void 0 : textGstins[0]);
    const name = geminiHint === null || geminiHint === void 0 ? void 0 : geminiHint.name;
    if (!gstin && !name)
        return undefined;
    return Object.assign(Object.assign({}, (name ? { name } : {})), (gstin ? { gstin } : {}));
}
async function extractInvoiceFromFile(buffer, contentType) {
    const ct = (contentType || '').toLowerCase();
    const isPdf = ct.includes('pdf');
    const isImage = ct.startsWith('image/');
    const geminiReady = isGeminiConfigured();
    if (isImage) {
        let geminiError = '';
        if (geminiReady) {
            try {
                const gemini = await extractWithGeminiFromImage(buffer, ct);
                return Object.assign({ engine: 'gemini' }, gemini);
            }
            catch (e) {
                geminiError = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                console.error('Gemini image extract failed, falling back:', geminiError);
            }
        }
        try {
            const ocrText = await extractTextFromImageOcr(buffer, ct);
            if (ocrText == null) {
                return {
                    engine: 'none',
                    rawText: '',
                    lines: [],
                    message: geminiError
                        ? `Image extract failed (${geminiError.slice(0, 180)}). Add lines manually in review.`
                        : 'Image uploaded. Vertex/Gemini not available and OCR is not configured. Add lines manually in review.',
                };
            }
            if (geminiReady && ocrText.trim()) {
                try {
                    const gemini = await extractWithGeminiFromText(ocrText);
                    return Object.assign(Object.assign({ engine: 'gemini' }, gemini), { vendorHint: mergeVendorHint(gemini.vendorHint, findGstinsInText(ocrText)), rawText: ocrText });
                }
                catch (e) {
                    geminiError = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                    console.error('Gemini text extract failed, falling back:', geminiError);
                }
            }
            const gstins = findGstinsInText(ocrText);
            return {
                engine: 'image_ocr',
                rawText: ocrText,
                lines: linesFromText(ocrText),
                vendorHint: { gstin: gstins[0] },
                message: ocrText.trim()
                    ? `Used heuristic OCR parse (Gemini unavailable${geminiError ? `: ${geminiError.slice(0, 160)}` : ''}). Review lines carefully.`
                    : 'OCR returned no text. Add lines manually in review.',
            };
        }
        catch (e) {
            return {
                engine: 'none',
                rawText: '',
                lines: [],
                message: `Image extract failed: ${(e === null || e === void 0 ? void 0 : e.message) || String(e)}. Add lines manually in review.`,
            };
        }
    }
    if (isPdf) {
        const rawText = await extractTextFromPdf(buffer);
        const gstins = findGstinsInText(rawText);
        let geminiError = '';
        if (geminiReady && rawText.trim().length >= 40) {
            try {
                const gemini = await extractWithGeminiFromText(rawText);
                return Object.assign(Object.assign({ engine: 'gemini' }, gemini), { vendorHint: mergeVendorHint(gemini.vendorHint, gstins), rawText });
            }
            catch (e) {
                geminiError = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                console.error('Gemini PDF text extract failed, falling back:', geminiError);
            }
        }
        // Scanned / image-only PDFs: send PDF bytes to Gemini multimodal.
        if (geminiReady && rawText.trim().length < 40) {
            try {
                const gemini = await extractWithGeminiFromPdfBytes(buffer);
                return Object.assign(Object.assign({ engine: 'gemini' }, gemini), { vendorHint: mergeVendorHint(gemini.vendorHint, gstins), message: gemini.message ||
                        (gemini.lines.length
                            ? 'Extracted from scanned PDF via Gemini vision. Review lines carefully.'
                            : gemini.message) });
            }
            catch (e) {
                geminiError = (e === null || e === void 0 ? void 0 : e.message) || String(e);
                console.error('Gemini PDF vision extract failed:', geminiError);
            }
        }
        return {
            engine: rawText.trim() ? 'pdf_text' : 'none',
            rawText,
            lines: linesFromText(rawText),
            vendorHint: { gstin: gstins[0] },
            message: rawText.trim()
                ? geminiReady
                    ? `Used heuristic PDF parse${geminiError ? ` (Gemini failed: ${geminiError.slice(0, 120)})` : ''}. Review lines carefully.`
                    : 'PDF text parsed with heuristics. Configure gemini.api_key for better medicine-line extraction.'
                : geminiError
                    ? `Scanned PDF extract failed (${geminiError.slice(0, 160)}). Photograph the invoice or add lines manually.`
                    : 'PDF had little/no extractable text (may be a scan). Photograph the invoice or add lines manually.',
        };
    }
    return {
        engine: 'none',
        rawText: '',
        lines: [],
        message: `Unsupported content type: ${contentType}`,
    };
}
//# sourceMappingURL=purchaseInvoiceExtract.js.map