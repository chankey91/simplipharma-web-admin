/**
 * Invoice text extraction + line parsing for purchase-invoice ingest.
 * PDF: pdf-parse. Images: optional Google Cloud Vision OCR via functions.config().ocr.api_key.
 */
import * as functions from 'firebase-functions';

export type ExtractedLine = {
  lineId: string;
  raw?: string;
  productName: string;
  batchNumber?: string;
  expiryMmYyyy?: string;
  quantity?: number;
  freeQuantity?: number;
  mrp?: number;
  purchasePrice?: number;
  discountPercentage?: number;
  confidence?: number;
};

export type ExtractResult = {
  engine: 'pdf_text' | 'image_ocr' | 'none';
  message?: string;
  rawText: string;
  lines: ExtractedLine[];
  vendorHint?: { name?: string; gstin?: string };
};

const HEADERISH =
  /^(s\.?n|sn|#|hsn|gst|cgst|sgst|sub|invoice|bill|total|tax|date|qty|rate|amount|mrp|discount|net|particular|description|item|pack|exp|mfg|batch)/i;
const GSTIN_REGEX = /([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])/gi;
const BATCH_LIKE = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,28}$/;

function parseExpiryFromLine(line: string): string | undefined {
  const m4 = line.match(/\b(0[1-9]|1[0-2])\/(\d{4})\b/);
  if (m4) return `${m4[1]}/${m4[2]}`;
  const m2 = line.match(/\b(0[1-9]|1[0-2])\/(\d{2})\b/);
  if (m2) {
    const yy = parseInt(m2[2], 10);
    const year = yy <= 30 ? 2000 + yy : 1900 + yy;
    return `${m2[1]}/${year}`;
  }
  return undefined;
}

function parseNumberToken(tok: string): number | undefined {
  const n = parseFloat(tok.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeGstin(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function findGstinsInText(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(GSTIN_REGEX)) {
    const g = normalizeGstin(m[1]);
    if (g.length === 15) seen.add(g);
  }
  return [...seen];
}

export function parseProductLineFromRawLine(line: string): Omit<ExtractedLine, 'lineId'> | null {
  const raw = line.trim();
  if (raw.length < 10) return null;
  if (HEADERISH.test(raw.slice(0, 20))) return null;
  if (/^[0-9\s,.-]+$/.test(raw) && !/[A-Za-z]{3}/.test(raw)) return null;

  const expiryMmYyyy = parseExpiryFromLine(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let workingTokens = [...tokens];
  if (workingTokens.length >= 3 && /^\d{1,4}$/.test(workingTokens[0]) && /[A-Za-z]/.test(workingTokens[1])) {
    workingTokens = workingTokens.slice(1);
  }

  const nums: number[] = [];
  let i = workingTokens.length - 1;
  while (i >= 0) {
    const n = parseNumberToken(workingTokens[i]);
    if (n === undefined) break;
    nums.unshift(n);
    i--;
  }
  const textToks = workingTokens.slice(0, i + 1);
  if (textToks.length === 0) return null;

  let batchNumber = '';
  const nameParts: string[] = [];
  for (const t of textToks) {
    if (!batchNumber && BATCH_LIKE.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t) && t.length >= 4) {
      batchNumber = t;
      continue;
    }
    nameParts.push(t);
  }
  const productName = nameParts.join(' ').trim();
  if (productName.length < 3) return null;

  let quantity: number | undefined;
  let freeQuantity: number | undefined;
  let mrp: number | undefined;
  let purchasePrice: number | undefined;
  let discountPercentage: number | undefined;

  if (nums.length >= 1) quantity = Math.max(1, Math.floor(nums[0]));
  if (nums.length >= 2) purchasePrice = nums[1];
  if (nums.length >= 3) mrp = nums[2];
  if (nums.length >= 4 && nums[3] <= 100) discountPercentage = nums[3];

  return {
    raw,
    productName,
    batchNumber: batchNumber || undefined,
    expiryMmYyyy,
    quantity,
    freeQuantity,
    mrp,
    purchasePrice,
    discountPercentage,
    confidence: 0.55,
  };
}

export function extractPotentialProductLines(fullText: string, maxLines = 150): string[] {
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12 && /\d/.test(l) && /[A-Za-z]/.test(l));

  const out: string[] = [];
  for (const line of lines) {
    const firstWord = line.split(/\s+/)[0] || '';
    if (HEADERISH.test(firstWord)) continue;
    if (HEADERISH.test(line.slice(0, 24))) continue;
    out.push(line);
    if (out.length >= maxLines) break;
  }
  return out;
}

function linesFromText(text: string): ExtractedLine[] {
  const rawLines = extractPotentialProductLines(text);
  const out: ExtractedLine[] = [];
  let n = 0;
  for (const line of rawLines) {
    const parsed = parseProductLineFromRawLine(line);
    if (!parsed) continue;
    n += 1;
    out.push({ ...parsed, lineId: `L${n}` });
  }
  return out;
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // pdf-parse v2 API
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result?.text || '');
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function extractTextFromImageOcr(buffer: Buffer, contentType: string): Promise<string | null> {
  const apiKey =
    (functions.config().ocr && functions.config().ocr.api_key) ||
    process.env.GOOGLE_VISION_API_KEY ||
    '';
  if (!apiKey) return null;

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
  const json = (await res.json()) as {
    responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: { message?: string } }>;
  };
  const resp = json.responses?.[0];
  if (resp?.error?.message) throw new Error(resp.error.message);
  return String(resp?.fullTextAnnotation?.text || '');
}

export async function extractInvoiceFromFile(
  buffer: Buffer,
  contentType: string
): Promise<ExtractResult> {
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
          message:
            'Image uploaded. OCR is not configured (set functions config ocr.api_key for Vision). Add lines manually in review.',
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
    } catch (e: any) {
      return {
        engine: 'none',
        rawText: '',
        lines: [],
        message: `Image OCR failed: ${e?.message || String(e)}. Add lines manually in review.`,
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
