import type { PurchaseInvoice } from '../types';
import { purchaseItemStockBatchNumber } from './purchaseInvoiceBatch';
import { coerceToDate } from './dateTime';

export type PurchaseSourceMatch = 'exact_batch' | 'expiry' | 'latest_medicine';

export type PurchaseSourceHit = {
  vendorId: string;
  vendorName: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date | null;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  billedQty: number;
  purchasePrice?: number;
  nonReturnable?: boolean;
  expiryDate?: Date | null;
  match: PurchaseSourceMatch;
};

export type PurchaseSourceStatus = 'exact' | 'ambiguous' | 'guess' | 'none';

export type PurchaseSourceResolution = {
  status: PurchaseSourceStatus;
  vendorId?: string;
  vendorName?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  match?: PurchaseSourceMatch;
  candidates: PurchaseSourceHit[];
};

export type PurchaseSourceIndex = {
  byMedicineBatch: Map<string, PurchaseSourceHit[]>;
  byMedicine: Map<string, PurchaseSourceHit[]>;
};

/** Batch keys for matching PI line vs physical pack (ignore spaces/dashes). */
export function normalizeBatchKey(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function expiryMonthKey(value: unknown): string {
  const d = coerceToDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function lineBatchKeys(item: PurchaseInvoice['items'][number]): string[] {
  const keys = new Set<string>();
  const invoice = normalizeBatchKey(item.batchNumber);
  const stock = normalizeBatchKey(purchaseItemStockBatchNumber(item));
  if (invoice) keys.add(invoice);
  if (stock) keys.add(stock);
  return [...keys];
}

function uniqueNewestPerVendor(hits: PurchaseSourceHit[]): PurchaseSourceHit[] {
  const map = new Map<string, PurchaseSourceHit>();
  for (const hit of hits) {
    if (!hit.vendorId || map.has(hit.vendorId)) continue;
    map.set(hit.vendorId, hit);
  }
  return [...map.values()];
}

export function buildPurchaseSourceIndex(invoices: PurchaseInvoice[]): PurchaseSourceIndex {
  const byMedicineBatch = new Map<string, PurchaseSourceHit[]>();
  const byMedicine = new Map<string, PurchaseSourceHit[]>();

  const sorted = [...invoices].sort((a, b) => {
    const ta = coerceToDate(a.invoiceDate)?.getTime() ?? 0;
    const tb = coerceToDate(b.invoiceDate)?.getTime() ?? 0;
    return tb - ta;
  });

  for (const inv of sorted) {
    const vendorId = String(inv.vendorId || '').trim();
    if (!vendorId) continue;
    const vendorName = String(inv.vendorName || '').trim() || vendorId;
    const invoiceDate = coerceToDate(inv.invoiceDate);

    for (const item of inv.items || []) {
      const medicineId = String(item.medicineId || '').trim();
      if (!medicineId) continue;
      const billedQty =
        (Number(item.quantity) || 0) + (Number(item.freeQuantity) || 0);
      const hit: PurchaseSourceHit = {
        vendorId,
        vendorName,
        invoiceId: inv.id,
        invoiceNumber: String(inv.invoiceNumber || inv.vendorInvoiceNumber || inv.id),
        invoiceDate,
        medicineId,
        medicineName: String(item.medicineName || ''),
        batchNumber: purchaseItemStockBatchNumber(item) || String(item.batchNumber || ''),
        billedQty,
        purchasePrice: Number(item.purchasePrice ?? item.unitPrice) || undefined,
        nonReturnable: item.nonReturnable === true,
        expiryDate: coerceToDate(item.expiryDate),
        match: 'exact_batch',
      };

      const medList = byMedicine.get(medicineId) || [];
      medList.push(hit);
      byMedicine.set(medicineId, medList);

      for (const batchKey of lineBatchKeys(item)) {
        const key = `${medicineId}::${batchKey}`;
        const list = byMedicineBatch.get(key) || [];
        list.push({ ...hit, match: 'exact_batch' });
        byMedicineBatch.set(key, list);
      }
    }
  }

  return { byMedicineBatch, byMedicine };
}

export function resolvePurchaseSource(
  index: PurchaseSourceIndex,
  medicineId: string,
  batchNumber: string,
  expiryDate?: Date | null
): PurchaseSourceResolution {
  const mid = String(medicineId || '').trim();
  if (!mid) return { status: 'none', candidates: [] };

  const batchKey = normalizeBatchKey(batchNumber);
  const exact = batchKey ? index.byMedicineBatch.get(`${mid}::${batchKey}`) || [] : [];
  const exactVendors = uniqueNewestPerVendor(exact);
  if (exactVendors.length === 1) {
    const hit = exactVendors[0];
    return {
      status: 'exact',
      vendorId: hit.vendorId,
      vendorName: hit.vendorName,
      invoiceId: hit.invoiceId,
      invoiceNumber: hit.invoiceNumber,
      match: 'exact_batch',
      candidates: exactVendors,
    };
  }
  if (exactVendors.length > 1) {
    return { status: 'ambiguous', candidates: exactVendors };
  }

  const all = index.byMedicine.get(mid) || [];
  const expKey = expiryMonthKey(expiryDate);
  if (expKey) {
    const expiryHits = all
      .filter((h) => expiryMonthKey(h.expiryDate) === expKey)
      .map((h) => ({ ...h, match: 'expiry' as const }));
    const expiryVendors = uniqueNewestPerVendor(expiryHits);
    if (expiryVendors.length === 1) {
      const hit = expiryVendors[0];
      return {
        status: 'guess',
        vendorId: hit.vendorId,
        vendorName: hit.vendorName,
        invoiceId: hit.invoiceId,
        invoiceNumber: hit.invoiceNumber,
        match: 'expiry',
        candidates: expiryVendors,
      };
    }
    if (expiryVendors.length > 1) {
      return { status: 'ambiguous', candidates: expiryVendors };
    }
  }

  if (all.length > 0) {
    const latestVendors = uniqueNewestPerVendor(
      all.map((h) => ({ ...h, match: 'latest_medicine' as const }))
    );
    if (latestVendors.length === 1) {
      const hit = latestVendors[0];
      return {
        status: 'guess',
        vendorId: hit.vendorId,
        vendorName: hit.vendorName,
        invoiceId: hit.invoiceId,
        invoiceNumber: hit.invoiceNumber,
        match: 'latest_medicine',
        candidates: latestVendors,
      };
    }
    return { status: 'none', candidates: latestVendors.slice(0, 8) };
  }

  return { status: 'none', candidates: [] };
}

export function sourceMatchLabel(match?: PurchaseSourceMatch, status?: PurchaseSourceStatus): string {
  if (status === 'ambiguous') return 'Multiple bills — pick vendor';
  if (status === 'none') return 'Vendor not found';
  if (match === 'exact_batch') return 'Matched batch on PI';
  if (match === 'expiry') return 'Same medicine + expiry (check)';
  if (match === 'latest_medicine') return 'Last purchase of this medicine (check)';
  if (status === 'guess') return 'Check vendor';
  return '';
}
