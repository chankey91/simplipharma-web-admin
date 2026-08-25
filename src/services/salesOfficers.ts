import { collection, getDocs, query, where, doc, updateDoc, deleteField, db, functions, auth, storage } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { User } from '../types';

export const getSalesOfficers = async (): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(usersCol, where('role', '==', 'salesOfficer'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    uid: d.id,
    ...d.data(),
  } as User));
};

export const getRetailersBySalesOfficer = async (salesOfficerId: string): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(
    usersCol,
    where('role', '==', 'retailer'),
    where('salesOfficerId', '==', salesOfficerId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    uid: d.id,
    ...d.data(),
  } as User));
};

export const createSalesOfficer = async (
  officerData: Partial<User> & { email: string; initialPassword?: string }
): Promise<string> => {
  const { initialPassword, ...rest } = officerData;
  const cleanData: any = { ...rest };
  Object.keys(cleanData).forEach((key) => {
    if (cleanData[key] === undefined) delete cleanData[key];
  });

  if (!initialPassword || !officerData.email) {
    throw new Error('Email and password are required to create Sales Officer');
  }

  const createStoreUser = httpsCallable(functions, 'createStoreUser');
  const result = await createStoreUser({
    email: officerData.email,
    password: initialPassword,
    storeData: {
      ...cleanData,
      role: 'salesOfficer',
    },
  });
  const data = result.data as any;
  return data.uid || data.id;
};

export type SalesOfficerProfileUpdate = {
  displayName?: string;
  phoneNumber?: string;
  town?: string;
  district?: string;
  deviceId?: string;
  devicePhoto?: string;
};

const MAX_DEVICE_PHOTO_BYTES = 5 * 1024 * 1024;

export const uploadSalesOfficerDevicePhoto = async (file: File): Promise<string> => {
  if (!auth.currentUser?.uid) {
    throw new Error('You must be signed in to upload a device photo.');
  }
  if (file.size > MAX_DEVICE_PHOTO_BYTES) {
    throw new Error('Device photo must be 5 MB or smaller.');
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'device.jpg';
  const uid = auth.currentUser.uid;
  const fileRef = ref(storage, `sales_officer_docs/${uid}/device/${Date.now()}_${safeName}`);
  await uploadBytes(fileRef, file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(fileRef);
};

/** Update Sales Officer profile fields on `users/{salesOfficerId}` (not email — that is Auth). */
export const updateSalesOfficerProfile = async (
  salesOfficerId: string,
  data: SalesOfficerProfileUpdate
): Promise<void> => {
  const ref = doc(db, 'users', salesOfficerId);
  const payload: Record<string, string | ReturnType<typeof deleteField>> = {};
  const setTrimmed = (key: keyof SalesOfficerProfileUpdate, required: boolean) => {
    if (data[key] === undefined) return;
    const value = String(data[key] ?? '').trim();
    if (value) payload[key] = value;
    else if (!required) payload[key] = deleteField();
    else payload[key] = '';
  };
  setTrimmed('displayName', false);
  setTrimmed('phoneNumber', true);
  setTrimmed('town', true);
  setTrimmed('district', true);
  setTrimmed('deviceId', true);
  setTrimmed('devicePhoto', false);
  if (Object.keys(payload).length === 0) return;
  await updateDoc(ref, payload);
};

export const sendSalesOfficerPasswordResetEmail = async (
  email: string
): Promise<{ message: string }> => {
  const fn = httpsCallable<
    { email: string },
    { success?: boolean; message?: string; emailSent?: boolean }
  >(functions, 'sendSalesOfficerPasswordResetEmail');
  const result = await fn({ email: email.trim() });
  const data = result.data;
  if (!data?.success) {
    throw new Error(data?.message || 'Failed to send password reset email');
  }
  return {
    message:
      data.message ||
      'Password reset link has been sent if SMTP is configured.',
  };
};
