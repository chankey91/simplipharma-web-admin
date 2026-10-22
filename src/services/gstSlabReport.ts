import { gstFilingGrain, gstinFilingPeriod, indianGstPeriod } from '../utils/gstPeriod';
import { buildGstSlabRows, totalGstSlabRow, type GstSlabReport } from '../utils/gstSlabReport';
import { loadGstOutwardDocuments } from './gstGstr1';

export async function buildGstSlabReport(date = new Date()): Promise<GstSlabReport> {
  const { books, documents, skippedNoSnapshot } = await loadGstOutwardDocuments(date);
  const grain = gstFilingGrain(books.settings.filingFrequency);
  const rows = buildGstSlabRows(documents);
  const invoiceCount = documents.filter((doc) => doc.kind === 'invoice').length;
  const totals = totalGstSlabRow(rows);
  totals.invoices = invoiceCount;
  totals.creditNotes = documents.filter((doc) => doc.kind === 'credit_note').length;
  totals.debitNotes = documents.filter((doc) => doc.kind === 'debit_note').length;
  return {
    periodLabel: indianGstPeriod(date, grain).label,
    fp: gstinFilingPeriod(date, grain),
    gstin: books.settings.gstin,
    skippedNoSnapshot,
    documentCount: documents.length,
    invoiceCount,
    rows,
    totals,
  };
}
