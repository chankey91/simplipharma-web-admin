/**
 * Utility: set discountPercentage on all medicineBatches (and dual-write embedded if present).
 * Prefer running against medicineBatches collection (post-split source of truth).
 */

import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { MEDICINE_BATCHES_COLLECTION } from '../services/inventory';

export async function updateAllBatchDiscounts(): Promise<{
  totalMedicines: number;
  totalBatches: number;
  updatedBatches: number;
  errors: string[];
}> {
  try {
    console.log('Starting batch discount update (medicineBatches)...');

    const batchesSnap = await getDocs(collection(db, MEDICINE_BATCHES_COLLECTION));
    let totalMedicines = 0;
    let totalBatches = 0;
    let updatedBatches = 0;
    const errors: string[] = [];
    const medicineIds = new Set<string>();

    for (const batchDoc of batchesSnap.docs) {
      totalBatches++;
      const data = batchDoc.data();
      if (data.medicineId) medicineIds.add(String(data.medicineId));
      try {
        const current =
          typeof data.discountPercentage === 'number'
            ? data.discountPercentage
            : parseFloat(String(data.discountPercentage ?? ''));
        if (current === 1.5) continue;
        await updateDoc(doc(db, MEDICINE_BATCHES_COLLECTION, batchDoc.id), {
          discountPercentage: 1.5,
        });
        updatedBatches++;
      } catch (err: any) {
        errors.push(`Batch ${batchDoc.id}: ${err?.message || String(err)}`);
      }
    }

    totalMedicines = medicineIds.size;

    // Also patch legacy embedded arrays if still present (dual-write window)
    const medicinesSnap = await getDocs(collection(db, 'medicines'));
    for (const medicineDoc of medicinesSnap.docs) {
      const medicine = medicineDoc.data();
      const batches = medicine.stockBatches || [];
      if (!Array.isArray(batches) || batches.length === 0) continue;
      let changed = false;
      const updated = batches.map((b: any) => {
        if (b.discountPercentage === 1.5) return b;
        changed = true;
        return { ...b, discountPercentage: 1.5 };
      });
      if (changed) {
        try {
          await updateDoc(doc(db, 'medicines', medicineDoc.id), { stockBatches: updated });
        } catch (err: any) {
          errors.push(`Medicine embedded ${medicineDoc.id}: ${err?.message || String(err)}`);
        }
      }
    }

    console.log('Done', { totalMedicines, totalBatches, updatedBatches, errors });
    return { totalMedicines, totalBatches, updatedBatches, errors };
  } catch (error: any) {
    console.error('updateAllBatchDiscounts failed', error);
    return {
      totalMedicines: 0,
      totalBatches: 0,
      updatedBatches: 0,
      errors: [error?.message || String(error)],
    };
  }
}
