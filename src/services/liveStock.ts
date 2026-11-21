import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, db, functions, storage } from './firebase';
import type { VendorSuggestion } from '../utils/vendorLastPurchase';

export type LiveStockUpload = {
  id: string;
  vendorId: string;
  vendorName: string;
  fileName: string;
  contentType: string;
  status: 'uploaded' | 'extracting' | 'ready' | 'failed';
  rowCount?: number;
  savedCount?: number;
  engine?: string;
  message?: string;
  error?: string;
  createdAt?: unknown;
};

export type LiveStockOffer = {
  id: string;
  uploadId: string;
  vendorId: string;
  vendorName: string;
  productName: string;
  pack?: string;
  manufacturer?: string;
  stockQty: number;
  rate?: number | null;
  mrp?: number | null;
  scheme?: string | null;
  effectiveRate?: number | null;
  expiry?: string | null;
};

const ingestCallable = httpsCallable(functions, 'ingestLiveStockUpload', { timeout: 300000 });
const deleteCallable = httpsCallable(functions, 'deleteLiveStockUpload', { timeout: 120000 });

function contentTypeFor(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (name.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'text/csv';
}

export function isLiveStockFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.pdf');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLiveStockResult(
  uploadId: string,
  onProgress?: (message: string) => void
): Promise<{ uploadId: string; rowCount: number; message: string; engine: string }> {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const snap = await getDoc(doc(db, 'liveStockUploads', uploadId));
    const data = snap.data() || {};
    const status = String(data.status || '');
    const saved = Number(data.savedCount || 0);
    const total = Number(data.rowCount || 0);
    if (data.message) onProgress?.(String(data.message));
    else if (total > 0) onProgress?.(`Saving ${saved} of ${total} products`);
    if (status === 'ready') {
      return {
        uploadId,
        rowCount: total,
        message: String(data.message || `Loaded ${total} rows`),
        engine: String(data.engine || ''),
      };
    }
    if (status === 'failed') throw new Error(String(data.error || data.message || 'Could not load this stock file'));
    await sleep(2000);
  }
  throw new Error('This file is still saving. Refresh Live stock in a few minutes.');
}

export async function uploadLiveStockFile(
  args: {
    vendorId: string;
    vendorName: string;
    file: File;
  },
  onProgress?: (message: string) => void
): Promise<{ uploadId: string; rowCount: number; message: string; engine: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in required');
  if (!isLiveStockFile(args.file)) throw new Error('Upload a CSV, Excel, or PDF stock file');
  if (args.file.size > 15 * 1024 * 1024) throw new Error('File must be under 15MB');

  const contentType = contentTypeFor(args.file);
  const uploadRef = await addDoc(collection(db, 'liveStockUploads'), {
    vendorId: args.vendorId,
    vendorName: args.vendorName,
    fileName: args.file.name,
    contentType,
    size: args.file.size,
    status: 'uploaded',
    createdBy: uid,
    storagePath: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const storagePath = `live_stock_uploads/${uid}/${uploadRef.id}/${args.file.name}`;
  await uploadBytes(ref(storage, storagePath), args.file, { contentType });
  await updateDoc(doc(db, 'liveStockUploads', uploadRef.id), {
    storagePath,
    updatedAt: serverTimestamp(),
  });

  onProgress?.('Reading the file…');
  const watched = waitForLiveStockResult(uploadRef.id, onProgress);
  void watched.catch(() => undefined);
  try {
    const result = await ingestCallable({ uploadId: uploadRef.id });
    const data = result.data as {
      ok: boolean;
      started?: boolean;
      rowCount: number;
      message?: string;
      engine?: string;
    };
    if (!data.ok) throw new Error(data.message || 'No stock rows found');
    if (!data.started) {
      return {
        uploadId: uploadRef.id,
        rowCount: data.rowCount,
        message: data.message || `Loaded ${data.rowCount} rows`,
        engine: data.engine || '',
      };
    }
  } catch (error: unknown) {
    const code = String((error as { code?: string })?.code || '');
    const message = error instanceof Error ? error.message : '';
    const timedOut = /deadline|timeout|unavailable/i.test(`${code} ${message}`);
    if (!timedOut) throw error instanceof Error ? error : new Error('Could not load this stock file');
  }
  return watched;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { code?: string; message?: string };
  const code = String(err?.code || '');
  const message = String(err?.message || '').trim();
  if (
    code === 'functions/not-found' ||
    code === 'functions/unavailable' ||
    message === 'internal' ||
    message === 'not-found'
  ) {
    return 'Delete is not available on the server yet. Deploy the live-stock function, then try again.';
  }
  return message || fallback;
}

export async function deleteLiveStockUpload(uploadId: string): Promise<void> {
  try {
    const result = await deleteCallable({ uploadId });
    const data = result.data as { ok?: boolean; message?: string };
    if (!data?.ok) throw new Error(data?.message || 'Could not delete this stock list');
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Delete is not available')) throw error;
    throw new Error(callableErrorMessage(error, 'Could not delete this stock list'));
  }
}

export async function listLiveStockUploads(): Promise<LiveStockUpload[]> {
  const snap = await getDocs(
    query(collection(db, 'liveStockUploads'), orderBy('createdAt', 'desc'), limit(30))
  );
  return snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<LiveStockUpload, 'id'>) }));
}

export async function searchLiveStockOffers(
  uploadId: string,
  q = ''
): Promise<{ offers: LiveStockOffer[]; found: number }> {
  const fn = httpsCallable<
    { uploadId: string; q: string; page: number; perPage: number },
    { offers: LiveStockOffer[]; found: number }
  >(functions, 'searchLiveStockOffers');
  const result = await fn({ uploadId, q, page: 1, perPage: 250 });
  return {
    offers: result.data?.offers || [],
    found: Number(result.data?.found || 0),
  };
}

export type CurrentLiveStockOffer = {
  vendorId: string;
  vendorName: string;
  productName: string;
  stockQty: number;
  rate: number | null;
  effectiveRate: number | null;
  discountPercentage: number | null;
};

/** Ranked live-stock vendors for these product names. Stock rows stay in Typesense. */
export async function rankLiveStockForNames(names: string[]): Promise<Map<string, VendorSuggestion[]>> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const out = new Map<string, VendorSuggestion[]>();
  if (!unique.length) return out;
  const fn = httpsCallable<
    { names: string[] },
    { matches: Array<{ name: string; vendors: VendorSuggestion[] }> }
  >(functions, 'rankLiveStockNames');
  for (let i = 0; i < unique.length; i += 80) {
    const result = await fn({ names: unique.slice(i, i + 80) });
    for (const row of result.data?.matches || []) {
      out.set(row.name, row.vendors || []);
    }
  }
  return out;
}
