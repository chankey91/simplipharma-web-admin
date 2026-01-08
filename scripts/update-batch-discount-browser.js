/**
 * Browser-based script to update discountPercentage to 1.5 for all batches
 * 
 * Usage:
 * 1. Open browser console (F12) on the admin page
 * 2. Make sure you're logged in
 * 3. Copy and paste this entire script into the console
 * 4. Press Enter to run
 */

(async function updateAllBatchDiscounts() {
  try {
    console.log('Starting batch discount update...');
    
    // Import Firebase functions (assuming they're available in the browser)
    const { collection, getDocs, doc, updateDoc, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    
    // Get db from the app (you may need to adjust this based on your setup)
    // For now, we'll use the Firebase app instance
    const { db } = await import('../src/services/firebase.ts');
    
    // Alternative: Use window.db if available
    const firestore = window.firebase?.firestore() || db;
    
    if (!firestore) {
      throw new Error('Firestore not available. Make sure you are on the admin page and logged in.');
    }
    
    // Get all medicines
    const medicinesRef = collection(firestore, 'medicines');
    const medicinesSnapshot = await getDocs(medicinesRef);
    
    let totalMedicines = 0;
    let totalBatches = 0;
    let updatedBatches = 0;
    let errors = [];
    
    for (const medicineDoc of medicinesSnapshot.docs) {
      totalMedicines++;
      const medicine = medicineDoc.data();
      const batches = medicine.stockBatches || [];
      
      if (batches.length === 0) {
        continue;
      }
      
      totalBatches += batches.length;
      
      // Update each batch to include discountPercentage = 1.5
      const updatedBatchesList = batches.map((batch) => {
        const updatedBatch = {
          ...batch,
          discountPercentage: 1.5
        };
        
        // Preserve existing date formats
        if (batch.expiryDate) {
          updatedBatch.expiryDate = batch.expiryDate;
        }
        if (batch.mfgDate) {
          updatedBatch.mfgDate = batch.mfgDate;
        }
        if (batch.purchaseDate) {
          updatedBatch.purchaseDate = batch.purchaseDate;
        }
        
        return updatedBatch;
      });
      
      // Update the medicine document
      try {
        const medicineRef = doc(firestore, 'medicines', medicineDoc.id);
        await updateDoc(medicineRef, {
          stockBatches: updatedBatchesList
        });
        
        updatedBatches += batches.length;
        console.log(`✓ Updated ${batches.length} batches in medicine ${medicineDoc.id} (${medicine.name || 'Unknown'})`);
      } catch (error) {
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
    alert(`Update completed!\n\nMedicines: ${totalMedicines}\nBatches: ${totalBatches}\nUpdated: ${updatedBatches}\nErrors: ${errors.length}`);
    
  } catch (error) {
    console.error('Error updating batch discounts:', error);
    alert('Error: ' + error.message);
  }
})();

