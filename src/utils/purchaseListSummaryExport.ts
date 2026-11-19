import * as XLSX from 'xlsx';
import { getMedicinesByIdsWithBatches } from '../services/inventory';
import { getAllPurchaseInvoices } from '../services/purchaseInvoices';
import type { PurchaseList, PurchaseListItem } from '../services/purchaseLists';
import { istDateStampCompact } from './dateTime';
import { appAlert } from './appDialog';
import {
  buildBestDiscountVendorByMedicineId,
  formatBestDiscountVendorLabel,
  type BestDiscountVendorPurchase,
} from './vendorLastPurchase';

type Deal = NonNullable<PurchaseListItem['deals']>[number];

function packagingOf(med?: { unit?: string; description?: string } | null): string {
  let packaging = med?.unit?.trim();
  if (!packaging && med?.description) {
    const match = med.description.match(/Packaging:\s*(.+)/i);
    if (match?.[1]) packaging = match[1].trim();
  }
  return packaging || '—';
}

function dealCells(deal?: Deal): (string | number)[] {
  if (!deal) return ['', '', '', '', ''];
  const stock =
    deal.coversNeed === false ? `${deal.stockQty} (short)` : deal.stockQty;
  return [
    deal.vendorName || '',
    deal.effectiveRate ?? deal.rate ?? '',
    deal.scheme || '',
    stock,
    deal.pack || '',
  ];
}

/**
 * Same columns as Orders → Summary, plus P1 / P2 / P3 from the live-stock
 * deals saved on the purchase list.
 */
export async function exportPurchaseListSummary(
  list: PurchaseList,
  items: PurchaseListItem[]
): Promise<void> {
  if (items.length === 0) {
    await appAlert('This purchase list has no medicines to download.', { severity: 'warning' });
    return;
  }

  const medicineIds = items.map((item) => item.medicineId).filter(Boolean);
  const medicineById = new Map<string, { productId: string; packaging: string }>();
  try {
    const meds = await getMedicinesByIdsWithBatches(medicineIds);
    for (const med of meds) {
      medicineById.set(med.id, {
        productId: med.productId?.trim() || '',
        packaging: packagingOf(med),
      });
    }
  } catch (error) {
    console.warn('purchase list summary: medicine lookup failed', error);
  }

  let bestDiscount = new Map<string, BestDiscountVendorPurchase>();
  try {
    const invoices = await getAllPurchaseInvoices();
    bestDiscount = buildBestDiscountVendorByMedicineId(invoices);
  } catch (error) {
    console.warn('purchase list summary: best-discount lookup failed', error);
  }

  const rows = [...items].sort((a, b) => {
    const manufacturer = (a.manufacturer || '').localeCompare(b.manufacturer || '');
    if (manufacturer !== 0) return manufacturer;
    return (a.medicineName || '').localeCompare(b.medicineName || '');
  });

  const priorities = ['P1', 'P2', 'P3'] as const;
  const headers = [
    'S.No',
    'Product ID',
    'Medicine Name',
    'Packaging',
    'Total Quantity',
    'Best Discount Vendor',
    'Manufacturer',
  ];
  for (const priority of priorities) {
    headers.push(
      `${priority} Vendor`,
      `${priority} Rate`,
      `${priority} Scheme`,
      `${priority} Stock`,
      `${priority} Pack`
    );
  }

  const excelData: (string | number)[][] = [headers];
  rows.forEach((item, index) => {
    const med = item.medicineId ? medicineById.get(item.medicineId) : undefined;
    const deals = item.deals || [];
    const cells: (string | number)[] = [
      index + 1,
      med?.productId || '',
      item.medicineName,
      med?.packaging || '—',
      item.totalQty,
      formatBestDiscountVendorLabel(item.medicineId ? bestDiscount.get(item.medicineId) : undefined),
      item.manufacturer || 'N/A',
    ];
    for (const priority of priorities) {
      cells.push(...dealCells(deals.find((deal) => deal.priority === priority)));
    }
    excelData.push(cells);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 40 },
    { wch: 18 },
    { wch: 16 },
    { wch: 36 },
    { wch: 28 },
    ...priorities.flatMap(() => [
      { wch: 28 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Purchase list');

  const stamp = `${list.fromDate}_${list.toDate}`.replace(/[^\d-]+/g, '');
  XLSX.writeFile(wb, `purchase-list-summary-${stamp}-${istDateStampCompact()}.xlsx`);
}
