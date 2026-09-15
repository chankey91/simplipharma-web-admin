import type { GstException } from '../types/gst';
import { getAllStores } from './stores';
import { getAllVendors } from './vendors';
import { loadGstPeriodBooks } from './gstPeriodBooks';
import { searchMedicinesCatalog } from './medicineSearch';
import { isValidGstinFormat, normalizeGstin } from '../utils/gstin';
import { hasGstSnapshot } from '../utils/gstSnapshot';

const MAX_DETAIL_ROWS = 40;

export interface GstHealthReport {
  storesMissingGstin: number;
  storesInvalidGstin: number;
  vendorsInvalidGstin: number;
  medicinesMissingHsn: number;
  invoicedThisPeriod: number;
  snapshotsThisPeriod: number;
  legacyInvoicesThisPeriod: number;
  legacyCreditNotesThisPeriod: number;
  legacyDebitNotesThisPeriod: number;
  legacyPurchaseInvoicesThisPeriod: number;
  exceptions: GstException[];
}

async function countMedicinesMissingHsn(): Promise<number> {
  try {
    const [all, withCode] = await Promise.all([
      searchMedicinesCatalog('', { browse: true, hydrate: false, limit: 1, page: 1 }),
      searchMedicinesCatalog('', {
        browse: true,
        hydrate: false,
        limit: 1,
        page: 1,
        hsnFilter: 'present',
      }),
    ]);
    if (all.source === 'error' || withCode.source === 'error') return 0;
    if (withCode.found >= all.found) return 0;
    return Math.max(0, all.found - withCode.found);
  } catch {
    return 0;
  }
}

export async function loadGstHealthReport(date = new Date()): Promise<GstHealthReport> {
  const [stores, vendors, books, medicinesMissingHsn] = await Promise.all([
    getAllStores(),
    getAllVendors(),
    loadGstPeriodBooks(date),
    countMedicinesMissingHsn(),
  ]);

  const exceptions: GstException[] = [];
  let storesMissingGstin = 0;
  let storesInvalidGstin = 0;
  let vendorsInvalidGstin = 0;
  let detailRows = 0;

  const invoiced = books.orders.filter(
    (o) => o.invoiceNumber && o.status !== 'Pending' && o.status !== 'Cancelled'
  );
  let snapshotsThisPeriod = 0;
  let legacyInvoicesThisPeriod = 0;
  for (const order of invoiced) {
    if (hasGstSnapshot(order)) snapshotsThisPeriod += 1;
    else legacyInvoicesThisPeriod += 1;
  }
  const legacyCreditNotesThisPeriod = books.creditNotes.filter((n) => !hasGstSnapshot(n)).length;
  const legacyDebitNotesThisPeriod = books.debitNotes.filter((n) => !hasGstSnapshot(n)).length;
  const legacyPurchaseInvoicesThisPeriod = books.purchases.filter((p) => !hasGstSnapshot(p)).length;
  const legacyTotal =
    legacyInvoicesThisPeriod +
    legacyCreditNotesThisPeriod +
    legacyDebitNotesThisPeriod +
    legacyPurchaseInvoicesThisPeriod;

  if (legacyTotal > 0) {
    exceptions.push({
      id: 'legacy-invoices-period',
      severity: 'info',
      kind: 'legacy_invoice',
      documentType: 'order',
      documentId: 'period',
      message: `${legacyInvoicesThisPeriod} sales invoice(s), ${legacyCreditNotesThisPeriod} credit note(s), ${legacyDebitNotesThisPeriod} debit note(s), ${legacyPurchaseInvoicesThisPeriod} purchase invoice(s) this month have no GST snapshot. Amounts will not change.`,
      actionLabel: 'Preview & backfill',
      actionKind: 'backfill',
    });
  }

  if (medicinesMissingHsn > 0) {
    exceptions.push({
      id: 'medicines-missing-hsn',
      severity: 'warning',
      kind: 'medicine_missing_hsn',
      documentType: 'medicine',
      documentId: 'catalog',
      message: `${medicinesMissingHsn} medicine(s) have no HSN (code). New invoice lines will fall back to 300490`,
      actionLabel: 'Open inventory',
      actionPath: '/inventory',
      actionKind: 'navigate',
    });
  }

  for (const store of stores) {
    if (store.isActive === false) continue;
    const gstin = normalizeGstin(store.gst);
    if (!gstin) {
      storesMissingGstin += 1;
      if (detailRows < MAX_DETAIL_ROWS) {
        detailRows += 1;
        exceptions.push({
          id: `store-missing-${store.id}`,
          severity: 'warning',
          kind: 'store_missing_gstin',
          documentType: 'store',
          documentId: store.id,
          documentNumber: store.storeCode,
          message: `${store.shopName || store.displayName || store.email || store.id} has no GSTIN — new invoices will classify as B2C`,
          actionLabel: 'Fix GSTIN',
          actionKind: 'editGstin',
        });
      }
      continue;
    }
    if (!isValidGstinFormat(gstin)) {
      storesInvalidGstin += 1;
      if (detailRows < MAX_DETAIL_ROWS) {
        detailRows += 1;
        exceptions.push({
          id: `store-invalid-${store.id}`,
          severity: 'error',
          kind: 'store_invalid_gstin',
          documentType: 'store',
          documentId: store.id,
          documentNumber: store.storeCode,
          message: `${store.shopName || store.displayName || store.id} GSTIN "${store.gst}" is not a valid 15-character GSTIN`,
          actionLabel: 'Fix GSTIN',
          actionKind: 'editGstin',
        });
      }
    }
  }

  for (const vendor of vendors) {
    if (vendor.isActive === false) continue;
    if (!isValidGstinFormat(vendor.gstNumber)) {
      vendorsInvalidGstin += 1;
      if (detailRows < MAX_DETAIL_ROWS) {
        detailRows += 1;
        exceptions.push({
          id: `vendor-invalid-${vendor.id}`,
          severity: 'error',
          kind: 'vendor_invalid_gstin',
          documentType: 'vendor',
          documentId: vendor.id,
          message: `${vendor.vendorName} GSTIN "${vendor.gstNumber || '—'}" is not a valid 15-character GSTIN`,
          actionLabel: 'Fix GSTIN',
          actionKind: 'editGstin',
        });
      }
    }
  }

  return {
    storesMissingGstin,
    storesInvalidGstin,
    vendorsInvalidGstin,
    medicinesMissingHsn,
    invoicedThisPeriod: invoiced.length,
    snapshotsThisPeriod,
    legacyInvoicesThisPeriod,
    legacyCreditNotesThisPeriod,
    legacyDebitNotesThisPeriod,
    legacyPurchaseInvoicesThisPeriod,
    exceptions,
  };
}
