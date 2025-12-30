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

export const checkPhoneUnique = async (phoneNumber: string, excludeId?: string): Promise<boolean> => {
  if (!phoneNumber) return true;
  const vendorsCol = collection(db, 'vendors');
  const q = query(vendorsCol, where('phoneNumber', '==', phoneNumber));
  const snapshot = await getDocs(q);
  return snapshot.docs.every(d => !excludeId || d.id !== excludeId);
};

export const createVendor = async (vendorData: Omit<Vendor, 'id'>) => {
  // Check phone number uniqueness
  if (vendorData.phoneNumber) {
    const isPhoneUnique = await checkPhoneUnique(vendorData.phoneNumber);
    if (!isPhoneUnique) {
      throw new Error('Phone Number already exists');
    }
  }
  
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
  
  // Clean up undefined values for optional fields
  const cleanedData: any = {
    vendorName: vendorData.vendorName,
    email: vendorData.email || '',
    phoneNumber: vendorData.phoneNumber,
    gstNumber: vendorData.gstNumber,
    isActive: vendorData.isActive !== false,
    createdAt: Timestamp.now(),
  };
  
  // Add optional fields only if they have values
  if (vendorData.contactPerson) cleanedData.contactPerson = vendorData.contactPerson;
  if (vendorData.address) cleanedData.address = vendorData.address;
  if (vendorData.drugLicenseNumber) cleanedData.drugLicenseNumber = vendorData.drugLicenseNumber;
  if (vendorData.pan) cleanedData.pan = vendorData.pan;
  if (vendorData.bankDetails) {
    const bankDetails: any = {};
    if (vendorData.bankDetails.accountNumber) bankDetails.accountNumber = vendorData.bankDetails.accountNumber;
    if (vendorData.bankDetails.ifscCode) bankDetails.ifscCode = vendorData.bankDetails.ifscCode;
    if (vendorData.bankDetails.bankName) bankDetails.bankName = vendorData.bankDetails.bankName;
    if (Object.keys(bankDetails).length > 0) cleanedData.bankDetails = bankDetails;
  }
  
  const vendorRef = doc(collection(db, 'vendors'));
  await setDoc(vendorRef, cleanedData);
  return vendorRef.id;
};

export const updateVendor = async (vendorId: string, vendorData: Partial<Vendor>) => {
  const vendorRef = doc(db, 'vendors', vendorId);
  
  // Check phone number uniqueness if being updated
  if (vendorData.phoneNumber) {
    const isPhoneUnique = await checkPhoneUnique(vendorData.phoneNumber, vendorId);
    if (!isPhoneUnique) {
      throw new Error('Phone Number already exists');
    }
  }
  
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
  
  // Clean up undefined values for optional fields
  const cleanedData: any = {};
  Object.keys(vendorData).forEach(key => {
    const value = (vendorData as any)[key];
    if (value !== undefined && value !== null && value !== '') {
      if (key === 'bankDetails' && typeof value === 'object') {
        const bankDetails: any = {};
        if (value.accountNumber) bankDetails.accountNumber = value.accountNumber;
        if (value.ifscCode) bankDetails.ifscCode = value.ifscCode;
        if (value.bankName) bankDetails.bankName = value.bankName;
        if (Object.keys(bankDetails).length > 0) cleanedData.bankDetails = bankDetails;
      } else {
        cleanedData[key] = value;
      }
    }
  });
  
  await updateDoc(vendorRef, cleanedData);
};

export const toggleVendorStatus = async (vendorId: string, isActive: boolean) => {
  await updateVendor(vendorId, { isActive });
};

