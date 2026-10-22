import { loadGstPeriodBooks, gstDocDate, taxableFrom } from './gstPeriodBooks';
import { getGstPeriod } from './gstPeriods';
import { hasGstSnapshot } from '../utils/gstSnapshot';
import {
  attachGstr1Integrity,
  buildGstr1Payload,
  type Gstr1ExportResult,
  type Gstr1HsnPart,
  type Gstr1ProductLine,
  type Gstr1SourceDocument,
} from '../utils/gstr1Json';
import type { CreditNoteLine, OrderMedicine } from '../types';
import type { GstDocumentSnapshot, GstLineSnapshot } from '../types/gst';

function orderLineNet(item: OrderMedicine): number {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.price) || 0;
  const disc = Number(item.discountPercentage) || 0;
  return Math.max(0, qty * price * (1 - disc / 100));
}

function orderHsnParts(items: OrderMedicine[] | undefined): Gstr1HsnPart[] {
  return (items || []).map((item) => ({
    hsn: String(item.hsn || '').trim() || '300490',
    qty: Number(item.quantity) || 0,
    net: orderLineNet(item),
    gstRate: Number(item.gstRate) || undefined,
  }));
}

function noteHsnParts(items: CreditNoteLine[] | undefined): Gstr1HsnPart[] {
  return (items || []).map((item) => ({
    hsn: String(item.hsn || '').trim() || '300490',
    qty: Number(item.quantity) || 0,
    net: Math.max(0, Number(item.refundAmount) || 0),
    gstRate: Number(item.gstRate) || undefined,
  }));
}

function nameForLine(
  names: Array<{ name?: string; medicineName?: string; hsn?: string }>,
  line: { hsn?: string },
  index: number
): string {
  const byIndex = names[index];
  const indexed = String(byIndex?.name || byIndex?.medicineName || '').trim();
  if (indexed) return indexed;
  const hsn = String(line.hsn || '').replace(/\D/g, '');
  const byHsn = names.find((row) => String(row.hsn || '').replace(/\D/g, '') === hsn);
  return String(byHsn?.name || byHsn?.medicineName || '').trim() || '—';
}

function productLinesFromGst(
  gst: GstDocumentSnapshot,
  names: Array<{ name?: string; medicineName?: string; hsn?: string }>
): Gstr1ProductLine[] | undefined {
  const lines = gst.lines;
  if (!lines?.length) return undefined;
  return lines.map((line: GstLineSnapshot, index) => ({
    productName: nameForLine(names, line, index),
    hsn: String(line.hsn || '').trim() || '300490',
    qty: Number(line.qty) || 0,
    gstRate: line.gstRate,
    taxableValue: Number(line.taxableValue) || 0,
    taxAmount: Number(line.taxAmount) || 0,
  }));
}

function orderProductLines(
  items: OrderMedicine[] | undefined,
  gst: GstDocumentSnapshot
): Gstr1ProductLine[] {
  const fromGst = productLinesFromGst(gst, items || []);
  if (fromGst?.length) return fromGst;
  return (items || []).map((item) => {
    const taxable = orderLineNet(item);
    const gstRate = Number(item.gstRate) || 0;
    return {
      productName: String(item.name || '').trim() || '—',
      hsn: String(item.hsn || '').trim() || '300490',
      qty: Number(item.quantity) || 0,
      gstRate: gstRate || undefined,
      taxableValue: taxable,
      taxAmount: gstRate > 0 ? taxable * (gstRate / 100) : 0,
    };
  });
}

function noteProductLines(
  items: CreditNoteLine[] | undefined,
  gst: GstDocumentSnapshot
): Gstr1ProductLine[] {
  const fromGst = productLinesFromGst(
    gst,
    (items || []).map((item) => ({ medicineName: item.medicineName, hsn: item.hsn }))
  );
  if (fromGst?.length) return fromGst;
  return (items || []).map((item) => ({
    productName: String(item.medicineName || '').trim() || '—',
    hsn: String(item.hsn || '').trim() || '300490',
    qty: Number(item.quantity) || 0,
    gstRate: Number(item.gstRate) || undefined,
    taxableValue: Math.max(0, Number(item.refundAmount) || 0),
    taxAmount: 0,
  }));
}

