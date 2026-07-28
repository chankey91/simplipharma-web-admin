"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeGstin = normalizeGstin;
exports.findGstinsInText = findGstinsInText;
exports.parseProductLineFromRawLine = parseProductLineFromRawLine;
exports.extractPotentialProductLines = extractPotentialProductLines;
exports.extractInvoiceFromFile = extractInvoiceFromFile;
/**
 * Invoice text extraction + line parsing for purchase-invoice ingest.
 * PDF: pdf-parse. Images: optional Google Cloud Vision OCR via functions.config().ocr.api_key.
 */
const functions = require("firebase-functions");
const HEADERISH = /^(s\.?n|sn|#|hsn|gst|cgst|sgst|sub|invoice|bill|total|tax|date|qty|rate|amount|mrp|discount|net|particular|description|item|pack|exp|mfg|batch)/i;
const GSTIN_REGEX = /([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])/gi;
const BATCH_LIKE = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,28}$/;
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
        quantity = Math.max(1, Math.floor(nums[0]));
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
    // pdf-parse v2 API
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
    const apiKey = (functions.config().ocr && functions.config().ocr.api_key) ||
        process.env.GOOGLE_VISION_API_KEY ||
        '';
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
async function extractInvoiceFromFile(buffer, contentType) {
    const ct = (contentType || '').toLowerCase();
    const isPdf = ct.includes('pdf');
    const isImage = ct.startsWith('image/');
    if (isPdf) {
        const rawText = await extractTextFromPdf(buffer);
        const gstins = findGstinsInText(rawText);
        return {
            engine: 'pdf_text',
            rawText,
            lines: linesFromText(rawText),
            vendorHint: { gstin: gstins[0] },
            message: rawText.trim() ? undefined : 'PDF had little/no extractable text (may be a scan).',
        };
    }
    if (isImage) {
        try {
            const ocrText = await extractTextFromImageOcr(buffer, ct);
            if (ocrText == null) {
                return {
                    engine: 'none',
                    rawText: '',
                    lines: [],
                    message: 'Image uploaded. OCR is not configured (set functions config ocr.api_key for Vision). Add lines manually in review.',
                };
            }
            const gstins = findGstinsInText(ocrText);
            return {
                engine: 'image_ocr',
                rawText: ocrText,
                lines: linesFromText(ocrText),
                vendorHint: { gstin: gstins[0] },
                message: ocrText.trim() ? undefined : 'OCR returned no text. Add lines manually in review.',
            };
        }
        catch (e) {
            return {
                engine: 'none',
                rawText: '',
                lines: [],
                message: `Image OCR failed: ${(e === null || e === void 0 ? void 0 : e.message) || String(e)}. Add lines manually in review.`,
            };
        }
    }
    return {
        engine: 'none',
        rawText: '',
        lines: [],
        message: `Unsupported content type: ${contentType}`,
    };
}
//# sourceMappingURL=purchaseInvoiceExtract.js.map