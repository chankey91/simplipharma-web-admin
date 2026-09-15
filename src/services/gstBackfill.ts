import { doc, updateDoc, deleteField, writeBatch, db } from './firebase';
import { getOrdersInRange } from './orders';
import { getCreditNotesInRange } from './creditNotes';
import { getDebitNotesInRange } from './debitNotes';
import { getPurchaseInvoicesInRange } from './purchaseInvoices';
import { getAllVendors } from './vendors';
import { getAllStores } from './stores';
import { getCompanyGstSettings } from './gstSettings';
import { assertPeriodOpenForWrite } from './gstPeriods';
import { invalidateGstPeriodBooksCache } from './gstPeriodBooks';
import { gstPeriodBounds, indianGstPeriod } from '../utils/gstPeriod';
import { hasGstSnapshot, buildFaithfulOutwardSnapshot, buildFaithfulInwardSnapshot } from '../utils/gstSnapshot';
import { gstinStateCode, isValidGstinFormat, normalizeGstin } from '../utils/gstin';
import { stripUndefinedDeep } from '../utils/firestorePayload';
import type { GstDocumentSnapshot, GstInvoiceType } from '../types/gst';
import type { Order, CreditNote, DebitNote } from '../types';

export interface GstBackfillSample {
  collection: string;
  documentId: string;
  number: string;
  party: string;
  invoiceType: GstInvoiceType | string;
  taxAmount: number;
  cgst: number;
  sgst: number;
}

export interface GstBackfillPreview {
  periodLabel: string;
  startMs: number;
  endMsExclusive: number;
  orders: number;
  creditNotes: number;
  debitNotes: number;
  purchaseInvoices: number;
  total: number;
  samples: GstBackfillSample[];
}

function taxableFrom(doc: { subTotal?: number; totalDiscount?: number; discount?: number }): number {
  return Math.max(0, (Number(doc.subTotal) || 0) - (Number(doc.totalDiscount ?? doc.discount) || 0));
}

async function loadLegacyDocuments(date = new Date()) {
  const { startMs, endMsExclusive } = gstPeriodBounds(date);
  const [orders, creditNotes, debitNotes, purchases, vendors, stores, settings] = await Promise.all([
    getOrdersInRange(startMs, endMsExclusive),
    getCreditNotesInRange(startMs, endMsExclusive),
    getDebitNotesInRange(startMs, endMsExclusive),
    getPurchaseInvoicesInRange(startMs, endMsExclusive),
    getAllVendors(),
    getAllStores(),
    getCompanyGstSettings(),
  ]);

  const legacyOrders = orders.filter(
    (o) =>
      o.invoiceNumber &&
      o.status !== 'Pending' &&
      o.status !== 'Cancelled' &&
      !hasGstSnapshot(o)
  );
  const legacyCreditNotes = creditNotes.filter((n) => !hasGstSnapshot(n));
  const legacyDebitNotes = debitNotes.filter((n) => !hasGstSnapshot(n));
  const legacyPurchases = purchases.filter((p) => !hasGstSnapshot(p));
  const vendorGstin = new Map(vendors.map((v) => [v.id, v.gstNumber]));
  const storeById = new Map(
    stores.map((s) => [
      s.id,
      { gst: s.gst, name: s.shopName || s.displayName || s.email },
    ])
  );

  return {
    startMs,
    endMsExclusive,
    settings,
    legacyOrders,
    legacyCreditNotes,
    legacyDebitNotes,
    legacyPurchases,
    vendorGstin,
    storeById,
  };
}

function sampleFromSnapshot(
  collection: string,
  documentId: string,
  number: string,
  party: string,
  gst: GstDocumentSnapshot,
  taxAmount: number
): GstBackfillSample {
  return {
    collection,
    documentId,
    number,
    party,
    invoiceType: gst.invoiceType,
    taxAmount,
    cgst: gst.cgst,
    sgst: gst.sgst,
  };
}

export async function previewGstBackfill(date = new Date()): Promise<GstBackfillPreview> {
  const loaded = await loadLegacyDocuments(date);
  const retailerCache = loaded.storeById;
  const samples: GstBackfillSample[] = [];

  const retailerFields = (retailerId?: string, fallbackName?: string) => {
    if (!retailerId) return { gst: undefined as string | undefined, name: fallbackName };
    const cached = retailerCache.get(retailerId);
    return { gst: cached?.gst, name: cached?.name || fallbackName };
  };

  for (const order of loaded.legacyOrders.slice(0, 12)) {
    const retailer = retailerFields(order.retailerId, order.retailerName);
    const gst = buildFaithfulOutwardSnapshot({
      settings: loaded.settings,
      taxAmount: order.taxAmount || 0,
      taxableValue: taxableFrom(order),
      totalAmount: order.totalAmount || 0,
      buyerGstin: retailer.gst,
      buyerLegalName: retailer.name,
      documentKind: 'invoice',
    });
    samples.push(
      sampleFromSnapshot(
        'orders',
        order.id,
        order.invoiceNumber || order.id,
        retailer.name || '—',
        gst,
        order.taxAmount || 0
      )
    );
  }

  return {
    periodLabel: indianGstPeriod(date).label,
    startMs: loaded.startMs,
    endMsExclusive: loaded.endMsExclusive,
    orders: loaded.legacyOrders.length,
    creditNotes: loaded.legacyCreditNotes.length,
    debitNotes: loaded.legacyDebitNotes.length,
    purchaseInvoices: loaded.legacyPurchases.length,
    total:
      loaded.legacyOrders.length +
      loaded.legacyCreditNotes.length +
      loaded.legacyDebitNotes.length +
      loaded.legacyPurchases.length,
    samples,
  };
}

