import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  Timestamp,
  serverTimestamp,
  db,
} from './firebase';
import { stripUndefinedDeep } from '../utils/firestorePayload';
import type { RetailerOffer, RetailerOfferType } from '../utils/retailerOffers';

export type OfferInput = {
  title: string;
  subtitle?: string;
  type: RetailerOfferType;
  isActive: boolean;
  sortOrder: number;
  medicineIds: string[];
  medicineNames: string[];
  paidQty?: number;
  freeQty?: number;
  discountPct?: number;
  minQty?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value && 'toDate' in value) {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value as string | number);
  return Number.isFinite(d.getTime()) ? d : null;
}

function mapOffer(id: string, data: Record<string, unknown>): RetailerOffer {
  const type = String(data.type || 'buy_get_free') as RetailerOfferType;
  const medicineIds = Array.isArray(data.medicineIds)
    ? data.medicineIds.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const medicineNames = Array.isArray(data.medicineNames)
    ? data.medicineNames.map((x) => String(x || '').trim())
    : [];
  return {
    id,
    title: String(data.title || '').trim() || 'Untitled offer',
    subtitle: String(data.subtitle || '').trim() || undefined,
    type: type === 'combo' || type === 'percent_discount' ? type : 'buy_get_free',
    isActive: data.isActive !== false,
    sortOrder: Number(data.sortOrder) || 0,
    medicineIds,
    medicineNames,
    paidQty: data.paidQty != null ? Number(data.paidQty) : undefined,
    freeQty: data.freeQty != null ? Number(data.freeQty) : undefined,
    discountPct: data.discountPct != null ? Number(data.discountPct) : undefined,
    minQty: data.minQty != null ? Number(data.minQty) : undefined,
    startsAt: asDate(data.startsAt),
    endsAt: asDate(data.endsAt),
  };
}

export async function getAllOffers(): Promise<RetailerOffer[]> {
  try {
    const snapshot = await getDocs(query(collection(db, 'offers'), orderBy('sortOrder', 'asc')));
    return snapshot.docs.map((d) => mapOffer(d.id, d.data() as Record<string, unknown>));
  } catch {
    const snapshot = await getDocs(collection(db, 'offers'));
    return snapshot.docs
      .map((d) => mapOffer(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
}

function toWritePayload(input: OfferInput) {
  return stripUndefinedDeep({
    title: input.title.trim(),
    subtitle: input.subtitle?.trim() || null,
    type: input.type,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
    medicineIds: input.medicineIds,
    medicineNames: input.medicineNames,
    paidQty: input.type === 'buy_get_free' ? input.paidQty : null,
    freeQty: input.type === 'buy_get_free' ? input.freeQty : null,
    discountPct: input.type === 'buy_get_free' ? null : input.discountPct,
    minQty: input.type === 'buy_get_free' ? null : input.minQty,
    startsAt: input.startsAt ? Timestamp.fromDate(input.startsAt) : null,
    endsAt: input.endsAt ? Timestamp.fromDate(input.endsAt) : null,
  });
}

export async function addOffer(input: OfferInput): Promise<string> {
  const ref = await addDoc(collection(db, 'offers'), {
    ...toWritePayload(input),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateOffer(offerId: string, input: Partial<OfferInput>): Promise<void> {
  const payload = toWritePayload({
    title: input.title || '',
    subtitle: input.subtitle,
    type: input.type || 'buy_get_free',
    isActive: input.isActive !== false,
    sortOrder: input.sortOrder ?? 0,
    medicineIds: input.medicineIds || [],
    medicineNames: input.medicineNames || [],
    paidQty: input.paidQty,
    freeQty: input.freeQty,
    discountPct: input.discountPct,
    minQty: input.minQty,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
  await updateDoc(doc(db, 'offers', offerId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteOffer(offerId: string): Promise<void> {
  await deleteDoc(doc(db, 'offers', offerId));
}
