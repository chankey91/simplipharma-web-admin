# Typesense reindex runbook

Run these **admin-only** Cloud Function callables after deploying schema/sync changes, or when search results look stale or missing legacy documents.

## Prerequisites

- Signed in as an admin user in the admin web app (or Firebase CLI with appropriate credentials).
- Functions deployed: `firebase deploy --only functions` from `MedicineSupplyApp_ADMIN`.
- On PowerShell, quote `--only` lists:  
  `firebase deploy --only "functions:adminReindexOrdersTypesense,functions:onOrderWriteTypesense"`

## Callable functions

| Collection | Reindex callable | Write trigger (ongoing sync) |
|------------|------------------|------------------------------|
| `orders` | `adminReindexOrdersTypesense` | `onOrderWriteTypesense` |
| `product_demands` | `adminReindexProductDemandsTypesense` | `onProductDemandWriteTypesense` |
| `medicines` | `adminReindexMedicinesTypesense` | `onMedicineWriteTypesense` |
| `purchaseInvoices` | `adminReindexPurchaseInvoicesTypesense` | `onPurchaseInvoiceWriteTypesense` |
| `credit_notes` | `adminReindexCreditNotesTypesense` | `onCreditNoteWriteTypesense` |
| `debit_notes` | `adminReindexDebitNotesTypesense` | `onDebitNoteWriteTypesense` |

## When to reindex

1. **After deploying Typesense sync changes** (new fields, facets, or `buildDoc` logic).
2. **After Tier A retailer scoping** — reindex **orders** and **product_demands** so `retailerId` / `salesOfficerId` backfill on legacy docs.
3. **When admin search falls back to Firestore** — rebuild the affected index before relying on Typesense again.

## How to run (admin app)

Several admin pages expose a **Rebuild search index** button (e.g. Product Demands). That calls the matching `adminReindex*Typesense` callable.

For collections without a UI button, invoke the callable from the browser console while logged in as admin:

```javascript
import { getFunctions, httpsCallable } from 'firebase/functions';
const fn = httpsCallable(getFunctions(), 'adminReindexOrdersTypesense');
const res = await fn({});
console.log(res.data); // { ok, indexed, totalDocs }
```

Reindex callables may take several minutes on large collections (timeout up to 540s).

## Suggested post-deploy order

1. `adminReindexMedicinesTypesense` — catalog search depends on this.
2. `adminReindexOrdersTypesense`
3. `adminReindexProductDemandsTypesense`
4. `adminReindexPurchaseInvoicesTypesense`
5. `adminReindexCreditNotesTypesense` + `adminReindexDebitNotesTypesense`

## Verify

- Open the relevant admin list page and confirm search/sort/pagination work without "Typesense unavailable" fallback.
- Check Cloud Functions logs for `reindex failed` errors.
