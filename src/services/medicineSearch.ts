import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { Medicine } from '../types';

const searchMedicinesCallable = httpsCallable(functions, 'searchMedicinesTypesense', {
  timeout: 120000,
});

function mapLiteToMedicine(raw: Record<string, unknown>): Medicine {
  const price =
    typeof raw.price === 'number' ? raw.price : parseFloat(String(raw.price ?? 0)) || 0;
  const stock =
    typeof raw.stock === 'number' ? raw.stock : parseInt(String(raw.stock ?? '0'), 10) || 0;
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    category: String(raw.category ?? ''),
    code: raw.code != null ? String(raw.code) : undefined,
    unit: raw.unit != null ? String(raw.unit) : undefined,
    manufacturer: String(raw.manufacturer ?? ''),
    stock,
    currentStock:
      typeof raw.currentStock === 'number'
        ? raw.currentStock
        : raw.currentStock != null && !isNaN(parseInt(String(raw.currentStock), 10))
          ? parseInt(String(raw.currentStock), 10)
          : undefined,
    price,
    mrp:
      raw.mrp != null && !isNaN(Number(raw.mrp))
        ? Number(raw.mrp)
        : undefined,
    gstRate: typeof raw.gstRate === 'number' ? raw.gstRate : undefined,
    company: raw.company != null ? String(raw.company) : undefined,
    description: raw.description != null ? String(raw.description) : undefined,
    imageUrl: raw.imageUrl != null ? String(raw.imageUrl) : undefined,
  };
}

/** Typesense + Firestore hydrate (same callable as retailer app). */
export async function searchMedicinesTypesenseAdmin(query: string): Promise<Medicine[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await searchMedicinesCallable({ query: q, limit: 120 });
    const data = res.data as { medicines?: unknown[] };
    const rows = data.medicines;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => mapLiteToMedicine(r as Record<string, unknown>));
  } catch (e) {
    console.warn('searchMedicinesTypesenseAdmin failed', e);
    return [];
  }
}
