/**
 * Invoice extraction for purchase-invoice ingest.
 * Prefer Gemini structured line items (medicine rows only).
 * Fallback: Vision OCR / pdf-parse text + heuristic line parser.
 */
import * as functions from 'firebase-functions';

export type ExtractedLine = {
  lineId: string;
  raw?: string;
  productName: string;
  packaging?: string;
  batchNumber?: string;
  expiryMmYyyy?: string;
  quantity?: number;
  freeQuantity?: number;
  mrp?: number;
  purchasePrice?: number;
  discountPercentage?: number;
  gstRate?: number;
  confidence?: number;
};

export type ExtractResult = {
  engine: 'gemini' | 'pdf_text' | 'image_ocr' | 'none';
  message?: string;
  model?: string;
  rawText: string;
  lines: ExtractedLine[];
  vendorHint?: { name?: string; gstin?: string };
  invoiceNumber?: string;
  invoiceDate?: string;
};

const HEADERISH =
  /^(s\.?n|sn|#|hsn|gst|cgst|sgst|sub|invoice|bill|total|tax|date|qty|rate|amount|mrp|discount|net|particular|description|item|pack|exp|mfg|batch)/i;
const GSTIN_REGEX = /([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])/gi;
const BATCH_LIKE = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,28}$/;

function getGeminiModel(): string {
  return (
    (functions.config().gemini && functions.config().gemini.model) ||
    process.env.GOOGLE_GEMINI_MODEL ||
    'gemini-2.5-flash'
  );
}

const GEMINI_PROMPT = `You extract transactional line items from Indian pharmacy / pharmaceutical wholesale purchase invoices (GST tax invoices).

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "vendorHint": { "name": string|null, "gstin": string|null },
  "invoiceNumber": string|null,
  "invoiceDate": string|null,
  "lines": [
    {
      "productName": string,
      "packaging": string|null,
      "batchNumber": string|null,
      "expiryMmYyyy": string|null,
      "quantity": number|null,
      "freeQuantity": number|null,
      "mrp": number|null,
      "purchasePrice": number|null,
      "discountPercentage": number|null,
      "gstRate": number|null
    }
  ]
}

Rules:
- Include ONLY product/medicine rows from the item table (transactional stock lines).
- IGNORE completely: seller/buyer names & addresses, phone/email, GSTIN header blocks, IRN/QR, bank details, tax summary (CGST/SGST/IGST totals), grand total, round-off, terms & conditions, signatures, page headers/footers, HSN-only summary rows without a product name.
- productName = medicine/product name as printed (do not append pack, batch, qty, or prices).
- packaging = pack size / packing as printed when present (e.g. "10 TAB", "15 ML", "1X10", "STRIP", "BOTTLE"). Do NOT put packaging inside productName. Use null if not shown.
- expiryMmYyyy as MM/YYYY or MM/YY when present on the row.
- purchasePrice = unit rate / PTR / net rate when present (NOT the line amount).
- quantity = billed/paid quantity (not free/scheme qty). freeQuantity = free/scheme qty if shown. Both may be decimals (e.g. 1.5).
- gstRate = GST % for the line when shown (commonly 5, 12, 18, or 28). Use null if not on the row.
- If a field is missing or unclear, use null. Never invent medicines that are not on the invoice.
- Prefer the supplier (seller) GSTIN for vendorHint.gstin when multiple GSTINs appear.`;

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

function asFiniteNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function asNonEmptyString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function normalizeGeminiLines(rawLines: unknown): ExtractedLine[] {
  if (!Array.isArray(rawLines)) return [];
  const out: ExtractedLine[] = [];
  let n = 0;
  for (const row of rawLines) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const productName = asNonEmptyString(r.productName);
    if (!productName || productName.length < 2) continue;
    n += 1;
    const line: ExtractedLine = {
      lineId: `L${n}`,
      productName,
      confidence: 0.85,
    };
    const packaging = asNonEmptyString(r.packaging);
    if (packaging) line.packaging = packaging;
    const batch = asNonEmptyString(r.batchNumber);
    if (batch) line.batchNumber = batch;
    const exp = asNonEmptyString(r.expiryMmYyyy);
    if (exp) line.expiryMmYyyy = exp;
    const qty = asFiniteNumber(r.quantity);
    if (qty !== undefined) line.quantity = Math.max(0, qty);
    const free = asFiniteNumber(r.freeQuantity);
    if (free !== undefined) line.freeQuantity = Math.max(0, free);
    const mrp = asFiniteNumber(r.mrp);
    if (mrp !== undefined) line.mrp = mrp;
    const rate = asFiniteNumber(r.purchasePrice);
    if (rate !== undefined) line.purchasePrice = rate;
    const disc = asFiniteNumber(r.discountPercentage);
    if (disc !== undefined) line.discountPercentage = disc;
    const gst = asFiniteNumber(r.gstRate);
    if (gst !== undefined) line.gstRate = gst;
    out.push(line);
  }
  return out;
}

