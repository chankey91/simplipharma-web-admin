/**
 * One-off: backfill medicines catalog from fulfilled product_demands.
 * Run from functions/: node scripts/migrate-product-demands-to-medicines.js
 * Optional: --include-pending
 */
const admin = require('firebase-admin');

const includePending = process.argv.includes('--include-pending');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'simplipharma' });
}

const db = admin.firestore();

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function main() {
  const [demandsSnap, medicinesSnap] = await Promise.all([
    db.collection('product_demands').get(),
    db.collection('medicines').get(),
  ]);

  const nameToId = new Map();
  for (const d of medicinesSnap.docs) {
    const n = String(d.data().name || '')
      .toLowerCase()
      .trim();
    if (n && !nameToId.has(n)) nameToId.set(n, d.id);
  }

  const stats = {
    processed: 0,
    created: 0,
    linked: 0,
    demandsUpdated: 0,
    ordersRepaired: 0,
    skipped: 0,
    errors: [],
  };

  for (const demandDoc of demandsSnap.docs) {
    const demand = demandDoc.data();
    const status = demand.status;
    if (status === 'rejected') continue;
    if (status !== 'fulfilled' && !(includePending && status === 'pending')) continue;

    stats.processed++;
    const productName = String(demand.productName || '').trim();
    if (!productName) {
      stats.skipped++;
      continue;
    }

    try {
      const key = productName.toLowerCase();
      let medicineId = String(demand.fulfilledMedicineId || '').trim();

      if (medicineId) {
        const medSnap = await db.collection('medicines').doc(medicineId).get();
        if (!medSnap.exists) medicineId = '';
      }

      let created = false;
      if (!medicineId) {
        const existingId = nameToId.get(key);
        if (existingId) {
          medicineId = existingId;
          stats.linked++;
        } else {
          const ref = db.collection('medicines').doc();
          await ref.set(
            stripUndefined({
              name: productName,
              manufacturer: String(demand.manufacturerName || '').trim() || '—',
              category: 'General',
              unit: String(demand.requestedUnit || '').trim() || undefined,
              stock: 0,
              currentStock: 0,
              stockBatches: [],
              gstRate: 5,
              price: 0,
              description: demand.notes ? String(demand.notes).trim() : undefined,
              imageUrl: demand.imageUrl ? String(demand.imageUrl).trim() : undefined,
            })
          );
          medicineId = ref.id;
          nameToId.set(key, medicineId);
          created = true;
          stats.created++;
        }
      } else {
        stats.linked++;
      }

      const medSnap = await db.collection('medicines').doc(medicineId).get();
      const fulfilledName = medSnap.exists
        ? String(medSnap.data().name || productName)
        : productName;

      if (status === 'fulfilled') {
        const needsUpdate =
          demand.fulfilledMedicineId !== medicineId ||
          demand.fulfilledMedicineName !== fulfilledName;
        if (needsUpdate) {
          await demandDoc.ref.update({
            fulfilledMedicineId: medicineId,
            fulfilledMedicineName: fulfilledName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          stats.demandsUpdated++;
        }
      }

      const orderId = String(demand.orderId || '').trim();
      if (orderId && status === 'fulfilled') {
        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (orderSnap.exists) {
          const medicines = orderSnap.data().medicines || [];
          const idx = medicines.findIndex(
            (m) =>
              m.productDemandId === demandDoc.id ||
              (m.lineType === 'product_demand' &&
                String(m.name || '')
                  .toLowerCase()
                  .includes(productName.toLowerCase().slice(0, 8)))
          );
          if (idx >= 0 && medicines[idx].lineType === 'product_demand') {
            const line = medicines[idx];
            const next = [...medicines];
            next[idx] = {
              ...line,
              lineType: admin.firestore.FieldValue.delete(),
              medicineId,
              name: fulfilledName,
              productDemandId: demandDoc.id,
            };
            await orderRef.update({ medicines: next });
            stats.ordersRepaired++;
          }
        }
      }

      if (created) {
        console.log('Created medicine', medicineId, 'for', productName);
      }
    } catch (e) {
      stats.errors.push(`${demandDoc.id}: ${e.message || e}`);
    }
  }

  console.log(JSON.stringify(stats, null, 2));
  if (stats.errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
