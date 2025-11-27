# Firestore Security Rules Setup Guide

## 🔥 Problem: "Missing or insufficient permissions"

This error occurs when Firestore security rules block the app from creating/reading user profiles.

---

## ✅ Quick Fix (Choose One Method)

### Method 1: Update Rules in Firebase Console (Recommended)

#### Step 1: Go to Firebase Console
1. Open: https://console.firebase.google.com
2. Select your **simplipharma** project
3. Click **Firestore Database** in the left menu
4. Click the **Rules** tab at the top

#### Step 2: Replace the Rules

**Delete all existing rules** and paste this:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users collection - Allow users to read/write their own profile
    match /users/{userId} {
      // Allow authenticated users to read and write their own profile
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // Allow any admin user to read all user profiles
      allow read: if request.auth != null && 
                     exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
                     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Medical Stores collection
    match /stores/{storeId} {
      // Allow any authenticated user to read stores
      allow read: if request.auth != null;
      
      // Only admins can write stores
      allow write: if request.auth != null && 
                      exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Orders collection
    match /orders/{orderId} {
      // Allow any authenticated user to read orders
      allow read: if request.auth != null;
      
      // Only admins can create/update orders
      allow write: if request.auth != null && 
                      exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Inventory collection
    match /inventory/{inventoryId} {
      // Allow any authenticated user to read inventory
      allow read: if request.auth != null;
      
      // Only admins can write inventory
      allow write: if request.auth != null && 
                      exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Default: Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

#### Step 3: Publish the Rules
1. Click **Publish** button (top right)
2. Wait for "Rules published successfully" message

#### Step 4: Test
1. Go back to your app: http://103.230.227.5:8085
2. Try to login again
3. Should work! ✅

---

### Method 2: Temporary Open Rules (For Testing Only)

**⚠️ WARNING: This makes your database accessible to all authenticated users!**  
**Use only for initial setup/testing, then switch to Method 1**

#### Step 1: Go to Firebase Console Rules Tab
Same as Method 1, Step 1

#### Step 2: Use Open Rules (TEMPORARY)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // TEMPORARY - Allow all authenticated users full access
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

#### Step 3: Publish and Test
1. Click **Publish**
2. Login to your app
3. Should work immediately

#### Step 4: ⚠️ IMPORTANT - Switch Back to Secure Rules
**After confirming login works:**
1. Go back to Firestore Rules
2. Replace with the rules from Method 1 (secure rules)
3. Publish again

---

## 📝 What These Rules Do

### Secure Rules (Method 1)

| Collection | Who Can Read | Who Can Write |
|-----------|--------------|---------------|
| **users** | • Own profile (anyone)<br>• All profiles (admins only) | • Own profile (anyone) |
| **stores** | Any authenticated user | Admins only |
| **orders** | Any authenticated user | Admins only |
| **inventory** | Any authenticated user | Admins only |
| **others** | ❌ Denied | ❌ Denied |

### Key Features:
- ✅ Users can create their own profile (fixes the error!)
- ✅ Users can only modify their own profile
- ✅ Admins can read all user profiles
- ✅ Only admins can manage stores, orders, and inventory
- ✅ Secure by default

---

## 🔍 Verifying Rules Are Applied

### In Firebase Console:
1. Go to **Firestore Database** → **Rules**
2. Check the timestamp shows recent update
3. Rules should match what you pasted

### In Your App:
1. Open browser console (F12)
2. Try to login
3. Should see:
   ```
   Checking admin status for userId: abc123...
   No user profile found for userId: abc123...
   User profile does not exist in Firestore. Creating admin profile...
   Admin profile created successfully ✅
   ```

---

## 🐛 Troubleshooting

### Error Still Appears After Updating Rules

**Wait 1-2 minutes** - Rule updates can take a moment to propagate

**Clear browser cache:**
1. Open DevTools (F12)
2. Right-click refresh button
3. Choose "Empty Cache and Hard Reload"

**Check rules were saved:**
1. Go back to Firestore → Rules tab
2. Verify the rules match what you pasted

### Rules Won't Publish

**Error: "Compilation error"**
- Check for syntax errors
- Make sure you copied the entire ruleset
- Brackets should be balanced

**Error: "Invalid rules"**
- Copy the rules again carefully
- Don't modify the structure

### Still Getting Permission Errors

**Check Authentication:**
```javascript
// In browser console (F12)
firebase.auth().currentUser
// Should show your user object, not null
```

**Manually create user profile:**
1. Go to Firestore Database
2. Create collection: `users`
3. Add document with ID = your Firebase Auth UID
4. Add field: `role` (string) = `admin`
5. Save

---

## 📚 Understanding Firestore Rules

### Basic Syntax:
```javascript
match /collectionName/{documentId} {
  allow read: if <condition>;
  allow write: if <condition>;
}
```

### Common Conditions:
```javascript
// User is authenticated
request.auth != null

// User is accessing their own document
request.auth.uid == userId

// Check if user is admin
get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'

// Document exists
exists(/databases/$(database)/documents/users/$(request.auth.uid))
```

---

## 🔒 Security Best Practices

### ✅ DO:
- Use Method 1 (secure rules) for production
- Require authentication for all operations
- Limit admin operations to users with `role: 'admin'`
- Test rules thoroughly

### ❌ DON'T:
- Leave open rules (Method 2) in production
- Allow unauthenticated access
- Give all users admin rights
- Skip rule validation

---

## 📊 Rules File Reference

Your project now has two rules files:

| File | Purpose | When to Use |
|------|---------|-------------|
| `firestore.rules` | 🔒 Secure production rules | **Use this for production** |
| `firestore.rules.open` | ⚠️ Open testing rules | Only for initial setup/debugging |

**To deploy rules via CLI:**
```bash
# Secure rules (recommended)
firebase deploy --only firestore:rules

# Or specify file
firebase deploy --only firestore:rules --project simplipharma
```

---

## ✅ Final Checklist

After updating rules:

- [ ] Rules updated in Firebase Console
- [ ] Rules published successfully
- [ ] Waited 1-2 minutes for propagation
- [ ] Cleared browser cache
- [ ] Tried to login
- [ ] Check browser console - no permission errors
- [ ] User profile created automatically
- [ ] Redirected to dashboard

---

## 🆘 Still Need Help?

### Check These:

1. **Firebase Console → Firestore → Rules tab**
   - Verify rules are published
   - Check timestamp is recent

2. **Browser Console (F12)**
   - Look for permission errors
   - Check authentication status
   - Verify user ID

3. **Firestore Database**
   - Check if `users` collection exists
   - Check if your user document was created
   - Verify `role` field = `admin`

### Get Detailed Debug Info:

In browser console (F12):
```javascript
// Check current user
firebase.auth().currentUser

// Check Firestore connection
firebase.firestore().collection('users').get()
  .then(snapshot => console.log('Access granted!', snapshot.docs.length, 'users'))
  .catch(error => console.error('Access denied!', error))
```

---

## 📞 Quick Reference

**Firebase Console:** https://console.firebase.google.com  
**Rules Location:** Firestore Database → Rules tab  
**Project:** simplipharma  

**Files in this repo:**
- `firestore.rules` - Production rules (secure) ✅
- `firestore.rules.open` - Testing rules (temporary) ⚠️
- `documentation/FIRESTORE_RULES_SETUP.md` - This guide

---

**Updated:** November 27, 2024  
**Status:** Ready to deploy  
**Security Level:** Production-ready 🔒

