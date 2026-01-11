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
          mrp: item.mrp !== undefined && item.mrp !== null ? (typeof item.mrp === 'number' ? item.mrp : parseFloat(item.mrp)) : undefined,
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
          mrp: item.mrp !== undefined && item.mrp !== null ? (typeof item.mrp === 'number' ? item.mrp : parseFloat(String(item.mrp))) : undefined,
          freeQuantity: item.freeQuantity !== undefined && item.freeQuantity !== null ? (typeof item.freeQuantity === 'number' ? item.freeQuantity : parseFloat(String(item.freeQuantity))) : undefined,
          gstRate: item.gstRate !== undefined && item.gstRate !== null ? (typeof item.gstRate === 'number' ? item.gstRate : parseFloat(String(item.gstRate))) : undefined,
          discountPercentage: item.discountPercentage !== undefined && item.discountPercentage !== null ? (typeof item.discountPercentage === 'number' ? item.discountPercentage : parseFloat(String(item.discountPercentage))) : undefined,
          qrCode: item.qrCode || undefined,
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
          mrp: item.mrp !== undefined && item.mrp !== null ? (typeof item.mrp === 'number' ? item.mrp : parseFloat(String(item.mrp))) : undefined,
          freeQuantity: item.freeQuantity !== undefined && item.freeQuantity !== null ? (typeof item.freeQuantity === 'number' ? item.freeQuantity : parseFloat(String(item.freeQuantity))) : undefined,
          gstRate: item.gstRate !== undefined && item.gstRate !== null ? (typeof item.gstRate === 'number' ? item.gstRate : parseFloat(String(item.gstRate))) : undefined,
          discountPercentage: item.discountPercentage !== undefined && item.discountPercentage !== null ? (typeof item.discountPercentage === 'number' ? item.discountPercentage : parseFloat(String(item.discountPercentage))) : undefined,
          qrCode: item.qrCode || undefined,
        })) || []
  } as PurchaseInvoice;
};

export const checkInvoiceNumberUnique = async (invoiceNumber: string, excludeId?: string): Promise<boolean> => {
  const invoicesCol = collection(db, 'purchaseInvoices');
  const q = query(invoicesCol, where('invoiceNumber', '==', invoiceNumber));
  const snapshot = await getDocs(q);
  return snapshot.docs.every(d => !excludeId || d.id !== excludeId);
};

