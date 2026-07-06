import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, getDocs, query, where, db, auth, storage } from './firebase';

const MAX_BYTES = 5 * 1024 * 1024;

function contentTypeForFileName(fileName: string): string {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/** Upload retailer document to Firebase Storage; returns download URL. */
export const uploadRetailerDocument = async (
  file: File,
  folder: 'shop' | 'licence' | 'aadhar',
  fileName: string
): Promise<string> => {
  if (!auth.currentUser?.uid) {
    throw new Error('You must be signed in to upload documents.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Image must be 5 MB or smaller.');
  }
  const path = `retailer_docs/${folder}/${Date.now()}_${fileName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, {
    contentType: file.type || contentTypeForFileName(fileName),
  });
  return getDownloadURL(fileRef);
};

/**
 * Resolve a preview URI (blob/data URL) or existing https URL to a stored download URL.
 * Returns previousUrl when uri is empty; keeps https URLs as-is.
 */
export const resolveRetailerImageUrl = async (
  uri: string | null | undefined,
  folder: 'shop' | 'licence' | 'aadhar',
  fileName: string,
  file: File | null,
  previousUrl?: string | null
): Promise<string | undefined> => {
  if (!uri?.trim()) return previousUrl || undefined;
  if (/^https?:\/\//i.test(uri)) return uri;
  if (file) {
    return uploadRetailerDocument(file, folder, fileName);
  }
  // Legacy base64 data URL — keep as-is for shop image backward compatibility
  if (uri.startsWith('data:')) return uri;
  return previousUrl || undefined;
};

/**
 * Check licence / aadhar against approved retailers and pending registration requests.
 */
export const checkLicenseAndAadharUnique = async (
  licenceNumber: string,
  aadharNumber: string,
  excludeUserId?: string,
  excludeRequestId?: string
): Promise<{ licenceTaken: boolean; aadharTaken: boolean }> => {
  const lic = (licenceNumber || '').trim();
  const aad = (aadharNumber || '').trim();
  const result = { licenceTaken: false, aadharTaken: false };

  if (lic) {
    const usersSnap = await getDocs(
      query(
        collection(db, 'users'),
        where('role', '==', 'retailer'),
        where('licenceNumber', '==', lic)
      )
    );
    if (usersSnap.docs.some((d) => d.id !== excludeUserId)) {
      result.licenceTaken = true;
    }

    if (!result.licenceTaken) {
      const reqSnap = await getDocs(
        query(
          collection(db, 'retailer_registration_requests'),
          where('licenceNumber', '==', lic),
          where('status', '==', 'pending')
        )
      );
      if (reqSnap.docs.some((d) => d.id !== excludeRequestId)) {
        result.licenceTaken = true;
      }
    }
  }

  if (aad) {
    const usersSnap = await getDocs(
      query(
        collection(db, 'users'),
        where('role', '==', 'retailer'),
        where('aadharNumber', '==', aad)
      )
    );
    if (usersSnap.docs.some((d) => d.id !== excludeUserId)) {
      result.aadharTaken = true;
    }

    if (!result.aadharTaken) {
      const reqSnap = await getDocs(
        query(
          collection(db, 'retailer_registration_requests'),
          where('aadharNumber', '==', aad),
          where('status', '==', 'pending')
        )
      );
      if (reqSnap.docs.some((d) => d.id !== excludeRequestId)) {
        result.aadharTaken = true;
      }
    }
  }

  return result;
};
