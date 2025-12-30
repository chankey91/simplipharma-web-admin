import { collection, getDocs, doc, updateDoc, addDoc, query, where, Timestamp, getDoc, setDoc, db } from './firebase';
import { Medicine, StockBatch } from '../types';

export const getAllMedicines = async (): Promise<Medicine[]> => {
  const medicinesCol = collection(db, 'medicines');
  const snapshot = await getDocs(medicinesCol);
  return snapshot.docs.map(doc => {
    const data = doc.data();
    
    // Calculate stock from stockBatches if available
    let calculatedStock = data.stock || data.currentStock || 0;
    if (data.stockBatches && Array.isArray(data.stockBatches) && data.stockBatches.length > 0) {
      calculatedStock = data.stockBatches.reduce((sum: number, batch: any) => {
        return sum + (batch.quantity || 0);
      }, 0);
    }
    
    // Process stockBatches first to ensure MRP is properly extracted
    const processedBatches = data.stockBatches ? data.stockBatches.map((batch: any) => {
      // Extract and convert MRP - handle all possible formats
      let mrpValue: number | undefined = undefined;
      
      // Check if MRP exists in any form
      const rawMrp = batch.mrp;
      
      if (rawMrp !== undefined && rawMrp !== null) {
        if (typeof rawMrp === 'number') {
          mrpValue = isNaN(rawMrp) ? undefined : rawMrp;
        } else if (typeof rawMrp === 'string') {
          const trimmed = rawMrp.trim();
          if (trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined') {
            const parsed = parseFloat(trimmed);
            mrpValue = !isNaN(parsed) ? parsed : undefined;
          }
        } else if (typeof rawMrp === 'object' && rawMrp.value !== undefined) {
          // Handle case where MRP might be an object with a value property
          const value = rawMrp.value;
          if (typeof value === 'number') {
            mrpValue = isNaN(value) ? undefined : value;
          } else if (typeof value === 'string') {
            const parsed = parseFloat(value);
            mrpValue = !isNaN(parsed) ? parsed : undefined;
          }
        }
      }
      
      // Log for debugging specific medicine
      if (doc.id === '0IXu5mRZu10DpmnpSXSg') {
        console.log(`[DEBUG ${doc.id}] Batch ${batch.batchNumber}:`, {
          rawMrp: rawMrp,
          mrpType: typeof rawMrp,
          processedMrp: mrpValue,
          batchKeys: Object.keys(batch),
          fullBatch: JSON.parse(JSON.stringify(batch))
        });
      }
      
      return {
        id: batch.id || Date.now().toString() + Math.random(),
        batchNumber: batch.batchNumber || '',
        quantity: batch.quantity || 0,
        expiryDate: batch.expiryDate?.toDate ? batch.expiryDate : (batch.expiryDate ? batch.expiryDate : undefined),
        mfgDate: batch.mfgDate?.toDate ? batch.mfgDate : (batch.mfgDate ? batch.mfgDate : undefined),
        purchaseDate: batch.purchaseDate?.toDate ? batch.purchaseDate : (batch.purchaseDate ? batch.purchaseDate : undefined),
        purchasePrice: batch.purchasePrice !== undefined && batch.purchasePrice !== null 
          ? (typeof batch.purchasePrice === 'number' ? batch.purchasePrice : parseFloat(String(batch.purchasePrice))) 
          : undefined,
        mrp: mrpValue,
      };
    }) : undefined;
    
    // Create medicine object - exclude stockBatches from spread to avoid conflicts
    const { stockBatches: _, ...dataWithoutBatches } = data;
    
    const medicine: Medicine = {
      id: doc.id,
      ...dataWithoutBatches,
      name: String(data.name || ''),
      manufacturer: String(data.manufacturer || ''),
      category: String(data.category || ''),
      code: data.code ? String(data.code) : undefined,
      stock: calculatedStock,
      currentStock: calculatedStock,
      price: data.price || data.mrp || 0, // Ensure price field exists
      stockBatches: processedBatches, // Use processed batches with proper MRP
      gstRate: data.gstRate !== undefined && data.gstRate !== null ? (typeof data.gstRate === 'number' ? data.gstRate : parseFloat(String(data.gstRate))) : 5, // Default to 5 if not set
    };
    
    // Update existing medicines in Firebase to have gstRate = 5 if not present (async, non-blocking)
    if (data.gstRate === undefined || data.gstRate === null) {
      // Use setTimeout to avoid blocking the read operation
      setTimeout(() => {
        const medicineRef = doc(db, 'medicines', doc.id);
        updateDoc(medicineRef, { gstRate: 5 }).catch(err => {
          console.warn(`Failed to update gstRate for medicine ${doc.id}:`, err);
        });
      }, 0);
    }
    
    // Debug log for specific medicine
    if (doc.id === '0IXu5mRZu10DpmnpSXSg') {
      console.log(`[DEBUG] Medicine ${doc.id} (${data.name}):`, {
        stockBatchesCount: processedBatches?.length || 0,
        processedBatches: processedBatches,
        rawDataBatches: data.stockBatches,
        medicineStockBatches: medicine.stockBatches
      });
    }
    
    return medicine;
  });
};

