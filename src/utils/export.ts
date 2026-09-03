import * as XLSX from 'xlsx';
import { formatOrderInvoiceLabel } from './orderDisplay';
import { Order, User } from '../types';
import { getMedicineById } from '../services/inventory';
import { getAllPurchaseInvoices } from '../services/purchaseInvoices';
import { istDateStampCompact } from './dateTime';
import { appAlert } from './appDialog';
import type { SoReceivableSummary } from './soReceivables';
import {
  buildBestDiscountVendorByMedicineId,
  formatBestDiscountVendorLabel,
  type BestDiscountVendorPurchase,
} from './vendorLastPurchase';

function resolvePackaging(med?: { unit?: string; description?: string } | null): string {
  let packaging = med?.unit?.trim();
  if (!packaging && med?.description) {
    const match = med.description.match(/Packaging:\s*(.+)/i);
    if (match?.[1]) packaging = match[1].trim();
  }
  return packaging || '—';
}

export const exportPendingOrdersByStore = async (
  orders: Order[],
  stores: User[],
  filename: string = 'pending-orders-by-store'
) => {
  const pendingOrders = orders.filter((order) => order.status === 'Pending');

  if (pendingOrders.length === 0) {
    await appAlert('No pending orders found', { severity: 'warning' });
    return;
  }

  const storeById = new Map(stores.map((s) => [s.id, s]));

  // Aggregate by store + medicine (name + id when present)
  const medicineAggregate = new Map<
    string,
    {
      storeCode: string;
      shopName: string;
      medicineName: string;
      quantity: number;
      shopNameForSort: string;
    }
  >();

  for (const order of pendingOrders) {
    const store = storeById.get(order.retailerId) || null;
    const storeId = order.retailerId || 'unknown';
    const storeCode = store?.storeCode || 'na';
    const shopName = store?.shopName || store?.displayName || 'N/A';

    for (const medicine of order.medicines) {
      const medKey = medicine.medicineId?.trim() || medicine.name.trim().toLowerCase();
      const key = `${storeId}|${medKey}`;

      if (medicineAggregate.has(key)) {
        medicineAggregate.get(key)!.quantity += medicine.quantity || 0;
      } else {
        medicineAggregate.set(key, {
          storeCode,
          shopName,
          medicineName: medicine.name,
          quantity: medicine.quantity || 0,
          shopNameForSort: shopName,
        });
      }
    }
  }

  const rows = Array.from(medicineAggregate.values()).sort((a, b) => {
    const shopCompare = a.shopNameForSort.localeCompare(b.shopNameForSort);
    if (shopCompare !== 0) return shopCompare;
    return a.medicineName.localeCompare(b.medicineName);
  });

  const excelData: (string | number)[][] = [
    ['Store Code', 'Shop Name', 'Medicine Name', 'Quantity'],
  ];

  rows.forEach((row) => {
    excelData.push([
      row.storeCode,
      row.shopName,
      row.medicineName,
      row.quantity || '',
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 40 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Pending Orders');

  const dateStr = istDateStampCompact();
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};

function productAggregateKey(medicine: Order['medicines'][number]): string {
  if (medicine.medicineId?.trim()) return `med:${medicine.medicineId.trim()}`;
  if (medicine.productDemandId?.trim()) return `demand:${medicine.productDemandId.trim()}`;
  return `name:${medicine.name.trim().toLowerCase()}`;
}

/**
 * One row per product with total quantity across the given orders (no store details).
 * Includes vendor that historically gave the highest purchase discount for that medicine.
 * Caller should pass the already date-/status-filtered order list.
 */
export const exportPendingOrdersProductSummary = async (
  orders: Order[],
  filename: string = 'orders-product-summary'
) => {
  if (orders.length === 0) {
    await appAlert('No orders found for the selected date range', { severity: 'warning' });
    return;
  }

  const medicineMap = new Map<string, { manufacturer: string; packaging: string }>();
  const allMedicineIds = new Set<string>();

  for (const order of orders) {
    for (const medicine of order.medicines) {
      if (medicine.medicineId) allMedicineIds.add(medicine.medicineId);
    }
  }

  for (const medicineId of allMedicineIds) {
    if (medicineMap.has(medicineId)) continue;
    try {
      const med = await getMedicineById(medicineId);
      if (med) {
        medicineMap.set(medicineId, {
          manufacturer: med.manufacturer || 'N/A',
          packaging: resolvePackaging(med),
        });
      }
    } catch (error) {
      console.warn(`Failed to fetch medicine ${medicineId}:`, error);
    }
  }

  let bestDiscountByMedicineId = new Map<string, BestDiscountVendorPurchase>();
  try {
    const purchaseInvoices = await getAllPurchaseInvoices();
    bestDiscountByMedicineId = buildBestDiscountVendorByMedicineId(purchaseInvoices);
  } catch (error) {
    console.warn('Failed to load purchase invoices for best-discount vendor column:', error);
  }

  const productAggregate = new Map<
    string,
    {
      medicineId: string;
      medicineName: string;
      manufacturer: string;
      packaging: string;
      totalQty: number;
    }
  >();

  for (const order of orders) {
    for (const medicine of order.medicines) {
      const key = productAggregateKey(medicine);
      const medInfo = medicine.medicineId ? medicineMap.get(medicine.medicineId) : undefined;
      const manufacturer = medInfo?.manufacturer || medicine.manufacturerName || 'N/A';
      const packaging = medInfo?.packaging || medicine.requestedUnit?.trim() || '—';
      const qty = medicine.quantity || 0;

      const existing = productAggregate.get(key);
      if (existing) {
        existing.totalQty += qty;
      } else {
        productAggregate.set(key, {
          medicineId: medicine.medicineId || '',
          medicineName: medicine.name,
          manufacturer,
          packaging,
          totalQty: qty,
        });
      }
    }
  }

  const rows = Array.from(productAggregate.values()).sort((a, b) =>
    a.medicineName.localeCompare(b.medicineName)
  );

  const excelData: (string | number)[][] = [
    [
      'SR',
      'Medicine Name',
      'Manufacturer',
      'Packaging',
      'Total Quantity',
      'Best Discount Vendor',
    ],
  ];

  rows.forEach((row, index) => {
    const best = row.medicineId
      ? bestDiscountByMedicineId.get(row.medicineId)
      : undefined;
    excelData.push([
      index + 1,
      row.medicineName,
      row.manufacturer,
      row.packaging,
      row.totalQty,
      formatBestDiscountVendorLabel(best),
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);

  ws['!cols'] = [
    { wch: 5 },
    { wch: 40 },
    { wch: 30 },
    { wch: 18 },
    { wch: 14 },
    { wch: 36 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Product Summary');

  const dateStr = istDateStampCompact();
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};

/**
 * One row per retailer with store details and associated Sales Officer fields.
 * Caller should pass the already filtered/sorted store list.
 */
export const exportRetailersWithSalesOfficers = async (
  retailers: User[],
  salesOfficers: User[],
  filename: string = 'retailers-with-sales-officers'
) => {
  if (retailers.length === 0) {
    await appAlert('No retailers found to export', { severity: 'warning' });
    return;
  }

  const soById = new Map(salesOfficers.map((so) => [so.id, so]));

  const excelData: (string | number)[][] = [
    [
      'SR',
      'Store Code',
      'Shop Name',
      'Owner',
      'Email',
      'Phone',
      'Address',
      'Town',
      'District',
      'Licence No.',
      'Aadhar No.',
      'Licence Holder',
      'PAN',
      'GST',
      'Status',
      'Latitude',
      'Longitude',
      'Retailer ID',
      'SO Name',
      'SO Email',
      'SO Phone',
      'SO ID',
    ],
  ];

  retailers.forEach((store, index) => {
    const so = store.salesOfficerId ? soById.get(store.salesOfficerId) : undefined;
    excelData.push([
      index + 1,
      store.storeCode || '',
      store.shopName || store.displayName || '',
      store.ownerName || store.displayName || '',
      store.email || '',
      store.phoneNumber || '',
      store.address || store.location?.address || '',
      store.town || '',
      store.district || '',
      store.licenceNumber || '',
      store.aadharNumber || '',
      store.licenceHolderName || '',
      store.pan || '',
      store.gst || '',
      store.isActive !== false ? 'Active' : 'Inactive',
      store.location?.latitude ?? '',
      store.location?.longitude ?? '',
      store.id || '',
      so?.displayName || so?.email || '',
      so?.email || '',
      so?.phoneNumber || '',
      store.salesOfficerId || '',
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 30 },
    { wch: 22 },
    { wch: 28 },
    { wch: 14 },
    { wch: 40 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 14 },
    { wch: 16 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 28 },
    { wch: 22 },
    { wch: 28 },
    { wch: 14 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Retailers');

  const dateStr = istDateStampCompact();
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};

/**
 * Export SO-wise outstanding dues.
 * Pass one summary for a single SO, or multiple for all SOs.
 * Sheet 1: SO summary. Sheet 2: retailer / bill detail rows.
 */
export const exportSoReceivables = async (
  summaries: SoReceivableSummary[],
  filename: string = 'so-receivables'
) => {
  if (!summaries.length) {
    await appAlert('No SO dues found to export', { severity: 'warning' });
    return;
  }

  const summaryRows: (string | number)[][] = [
    [
      'SR',
      'SO Name',
      'SO Phone',
      'SO Email',
      'SO ID',
      'Stores with dues',
      'Open bills',
      'Total outstanding',
      'Oldest bill',
    ],
  ];

  summaries.forEach((so, index) => {
    summaryRows.push([
      index + 1,
      so.displayName,
      so.phoneNumber || '',
      so.email || '',
      so.salesOfficerId || 'Unassigned',
      so.retailerCount,
      so.orderCount,
      Number(so.totalOutstanding.toFixed(2)),
      so.oldestOrderDate ? so.oldestOrderDate.toISOString().slice(0, 10) : '',
    ]);
  });

  const detailRows: (string | number)[][] = [
    [
      'SR',
      'SO Name',
      'SO ID',
      'Store Code',
      'Shop Name',
      'Retailer ID',
      'Invoice / Order',
      'Order Date',
      'Payment Status',
      'Bill outstanding',
      'Store total outstanding',
    ],
  ];

  let sr = 1;
  for (const so of summaries) {
    for (const retailer of so.retailers) {
      for (const bill of retailer.orders) {
        detailRows.push([
          sr++,
          so.displayName,
          so.salesOfficerId || 'Unassigned',
          retailer.storeCode,
          retailer.displayName,
          retailer.retailerId,
          formatOrderInvoiceLabel(bill),
          bill.orderDate
            ? new Date(bill.orderDate).toISOString().slice(0, 10)
            : '',
          bill.paymentStatus || 'Unpaid',
          Number(bill.outstanding.toFixed(2)),
          Number(retailer.totalOutstanding.toFixed(2)),
        ]);
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 5 },
    { wch: 24 },
    { wch: 14 },
    { wch: 28 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 16 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'SO Summary');

  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  wsDetail['!cols'] = [
    { wch: 5 },
    { wch: 22 },
    { wch: 28 },
    { wch: 12 },
    { wch: 28 },
    { wch: 28 },
    { wch: 22 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Bill Detail');

  const dateStr = istDateStampCompact();
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
};
