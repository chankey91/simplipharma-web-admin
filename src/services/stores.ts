import { collection, getDocs, doc, updateDoc, setDoc, query, where, Timestamp, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { User } from '../types';

export const getAllStores = async (): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(usersCol, where('role', '==', 'retailer'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    uid: doc.id,
    ...doc.data()
  } as User));
};

export const updateStore = async (storeId: string, data: Partial<User>) => {
  const storeRef = doc(db, 'users', storeId);
  await updateDoc(storeRef, data);
};

export const createStore = async (storeData: Partial<User> & { initialPassword?: string }) => {
  // Try to use Cloud Function if password is provided (for user creation)
  if (storeData.initialPassword && storeData.email) {
    try {
      const createStoreUser = httpsCallable(functions, 'createStoreUser');
      const result = await createStoreUser({
        email: storeData.email,
        password: storeData.initialPassword,
        storeData: {
          ...storeData,
          initialPassword: undefined, // Don't send password in storeData
        },
      });
      const data = result.data as any;
      return data.uid || data.id;
    } catch (error: any) {
      // If Cloud Function doesn't exist or fails, fall back to Firestore-only
      console.warn('Cloud Function not available, creating Firestore document only:', error.message);
      // Continue to Firestore-only creation below
    }
  }

  // Fallback: Create Firestore document only (user will need to be created separately)
  const storeRef = doc(collection(db, 'users'));
  const newStore = {
    ...storeData,
    initialPassword: undefined, // Don't store password
    role: 'retailer',
    createdAt: Timestamp.now(),
    isActive: true,
    mustResetPassword: true, // Force password reset on first login
  };
  
  await setDoc(storeRef, newStore);
  return storeRef.id;
};

export const toggleStoreStatus = async (storeId: string, isActive: boolean) => {
  await updateStore(storeId, { isActive });
};

export const resetStorePassword = async (storeId: string) => {
  await updateStore(storeId, { mustResetPassword: true });
};