function parseGeminiJson(text: string): {
  lines: ExtractedLine[];
  vendorHint?: { name?: string; gstin?: string };
  invoiceNumber?: string;
  invoiceDate?: string;
} {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const vendorRaw =
    parsed.vendorHint && typeof parsed.vendorHint === 'object'
      ? (parsed.vendorHint as Record<string, unknown>)
      : {};
  const name = asNonEmptyString(vendorRaw.name);
  let gstin = asNonEmptyString(vendorRaw.gstin);
  if (gstin) gstin = normalizeGstin(gstin);

  const vendorHint =
    name || gstin
      ? {
          ...(name ? { name } : {}),
          ...(gstin ? { gstin } : {}),
        }
      : undefined;

  return {
    lines: normalizeGeminiLines(parsed.lines),
    vendorHint,
    invoiceNumber: asNonEmptyString(parsed.invoiceNumber),
    invoiceDate: asNonEmptyString(parsed.invoiceDate),
  };
}

function getGeminiApiKey(): string {
  return (
    (functions.config().gemini && functions.config().gemini.api_key) ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    ''
  );
}

function getGcpProjectId(): string {
  return (
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    (functions.config().gemini && functions.config().gemini.project) ||
    ''
  );
}

function getVertexLocation(): string {
  return (
    (functions.config().gemini && functions.config().gemini.location) ||
    process.env.GOOGLE_VERTEX_LOCATION ||
    'us-central1'
  );
}

/** Vertex (preferred, Cloud Billing) or AI Studio API key. */
function isGeminiConfigured(): boolean {
  return Boolean(getGcpProjectId()) || Boolean(getGeminiApiKey());
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

function toVertexParts(parts: GeminiPart[]): Array<Record<string, unknown>> {
  return parts.map((p) => {
    if ('text' in p) return { text: p.text };
    return {
      inlineData: {
        mimeType: p.inline_data.mime_type,
        data: p.inline_data.data,
      },
    };
  });
}

async function callGeminiVertex(parts: GeminiPart[]): Promise<{ text: string; model: string }> {
  const projectId = getGcpProjectId();
  if (!projectId) throw new Error('GCP project id not available for Vertex AI');

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const token = typeof accessToken === 'string' ? accessToken : accessToken?.token;
  if (!token) throw new Error('Failed to obtain Vertex AI access token');

  const model = getGeminiModel();
  const location = getVertexLocation();
  const url =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
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
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (json.error?.message) throw new Error(json.error.message);
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text.trim()) throw new Error('Vertex Gemini returned empty response');
  return { text, model: `vertex:${model}` };
}

async function callGeminiApiKey(parts: GeminiPart[]): Promise<{ text: string; model: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }
  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (json.error?.message) throw new Error(json.error.message);
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text.trim()) throw new Error('Gemini returned empty response');
  return { text, model };
}

async function callGemini(parts: GeminiPart[]): Promise<{ text: string; model: string }> {
  const errors: string[] = [];
  if (getGcpProjectId()) {
    try {
      return await callGeminiVertex(parts);
    } catch (e: any) {
      errors.push(e?.message || String(e));
      console.error('Vertex Gemini failed:', e?.message || e);
    }
  }
  if (getGeminiApiKey()) {
    try {
      return await callGeminiApiKey(parts);
    } catch (e: any) {
      errors.push(e?.message || String(e));
      console.error('Gemini API key failed:', e?.message || e);
    }
  }
  throw new Error(
    errors.length
      ? `Gemini unavailable: ${errors.join(' | ')}`
      : 'Gemini not configured (Vertex project or gemini.api_key)'
  );
}

