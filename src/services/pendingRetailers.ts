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
  /** Canonical (aligned with mobile app); also see getRegistrationRequestImageUrls */
  shopImageUrl?: string;
  licenceImageUrl?: string;
  aadharImageUrl?: string;
  shopImage?: string;
  licenseImageUrl?: string;
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
}

/**
 * Same resolution as mobile `getRegistrationRequestImageUrls` so admin UI shows photos
 * regardless of which Firestore keys the SO app wrote.
 */
export function getRegistrationRequestImageUrls(req: Record<string, unknown> | null | undefined): {
  shopImageUrl?: string;
  licenceImageUrl?: string;
  aadharImageUrl?: string;
} {
  if (!req) return {};
  const r = req as Record<string, string | undefined>;
  const shop =
    r.shopImageUrl || r.shopImage || r.shopPhotoUrl;
  const licence =
    r.licenceImageUrl ||
    r.licenceImage ||
    r.licenseImageUrl ||
    r.licenseImage;
  const aadhar =
    r.aadharImageUrl || r.aadharImage || r.aadharCardUrl;
  return {
    ...(shop ? { shopImageUrl: shop } : {}),
    ...(licence ? { licenceImageUrl: licence } : {}),
    ...(aadhar ? { aadharImageUrl: aadhar } : {}),
  };
}

function parseRetailerRegistrationDoc(
  id: string,
  data: Record<string, unknown>
): RetailerRegistrationRequest {
  const imgs = getRegistrationRequestImageUrls(data);
  return {
    id,
    ...(data as object),
    ...(imgs.shopImageUrl !== undefined ? { shopImageUrl: imgs.shopImageUrl, shopImage: imgs.shopImageUrl } : {}),
    ...(imgs.licenceImageUrl !== undefined
      ? { licenceImageUrl: imgs.licenceImageUrl, licenseImageUrl: imgs.licenceImageUrl }
      : {}),
    ...(imgs.aadharImageUrl !== undefined ? { aadharImageUrl: imgs.aadharImageUrl } : {}),
    createdAt: (data as any).createdAt?.toDate?.() || (data as any).createdAt,
    updatedAt: (data as any).updatedAt?.toDate?.() || (data as any).updatedAt,
    reviewedAt: (data as any).reviewedAt?.toDate?.() || (data as any).reviewedAt,
  } as RetailerRegistrationRequest;
}

export const getPendingRetailerRequests = async (): Promise<RetailerRegistrationRequest[]> => {
  const col = collection(db, 'retailer_registration_requests');
  const q = query(
    col,
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => parseRetailerRegistrationDoc(d.id, d.data()));
};

export const approveRetailerRequest = async (requestId: string): Promise<void> => {
  const approveFn = httpsCallable(functions, 'approveRetailerRequest');
  await approveFn({ requestId });
};

export interface RejectRetailerRequestResult {
  success: boolean;
  retailerEmailSent: boolean | null;
  salesOfficerEmailSent: boolean | null;
  emailErrors?: string;
}

export const rejectRetailerRequest = async (
  requestId: string,
  reason?: string
): Promise<RejectRetailerRequestResult> => {
  const rejectFn = httpsCallable(functions, 'rejectRetailerRequest');
  const res = await rejectFn({ requestId, reason: reason ?? '' });
  return res.data as RejectRetailerRequestResult;
};