export const updateMedicineStock = async (
  medicineId: string, 
  updates: {
    stock?: number;
    currentStock?: number;
    expiryDate?: Date;
    batchNumber?: string;
    barcode?: string;
    mrp?: number;
  }
) => {
  const medicineRef = doc(db, 'medicines', medicineId);
  const updateData: any = { ...updates };
  
  if (updates.expiryDate) {
    updateData.expiryDate = Timestamp.fromDate(updates.expiryDate);
  }
  
  await updateDoc(medicineRef, updateData);
};

export const addStockBatch = async (
  medicineId: string,
  batch: Omit<StockBatch, 'id'>
) => {
  const medicineRef = doc(db, 'medicines', medicineId);
  const medicineDoc = await getDoc(medicineRef);
  
  if (!medicineDoc.exists()) {
    throw new Error('Medicine not found');
  }
  
  const medicine = medicineDoc.data() as Medicine;
  const batches = medicine.stockBatches || [];
  
  const newBatch: any = {
    id: Date.now().toString(),
    batchNumber: batch.batchNumber,
    quantity: batch.quantity,
  };
  
  // Add optional fields only if they exist
  if (batch.expiryDate) {
    newBatch.expiryDate = batch.expiryDate instanceof Date 
      ? Timestamp.fromDate(batch.expiryDate)
      : (batch.expiryDate.toDate ? batch.expiryDate : Timestamp.fromDate(new Date(batch.expiryDate)));
  }
  
  if (batch.mfgDate) {
    newBatch.mfgDate = batch.mfgDate instanceof Date 
      ? Timestamp.fromDate(batch.mfgDate)
      : (batch.mfgDate.toDate ? batch.mfgDate : Timestamp.fromDate(new Date(batch.mfgDate)));
  }
  
  if (batch.purchaseDate) {
    newBatch.purchaseDate = batch.purchaseDate instanceof Date
      ? Timestamp.fromDate(batch.purchaseDate)
      : (batch.purchaseDate.toDate ? batch.purchaseDate : Timestamp.fromDate(new Date(batch.purchaseDate)));
  } else {
    newBatch.purchaseDate = Timestamp.now();
  }
  
  if (batch.purchasePrice !== undefined && batch.purchasePrice !== null) {
    newBatch.purchasePrice = batch.purchasePrice;
  }
  
  if (batch.mrp !== undefined && batch.mrp !== null) {
    newBatch.mrp = batch.mrp;
  }
  
  // Check if batch with same batch number already exists
  const existingBatchIndex = batches.findIndex(b => b.batchNumber === batch.batchNumber);
  
  if (existingBatchIndex >= 0) {
    // Update existing batch quantity (merge batches with same batch number)
    console.log(`Batch ${batch.batchNumber} already exists, updating quantity from ${batches[existingBatchIndex].quantity} to ${(batches[existingBatchIndex].quantity || 0) + (batch.quantity || 0)}`);
    batches[existingBatchIndex].quantity = (batches[existingBatchIndex].quantity || 0) + (batch.quantity || 0);
    // Update other fields if provided
    if (newBatch.expiryDate) batches[existingBatchIndex].expiryDate = newBatch.expiryDate;
    if (newBatch.mfgDate) batches[existingBatchIndex].mfgDate = newBatch.mfgDate;
    if (newBatch.purchaseDate) batches[existingBatchIndex].purchaseDate = newBatch.purchaseDate;
    if (newBatch.purchasePrice !== undefined && newBatch.purchasePrice !== null) {
      batches[existingBatchIndex].purchasePrice = newBatch.purchasePrice;
    }
    // Always update MRP if provided (even if it's 0, but we check for undefined/null)
    if (newBatch.mrp !== undefined && newBatch.mrp !== null) {
      batches[existingBatchIndex].mrp = newBatch.mrp;
      console.log(`Updated MRP for batch ${batch.batchNumber} to ${newBatch.mrp}`);
    } else {
      console.log(`MRP not provided for batch ${batch.batchNumber}, keeping existing value: ${batches[existingBatchIndex].mrp}`);
    }
  } else {
    // Add new batch
    console.log(`Adding new batch ${batch.batchNumber} with quantity ${batch.quantity}, MRP: ${newBatch.mrp}`);
    batches.push(newBatch);
  }
  
  // Calculate total stock from all batches
  const totalStock = batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
  console.log(`Total stock calculated: ${totalStock} from ${batches.length} batches`);
  
  // Prepare batches for Firestore, ensuring all dates are Timestamps and removing undefined values
  const firestoreBatches = batches.map(b => {
    const firestoreBatch: any = {
      id: b.id,
      batchNumber: b.batchNumber,
      quantity: b.quantity || 0,
    };
    
    if (b.expiryDate) {
      firestoreBatch.expiryDate = b.expiryDate instanceof Date 
        ? Timestamp.fromDate(b.expiryDate)
        : (b.expiryDate && typeof b.expiryDate.toDate === 'function' ? b.expiryDate : Timestamp.fromDate(new Date(b.expiryDate)));
    }
    
    if (b.mfgDate) {
      firestoreBatch.mfgDate = b.mfgDate instanceof Date 
        ? Timestamp.fromDate(b.mfgDate)
        : (b.mfgDate && typeof b.mfgDate.toDate === 'function' ? b.mfgDate : Timestamp.fromDate(new Date(b.mfgDate)));
    }
    
    if (b.purchaseDate) {
      firestoreBatch.purchaseDate = b.purchaseDate instanceof Date
        ? Timestamp.fromDate(b.purchaseDate)
        : (b.purchaseDate && typeof b.purchaseDate.toDate === 'function' ? b.purchaseDate : Timestamp.fromDate(new Date(b.purchaseDate)));
    }
    
    if (b.purchasePrice !== undefined && b.purchasePrice !== null) {
      firestoreBatch.purchasePrice = typeof b.purchasePrice === 'number' ? b.purchasePrice : parseFloat(b.purchasePrice);
    }
    
    // Ensure MRP is saved as a number if it exists
    if (b.mrp !== undefined && b.mrp !== null) {
      const mrpValue = typeof b.mrp === 'number' ? b.mrp : parseFloat(b.mrp);
      if (!isNaN(mrpValue)) {
        firestoreBatch.mrp = mrpValue;
        console.log(`Saving MRP ${mrpValue} for batch ${b.batchNumber}`);
      } else {
        console.warn(`Invalid MRP value for batch ${b.batchNumber}: ${b.mrp}`);
      }
    } else {
      console.log(`No MRP for batch ${b.batchNumber}`);
    }
    
    return firestoreBatch;
  });
  
  const updateData: any = {
    stockBatches: firestoreBatches,
    stock: totalStock,
    currentStock: totalStock
  };
  
  console.log(`Updating medicine ${medicineId} with stock: ${totalStock}, batches: ${firestoreBatches.length}`);
  await updateDoc(medicineRef, updateData);
  console.log(`✓ Medicine ${medicineId} stock updated successfully. New stock: ${totalStock}`);
};

