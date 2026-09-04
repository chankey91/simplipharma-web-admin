import { collection, getDocs, query, where, doc, updateDoc, deleteField, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { User } from '../types';

export const getAreaManagers = async (): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(usersCol, where('role', '==', 'areaManager'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (d) =>
      ({
        id: d.id,
        uid: d.id,
        ...d.data(),
      }) as User
  );
};

export const getSalesOfficersByAreaManager = async (
  areaManagerId: string
): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(
    usersCol,
    where('role', '==', 'salesOfficer'),
    where('areaManagerId', '==', areaManagerId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (d) =>
      ({
        id: d.id,
        uid: d.id,
        ...d.data(),
      }) as User
  );
};

export const createAreaManager = async (
  managerData: Partial<User> & { email: string; initialPassword?: string }
): Promise<string> => {
  const { initialPassword, ...rest } = managerData;
  const cleanData: Record<string, unknown> = { ...rest };
  Object.keys(cleanData).forEach((key) => {
    if (cleanData[key] === undefined) delete cleanData[key];
  });

  if (!initialPassword || !managerData.email) {
    throw new Error('Email and password are required to create Area Manager');
  }

  const createStoreUser = httpsCallable(functions, 'createStoreUser');
  const result = await createStoreUser({
    email: managerData.email,
    password: initialPassword,
    storeData: {
      ...cleanData,
      role: 'areaManager',
    },
  });
  const data = result.data as { uid?: string; id?: string };
  return data.uid || data.id || '';
};

export type AreaManagerProfileUpdate = {
  displayName?: string;
  phoneNumber?: string;
  managedDistricts?: string[];
  managedTowns?: string[];
};

/** Update Area Manager profile fields on `users/{areaManagerId}` (not email). */
export const updateAreaManagerProfile = async (
  areaManagerId: string,
  data: AreaManagerProfileUpdate
): Promise<void> => {
  const ref = doc(db, 'users', areaManagerId);
  const payload: Record<string, unknown> = {};

  if (data.displayName !== undefined) {
    const value = String(data.displayName ?? '').trim();
    if (value) payload.displayName = value;
    else payload.displayName = deleteField();
  }
  if (data.phoneNumber !== undefined) {
    payload.phoneNumber = String(data.phoneNumber ?? '').trim();
  }
  if (data.managedDistricts !== undefined) {
    const districts = data.managedDistricts
      .map((d) => String(d || '').trim())
      .filter(Boolean);
    payload.managedDistricts = districts;
  }
  if (data.managedTowns !== undefined) {
    const towns = data.managedTowns.map((t) => String(t || '').trim()).filter(Boolean);
    if (towns.length > 0) payload.managedTowns = towns;
    else payload.managedTowns = deleteField();
  }

  if (Object.keys(payload).length === 0) return;
  await updateDoc(ref, payload);
};

/** Assign or clear Area Manager on a Sales Officer. */
export const assignSalesOfficerToAreaManager = async (
  salesOfficerId: string,
  areaManagerId: string | null
): Promise<void> => {
  const ref = doc(db, 'users', salesOfficerId);
  if (areaManagerId === null || areaManagerId === '') {
    await updateDoc(ref, { areaManagerId: deleteField() });
  } else {
    await updateDoc(ref, { areaManagerId });
  }
};

/**
 * Password reset for AM — reuses the SO reset callable (email-based Auth link).
 */
export const sendAreaManagerPasswordResetEmail = async (
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
