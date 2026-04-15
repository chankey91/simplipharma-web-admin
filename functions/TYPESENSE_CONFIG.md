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

## 3. Firewall

Cloud Functions run on Google’s network. Your Linux server must allow **inbound TCP 8088** (or your reverse-proxy port) from the internet, or restrict by rule as you prefer. If search fails after deploy, check security groups / `ufw` / cloud firewall.

## 4. Security

- Prefer **HTTPS** in front of Typesense (e.g. Nginx + Let’s Encrypt) and point `protocol`/`port` at that endpoint.
- **Rotate the API key** if it was ever committed or shared; create a new key in Typesense and update `firebase functions:config:set` + redeploy.

## 5. Backfill index

After deploy: **Admin → Inventory → Rebuild search index**, or call the `adminReindexMedicinesTypesense` callable as an admin user.
