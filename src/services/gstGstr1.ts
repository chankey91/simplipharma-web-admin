import { loadGstPeriodBooks, gstDocDate, taxableFrom } from './gstPeriodBooks';
import { getGstPeriod } from './gstPeriods';
import { hasGstSnapshot } from '../utils/gstSnapshot';
import {
  attachGstr1Integrity,
  buildGstr1Payload,
  type Gstr1ExportResult,
  type Gstr1HsnPart,
  type Gstr1SourceDocument,
} from '../utils/gstr1Json';
import type { CreditNoteLine, OrderMedicine } from '../types';

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

export async function buildGstr1Export(
  date = new Date(),
  mode: 'original' | 'amendment' = 'original'
): Promise<Gstr1ExportResult> {
  const [books, period] = await Promise.all([loadGstPeriodBooks(date), getGstPeriod(date)]);
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
    });
  }

  for (const note of books.creditNotes) {
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
      originalInvoiceNumber: note.originalInvoiceNumber,
    });
  }

  for (const note of books.debitNotes) {
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
      originalInvoiceNumber: note.originalInvoiceNumber,
    });
  }

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
      issuedCreditNotes: books.creditNotes.map((n) => ({ number: n.creditNoteNumber })),
      issuedDebitNotes: books.debitNotes.map((n) => ({ number: n.debitNoteNumber })),
    })
  );
}

export { taxableFrom };