async function extractWithGeminiFromImage(
  buffer: Buffer,
  contentType: string
): Promise<Omit<ExtractResult, 'engine' | 'rawText'> & { rawText: string }> {
  const mime =
    contentType && contentType.startsWith('image/')
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
    message:
      parsed.lines.length === 0
        ? 'Gemini found no medicine line items. Add lines manually in review.'
        : undefined,
  };
}

async function extractWithGeminiFromText(
  invoiceText: string
): Promise<Omit<ExtractResult, 'engine' | 'rawText'> & { rawText: string }> {
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
    message:
      parsed.lines.length === 0
        ? 'Gemini found no medicine line items. Add lines manually in review.'
        : undefined,
  };
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

  if (nums.length >= 1) quantity = Math.max(0, nums[0]);
  if (nums.length >= 2) purchasePrice = nums[1];
  if (nums.length >= 3) mrp = nums[2];
  if (nums.length >= 4 && nums[3] <= 100) discountPercentage = nums[3];

  const parsed: Omit<ExtractedLine, 'lineId'> = {
    raw,
    productName,
    confidence: 0.55,
  };
  if (batchNumber) parsed.batchNumber = batchNumber;
  if (expiryMmYyyy) parsed.expiryMmYyyy = expiryMmYyyy;
  if (quantity !== undefined) parsed.quantity = quantity;
  if (freeQuantity !== undefined) parsed.freeQuantity = freeQuantity;
  if (mrp !== undefined) parsed.mrp = mrp;
  if (purchasePrice !== undefined) parsed.purchasePrice = purchasePrice;
  if (discountPercentage !== undefined) parsed.discountPercentage = discountPercentage;
  return parsed;
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

function mergeVendorHint(
  geminiHint?: { name?: string; gstin?: string },
  textGstins?: string[]
): { name?: string; gstin?: string } | undefined {
  const gstin = geminiHint?.gstin || textGstins?.[0];
  const name = geminiHint?.name;
  if (!gstin && !name) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(gstin ? { gstin } : {}),
  };
}

export async function extractInvoiceFromFile(
  buffer: Buffer,
  contentType: string
): Promise<ExtractResult> {
  const ct = (contentType || '').toLowerCase();
  const isPdf = ct.includes('pdf');
  const isImage = ct.startsWith('image/');
  const geminiReady = isGeminiConfigured();

  if (isImage) {
    let geminiError = '';
    if (geminiReady) {
      try {
        const gemini = await extractWithGeminiFromImage(buffer, ct);
        return {
          engine: 'gemini',
          ...gemini,
        };
      } catch (e: any) {
        geminiError = e?.message || String(e);
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
          return {
            engine: 'gemini',
            ...gemini,
            vendorHint: mergeVendorHint(gemini.vendorHint, findGstinsInText(ocrText)),
            rawText: ocrText,
          };
        } catch (e: any) {
          geminiError = e?.message || String(e);
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
    } catch (e: any) {
      return {
        engine: 'none',
        rawText: '',
        lines: [],
        message: `Image extract failed: ${e?.message || String(e)}. Add lines manually in review.`,
      };
    }
  }

  if (isPdf) {
    const rawText = await extractTextFromPdf(buffer);
    const gstins = findGstinsInText(rawText);

    if (geminiReady && rawText.trim().length >= 40) {
      try {
        const gemini = await extractWithGeminiFromText(rawText);
        return {
          engine: 'gemini',
          ...gemini,
          vendorHint: mergeVendorHint(gemini.vendorHint, gstins),
          rawText,
        };
      } catch (e: any) {
        console.error('Gemini PDF text extract failed, falling back:', e?.message || e);
      }
    }

    return {
      engine: 'pdf_text',
      rawText,
      lines: linesFromText(rawText),
      vendorHint: { gstin: gstins[0] },
      message: rawText.trim()
        ? geminiReady
          ? 'Used heuristic PDF parse (Gemini failed). Review lines carefully.'
          : 'PDF text parsed with heuristics. Configure gemini.api_key for better medicine-line extraction.'
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
