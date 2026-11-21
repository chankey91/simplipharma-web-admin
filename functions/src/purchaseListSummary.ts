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

type SummaryRow = {
  medicineId: string;
  medicineName: string;
  orderIds: string[];
  productDemandIds: string[];
};

type DemandLite = {
  id: string;
  productName: string;
  fulfilledName: string;
  fulfilledMedicineId: string;
  orderId: string;
  hasImage: boolean;
};

type OrderLineLink = {
  orderId: string;
  demandId: string;
  medicineId: string;
  name: string;
};

function looseProductName(a: string, b: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < 6 || !longer.startsWith(shorter)) return false;
  return longer.length === shorter.length || longer[shorter.length] === ' ';
}

function parseSummaryRows(data: { rows?: unknown }): SummaryRow[] {
  const raw: unknown[] = Array.isArray(data?.rows) ? data.rows : [];
  const rows: SummaryRow[] = [];
  for (const entry of raw.slice(0, 400)) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const medicineId = String(rec.medicineId || '').trim();
    const medicineName = String(rec.medicineName || '').trim();
    if (!medicineId && !medicineName) continue;
    const asIds = (value: unknown, max: number) =>
      [
        ...new Set(
          (Array.isArray(value) ? value : [])
            .map((id) => String(id || '').trim())
            .filter((id) => id.length > 0)
        ),
      ].slice(0, max);
    rows.push({
      medicineId,
      medicineName,
      orderIds: asIds(rec.orderIds, 30),
      productDemandIds: asIds(rec.productDemandIds, 10),
    });
  }
  return rows;
}

function rememberDemand(
  into: Map<string, DemandLite>,
  id: string,
  data: FirebaseFirestore.DocumentData | undefined
): void {
  if (!id || into.has(id)) return;
  const row = data || {};
  const image = row.imageUrl;
  into.set(id, {
    id,
    productName: String(row.productName || '').trim(),
    fulfilledName: String(row.fulfilledMedicineName || '').trim(),
    fulfilledMedicineId: String(row.fulfilledMedicineId || '').trim(),
    orderId: String(row.orderId || '').trim(),
    hasImage: typeof image === 'string' && image.trim().length > 20,
  });
}

/** Which product-demand document holds the retailer photo for each summary row. */
async function linkDemandPhotos(
  db: FirebaseFirestore.Firestore,
  rows: SummaryRow[]
): Promise<Array<{ medicineId: string; medicineName: string; demandId: string }>> {
  if (rows.length === 0) return [];
  const demands = new Map<string, DemandLite>();
  const orderIds = [...new Set(rows.flatMap((row) => row.orderIds))].slice(0, 200);
  const medicineIds = [...new Set(rows.map((row) => row.medicineId).filter(Boolean))].slice(0, 400);
  const explicitIds = [...new Set(rows.flatMap((row) => row.productDemandIds))].slice(0, 400);

  const queryField = async (field: string, values: string[]) => {
    for (let i = 0; i < values.length; i += 10) {
      const chunk = values.slice(i, i + 10);
      if (chunk.length === 0) continue;
      const snap = await db
        .collection('product_demands')
        .where(field, 'in', chunk)
        .select('productName', 'fulfilledMedicineName', 'fulfilledMedicineId', 'orderId', 'imageUrl')
        .get();
      snap.docs.forEach((docSnap) => rememberDemand(demands, docSnap.id, docSnap.data()));
    }
  };

  await Promise.all([
    queryField('orderId', orderIds),
    queryField('fulfilledMedicineId', medicineIds),
  ]);

  const lineLinks: OrderLineLink[] = [];
  for (let i = 0; i < orderIds.length; i += 20) {
    const refs = orderIds.slice(i, i + 20).map((id) => db.collection('orders').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const medicines = snap.get('medicines');
      if (!Array.isArray(medicines)) continue;
      for (const line of medicines) {
        const demandId = String(line?.productDemandId || '').trim();
        if (!demandId) continue;
        lineLinks.push({
          orderId: snap.id,
          demandId,
          medicineId: String(line?.medicineId || '').trim(),
          name: String(line?.name || '').trim(),
        });
        explicitIds.push(demandId);
      }
    }
  }

  const missingIds = [...new Set(explicitIds)].filter((id) => !demands.has(id)).slice(0, 400);
  for (let i = 0; i < missingIds.length; i += 50) {
    const refs = missingIds.slice(i, i + 50).map((id) => db.collection('product_demands').doc(id));
    const snaps = await db.getAll(...refs, {
      fieldMask: ['productName', 'fulfilledMedicineName', 'fulfilledMedicineId', 'orderId', 'imageUrl'],
    });
    snaps.forEach((snap) => {
      if (snap.exists) rememberDemand(demands, snap.id, snap.data());
    });
  }

  const withImage = [...demands.values()].filter((demand) => demand.hasImage);
  const links: Array<{ medicineId: string; medicineName: string; demandId: string }> = [];
  for (const row of rows) {
    const orders = new Set(row.orderIds);
    const chosen =
      withImage.find((demand) => row.productDemandIds.includes(demand.id)) ||
      withImage.find((demand) => row.medicineId && demand.fulfilledMedicineId === row.medicineId) ||
      lineLinks
        .map((link) => withImage.find((demand) => demand.id === link.demandId))
        .find((demand, index) => {
          if (!demand) return false;
          const link = lineLinks[index];
          if (row.medicineId && link.medicineId && row.medicineId === link.medicineId) return true;
          if (orders.size > 0 && !orders.has(link.orderId)) return false;
          return looseProductName(row.medicineName, link.name) || looseProductName(row.medicineName, demand.productName);
        }) ||
      withImage.find((demand) => {
        if (demand.orderId && orders.size > 0 && !orders.has(demand.orderId)) return false;
        if (!demand.orderId && orders.size > 0) return false;
        return (
          looseProductName(row.medicineName, demand.productName) ||
          looseProductName(row.medicineName, demand.fulfilledName)
        );
      });
    if (!chosen) continue;
    links.push({ medicineId: row.medicineId, medicineName: row.medicineName, demandId: chosen.id });
  }
  return links;
}

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

    const photoLinksPromise = linkDemandPhotos(db, parseSummaryRows(data)).catch((error) => {
      console.warn('purchaseListSummaryFacts: product photo lookup failed', error);
      return [] as Array<{ medicineId: string; medicineName: string; demandId: string }>;
    });

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

    const photoLinks = await photoLinksPromise;
    return { labels, best: [...best.values()], past: pastRows, live, photoLinks };
  });
