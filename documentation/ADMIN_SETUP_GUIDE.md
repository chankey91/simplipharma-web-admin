# Admin User Setup Guide

## Problem: "Access denied. Admin privileges required"

This error occurs when the user trying to login doesn't have admin privileges in Firestore.

---

## Solution 1: Auto-Create Admin Profile (Recommended)

**The app now automatically creates an admin profile on first login!**

### Steps:
1. **Login with your Firebase Auth user**
2. The app will automatically create a `users` document with `role: 'admin'`
3. You'll be granted access immediately

### What happens:
- When you login, the app checks for your user document in Firestore
- If it doesn't exist, it automatically creates one with `role: 'admin'`
- You're redirected to the dashboard

---

## Solution 2: Manually Create Admin User in Firestore

### Step 1: Go to Firebase Console

1. Open: https://console.firebase.google.com
2. Select your **simplipharma** project
3. Click **Firestore Database** in the left menu

### Step 2: Create Users Collection (if it doesn't exist)

1. Click **Start collection**
2. Collection ID: `users`
3. Click **Next**

### Step 3: Add Admin User Document

1. **Document ID:** Use your Firebase Auth User UID
   
   To find your User UID:
   - Go to **Authentication** in Firebase Console
   - Find your user in the list
   - Copy the **User UID** (long string like `abc123xyz...`)

2. **Add Fields:**

| Field | Type | Value |
|-------|------|-------|
| `role` | string | `admin` |
| `email` | string | your-email@example.com |
| `name` | string | Your Name |
| `createdAt` | timestamp | (click "Add timestamp") |

3. Click **Save**

### Example Document:

```
Collection: users
Document ID: abc123xyz789 (your Firebase Auth UID)

Fields:
{
  "role": "admin",
  "email": "admin@example.com",
  "name": "Admin User",
  "createdAt": Timestamp (Nov 27, 2024 at 10:00:00 PM)
}
```

---

## Solution 3: Using Firebase Console (Browser Console Method)

If you can't create the document manually, use browser console:

### Step 1: Login to Firebase Console
Go to: https://console.firebase.google.com

### Step 2: Open Browser Console
Press `F12` or right-click → Inspect → Console

### Step 3: Run This Script

```javascript
// Replace with your actual values
const userId = 'YOUR_FIREBASE_AUTH_USER_ID';  // Get from Authentication tab
const userEmail = 'admin@example.com';         // Your email

firebase.firestore().collection('users').doc(userId).set({
  role: 'admin',
  email: userEmail,
  name: 'Admin User',
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
}, { merge: true })
.then(() => console.log('✅ Admin user created successfully!'))
.catch(error => console.error('❌ Error:', error));
```

---

## Verification Steps

After setting up admin user:

### 1. Check Browser Console (F12)

When you login, you should see:
```
Checking admin status for userId: abc123xyz...
User profile found: {id: "abc123...", role: "admin", email: "..."}
Is admin? true | Role: admin
```

### 2. Check Firestore

Go to Firestore Database and verify:
- Collection `users` exists
- Document with your User UID exists
- Field `role` has value `admin` (exactly, case-sensitive)

---

## Common Issues

### Issue 1: "User profile does not exist"

**Cause:** No document in Firestore `users` collection

**Solution:** 
- With updated code: Just login again, it will auto-create
- Manual: Follow Solution 2 above

### Issue 2: Role is not 'admin'

**Cause:** Field value is incorrect (e.g., `Admin`, `ADMIN`, `administrator`)

**Solution:**
1. Go to Firestore Console
2. Find your user document
3. Edit the `role` field
4. Set exactly: `admin` (lowercase)
5. Save

### Issue 3: Wrong User ID

**Cause:** Document ID doesn't match Firebase Auth User UID

**Solution:**
1. Go to **Authentication** in Firebase Console
2. Copy your User UID
3. Go to **Firestore Database**
4. Make sure document ID matches exactly

### Issue 4: Role field doesn't exist

**Cause:** Document exists but missing `role` field

**Solution:**
1. Open your user document in Firestore
2. Click **Add field**
3. Field: `role`
4. Type: `string`
5. Value: `admin`
6. Save

---

## How to Find Your Firebase Auth User ID

### Method 1: Firebase Console
1. Go to Firebase Console
2. Click **Authentication**
3. Click **Users** tab
4. Your User UID is in the table (long string)

### Method 2: Browser Console (while logged in to your app)
1. Login to your app
2. Open browser console (F12)
3. Type: `firebase.auth().currentUser.uid`
4. Press Enter
5. Copy the UID shown

### Method 3: From Error Logs
1. Try to login
2. Open browser console (F12)
3. Look for: `Checking admin status for userId: ...`
4. Copy the userId shown

---

## Testing

After setup:

1. **Logout** (if logged in)
2. **Login** with your email and password
3. **Check console** for debug messages:
   ```
   ✅ Checking admin status for userId: abc123...
   ✅ User profile found: {...}
   ✅ Is admin? true
   ```
4. **Should redirect** to dashboard automatically

---

## Firebase Security Rules

Make sure your Firestore security rules allow reading the `users` collection:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      // Allow users to read their own profile
      allow read: if request.auth != null && request.auth.uid == userId;
      
      // Allow admin users to read all profiles
      allow read: if request.auth != null && 
                     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
      
      // Only admins can write
      allow write: if request.auth != null && 
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
  }
}
```

---

## Quick Checklist

- [ ] Firebase Authentication enabled (Email/Password)
- [ ] User created in Firebase Authentication
- [ ] Firestore `users` collection exists
- [ ] User document exists with correct UID
- [ ] `role` field exists with value `admin` (lowercase)
- [ ] Firestore security rules allow reading `users` collection
- [ ] Browser console shows correct debug messages

---

## Still Having Issues?

### Enable Debug Mode

Check browser console (F12) for these messages:

**Success:**
```
Checking admin status for userId: abc123xyz...
User profile found: {id: "abc123xyz...", role: "admin", ...}
Is admin? true | Role: admin
```

**Failure:**
```
Checking admin status for userId: abc123xyz...
No user profile found for userId: abc123xyz...
User profile does not exist in Firestore. Creating admin profile...
Admin profile created successfully
```

**Permission Error:**
```
Error checking admin status: FirebaseError: Missing or insufficient permissions
```
→ Fix your Firestore security rules

---

## Contact Support

If still having issues, provide:
1. Screenshot of browser console (F12)
2. Screenshot of your Firestore `users` collection
3. Screenshot of Firebase Authentication users list
4. The exact error message

---

**Updated:** November 27, 2024  
**App Version:** 1.0.0 (with auto-admin creation)