export const reduceStockFromBatch = async (
  medicineId: string,
  batchNumber: string,
  quantityToReduce: number
) => {
  const medicineRef = doc(db, 'medicines', medicineId);
  const medicineDoc = await getDoc(medicineRef);
  
  if (!medicineDoc.exists()) {
    throw new Error('Medicine not found');
  }
  
  const medicine = medicineDoc.data() as Medicine;
  const batches = medicine.stockBatches || [];
  
  // Find the batch
  const batchIndex = batches.findIndex(b => b.batchNumber === batchNumber);
  
  if (batchIndex < 0) {
    throw new Error(`Batch ${batchNumber} not found for medicine ${medicineId}`);
  }
  
  const batch = batches[batchIndex];
  const currentQuantity = batch.quantity || 0;
  
  if (currentQuantity < quantityToReduce) {
    throw new Error(`Insufficient stock in batch ${batchNumber}. Available: ${currentQuantity}, Required: ${quantityToReduce}`);
  }
  
  // Reduce the quantity
  batches[batchIndex].quantity = currentQuantity - quantityToReduce;
  
  // If quantity becomes 0 or negative, we can either remove the batch or keep it with 0
  // For now, we'll keep it with 0 quantity
  
  // Calculate new total stock
  const totalStock = batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
  
  // Prepare batches for Firestore
  const firestoreBatches = batches.map(b => {
    const firestoreBatch: any = {
      id: b.id,
      batchNumber: b.batchNumber,
      quantity: b.quantity || 0,
    };
    
    if (b.expiryDate) {
      firestoreBatch.expiryDate = b.expiryDate instanceof Date 
        ? Timestamp.fromDate(b.expiryDate)
        : (b.expiryDate && typeof b.expiryDate.toDate === 'function' ? b.expiryDate : Timestamp.fromDate(new Date(b.expiryDate)));
    }
    
    if (b.mfgDate) {
      firestoreBatch.mfgDate = b.mfgDate instanceof Date 
        ? Timestamp.fromDate(b.mfgDate)
        : (b.mfgDate && typeof b.mfgDate.toDate === 'function' ? b.mfgDate : Timestamp.fromDate(new Date(b.mfgDate)));
    }
    
    if (b.purchaseDate) {
      firestoreBatch.purchaseDate = b.purchaseDate instanceof Date
        ? Timestamp.fromDate(b.purchaseDate)
        : (b.purchaseDate && typeof b.purchaseDate.toDate === 'function' ? b.purchaseDate : Timestamp.fromDate(new Date(b.purchaseDate)));
    }
    
    if (b.purchasePrice !== undefined && b.purchasePrice !== null) {
      firestoreBatch.purchasePrice = typeof b.purchasePrice === 'number' ? b.purchasePrice : parseFloat(b.purchasePrice);
    }
    
    if (b.mrp !== undefined && b.mrp !== null) {
      const mrpValue = typeof b.mrp === 'number' ? b.mrp : parseFloat(b.mrp);
      if (!isNaN(mrpValue)) {
        firestoreBatch.mrp = mrpValue;
      }
    }
    
    return firestoreBatch;
  });
  
  const updateData: any = {
    stockBatches: firestoreBatches,
    stock: totalStock,
    currentStock: totalStock
  };
  
  console.log(`Reducing stock for medicine ${medicineId}, batch ${batchNumber}: ${currentQuantity} - ${quantityToReduce} = ${batches[batchIndex].quantity}`);
  await updateDoc(medicineRef, updateData);
  console.log(`✓ Stock reduced successfully. New stock: ${totalStock}`);
};

