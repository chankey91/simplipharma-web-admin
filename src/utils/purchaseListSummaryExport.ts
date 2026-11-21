import ExcelJS from 'exceljs';
import { httpsCallable } from 'firebase/functions';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db, functions } from '../services/firebase';
import { getAllPurchaseInvoices } from '../services/purchaseInvoices';
import { rankLiveStockForNames } from '../services/liveStock';
import type { PurchaseList, PurchaseListItem } from '../services/purchaseLists';
import { istDateStampCompact } from './dateTime';
import { appAlert } from './appDialog';
import { offerDiscountPercent } from './liveStockDeals';
import {
  buildBestDiscountVendorByMedicineId,
  buildRankedPurchaseVendorsByMedicineId,
  suggestVendors,
  formatBestDiscountVendorLabel,
  type BestDiscountVendorPurchase,
  type VendorSuggestion,
} from './vendorLastPurchase';

function packagingOf(med?: { unit?: string; description?: string } | null): string {
  let packaging = med?.unit?.trim();
  if (!packaging && med?.description) {
    const match = med.description.match(/Packaging:\s*(.+)/i);
    if (match?.[1]) packaging = match[1].trim();
  }
  return packaging || '—';
}

type MedicineLabel = { productId: string; packaging: string; imageUrl?: string };

/** Product id, pack size, and a catalog photo when the demand photo was saved on the medicine. */
async function loadMedicineLabels(medicineIds: string[]): Promise<Map<string, MedicineLabel>> {
  const medicineById = new Map<string, MedicineLabel>();
  const unique = [...new Set(medicineIds.filter(Boolean))];
  try {
    for (let i = 0; i < unique.length; i += 30) {
      const chunk = unique.slice(i, i + 30);
      const snap = await getDocs(query(collection(db, 'medicines'), where(documentId(), 'in', chunk)));
      for (const item of snap.docs) {
        const data = item.data() as {
          productId?: string;
          unit?: string;
          description?: string;
          imageUrl?: string;
        };
        const imageUrl = data.imageUrl?.trim();
        medicineById.set(item.id, {
          productId: data.productId?.trim() || '',
          packaging: packagingOf(data),
          ...(imageUrl ? { imageUrl } : {}),
        });
      }
    }
  } catch (error) {
    console.warn('purchase list summary: medicine lookup failed', error);
  }
  return medicineById;
}

