# SimpliPharma Admin - Quick Deployment Steps

## 🚀 Quick Reference for Server Administrator

**Server:** 103.230.227.5 | **SSH Port:** 2022 | **User:** sanchet_ftpuser | **App Port:** 8085

---

## Option 1: Jenkins Deployment (Recommended)

### Initial Setup (One-time)

1. **Access Jenkins**
   ```
   URL: http://103.230.227.5:8080
   ```

2. **Install NodeJS Plugin**
   - Manage Jenkins → Manage Plugins → Available
   - Search "NodeJS" → Install

3. **Configure Node.js**
   - Manage Jenkins → Global Tool Configuration
   - Add NodeJS → Name: `nodejs`, Version: 18.x+

4. **Add Firebase Credentials**
   - Manage Jenkins → Manage Credentials → (global)
   - Add 6 **Secret Text** credentials:
   
   | ID | Value |
   |---|---|
   | `simplipharma-firebase-api-key` | AIzaSyCFtUVHKtADWllccdnlbougsnsntEUHQDA |
   | `simplipharma-firebase-auth-domain` | simplipharma.firebaseapp.com |
   | `simplipharma-firebase-project-id` | simplipharma |
   | `simplipharma-firebase-storage-bucket` | simplipharma.firebasestorage.app |
   | `simplipharma-firebase-messaging-sender-id` | 343720215451 |
   | `simplipharma-firebase-app-id` | 1:343720215451:android:d2576ba41a99a5681e973e |

5. **Create Pipeline Job**
   - New Item → Name: `simplipharma-admin-deployment`
   - Type: **Pipeline**
   - Pipeline from SCM → Git
   - Repository: `https://github.com/chankey91/simplipharma-web-admin.git`
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`

6. **Grant Jenkins Sudo Access**
   ```bash
   ssh -p 2022 sanchet_ftpuser@103.230.227.5
   
   sudo tee /etc/sudoers.d/jenkins << EOF
   jenkins ALL=(ALL) NOPASSWD: /bin/mkdir, /bin/cp, /bin/mv, /bin/rm, /bin/chown, /bin/chmod, /usr/bin/tee, /usr/sbin/nginx, /bin/systemctl
   EOF
   
   sudo chmod 0440 /etc/sudoers.d/jenkins
   ```

### Deploy Application

1. Go to Jenkins → `simplipharma-admin-deployment`
2. Click **"Build Now"**
3. Wait for SUCCESS ✅
4. Access: http://103.230.227.5:8085

---

## Option 2: Manual Deployment

### First Time Setup

```bash
# 1. SSH to server
ssh -p 2022 sanchet_ftpuser@103.230.227.5

# 2. Clone repository
cd ~
git clone https://github.com/chankey91/simplipharma-web-admin.git
cd simplipharma-web-admin

# 3. Create .env file
cat > .env << 'EOF'
VITE_FIREBASE_API_KEY=AIzaSyCFtUVHKtADWllccdnlbougsnsntEUHQDA
VITE_FIREBASE_AUTH_DOMAIN=simplipharma.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=simplipharma
VITE_FIREBASE_STORAGE_BUCKET=simplipharma.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=343720215451
VITE_FIREBASE_APP_ID=1:343720215451:android:d2576ba41a99a5681e973e
VITE_APP_NAME="SimpliPharma Admin Panel"
VITE_APP_VERSION=1.0.0
EOF

# 4. Run deployment script
chmod +x deploy.sh
./deploy.sh
```

### Subsequent Deployments

```bash
cd ~/simplipharma-web-admin
git pull origin main
./deploy.sh
```

---

## ✅ Verify Deployment

```bash
# Health check
curl http://103.230.227.5:8085/health

# Should return: healthy

# Open in browser
# http://103.230.227.5:8085
```

---

## 🔧 Useful Commands

### View Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/simplipharma-admin-access.log

# Error logs
sudo tail -f /var/log/nginx/simplipharma-admin-error.log
```

### Nginx Control
```bash
# Reload (graceful, no downtime)
sudo systemctl reload nginx

# Restart (brief downtime)
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx

# Test configuration
sudo nginx -t
```

### Application Files
```bash
# View deployed files
ls -la /var/www/simplipharma-admin/current/

# Check permissions
ls -la /var/www/simplipharma-admin/

# View backups
ls -lt /var/www/simplipharma-admin/
```

### Rollback to Previous Version
```bash
# List available backups
ls -lt /var/www/simplipharma-admin/ | grep backup

# Rollback (replace with actual backup name)
sudo rm -rf /var/www/simplipharma-admin/current
sudo mv /var/www/simplipharma-admin/backup-20241127-143022 /var/www/simplipharma-admin/current
sudo systemctl reload nginx
```

---

## 🐛 Troubleshooting

### Port 8085 Not Responding
```bash
# Check if Nginx is listening
sudo netstat -tulpn | grep 8085

# Check Nginx is running
sudo systemctl status nginx

# Restart if needed
sudo systemctl restart nginx
```

### 403 Forbidden Error
```bash
# Fix permissions
sudo chown -R www-data:www-data /var/www/simplipharma-admin/current
sudo chmod -R 755 /var/www/simplipharma-admin/current
sudo systemctl reload nginx
```

### Blank/White Page
- Check browser console (F12) for errors
- Verify Firebase credentials in `.env`
- Check Nginx error log:
  ```bash
  sudo tail -50 /var/log/nginx/simplipharma-admin-error.log
  ```

### Jenkins Build Fails
```bash
# Check Jenkins console output for errors
# Common issues:
# 1. Node.js not configured → See "Configure Node.js" above
# 2. Permission denied → See "Grant Jenkins Sudo Access" above
# 3. Firebase credentials missing → See "Add Firebase Credentials" above
```

---

## 📂 File Locations

| Item | Location |
|------|----------|
| Application Files | `/var/www/simplipharma-admin/current/` |
| Nginx Config | `/etc/nginx/sites-available/simplipharma-admin` |
| Access Logs | `/var/log/nginx/simplipharma-admin-access.log` |
| Error Logs | `/var/log/nginx/simplipharma-admin-error.log` |
| Source Code (if cloned) | `~/simplipharma-web-admin/` |

---

## 🔗 URLs

| Service | URL |
|---------|-----|
| SimpliPharma Admin | http://103.230.227.5:8085 |
| Health Check | http://103.230.227.5:8085/health |
| Jenkins | http://103.230.227.5:8080 |
| Blood Bank App | http://103.230.227.5:8081 |

---

## 📞 Support

- **Repository:** https://github.com/chankey91/simplipharma-web-admin
- **Full Documentation:** See `DEPLOYMENT_GUIDE.md`
- **Firebase Console:** https://console.firebase.google.com

---

**Last Updated:** November 27, 2024

