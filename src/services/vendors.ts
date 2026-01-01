import { collection, getDocs, doc, updateDoc, setDoc, query, where, Timestamp, db, getDoc } from './firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Vendor } from '../types';
import { functions } from './firebase';

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

export const createVendor = async (vendorData: Omit<Vendor, 'id'> & { password?: string }) => {
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
  
  // Handle bankDetails - only add if at least one field has a value
  if (vendorData.bankDetails) {
    const bankDetails: any = {};
    if (vendorData.bankDetails.accountNumber && vendorData.bankDetails.accountNumber.trim() !== '') {
      bankDetails.accountNumber = vendorData.bankDetails.accountNumber;
    }
    if (vendorData.bankDetails.ifscCode && vendorData.bankDetails.ifscCode.trim() !== '') {
      bankDetails.ifscCode = vendorData.bankDetails.ifscCode;
    }
    if (vendorData.bankDetails.bankName && vendorData.bankDetails.bankName.trim() !== '') {
      bankDetails.bankName = vendorData.bankDetails.bankName;
    }
    // Only add bankDetails if at least one field has a value
    if (Object.keys(bankDetails).length > 0) {
      cleanedData.bankDetails = bankDetails;
    }
    // Don't add bankDetails at all if it's empty - Firestore doesn't allow undefined values
  }
  
  // Remove any undefined values that might have been added
  Object.keys(cleanedData).forEach(key => {
    if (cleanedData[key] === undefined) {
      delete cleanedData[key];
    }
  });
  
  const vendorRef = doc(collection(db, 'vendors'));
  await setDoc(vendorRef, cleanedData);
  
  // Send password email if email and password are provided
  console.log('Vendor creation - Email check:', {
    email: vendorData.email,
    hasPassword: !!vendorData.password,
    emailTrimmed: vendorData.email?.trim(),
    emailNotEmpty: vendorData.email?.trim() !== ''
  });
  
  if (vendorData.email && vendorData.password && vendorData.email.trim() !== '') {
    console.log('Attempting to send vendor password email...', {
      email: vendorData.email,
      vendorName: vendorData.vendorName
    });
    try {
      const sendVendorPasswordEmail = httpsCallable(functions, 'sendVendorPasswordEmail');
      const result = await sendVendorPasswordEmail({
        email: vendorData.email,
        password: vendorData.password,
        vendorName: vendorData.vendorName,
      });
      console.log('Vendor password email sent successfully:', result);
    } catch (error: any) {
      console.error('Failed to send vendor password email:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        stack: error.stack
      });
      
      // Check if function doesn't exist (not deployed)
      const isFunctionNotFound = error.code === 'functions/not-found' || 
                                  error.message?.includes('not found') ||
                                  error.message?.includes('not-found');
      
      // Don't fail vendor creation if email fails
      // Throw error with password info so UI can display it
      const errorMessage = isFunctionNotFound 
        ? 'Cloud Functions are not deployed. Please deploy Firebase Cloud Functions to enable email sending.'
        : `Email sending failed: ${error.message || 'Unknown error'}`;
      
      const emailError = new Error(`Vendor created successfully, but ${errorMessage}`) as any;
      emailError.vendorCreated = true;
      emailError.vendorId = vendorRef.id;
      emailError.password = vendorData.password;
      emailError.email = vendorData.email;
      emailError.isFunctionNotFound = isFunctionNotFound;
      throw emailError;
    }
  } else {
    console.log('Skipping email send - missing email or password:', {
      hasEmail: !!vendorData.email,
      hasPassword: !!vendorData.password,
      emailValue: vendorData.email
    });
  }
  
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

