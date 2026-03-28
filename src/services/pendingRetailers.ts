import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
  db,
  auth,
  functions,
} from './firebase';
import { httpsCallable } from 'firebase/functions';

export interface RetailerRegistrationRequest {
  id: string;
  email: string;
  retailerEmail?: string;
  password?: string;
  displayName?: string;
  shopName?: string;
  phoneNumber?: string;
  address?: string;
  licenceNumber?: string;
  aadharNumber?: string;
  ownerName?: string;
  licenceHolderName?: string;
  pan?: string;
  gst?: string;
  storeCode?: string;
  salesOfficerId: string;
  shopImageUrl?: string;
  licenceImageUrl?: string;
  aadharImageUrl?: string;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date | any;
  updatedAt?: Date | any;
  submittedBy?: string;
  reviewedBy?: string;
  reviewedAt?: Date | any;
  rejectionReason?: string;
  // Alternate keys some clients may use (see resolveRegistrationImageUrls)
  shopImage?: string;
  licenceImage?: string;
  aadharImage?: string;
}

/**
 * Sales Officer / mobile apps may store document URLs under different field names than the admin UI expects.
 * Supports https URLs and data:image/* base64 strings.
 */
export function resolveRegistrationImageUrls(req: Record<string, unknown>): {
  shop?: string;
  licence?: string;
  aadhar?: string;
} {
  const pick = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = req[k];
      if (typeof v === 'string' && v.trim().length > 0) {
        const s = v.trim();
        if (
          s.startsWith('http://') ||
          s.startsWith('https://') ||
          s.startsWith('data:image')
        ) {
          return s;
        }
      }
    }
    return undefined;
  };

  return {
    shop: pick([
      'shopImageUrl',
      'shopImage',
      'shopPhotoUrl',
      'shop_photo_url',
      'storeImageUrl',
    ]),
    licence: pick([
      'licenceImageUrl',
      'licenceImage',
      'licenseImageUrl',
      'licenseImage',
      'drugLicenceImageUrl',
      'drugLicenseImageUrl',
    ]),
    aadhar: pick([
      'aadharImageUrl',
      'aadharImage',
      'aadharCardUrl',
      'aadhaarImageUrl',
      'aadhar_image_url',
    ]),
  };
}

export const getPendingRetailerRequests = async (): Promise<RetailerRegistrationRequest[]> => {
  const col = collection(db, 'retailer_registration_requests');
  const q = query(
    col,
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt,
  })) as RetailerRegistrationRequest[];
};

export const approveRetailerRequest = async (
  requestId: string
): Promise<{ emailSent?: boolean; emailError?: string }> => {
  const approveFn = httpsCallable(functions, 'approveRetailerRequest');
  const result = await approveFn({ requestId });
  const data = (result.data || {}) as { emailSent?: boolean; emailError?: string };
  return { emailSent: data.emailSent === true, emailError: data.emailError };
};

export const rejectRetailerRequest = async (
  requestId: string,
  reason?: string
): Promise<void> => {
  const reqRef = doc(db, 'retailer_registration_requests', requestId);
  await updateDoc(reqRef, {
    status: 'rejected',
    rejectionReason: reason || '',
    reviewedBy: auth.currentUser?.uid,
    reviewedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
};
