# Medicine master / batches split — progress tracker

**Target Firebase project:** `simplipharma-dev` (`.env.development` / vite mode)  
**Do not deploy rules/indexes/data migration to prod (`simplipharma`) until explicitly requested.**

## Target model

| Collection | Role | Doc ID |
|------------|------|--------|
| `medicines` | Master catalog + aggregates (`stock`, `currentStock`, `nearestExpiry`, `activeBatchCount`) | unchanged |
| `medicineBatches` | On-hand lots | auto-id / legacy batch id; field `medicineId` required |

Orders / PIs keep storing `medicineId` + `batchNumber` (no redesign).

## Cutover strategy

1. Dual-read: prefer `medicineBatches` for a medicine; fall back to embedded `stockBatches` if none.
2. Dual-write: `DUAL_WRITE_EMBEDDED_STOCK_BATCHES = true` in `src/services/inventory.ts` — stock mutations write both.
3. Migration script copies embedded → `medicineBatches` on **dev**.
4. Later: set dual-write flag false, delete `stockBatches` from masters.

## Checklist

- [x] Progress tracker created
- [x] `firestore.rules` — `medicineBatches` (deployed to **simplipharma-dev**)
- [x] `firestore.indexes.json` — medicineId composites (deployed to **simplipharma-dev**)
- [x] Types updated (`Medicine` + `StockBatch.medicineId`, aggregates)
- [x] `inventory.ts` rewritten (dual-read / dual-write)
- [x] Hooks updated (`useMedicine`, `useMedicineBatches`, `useMedicinesMaster`)
- [x] Migration script `functions/scripts/migrate-medicine-batches-to-collection.js`
- [x] Migration **run on simplipharma-dev** — see results below
- [x] `MedicineDetails` → `useMedicine` (single-doc + batches)
- [x] Dependent services use inventory API (orders / PI / creditNotes / expiryReturns) — no direct Firestore batch writes
- [x] Cloud Functions: Typesense hydrate falls back to `medicineBatches`; bulk job sets `migrationVersion: 2`
- [x] Deploy Cloud Functions to **simplipharma-dev** (`onMedicineWriteTypesense` + search/reindex/bulk)
- [ ] Turn off dual-write + delete embedded `stockBatches` (after app soak)
- [ ] Prod migration (only when approved)

## Migration results (simplipharma-dev, 2026-07-20)

```
medicines: 3006 (all migrationVersion >= 2)
medicineBatches: 25
medicines still with embedded stockBatches (dual-write): 20
errors: 0
```

## Resume notes

If work stops: check this file’s checklist.  
Source of truth for stock writes: `src/services/inventory.ts` (`DUAL_WRITE_EMBEDDED_STOCK_BATCHES`).  
Re-run migration (idempotent):  
`cd functions && node scripts/migrate-medicine-batches-to-collection.js simplipharma-dev`

Last updated: 2026-07-20
