import {
  collection,
  db,
  deleteField,
  doc,
  documentId,
  getDocs,
  query,
  Timestamp,
  where,
  writeBatch,
} from './firebase';
import { PurchaseInvoice, PurchaseInvoiceItem } from '../types';
import { coerceToDate, getTodayDateStringIST } from '../utils/dateTime';

const IN_LIMIT = 30;
const WRITE_LIMIT = 400;

export type LastPurchasePriceBackfillResult = {
  invoicesScanned: number;
  medicinesUpdated: number;
  medicinesMissing: number;
};

type PricePoint = {
  purchasePrice: number;
  invoiceId: string;
  invoiceDate: Date;
};

type MedicineLastPurchaseMeta = {
  exists: boolean;
  at?: Date;
  invoiceId?: string;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function positivePrice(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return roundMoney(n);
}

/** Last line on the bill wins when the same product appears more than once. */
export function lastLinePurchasePriceByMedicine(
  items: Array<Pick<PurchaseInvoiceItem, 'medicineId' | 'purchasePrice' | 'unitPrice'>> | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items || []) {
    const medicineId = String(item.medicineId || '').trim();
    if (!medicineId) continue;
    const price = positivePrice(item.purchasePrice) ?? positivePrice(item.unitPrice);
    if (price === undefined) continue;
    map.set(medicineId, price);
  }
  return map;
}

function invoiceSortTime(value: unknown): number {
  return coerceToDate(value)?.getTime() ?? 0;
}

/** Newest invoice date first. Same day: later created bill wins. */
export function pickNewestPurchasePrices(
  invoices: Array<Pick<PurchaseInvoice, 'id' | 'invoiceDate' | 'createdAt' | 'items'>>
): Map<string, PricePoint> {
  const sorted = [...invoices].sort((a, b) => {
    const byDate = invoiceSortTime(b.invoiceDate) - invoiceSortTime(a.invoiceDate);
    if (byDate !== 0) return byDate;
    return invoiceSortTime(b.createdAt) - invoiceSortTime(a.createdAt);
  });

  const picked = new Map<string, PricePoint>();
  for (const invoice of sorted) {
    const invoiceDate = coerceToDate(invoice.invoiceDate);
    if (!invoiceDate) continue;
    const prices = lastLinePurchasePriceByMedicine(invoice.items);
    for (const [medicineId, purchasePrice] of prices) {
      if (picked.has(medicineId)) continue;
      picked.set(medicineId, {
        purchasePrice,
        invoiceId: invoice.id,
        invoiceDate,
      });
    }
  }
  return picked;
}