export async function loadGstOutwardDocuments(date = new Date()) {
  const books = await loadGstPeriodBooks(date);
  const documents: Gstr1SourceDocument[] = [];
  let skippedNoSnapshot = 0;

  for (const order of books.orders) {
    if (!order.invoiceNumber || order.status === 'Pending' || order.status === 'Cancelled') continue;
    if (!hasGstSnapshot(order) || !order.gst) {
      skippedNoSnapshot += 1;
      continue;
    }
    documents.push({
      collection: 'orders',
      documentId: order.id,
      kind: 'invoice',
      number: order.invoiceNumber,
      date: gstDocDate(order.orderDate),
      totalAmount: order.totalAmount || 0,
      gst: order.gst,
      hsnParts: orderHsnParts(order.medicines),
      productLines: orderProductLines(order.medicines, order.gst),
    });
  }

  for (const note of books.creditNotes) {
    if (String(note.status || '').toLowerCase() === 'cancelled') continue;
    if (!hasGstSnapshot(note) || !note.gst) {
      skippedNoSnapshot += 1;
      continue;
    }
    documents.push({
      collection: 'credit_notes',
      documentId: note.id,
      kind: 'credit_note',
      number: note.creditNoteNumber,
      date: gstDocDate(note.creditNoteDate ?? note.createdAt),
      totalAmount: note.totalAmount || 0,
      gst: note.gst,
      hsnParts: noteHsnParts(note.items),
      productLines: noteProductLines(note.items, note.gst),
      originalInvoiceNumber: note.originalInvoiceNumber,
    });
  }

  for (const note of books.debitNotes) {
    if (String(note.status || '').toLowerCase() === 'cancelled') continue;
    if (!hasGstSnapshot(note) || !note.gst) {
      skippedNoSnapshot += 1;
      continue;
    }
    documents.push({
      collection: 'debit_notes',
      documentId: note.id,
      kind: 'debit_note',
      number: note.debitNoteNumber,
      date: gstDocDate(note.debitNoteDate ?? note.createdAt),
      totalAmount: note.totalAmount || 0,
      gst: note.gst,
      hsnParts: noteHsnParts(note.items),
      productLines: noteProductLines(note.items, note.gst),
      originalInvoiceNumber: note.originalInvoiceNumber,
    });
  }

  return { books, documents, skippedNoSnapshot };
}

export async function buildGstr1Export(
  date = new Date(),
  mode: 'original' | 'amendment' = 'original'
): Promise<Gstr1ExportResult> {
  const [{ books, documents, skippedNoSnapshot }, period] = await Promise.all([
    loadGstOutwardDocuments(date),
    getGstPeriod(date),
  ]);

  return attachGstr1Integrity(
    buildGstr1Payload({
      gstin: books.settings.gstin,
      filingFrequency: books.settings.filingFrequency,
      documents,
      skippedNoSnapshot,
      date,
      mode,
      previousFingerprints: mode === 'amendment' ? period.outwardFingerprints : undefined,
      issuedInvoices: books.orders
        .filter((o) => o.invoiceNumber && o.status !== 'Pending')
        .map((o) => ({ number: o.invoiceNumber as string, cancelled: o.status === 'Cancelled' })),
      issuedCreditNotes: books.creditNotes
        .filter((n) => String(n.status || '').toLowerCase() !== 'cancelled')
        .map((n) => ({ number: n.creditNoteNumber })),
      issuedDebitNotes: books.debitNotes
        .filter((n) => String(n.status || '').toLowerCase() !== 'cancelled')
        .map((n) => ({ number: n.debitNoteNumber })),
    })
  );
}

export { taxableFrom };
