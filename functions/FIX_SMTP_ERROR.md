# Fix "Email Sending Failed Internal" Error

This error means the Cloud Function is deployed but SMTP configuration is missing or incorrect.

## Quick Fix Steps

### Step 1: Check Current SMTP Config

```bash
firebase functions:config:get
```

If you see `{}` or no `smtp` section, config is not set.

### Step 2: Set SMTP Configuration

```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
```

### Step 3: Rebuild and Redeploy Functions

**IMPORTANT:** After changing config, you MUST redeploy:

```bash
cd functions
npm run build
firebase deploy --only functions
```

### Step 4: Verify Deployment

Check if config is now set:
```bash
firebase functions:config:get
```

You should see:
```json
{
  "smtp": {
    "user": "simplipharma.2025@gmail.com",
    "password": "rvpljxxeeygrlfov"
  }
}
```

## Check Function Logs

To see detailed error messages:

```bash
firebase functions:log --only sendVendorPasswordEmail
```

Or in Firebase Console:
1. Go to https://console.firebase.google.com
2. Select your project
3. Functions > Logs
4. Filter by `sendVendorPasswordEmail`

## Common Issues

### Issue 1: Config Not Set
**Symptom:** Logs show "SMTP configuration not found"
**Fix:** Run Step 2 above

### Issue 2: Wrong Password
**Symptom:** Logs show "EAUTH" error
**Fix:** 
- Make sure you're using Gmail App Password (not regular password)
- Verify 2-Step Verification is enabled
- Generate new App Password if needed
- Update config and redeploy

### Issue 3: Config Set But Not Deployed
**Symptom:** Config shows in `config:get` but function still fails
**Fix:** Run Step 3 (rebuild and redeploy)

## Test After Fix

1. Create a new vendor with email address
2. Check browser console for logs
3. Check Firebase Functions logs
4. Verify email is received