async function writeGstBatch(
  rows: Array<{ collection: string; id: string; gst: GstDocumentSnapshot }>
): Promise<{ updated: number; failed: number; firstError?: string }> {
  let updated = 0;
  let failed = 0;
  let firstError: string | undefined;
  const CHUNK = 400;

  const writeOne = async (row: { collection: string; id: string; gst: GstDocumentSnapshot }) => {
    try {
      await updateDoc(doc(db, row.collection, row.id), { gst: stripUndefinedDeep(row.gst) });
      updated += 1;
    } catch (err) {
      failed += 1;
      if (!firstError) {
        firstError = `${row.collection}/${row.id}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  };

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    try {
      const batch = writeBatch(db);
      for (const row of slice) {
        batch.update(doc(db, row.collection, row.id), { gst: stripUndefinedDeep(row.gst) });
      }
      await batch.commit();
      updated += slice.length;
    } catch {
      for (const row of slice) {
        await writeOne(row);
      }
    }
  }
  return { updated, failed, firstError };
}

export async function applyGstBackfill(
  date = new Date()
): Promise<{ updated: number; skipped: number; failed: number; firstError?: string }> {
  await assertPeriodOpenForWrite(date);
  const loaded = await loadLegacyDocuments(date);
  const retailerCache = loaded.storeById;
  let skipped = 0;

  const retailerFields = (retailerId?: string, fallbackName?: string) => {
    if (!retailerId) return { gst: undefined as string | undefined, name: fallbackName };
    const cached = retailerCache.get(retailerId);
    return { gst: cached?.gst, name: cached?.name || fallbackName };
  };

  const writes: Array<{ collection: string; id: string; gst: GstDocumentSnapshot }> = [];

  const queueOutward = (
    collectionName: string,
    docs: Array<Order | CreditNote | DebitNote>,
    kind: 'invoice' | 'credit_note' | 'debit_note'
  ) => {
    for (const row of docs) {
      if (hasGstSnapshot(row)) {
        skipped += 1;
        continue;
      }
      const retailerId = 'retailerId' in row ? row.retailerId : undefined;
      const fallbackName = 'retailerName' in row ? row.retailerName : undefined;
      const retailer = retailerFields(retailerId, fallbackName);
      writes.push({
        collection: collectionName,
        id: row.id,
        gst: buildFaithfulOutwardSnapshot({
          settings: loaded.settings,
          taxAmount: row.taxAmount || 0,
          taxableValue: taxableFrom(row),
          totalAmount: row.totalAmount || 0,
          buyerGstin: ('retailerGstin' in row ? row.retailerGstin : undefined) || retailer.gst,
          buyerLegalName: retailer.name,
          documentKind: kind,
        }),
      });
    }
  };

  queueOutward('orders', loaded.legacyOrders, 'invoice');
  queueOutward('credit_notes', loaded.legacyCreditNotes, 'credit_note');
  queueOutward('debit_notes', loaded.legacyDebitNotes, 'debit_note');

  for (const invoice of loaded.legacyPurchases) {
    if (hasGstSnapshot(invoice)) {
      skipped += 1;
      continue;
    }
    writes.push({
      collection: 'purchaseInvoices',
      id: invoice.id,
      gst: buildFaithfulInwardSnapshot({
        settings: loaded.settings,
        taxAmount: invoice.taxAmount || 0,
        taxableValue: taxableFrom(invoice),
        vendorGstin: invoice.vendorGstin || loaded.vendorGstin.get(invoice.vendorId),
        vendorName: invoice.vendorName,
      }),
    });
  }

  const result = await writeGstBatch(writes);
  invalidateGstPeriodBooksCache(date);
  return { updated: result.updated, skipped, failed: result.failed, firstError: result.firstError };
}

export async function patchPartyGstin(input: {
  documentType: 'store' | 'vendor';
  documentId: string;
  gstin: string;
}): Promise<void> {
  const gstin = normalizeGstin(input.gstin);
  if (input.documentType === 'vendor') {
    if (!isValidGstinFormat(gstin)) {
      throw new Error('Enter a valid 15-character vendor GSTIN');
    }
    await updateDoc(doc(db, 'vendors', input.documentId), {
      gstNumber: gstin,
      gstinStateCode: gstinStateCode(gstin) || deleteField(),
    });
    return;
  }
  if (gstin && !isValidGstinFormat(gstin)) {
    throw new Error('GSTIN must be a valid 15-character Indian GSTIN, or left blank');
  }
  await updateDoc(doc(db, 'users', input.documentId), {
    gst: gstin || deleteField(),
    gstinStateCode: gstin && gstinStateCode(gstin) ? gstinStateCode(gstin) : deleteField(),
  });
}
