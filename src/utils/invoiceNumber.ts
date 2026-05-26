 import { collection, query, where, getDocs, orderBy, db } from '../services/firebase';
import { limit } from 'firebase/firestore';

/**
 * Generate next purchase invoice number
 * Format: SPP + YYYY + MM + 001 (incrementing)
 * Example: SPP202501001, SPP202501002, etc.
 */
export const generatePurchaseInvoiceNumber = async (): Promise<string> => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `SPP${year}${month}`;
  
  // Query all purchase invoices with this prefix, ordered by invoice number descending
  const invoicesCol = collection(db, 'purchaseInvoices');
  const q = query(
    invoicesCol,
    where('invoiceNumber', '>=', prefix),
    where('invoiceNumber', '<', prefix + '999'),
    orderBy('invoiceNumber', 'desc'),
    limit(1)
  );
  
  try {
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      // First invoice of the month
      return `${prefix}001`;
    }
    
    // Get the highest invoice number
    const lastInvoiceNumber = snapshot.docs[0].data().invoiceNumber as string;
    const lastNumber = parseInt(lastInvoiceNumber.slice(-3), 10);
    const nextNumber = lastNumber + 1;
    
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  } catch (error) {
    // If query fails (e.g., no index), try to get all and filter in memory
    console.warn('Invoice number query failed, using fallback:', error);
    const allSnapshot = await getDocs(invoicesCol);
    const matchingInvoices = allSnapshot.docs
      .map((doc: any) => doc.data().invoiceNumber as string)
      .filter((num: string) => num && num.startsWith(prefix))
      .sort()
      .reverse();
    
    if (matchingInvoices.length === 0) {
      return `${prefix}001`;
    }
    
    const lastNumber = parseInt(matchingInvoices[0].slice(-3), 10);
    const nextNumber = lastNumber + 1;
    
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  }
};

/**
 * Generate next order invoice number
 * Format: SPS + YYYY + MM + 001 (incrementing)
 * Example: SPS202501001, SPS202501002, etc.
 */
export const generateOrderInvoiceNumber = async (): Promise<string> => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `SPS${year}${month}`;
  
  // Query all orders with this prefix, ordered by invoice number descending
  const ordersCol = collection(db, 'orders');
  const q = query(
    ordersCol,
    where('invoiceNumber', '>=', prefix),
    where('invoiceNumber', '<', prefix + '999'),
    orderBy('invoiceNumber', 'desc'),
    limit(1)
  );
  
  try {
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      // First order of the month
      return `${prefix}001`;
    }
    
    // Get the highest invoice number
    const lastInvoiceNumber = snapshot.docs[0].data().invoiceNumber as string;
    const lastNumber = parseInt(lastInvoiceNumber.slice(-3), 10);
    const nextNumber = lastNumber + 1;
    
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  } catch (error) {
    // If query fails (e.g., no index), try to get all and filter in memory
    console.warn('Order invoice number query failed, using fallback:', error);
    const allSnapshot = await getDocs(ordersCol);
    const matchingOrders = allSnapshot.docs
      .map((doc: any) => doc.data().invoiceNumber as string)
      .filter((num: string) => num && num.startsWith(prefix))
      .sort()
      .reverse();
    
    if (matchingOrders.length === 0) {
      return `${prefix}001`;
    }
    
    const lastNumber = parseInt(matchingOrders[0].slice(-3), 10);
    const nextNumber = lastNumber + 1;
    
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  }
};

/**
 * Generate next credit note number
 * Format: SPC + YYYY + MM + 001 (incrementing)
 */
export const generateCreditNoteNumber = async (): Promise<string> => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `SPC${year}${month}`;

  const notesCol = collection(db, 'credit_notes');
  const q = query(
    notesCol,
    where('creditNoteNumber', '>=', prefix),
    where('creditNoteNumber', '<', `${prefix}999`),
    orderBy('creditNoteNumber', 'desc'),
    limit(1)
  );

  try {
    const snapshot = await getDocs(q);
    if (snapshot.empty) return `${prefix}001`;

    const lastNumber = snapshot.docs[0].data().creditNoteNumber as string;
    const nextNumber = parseInt(lastNumber.slice(-3), 10) + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  } catch (error) {
    console.warn('Credit note number query failed, using fallback:', error);
    const allSnapshot = await getDocs(notesCol);
    const matching = allSnapshot.docs
      .map((docSnap) => docSnap.data().creditNoteNumber as string)
      .filter((num) => num && num.startsWith(prefix))
      .sort()
      .reverse();

    if (matching.length === 0) return `${prefix}001`;

    const nextNumber = parseInt(matching[0].slice(-3), 10) + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  }
};

/**
 * Generate next debit note number
 * Format: SPD + YYYY + MM + 001 (incrementing)
 */
export const generateDebitNoteNumber = async (): Promise<string> => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `SPD${year}${month}`;

  const notesCol = collection(db, 'debit_notes');
  const q = query(
    notesCol,
    where('debitNoteNumber', '>=', prefix),
    where('debitNoteNumber', '<', `${prefix}999`),
    orderBy('debitNoteNumber', 'desc'),
    limit(1)
  );

  try {
    const snapshot = await getDocs(q);
    if (snapshot.empty) return `${prefix}001`;

    const lastNumber = snapshot.docs[0].data().debitNoteNumber as string;
    const nextNumber = parseInt(lastNumber.slice(-3), 10) + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  } catch (error) {
    console.warn('Debit note number query failed, using fallback:', error);
    const allSnapshot = await getDocs(notesCol);
    const matching = allSnapshot.docs
      .map((docSnap) => docSnap.data().debitNoteNumber as string)
      .filter((num) => num && num.startsWith(prefix))
      .sort()
      .reverse();

    if (matching.length === 0) return `${prefix}001`;

    const nextNumber = parseInt(matching[0].slice(-3), 10) + 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  }
};

