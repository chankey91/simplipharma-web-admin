import * as XLSX from 'xlsx';
import { istDateStampCompact } from './dateTime';

export type VendorWiseReturnExportLine = {
  vendorName: string;
  medicineName: string;
  batchNumber: string;
  expiry: string;
  availableQuantity: number;
  quantity: number;
  purchasePrice: number;
  totalAmount: number;
  invoiceNumber?: string;
  matchLabel?: string;
};

/** One Excel sheet of the working return list, grouped by vendor. */
export function exportVendorWiseReturnList(
  lines: VendorWiseReturnExportLine[],
  filename = 'vendor-wise-return-list'
): void {
  const excelData: (string | number)[][] = [
    [
      'Vendor',
      'Medicine',
      'Batch',
      'Expiry',
      'On hand',
      'Return qty',
      'Rate',
      'Amount',
      'Purchase invoice',
      'Match',
    ],
  ];
  for (const line of lines) {
    excelData.push([
      line.vendorName,
      line.medicineName,
      line.batchNumber,
      line.expiry,
      line.availableQuantity,
      line.quantity,
      Number(line.purchasePrice.toFixed(2)),
      Number(line.totalAmount.toFixed(2)),
      line.invoiceNumber || '',
      line.matchLabel || '',
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 28 },
    { wch: 32 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 18 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'By vendor');
  XLSX.writeFile(wb, `${filename}-${istDateStampCompact()}.xlsx`);
}

export type PurchaseReturnSavedItemExportRow = {
  returnNumber: string;
  returnDate: string;
  vendorName: string;
  medicineName: string;
  batchNumber: string;
  expiry: string;
  quantity: number;
  purchasePrice: number;
  totalAmount: number;
  status: string;
};

/** Item list from saved purchase returns (all vendors, or a vendor filter). */
export function exportPurchaseReturnItemList(
  rows: PurchaseReturnSavedItemExportRow[],
  filename = 'purchase-return-items'
): void {
  const excelData: (string | number)[][] = [
    [
      'Return no.',
      'Date',
      'Vendor',
      'Medicine',
      'Batch',
      'Expiry',
      'Qty',
      'Rate',
      'Amount',
      'Return status',
    ],
  ];
  for (const row of rows) {
    excelData.push([
      row.returnNumber,
      row.returnDate,
      row.vendorName,
      row.medicineName,
      row.batchNumber,
      row.expiry,
      row.quantity,
      Number(row.purchasePrice.toFixed(2)),
      Number(row.totalAmount.toFixed(2)),
      row.status,
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 12 },
    { wch: 28 },
    { wch: 32 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Items');
  XLSX.writeFile(wb, `${filename}-${istDateStampCompact()}.xlsx`);
}
