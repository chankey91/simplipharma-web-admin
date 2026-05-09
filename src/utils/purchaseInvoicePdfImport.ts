import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { Medicine, Vendor } from '../types';
import {
  refineMedicineSearchResults,
  searchMedicinesTypesenseAdmin,
} from '../services/medicineSearch';

// Vite resolves worker as URL for bundling
// eslint-disable-next-line import/no-unresolved
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerConfigured = false;

function ensurePdfWorker(): void {
  if (workerConfigured) return;
  GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  workerConfigured = true;
}

export async function extractTextFromPdfFile(file: File): Promise<string> {
  ensurePdfWorker();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const rows: Array<{ y: number; x: number; str: string }> = [];
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      const str = item.str?.trim();
      const t = item.transform;
      if (!str || !t || t.length < 6) continue;
      rows.push({ x: t[4], y: t[5], str });
    }
    rows.sort((a, b) => (Math.abs(a.y - b.y) < 2 ? a.x - b.x : b.y - a.y));

    let current: { y: number; cells: string[] } | null = null;
    const pageLines: string[] = [];
    for (const r of rows) {
      if (!current || Math.abs(current.y - r.y) > 2.5) {
        if (current && current.cells.length) {
          pageLines.push(current.cells.join(' ').replace(/\s+/g, ' ').trim());
        }
        current = { y: r.y, cells: [r.str] };
      } else {
        current.cells.push(r.str);
      }
    }
    if (current && current.cells.length) {
      pageLines.push(current.cells.join(' ').replace(/\s+/g, ' ').trim());
    }
    for (const line of pageLines) {
      parts.push(line);
    }
    parts.push('\n');
  }
  return parts.join('\n');
}

const GSTIN_REGEX = /([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])/gi;

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

export function matchVendorByGst(vendors: Vendor[] | undefined, gstins: string[]): Vendor | undefined {
  if (!vendors?.length || !gstins.length) return undefined;
  const set = new Set(gstins.map(normalizeGstin));
  const hits = vendors.filter((v) => v.gstNumber && set.has(normalizeGstin(v.gstNumber)));
  if (hits.length === 1) return hits[0];
  return undefined;
}

export function matchVendorByName(vendors: Vendor[] | undefined, fullText: string): Vendor | undefined {
  if (!vendors?.length) return undefined;
  const haystack = fullText.toLowerCase().replace(/\s+/g, ' ');
  let best: Vendor | undefined;
  let bestScore = 0;
  for (const v of vendors) {
    const name = (v.vendorName || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!name || name.length < 4) continue;
    if (!haystack.includes(name)) continue;
    const score = name.length;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

const HEADERISH = /^(s\.?n|sn|#|hsn|gst|cgst|sgst|sub|invoice|bill|total|tax|date|qty|rate|amount|mrp|discount|net|particular|description|item|pack|exp|mfg|batch)/i;

export type ParsedPdfProductLine = {
  raw: string;
  productName: string;
  batchNumber: string;
  quantity: number;
  freeQuantity?: number;
  mrp?: number;
  purchasePrice?: number;
  discountPercentage?: number;
  expiryMmYyyy?: string;
};

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

const BATCH_LIKE = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,28}$/;

function parseNumberToken(tok: string): number | undefined {
  const n = parseFloat(tok.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Best-effort row parser for space-separated invoice lines (layout varies by vendor). */
export function parseProductLineFromRawLine(line: string): ParsedPdfProductLine | null {
  const raw = line.trim();
  if (raw.length < 10) return null;
  if (HEADERISH.test(raw.slice(0, 20))) return null;
  if (/^[0-9\s,.-]+$/.test(raw) && !/[A-Za-z]{3}/.test(raw)) return null;

  const expiryMmYyyy = parseExpiryFromLine(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  // Strip leading serial number tokens, common in printed invoice rows.
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
  let nameToks = [...textToks];
  if (textToks.length > 1 && BATCH_LIKE.test(textToks[textToks.length - 1])) {
    batchNumber = textToks[textToks.length - 1];
    nameToks = textToks.slice(0, -1);
  }

  const productName = nameToks.join(' ').replace(/\s+/g, ' ').trim();
  if (productName.length < 2) return null;

  let quantity = 1;
  let freeQuantity: number | undefined;
  let purchasePrice: number | undefined;
  let mrp: number | undefined;
  let discountPercentage: number | undefined;
  if (nums.length >= 1) quantity = Math.max(1, Math.round(nums[0]));
  if (nums.length === 2) {
    purchasePrice = nums[1];
  } else if (nums.length === 3) {
    mrp = nums[1];
    purchasePrice = nums[2];
  } else if (nums.length === 4) {
    // Typical: qty, mrp, rate, amount
    mrp = nums[1];
    purchasePrice = nums[2];
  } else if (nums.length >= 5) {
    // Typical: qty, free, mrp, disc, rate, amount (disc optional)
    const maybeFree = Math.round(nums[1]);
    if (Number.isInteger(nums[1]) && maybeFree >= 0 && maybeFree <= Math.max(quantity * 2, 10)) {
      freeQuantity = maybeFree;
    }
    mrp = nums[2];
    if (nums.length >= 6) {
      const maybeDisc = nums[3];
      if (maybeDisc >= 0 && maybeDisc <= 100) discountPercentage = maybeDisc;
      purchasePrice = nums[4];
    } else {
      purchasePrice = nums[3];
    }
  }

  return {
    raw,
    productName,
    batchNumber,
    quantity,
    freeQuantity,
    mrp,
    purchasePrice,
    discountPercentage,
    expiryMmYyyy,
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

export function findMedicineByBatchNumber(
  medicines: Medicine[],
  batch: string
): Medicine | undefined {
  const key = batch.trim().toUpperCase();
  if (!key) return undefined;
  const matches: Medicine[] = [];
  for (const m of medicines) {
    for (const b of m.stockBatches || []) {
      if (b.batchNumber && b.batchNumber.trim().toUpperCase() === key) {
        matches.push(m);
        break;
      }
    }
  }
  if (matches.length === 1) return matches[0];
  return undefined;
}

export async function resolveMedicineForImportLine(
  parsed: ParsedPdfProductLine,
  medicines: Medicine[]
): Promise<{ medicine?: Medicine; source: 'batch' | 'name' | 'none' }> {
  if (parsed.batchNumber) {
    const byBatch = findMedicineByBatchNumber(medicines, parsed.batchNumber);
    if (byBatch) return { medicine: byBatch, source: 'batch' };
  }
  const q = parsed.productName.trim();
  if (q.length >= 2) {
    try {
      const hits = await searchMedicinesTypesenseAdmin(q, { hydrate: true, limit: 12, strict: true });
      const refined = refineMedicineSearchResults(hits, q, medicines);
      if (refined[0]) return { medicine: refined[0], source: 'name' };
    } catch {
      // ignore search failures
    }
  }
  return { source: 'none' };
}
