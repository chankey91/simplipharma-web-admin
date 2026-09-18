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