async function loadMedicineLastPurchaseMeta(
  medicineIds: string[]
): Promise<Map<string, MedicineLastPurchaseMeta>> {
  const unique = [...new Set(medicineIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, MedicineLastPurchaseMeta>();
  for (const id of unique) map.set(id, { exists: false });
  if (!unique.length) return map;

  for (const group of chunk(unique, IN_LIMIT)) {
    const snap = await getDocs(
      query(collection(db, 'medicines'), where(documentId(), 'in', group))
    );
    for (const d of snap.docs) {
      const data = d.data();
      map.set(d.id, {
        exists: true,
        at: coerceToDate(data.lastPurchasePriceAt) ?? undefined,
        invoiceId: data.lastPurchaseInvoiceId ? String(data.lastPurchaseInvoiceId) : undefined,
      });
    }
  }
  return map;
}

async function commitMedicineUpdates(
  updates: Array<{ medicineId: string; data: Record<string, unknown> }>
): Promise<void> {
  for (const group of chunk(updates, WRITE_LIMIT)) {
    const batch = writeBatch(db);
    for (const update of group) {
      batch.update(doc(db, 'medicines', update.medicineId), update.data);
    }
    await batch.commit();
  }
}

function priceWrite(
  medicineId: string,
  point: PricePoint
): { medicineId: string; data: Record<string, unknown> } {
  return {
    medicineId,
    data: {
      lastPurchasePrice: point.purchasePrice,
      lastPurchasePriceAt: Timestamp.fromDate(point.invoiceDate),
      lastPurchaseInvoiceId: point.invoiceId,
    },
  };
}

function priceClear(medicineId: string): { medicineId: string; data: Record<string, unknown> } {
  return {
    medicineId,
    data: {
      lastPurchasePrice: deleteField(),
      lastPurchasePriceAt: deleteField(),
      lastPurchaseInvoiceId: deleteField(),
    },
  };
}

async function loadAllPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  const { getAllPurchaseInvoices } = await import('./purchaseInvoices');
  return getAllPurchaseInvoices();
}

/** Recompute Last Purchase Price for these products from every saved purchase bill. */
export async function recomputeLastPurchasePrices(medicineIds: string[]): Promise<void> {
  const unique = [...new Set(medicineIds.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return;

  const [invoices, metas] = await Promise.all([
    loadAllPurchaseInvoices(),
    loadMedicineLastPurchaseMeta(unique),
  ]);
  const picked = pickNewestPurchasePrices(invoices);
  const updates: Array<{ medicineId: string; data: Record<string, unknown> }> = [];

  for (const medicineId of unique) {
    const meta = metas.get(medicineId);
    if (!meta?.exists) continue;
    const point = picked.get(medicineId);
    if (point) updates.push(priceWrite(medicineId, point));
    else updates.push(priceClear(medicineId));
  }

  await commitMedicineUpdates(updates);
}

/**
 * After a purchase bill is saved, copy its ex-GST purchase price onto each product
 * when this bill is the newest purchase for that product.
 */
export async function syncLastPurchasePricesForInvoice(params: {
  invoiceId: string;
  invoiceDate: unknown;
  items: PurchaseInvoiceItem[];
  previousItems?: PurchaseInvoiceItem[];
}): Promise<void> {
  const invoiceDate = coerceToDate(params.invoiceDate);
  const thisDay = invoiceDate ? getTodayDateStringIST(invoiceDate) : '';
  const prices = lastLinePurchasePriceByMedicine(params.items);
  const previousIds = lastLinePurchasePriceByMedicine(params.previousItems).keys();
  const affected = [...new Set([...prices.keys(), ...previousIds])];
  if (!affected.length) return;

  const metas = await loadMedicineLastPurchaseMeta(affected);
  const updates: Array<{ medicineId: string; data: Record<string, unknown> }> = [];
  const recomputeIds: string[] = [];

  for (const medicineId of affected) {
    const meta = metas.get(medicineId);
    if (!meta?.exists) continue;

    const price = prices.get(medicineId);
    const storedDay = meta.at ? getTodayDateStringIST(meta.at) : '';
    const isSource = meta.invoiceId === params.invoiceId;

    if (price != null && invoiceDate && thisDay) {
      if (isSource && storedDay && thisDay < storedDay) {
        recomputeIds.push(medicineId);
        continue;
      }
      if (!storedDay || thisDay >= storedDay || isSource) {
        updates.push(
          priceWrite(medicineId, {
            purchasePrice: price,
            invoiceId: params.invoiceId,
            invoiceDate,
          })
        );
        continue;
      }
    }

    if (price == null && isSource) {
      recomputeIds.push(medicineId);
    }
  }

  await commitMedicineUpdates(updates);
  if (recomputeIds.length) {
    await recomputeLastPurchasePrices(recomputeIds);
  }
}

/** After a bill is deleted, restore Last Purchase Price from the previous purchase. */
export async function refreshLastPurchasePricesAfterInvoiceDeleted(
  invoiceId: string,
  items: PurchaseInvoiceItem[]
): Promise<void> {
  const medicineIds = [...lastLinePurchasePriceByMedicine(items).keys()];
  if (!medicineIds.length) return;

  const metas = await loadMedicineLastPurchaseMeta(medicineIds);
  const stale = medicineIds.filter((id) => metas.get(id)?.invoiceId === invoiceId);
  if (!stale.length) return;
  await recomputeLastPurchasePrices(stale);
}

/** One-time fill of Last Purchase Price from existing purchase bills. */
export async function backfillLastPurchasePrices(): Promise<LastPurchasePriceBackfillResult> {
  const invoices = await loadAllPurchaseInvoices();
  const picked = pickNewestPurchasePrices(invoices);
  const medicineIds = [...picked.keys()];
  const metas = await loadMedicineLastPurchaseMeta(medicineIds);
  const updates: Array<{ medicineId: string; data: Record<string, unknown> }> = [];
  let medicinesMissing = 0;

  for (const medicineId of medicineIds) {
    const meta = metas.get(medicineId);
    const point = picked.get(medicineId);
    if (!point) continue;
    if (!meta?.exists) {
      medicinesMissing += 1;
      continue;
    }
    updates.push(priceWrite(medicineId, point));
  }

  await commitMedicineUpdates(updates);
  return {
    invoicesScanned: invoices.length,
    medicinesUpdated: updates.length,
    medicinesMissing,
  };
}
