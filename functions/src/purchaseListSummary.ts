/**
 * Small facts for the purchase-list summary sheet.
 * The browser must not download every purchase invoice or medicine photo.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ff } from './functionRegion';
import { loadLiveStockOffers, rankDeals } from './liveStockRank';
import { getUserRole, isAdminOrOperationsRole, isPurchaseOfficerRole } from './panelAuth';

type BestRow = {
  medicineId: string;
  vendorName: string;
  discountPercentage: number;
  invoiceNumber?: string;
  invoiceDateMs: number;
};

type PastRow = {
  medicineId: string;
  vendors: Array<{ vendorName: string; discount: number }>;
};

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return 0;
  const n = parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function invoiceMs(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  const n = new Date(value as string | number).getTime();
  return Number.isFinite(n) ? n : 0;
}

function packagingOf(unit: unknown, description: unknown): string {
  const direct = String(unit || '').trim();
  if (direct) return direct;
  const match = String(description || '').match(/Packaging:\s*(.+)/i);
  return match?.[1]?.trim() || '—';
}

export const purchaseListSummaryFacts = ff
  .runWith({ minInstances: 0, timeoutSeconds: 120, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const role = await getUserRole(context.auth.uid);
    if (!isAdminOrOperationsRole(role) && !isPurchaseOfficerRole(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Not allowed to download this summary');
    }

    const requested: unknown[] = Array.isArray(data?.medicineIds) ? data.medicineIds : [];
    const medicineIds = [
      ...new Set(requested.map((id) => String(id || '').trim()).filter((id) => id.length > 0)),
    ].slice(0, 400);
    const wanted = new Set(medicineIds);
    const db = admin.firestore();

    const labels: Array<{ id: string; productId: string; packaging: string }> = [];
    for (let i = 0; i < medicineIds.length; i += 50) {
      const refs = medicineIds.slice(i, i + 50).map((id) => db.collection('medicines').doc(id));
      const snaps = await db.getAll(...refs, { fieldMask: ['productId', 'unit', 'description'] });
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const row = snap.data() || {};
        labels.push({
          id: snap.id,
          productId: String(row.productId || '').trim(),
          packaging: packagingOf(String(row.unit || ''), String(row.description || '')),
        });
      }
    }

    const best = new Map<string, BestRow>();
    type VendorPick = { vendorName: string; discount: number; invoiceMs: number };
    const past = new Map<string, Map<string, VendorPick>>();
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let q: FirebaseFirestore.Query = db
        .collection('purchaseInvoices')
        .orderBy(admin.firestore.FieldPath.documentId())
        .select('vendorName', 'invoiceDate', 'invoiceNumber', 'items')
        .limit(150);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const row = doc.data();
        const vendorName = String(row.vendorName || '').trim();
        if (!vendorName) continue;
        const when = invoiceMs(row.invoiceDate);
        const invoiceNumber = String(row.invoiceNumber || '').trim() || undefined;
        const items = Array.isArray(row.items) ? row.items : [];
        for (const item of items) {
          const medicineId = String(item?.medicineId || '').trim();
          if (!medicineId || !wanted.has(medicineId)) continue;
          const discount = asNumber(item.discountPercentage);
          const vendors = past.get(medicineId) || new Map<string, VendorPick>();
          const key = vendorName.toLowerCase();
          const existing = vendors.get(key);
          if (!existing || discount > existing.discount || (discount === existing.discount && when > existing.invoiceMs)) {
            vendors.set(key, { vendorName, discount, invoiceMs: when });
          }
          past.set(medicineId, vendors);
          if (!(discount > 0)) continue;
          const current = best.get(medicineId);
          if (
            !current ||
            discount > current.discountPercentage ||
            (discount === current.discountPercentage && when > current.invoiceDateMs)
          ) {
            best.set(medicineId, {
              medicineId,
              vendorName,
              discountPercentage: discount,
              invoiceNumber,
              invoiceDateMs: when,
            });
          }
        }
      }
      if (snap.size < 150) break;
      cursor = snap.docs[snap.docs.length - 1];
    }

    const requestedNames: unknown[] = Array.isArray(data?.names) ? data.names : [];
    const names = [
      ...new Set(requestedNames.map((name) => String(name || '').trim()).filter((name) => name.length > 0)),
    ].slice(0, 400);
    let live: Array<{
      name: string;
      vendors: Array<{ vendorName: string; discount: number; stockQty: number; discountKnown: boolean }>;
    }> | null = null;
    try {
      const offers = await loadLiveStockOffers(db);
      live = names.map((name) => ({
        name,
        vendors: rankDeals(name, 1, offers).map((deal) => {
          const rate = deal.rate;
          const effective = deal.effectiveRate;
          const known = rate != null && rate > 0 && effective != null && effective >= 0 && effective <= rate;
          const discount = known ? Math.round(((rate - effective) / rate) * 10000) / 100 : 0;
          return {
            vendorName: deal.vendorName,
            discount,
            stockQty: deal.stockQty,
            discountKnown: known,
          };
        }),
      }));
    } catch (error) {
      console.warn('purchaseListSummaryFacts: live stock lookup failed', error);
    }

    const pastRows: PastRow[] = [];
    for (const [medicineId, vendors] of past) {
      const ranked = [...vendors.values()]
        .sort((a, b) => b.discount - a.discount || b.invoiceMs - a.invoiceMs)
        .slice(0, 8)
        .map((row) => ({ vendorName: row.vendorName, discount: row.discount }));
      pastRows.push({ medicineId, vendors: ranked });
    }

    return { labels, best: [...best.values()], past: pastRows, live };
  });
