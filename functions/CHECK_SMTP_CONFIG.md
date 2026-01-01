# Check SMTP Configuration

If you're getting "email sending failed internal" error, the SMTP configuration might not be set correctly.

## Check Current Configuration

Run this command to see your current SMTP config:

```bash
firebase functions:config:get
```

You should see something like:
```json
{
  "smtp": {
    "user": "simplipharma.2025@gmail.com",
    "password": "rvpljxxeeygrlfov"
  }
}
```

## If Config is Missing or Wrong

### Set SMTP Configuration

```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
```

### After Setting Config

**IMPORTANT:** You must redeploy functions after changing config:

```bash
cd functions
npm run build
firebase deploy --only functions
```

## Common Errors

### "EAUTH" Error
- **Cause:** Wrong email or password
- **Solution:** 
  1. Make sure you're using a Gmail App Password (not regular password)
  2. Verify 2-Step Verification is enabled on Gmail account
  3. Generate a new App Password if needed
  4. Update config and redeploy

### "ECONNECTION" Error
- **Cause:** Network/firewall blocking SMTP connection
- **Solution:** Check firewall settings, try different network

### "SMTP configuration not found"
- **Cause:** Config not set or not deployed
- **Solution:** Set config and redeploy functions

## Test SMTP Locally

You can test SMTP configuration using the test script:

```bash
cd functions
npm run test-smtp
```

This will verify SMTP credentials work before deploying.

## View Function Logs

To see detailed error messages:

```bash
firebase functions:log --only sendVendorPasswordEmail
```

Or view in Firebase Console:
1. Go to https://console.firebase.google.com
2. Select your project
3. Go to Functions > Logs
4. Look for `sendVendorPasswordEmail` errors

