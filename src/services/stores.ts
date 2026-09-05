import {
  collection,
  getDocs,
  doc,
  updateDoc,
  setDoc,
  getDoc,
  query,
  where,
  Timestamp,
  serverTimestamp,
  deleteField,
  writeBatch,
  db,
  functions,
  auth,
} from './firebase';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { User } from '../types';
import { formatStoreCode, generateStoreCode, getMaxStoreCodeNumber, parseStoreCodeNumber } from '../utils/storeCode';
import { ORDER_BLOCK_OVERRIDE_MS } from '../utils/retailerPaymentBlock';

/**
 * Collections that stamp denormalized `salesOfficerId` for SO-app queries.
 * Typesense orders sync via onWrite when `orders` docs change — no full reindex needed.
 */
const RETAILER_SO_HISTORY_COLLECTIONS = [
  'orders',
  'so_visit_logs',
  'order_return_requests',
  'expiry_return_requests',
  'payment_requests',
] as const;

export type RetailerSoMigrationCounts = Record<
  (typeof RETAILER_SO_HISTORY_COLLECTIONS)[number],
  number
>;

const FIRESTORE_BATCH_LIMIT = 400;

async function commitSalesOfficerIdUpdates(
  docs: QueryDocumentSnapshot[],
  salesOfficerId: string | null
): Promise<number> {
  const next = (salesOfficerId || '').trim();
  let updated = 0;
  let batch = writeBatch(db);
  let ops = 0;

  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  for (const d of docs) {
    const current = String(d.data()?.salesOfficerId || '').trim();
    if (current === next) continue;
    if (next) {
      batch.update(d.ref, { salesOfficerId: next });
    } else {
      batch.update(d.ref, { salesOfficerId: deleteField() });
    }
    ops += 1;
    updated += 1;
    if (ops >= FIRESTORE_BATCH_LIMIT) {
      await flush();
    }
  }
  await flush();
  return updated;
}

/**
 * Move (or clear) historical SO-scoped docs for a retailer so the field app
 * shows deliveries / visits / returns under the newly assigned officer.
 */
export async function migrateRetailerSalesOfficerHistory(
  retailerUserId: string,
  salesOfficerId: string | null
): Promise<RetailerSoMigrationCounts> {
  const rid = retailerUserId.trim();
  if (!rid) {
    throw new Error('Retailer id is required to migrate SO history');
  }

  const counts = {} as RetailerSoMigrationCounts;
  for (const name of RETAILER_SO_HISTORY_COLLECTIONS) {
    const snap = await getDocs(query(collection(db, name), where('retailerId', '==', rid)));
    counts[name] = await commitSalesOfficerIdUpdates(snap.docs, salesOfficerId);
  }
  return counts;
}

function toJsDate(v: unknown): Date | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v;
  if (typeof (v as { toDate?: () => Date })?.toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : undefined;
  }
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? undefined : d;
}

function mapStoreDoc(docSnap: { id: string; data: () => Record<string, unknown> }): User {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    uid: docSnap.id,
    ...data,
    orderBlockOverrideUntil: toJsDate(data.orderBlockOverrideUntil) ?? data.orderBlockOverrideUntil,
    orderBlockOverrideAt: toJsDate(data.orderBlockOverrideAt) ?? data.orderBlockOverrideAt,
  } as User;
}

export const getAllStores = async (): Promise<User[]> => {
  const usersCol = collection(db, 'users');
  const q = query(usersCol, where('role', '==', 'retailer'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => mapStoreDoc(d));
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

  // Auto-assign store code when the retailer still has none.
  const incomingCode =
    typeof cleanData.storeCode === 'string' ? cleanData.storeCode.trim() : '';
  if (incomingCode) {
    cleanData.storeCode = incomingCode;
  } else {
    delete cleanData.storeCode;
    try {
      const existing = await getDoc(storeRef);
      const existingCode = String(existing.data()?.storeCode || '').trim();
      if (!existingCode) {
        cleanData.storeCode = await generateStoreCode();
      }
    } catch (error) {
      console.error('Failed to auto-generate store code on update:', error);
    }
  }

  if (Object.keys(cleanData).length === 0) {
    return;
  }

  // When SO assignment changes via Stores edit, move historical territory docs too.
  if (Object.prototype.hasOwnProperty.call(cleanData, 'salesOfficerId')) {
    const existing = await getDoc(storeRef);
    const previousSo = String(existing.data()?.salesOfficerId || '').trim();
    const rawNext = cleanData.salesOfficerId;
    const nextSo =
      rawNext == null || rawNext === ''
        ? null
        : String(rawNext).trim() || null;
    if (previousSo !== (nextSo || '')) {
      if (nextSo == null) {
        cleanData.salesOfficerId = deleteField();
      } else {
        cleanData.salesOfficerId = nextSo;
      }
      await migrateRetailerSalesOfficerHistory(storeId, nextSo);
    }
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

/** Temporarily allow a payment-blocked retailer to place orders for 6 hours. */
export const grantOrderBlockOverride = async (storeId: string): Promise<Date> => {
  const until = new Date(Date.now() + ORDER_BLOCK_OVERRIDE_MS);
  const storeRef = doc(db, 'users', storeId);
  await updateDoc(storeRef, {
    orderBlockOverrideUntil: Timestamp.fromDate(until),
    orderBlockOverrideAt: serverTimestamp(),
    orderBlockOverrideBy: auth.currentUser?.uid || null,
  });
  return until;
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
): Promise<RetailerSoMigrationCounts> => {
  const nextSo =
    salesOfficerId === null || salesOfficerId === '' ? null : salesOfficerId.trim();
  // Migrate history first so the SO app never briefly shows a retailer without its orders.
  const migration = await migrateRetailerSalesOfficerHistory(retailerUserId, nextSo);
  const storeRef = doc(db, 'users', retailerUserId);
  if (nextSo == null) {
    await updateDoc(storeRef, { salesOfficerId: deleteField() });
  } else {
    await updateDoc(storeRef, { salesOfficerId: nextSo });
  }
  return migration;
};

export type BackfillStoreCodesResult = {
  scanned: number;
  assigned: number;
  skipped: number;
  assignments: Array<{ storeId: string; shopName: string; storeCode: string }>;
};

/**
 * Assign MS### codes to every retailer missing storeCode (one-shot repair).
 * Uses a single snapshot so codes stay unique within the run.
 */
export const backfillMissingStoreCodes = async (): Promise<BackfillStoreCodesResult> => {
  const stores = await getAllStores();
  let max = 0;
  const missing: User[] = [];

  for (const store of stores) {
    const code = String(store.storeCode || '').trim();
    if (!code) {
      missing.push(store);
      continue;
    }
    const n = parseStoreCodeNumber(code);
    if (n != null && n > max) max = n;
  }

  // Prefer live max in case of codes outside this client cache shape.
  try {
    const liveMax = await getMaxStoreCodeNumber();
    if (liveMax > max) max = liveMax;
  } catch {
    // keep snapshot max
  }

  const assignments: BackfillStoreCodesResult['assignments'] = [];
  let next = max;

  for (const store of missing) {
    next += 1;
    const storeCode = formatStoreCode(next);
    await updateDoc(doc(db, 'users', store.id), { storeCode });
    assignments.push({
      storeId: store.id,
      shopName: store.shopName || store.displayName || store.email || store.id,
      storeCode,
    });
  }

  return {
    scanned: stores.length,
    assigned: assignments.length,
    skipped: stores.length - assignments.length,
    assignments,
  };
};
