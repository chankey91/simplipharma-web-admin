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

// Firebase configuration (same as mobile app)
const firebaseConfig = {
  apiKey: "AIzaSyCFtUVHKtADWllccdnlbougsnsntEUHQDA",
  authDomain: "simplipharma.firebaseapp.com",
  projectId: "simplipharma",
  storageBucket: "simplipharma.firebasestorage.app",
  messagingSenderId: "343720215451",
  appId: "1:343720215451:android:d2576ba41a99a5681e973e"
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
    return { id: userDoc.id, ...userDoc.data() };
  }
  return null;
};

export const isUserAdmin = async (userId: string): Promise<boolean> => {
  try {
    const profile = await getUserProfile(userId);
    return profile?.role === 'admin';
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

