# Troubleshooting Vendor Password Email

## Quick Diagnostic Steps

### Step 1: Check if Function is Deployed

```bash
firebase functions:list
```

You should see `sendVendorPasswordEmail` in the list.

### Step 2: Check Function Logs

```bash
firebase functions:log --only sendVendorPasswordEmail --limit 50
```

Look for:
- Function invocation logs
- SMTP config status
- Any error messages

### Step 3: Verify SMTP Config

```bash
firebase functions:config:get
```

Should show:
```json
{
  "smtp": {
    "user": "simplipharma.2025@gmail.com",
    "password": "rvpljxxeeygrlfov"
  }
}
```

### Step 4: Rebuild and Redeploy

If you made changes to the function:

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```

## Common Errors and Solutions

### Error: CORS Policy
**Cause:** Function is crashing before it can respond
**Solution:** 
1. Check function logs for actual error
2. Verify SMTP config is set
3. Rebuild and redeploy

### Error: "internal"
**Cause:** Function is failing internally
**Solution:**
1. Check Firebase Functions logs
2. Most likely: SMTP config missing or wrong
3. Set config: `firebase functions:config:set smtp.user="..." smtp.password="..."`
4. Redeploy after setting config

### Error: "functions/not-found"
**Cause:** Function not deployed
**Solution:**
```bash
cd functions
npm run build
firebase deploy --only functions
```

### Error: "permission-denied"
**Cause:** User not admin or not authenticated
**Solution:**
1. Make sure user is logged in
2. Verify user has `role: 'admin'` in Firestore `users` collection

### Error: "EAUTH" (SMTP Authentication)
**Cause:** Wrong email or password
**Solution:**
1. Use Gmail App Password (not regular password)
2. Verify 2-Step Verification is enabled
3. Generate new App Password if needed
4. Update config and redeploy

## Step-by-Step Fix

1. **Set SMTP Config:**
   ```bash
   firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
   ```

2. **Build Function:**
   ```bash
   cd functions
   npm run build
   ```

3. **Deploy Function:**
   ```bash
   firebase deploy --only functions
   ```

4. **Verify Deployment:**
   ```bash
   firebase functions:list
   ```

5. **Test:**
   - Create a vendor with email
   - Check browser console for logs
   - Check Firebase Functions logs

## Check Logs in Real-Time

```bash
firebase functions:log --only sendVendorPasswordEmail --follow
```

This will show logs as they happen.

## Still Not Working?

1. Check browser console for detailed error
2. Check Firebase Functions logs
3. Verify user is logged in and is admin
4. Test SMTP separately: `npm run test-smtp`
5. Try deploying again: `firebase deploy --only functions --force`

