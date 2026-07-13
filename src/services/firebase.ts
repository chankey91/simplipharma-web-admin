import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  User as FirebaseUser,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { 
  getFirestore, 
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  where, 
  orderBy,
  limit,
  getCountFromServer,
  Timestamp,
  serverTimestamp,
  setDoc,
  getDoc,
  onSnapshot,
  deleteDoc,
  writeBatch,
  deleteField
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { canAccessPanel, type PanelRole } from '../auth/permissions';

// Firebase configuration (from Vite env — .env.dev for local, .env.prod / Jenkins .env for builds)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  throw new Error(
    'Missing Firebase env config. For local: ensure .env.dev exists and run `npm run dev` (mode=dev).'
  );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Enable a persistent IndexedDB cache so real-time listeners can re-attach and
// repeat/offline reads can be served locally instead of always round-tripping to
// Firestore. Falls back to the default in-memory cache when IndexedDB is
// unavailable (e.g. private browsing or unsupported environments).
let firestoreDb: ReturnType<typeof getFirestore>;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.warn('Firestore persistent cache unavailable; using default cache:', err);
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;
export const storage = getStorage(app);
// Initialize Functions with region (us-central1 is default, but explicit is better)
export const functions = getFunctions(app, 'us-central1');

// Auth helpers
export const login = async (email: string, password: string) => {
  return await signInWithEmailAndPassword(auth, email, password);
};

export const logout = async () => {
  return await signOut(auth);
};

export const onAuthChange = (callback: (user: FirebaseUser | null) => void) => {
  return onAuthStateChanged(auth, callback);
};

/** Password reset via Cloud Function + SMTP (same Gmail setup as vendor/store emails). */
export const sendPasswordReset = async (email: string): Promise<{ message: string }> => {
  const fn = httpsCallable<
    { email: string },
    { success?: boolean; message?: string; emailSent?: boolean }
  >(functions, 'sendPanelPasswordResetEmail');
  const result = await fn({ email: email.trim() });
  const data = result.data;
  if (!data?.success) {
    throw new Error(data?.message || 'Failed to send password reset email');
  }
  return { message: data.message || 'If this email is registered, you will receive a reset link shortly.' };
};

export const changeUserPassword = async (
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const user = auth.currentUser;
  if (!user?.email) {
    throw new Error('You must be signed in to change your password.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
  await updateDoc(doc(db, 'users', user.uid), {
    mustResetPassword: false,
    updatedAt: serverTimestamp(),
  });
};

/** Map Firebase Auth errors to short user-facing messages. */
export function getAuthErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/user-not-found':
      return 'No account found for this email.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Current password is incorrect.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'functions/failed-precondition':
      return (err as { message?: string }).message || 'Email could not be sent. Check SMTP configuration.';
    case 'functions/permission-denied':
      return (err as { message?: string }).message || 'Permission denied.';
    default: {
      const msg = (err as { message?: string })?.message;
      if (msg) return msg;
      return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
    }
  }
}

// User helpers
export const getUserProfile = async (userId: string): Promise<{ id: string; role?: string; [key: string]: any } | null> => {
  const userRef = doc(db, 'users', userId);
  const userDoc = await getDoc(userRef);
  
  if (userDoc.exists()) {
    const userData = { id: userDoc.id, ...userDoc.data() };
    console.log('User profile found:', userData);
    return userData;
  }
  console.log('No user profile found for userId:', userId);
  return null;
};

/** Web panel access: admin or operations. Does not auto-create profiles. */
export const getUserPanelRole = async (userId: string): Promise<PanelRole | null> => {
  try {
    const profile = await getUserProfile(userId);
    if (!profile?.role || !canAccessPanel(profile.role)) {
      return null;
    }
    if (profile.isActive === false) {
      return null;
    }
    return profile.role;
  } catch (error) {
    console.error('Error checking panel role:', error);
    return null;
  }
};

/** @deprecated Use getUserPanelRole — true only for admin. */
export const isUserAdmin = async (userId: string): Promise<boolean> => {
  const role = await getUserPanelRole(userId);
  if (role === 'admin') return true;

  try {
    const profile = await getUserProfile(userId);
    if (!profile) {
      console.warn('User profile does not exist in Firestore. Creating admin profile...');
      const userRef = doc(db, 'users', userId);
      await setDoc(
        userRef,
        { role: 'admin', createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true }
      );
      return true;
    }
    return profile.role === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

// Export Firestore utilities (db is already exported above, so don't export it again)
export { 
  Timestamp,
  serverTimestamp,
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  where, 
  orderBy,
  limit,
  getCountFromServer,
  setDoc, 
  getDoc, 
  onSnapshot, 
  deleteDoc,
  writeBatch,
  deleteField
};

