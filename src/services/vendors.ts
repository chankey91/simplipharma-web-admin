import { collection, getDocs, doc, updateDoc, setDoc, query, where, Timestamp, db, getDoc } from './firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Vendor } from '../types';
import { functions } from './firebase';
import { auth } from './firebase';

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
  // Trim email if provided
  const email = vendorData.email?.trim() || '';
  
  const cleanedData: any = {
    vendorName: vendorData.vendorName,
    email: email, // Use trimmed email
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
  // Use trimmed email for consistency
  const emailToSend = email; // Already trimmed above
  
  console.log('Vendor creation - Email check:', {
    email: emailToSend,
    hasPassword: !!vendorData.password,
    emailNotEmpty: emailToSend !== ''
  });
  
  if (emailToSend && vendorData.password && emailToSend !== '') {
    // Validate email format before sending
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailToSend)) {
      console.warn('Invalid email format, skipping email send:', emailToSend);
      // Don't throw error, just skip email sending
    } else {
      console.log('Attempting to send vendor password email...', {
        email: emailToSend,
        vendorName: vendorData.vendorName
      });
      
      // Check authentication before calling function
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('No authenticated user found');
        const emailError = new Error('Vendor created successfully, but email sending failed: You must be logged in to send emails') as any;
        emailError.vendorCreated = true;
        emailError.vendorId = vendorRef.id;
        emailError.password = vendorData.password;
        emailError.email = emailToSend;
        throw emailError;
      }
      
      console.log('User authenticated:', {
        uid: currentUser.uid,
        email: currentUser.email
      });
      
      try {
        console.log('Calling Cloud Function sendVendorPasswordEmail...');
        
        // Get auth token for HTTP function
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error('User not authenticated');
        }
        
        const authToken = await currentUser.getIdToken();
        
        // Try HTTP function first (has explicit CORS)
        const httpFunctionUrl = `https://us-central1-simplipharma.cloudfunctions.net/sendVendorPasswordEmailHttp`;
        
        console.log('Calling HTTP function with CORS:', httpFunctionUrl);
        
        try {
          // First, test if the function is available with an OPTIONS request
          const optionsResponse = await fetch(httpFunctionUrl, {
            method: 'OPTIONS',
            headers: {
              'Origin': window.location.origin,
              'Access-Control-Request-Method': 'POST',
              'Access-Control-Request-Headers': 'Content-Type',
            },
          });
          
          console.log('OPTIONS preflight response:', {
            status: optionsResponse.status,
            headers: Object.fromEntries(optionsResponse.headers.entries())
          });
          
          // Now make the actual POST request
          const response = await fetch(httpFunctionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: emailToSend,
              password: vendorData.password,
              vendorName: vendorData.vendorName,
              authToken: authToken,
            }),
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
          }
          
          const result = await response.json();
          console.log('Vendor password email sent successfully via HTTP function:', result);
        } catch (httpError: any) {
          // If HTTP function fails (might not be deployed or CORS issue), try callable function as fallback
          console.warn('HTTP function failed, trying callable function:', httpError.message);
          
          try {
            const sendVendorPasswordEmail = httpsCallable(functions, 'sendVendorPasswordEmail', {
              timeout: 30000
            });
            
            const result = await sendVendorPasswordEmail({
              email: emailToSend,
              password: vendorData.password,
              vendorName: vendorData.vendorName,
            });
            
            console.log('Vendor password email sent successfully via callable function:', result);
          } catch (callableError: any) {
            // Both functions failed - this is likely a deployment issue
            console.error('Both HTTP and callable functions failed:', callableError);
            throw httpError; // Throw the original HTTP error
          }
        }
      } catch (error: any) {
        console.error('Failed to send vendor password email:', error);
        console.error('Full error object:', JSON.stringify(error, null, 2));
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          stack: error.stack,
          toString: error.toString()
        });
        
        // Check for various error conditions
        const errorCode = error.code || '';
        const errorMessage = error.message || '';
        
        const isFunctionNotFound = 
          errorCode === 'functions/not-found' || 
          errorCode === 'functions/unavailable' ||
          errorCode === 'not-found' ||
          errorMessage.includes('not found') ||
          errorMessage.includes('not-found') ||
          errorMessage.includes('not deployed') ||
          errorMessage.includes('UNAVAILABLE') ||
          errorMessage.includes('Function not found');
        
        const isAuthError = 
          errorCode === 'functions/unauthenticated' ||
          errorCode === 'functions/permission-denied' ||
          errorMessage.includes('permission') ||
          errorMessage.includes('authentication');
        
        const isConfigError = 
          errorCode === 'functions/failed-precondition' ||
          errorMessage.includes('SMTP configuration') ||
          errorMessage.includes('smtp.user') ||
          errorMessage.includes('smtp.password');
        
        // Build user-friendly error message
        let userMessage = 'Email sending failed';
        if (isFunctionNotFound) {
          userMessage = 'Cloud Functions are not deployed. Please deploy Firebase Cloud Functions to enable email sending.';
        } else if (isAuthError) {
          userMessage = 'Authentication failed. Please ensure you are logged in as an admin.';
        } else if (isConfigError) {
          userMessage = 'SMTP configuration is missing. Please configure email settings in Firebase Functions.';
        } else if (errorMessage.includes('timeout')) {
          userMessage = 'Email sending timed out. Please try again or check your network connection.';
        } else if (errorMessage) {
          userMessage = `Email sending failed: ${errorMessage}`;
        } else {
          userMessage = `Email sending failed: ${errorCode || 'Unknown error'}`;
        }
        
        // Don't fail vendor creation if email fails
        // Throw error with password info so UI can display it
        const emailError = new Error(`Vendor created successfully, but ${userMessage}`) as any;
        emailError.vendorCreated = true;
        emailError.vendorId = vendorRef.id;
        emailError.password = vendorData.password;
        emailError.email = emailToSend;
        emailError.isFunctionNotFound = isFunctionNotFound;
        emailError.originalError = error;
        throw emailError;
      }
    }
  } else {
    console.log('Skipping email send - missing email or password:', {
      hasEmail: !!emailToSend,
      emailValue: emailToSend,
      hasPassword: !!vendorData.password
    });
    
    // If email was provided but is invalid, warn user
    if (vendorData.email && vendorData.email.trim() !== '' && emailToSend === '') {
      console.warn('Email was provided but became empty after trimming:', vendorData.email);
    }
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

