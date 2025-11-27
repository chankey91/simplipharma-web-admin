# Jenkins Credentials Setup Guide

## 📋 Overview

This document explains how to add Firebase credentials to Jenkins for automated deployment of SimpliPharma Admin Panel.

---

## 🔐 Why Store Credentials in Jenkins?

- **Security:** Environment variables are not exposed in source code
- **Flexibility:** Easy to update credentials without changing code
- **Best Practice:** Separates configuration from code
- **Team Collaboration:** Different environments (dev/staging/prod) can use different credentials

---

## 📝 Step-by-Step Instructions

### 1. Access Jenkins Credentials Manager

1. Open Jenkins in your browser:
   ```
   http://103.230.227.5:8080
   ```

2. Login with your admin credentials

3. Navigate to:
   ```
   Manage Jenkins → Manage Credentials
   ```

4. Click on **(global)** domain

5. Click **Add Credentials** on the left sidebar

---

### 2. Add Each Firebase Credential

You need to add **6 separate credentials**. For each one:

#### Credential Type
- **Kind:** Select **"Secret text"**
- **Scope:** Leave as **"Global"**

#### Add These 6 Credentials:

| # | ID (must be exact) | Secret (Value) | Description |
|---|-------------------|----------------|-------------|
| 1 | `simplipharma-firebase-api-key` | `AIzaSyCFtUVHKtADWllccdnlbougsnsntEUHQDA` | Firebase API Key |
| 2 | `simplipharma-firebase-auth-domain` | `simplipharma.firebaseapp.com` | Firebase Auth Domain |
| 3 | `simplipharma-firebase-project-id` | `simplipharma` | Firebase Project ID |
| 4 | `simplipharma-firebase-storage-bucket` | `simplipharma.firebasestorage.app` | Firebase Storage Bucket |
| 5 | `simplipharma-firebase-messaging-sender-id` | `343720215451` | Firebase Messaging Sender ID |
| 6 | `simplipharma-firebase-app-id` | `1:343720215451:android:d2576ba41a99a5681e973e` | Firebase App ID |

#### For Each Credential:

1. Click **Add Credentials**
2. **Kind:** Secret text
3. **Scope:** Global
4. **Secret:** Paste the value from the table above
5. **ID:** Copy the exact ID from the table (must match exactly!)
6. **Description:** Copy the description from the table
7. Click **OK**
8. Repeat for all 6 credentials

---

### 3. Verify Credentials

After adding all 6 credentials, you should see them listed:

```
Global credentials (unrestricted)
├── simplipharma-firebase-api-key
├── simplipharma-firebase-auth-domain
├── simplipharma-firebase-project-id
├── simplipharma-firebase-storage-bucket
├── simplipharma-firebase-messaging-sender-id
└── simplipharma-firebase-app-id
```

---

## ⚠️ Important Notes

### Credential IDs Must Match Exactly

The IDs in Jenkins **must match exactly** what's in the `Jenkinsfile`:

```groovy
environment {
    VITE_FIREBASE_API_KEY = credentials('simplipharma-firebase-api-key')
    VITE_FIREBASE_AUTH_DOMAIN = credentials('simplipharma-firebase-auth-domain')
    // ... etc
}
```

If there's a mismatch, the build will fail with an error like:
```
ERROR: Credentials 'simplipharma-firebase-api-key' not found
```

### These Are NOT Sensitive Credentials

**Important:** These Firebase credentials are for **client-side** (frontend) use:
- They identify your Firebase project
- They are meant to be public (included in the built JavaScript)
- Security is enforced through Firebase Security Rules, not by hiding these values
- **DO NOT** confuse with Firebase Service Account private keys (which are sensitive)

### No Service Account Needed

This application does **not** need a Firebase Service Account JSON file because:
- It's a frontend-only application
- All Firebase operations are client-side
- Service accounts are only for backend admin operations

---

## 🔄 How Jenkins Uses These Credentials

During the build process:

1. Jenkins retrieves credentials by ID
2. Creates a `.env` file with these values
3. Vite build process reads the `.env` file
4. Environment variables are embedded in the built JavaScript
5. The application uses these at runtime to connect to Firebase

**Build-time `.env` file (created automatically by Jenkins):**
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

---

## 🛠️ Alternative: Using Jenkins Pipeline Syntax Generator

If you prefer a visual approach:

1. Go to your pipeline job
2. Click **Pipeline Syntax** (in left sidebar)
3. Select **withCredentials: Bind credentials to variables**
4. Add bindings for each credential
5. Generate and copy the code

---

## 🧪 Testing the Credentials

After adding credentials, test them:

1. Go to your pipeline job
2. Click **Build Now**
3. Watch the **Console Output**
4. Look for this stage:
   ```
   [Pipeline] stage (Create Environment File)
   ```
5. If successful, you'll see:
   ```
   Creating .env file with Firebase credentials...
   ```
6. The build should complete with **SUCCESS**

---

## 🐛 Troubleshooting

### Error: "Credentials not found"

**Problem:**
```
ERROR: Credentials 'simplipharma-firebase-api-key' not found
```

**Solution:**
- Check the ID matches exactly (case-sensitive)
- Ensure credential is in the **(global)** domain
- Verify you saved the credential (clicked OK)

### Error: "Permission denied"

**Problem:**
```
ERROR: Permission denied when accessing credentials
```

**Solution:**
- Ensure you're logged in with admin privileges
- Check Jenkins user has access to credentials

### Build Succeeds but App Shows Firebase Errors

**Problem:**
- App builds successfully
- But shows "Firebase auth/invalid-api-key" in browser console

**Solution:**
- Double-check the credential **values** (not just IDs)
- Ensure no extra spaces or quotes in the Secret field
- Verify credentials are correct in Firebase Console

---

## 📚 Additional Resources

- **Firebase Console:** https://console.firebase.google.com
  - Go here to verify/update your Firebase credentials
  - Project Settings → Your apps → Web app

- **Jenkins Documentation:** https://www.jenkins.io/doc/book/using/using-credentials/

- **Vite Environment Variables:** https://vitejs.dev/guide/env-and-mode.html

---

## ✅ Checklist

After setup, verify:

- [ ] All 6 credentials added to Jenkins
- [ ] IDs match exactly (no typos)
- [ ] Values copied correctly (no extra spaces)
- [ ] Test build completes successfully
- [ ] Application accessible at http://103.230.227.5:8085
- [ ] Can login to the application
- [ ] Firebase authentication works

---

**Setup Date:** ___________  
**Setup By:** ___________  
**Verified:** ___________

---

Good luck! 🚀

