import { collection, getDocs, doc, updateDoc, addDoc, query, where, Timestamp, getDoc, db } from './firebase';
import { Medicine, StockBatch } from '../types';

export const getAllMedicines = async (): Promise<Medicine[]> => {
  const medicinesCol = collection(db, 'medicines');
  const snapshot = await getDocs(medicinesCol);
  return snapshot.docs.map(doc => {
    const data = doc.data();
    // Ensure string fields are properly converted
    return {
      id: doc.id,
      ...data,
      name: String(data.name || ''),
      manufacturer: String(data.manufacturer || ''),
      category: String(data.category || ''),
      code: data.code ? String(data.code) : undefined,
    } as Medicine;
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
  
  const newBatch: StockBatch = {
    id: Date.now().toString(),
    ...batch,
    expiryDate: batch.expiryDate instanceof Date 
      ? Timestamp.fromDate(batch.expiryDate)
      : batch.expiryDate,
    purchaseDate: batch.purchaseDate instanceof Date
      ? Timestamp.fromDate(batch.purchaseDate)
      : batch.purchaseDate || Timestamp.now()
  };
  
  batches.push(newBatch);
  
  // Calculate total stock from all batches
  const totalStock = batches.reduce((sum, b) => sum + b.quantity, 0);
  
  await updateDoc(medicineRef, {
    stockBatches: batches.map(b => ({
      ...b,
      expiryDate: b.expiryDate instanceof Date 
        ? Timestamp.fromDate(b.expiryDate)
        : b.expiryDate,
      purchaseDate: b.purchaseDate instanceof Date
        ? Timestamp.fromDate(b.purchaseDate)
        : b.purchaseDate
    })),
    stock: totalStock,
    currentStock: totalStock
  });
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
  };
  
  await setDoc(medicineRef, newMedicine);
  return medicineRef.id;
};
