/**
 * Script to update discountPercentage to 1.5 for all batches in Firestore
 * 
 * Usage:
 * 1. Make sure you're logged in as admin
 * 2. Run: npx tsx scripts/update-batch-discount.ts
 * Or compile and run: npx ts-node scripts/update-batch-discount.ts
 */

import { collection, getDocs, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../src/services/firebase';

interface StockBatch {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate?: any;
  mfgDate?: any;
  purchaseDate?: any;
  purchasePrice?: number;
  mrp?: number;
  discountPercentage?: number;
}

interface Medicine {
  id: string;
  stockBatches?: StockBatch[];
}

async function updateAllBatchDiscounts() {
  try {
    console.log('Starting batch discount update...');
    
    // Get all medicines
    const medicinesRef = collection(db, 'medicines');
    const medicinesSnapshot = await getDocs(medicinesRef);
    
    let totalMedicines = 0;
    let totalBatches = 0;
    let updatedBatches = 0;
    let errors: string[] = [];
    
    for (const medicineDoc of medicinesSnapshot.docs) {
      totalMedicines++;
      const medicine = medicineDoc.data() as Medicine;
      const batches = medicine.stockBatches || [];
      
      if (batches.length === 0) {
        continue;
      }
      
      totalBatches += batches.length;
      
      // Update each batch to include discountPercentage = 1.5
      const updatedBatchesList = batches.map((batch: any) => {
        const updatedBatch: any = {
          ...batch,
          discountPercentage: 1.5
        };
        
        // Ensure dates are properly formatted for Firestore
        if (batch.expiryDate) {
          updatedBatch.expiryDate = batch.expiryDate?.toDate 
            ? batch.expiryDate 
            : (batch.expiryDate instanceof Date 
              ? Timestamp.fromDate(batch.expiryDate) 
              : Timestamp.fromDate(new Date(batch.expiryDate)));
        }
        
        if (batch.mfgDate) {
          updatedBatch.mfgDate = batch.mfgDate?.toDate 
            ? batch.mfgDate 
            : (batch.mfgDate instanceof Date 
              ? Timestamp.fromDate(batch.mfgDate) 
              : Timestamp.fromDate(new Date(batch.mfgDate)));
        }
        
        if (batch.purchaseDate) {
          updatedBatch.purchaseDate = batch.purchaseDate?.toDate 
            ? batch.purchaseDate 
            : (batch.purchaseDate instanceof Date 
              ? Timestamp.fromDate(batch.purchaseDate) 
              : Timestamp.fromDate(new Date(batch.purchaseDate)));
        }
        
        return updatedBatch;
      });
      
      // Update the medicine document with updated batches
      try {
        const medicineRef = doc(db, 'medicines', medicineDoc.id);
        await updateDoc(medicineRef, {
          stockBatches: updatedBatchesList
        });
        
        updatedBatchesList.forEach((batch: any) => {
          updatedBatches++;
          console.log(`✓ Updated batch ${batch.batchNumber} in medicine ${medicineDoc.id}`);
        });
      } catch (error: any) {
        const errorMsg = `Failed to update medicine ${medicineDoc.id}: ${error.message}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
    
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
    
  } catch (error: any) {
    console.error('Error updating batch discounts:', error);
    throw error;
  }
}

// Run the update
updateAllBatchDiscounts()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

