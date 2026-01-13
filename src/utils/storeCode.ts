import { collection, query, where, getDocs, orderBy, db } from '../services/firebase';
import { limit } from 'firebase/firestore';

/**
 * Generate next unique store code
 * Format: MS + 001 (incrementing)
 * Example: MS001, MS002, MS003, etc.
 */
export const generateStoreCode = async (): Promise<string> => {
  const prefix = 'MS';
  
  // Query all stores with codes starting with MS, ordered by storeCode descending
  const usersCol = collection(db, 'users');
  const q = query(
    usersCol,
    where('role', '==', 'retailer'),
    where('storeCode', '>=', prefix),
    where('storeCode', '<', prefix + '999'),
    orderBy('storeCode', 'desc'),
    limit(1)
  );
  
  try {
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      // First store
      return `${prefix}001`;
    }
    
    // Get the highest store code
    const lastStoreCode = snapshot.docs[0].data().storeCode as string;
    if (!lastStoreCode || !lastStoreCode.startsWith(prefix)) {
      return `${prefix}001`;
    }
    
    const lastNumber = parseInt(lastStoreCode.slice(prefix.length), 10);
    if (isNaN(lastNumber)) {
      return `${prefix}001`;
    }
    
    const nextNumber = lastNumber + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  } catch (error) {
    // If query fails (e.g., no index), try to get all and filter in memory
    console.warn('Store code query failed, using fallback:', error);
    const allSnapshot = await getDocs(query(usersCol, where('role', '==', 'retailer')));
    const matchingStores = allSnapshot.docs
      .map((doc: any) => doc.data().storeCode as string)
      .filter((code: string) => code && code.startsWith(prefix))
      .sort()
      .reverse();
    
    if (matchingStores.length === 0) {
      return `${prefix}001`;
    }
    
    const lastNumber = parseInt(matchingStores[0].slice(prefix.length), 10);
    if (isNaN(lastNumber)) {
      return `${prefix}001`;
    }
    
    const nextNumber = lastNumber + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  }
};

