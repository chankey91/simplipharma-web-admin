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
  
  // Remove undefined values from data
  const cleanData: any = { ...data };
  Object.keys(cleanData).forEach(key => {
    if (cleanData[key] === undefined) {
      delete cleanData[key];
    }
  });
  
  await updateDoc(storeRef, cleanData);
};

export const createStore = async (storeData: Partial<User> & { initialPassword?: string }) => {
  let cloudFunctionSucceeded = false;
  let cloudFunctionError: string | null = null;
  
  // Try to use Cloud Function if password is provided (for user creation)
  if (storeData.initialPassword && storeData.email) {
    try {
      const createStoreUser = httpsCallable(functions, 'createStoreUser');
      // Remove undefined values and initialPassword from storeData before sending
      const { initialPassword, ...cleanStoreData } = storeData;
      const cleanData: any = { ...cleanStoreData };
      
      // Remove any undefined values
      Object.keys(cleanData).forEach(key => {
        if (cleanData[key] === undefined) {
          delete cleanData[key];
        }
      });
      
      const result = await createStoreUser({
        email: storeData.email,
        password: storeData.initialPassword,
        storeData: cleanData,
      });
      const data = result.data as any;
      cloudFunctionSucceeded = true;
      return data.uid || data.id;
    } catch (error: any) {
      // If Cloud Function doesn't exist or fails, fall back to Firestore-only
      const errorMessage = error.message || 'Unknown error';
      cloudFunctionError = errorMessage;
      console.warn('Cloud Function not available or failed, creating Firestore document only:', errorMessage);
      
      // Check if it's a permission error or function not found
      if (error.code === 'functions/not-found' || errorMessage.includes('not found')) {
        console.warn('Cloud Function "createStoreUser" is not deployed. Please deploy Firebase Cloud Functions to enable email sending.');
      } else if (error.code === 'functions/permission-denied') {
        console.warn('Permission denied. Make sure you are logged in as an admin user.');
      } else {
        console.warn('Cloud Function error:', errorMessage);
      }
      
      // Continue to Firestore-only creation below (don't throw, let it fall through)
    }
  }

  // Fallback: Create Firestore document only (user will need to be created separately)
  const storeRef = doc(collection(db, 'users'));
  
  // Remove undefined values and initialPassword from storeData
  const { initialPassword, ...cleanStoreData } = storeData;
  const newStore: any = {
    ...cleanStoreData,
    role: 'retailer',
    createdAt: Timestamp.now(),
    isActive: cleanStoreData.isActive !== undefined ? cleanStoreData.isActive : true,
    mustResetPassword: true, // Force password reset on first login
  };
  
  // Remove any undefined values from the object
  Object.keys(newStore).forEach(key => {
    if (newStore[key] === undefined) {
      delete newStore[key];
    }
  });
  
  await setDoc(storeRef, newStore);
  
  // If Cloud Function failed, throw an error with the password info so UI can display it
  if (!cloudFunctionSucceeded && cloudFunctionError) {
    const error = new Error(`Cloud Function not available: ${cloudFunctionError}. Store created in Firestore, but email was not sent.`) as any;
    error.storeCreated = true;
    error.storeId = storeRef.id;
    error.password = initialPassword;
    error.email = storeData.email;
    throw error;
  }
  
  return storeRef.id;
};

export const toggleStoreStatus = async (storeId: string, isActive: boolean) => {
  await updateStore(storeId, { isActive });
};

export const resetStorePassword = async (storeId: string) => {
  await updateStore(storeId, { mustResetPassword: true });
};