export const findMedicineByBarcode = async (barcode: string): Promise<Medicine | null> => {
  const medicinesCol = collection(db, 'medicines');
  
  // Try barcode first
  try {
    const q = query(medicinesCol, where('barcode', '==', barcode));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        name: String(data.name || ''),
        manufacturer: String(data.manufacturer || ''),
        category: String(data.category || ''),
        code: data.code ? String(data.code) : undefined,
      } as Medicine;
    }
  } catch (error) {
    console.warn('Barcode query failed:', error);
  }
  
  // Try code as fallback
  try {
    const codeQuery = query(medicinesCol, where('code', '==', barcode));
    const codeSnapshot = await getDocs(codeQuery);
    
    if (!codeSnapshot.empty) {
      const doc = codeSnapshot.docs[0];
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        name: String(data.name || ''),
        manufacturer: String(data.manufacturer || ''),
        category: String(data.category || ''),
        code: data.code ? String(data.code) : undefined,
      } as Medicine;
    }
  } catch (error) {
    console.warn('Code query failed:', error);
  }
  
  return null;
};

export const getExpiringMedicines = async (days: number = 30): Promise<Medicine[]> => {
  const medicines = await getAllMedicines();
  const today = new Date();
  const expiryThreshold = new Date();
  expiryThreshold.setDate(today.getDate() + days);
  
  return medicines.filter(medicine => {
    if (!medicine.expiryDate) return false;
    const expiry = medicine.expiryDate instanceof Date 
      ? medicine.expiryDate 
      : medicine.expiryDate.toDate();
    return expiry <= expiryThreshold && expiry >= today;
  });
};

export const getExpiredMedicines = async (): Promise<Medicine[]> => {
  const medicines = await getAllMedicines();
  const today = new Date();
  
  return medicines.filter(medicine => {
    if (!medicine.expiryDate) return false;
    const expiry = medicine.expiryDate instanceof Date 
      ? medicine.expiryDate 
      : medicine.expiryDate.toDate();
    return expiry < today;
  });
};

export const createMedicine = async (medicineData: Omit<Medicine, 'id'>): Promise<string> => {
  const medicineRef = doc(collection(db, 'medicines'));
  const newMedicine = {
    ...medicineData,
    stock: medicineData.stock || 0,
    currentStock: medicineData.currentStock || medicineData.stock || 0,
    stockBatches: [],
    gstRate: medicineData.gstRate !== undefined && medicineData.gstRate !== null ? medicineData.gstRate : 5, // Default to 5 if not provided
  };
  
  await setDoc(medicineRef, newMedicine);
  return medicineRef.id;
};
