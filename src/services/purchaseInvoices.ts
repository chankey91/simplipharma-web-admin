import { collection, getDocs, doc, setDoc, updateDoc, query, orderBy, Timestamp, db, getDoc, where } from './firebase';
import { PurchaseInvoice, PurchaseInvoiceItem } from '../types';
import { addStockBatch } from './inventory';

export const getAllPurchaseInvoices = async (): Promise<PurchaseInvoice[]> => {
  const invoicesCol = collection(db, 'purchaseInvoices');
  try {
    const q = query(invoicesCol, orderBy('invoiceDate', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        invoiceDate: data.invoiceDate?.toDate() || new Date(),
        createdAt: data.createdAt?.toDate() || new Date(),
        items: data.items?.map((item: any) => ({
          ...item,
          mfgDate: item.mfgDate?.toDate() || undefined,
          expiryDate: item.expiryDate?.toDate() || undefined,
        })) || []
      } as PurchaseInvoice;
    });
  } catch (error) {
    console.warn('OrderBy query failed, sorting in memory:', error);
    const snapshot = await getDocs(invoicesCol);
    const invoices = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        invoiceDate: data.invoiceDate?.toDate() || new Date(),
        createdAt: data.createdAt?.toDate() || new Date(),
        items: data.items?.map((item: any) => ({
          ...item,
          mfgDate: item.mfgDate?.toDate() || undefined,
          expiryDate: item.expiryDate?.toDate() || undefined,
        })) || []
      } as PurchaseInvoice;
    });
    
    return invoices.sort((a, b) => {
      const dateA = a.invoiceDate instanceof Date ? a.invoiceDate : new Date(a.invoiceDate);
      const dateB = b.invoiceDate instanceof Date ? b.invoiceDate : new Date(b.invoiceDate);
      return dateB.getTime() - dateA.getTime();
    });
  }
};

export const getPurchaseInvoiceById = async (invoiceId: string): Promise<PurchaseInvoice | null> => {
  const invoiceRef = doc(db, 'purchaseInvoices', invoiceId);
  const invoiceDoc = await getDoc(invoiceRef);
  
  if (!invoiceDoc.exists()) return null;
  
  const data = invoiceDoc.data();
  return {
    id: invoiceDoc.id,
    ...data,
    invoiceDate: data.invoiceDate?.toDate() || new Date(),
    createdAt: data.createdAt?.toDate() || new Date(),
    items: data.items?.map((item: any) => ({
      ...item,
      mfgDate: item.mfgDate?.toDate() || undefined,
      expiryDate: item.expiryDate?.toDate() || undefined,
    })) || []
  } as PurchaseInvoice;
};

export const checkInvoiceNumberUnique = async (invoiceNumber: string, excludeId?: string): Promise<boolean> => {
  const invoicesCol = collection(db, 'purchaseInvoices');
  const q = query(invoicesCol, where('invoiceNumber', '==', invoiceNumber));
  const snapshot = await getDocs(q);
  return snapshot.docs.every(d => !excludeId || d.id !== excludeId);
};

export const createPurchaseInvoice = async (
  invoiceData: Omit<PurchaseInvoice, 'id'>,
  updateStock: boolean = true
) => {
  // Check invoice number uniqueness
  const isUnique = await checkInvoiceNumberUnique(invoiceData.invoiceNumber);
  if (!isUnique) {
    throw new Error('Invoice Number already exists');
  }
  
  const invoiceRef = doc(collection(db, 'purchaseInvoices'));
  
  // Prepare items with proper date conversion
  const items = invoiceData.items.map(item => ({
    ...item,
    mfgDate: item.mfgDate instanceof Date ? Timestamp.fromDate(item.mfgDate) : item.mfgDate,
    expiryDate: item.expiryDate instanceof Date ? Timestamp.fromDate(item.expiryDate) : item.expiryDate,
  }));
  
  await setDoc(invoiceRef, {
    ...invoiceData,
    items,
    invoiceDate: invoiceData.invoiceDate instanceof Date 
      ? Timestamp.fromDate(invoiceData.invoiceDate)
      : invoiceData.invoiceDate,
    createdAt: Timestamp.now()
  });
  
  // Update medicine stock with purchase batches
  if (updateStock) {
    for (const item of invoiceData.items) {
      try {
        await addStockBatch(item.medicineId, {
          batchNumber: item.batchNumber,
          quantity: item.quantity,
          mfgDate: item.mfgDate,
          expiryDate: item.expiryDate,
          purchaseDate: invoiceData.invoiceDate,
          purchasePrice: item.purchasePrice,
          mrp: item.mrp,
        });
      } catch (error) {
        console.error(`Failed to update stock for medicine ${item.medicineId}:`, error);
        // Continue with other items even if one fails
      }
    }
  }
  
  return invoiceRef.id;
};

export const updatePurchaseInvoice = async (
  invoiceId: string,
  invoiceData: Partial<PurchaseInvoice>
) => {
  const invoiceRef = doc(db, 'purchaseInvoices', invoiceId);
  
  const updateData: any = { ...invoiceData };
  
  if (invoiceData.invoiceDate) {
    updateData.invoiceDate = invoiceData.invoiceDate instanceof Date 
      ? Timestamp.fromDate(invoiceData.invoiceDate)
      : invoiceData.invoiceDate;
  }
  
  if (invoiceData.items) {
    updateData.items = invoiceData.items.map((item: PurchaseInvoiceItem) => ({
      ...item,
      mfgDate: item.mfgDate instanceof Date ? Timestamp.fromDate(item.mfgDate) : item.mfgDate,
      expiryDate: item.expiryDate instanceof Date ? Timestamp.fromDate(item.expiryDate) : item.expiryDate,
    }));
  }
  
  await updateDoc(invoiceRef, updateData);
};

