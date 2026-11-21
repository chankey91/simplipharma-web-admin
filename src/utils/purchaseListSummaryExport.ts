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

/** Demand photos only. Order documents are skipped because they carry every line photo. */
async function loadDemandPhotos(items: PurchaseListItem[]): Promise<Map<string, string>> {
  const photos = new Map<string, string>();
  const wantedIds = new Set(items.map((item) => item.medicineId).filter(Boolean));
  const wantedNames = new Set(items.map((item) => item.medicineName.trim().toLowerCase()).filter(Boolean));
  const orderIds = [...new Set(items.flatMap((item) => item.orderIds || []).filter(Boolean))];
  const medicineIds = [...wantedIds];

  const take = (data: Record<string, unknown>) => {
    const imageUrl = String(data.imageUrl || '').trim();
    if (!imageUrl) return;
    const medicineId = String(data.fulfilledMedicineId || '').trim();
    const name = String(data.productName || '').trim().toLowerCase();
    if (medicineId && wantedIds.has(medicineId) && !photos.has(medicineId)) photos.set(medicineId, imageUrl);
    if (name && wantedNames.has(name) && !photos.has(`name:${name}`)) photos.set(`name:${name}`, imageUrl);
  };

  const jobs = [
    ...chunksOf(orderIds, 10).map((chunk) => ({ field: 'orderId', chunk })),
    ...chunksOf(medicineIds, 10).map((chunk) => ({ field: 'fulfilledMedicineId', chunk })),
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
        snap.docs.forEach((item) => take(item.data() as Record<string, unknown>));
      } catch (error) {
        console.warn('purchase list summary: product photo lookup failed', error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, () => worker()));
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
async function jpegThumbnail(src: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('photo'));
      if (!src.startsWith('data:')) el.crossOrigin = 'anonymous';
      el.src = src;
    });
    const max = 96;
    const scale = Math.min(max / img.width, max / img.height, 1);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const url = canvas.toDataURL('image/jpeg', 0.72);
    const comma = url.indexOf(',');
    return comma >= 0 ? url.slice(comma + 1) : null;
  } catch {
    return null;
  }
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
  medicineIds: string[],
  names: string[]
): Promise<{
  medicineById: Map<string, MedicineLabel>;
  bestDiscount: Map<string, BestDiscountVendorPurchase>;
  pastVendors: Map<string, VendorSuggestion[]>;
  liveByName: Map<string, VendorSuggestion[]> | null;
} | null> {
  try {
    const fn = httpsCallable<{ medicineIds: string[]; names: string[] }, SummaryFacts>(
      functions,
      'purchaseListSummaryFacts',
      { timeout: 120000 }
    );
    const data = (await fn({ medicineIds, names })).data || {};
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
    return { medicineById, bestDiscount, pastVendors, liveByName: toLiveMap(data.live || undefined) };
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
  const [facts, photos] = await Promise.all([loadSummaryFacts(medicineIds, names), loadDemandPhotos(items)]);
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
    const imageId = wb.addImage({ base64: thumb, extension: 'jpeg' });
    ws.addImage(imageId, {
      tl: { col: photoColumn + 0.15, row: excelRow.number - 1 + 0.1 },
      ext: { width: 52, height: 52 },
      editAs: 'oneCell',
    });
    excelRow.height = 46;
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
