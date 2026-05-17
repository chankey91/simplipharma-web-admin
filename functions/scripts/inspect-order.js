/**
 * One-off: inspect order + related demands + PI (run from functions/: node scripts/inspect-order.js ORDER_ID)
 */
const admin = require('firebase-admin');

const orderId = process.argv[2] || 'ZaiGuFOdAsCNbXEfmFYG';
const piRef = process.argv[3] || 'nqIHWIEr9kl9PyKQBK1Z';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'simplipharma' });
}

const db = admin.firestore();

async function main() {
  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) {
    console.error('Order not found:', orderId);
    process.exit(1);
  }
  const order = orderSnap.data();
  console.log('=== ORDER', orderId, '===');
  console.log('status:', order.status);
  console.log('medicines count:', (order.medicines || []).length);
  for (const [i, m] of (order.medicines || []).entries()) {
    console.log(`\n--- line ${i} ---`);
    console.log(JSON.stringify(m, null, 2));
  }

  const demandsSnap = await db.collection('product_demands').where('orderId', '==', orderId).get();
  console.log('\n=== DEMANDS for order', demandsSnap.size, '===');
  for (const d of demandsSnap.docs) {
    const data = d.data();
    console.log('\ndemand', d.id);
    console.log({
      productName: data.productName,
      status: data.status,
      purchaseInvoiceId: data.purchaseInvoiceId,
      fulfilledMedicineId: data.fulfilledMedicineId,
      fulfilledMedicineName: data.fulfilledMedicineName,
    });
  }

  const piSnap = await db.collection('purchaseInvoices').doc(piRef).get();
  if (!piSnap.exists) {
    const byNum = await db.collection('purchaseInvoices').where('invoiceNumber', '==', piRef).limit(1).get();
    if (!byNum.empty) {
      const inv = byNum.docs[0];
      console.log('\n=== PI (by invoiceNumber)', inv.id, '===');
      printPi(inv.data());
    } else {
      console.log('\nPI not found:', piRef);
    }
  } else {
    console.log('\n=== PI', piRef, '===');
    printPi(piSnap.data());
  }
}

function printPi(data) {
  console.log('invoiceNumber:', data.invoiceNumber);
  for (const item of data.items || []) {
    console.log('  item:', {
      medicineName: item.medicineName,
      medicineId: item.medicineId,
      batchNumber: item.batchNumber,
      mrp: item.mrp,
      purchasePrice: item.purchasePrice,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
