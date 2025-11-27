# SimpliPharma Admin Panel - Deployment Package

## 📦 What's Included

This deployment package contains everything needed to deploy SimpliPharma Admin Panel to your server.

---

## 📁 Files Overview

| File | Purpose | When to Use |
|------|---------|-------------|
| **`Jenkinsfile`** | Jenkins pipeline configuration | Automated CI/CD deployment |
| **`nginx-simplipharma-admin.conf`** | Nginx web server configuration | Configure port 8085 reverse proxy |
| **`deploy.sh`** | Manual deployment script | One-off or emergency deployments |
| **`firebase-config-template.env`** | Environment variables template | Create `.env` file locally |
| **`DEPLOYMENT_GUIDE.md`** | Complete deployment documentation | Full setup instructions (read this first!) |
| **`SERVER_DEPLOYMENT_STEPS.md`** | Quick reference for admins | Fast deployment checklist |
| **`JENKINS_CREDENTIALS_SETUP.md`** | Jenkins credentials guide | Setting up Firebase creds in Jenkins |

---

## 🚀 Quick Start

### Choose Your Deployment Method

#### Option A: Jenkins (Recommended for Production)
**Best for:** Automated deployments, CI/CD, team environments

1. Read: `DEPLOYMENT_GUIDE.md` (sections: Prerequisites, Jenkins Setup)
2. Read: `JENKINS_CREDENTIALS_SETUP.md`
3. Set up Jenkins pipeline using `Jenkinsfile`
4. Click "Build Now" in Jenkins

#### Option B: Manual Script
**Best for:** First-time setup, testing, emergency deployments

1. SSH to server
2. Clone repository
3. Create `.env` file (use `firebase-config-template.env` as reference)
4. Run: `./deploy.sh`

---

## 📖 Documentation Priority

**Read in this order:**

1. **START HERE:** `DEPLOYMENT_GUIDE.md`
   - Complete, detailed instructions
   - Covers all scenarios
   - Includes troubleshooting

2. **For Jenkins:** `JENKINS_CREDENTIALS_SETUP.md`
   - How to add Firebase credentials to Jenkins
   - Step-by-step with screenshots guide

3. **Quick Reference:** `SERVER_DEPLOYMENT_STEPS.md`
   - Command cheat sheet
   - Quick troubleshooting
   - Common tasks

---

## 🎯 Deployment Architecture

```
┌──────────────────────────────────────────────────────────┐
│                         Internet                          │
└─────────────────────────┬────────────────────────────────┘
                          │
                    Port 8085 (HTTP)
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Nginx Web Server                        │
│          Serves static files from:                       │
│          /var/www/simplipharma-admin/current/            │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Static Files (Built React App)              │
│  - index.html                                            │
│  - assets/index-xxxxx.js (with Firebase SDK)            │
│  - assets/index-xxxxx.css                                │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Firebase Cloud                        │
│  - Authentication                                        │
│  - Firestore Database                                    │
│  - Storage                                               │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**
- ✅ Frontend-only application (no Node.js backend)
- ✅ Nginx serves static HTML/CSS/JS files
- ✅ Firebase handles all backend logic
- ✅ No persistent processes after deployment

---

## 🔧 Server Requirements

**Minimum:**
- Ubuntu 18.04+ or Debian 10+
- Node.js 18+
- npm 9+
- Nginx
- 2GB RAM
- 10GB disk space

**Network:**
- Port 8085 accessible (for application)
- Port 8080 accessible (for Jenkins, if used)
- Port 2022 (SSH access)

---

## 🔥 Firebase Setup

### What You Need

From [Firebase Console](https://console.firebase.google.com):
1. API Key
2. Auth Domain
3. Project ID
4. Storage Bucket
5. Messaging Sender ID
6. App ID

### What You DON'T Need

❌ **Service Account JSON** - Not required for this frontend-only app  
❌ **Admin SDK** - Not needed  
❌ **Private Keys** - Not needed

### Where to Get Credentials

1. Go to: https://console.firebase.google.com
2. Select your **simplipharma** project
3. Click ⚙️ → **Project Settings**
4. Scroll to **"Your apps"**
5. Select **Web app** (or create one)
6. Copy the config values

---

## 🛠️ How to Use This Package

### For First-Time Setup:

1. **Read the full guide:**
   ```bash
   cat DEPLOYMENT_GUIDE.md
   ```

2. **Verify server prerequisites:**
   ```bash
   ssh -p 2022 sanchet_ftpuser@103.230.227.5
   node -v        # Should be 18+
   npm -v         # Should be 9+
   nginx -v       # Should be installed
   ```

3. **Choose deployment method:**
   - Jenkins: Follow `JENKINS_CREDENTIALS_SETUP.md`
   - Manual: Use `deploy.sh`

### For Subsequent Deployments:

**Jenkins:**
```
1. Push changes to GitHub
2. Go to Jenkins → Your pipeline
3. Click "Build Now"
```

**Manual:**
```bash
cd ~/simplipharma-web-admin
git pull origin main
./deploy.sh
```

---

## ✅ Verification

After deployment, verify:

```bash
# Health check
curl http://103.230.227.5:8085/health
# Expected: "healthy"

