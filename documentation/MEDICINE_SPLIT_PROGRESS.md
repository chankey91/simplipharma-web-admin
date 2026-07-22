# Medicine master / batches split — progress tracker

## Target model

| Collection | Role |
|------------|------|
| `medicines` | Master catalog + aggregates |
| `medicineBatches` | On-hand lots (source of truth) |

`DUAL_WRITE_EMBEDDED_STOCK_BATCHES = false` in `src/services/inventory.ts`.

---

## simplipharma-dev (complete)

- Rules + indexes deployed
- Migrated; dual-write off; embedded `stockBatches` cleaned
- Functions deployed

---

## simplipharma (prod) — 2026-07-22

### Done
- [x] Deploy `firestore.rules` + indexes → **simplipharma**
- [x] Migrate embedded → `medicineBatches`  
  - medicines: **36270**  
  - transactional migrated: **199**  
  - batches created: **241**  
  - master-only stamped: **36071**  
  - errors: **0**
- [x] Deploy functions: `onMedicineWriteTypesense`, `searchMedicinesTypesense`, `adminReindexMedicinesTypesense`, `onBulkMedicineJobCreated`
- [x] Cleanup embedded `stockBatches` from all **36270** medicines (0 unsafe skips)
- [x] Verify: `medicineBatches` = 241; sample masters have no `stockBatches`; `migrationVersion: 2`
- [x] Local `npm run build:prod` succeeded

### Frontend hosting note
Prod static hosting is **Jenkins → `main` → server** (`/var/www/simplipharma-admin`, port 8085), not Firebase Hosting.  
`origin/main` already contains the split code (`DUAL_WRITE… = false`).  
If the live admin UI was not rebuilt after that merge, trigger/redeploy Jenkins job **`simplipharma-admin-deployment`** (or `./deploy.sh prod` on the server) and hard-refresh the browser.

### Scripts
```bash
cd functions
node scripts/migrate-medicine-batches-to-collection.js simplipharma
node scripts/cleanup-embedded-stock-batches.js simplipharma
```

Last updated: 2026-07-22
