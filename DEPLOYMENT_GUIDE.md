# SimpliPharma Admin Panel - Complete Deployment Guide

## 📋 Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Server Setup](#server-setup)
4. [Firebase Configuration](#firebase-configuration)
5. [Jenkins Setup](#jenkins-setup)
6. [Manual Deployment](#manual-deployment)
7. [Troubleshooting](#troubleshooting)
8. [Maintenance](#maintenance)

---

## 🎯 Overview

**Application Details:**
- **Name:** SimpliPharma Admin Panel
- **Type:** React + Vite SPA (Single Page Application)
- **Backend:** Firebase (Cloud-based)
- **Server IP:** 103.230.227.5
- **SSH Port:** 2022
- **SSH User:** sanchet_ftpuser
- **External Port:** 8085 (Nginx)
- **Deployment Path:** /var/www/simplipharma-admin/

**Architecture:**
```
Internet → Nginx (Port 8085) → Static Files (/var/www/simplipharma-admin/current)
                                       ↓
                                   Firebase Cloud Services
```

---

## 📦 Prerequisites

### On Your Local Machine:
- Git
- SSH access to the server

### On the Server (103.230.227.5):
- ✅ Ubuntu/Debian Linux
- ✅ Node.js 18+ (`node -v`)
- ✅ npm (`npm -v`)
- ✅ Nginx (`nginx -v`)
- ✅ Jenkins (running at http://103.230.227.5:8080)
- ✅ Git

### Verify Prerequisites on Server:
```bash
ssh -p 2022 sanchet_ftpuser@103.230.227.5

# Check installed software
node -v        # Should be 18.x or higher
npm -v         # Should be 9.x or higher
nginx -v       # Should be installed
git --version  # Should be installed
```

---

## 🖥️ Server Setup

### 1. Connect to Server
```bash
ssh -p 2022 sanchet_ftpuser@103.230.227.5
```

### 2. Create Deployment Directory
```bash
sudo mkdir -p /var/www/simplipharma-admin
sudo chown -R $USER:www-data /var/www/simplipharma-admin
```

### 3. Install Nginx (if not already installed)
```bash
sudo apt-get update
sudo apt-get install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 4. Configure Firewall (if UFW is enabled)
```bash
# Check if UFW is active
sudo ufw status

# If active, allow port 8085
sudo ufw allow 8085/tcp
```

---

## 🔥 Firebase Configuration

### Step 1: Get Firebase Credentials

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your **simplipharma** project
3. Click the ⚙️ **gear icon** → **Project Settings**
4. Scroll to **"Your apps"** section
5. Select your **Web app** (or create one if it doesn't exist)
6. Copy the configuration values:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",              // VITE_FIREBASE_API_KEY
  authDomain: "simplipharma.firebaseapp.com",  // VITE_FIREBASE_AUTH_DOMAIN
  projectId: "simplipharma",         // VITE_FIREBASE_PROJECT_ID
  storageBucket: "simplipharma.firebasestorage.app",  // VITE_FIREBASE_STORAGE_BUCKET
  messagingSenderId: "343720215451", // VITE_FIREBASE_MESSAGING_SENDER_ID
  appId: "1:343720215451:android:..." // VITE_FIREBASE_APP_ID
};
```

### Step 2: Important Notes

**❓ Do I need a Service Account JSON file?**
- **NO** - This is a frontend-only application
- Service accounts are only needed for backend admin operations
- The web config credentials are safe to use in client-side code
- Firebase security rules protect your data

**🔒 Are these credentials sensitive?**
- These are **client-side** credentials (safe for frontend use)
- They're meant to identify your Firebase project
- Security is enforced through Firebase Security Rules
- **DO NOT** confuse with Service Account private keys (which are sensitive)

---

## 🔄 Jenkins Setup

### Step 1: Access Jenkins
1. Open: http://103.230.227.5:8080
2. Login with your admin credentials

### Step 2: Install NodeJS Plugin (if not installed)
1. Go to **Manage Jenkins** → **Manage Plugins**
2. Click **Available** tab
3. Search for **NodeJS**
4. Select and click **Install without restart**

### Step 3: Configure Node.js
1. Go to **Manage Jenkins** → **Global Tool Configuration**
2. Scroll to **NodeJS** section
3. Click **Add NodeJS**
   - **Name:** `nodejs` (must match Jenkinsfile)
   - **Version:** Select Node.js 18.x or later
   - **Global npm packages:** (leave empty)
4. Click **Save**

### Step 4: Add Firebase Credentials to Jenkins
1. Go to **Manage Jenkins** → **Manage Credentials**
2. Click **(global)** → **Add Credentials**
3. Add each credential as **Secret text**:

| Credential ID | Value | Example |
|--------------|-------|---------|
| `simplipharma-firebase-api-key` | Your API Key | AIzaSyCFt... |
| `simplipharma-firebase-auth-domain` | Auth Domain | simplipharma.firebaseapp.com |
| `simplipharma-firebase-project-id` | Project ID | simplipharma |
| `simplipharma-firebase-storage-bucket` | Storage Bucket | simplipharma.firebasestorage.app |
| `simplipharma-firebase-messaging-sender-id` | Sender ID | 343720215451 |
| `simplipharma-firebase-app-id` | App ID | 1:343720215451:android:... |

**Important:** Use **exactly** these credential IDs (they must match the Jenkinsfile).

### Step 5: Create Jenkins Pipeline Job

1. Click **New Item**
2. Enter name: `simplipharma-admin-deployment`
3. Select **Pipeline** → Click **OK**
4. Configure the job:

#### General
- **Description:** "SimpliPharma Admin Panel - Automated Deployment"
- ☑️ **Discard old builds**
  - Max # of builds to keep: 10

#### Build Triggers
- ☑️ **GitHub hook trigger for GITScm polling** (optional, for auto-deployment on push)
- OR: ☑️ **Poll SCM** with schedule: `H/5 * * * *` (checks every 5 minutes)

#### Pipeline
- **Definition:** Pipeline script from SCM
- **SCM:** Git
- **Repository URL:** `https://github.com/chankey91/simplipharma-web-admin.git`
- **Branch:** `*/main`
- **Script Path:** `Jenkinsfile`

5. Click **Save**

### Step 6: Grant Jenkins User Sudo Permissions

Jenkins needs sudo access to deploy files and configure Nginx:

```bash
# On the server
sudo visudo

# Add this line at the end (replace 'jenkins' with actual Jenkins user)
jenkins ALL=(ALL) NOPASSWD: /bin/mkdir, /bin/cp, /bin/mv, /bin/rm, /bin/chown, /bin/chmod, /usr/bin/tee, /usr/sbin/nginx, /bin/systemctl
```

**Or create a dedicated sudoers file:**
```bash
sudo tee /etc/sudoers.d/jenkins << EOF
jenkins ALL=(ALL) NOPASSWD: /bin/mkdir, /bin/cp, /bin/mv, /bin/rm, /bin/chown, /bin/chmod, /usr/bin/tee, /usr/sbin/nginx, /bin/systemctl
EOF

sudo chmod 0440 /etc/sudoers.d/jenkins
```

### Step 7: Run First Deployment
1. Go to your pipeline job
2. Click **Build Now**
3. Monitor the **Console Output**
4. Wait for **SUCCESS** message

---

## 🚀 Manual Deployment (Alternative to Jenkins)

If Jenkins is not available or for emergency deployments:

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

Paste your Firebase configuration:
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

Save: `Ctrl+X`, `Y`, `Enter`

### Step 3: Run Deployment Script
```bash
chmod +x deploy.sh
./deploy.sh
```

The script will:
- ✅ Check prerequisites
- ✅ Install dependencies
- ✅ Build the application
- ✅ Deploy to /var/www/simplipharma-admin/
- ✅ Configure Nginx
- ✅ Reload Nginx
- ✅ Verify deployment

### Step 4: Verify Deployment
```bash
# Check if files exist
ls -la /var/www/simplipharma-admin/current/

# Test health endpoint
curl http://localhost:8085/health

# Check Nginx status
sudo systemctl status nginx

# View logs
sudo tail -f /var/log/nginx/simplipharma-admin-access.log
```

---

## 🔍 Troubleshooting

### Problem: Port 8085 Already in Use
```bash
# Check what's using port 8085
sudo lsof -i :8085
sudo netstat -tulpn | grep 8085

# If something else is using it, either:
# 1. Stop that service, OR
# 2. Change NGINX_PORT in Jenkinsfile and nginx config
```

### Problem: Nginx Test Fails
```bash
# Check Nginx configuration
sudo nginx -t

# View detailed error
sudo nginx -t 2>&1

# Check Nginx error log
sudo tail -50 /var/log/nginx/error.log

# Common fix: remove syntax errors or duplicate server blocks
sudo nano /etc/nginx/sites-available/simplipharma-admin
```

### Problem: 403 Forbidden Error
```bash
# Check file permissions
ls -la /var/www/simplipharma-admin/current/

# Fix permissions
sudo chown -R www-data:www-data /var/www/simplipharma-admin/current
sudo chmod -R 755 /var/www/simplipharma-admin/current

# Reload Nginx
sudo systemctl reload nginx
```

### Problem: 502 Bad Gateway
- **This shouldn't happen** for static sites
- Check Nginx error logs: `sudo tail -50 /var/log/nginx/simplipharma-admin-error.log`
- Verify files exist: `ls /var/www/simplipharma-admin/current/index.html`

### Problem: Blank Page / White Screen
```bash
# Check browser console for errors
# Likely causes:
# 1. Firebase credentials missing/incorrect in .env
# 2. CORS issues
# 3. Build failed

# Verify .env was used during build
cat dist/assets/*.js | grep -o "VITE_" | head -5

# If you see "VITE_" in output, env vars weren't replaced
# Make sure .env exists BEFORE running npm run build
```

### Problem: Firebase Auth Not Working
1. Check Firebase credentials in `.env`
2. Verify Firebase project settings:
   - Go to Firebase Console → Authentication
   - Enable **Email/Password** authentication
3. Add authorized domain:
   - Firebase Console → Authentication → Settings → Authorized domains
   - Add: `103.230.227.5`

### Problem: Jenkins Build Fails - "node: command not found"
```bash
# Jenkins can't find Node.js
# Solution: Configure NodeJS plugin (see Step 3 of Jenkins Setup)
```

### Problem: Jenkins Build Fails - Permission Denied
```bash
# Jenkins user needs sudo permissions
# See "Step 6: Grant Jenkins User Sudo Permissions"
```

---

## 🛠️ Maintenance

### Viewing Logs
```bash
# Nginx access log
sudo tail -f /var/log/nginx/simplipharma-admin-access.log

# Nginx error log
sudo tail -f /var/log/nginx/simplipharma-admin-error.log

# Jenkins console output
# Go to: http://103.230.227.5:8080/job/simplipharma-admin-deployment/lastBuild/console
```

### Updating the Application
**Via Jenkins:**
1. Push changes to GitHub
2. Go to Jenkins → Your pipeline
3. Click **Build Now**

**Manually:**
```bash
cd ~/simplipharma-web-admin
git pull origin main
npm install
npm run build
sudo cp -r dist/* /var/www/simplipharma-admin/current/
sudo systemctl reload nginx
```

### Rolling Back to Previous Version
```bash
# List backups
ls -lt /var/www/simplipharma-admin/

# Rollback to a specific backup
sudo rm -rf /var/www/simplipharma-admin/current
sudo mv /var/www/simplipharma-admin/backup-20241127-143022 /var/www/simplipharma-admin/current
sudo systemctl reload nginx
```

### Checking Application Status
```bash
# Health check
curl http://103.230.227.5:8085/health

# Full test (should return HTML)
curl http://103.230.227.5:8085/

# Check Nginx is running
sudo systemctl status nginx

# Check port is open
sudo netstat -tulpn | grep 8085
```

### Restarting Services
```bash
# Reload Nginx (graceful, no downtime)
sudo systemctl reload nginx

# Restart Nginx (full restart, brief downtime)
sudo systemctl restart nginx

# Restart Jenkins (if needed)
sudo systemctl restart jenkins
```

### Cleaning Up Old Backups
```bash
# Keep only last 3 backups
cd /var/www/simplipharma-admin
ls -t | grep backup | tail -n +4 | xargs sudo rm -rf
```

### Monitoring Disk Space
```bash
# Check disk usage
df -h /var/www

# Check size of deployment directory
du -sh /var/www/simplipharma-admin/*
```

---

## 📚 Additional Resources

### Project Structure
```
/var/www/simplipharma-admin/
├── current/                    # Active deployment
│   ├── index.html
│   └── assets/
│       ├── index-xxxxx.js
│       └── index-xxxxx.css
├── backup-20241127-143022/    # Backup 1
├── backup-20241127-120515/    # Backup 2
└── backup-20241126-183042/    # Backup 3
```

### Nginx Configuration Location
- **Config file:** `/etc/nginx/sites-available/simplipharma-admin`
- **Enabled symlink:** `/etc/nginx/sites-enabled/simplipharma-admin`
- **Main config:** `/etc/nginx/nginx.conf`

### Important Commands Cheat Sheet
```bash
# SSH to server
ssh -p 2022 sanchet_ftpuser@103.230.227.5

# Deploy manually
cd ~/simplipharma-web-admin && ./deploy.sh

# Check application
curl http://103.230.227.5:8085/health

# View logs
sudo tail -f /var/log/nginx/simplipharma-admin-access.log

# Reload Nginx
sudo systemctl reload nginx

# Rollback deployment
sudo mv /var/www/simplipharma-admin/backup-* /var/www/simplipharma-admin/current
```

### URLs
- **Application:** http://103.230.227.5:8085
- **Health Check:** http://103.230.227.5:8085/health
- **Jenkins:** http://103.230.227.5:8080
- **Blood Bank App:** http://103.230.227.5:8081

---

## ✅ Deployment Checklist

### Pre-Deployment
- [ ] Server access verified (SSH on port 2022)
- [ ] Node.js 18+ installed
- [ ] Nginx installed and running
- [ ] Firebase credentials obtained
- [ ] Port 8085 available

### Jenkins Setup
- [ ] NodeJS plugin installed
- [ ] Node.js configured in Global Tool Configuration
- [ ] Firebase credentials added to Jenkins
- [ ] Jenkins user has sudo permissions
- [ ] Pipeline job created

### Post-Deployment
- [ ] Application accessible at http://103.230.227.5:8085
- [ ] Health check returns "healthy"
- [ ] Can login with admin credentials
- [ ] Firebase authentication working
- [ ] Nginx logs show no errors

---

## 🆘 Support

### Common Issues Documentation
See **Troubleshooting** section above

### Check Application Health
```bash
curl http://103.230.227.5:8085/health
```

### Contact Information
- **Repository:** https://github.com/chankey91/simplipharma-web-admin
- **Firebase Console:** https://console.firebase.google.com

---

## 📝 Notes

1. **This is a STATIC site** - No Node.js process runs after deployment
2. **Firebase handles all backend logic** - Authentication, Database, Storage
3. **Nginx serves static files** - HTML, CSS, JavaScript
4. **Both apps can run simultaneously** - Different ports prevent conflicts
5. **Backups are automatic** - Last 3 versions kept

---

**Deployment Date:** [Auto-generated by Jenkins or manual entry]  
**Deployed By:** [Your name]  
**Version:** 1.0.0

---

Good luck with your deployment! 🚀

