# 🚀 START HERE - SimpliPharma Admin Deployment

## Welcome!

This guide will help you deploy SimpliPharma Admin Panel to your server **103.230.227.5** on port **8085**.

---

## ⚡ Quick Decision Tree

### 1️⃣ Have you deployed apps with Jenkins before?

**YES** → Jump to: [Jenkins Deployment](#jenkins-deployment-recommended)  
**NO** → Jump to: [Manual Deployment](#manual-deployment-simpler)

### 2️⃣ Need to understand the full system first?

**YES** → Read: `DEPLOYMENT_GUIDE.md` (comprehensive guide)  
**NO** → Continue below for quick setup

---

## 🎯 What Will Be Deployed

- **Application:** SimpliPharma Admin Panel (Medical inventory management)
- **Type:** React + Vite (frontend-only, no backend server)
- **Server:** 103.230.227.5
- **Port:** 8085 (via Nginx)
- **Path:** /var/www/simplipharma-admin/
- **Backend:** Firebase (cloud-based)

**Coexists with:** Blood Bank App (already running on port 8081)

---

## 📋 Prerequisites (Check These First)

### On Server (103.230.227.5)

Connect to server:
```bash
ssh -p 2022 sanchet_ftpuser@103.230.227.5
```

Verify:
```bash
node -v        # Need: 18.x or higher
npm -v         # Need: 9.x or higher  
nginx -v       # Need: installed
git --version  # Need: installed
```

❌ **Missing something?** → See `DEPLOYMENT_GUIDE.md` → Prerequisites section

✅ **All good?** → Continue below

---

## 🔥 Get Firebase Credentials

You'll need these for deployment:

1. Go to: https://console.firebase.google.com
2. Select project: **simplipharma**
3. Click ⚙️ → **Project Settings**
4. Scroll to **"Your apps"** → Select Web app
5. Copy these values:

```
API Key:              AIzaSy...
Auth Domain:          simplipharma.firebaseapp.com
Project ID:           simplipharma
Storage Bucket:       simplipharma.firebasestorage.app
Messaging Sender ID:  343720215451
App ID:               1:343720215451:android:...
```

✅ **Got them?** → Proceed to deployment

---

## 🏢 Jenkins Deployment (Recommended)

**Best for:** Production, automated deployments, team environments

### Step 1: Access Jenkins
```
URL: http://103.230.227.5:8080
Login with your admin credentials
```

### Step 2: Install & Configure Node.js
1. **Manage Jenkins** → **Manage Plugins** → **Available**
2. Search: `NodeJS` → Install
3. **Manage Jenkins** → **Global Tool Configuration**
4. **NodeJS** → **Add NodeJS**
   - Name: `nodejs`
   - Version: 18.x or later
   - Save

### Step 3: Add Firebase Credentials

**Detailed guide:** `JENKINS_CREDENTIALS_SETUP.md`

Quick steps:
1. **Manage Jenkins** → **Manage Credentials** → **(global)**
2. Add 6 **Secret text** credentials:

| ID (exact match required!) | Value |
|---------------------------|-------|
| `simplipharma-firebase-api-key` | AIzaSyCFtUVHKtADWllccdnlbougsnsntEUHQDA |
| `simplipharma-firebase-auth-domain` | simplipharma.firebaseapp.com |
| `simplipharma-firebase-project-id` | simplipharma |
| `simplipharma-firebase-storage-bucket` | simplipharma.firebasestorage.app |
| `simplipharma-firebase-messaging-sender-id` | 343720215451 |
| `simplipharma-firebase-app-id` | 1:343720215451:android:d2576ba41a99a5681e973e |

### Step 4: Grant Jenkins Sudo Access

```bash
ssh -p 2022 sanchet_ftpuser@103.230.227.5

sudo tee /etc/sudoers.d/jenkins << 'EOF'
jenkins ALL=(ALL) NOPASSWD: /bin/mkdir, /bin/cp, /bin/mv, /bin/rm, /bin/chown, /bin/chmod, /usr/bin/tee, /usr/sbin/nginx, /bin/systemctl
EOF

sudo chmod 0440 /etc/sudoers.d/jenkins
```

### Step 5: Create Pipeline Job

1. Jenkins → **New Item**
2. Name: `simplipharma-admin-deployment`
3. Type: **Pipeline**
4. Configure:
   - **Pipeline from SCM** → **Git**
   - Repository: `https://github.com/chankey91/simplipharma-web-admin.git`
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
5. **Save**

### Step 6: Deploy!

1. Click **Build Now**
2. Watch **Console Output**
3. Wait for **SUCCESS** ✅
4. Open: http://103.230.227.5:8085

✅ **Done!** Your app is live.

---

## 🛠️ Manual Deployment (Simpler)

**Best for:** First-time setup, testing, no Jenkins access

### Step 1: Clone Repository on Server

```bash
ssh -p 2022 sanchet_ftpuser@103.230.227.5

cd ~
git clone https://github.com/chankey91/simplipharma-web-admin.git
cd simplipharma-web-admin
```

### Step 2: Create Environment File

```bash
nano .env
```

**Paste this (with your Firebase credentials):**
```env
VITE_FIREBASE_API_KEY=AIzaSyCFtUVHKtADWllccdnlbougsnsntEUHQDA
VITE_FIREBASE_AUTH_DOMAIN=simplipharma.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=simplipharma
VITE_FIREBASE_STORAGE_BUCKET=simplipharma.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=343720215451
VITE_FIREBASE_APP_ID=1:343720215451:android:d2576ba41a99a5681e973e
VITE_APP_NAME="SimpliPharma Admin Panel"
VITE_APP_VERSION=1.0.0
```

**Save:** `Ctrl+X`, then `Y`, then `Enter`

### Step 3: Run Deployment Script

```bash
chmod +x deploy.sh
./deploy.sh
```

The script will:
- ✅ Check prerequisites
- ✅ Install dependencies (npm install)
- ✅ Build application (npm run build)
- ✅ Deploy to /var/www/simplipharma-admin/
- ✅ Configure Nginx
- ✅ Start serving on port 8085

### Step 4: Verify

```bash
# Health check
curl http://103.230.227.5:8085/health
# Should return: healthy

# Open in browser
# http://103.230.227.5:8085
```

✅ **Done!** Your app is live.

---

## ✅ Verification Checklist

After deployment, check:

### Application
- [ ] http://103.230.227.5:8085 loads
- [ ] Login page appears
- [ ] Can login with admin credentials
- [ ] No errors in browser console (F12)

### Server
```bash
# Health check
curl http://103.230.227.5:8085/health

# Nginx status
sudo systemctl status nginx

# Files exist
ls /var/www/simplipharma-admin/current/index.html

# Check logs (should have no errors)
sudo tail -20 /var/log/nginx/simplipharma-admin-error.log
```

---

## 🐛 Something Wrong?

### Port 8085 Not Responding

```bash
# Check if Nginx is running
sudo systemctl status nginx

# Restart Nginx
sudo systemctl restart nginx

# Check port is open
sudo netstat -tulpn | grep 8085
```

### 403 Forbidden Error

```bash
# Fix permissions
sudo chown -R www-data:www-data /var/www/simplipharma-admin/current
sudo chmod -R 755 /var/www/simplipharma-admin/current
sudo systemctl reload nginx
```

### Blank White Page

- Open browser console (F12)
- Look for Firebase errors
- Check .env file has correct credentials
- Verify Firebase credentials in Firebase Console

### More Help

- **Quick fixes:** `SERVER_DEPLOYMENT_STEPS.md` → Troubleshooting
- **Comprehensive guide:** `DEPLOYMENT_GUIDE.md` → Troubleshooting (17 sections!)
- **Jenkins issues:** `JENKINS_CREDENTIALS_SETUP.md` → Troubleshooting

---

## 📚 All Documentation Files

**For different needs:**

| Document | When to Use |
|----------|-------------|
| **`START_HERE.md`** (this file) | Quick start, first deployment |
| **`DEPLOYMENT_GUIDE.md`** | Complete reference, troubleshooting |
| **`SERVER_DEPLOYMENT_STEPS.md`** | Command reference, quick lookup |
| **`JENKINS_CREDENTIALS_SETUP.md`** | Jenkins credential configuration |
| **`README_DEPLOYMENT.md`** | Package overview, architecture |
| **`DEPLOYMENT_SUMMARY.md`** | Project summary, what's included |

**Configuration Files:**

| File | Purpose |
|------|---------|
| `Jenkinsfile` | Jenkins pipeline configuration |
| `nginx-simplipharma-admin.conf` | Nginx configuration |
| `deploy.sh` | Manual deployment script |
| `firebase-config-template.env` | Environment variable template |

---

## 🎯 After Successful Deployment

### Update Your App Later

**Via Jenkins:**
1. Push changes to GitHub
2. Go to Jenkins → Your pipeline
3. Click "Build Now"

**Manually:**
```bash
cd ~/simplipharma-web-admin
git pull origin main
./deploy.sh
```

### View Logs

```bash
# Access log
sudo tail -f /var/log/nginx/simplipharma-admin-access.log

# Error log
sudo tail -f /var/log/nginx/simplipharma-admin-error.log
```

### Rollback if Needed

```bash
# List backups
ls -lt /var/www/simplipharma-admin/

# Restore backup (replace with actual backup name)
sudo rm -rf /var/www/simplipharma-admin/current
sudo mv /var/www/simplipharma-admin/backup-20241127-143022 /var/www/simplipharma-admin/current
sudo systemctl reload nginx
```

---

## 🔐 Important Security Notes

1. **Firebase credentials in this setup are for CLIENT-SIDE use**
   - They're safe to expose in frontend code
   - Security is enforced through Firebase Security Rules

2. **No Service Account needed**
   - This is a frontend-only app
   - Service accounts are only for backend admin operations

3. **For Production:**
   - [ ] Enable HTTPS (Let's Encrypt certificate)
   - [ ] Set up proper Firebase Security Rules
   - [ ] Configure Firebase App Check
   - [ ] Enable firewall (UFW)

---

## 📞 Need Help?

**Repository:** https://github.com/chankey91/simplipharma-web-admin  
**Firebase Console:** https://console.firebase.google.com  
**Jenkins:** http://103.230.227.5:8080  
**Application:** http://103.230.227.5:8085

---

## ✨ You're Ready!

1. Choose your deployment method above
2. Follow the steps
3. Verify deployment works
4. Start using your app!

**Estimated Time:** 25-40 minutes for first deployment

---

**Good luck! 🚀**

Questions? Refer to `DEPLOYMENT_GUIDE.md` for comprehensive help.

