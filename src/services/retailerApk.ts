import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  functions,
  serverTimestamp,
  storage,
} from './firebase';

export const RETAILER_APK_RELEASE_ID = 'retailer_android';

export type RetailerApkRelease = {
  versionName: string;
  downloadUrl: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  notes: string;
  uploadedAt?: Date | null;
  uploadedBy?: string;
};

export type ApkBroadcast = {
  id: string;
  versionName: string;
  downloadUrl: string;
  notes?: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  failCount: number;
  createdAt?: Date | null;
  finishedAt?: Date | null;
};

const MAX_APK_BYTES = 150 * 1024 * 1024;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && value && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function parseRelease(data: Record<string, unknown> | undefined): RetailerApkRelease | null {
  if (!data) return null;
  const downloadUrl = String(data.downloadUrl || '').trim();
  if (!downloadUrl) return null;
  return {
    versionName: String(data.versionName || '').trim() || 'latest',
    downloadUrl,
    storagePath: String(data.storagePath || ''),
    fileName: String(data.fileName || ''),
    fileSize: Number(data.fileSize) || 0,
    notes: String(data.notes || ''),
    uploadedAt: toDate(data.uploadedAt),
    uploadedBy: String(data.uploadedBy || ''),
  };
}

export async function getRetailerApkRelease(): Promise<RetailerApkRelease | null> {
  const snap = await getDoc(doc(db, 'app_releases', RETAILER_APK_RELEASE_ID));
  return parseRelease(snap.exists() ? (snap.data() as Record<string, unknown>) : undefined);
}

export async function uploadRetailerApk(input: {
  file: File;
  versionName: string;
  notes?: string;
}): Promise<RetailerApkRelease> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('You must be signed in to upload an APK.');
  const file = input.file;
  const name = file.name.toLowerCase();
  if (!name.endsWith('.apk')) {
    throw new Error('Choose an .apk file.');
  }
  if (file.size > MAX_APK_BYTES) {
    throw new Error('APK must be 150 MB or smaller.');
  }
  const versionName = input.versionName.trim();
  if (!versionName) throw new Error('Enter a version name (e.g. 1.4.0).');

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `retailer_apk/${uid}/${Date.now()}_${safeName}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file, {
    contentType: 'application/vnd.android.package-archive',
  });
  const downloadUrl = await getDownloadURL(fileRef);

  const payload = {
    versionName,
    downloadUrl,
    storagePath,
    fileName: file.name,
    fileSize: file.size,
    notes: (input.notes || '').trim(),
    uploadedAt: serverTimestamp(),
    uploadedBy: uid,
    platform: 'android',
  };
  await setDoc(doc(db, 'app_releases', RETAILER_APK_RELEASE_ID), payload);

  return {
    versionName,
    downloadUrl,
    storagePath,
    fileName: file.name,
    fileSize: file.size,
    notes: (input.notes || '').trim(),
    uploadedAt: new Date(),
    uploadedBy: uid,
  };
}

export async function getApkBroadcasts(max = 20): Promise<ApkBroadcast[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'apk_broadcasts'), orderBy('createdAt', 'desc'), limit(max))
    );
    return snap.docs.map(mapBroadcast);
  } catch (error) {
    console.warn('apk_broadcasts orderBy failed, loading unsorted:', error);
    const snap = await getDocs(collection(db, 'apk_broadcasts'));
    return snap.docs
      .map(mapBroadcast)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, max);
  }
}

function mapBroadcast(d: { id: string; data: () => Record<string, unknown> }): ApkBroadcast {
  const data = d.data();
  return {
    id: d.id,
    versionName: String(data.versionName || ''),
    downloadUrl: String(data.downloadUrl || ''),
    notes: String(data.notes || ''),
    status: String(data.status || ''),
    recipientCount: Number(data.recipientCount) || 0,
    sentCount: Number(data.sentCount) || 0,
    failCount: Number(data.failCount) || 0,
    createdAt: toDate(data.createdAt),
    finishedAt: toDate(data.finishedAt),
  };
}

export async function broadcastRetailerApkUpdate(notes?: string): Promise<{
  recipientCount: number;
  sentCount: number;
  failCount: number;
  versionName: string;
}> {
  const fn = httpsCallable<
    { notes?: string },
    {
      ok?: boolean;
      recipientCount?: number;
      sentCount?: number;
      failCount?: number;
      versionName?: string;
    }
  >(functions, 'broadcastRetailerApkUpdate', { timeout: 540000 });
  const result = await fn({ notes: notes?.trim() || undefined });
  const data = result.data;
  return {
    recipientCount: data.recipientCount || 0,
    sentCount: data.sentCount || 0,
    failCount: data.failCount || 0,
    versionName: data.versionName || '',
  };
}

export function formatApkSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