function chunksOf(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

type DemandHit = {
  id: string;
  imageUrl: string;
  productName: string;
  fulfilledName: string;
  fulfilledMedicineId: string;
  orderId: string;
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

function imageFromDemand(data: Record<string, unknown>): string {
  const raw = data.imageUrl ?? data.image ?? data.photoUrl;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && 'url' in raw) {
    return String((raw as { url?: unknown }).url || '').trim();
  }
  return '';
}

async function demandImagesById(ids: string[]): Promise<Map<string, DemandHit>> {
  const hits = new Map<string, DemandHit>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (const chunk of chunksOf(unique, 10)) {
    try {
      const snap = await getDocs(
        query(collection(db, 'product_demands'), where(documentId(), 'in', chunk))
      );
      for (const item of snap.docs) {
        const data = item.data() as Record<string, unknown>;
        const imageUrl = imageFromDemand(data);
        if (!imageUrl) continue;
        hits.set(item.id, {
          id: item.id,
          imageUrl,
          productName: String(data.productName || ''),
          fulfilledName: String(data.fulfilledMedicineName || ''),
          fulfilledMedicineId: String(data.fulfilledMedicineId || ''),
          orderId: String(data.orderId || ''),
        });
      }
    } catch (error) {
      console.warn('purchase list summary: product photo lookup failed', error);
    }
  }
  return hits;
}

function assignPhoto(photos: Map<string, string>, item: PurchaseListItem, imageUrl: string) {
  if (item.medicineId) photos.set(item.medicineId, imageUrl);
  const name = item.medicineName.trim().toLowerCase();
  if (name) photos.set(`name:${name}`, imageUrl);
}

/** Demand photos for this list. Order documents are not downloaded here. */
async function loadDemandPhotos(
  items: PurchaseListItem[],
  photoLinks: SummaryFacts['photoLinks']
): Promise<Map<string, string>> {
  const photos = new Map<string, string>();
  if (Array.isArray(photoLinks)) {
    const hits = await demandImagesById(photoLinks.map((link) => link.demandId));
    for (const link of photoLinks) {
      const hit = hits.get(link.demandId);
      if (!hit) continue;
      const item = items.find(
        (row) =>
          (link.medicineId && row.medicineId === link.medicineId) ||
          row.medicineName.trim().toLowerCase() === link.medicineName.trim().toLowerCase()
      );
      if (item) assignPhoto(photos, item, hit.imageUrl);
    }
    if (photos.size > 0) return photos;
  }
  return loadDemandPhotosLocally(items);
}

async function loadDemandPhotosLocally(items: PurchaseListItem[]): Promise<Map<string, string>> {
  const photos = new Map<string, string>();
  const demands: DemandHit[] = [];
  const seen = new Set<string>();
  const take = (id: string, data: Record<string, unknown>) => {
    if (seen.has(id)) return;
    const imageUrl = imageFromDemand(data);
    if (!imageUrl) return;
    seen.add(id);
    demands.push({
      id,
      imageUrl,
      productName: String(data.productName || ''),
      fulfilledName: String(data.fulfilledMedicineName || ''),
      fulfilledMedicineId: String(data.fulfilledMedicineId || ''),
      orderId: String(data.orderId || ''),
    });
  };

  const orderIds = [...new Set(items.flatMap((item) => item.orderIds || []).filter(Boolean))];
  const medicineIds = [...new Set(items.map((item) => item.medicineId).filter(Boolean))];
  const demandIds = [...new Set(items.flatMap((item) => item.productDemandIds || []).filter(Boolean))];
  const jobs = [
    ...chunksOf(orderIds, 10).map((chunk) => ({ field: 'orderId', chunk })),
    ...chunksOf(medicineIds, 10).map((chunk) => ({ field: 'fulfilledMedicineId', chunk })),
    ...chunksOf(demandIds, 10).map((chunk) => ({ field: documentId(), chunk })),
  ];
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      try {
        const snap = await getDocs(
          query(collection(db, 'product_demands'), where(job.field, 'in', job.chunk))
        );
        snap.docs.forEach((item) => take(item.id, item.data() as Record<string, unknown>));
      } catch (error) {
        console.warn('purchase list summary: product photo lookup failed', error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, () => worker()));

  for (const item of items) {
    const orders = new Set(item.orderIds || []);
    const chosen = demands.find((demand) => {
      if (item.productDemandIds?.includes(demand.id)) return true;
      if (item.medicineId && demand.fulfilledMedicineId === item.medicineId) return true;
      if (demand.orderId && orders.size > 0 && !orders.has(demand.orderId)) return false;
      if (!demand.orderId && orders.size > 0 && !item.productDemandIds?.includes(demand.id)) return false;
      return (
        looseProductName(item.medicineName, demand.productName) ||
        looseProductName(item.medicineName, demand.fulfilledName)
      );
    });
    if (chosen) assignPhoto(photos, item, chosen.imageUrl);
  }
  return photos;
}

function photoFor(
  item: PurchaseListItem,
  photos: Map<string, string>,
  medicine?: MedicineLabel
): string | undefined {
  if (item.medicineId && photos.get(item.medicineId)) return photos.get(item.medicineId);
  const byName = photos.get(`name:${item.medicineName.trim().toLowerCase()}`);
  return byName || medicine?.imageUrl;
}

/** Shrink a retailer photo so the workbook stays small enough to send to a vendor. */
async function jpegThumbnail(src: string): Promise<{ base64: string; extension: 'jpeg' | 'png' } | null> {
  const raw = src.trim();
  if (!raw) return null;
  let url = raw;
  if (!url.startsWith('data:') && !/^https?:/i.test(url)) {
    url = `data:image/jpeg;base64,${url}`;
  }
  if (/^https?:/i.test(url)) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const blob = await response.blob();
        url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('photo'));
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // The image element can still decode a URL the bucket allows.
    }
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('photo'));
      if (!url.startsWith('data:')) el.crossOrigin = 'anonymous';
      el.src = url;
    });
    const max = 96;
    const scale = Math.min(max / img.width, max / img.height, 1);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return embeddedOriginal(url);
    ctx.drawImage(img, 0, 0, width, height);
    const encoded = canvas.toDataURL('image/jpeg', 0.72);
    const comma = encoded.indexOf(',');
    return comma >= 0 ? { base64: encoded.slice(comma + 1), extension: 'jpeg' } : null;
  } catch {
    return embeddedOriginal(url);
  }
}

function embeddedOriginal(url: string): { base64: string; extension: 'jpeg' | 'png' } | null {
  const match = url.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const base64 = match[2].replace(/\s+/g, '');
  if (base64.length < 20) return null;
  return { base64, extension: match[1].toLowerCase() === 'png' ? 'png' : 'jpeg' };
}

