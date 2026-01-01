# Fix CORS Error for sendVendorPasswordEmail

## Understanding the Error

The CORS error you're seeing is likely a **side effect** of the function crashing. Firebase callable functions (`onCall`) automatically handle CORS, so if you're seeing a CORS error, it usually means:

1. The function is crashing before it can respond
2. The function isn't deployed correctly
3. There's a configuration issue

## The Real Issue

Looking at your error logs, the function is returning "internal" error, which means:
- The function IS being called
- The function IS deployed
- But something is failing inside the function

## Solution Steps

### Step 1: Check Function Logs

```bash
firebase functions:log --only sendVendorPasswordEmail
```

Look for the actual error message. The CORS error is masking the real problem.

### Step 2: Verify SMTP Configuration

The most likely cause is missing SMTP config:

```bash
firebase functions:config:get
```

If you don't see `smtp` section, set it:

```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
```

### Step 3: Rebuild and Redeploy

After setting config, you MUST redeploy:

```bash
cd functions
npm run build
firebase deploy --only functions
```

### Step 4: Check Function Region

Make sure the function region matches. The function is deployed in `us-central1`. The frontend should call it from the same region.

## Common Causes

1. **SMTP Config Missing** - Most common cause
2. **Function Not Deployed** - Run `firebase deploy --only functions`
3. **Wrong Region** - Function and client must use same region
4. **Authentication Issue** - User not logged in or not admin

## Debug Steps

1. Check browser console for detailed error
2. Check Firebase Functions logs
3. Verify user is logged in
4. Verify user has admin role in Firestore
5. Test SMTP config: `npm run test-smtp`

