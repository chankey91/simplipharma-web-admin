import { collection, getDocs, query, where, doc, updateDoc, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { User } from '../types';
import {
  defaultHomePath,
  defaultMenuPaths,
  defaultWriteAccess,
  type PanelRole,
  type WriteAccess,
} from '../auth/permissions';

export const getOperationsUsers = async (): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(usersCol, where('role', 'in', ['operations', 'office']));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    uid: d.id,
    ...d.data(),
  } as User));
};

export type CreatePanelUserInput = Partial<User> & {
  email: string;
  initialPassword?: string;
  role?: 'operations' | 'office';
  menuPaths?: string[];
  writeAccess?: WriteAccess;
  homePath?: string;
};

export const createOperationsUser = async (userData: CreatePanelUserInput): Promise<string> => {
  const { initialPassword, ...rest } = userData;
  const role: Extract<PanelRole, 'operations' | 'office'> =
    rest.role === 'office' ? 'office' : 'operations';
  const cleanData: Record<string, unknown> = { ...rest };
  Object.keys(cleanData).forEach((key) => {
    if (cleanData[key] === undefined) delete cleanData[key];
  });

  if (!initialPassword || !userData.email) {
    throw new Error('Email and password are required to create a panel user');
  }

  const menuPaths = userData.menuPaths?.length ? userData.menuPaths : defaultMenuPaths(role);
  const writeAccess = userData.writeAccess || defaultWriteAccess(role);
  const homePath = userData.homePath || defaultHomePath(role);

  const createStoreUser = httpsCallable(functions, 'createStoreUser');
  const result = await createStoreUser({
    email: userData.email,
    password: initialPassword,
    storeData: {
      ...cleanData,
      role,
      menuPaths,
      writeAccess,
      homePath,
    },
  });
  const data = result.data as { uid?: string; id?: string };
  return data.uid || data.id || '';
};

export type UpdatePanelUserProfile = {
  displayName?: string;
  phoneNumber?: string;
  isActive?: boolean;
  role?: 'operations' | 'office';
  menuPaths?: string[];
  writeAccess?: WriteAccess;
  homePath?: string;
};

export const updateOperationsUserProfile = async (
  userId: string,
  data: UpdatePanelUserProfile
): Promise<void> => {
  const ref = doc(db, 'users', userId);
  const payload: Record<string, unknown> = {};
  if (data.displayName !== undefined) payload.displayName = data.displayName.trim();
  if (data.phoneNumber !== undefined) payload.phoneNumber = data.phoneNumber.trim();
  if (data.isActive !== undefined) payload.isActive = data.isActive;
  if (data.role !== undefined) payload.role = data.role;
  if (data.menuPaths !== undefined) payload.menuPaths = data.menuPaths;
  if (data.writeAccess !== undefined) payload.writeAccess = data.writeAccess;
  if (data.homePath !== undefined) payload.homePath = data.homePath;
  if (Object.keys(payload).length === 0) return;
  await updateDoc(ref, payload);
};