// Helper function to remove undefined values from an object
const removeUndefined = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      if (obj[key] !== undefined) {
        cleaned[key] = removeUndefined(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
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
  
  // Prepare items with proper date conversion and remove undefined values
  const items = invoiceData.items.map(item => {
    const cleanedItem: any = {
      medicineId: item.medicineId,
      medicineName: item.medicineName,
      batchNumber: item.batchNumber,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      purchasePrice: item.purchasePrice,
      totalAmount: item.totalAmount,
    };
    
    // Add optional fields only if they exist
    if (item.mfgDate) {
      cleanedItem.mfgDate = item.mfgDate instanceof Date ? Timestamp.fromDate(item.mfgDate) : item.mfgDate;
    }
    if (item.expiryDate) {
      cleanedItem.expiryDate = item.expiryDate instanceof Date ? Timestamp.fromDate(item.expiryDate) : item.expiryDate;
    }
    if (item.mrp !== undefined && item.mrp !== null) {
      cleanedItem.mrp = item.mrp;
    }
    if (item.freeQuantity !== undefined && item.freeQuantity !== null) {
      cleanedItem.freeQuantity = item.freeQuantity;
    }
    if (item.gstRate !== undefined && item.gstRate !== null) {
      cleanedItem.gstRate = item.gstRate;
    }
    if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
      cleanedItem.discountPercentage = item.discountPercentage;
    }
    if (item.qrCode) {
      cleanedItem.qrCode = item.qrCode;
    }
    
    return cleanedItem;
  });
  
  // Prepare invoice data, removing undefined values
  const invoiceDoc: any = {
    invoiceNumber: invoiceData.invoiceNumber,
    vendorId: invoiceData.vendorId,
    vendorName: invoiceData.vendorName,
    invoiceDate: invoiceData.invoiceDate instanceof Date 
      ? Timestamp.fromDate(invoiceData.invoiceDate)
      : invoiceData.invoiceDate,
    items,
    subTotal: invoiceData.subTotal,
    taxAmount: invoiceData.taxAmount,
    totalAmount: invoiceData.totalAmount,
    paymentStatus: invoiceData.paymentStatus,
    createdBy: invoiceData.createdBy,
    createdAt: Timestamp.now()
  };
  
  // Add optional fields only if they exist
  if (invoiceData.taxPercentage !== undefined && invoiceData.taxPercentage !== null) {
    invoiceDoc.taxPercentage = invoiceData.taxPercentage;
  }
  if (invoiceData.discount !== undefined && invoiceData.discount !== null) {
    invoiceDoc.discount = invoiceData.discount;
  }
  if (invoiceData.paymentMethod) {
    invoiceDoc.paymentMethod = invoiceData.paymentMethod;
  }
  if (invoiceData.notes) {
    invoiceDoc.notes = invoiceData.notes;
  }
  
  await setDoc(invoiceRef, invoiceDoc);
  
  // Update medicine stock with purchase batches
  if (updateStock) {
    const stockUpdateErrors: string[] = [];
    
    // Group items by medicineId to process sequentially per medicine
    const itemsByMedicine = new Map<string, typeof invoiceData.items>();
    
    for (const item of invoiceData.items) {
      if (!item.medicineId) continue;
      
      if (!itemsByMedicine.has(item.medicineId)) {
        itemsByMedicine.set(item.medicineId, []);
      }
      itemsByMedicine.get(item.medicineId)!.push(item);
    }
    
    // Process each medicine sequentially to avoid race conditions
    for (const [medicineId, items] of itemsByMedicine.entries()) {
      // Process batches for this medicine sequentially
      for (const item of items) {
        try {
          if (!item.batchNumber) {
            throw new Error('Batch number is missing');
          }
          const totalQuantity = item.quantity + (item.freeQuantity || 0);
          if (!totalQuantity || totalQuantity <= 0) {
            throw new Error('Invalid quantity');
          }
          
          const batchData: any = {
            batchNumber: item.batchNumber,
            quantity: totalQuantity, // Use quantity + free quantity
            purchasePrice: item.purchasePrice || 0,
          };
          
          // Add optional fields only if they exist
          if (item.mfgDate) {
            batchData.mfgDate = item.mfgDate instanceof Date ? item.mfgDate : new Date(item.mfgDate);
          }
          if (item.expiryDate) {
            batchData.expiryDate = item.expiryDate instanceof Date ? item.expiryDate : new Date(item.expiryDate);
          }
          if (invoiceData.invoiceDate) {
            batchData.purchaseDate = invoiceData.invoiceDate instanceof Date ? invoiceData.invoiceDate : new Date(invoiceData.invoiceDate);
          }
          if (item.mrp !== undefined && item.mrp !== null) {
            // Ensure MRP is a number
            batchData.mrp = typeof item.mrp === 'number' ? item.mrp : parseFloat(item.mrp);
            if (isNaN(batchData.mrp)) {
              console.warn(`Invalid MRP value for item ${item.medicineName}: ${item.mrp}`);
              delete batchData.mrp;
            }
          }
          if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
            // Ensure discountPercentage is a number
            batchData.discountPercentage = typeof item.discountPercentage === 'number' ? item.discountPercentage : parseFloat(String(item.discountPercentage));
            if (isNaN(batchData.discountPercentage)) {
              console.warn(`Invalid discountPercentage value for item ${item.medicineName}: ${item.discountPercentage}`);
              delete batchData.discountPercentage;
            }
          }
          
          console.log(`Updating stock for medicine ${medicineId} with batch data:`, batchData);
          await addStockBatch(medicineId, batchData);
          console.log(`✓ Stock updated successfully for medicine ${medicineId}, batch ${item.batchNumber}, quantity: ${totalQuantity}`);
        } catch (error: any) {
          const errorMsg = `Failed to update stock for ${item.medicineName || medicineId} (${medicineId}): ${error.message || error}`;
          console.error(errorMsg, error);
          stockUpdateErrors.push(errorMsg);
        }
      }
    }
    
    console.log(`Stock update summary: ${invoiceData.items.length - stockUpdateErrors.length} successful, ${stockUpdateErrors.length} failed`);
    
    if (stockUpdateErrors.length > 0) {
      console.warn('Some stock updates failed:', stockUpdateErrors);
      // You could optionally throw an error here if you want to prevent invoice creation on stock update failure
      // throw new Error(`Failed to update stock for ${stockUpdateErrors.length} item(s). Please update stock manually.`);
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

export const updateStockForExistingInvoice = async (invoiceId: string) => {
  const invoice = await getPurchaseInvoiceById(invoiceId);
  if (!invoice) {
    throw new Error('Invoice not found');
  }
  
  const stockUpdateErrors: string[] = [];
  
  // Group items by medicineId to process sequentially per medicine
  const itemsByMedicine = new Map<string, typeof invoice.items>();
  
  for (const item of invoice.items) {
    if (!item.medicineId) continue;
    
    if (!itemsByMedicine.has(item.medicineId)) {
      itemsByMedicine.set(item.medicineId, []);
    }
    itemsByMedicine.get(item.medicineId)!.push(item);
  }
  
  // Process each medicine sequentially to avoid race conditions
  for (const [medicineId, items] of itemsByMedicine.entries()) {
    // Process batches for this medicine sequentially
    for (const item of items) {
      try {
        if (!item.batchNumber) {
          throw new Error('Batch number is missing');
        }
        const totalQuantity = item.quantity + (item.freeQuantity || 0);
        if (!totalQuantity || totalQuantity <= 0) {
          throw new Error('Invalid quantity');
        }
        
        const batchData: any = {
          batchNumber: item.batchNumber,
          quantity: totalQuantity, // Use quantity + free quantity
          purchasePrice: item.purchasePrice || 0,
        };
        
        // Add optional fields only if they exist
        if (item.mfgDate) {
          batchData.mfgDate = item.mfgDate instanceof Date ? item.mfgDate : new Date(item.mfgDate);
        }
        if (item.expiryDate) {
          batchData.expiryDate = item.expiryDate instanceof Date ? item.expiryDate : new Date(item.expiryDate);
        }
        if (invoice.invoiceDate) {
          batchData.purchaseDate = invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date(invoice.invoiceDate);
        }
        if (item.mrp !== undefined && item.mrp !== null) {
          // Ensure MRP is a number
          batchData.mrp = typeof item.mrp === 'number' ? item.mrp : parseFloat(item.mrp);
          if (isNaN(batchData.mrp)) {
            console.warn(`Invalid MRP value for item ${item.medicineName}: ${item.mrp}`);
            delete batchData.mrp;
          }
        }
        if (item.discountPercentage !== undefined && item.discountPercentage !== null) {
          // Ensure discountPercentage is a number
          batchData.discountPercentage = typeof item.discountPercentage === 'number' ? item.discountPercentage : parseFloat(String(item.discountPercentage));
          if (isNaN(batchData.discountPercentage)) {
            console.warn(`Invalid discountPercentage value for item ${item.medicineName}: ${item.discountPercentage}`);
            delete batchData.discountPercentage;
          }
        }
        
        console.log(`Updating stock for existing invoice - medicine ${medicineId} with batch data:`, batchData);
        await addStockBatch(medicineId, batchData);
        console.log(`✓ Stock updated successfully for medicine ${medicineId}, batch ${item.batchNumber}, quantity: ${totalQuantity}`);
      } catch (error: any) {
        const errorMsg = `Failed to update stock for ${item.medicineName || medicineId} (${medicineId}): ${error.message || error}`;
        console.error(errorMsg, error);
        stockUpdateErrors.push(errorMsg);
      }
    }
  }
  
  const totalItems = invoice.items.length;
  const successful = totalItems - stockUpdateErrors.length;
  const failed = stockUpdateErrors.length;
  
  console.log(`Stock update summary for invoice ${invoiceId}: ${successful} successful, ${failed} failed`);
  
  if (stockUpdateErrors.length > 0) {
    throw new Error(`Failed to update stock for ${stockUpdateErrors.length} item(s): ${stockUpdateErrors.join('; ')}`);
  }
  
  return { successful, failed };
};

export const updateStockForAllExistingInvoices = async () => {
  const invoices = await getAllPurchaseInvoices();
  const results = [];
  
  for (const invoice of invoices) {
    try {
      const result = await updateStockForExistingInvoice(invoice.id);
      results.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, ...result });
    } catch (error: any) {
      results.push({ 
        invoiceId: invoice.id, 
        invoiceNumber: invoice.invoiceNumber, 
        successful: 0, 
        failed: invoice.items.length,
        error: error.message 
      });
    }
  }
  
  return results;
};

