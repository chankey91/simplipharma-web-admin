import { initializeApp } from 'firebase/app';
import { 
  getAuth,
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  where, 
  orderBy,
  Timestamp,
  setDoc,
  getDoc,
  onSnapshot,
  deleteDoc
} from 'firebase/firestore';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

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

export const isUserAdmin = async (userId: string): Promise<boolean> => {
  try {
    console.log('Checking admin status for userId:', userId);
    const profile = await getUserProfile(userId);
    
    if (!profile) {
      console.warn('User profile does not exist in Firestore. Creating admin profile...');
      // Auto-create admin profile if it doesn't exist
      const userRef = doc(db, 'users', userId);
      const newProfile = {
        role: 'admin',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };
      await setDoc(userRef, newProfile, { merge: true });
      console.log('Admin profile created successfully');
      return true;
    }
    
    const isAdmin = profile.role === 'admin';
    console.log('Is admin?', isAdmin, '| Role:', profile.role);
    return isAdmin;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

// Export Firestore utilities (db is already exported above, so don't export it again)
export { 
  Timestamp, 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  where, 
  orderBy, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  deleteDoc
};

