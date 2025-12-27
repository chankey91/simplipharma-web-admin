import { collection, getDocs, doc, updateDoc, setDoc, query, where, Timestamp, db, getDoc } from './firebase';
import { Vendor } from '../types';

export const getAllVendors = async (): Promise<Vendor[]> => {
  const vendorsCol = collection(db, 'vendors');
  const snapshot = await getDocs(vendorsCol);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as Vendor));
};

export const getVendorById = async (vendorId: string): Promise<Vendor | null> => {
  const vendorRef = doc(db, 'vendors', vendorId);
  const vendorDoc = await getDoc(vendorRef);
  
  if (!vendorDoc.exists()) return null;
  
  return {
    id: vendorDoc.id,
    ...vendorDoc.data()
  } as Vendor;
};

export const checkGSTUnique = async (gstNumber: string, excludeId?: string): Promise<boolean> => {
  if (!gstNumber) return true;
  const vendorsCol = collection(db, 'vendors');
  const q = query(vendorsCol, where('gstNumber', '==', gstNumber));
  const snapshot = await getDocs(q);
  return snapshot.docs.every(d => !excludeId || d.id !== excludeId);
};

export const checkLicenseUnique = async (licenseNumber: string, excludeId?: string): Promise<boolean> => {
  if (!licenseNumber) return true;
  const vendorsCol = collection(db, 'vendors');
  const q = query(vendorsCol, where('drugLicenseNumber', '==', licenseNumber));
  const snapshot = await getDocs(q);
  return snapshot.docs.every(d => !excludeId || d.id !== excludeId);
};

export const createVendor = async (vendorData: Omit<Vendor, 'id'>) => {
  // Check GST uniqueness
  if (vendorData.gstNumber) {
    const isGSTUnique = await checkGSTUnique(vendorData.gstNumber);
    if (!isGSTUnique) {
      throw new Error('GST Number already exists');
    }
  }
  
  // Check License uniqueness
  if (vendorData.drugLicenseNumber) {
    const isLicenseUnique = await checkLicenseUnique(vendorData.drugLicenseNumber);
    if (!isLicenseUnique) {
      throw new Error('Drug License Number already exists');
    }
  }
  
  const vendorRef = doc(collection(db, 'vendors'));
  await setDoc(vendorRef, {
    ...vendorData,
    createdAt: Timestamp.now(),
    isActive: vendorData.isActive !== false
  });
  return vendorRef.id;
};

export const updateVendor = async (vendorId: string, vendorData: Partial<Vendor>) => {
  const vendorRef = doc(db, 'vendors', vendorId);
  
  // Check GST uniqueness if being updated
  if (vendorData.gstNumber) {
    const isGSTUnique = await checkGSTUnique(vendorData.gstNumber, vendorId);
    if (!isGSTUnique) {
      throw new Error('GST Number already exists');
    }
  }
  
  // Check License uniqueness if being updated
  if (vendorData.drugLicenseNumber) {
    const isLicenseUnique = await checkLicenseUnique(vendorData.drugLicenseNumber, vendorId);
    if (!isLicenseUnique) {
      throw new Error('Drug License Number already exists');
    }
  }
  
  await updateDoc(vendorRef, vendorData);
};

export const toggleVendorStatus = async (vendorId: string, isActive: boolean) => {
  await updateVendor(vendorId, { isActive });
};