# Check Nginx
sudo systemctl status nginx
# Expected: "active (running)"

# Check files
ls /var/www/simplipharma-admin/current/index.html
# Expected: File exists
```

**In Browser:**
1. Open: http://103.230.227.5:8085
2. Should see login page
3. Login should work
4. No errors in browser console (F12)

---

## 🆘 Getting Help

### Common Issues

| Problem | Quick Fix | Full Documentation |
|---------|-----------|-------------------|
| Port 8085 not accessible | `sudo systemctl restart nginx` | DEPLOYMENT_GUIDE.md → Troubleshooting |
| 403 Forbidden | `sudo chmod -R 755 /var/www/simplipharma-admin` | DEPLOYMENT_GUIDE.md → Problem: 403 |
| Blank page | Check browser console for Firebase errors | DEPLOYMENT_GUIDE.md → Problem: Blank Page |
| Jenkins build fails | Check Node.js plugin is installed | DEPLOYMENT_GUIDE.md → Jenkins Setup |

### Documentation Lookup

- **"How do I...?"** → `DEPLOYMENT_GUIDE.md`
- **"Jenkins credentials error"** → `JENKINS_CREDENTIALS_SETUP.md`
- **"Quick command reference"** → `SERVER_DEPLOYMENT_STEPS.md`

---

## 📊 Application Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript | UI components |
| **Build Tool** | Vite 5 | Fast development & bundling |
| **Routing** | React Router 6 | SPA navigation |
| **State** | Zustand + React Query | State management |
| **UI Library** | Material-UI (MUI) 5 | Component library |
| **Backend** | Firebase | Auth, Database, Storage |
| **Web Server** | Nginx | Serve static files |
| **CI/CD** | Jenkins | Automated deployment |

---

## 🔐 Security Notes

1. **Firebase credentials are public** (safe for frontend)
2. **Security is enforced** through Firebase Security Rules
3. **Admin access** controlled via Firestore `users.role` field
4. **Nginx headers** set for XSS protection
5. **HTTPS recommended** for production (add SSL/TLS certificate)

---

## 📞 Support Resources

- **Repository:** https://github.com/chankey91/simplipharma-web-admin
- **Firebase Console:** https://console.firebase.google.com
- **Jenkins:** http://103.230.227.5:8080
- **Application:** http://103.230.227.5:8085

---

## 🎉 Success Criteria

Deployment is successful when:

- ✅ http://103.230.227.5:8085 loads the login page
- ✅ Health check returns "healthy"
- ✅ Can login with admin credentials
- ✅ Firebase operations work (auth, data loading)
- ✅ No errors in browser console
- ✅ No errors in Nginx logs

---

## 📝 Next Steps After Deployment

1. **Test the application thoroughly**
   - Login/logout
   - Create/edit records
   - Test all features

2. **Set up monitoring** (optional)
   - Watch Nginx logs
   - Set up uptime monitoring
   - Configure alerts

3. **Enable HTTPS** (recommended)
   - Install Let's Encrypt certificate
   - Update Nginx config for SSL
   - Redirect HTTP to HTTPS

4. **Set up backups** (recommended)
   - Firebase exports (automated via Cloud Functions)
   - Application code (already on GitHub)
   - Server configuration files

5. **Document your setup**
   - Note any custom changes
   - Record admin credentials (securely!)
   - Keep deployment dates

---

**Version:** 1.0.0  
**Last Updated:** November 27, 2024  
**Maintainer:** SimpliPharma Team

---

Good luck with your deployment! 🚀

For questions or issues, refer to `DEPLOYMENT_GUIDE.md` first.

