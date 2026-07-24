# Typesense + Cloud Functions

Your self-hosted Typesense is at `http://103.230.227.5:8088` (health: [http://103.230.227.5:8088/health](http://103.230.227.5:8088/health)).

## 1. Set Firebase Functions config (production)

Run **from the `MedicineSupplyApp_ADMIN` folder** (where `firebase.json` lives), logged into the correct Firebase project.

**Bash / Git Bash** (use single quotes around API keys so `$` and `#` are not interpreted):

```bash
firebase functions:config:set \
  typesense.host="103.230.227.5" \
  typesense.protocol="http" \
  typesense.port="8088" \
  typesense.api_key='YOUR_ADMIN_API_KEY' \
  typesense.search_api_key='YOUR_SEARCH_ONLY_API_KEY'
```

**PowerShell**:

```powershell
firebase functions:config:set `
  typesense.host=103.230.227.5 `
  typesense.protocol=http `
  typesense.port=8088 `
  typesense.api_key='YOUR_ADMIN_API_KEY' `
  typesense.search_api_key='YOUR_SEARCH_ONLY_API_KEY'
```

- `typesense.api_key` — **admin/master** key (upsert, delete, reindex, synonyms).
- `typesense.search_api_key` — **search-only** key used by `searchMedicinesTypesense`. If omitted, Functions fall back to the admin key.

Then deploy:

```bash
cd functions && npm run build && cd .. && firebase deploy --only functions
```

## 2. Create a search-only API key (Typesense)

On the Typesense host (or via any admin-key client):

```bash
curl -X POST "http://127.0.0.1:8088/keys" \
  -H "X-TYPESENSE-API-KEY: YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "SimpliPharma medicine search",
    "actions": ["documents:search"],
    "collections": ["medicines"]
  }'
```

Copy the returned `value` into `typesense.search_api_key`, then redeploy Functions.

## 3. Local emulator (optional)

Copy `functions/.runtimeconfig.json.example` to `functions/.runtimeconfig.json`, replace keys, then run emulators. This file is gitignored.

## 4. Port default (easy mistake)

Functions code treats **omit** `typesense.port` like this:

- `protocol=http` → default port **`8108`** (official Typesense default), **not** 8088.
- `protocol=https` → default **`443`**.

If your server listens on **8088**, you **must** set `typesense.port="8088"` explicitly.

## 5. Firewall

Cloud Functions run on Google’s network. Your Linux server must allow **inbound TCP** on the Typesense listen port (**8088** in the example, or **443** behind HTTPS), from the internet (or whichever source your policy allows Google egress through). If search fails after deploy, check security groups / `ufw` / cloud firewall.

## 6. Security: HTTPS + Nginx

Prefer **HTTPS** in front of Typesense (Nginx + Let’s Encrypt) and point `protocol`/`port` at that endpoint.

Example Nginx reverse proxy sketch:

```nginx
server {
  listen 443 ssl http2;
  server_name typesense.example.com;
  ssl_certificate     /etc/letsencrypt/live/typesense.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/typesense.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8108;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

Then set:

```bash
firebase functions:config:set \
  typesense.host="typesense.example.com" \
  typesense.protocol="https" \
  typesense.port="443"
```

**Rotate keys** if they were ever committed or shared; create new keys in Typesense and update config + redeploy.

## 7. Ulimits + health monitoring

Docker Compose (`functions/docker-compose.typesense.yml`) sets `nofile`/`nproc` to **65535** and a `/health` healthcheck — use this pattern on the prod host to avoid “Too many open files”.

Install the cron health script on the Typesense host:

```bash
# every 2 minutes
*/2 * * * * /opt/simplipharma/scripts/typesense-healthcheck.sh >> /var/log/typesense-health.log 2>&1
```

Script path in repo: `functions/scripts/typesense-healthcheck.sh`. Env overrides: `TYPESENSE_HEALTH_URL`, `TYPESENSE_CONTAINER`.

## 8. Backfill index + synonyms

After deploy:

1. **Admin → Inventory → Rebuild search index** (or call `adminReindexMedicinesTypesense`) — also upserts the pharma synonym seed.
2. Or call **`adminSyncMedicineSynonymsTypesense`** alone to refresh synonyms without a full reindex.

## 9. Schema: `search_blob` (automatic)

The index includes an optional **`search_blob`** — lowercase concatenation of **name**, **manufacturer**, **company**, **code**, and **category** — so multi-token and middle-of-pack-line lookups rank better via Typesense (`query_by` includes `search_blob`).

On cold start (admin paths) Functions **PATCH** missing fields onto existing `medicines` collections. Existing documents populate on the next **`onMedicineWriteTypesense`** or a full **`adminReindexMedicinesTypesense`** run.

## 10. Search analytics

Each authenticated search logs a structured JSON line (`event: typesense_medicine_search`) with latency, found count, empty flag, browse vs query.

Best-effort daily counters land in Firestore `typesenseSearchAnalytics/medicines_YYYY-MM-DD` (`searches`, `emptySearches`, `browseSearches`, `latencyMsSum`). These writes never block the search response.

### Scale notes (~800k masters)

- Search/browse must go through Typesense (`browse: true` + `page` / filters). **Never** download the full `medicines` collection into the admin browser.
- Index includes denormalized `stock`, `currentStock`, `nearestExpiry`, `unit`, `gstRate`.
- `adminReindexMedicinesTypesense` pages Firestore in chunks of 500 (safe for large catalogs). After deploying schema changes, run **Rebuild search index** once.
- Prefer HTTPS + search-only API keys and health monitoring on the Typesense host before production load at this scale.
- Client pickers trust Typesense hit order (no client-side re-rank).
