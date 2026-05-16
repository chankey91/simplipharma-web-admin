import { collection, getDocs, query, where, doc, updateDoc, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { User } from '../types';

export const getOperationsUsers = async (): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(usersCol, where('role', '==', 'operations'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    uid: d.id,
    ...d.data(),
  } as User));
};

export const createOperationsUser = async (
  userData: Partial<User> & { email: string; initialPassword?: string }
): Promise<string> => {
  const { initialPassword, ...rest } = userData;
  const cleanData: Record<string, unknown> = { ...rest };
  Object.keys(cleanData).forEach((key) => {
    if (cleanData[key] === undefined) delete cleanData[key];
  });

  if (!initialPassword || !userData.email) {
    throw new Error('Email and password are required to create an operations user');
  }

  const createStoreUser = httpsCallable(functions, 'createStoreUser');
  const result = await createStoreUser({
    email: userData.email,
    password: initialPassword,
    storeData: {
      ...cleanData,
      role: 'operations',
    },
  });
  const data = result.data as { uid?: string; id?: string };
  return data.uid || data.id || '';
};

export const updateOperationsUserProfile = async (
  userId: string,
  data: { displayName?: string; phoneNumber?: string; isActive?: boolean }
): Promise<void> => {
  const ref = doc(db, 'users', userId);
  const payload: Record<string, string | boolean> = {};
  if (data.displayName !== undefined) payload.displayName = data.displayName.trim();
  if (data.phoneNumber !== undefined) payload.phoneNumber = data.phoneNumber.trim();
  if (data.isActive !== undefined) payload.isActive = data.isActive;
  if (Object.keys(payload).length === 0) return;
  await updateDoc(ref, payload);
};
