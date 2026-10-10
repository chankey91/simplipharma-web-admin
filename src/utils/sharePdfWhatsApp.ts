import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, doc, serverTimestamp, setDoc, storage } from '../services/firebase';
import { getCloudFunctionUrl } from '../config/env';
import { buildWhatsAppUrl, normalizeWhatsAppPhone } from './orderWhatsAppItems';

export function toSharedPdfId(fileName: string): string {
  return fileName.replace(/[^\w.\-]+/g, '_');
}

/** Public link that ends with the filename: .../pdf/credit-note-CN123.pdf */
export function buildSharedPdfUrl(fileName: string): string {
  return `${getCloudFunctionUrl('openSharedPdf')}/${encodeURIComponent(toSharedPdfId(fileName))}`;
}

export async function registerSharedPdfLink(params: {
  fileName: string;
  downloadUrl: string;
  storagePath: string;
  uid: string;
}): Promise<string> {
  const shareId = toSharedPdfId(params.fileName);
  await setDoc(doc(db, 'pdf_shares', shareId), {
    fileName: params.fileName,
    downloadUrl: params.downloadUrl,
    storagePath: params.storagePath,
    createdBy: params.uid,
    createdAt: serverTimestamp(),
  });
  return buildSharedPdfUrl(params.fileName);
}

export function formatWhatsAppPdfText(body: string, fileName: string, shareUrl: string): string {
  return `${body.trim()}\n\n📄 ${fileName}\n${shareUrl}`;
}

/** Upload a PDF and open WhatsApp Web with a short filename link. */
export async function sharePdfOnWhatsApp(params: {
  blob: Blob;
  fileName: string;
  storageFolder: string;
  text: string;
  phoneRaw?: string | null;
}): Promise<{ opened: boolean; downloadUrl: string; shareUrl: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in required to share on WhatsApp');

  const safeName = toSharedPdfId(params.fileName);
  const path = `${params.storageFolder}/${uid}/${Date.now()}_${safeName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, params.blob, {
    contentType: 'application/pdf',
    contentDisposition: `inline; filename="${safeName}"`,
    customMetadata: { fileName: params.fileName },
  });
  const downloadUrl = await getDownloadURL(fileRef);

  let shareUrl = downloadUrl;
  try {
    shareUrl = await registerSharedPdfLink({
      fileName: params.fileName,
      downloadUrl,
      storagePath: path,
      uid,
    });
  } catch (err) {
    console.warn('Could not register short PDF link; using storage URL', err);
  }

  const text = formatWhatsAppPdfText(params.text, params.fileName, shareUrl);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }

  const phone = normalizeWhatsAppPhone(params.phoneRaw);
  if (phone) {
    window.open(buildWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer');
    return { opened: true, downloadUrl, shareUrl };
  }
  return { opened: false, downloadUrl, shareUrl };
}
