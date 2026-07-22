import { collection, getDocs, query, where, doc, updateDoc, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { User } from '../types';

export const getPurchaseOfficers = async (): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(usersCol, where('role', '==', 'purchaseOfficer'));
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

export const createPurchaseOfficer = async (
  officerData: Partial<User> & {
    email: string;
    initialPassword?: string;
    firstName?: string;
    lastName?: string;
  }
): Promise<string> => {
  const { initialPassword, firstName, lastName, ...rest } = officerData;
  const cleanData: Record<string, unknown> = { ...rest };
  Object.keys(cleanData).forEach((key) => {
    if (cleanData[key] === undefined) delete cleanData[key];
  });

  if (!initialPassword || !officerData.email) {
    throw new Error('Email and password are required to create Purchase Officer');
  }

  const displayName =
    officerData.displayName?.trim() ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    officerData.email;

  const createStoreUser = httpsCallable(functions, 'createStoreUser');
  const result = await createStoreUser({
    email: officerData.email,
    password: initialPassword,
    storeData: {
      ...cleanData,
      firstName: firstName?.trim() || undefined,
      lastName: lastName?.trim() || undefined,
      displayName,
      role: 'purchaseOfficer',
    },
  });
  const data = result.data as { uid?: string; id?: string };
  return data.uid || data.id || '';
};

export const updatePurchaseOfficerProfile = async (
  purchaseOfficerId: string,
  data: { displayName?: string; phoneNumber?: string; firstName?: string; lastName?: string }
): Promise<void> => {
  const ref = doc(db, 'users', purchaseOfficerId);
  const payload: Record<string, string> = {};
  if (data.firstName !== undefined) payload.firstName = data.firstName.trim();
  if (data.lastName !== undefined) payload.lastName = data.lastName.trim();
  if (data.displayName !== undefined) payload.displayName = data.displayName.trim();
  if (data.phoneNumber !== undefined) payload.phoneNumber = data.phoneNumber.trim();
  if (Object.keys(payload).length === 0) return;
  await updateDoc(ref, payload);
};

export const sendPurchaseOfficerPasswordResetEmail = async (
  email: string
): Promise<{ message: string }> => {
  const fn = httpsCallable<
    { email: string },
    { success?: boolean; message?: string; emailSent?: boolean }
  >(functions, 'sendPurchaseOfficerPasswordResetEmail');
  const result = await fn({ email: email.trim() });
  const data = result.data;
  if (!data?.success) {
    throw new Error(data?.message || 'Failed to send password reset email');
  }
  return {
    message:
      data.message || 'Password reset link has been sent if SMTP is configured.',
  };
};
