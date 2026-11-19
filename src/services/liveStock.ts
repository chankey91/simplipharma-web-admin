import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, db, functions, storage } from './firebase';

export type LiveStockUpload = {
  id: string;
  vendorId: string;
  vendorName: string;
  fileName: string;
  contentType: string;
  status: 'uploaded' | 'extracting' | 'ready' | 'failed';
  rowCount?: number;
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

export async function uploadLiveStockFile(args: {
  vendorId: string;
  vendorName: string;
  file: File;
}): Promise<{ uploadId: string; rowCount: number; message: string; engine: string }> {
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

  const result = await ingestCallable({ uploadId: uploadRef.id });
  const data = result.data as {
    ok: boolean;
    rowCount: number;
    message?: string;
    engine?: string;
  };
  if (!data.ok) throw new Error(data.message || 'No stock rows found');
  return {
    uploadId: uploadRef.id,
    rowCount: data.rowCount,
    message: data.message || `Loaded ${data.rowCount} rows`,
    engine: data.engine || '',
  };
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

export async function listLiveStockOffers(uploadId: string): Promise<LiveStockOffer[]> {
  const snap = await getDocs(
    query(collection(db, 'liveStockOffers'), where('uploadId', '==', uploadId), limit(5000))
  );
  return snap.docs
    .map((item) => ({ id: item.id, ...(item.data() as Omit<LiveStockOffer, 'id'>) }))
    .sort((a, b) => a.productName.localeCompare(b.productName));
}
