import * as XLSX from 'xlsx';
import type { PurchaseInvoice } from '../types';
import { getMedicinesByIdsWithBatches } from '../services/inventory';
import { istDateStampCompact } from './dateTime';

export type PurchaseDiscountListRow = {
  medicineName: string;
  companyName: string;
  vendorName: string;
  discountPct: number;
};

function toNum(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * One row per medicine + vendor: the highest vendor Disc % we received
 * that is >= minDiscountPct.
 */
export function collectPurchaseDiscountRows(
  invoices: PurchaseInvoice[],
  minDiscountPct: number
): Array<{
  medicineId: string;
  medicineName: string;
  vendorName: string;
  discountPct: number;
}> {
  const best = new Map<
    string,
    { medicineId: string; medicineName: string; vendorName: string; discountPct: number }
  >();

  for (const inv of invoices) {
    const vendorName = String(inv.vendorName || '').trim() || 'Unknown vendor';
    const vendorKey = String(inv.vendorId || vendorName).trim().toLowerCase();
    for (const item of inv.items || []) {
      const discountPct = toNum(item.discountPercentage);
      if (discountPct < minDiscountPct) continue;
      const medicineId = String(item.medicineId || '').trim();
      const medicineName = String(item.medicineName || '').trim() || 'Unknown';
      const key = `${medicineId || medicineName.toLowerCase()}|${vendorKey}`;
      const existing = best.get(key);
      if (!existing || discountPct > existing.discountPct) {
        best.set(key, { medicineId, medicineName, vendorName, discountPct });
      }
    }
  }

  return [...best.values()].sort((a, b) => {
    const byDisc = b.discountPct - a.discountPct;
    if (byDisc !== 0) return byDisc;
    return a.medicineName.localeCompare(b.medicineName);
  });
}

export async function exportPurchaseDiscountList(
  invoices: PurchaseInvoice[],
  minDiscountPct: number,
  filename = 'purchase-discount-list'
): Promise<number> {
  const collected = collectPurchaseDiscountRows(invoices, minDiscountPct);
  const ids = collected.map((r) => r.medicineId).filter(Boolean);
  const companyById = new Map<string, string>();
  if (ids.length > 0) {
    try {
      const meds = await getMedicinesByIdsWithBatches([...new Set(ids)]);
      for (const med of meds) {
        const company = String(med.manufacturer || med.company || '').trim();
        if (company) companyById.set(med.id, company);
      }
    } catch (error) {
      console.warn('Failed to load manufacturers for discount list:', error);
    }
  }

  const rows: PurchaseDiscountListRow[] = collected.map((r) => ({
    medicineName: r.medicineName,
    companyName: (r.medicineId && companyById.get(r.medicineId)) || '—',
    vendorName: r.vendorName,
    discountPct: r.discountPct,
  }));

  const excelData: (string | number)[][] = [
    ['Medicine Name', 'Company Name', 'Vendor Name', 'Discount %'],
  ];
  for (const row of rows) {
    excelData.push([row.medicineName, row.companyName, row.vendorName, row.discountPct]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [{ wch: 40 }, { wch: 28 }, { wch: 28 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Discount list');
  XLSX.writeFile(wb, `${filename}-min${minDiscountPct}-${istDateStampCompact()}.xlsx`);
  return rows.length;
}
