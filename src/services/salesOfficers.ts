import { collection, getDocs, query, where, doc, updateDoc, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
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

/** Update Sales Officer profile fields on `users/{salesOfficerId}` (not email — that is Auth). */
export const updateSalesOfficerProfile = async (
  salesOfficerId: string,
  data: { displayName?: string; phoneNumber?: string }
): Promise<void> => {
  const ref = doc(db, 'users', salesOfficerId);
  const payload: Record<string, string> = {};
  if (data.displayName !== undefined) payload.displayName = data.displayName.trim();
  if (data.phoneNumber !== undefined) payload.phoneNumber = data.phoneNumber.trim();
  if (Object.keys(payload).length === 0) return;
  await updateDoc(ref, payload);
};
