/**
 * Utility function to update discountPercentage to 1.5 for all batches in Firestore
 * 
 * Usage from browser console:
 * 1. Open browser console (F12) on any admin page
 * 2. Import and run:
 *    import { updateAllBatchDiscounts } from './utils/updateBatchDiscounts';
 *    updateAllBatchDiscounts();
 * 
 * Or create a temporary button in the UI to trigger this function
 */

import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

export async function updateAllBatchDiscounts(): Promise<{
  totalMedicines: number;
  totalBatches: number;
  updatedBatches: number;
  errors: string[];
}> {
  try {
    console.log('Starting batch discount update...');
    
    // Get all medicines
    const medicinesRef = collection(db, 'medicines');
    const medicinesSnapshot = await getDocs(medicinesRef);
    
    let totalMedicines = 0;
    let totalBatches = 0;
    let updatedBatches = 0;
    const errors: string[] = [];
    
    for (const medicineDoc of medicinesSnapshot.docs) {
      totalMedicines++;
      const medicine = medicineDoc.data();
      const batches = medicine.stockBatches || [];
      
      if (batches.length === 0) {
        continue;
      }
      
      totalBatches += batches.length;
      
      // Update each batch to include discountPercentage = 1.5
      const updatedBatchesList = batches.map((batch: any) => {
        return {
          ...batch,
          discountPercentage: 1.5
        };
      });
      
      // Update the medicine document
      try {
        const medicineRef = doc(db, 'medicines', medicineDoc.id);
        await updateDoc(medicineRef, {
          stockBatches: updatedBatchesList
        });
        
        updatedBatches += batches.length;
        console.log(`✓ Updated ${batches.length} batches in medicine ${medicineDoc.id} (${medicine.name || 'Unknown'})`);
      } catch (error: any) {
        const errorMsg = `Failed to update medicine ${medicineDoc.id}: ${error.message}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
    
    const summary = {
      totalMedicines,
      totalBatches,
      updatedBatches,
      errors
    };
    
    console.log('\n=== Update Summary ===');
    console.log(`Total medicines processed: ${totalMedicines}`);
    console.log(`Total batches found: ${totalBatches}`);
    console.log(`Batches updated: ${updatedBatches}`);
    console.log(`Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach(err => console.error(`  - ${err}`));
    }
    
    console.log('\n✓ Batch discount update completed!');
    
    return summary;
    
  } catch (error: any) {
    console.error('Error updating batch discounts:', error);
    throw error;
  }
}

// Make it available globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).updateAllBatchDiscounts = updateAllBatchDiscounts;
}

