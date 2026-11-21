/**
 * Medicines still to buy: products on Pending and Picked up orders.
 * One callable returns picker labels. The invoice screen does not download
 * those orders or their stock batches.
 */
import { httpsCallable } from 'firebase/functions';
import { collection, documentId, functions, getDocs, query, where, db } from './firebase';
import type { Medicine } from '../types';

type PickerRow = {
  id: string;
  name: string;
  category?: string;
  manufacturer?: string;
  productId?: string;
  code?: string;
  company?: string;
  unit?: string;
  description?: string;
};

const PICKER_FIELDS = [
  'name',
  'productId',
  'code',
  'manufacturer',
  'company',
  'unit',
  'description',
  'category',
] as const;

function pickerFromData(id: string, data: Record<string, unknown>): Medicine {
  const pick = (key: (typeof PICKER_FIELDS)[number]) => {
    const value = data[key];
    return value == null ? '' : String(value);
  };
  return toMedicine({
    id,
    name: pick('name'),
    category: pick('category'),
    manufacturer: pick('manufacturer'),
    productId: pick('productId') || undefined,
    code: pick('code') || undefined,
    company: pick('company') || undefined,
    unit: pick('unit') || undefined,
    description: pick('description') || undefined,
  });
}

function toMedicine(row: PickerRow): Medicine {
  return {
    id: row.id,
    name: String(row.name || ''),
    category: String(row.category || ''),
    manufacturer: String(row.manufacturer || ''),
    productId: row.productId || undefined,
    code: row.code || undefined,
    company: row.company || undefined,
    unit: row.unit || undefined,
    description: row.description || undefined,
    stock: 0,
    price: 0,
  };
}

async function medicineIdsFromOrders(): Promise<string[]> {
  const ids = new Set<string>();
  const ordersCol = collection(db, 'orders');
  const snaps = await Promise.all(
    (['Pending', 'Picked up'] as const).map((status) =>
      getDocs(query(ordersCol, where('status', '==', status)))
    )
  );
  for (const snap of snaps) {
    for (const docSnap of snap.docs) {
      const medicines = docSnap.get('medicines');
      if (!Array.isArray(medicines)) continue;
      for (const line of medicines) {
        const id = String(line?.medicineId || '').trim();
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

async function loadPickerMedicines(ids: string[]): Promise<Medicine[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));

  const medicines: Medicine[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor];
      cursor += 1;
      const snap = await getDocs(
        query(collection(db, 'medicines'), where(documentId(), 'in', chunk))
      );
      for (const docSnap of snap.docs) {
        medicines.push(pickerFromData(docSnap.id, docSnap.data() as Record<string, unknown>));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, chunks.length) }, () => worker()));
  return medicines;
}

/** Picker rows for Pending and Picked up order lines. */
export async function loadAwaitingFulfillmentMedicines(): Promise<Medicine[]> {
  try {
    const fn = httpsCallable<Record<string, never>, { medicines?: PickerRow[] }>(
      functions,
      'awaitingFulfillmentMedicineIds',
      { timeout: 60000 }
    );
    const rows = (await fn({})).data?.medicines;
    if (Array.isArray(rows)) return rows.filter((row) => row?.id).map(toMedicine);
  } catch (error) {
    console.warn('awaiting order products: server lookup failed, reading labels directly', error);
  }
  return loadPickerMedicines(await medicineIdsFromOrders());
}
