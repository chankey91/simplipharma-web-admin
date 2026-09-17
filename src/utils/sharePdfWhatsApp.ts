import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '../services/firebase';
import { buildWhatsAppUrl, normalizeWhatsAppPhone } from './orderWhatsAppItems';

/** Upload a PDF and open WhatsApp Web with a shareable link. */
export async function sharePdfOnWhatsApp(params: {
  blob: Blob;
  fileName: string;
  storageFolder: string;
  text: string;
  phoneRaw?: string | null;
}): Promise<{ opened: boolean; downloadUrl: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in required to share on WhatsApp');

  const safeName = params.fileName.replace(/[^\w.\-]+/g, '_');
  const path = `${params.storageFolder}/${uid}/${Date.now()}_${safeName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, params.blob, { contentType: 'application/pdf' });
  const downloadUrl = await getDownloadURL(fileRef);

  const text = `${params.text.trim()}\n\nPDF: ${downloadUrl}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }

  const phone = normalizeWhatsAppPhone(params.phoneRaw);
  if (phone) {
    window.open(buildWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer');
    return { opened: true, downloadUrl };
  }
  return { opened: false, downloadUrl };
}
