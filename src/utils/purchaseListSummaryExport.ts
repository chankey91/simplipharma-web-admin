import ExcelJS from 'exceljs';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getAllPurchaseInvoices } from '../services/purchaseInvoices';
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

type OrderLine = {
  medicineId?: string;
  name?: string;
  productDemandId?: string;
  imageUrl?: string;
};

function lineKeys(line: OrderLine): string[] {
  const keys: string[] = [];
  const medicineId = String(line.medicineId || '').trim();
  const name = String(line.name || '').trim().toLowerCase();
  if (medicineId) keys.push(medicineId);
  if (name) keys.push(`name:${name}`);
  return keys;
}

/** Retailer photos from the orders on this list, then from the product demand itself. */
async function loadDemandPhotos(items: PurchaseListItem[]): Promise<Map<string, string>> {
  const photos = new Map<string, string>();
  const demandKeys = new Map<string, string[]>();
  const orderIds = [...new Set(items.flatMap((item) => item.orderIds || []).filter(Boolean))];

  const remember = (keys: string[], imageUrl: string | undefined, overwrite = false) => {
    const src = imageUrl?.trim();
    if (!src) return;
    for (const key of keys) {
      if (!overwrite && photos.has(key)) continue;
      photos.set(key, src);
    }
  };

  try {
    for (let i = 0; i < orderIds.length; i += 10) {
      const chunk = orderIds.slice(i, i + 10);
      const snap = await getDocs(query(collection(db, 'orders'), where(documentId(), 'in', chunk)));
      for (const order of snap.docs) {
        const medicines = (order.data().medicines || []) as OrderLine[];
        for (const line of medicines) {
          const keys = lineKeys(line);
          if (!keys.length) continue;
          remember(keys, line.imageUrl);
          const demandId = String(line.productDemandId || '').trim();
          if (!demandId) continue;
          const linked = demandKeys.get(demandId) || [];
          for (const key of keys) {
            if (!linked.includes(key)) linked.push(key);
          }
          demandKeys.set(demandId, linked);
        }
      }
    }

    const demandIds = [...demandKeys.keys()];
    for (let i = 0; i < demandIds.length; i += 10) {
      const chunk = demandIds.slice(i, i + 10);
      const snap = await getDocs(query(collection(db, 'product_demands'), where(documentId(), 'in', chunk)));
      for (const demand of snap.docs) {
        const imageUrl = String(demand.data().imageUrl || '').trim();
        if (!imageUrl) continue;
        remember(demandKeys.get(demand.id) || [], imageUrl, true);
      }
    }
  } catch (error) {
    console.warn('purchase list summary: product photo lookup failed', error);
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
 * Live vendors come from the list itself. Past bills fill any slot still open.
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
  const [medicineById, history, photos] = await Promise.all([
    loadMedicineLabels(medicineIds),
    loadPurchaseHistory(),
    loadDemandPhotos(items),
  ]);
  const { bestDiscount, pastVendors } = history;

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
    const [p1, p2, p3, p4, p5] = suggestVendors(liveVendorsFromDeals(item), past);
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
