# SimpliPharma Admin - Quick Deployment Steps

**Server:** 103.230.227.5 | **SSH Port:** 2022 | **User:** sanchet_ftpuser

Environment-based deploys: **`develop` → dev**, **`main` → prod**.

| Env | Branch | Port | Deploy path | URL |
|-----|--------|------|-------------|-----|
| **dev** | `develop` | **8083** | `/var/www/simplipharma-admin-dev` | http://103.230.227.5:8083 |
| **prod** | `main` | **8085** | `/var/www/simplipharma-admin` | http://103.230.227.5:8085 |

---

## Option 1: Jenkins Deployment (Recommended)

### Initial Setup (One-time)

1. **Access Jenkins:** http://103.230.227.5:8080

2. **Node.js** — Manage Jenkins → Global Tool Configuration → NodeJS `nodejs` 18.x+

3. **Firebase credentials** — both `develop` and `main` currently use the same secrets:
   - `simplipharma-firebase-api-key`
   - `simplipharma-firebase-auth-domain`
   - `simplipharma-firebase-project-id`
   - `simplipharma-firebase-storage-bucket`
   - `simplipharma-firebase-messaging-sender-id`
   - `simplipharma-firebase-app-id`

   When you add a separate Firebase project for admin dev, change `FB_CRED_PREFIX` for `develop` in `Jenkinsfile` to `simplipharma-dev-firebase` and create matching credentials.

4. **Create / update Pipeline jobs**

   **Recommended: Multibranch Pipeline**
   - New Item → Name: `simplipharma-admin`
   - Type: **Multibranch Pipeline**
   - Branch Sources → Git → `https://github.com/chankey91/simplipharma-web-admin.git`
   - Filter / discover `develop` and `main`
   - Script Path: `Jenkinsfile`
   - Save → Scan Repository

   **Alternative: two classic Pipeline jobs**
   | Job | Branch | Deploys |
   |-----|--------|---------|
   | `simplipharma-admin-dev` | `*/develop` | port 8083 |
   | `simplipharma-admin-deployment` | `*/main` | port 8085 |

   Important: use **Pipeline script from SCM** (do not hardcode `git branch: 'main'` in the job). The `Jenkinsfile` no longer re-checkouts a fixed branch.

5. **Auto-deploy on merge (webhook)**
   - Job → **Configure** → **Build Triggers** → **GitHub hook trigger for GITScm polling**
   - GitHub → repo **Settings → Webhooks → Add webhook**
     - Payload URL: `http://103.230.227.5:8080/github-webhook/`
     - Content type: `application/json`
     - Events: **Just the push event**

6. **Jenkins sudo** (if not already configured):
   ```bash
   sudo tee /etc/sudoers.d/jenkins << EOF
   jenkins ALL=(ALL) NOPASSWD: /bin/mkdir, /bin/cp, /bin/mv, /bin/rm, /bin/chown, /bin/chmod, /usr/bin/tee, /usr/sbin/nginx, /bin/systemctl
   EOF
   sudo chmod 0440 /etc/sudoers.d/jenkins
   ```

7. **Firewall:**
   ```bash
   sudo ufw allow 8085/tcp
   sudo ufw allow 8083/tcp
   ```

### Deploy

| Action | Result |
|--------|--------|
| Merge / push to **`develop`** | Auto-deploy **dev** → http://103.230.227.5:8083 |
| Merge / push to **`main`** | Auto-deploy **prod** → http://103.230.227.5:8085 |
| Manual | Jenkins → job → **Build Now** |

---

## Option 2: Manual Deployment

Use env-specific files: `.env.dev` or `.env.prod`.

```bash
ssh -p 2022 sanchet_ftpuser@103.230.227.5

cd ~
git clone https://github.com/chankey91/simplipharma-web-admin.git
cd simplipharma-web-admin

cat > .env.dev << 'EOF'
VITE_FIREBASE_API_KEY=AIzaSyCFtUVHKtADWllccdnlbougsnsntEUHQDA
VITE_FIREBASE_AUTH_DOMAIN=simplipharma.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=simplipharma
VITE_FIREBASE_STORAGE_BUCKET=simplipharma.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=343720215451
VITE_FIREBASE_APP_ID=1:343720215451:android:d2576ba41a99a5681e973e
VITE_APP_NAME="SimpliPharma Admin Panel (Dev)"
VITE_APP_VERSION=1.0.0
EOF

cp .env.dev .env.prod
# edit .env.prod name if needed

chmod +x deploy.sh
./deploy.sh prod   # or: ./deploy.sh dev
```

Subsequent deploys:

```bash
cd ~/simplipharma-web-admin
git pull origin develop   # or main
./deploy.sh dev           # or: ./deploy.sh prod
```

---

## Verify

```bash
# Dev
curl http://103.230.227.5:8083/health

# Prod
curl http://103.230.227.5:8085/health
```

---

## Ports on this server

| App | Port |
|-----|------|
| Blood Bank | 8081 |
| **SimpliPharma Admin (prod)** | **8085** |
| **SimpliPharma Admin (dev)** | **8083** |
| SimpliPharma Web App (prod) | 8087 |
| SimpliPharma Web App (dev) | 8084 |
| Jenkins | 8080 |

---

## File locations

| Item | Location |
|------|----------|
| Prod files | `/var/www/simplipharma-admin/current/` |
| Dev files | `/var/www/simplipharma-admin-dev/current/` |
| Prod nginx | `/etc/nginx/sites-available/simplipharma-admin` |
| Dev nginx | `/etc/nginx/sites-available/simplipharma-admin-dev` |

---

## Rollback

**Prod:**
```bash
sudo rm -rf /var/www/simplipharma-admin/current
sudo mv /var/www/simplipharma-admin/backup-YYYYMMDD-HHMMSS /var/www/simplipharma-admin/current
sudo systemctl reload nginx
```

**Dev:**
```bash
sudo rm -rf /var/www/simplipharma-admin-dev/current
sudo mv /var/www/simplipharma-admin-dev/backup-YYYYMMDD-HHMMSS /var/www/simplipharma-admin-dev/current
sudo systemctl reload nginx
```
