import * as XLSX from 'xlsx';

export type PurchaseOrderExcelLine = {
  vendorName: string;
  productId: string;
  itemName: string;
  quantity: number;
};

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function headerKey(value: unknown): string {
  return cellText(value).toLowerCase().replace(/[_./]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const PRODUCT_HEADERS = new Set([
  'product id',
  'productid',
  'product code',
  'item code',
]);
const VENDOR_HEADERS = new Set(['vendor', 'vendor name', 'supplier', 'supplier name']);
const NAME_HEADERS = new Set([
  'item',
  'item name',
  'medicine',
  'medicine name',
  'product',
  'product name',
  'description',
]);
const QTY_HEADERS = new Set(['quantity', 'qty', 'order qty', 'ordered qty', 'order quantity']);

function parseQty(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = parseFloat(cellText(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Read a vendor-order sheet. One row is vendor, product id, item name, and quantity. */
export function parsePurchaseOrderExcel(data: ArrayBuffer): PurchaseOrderExcelLine[] {
  const book = XLSX.read(data, { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
  });

  let headerIndex = -1;
  let productCol = -1;
  let vendorCol = -1;
  let nameCol = -1;
  let qtyCol = -1;
  const scan = Math.min(rows.length, 20);
  for (let i = 0; i < scan; i += 1) {
    const row = rows[i] || [];
    let p = -1;
    let v = -1;
    let n = -1;
    let q = -1;
    row.forEach((cell, col) => {
      const key = headerKey(cell);
      if (PRODUCT_HEADERS.has(key)) p = col;
      else if (VENDOR_HEADERS.has(key)) v = col;
      else if (NAME_HEADERS.has(key)) n = col;
      else if (QTY_HEADERS.has(key)) q = col;
    });
    if (p >= 0 && q >= 0) {
      headerIndex = i;
      productCol = p;
      vendorCol = v;
      nameCol = n;
      qtyCol = q;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new Error('The sheet needs Product ID and Quantity columns.');
  }

  const lines: PurchaseOrderExcelLine[] = [];
  let lastVendor = '';
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const productId = cellText(row[productCol]);
    const itemName = nameCol >= 0 ? cellText(row[nameCol]) : '';
    const quantity = parseQty(row[qtyCol]);
    const vendorName = vendorCol >= 0 ? cellText(row[vendorCol]) : '';
    if (vendorName) lastVendor = vendorName;
    if (!productId && !itemName && quantity <= 0) continue;
    lines.push({
      vendorName: vendorName || lastVendor,
      productId,
      itemName,
      quantity,
    });
  }
  return lines;
}
