import { collection, getDocs, query, orderBy, doc, getDoc, db } from './firebase';
import { DebitNote, TaxNoteLine } from '../types';

function toDate(value: unknown): Date {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (value instanceof Date) return value;
  if (value != null) {
    const d = new Date(value as string | number);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function parseDebitNoteDoc(id: string, data: Record<string, unknown>): DebitNote {
  const items = ((data.items as TaxNoteLine[]) || []).map((item) => ({
    ...item,
    expiryDate: item.expiryDate ? toDate(item.expiryDate) : undefined,
  }));

  return {
    id,
    ...(data as object),
    items,
    debitNoteDate: toDate(data.debitNoteDate ?? data.createdAt),
    createdAt: toDate(data.createdAt),
  } as DebitNote;
}

export const getAllDebitNotes = async (): Promise<DebitNote[]> => {
  const col = collection(db, 'debit_notes');
  try {
    const snap = await getDocs(query(col, orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => parseDebitNoteDoc(d.id, d.data() as Record<string, unknown>));
  } catch {
    const snap = await getDocs(col);
    const list = snap.docs.map((d) => parseDebitNoteDoc(d.id, d.data() as Record<string, unknown>));
    return list.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
  }
};

export const getDebitNoteById = async (debitNoteId: string): Promise<DebitNote | null> => {
  const snap = await getDoc(doc(db, 'debit_notes', debitNoteId));
  if (!snap.exists()) return null;
  return parseDebitNoteDoc(snap.id, snap.data() as Record<string, unknown>);
};
