import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from './firebase';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function safeImageExtension(file: File): string {
  const fromType =
    file.type === 'image/jpeg'
      ? 'jpg'
      : file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : file.type === 'image/gif'
            ? 'gif'
            : null;
  if (fromType) return fromType;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg';
}

/** Upload a home-banner image; returns public download URL for storing on the banner doc. */
export const uploadBannerImage = async (file: File): Promise<string> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('You must be signed in to upload a banner image.');
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Please choose a JPEG, PNG, WebP, or GIF image.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Image must be 5 MB or smaller.');
  }
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const ext = safeImageExtension(file);
  /** Path includes uid so Storage rules can authorize without Firestore (works on Spark). */
  const path = `banners/images/${uid}/${id}.${ext}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return getDownloadURL(fileRef);
};
