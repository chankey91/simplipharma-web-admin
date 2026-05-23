# Typesense + Cloud Functions

Your self-hosted Typesense is at `http://103.230.227.5:8088` (health: [http://103.230.227.5:8088/health](http://103.230.227.5:8088/health)).

## 1. Set Firebase Functions config (production)

Run **from the `MedicineSupplyApp_ADMIN` folder** (where `firebase.json` lives), logged into the correct Firebase project.

**Bash / Git Bash** (use single quotes around the API key so `$` and `#` are not interpreted):

```bash
firebase functions:config:set \
  typesense.host="103.230.227.5" \
  typesense.protocol="http" \
  typesense.port="8088" \
  typesense.api_key='YOUR_API_KEY_HERE'
```

**PowerShell** (paste your key inside the single-quoted string):

```powershell
firebase functions:config:set `
  typesense.host=103.230.227.5 `
  typesense.protocol=http `
  typesense.port=8088 `
  typesense.api_key='YOUR_API_KEY_HERE'
```

Then deploy:

```bash
cd functions && npm run build && cd .. && firebase deploy --only functions
```

## 2. Local emulator (optional)

Copy `functions/.runtimeconfig.json.example` to `functions/.runtimeconfig.json`, replace `api_key`, then run emulators. This file is gitignored.

## 3. Port default (easy mistake)

Functions code treats **omit** `typesense.port` like this:

- `protocol=http` → default port **`8108`** (official Typesense default), **not** 8088.
- `protocol=https` → default **`443`**.

If your server listens on **8088**, you **must** set `typesense.port="8088"` explicitly.

## 4. Firewall

Cloud Functions run on Google’s network. Your Linux server must allow **inbound TCP** on the Typesense listen port (**8088** in the example, or **443** behind HTTPS), from the internet (or whichever source your policy allows Google egress through). If search fails after deploy, check security groups / `ufw` / cloud firewall.

## 5. Security

- Prefer **HTTPS** in front of Typesense (e.g. Nginx + Let’s Encrypt) and point `protocol`/`port` at that endpoint.
- **Rotate the API key** if it was ever committed or shared; create a new key in Typesense and update `firebase functions:config:set` + redeploy.

## 6. Backfill index

After deploy: **Admin → Inventory → Rebuild search index**, or call the `adminReindexMedicinesTypesense` callable as an admin user.

## 7. Schema: `search_blob` (automatic)

The index includes an optional **`search_blob`** — lowercase concatenation of **name**, **manufacturer**, **company**, **code**, and **category** — so multi-token and middle-of-pack-line lookups rank better via Typesense (`query_by` includes `search_blob`).

On cold start Functions **PATCH** missing `search_blob` onto existing `medicines` collections. Existing documents populate on the next **`onMedicineWriteTypesense`** or a full **`adminReindexMedicinesTypesense`** run — **perform at least one reindex or wait for writes** before expecting full recall uplift.

### Callable parity (retailer app)

HTTPS callable **`searchMedicinesTypesense`** accepts optional:

- **`strict`**: **`true`** = admin picker style (narrower Typesense knobs, skips `code` in text `query_by` unless digit-only lookups). Omit or **`false`** = retailer/mobile default (`split_join_tokens: always`, broader typos + prefix fan-out).
- **`matchTokenCount`**, **`queryMode`** (`'strict'` \| `'natural'`) — echoed for tuning / escape hatch (`'natural'` asks for broader bridging when used).
