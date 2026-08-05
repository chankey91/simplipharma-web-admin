import { deriveSearchMatchTokens } from '../services/medicineSearch';
import { Medicine, StockBatch } from '../types';

/** Batch-level row for purchase-return picker (name + batch combined search). */
export type PurchaseReturnBatchOption = {
  id: string;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  availableQuantity: number;
  expiryDate?: Date | any;
  purchasePrice: number;
  mrp?: number;
  gstRate?: number;
  label: string;
};

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  const d = new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function formatExpiryShort(expiryDate: unknown): string {
  const d = toDate(expiryDate);
  if (!d) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

function medicineHaystack(m: Medicine): string {
  return [m.name, m.code, m.manufacturer, m.company, m.productId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function batchHaystack(batch: StockBatch): string {
  return [batch.batchNumber, batch.invoiceBatchNumber].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Token must match medicine fields OR batch number (combined name + batch search).
 * e.g. "dolo ABC12" → medicine name has dolo AND batch has ABC12.
 */
export function purchaseReturnBatchMatchesQuery(
  medicine: Medicine,
  batch: StockBatch,
  query: string
): boolean {
  const tokens = deriveSearchMatchTokens(query);
  if (tokens.length === 0) return true;
  const med = medicineHaystack(medicine);
  const bat = batchHaystack(batch);
  return tokens.every((tok) => med.includes(tok) || bat.includes(tok));
}

export function buildPurchaseReturnBatchOptions(
  medicines: Medicine[],
  query: string,
  opts?: { onlyInStock?: boolean }
): PurchaseReturnBatchOption[] {
  const onlyInStock = opts?.onlyInStock !== false;
  const options: PurchaseReturnBatchOption[] = [];
  const seen = new Set<string>();

  for (const medicine of medicines) {
    const batches = medicine.stockBatches || [];
    for (const batch of batches) {
      const qty = Math.max(0, Number(batch.quantity) || 0);
      if (onlyInStock && qty <= 0) continue;
      if (!purchaseReturnBatchMatchesQuery(medicine, batch, query)) continue;

      const batchNumber = String(batch.batchNumber || '').trim();
      if (!batchNumber) continue;
      const id = `${medicine.id}::${batchNumber.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const exp = formatExpiryShort(batch.expiryDate);
      const label = [
        medicine.name,
        `Batch ${batchNumber}`,
        `Avail ${qty}`,
        exp ? `Exp ${exp}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      options.push({
        id,
        medicineId: medicine.id,
        medicineName: medicine.name,
        batchNumber,
        availableQuantity: qty,
        expiryDate: toDate(batch.expiryDate),
        purchasePrice: Number(batch.purchasePrice ?? medicine.purchasePrice ?? 0) || 0,
        mrp: batch.mrp != null ? Number(batch.mrp) : medicine.mrp,
        gstRate: medicine.gstRate,
        label,
      });
    }
  }

  options.sort((a, b) => {
    const nameCmp = a.medicineName.localeCompare(b.medicineName, undefined, {
      sensitivity: 'base',
    });
    if (nameCmp !== 0) return nameCmp;
    return a.batchNumber.localeCompare(b.batchNumber, undefined, { sensitivity: 'base' });
  });

  return options;
}
