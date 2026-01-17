# ⚠️ URGENT: Deploy Cloud Functions to Fix CORS Error

## The Problem
You're getting CORS errors because the Cloud Functions are **not deployed** or the **old version without CORS** is still running.

## Quick Fix - Deploy Functions Now

### Step 1: Navigate to Functions Directory
```bash
cd functions
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Build Functions
```bash
npm run build
```

### Step 4: Deploy Functions
```bash
# Deploy all functions
firebase deploy --only functions

# OR deploy just the email function
firebase deploy --only functions:sendVendorPasswordEmailHttp
```

### Step 5: Verify Deployment
```bash
# Check if function is deployed
firebase functions:list

# Should show:
# - sendVendorPasswordEmailHttp
# - sendVendorPasswordEmail
```

## After Deployment

1. **Wait 1-2 minutes** for the function to be fully available
2. **Clear your browser cache** (Ctrl+Shift+Delete)
3. **Try creating a vendor again**

## If You Still Get CORS Errors

1. **Check function logs:**
   ```bash
   firebase functions:log --only sendVendorPasswordEmailHttp --limit 20
   ```

2. **Verify function URL is correct:**
   - Should be: `https://us-central1-simplipharma.cloudfunctions.net/sendVendorPasswordEmailHttp`

3. **Test with curl:**
   ```bash
   curl -X OPTIONS https://us-central1-simplipharma.cloudfunctions.net/sendVendorPasswordEmailHttp -v
   ```
   Should return `Access-Control-Allow-Origin: *` in headers

## Alternative: Use Callable Function

If HTTP function still has issues, the code will automatically fall back to the callable function (`sendVendorPasswordEmail`), which should handle CORS automatically.

## Need Help?

If deployment fails, check:
- You're logged into Firebase CLI: `firebase login`
- You have the correct project: `firebase use simplipharma`
- You have deployment permissions

