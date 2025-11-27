import { collection, getDocs, doc, updateDoc, setDoc, query, where, Timestamp, db } from './firebase';
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

export const createStore = async (storeData: Omit<User, 'id' | 'uid'>) => {
  // Note: For creating users with authentication, you'll need Firebase Admin SDK
  // This is a placeholder - you may need to use your mobile app's createUserAccount function
  // or implement a Cloud Function
  const storeRef = doc(collection(db, 'users'));
  await setDoc(storeRef, {
    ...storeData,
    role: 'retailer',
    createdAt: Timestamp.now(),
    isActive: true
  });
  return storeRef.id;
};

export const toggleStoreStatus = async (storeId: string, isActive: boolean) => {
  await updateStore(storeId, { isActive });
};