type SummaryFacts = {
  labels?: Array<{ id: string; productId: string; packaging: string }>;
  best?: Array<{
    medicineId: string;
    vendorName: string;
    discountPercentage: number;
    invoiceNumber?: string;
    invoiceDateMs: number;
  }>;
  past?: Array<{ medicineId: string; vendors: Array<{ vendorName: string; discount: number }> }>;
  live?: Array<{
    name: string;
    vendors: Array<{ vendorName: string; discount: number; stockQty: number; discountKnown: boolean }>;
  }> | null;
  photoLinks?: Array<{ medicineId: string; medicineName: string; demandId: string }>;
};

/** Pack size and past vendors for this list only. The server does not send the invoices. */
function toLiveMap(
  rows: Array<{ name: string; vendors: VendorSuggestion[] }> | undefined
): Map<string, VendorSuggestion[]> | null {
  if (!rows) return null;
  const live = new Map<string, VendorSuggestion[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    if (!key) continue;
    live.set(
      key,
      (row.vendors || []).map((vendor) => ({
        vendorName: vendor.vendorName,
        discount: vendor.discount,
        stockQty: vendor.stockQty,
        discountKnown: vendor.discountKnown,
      }))
    );
  }
  return live;
}

async function loadSummaryFacts(
  items: PurchaseListItem[]
): Promise<{
  medicineById: Map<string, MedicineLabel>;
  bestDiscount: Map<string, BestDiscountVendorPurchase>;
  pastVendors: Map<string, VendorSuggestion[]>;
  liveByName: Map<string, VendorSuggestion[]> | null;
  photoLinks?: SummaryFacts['photoLinks'];
} | null> {
  const medicineIds = items.map((item) => item.medicineId).filter(Boolean);
  const names = [...new Set(items.map((item) => item.medicineName.trim()).filter(Boolean))];
  const rows = items.map((item) => ({
    medicineId: item.medicineId || '',
    medicineName: item.medicineName || '',
    orderIds: item.orderIds || [],
    productDemandIds: item.productDemandIds || [],
  }));
  try {
    const fn = httpsCallable<
      {
        medicineIds: string[];
        names: string[];
        rows: Array<{
          medicineId: string;
          medicineName: string;
          orderIds: string[];
          productDemandIds: string[];
        }>;
      },
      SummaryFacts
    >(functions, 'purchaseListSummaryFacts', { timeout: 120000 });
    const data = (await fn({ medicineIds, names, rows })).data || {};
    const medicineById = new Map<string, MedicineLabel>();
    for (const row of data.labels || []) {
      medicineById.set(row.id, { productId: row.productId || '', packaging: row.packaging || '—' });
    }
    const bestDiscount = new Map<string, BestDiscountVendorPurchase>();
    for (const row of data.best || []) {
      bestDiscount.set(row.medicineId, {
        medicineId: row.medicineId,
        vendorName: row.vendorName,
        discountPercentage: row.discountPercentage,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: new Date(row.invoiceDateMs || 0),
      });
    }
    const pastVendors = new Map<string, VendorSuggestion[]>();
    for (const row of data.past || []) {
      pastVendors.set(
        row.medicineId,
        (row.vendors || []).map((vendor) => ({
          vendorName: vendor.vendorName,
          discount: vendor.discount,
          stockQty: 0,
          discountKnown: true,
        }))
      );
    }
    return {
      medicineById,
      bestDiscount,
      pastVendors,
      liveByName: toLiveMap(data.live || undefined),
      photoLinks: data.photoLinks,
    };
  } catch (error) {
    console.warn('purchase list summary: server facts failed', error);
    return null;
  }
}

async function loadPurchaseHistory(): Promise<{
  bestDiscount: Map<string, BestDiscountVendorPurchase>;
  pastVendors: Map<string, VendorSuggestion[]>;
}> {
  try {
    const invoices = await getAllPurchaseInvoices();
    return {
      bestDiscount: buildBestDiscountVendorByMedicineId(invoices),
      pastVendors: buildRankedPurchaseVendorsByMedicineId(invoices),
    };
  } catch (error) {
    console.warn('purchase list summary: purchase history lookup failed', error);
    return { bestDiscount: new Map(), pastVendors: new Map() };
  }
}

