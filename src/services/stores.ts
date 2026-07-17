import { collection, getDocs, doc, updateDoc, setDoc, query, where, Timestamp, serverTimestamp, deleteField, db, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { User } from '../types';
import { generateStoreCode } from '../utils/storeCode';

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

/**
 * Admin only: change retailer login email in Firebase Auth + Firestore.
 * Requires the `updateRetailerEmail` Cloud Function to be deployed.
 */
export const updateRetailerEmail = async (
  retailerUserId: string,
  newEmail: string
): Promise<{ email: string }> => {
  const fn = httpsCallable<
    { retailerUserId: string; newEmail: string },
    { success?: boolean; email?: string; unchanged?: boolean }
  >(functions, 'updateRetailerEmail');
  const result = await fn({ retailerUserId, newEmail: newEmail.trim() });
  const data = result.data;
  if (!data?.success) {
    throw new Error('Failed to update retailer email');
  }
  return { email: data.email || newEmail.trim() };
};

export const updateStore = async (
  storeId: string,
  data: Partial<User>,
  options?: { previousEmail?: string }
) => {
  const storeRef = doc(db, 'users', storeId);

  // Remove undefined values from data
  const cleanData: any = { ...data };
  Object.keys(cleanData).forEach((key) => {
    if (cleanData[key] === undefined) {
      delete cleanData[key];
    }
  });

  const newEmail = typeof cleanData.email === 'string' ? cleanData.email.trim() : '';
  const previousEmail = options?.previousEmail?.trim() || '';
  if (
    newEmail &&
    previousEmail &&
    newEmail.toLowerCase() !== previousEmail.toLowerCase()
  ) {
    await updateRetailerEmail(storeId, newEmail);
    cleanData.email = newEmail;
  }

  if (Object.keys(cleanData).length === 0) {
    return;
  }

  await updateDoc(storeRef, cleanData);
};

export const createStore = async (storeData: Partial<User> & { initialPassword?: string }) => {
  const email = storeData.email?.trim();
  if (!email) {
    throw new Error('Email address is required to create a store');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address');
  }

  let cloudFunctionSucceeded = false;
  let cloudFunctionError: string | null = null;
  
  // Try to use Cloud Function if password is provided (for user creation)
  if (storeData.initialPassword && email) {
    try {
      const createStoreUser = httpsCallable(functions, 'createStoreUser');
      // Remove undefined values and initialPassword from storeData before sending
      const { initialPassword, ...cleanStoreData } = storeData;
      const cleanData: any = { ...cleanStoreData };
      
      // Generate unique store code if not provided
      let storeCode = storeData.storeCode;
      if (!storeCode) {
        try {
          storeCode = await generateStoreCode();
          console.log(`Generated store code: ${storeCode}`);
        } catch (error) {
          console.error('Failed to generate store code:', error);
          // Continue without store code if generation fails
        }
      }
      
      // Add store code to cleanData if generated
      if (storeCode) {
        cleanData.storeCode = storeCode;
      }
      
      // Remove any undefined values
      Object.keys(cleanData).forEach(key => {
        if (cleanData[key] === undefined) {
          delete cleanData[key];
        }
      });
      
      const result = await createStoreUser({
        email,
        password: storeData.initialPassword,
        storeData: {
          ...cleanData,
          role: 'retailer',
          salesOfficerId: cleanData.salesOfficerId || undefined,
        },
      });
      const data = result.data as any;
      cloudFunctionSucceeded = true;
      return { uid: data.uid || data.id, emailSent: data.emailSent === true };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      const errorCode = String(error.code || '');
      const isEmailAlreadyUsed =
        errorCode === 'functions/already-exists' ||
        /already in use/i.test(errorMessage) ||
        /already registered/i.test(errorMessage);

      // Do not create a Firestore-only orphan when Auth rejected the email.
      if (isEmailAlreadyUsed) {
        throw new Error(
          errorMessage.includes('already')
            ? errorMessage
            : 'This email is already registered. Use a different email or update the existing retailer account.'
        );
      }

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
  
  // Generate unique store code if not provided
  let storeCode = storeData.storeCode;
  if (!storeCode) {
    try {
      storeCode = await generateStoreCode();
      console.log(`Generated store code: ${storeCode}`);
    } catch (error) {
      console.error('Failed to generate store code:', error);
      // Continue without store code if generation fails
    }
  }
  
  // Remove undefined values and initialPassword from storeData
  const { initialPassword, ...cleanStoreData } = storeData;
  const newStore: any = {
    ...cleanStoreData,
    email,
    role: 'retailer',
    createdAt: serverTimestamp(),
    isActive: cleanStoreData.isActive !== undefined ? cleanStoreData.isActive : true,
    mustResetPassword: true,
    ...(cleanStoreData.salesOfficerId && { salesOfficerId: cleanStoreData.salesOfficerId }),
  };
  
  // Add store code if generated
  if (storeCode) {
    newStore.storeCode = storeCode;
  }
  
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
    error.email = email;
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

/**
 * Admin/operations: email a password reset link to a retailer's mobile app account.
 * Backed by the `sendRetailerPasswordResetEmail` Cloud Function (Firebase Auth reset link).
 */
export const sendRetailerPasswordResetEmail = async (
  email: string
): Promise<{ message: string }> => {
  const fn = httpsCallable<
    { email: string },
    { success?: boolean; message?: string; emailSent?: boolean }
  >(functions, 'sendRetailerPasswordResetEmail');
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

/** Set or clear which Sales Officer manages this retailer (`users` doc, role retailer). */
export const assignRetailerToSalesOfficer = async (
  retailerUserId: string,
  salesOfficerId: string | null
): Promise<void> => {
  const storeRef = doc(db, 'users', retailerUserId);
  if (salesOfficerId === null || salesOfficerId === '') {
    await updateDoc(storeRef, { salesOfficerId: deleteField() });
  } else {
    await updateDoc(storeRef, { salesOfficerId });
  }
};
