# Medicine master / batches split — progress tracker

**Target Firebase project:** `simplipharma-dev` (`.env.development` / vite mode)  
**Do not deploy rules/indexes/data migration to prod (`simplipharma`) until explicitly requested.**

## Target model

| Collection | Role | Doc ID |
|------------|------|--------|
| `medicines` | Master catalog + aggregates (`stock`, `currentStock`, `nearestExpiry`, `activeBatchCount`) | unchanged |
| `medicineBatches` | On-hand lots (source of truth) | auto-id / legacy batch id; field `medicineId` required |

Orders / PIs keep storing `medicineId` + `batchNumber` (no redesign).

## Cutover strategy

1. Dual-read: prefer `medicineBatches`; fall back to embedded `stockBatches` if present (legacy).
2. Dual-write: **OFF** on dev (`DUAL_WRITE_EMBEDDED_STOCK_BATCHES = false`).
3. Migration copied embedded → `medicineBatches` on **dev**.
4. Embedded `stockBatches` **deleted** from all medicine masters on **dev**.

## Checklist

- [x] Progress tracker created
- [x] `firestore.rules` — `medicineBatches` (deployed to **simplipharma-dev**)
- [x] `firestore.indexes.json` — medicineId composites (deployed to **simplipharma-dev**)
- [x] Types updated (`Medicine` + `StockBatch.medicineId`, aggregates)
- [x] `inventory.ts` rewritten (dual-read / dual-write)
- [x] Hooks updated (`useMedicine`, `useMedicineBatches`, `useMedicinesMaster`)
- [x] Migration script `functions/scripts/migrate-medicine-batches-to-collection.js`
- [x] Migration **run on simplipharma-dev**
- [x] `MedicineDetails` → `useMedicine` (single-doc + batches)
- [x] Dependent services use inventory API
- [x] Cloud Functions: Typesense + bulk job updated for split
- [x] Deploy Cloud Functions to **simplipharma-dev**
- [x] Turn off dual-write (`DUAL_WRITE_EMBEDDED_STOCK_BATCHES = false`)
- [x] Cleanup embedded `stockBatches` on **simplipharma-dev** (script below)
- [ ] Prod migration + rules + cleanup (only when approved)

## Migration results (simplipharma-dev, 2026-07-20)

```
medicines: 3006 (all migrationVersion >= 2)
medicineBatches: 25 (at migration time)
errors: 0
```

## Dual-write off + cleanup (simplipharma-dev, 2026-07-21)

```
DUAL_WRITE_EMBEDDED_STOCK_BATCHES = false
cleared stockBatches field from: 3006 medicines
stillHaveStockBatchesField: 0
medicineBatches docs: 27
```

Cleanup script:  
`cd functions && node scripts/cleanup-embedded-stock-batches.js simplipharma-dev`

## Resume notes

Source of truth for stock: **`medicineBatches` only**.  
Stock mutations also call `deleteField()` on `medicines.stockBatches` if the field reappears.

Last updated: 2026-07-21