/** Vendors already chosen when the list was published. Includes a live-stock row with quantity 0. */
function liveVendorsFromDeals(item: PurchaseListItem): VendorSuggestion[] {
  return (item.deals || [])
    .filter((deal) => deal.vendorName?.trim())
    .map((deal) => {
      const priced = offerDiscountPercent(deal);
      return {
        vendorName: deal.vendorName.trim(),
        discount: priced.discount,
        stockQty: deal.stockQty,
        discountKnown: priced.known,
      };
    });
}

/**
 * Same columns as Orders → Summary, including P1–P5.
 * Live vendors are ranked from the current Typesense stock. Past bills fill any slot still open.
 */
export async function exportPurchaseListSummary(
  list: PurchaseList,
  items: PurchaseListItem[]
): Promise<void> {
  if (items.length === 0) {
    await appAlert('This purchase list has no medicines to download.', { severity: 'warning' });
    return;
  }

  const medicineIds = items.map((item) => item.medicineId).filter(Boolean);
  const names = [...new Set(items.map((item) => item.medicineName.trim()).filter(Boolean))];
  const facts = await loadSummaryFacts(items);
  const photos = await loadDemandPhotos(items, facts?.photoLinks);
  let medicineById: Map<string, MedicineLabel>;
  let bestDiscount: Map<string, BestDiscountVendorPurchase>;
  let pastVendors: Map<string, VendorSuggestion[]>;
  let liveByName = facts?.liveByName ?? null;
  if (facts) {
    medicineById = facts.medicineById;
    bestDiscount = facts.bestDiscount;
    pastVendors = facts.pastVendors;
  } else {
    const [labels, history, ranked] = await Promise.all([
      loadMedicineLabels(medicineIds),
      loadPurchaseHistory(),
      rankLiveStockForNames(names).catch(() => new Map<string, VendorSuggestion[]>()),
    ]);
    medicineById = labels;
    bestDiscount = history.bestDiscount;
    pastVendors = history.pastVendors;
    liveByName = new Map(
      [...ranked.entries()].map(([name, vendors]) => [name.trim().toLowerCase(), vendors])
    );
  }

  const rows = [...items].sort((a, b) => {
    const manufacturer = (a.manufacturer || '').localeCompare(b.manufacturer || '');
    if (manufacturer !== 0) return manufacturer;
    return (a.medicineName || '').localeCompare(b.medicineName || '');
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Purchase list');
  ws.columns = [
    { header: 'S.No', width: 8 },
    { header: 'Product ID', width: 16 },
    { header: 'Medicine Name', width: 40 },
    { header: 'Photo', width: 14 },
    { header: 'Packaging', width: 18 },
    { header: 'Total Quantity', width: 16 },
    { header: 'Best Discount Vendor', width: 36 },
    { header: 'Manufacturer', width: 28 },
    { header: 'P1 Vendor', width: 28 },
    { header: 'P2 Vendor', width: 28 },
    { header: 'P3 Vendor', width: 28 },
    { header: 'P4 Vendor', width: 28 },
    { header: 'P5 Vendor', width: 28 },
  ];
  ws.getRow(1).font = { bold: true };
  const photoColumn = 3;

  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    const med = item.medicineId ? medicineById.get(item.medicineId) : undefined;
    const past = item.medicineId ? pastVendors.get(item.medicineId) || [] : [];
    const liveKey = item.medicineName.trim().toLowerCase();
    const live = liveByName?.has(liveKey) ? liveByName.get(liveKey) || [] : liveVendorsFromDeals(item);
    const [p1, p2, p3, p4, p5] = suggestVendors(live, past);
    const excelRow = ws.addRow([
      index + 1,
      med?.productId || '',
      item.medicineName,
      '',
      med?.packaging || '—',
      item.totalQty,
      formatBestDiscountVendorLabel(item.medicineId ? bestDiscount.get(item.medicineId) : undefined),
      item.manufacturer || 'N/A',
      p1,
      p2,
      p3,
      p4,
      p5,
    ]);
    const src = photoFor(item, photos, med);
    const thumb = src ? await jpegThumbnail(src) : null;
    if (!thumb) continue;
    const imageId = wb.addImage({ base64: thumb.base64, extension: thumb.extension });
    const rowIndex = excelRow.number - 1;
    ws.addImage(imageId, {
      tl: { col: photoColumn, row: rowIndex },
      ext: { width: 60, height: 60 },
      editAs: 'oneCell',
    });
    excelRow.height = 48;
  }

  const stamp = `${list.fromDate}_${list.toDate}`.replace(/[^\d-]+/g, '');
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `purchase-list-summary-${stamp}-${istDateStampCompact()}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
