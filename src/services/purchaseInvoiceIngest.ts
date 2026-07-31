import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, storage } from './firebase';
import type {
  PurchaseInvoiceDraft,
  PurchaseInvoiceDraftResolvedLine,
  PurchaseInvoiceDraftStatus,
} from '../types';

const DRAFTS = 'purchase_invoice_drafts';

const processDraftCallable = httpsCallable(functions, 'processPurchaseInvoiceDraft', {
  timeout: 300000,
});

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export function isAllowedInvoiceUpload(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true;
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp')
  );
}

function mapDraft(id: string, data: Record<string, unknown>): PurchaseInvoiceDraft {
  return {
    id,
    ...(data as Omit<PurchaseInvoiceDraft, 'id'>),
  };
}

/** Create draft doc then upload file under the user's Storage prefix. */
export async function createAndUploadInvoiceDraft(file: File): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in required');
  if (!isAllowedInvoiceUpload(file)) {
    throw new Error('Upload a PDF or image (JPG/PNG/WebP)');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('File must be under 15MB');
  }

  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const draftRef = await addDoc(collection(db, DRAFTS), {
    status: 'uploaded' satisfies PurchaseInvoiceDraftStatus,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    sourceFile: {
      storagePath: '', // filled after we know draft id
      fileName: file.name,
      contentType,
      size: file.size,
    },
  });

  const storagePath = `purchase_invoice_uploads/${uid}/${draftRef.id}/${file.name}`;
  await uploadBytes(ref(storage, storagePath), file, { contentType });
  await updateDoc(draftRef, {
    'sourceFile.storagePath': storagePath,
    updatedAt: serverTimestamp(),
  });

  return draftRef.id;
}

export async function processInvoiceDraft(draftId: string) {
  const res = await processDraftCallable({ draftId });
  return res.data as {
    ok: boolean;
    draftId: string;
    status: string;
    lineCount: number;
    engine: string;
  };
}

export async function getInvoiceDraft(draftId: string): Promise<PurchaseInvoiceDraft | null> {
  const snap = await getDoc(doc(db, DRAFTS, draftId));
  if (!snap.exists()) return null;
  return mapDraft(snap.id, snap.data() as Record<string, unknown>);
}

export function subscribeInvoiceDraft(
  draftId: string,
  onNext: (draft: PurchaseInvoiceDraft | null) => void
): () => void {
  return onSnapshot(doc(db, DRAFTS, draftId), (snap) => {
    if (!snap.exists()) {
      onNext(null);
      return;
    }
    onNext(mapDraft(snap.id, snap.data() as Record<string, unknown>));
  });
}

export async function updateInvoiceDraftReview(
  draftId: string,
  patch: {
    vendorId?: string;
    vendorName?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    resolvedLines?: PurchaseInvoiceDraftResolvedLine[];
    status?: PurchaseInvoiceDraftStatus;
  }
): Promise<void> {
  await updateDoc(doc(db, DRAFTS, draftId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function markInvoiceDraftCommitted(
  draftId: string,
  purchaseInvoiceId: string
): Promise<void> {
  await updateDoc(doc(db, DRAFTS, draftId), {
    status: 'committed',
    purchaseInvoiceId,
    updatedAt: serverTimestamp(),
  });
}

export async function getDraftFileDownloadUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath));
}
