import * as XLSX from 'xlsx';
import { getMedicinesByIdsWithBatches } from '../services/inventory';
import { getAllPurchaseInvoices } from '../services/purchaseInvoices';
import type { PurchaseList, PurchaseListItem } from '../services/purchaseLists';
import { istDateStampCompact } from './dateTime';
import { appAlert } from './appDialog';
import {
  buildBestDiscountVendorByMedicineId,
  buildRankedPurchaseVendorsByMedicineId,
  fillVendorSlots,
  formatBestDiscountVendorLabel,
  type BestDiscountVendorPurchase,
} from './vendorLastPurchase';

function packagingOf(med?: { unit?: string; description?: string } | null): string {
  let packaging = med?.unit?.trim();
  if (!packaging && med?.description) {
    const match = med.description.match(/Packaging:\s*(.+)/i);
    if (match?.[1]) packaging = match[1].trim();
  }
  return packaging || '—';
}

/**
 * Same columns as Orders → Summary, plus P1 / P2 / P3 vendor names.
 * Live stock fills the slots it can. Older purchase bills fill the rest.
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
  let pastVendors = new Map<string, string[]>();
  try {
    const invoices = await getAllPurchaseInvoices();
    bestDiscount = buildBestDiscountVendorByMedicineId(invoices);
    pastVendors = buildRankedPurchaseVendorsByMedicineId(invoices);
  } catch (error) {
    console.warn('purchase list summary: purchase history lookup failed', error);
  }

  const rows = [...items].sort((a, b) => {
    const manufacturer = (a.manufacturer || '').localeCompare(b.manufacturer || '');
    if (manufacturer !== 0) return manufacturer;
    return (a.medicineName || '').localeCompare(b.medicineName || '');
  });

  const headers = [
    'S.No',
    'Product ID',
    'Medicine Name',
    'Packaging',
    'Total Quantity',
    'Best Discount Vendor',
    'Manufacturer',
    'P1 Vendor',
    'P2 Vendor',
    'P3 Vendor',
  ];

  const excelData: (string | number)[][] = [headers];
  rows.forEach((item, index) => {
    const med = item.medicineId ? medicineById.get(item.medicineId) : undefined;
    const history = item.medicineId ? pastVendors.get(item.medicineId) || [] : [];
    const live = [...(item.deals || [])]
      .sort((a, b) => a.priority.localeCompare(b.priority))
      .map((deal) => deal.vendorName);
    const [p1, p2, p3] = fillVendorSlots(live, history);
    excelData.push([
      index + 1,
      med?.productId || '',
      item.medicineName,
      med?.packaging || '—',
      item.totalQty,
      formatBestDiscountVendorLabel(item.medicineId ? bestDiscount.get(item.medicineId) : undefined),
      item.manufacturer || 'N/A',
      p1,
      p2,
      p3,
    ]);
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
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Purchase list');

  const stamp = `${list.fromDate}_${list.toDate}`.replace(/[^\d-]+/g, '');
  XLSX.writeFile(wb, `purchase-list-summary-${stamp}-${istDateStampCompact()}.xlsx`);
}
