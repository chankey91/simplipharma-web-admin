# Understanding the CORS Error

## What is CORS?

CORS (Cross-Origin Resource Sharing) is a browser security feature that blocks requests from one origin (domain) to another unless the server explicitly allows it.

In your case:
- **Origin:** `http://localhost:3001` (your local dev server)
- **Target:** `https://us-central1-simplipharma.cloudfunctions.net` (Firebase Functions)

## Why Are You Seeing This Error?

Firebase **callable functions** (`onCall`) should automatically handle CORS. If you're seeing a CORS error, it usually means:

1. **The function is crashing before it can respond** - Most common cause
2. **The function isn't deployed correctly**
3. **Network/firewall blocking the request**
4. **The function is using wrong type** (should be `onCall`, not `onRequest`)

## The Real Problem

The CORS error is a **symptom**, not the root cause. The function is likely:
- Crashing during initialization
- Missing SMTP config
- Throwing an error before it can send CORS headers

## How to Fix

### Step 1: Check Function Logs

The logs will show the actual error:

```bash
firebase functions:log --only sendVendorPasswordEmail --limit 20
```

### Step 2: Verify Function is Deployed

```bash
firebase functions:list
```

Should see `sendVendorPasswordEmail` in the list.

### Step 3: Check SMTP Config

```bash
firebase functions:config:get
```

If no `smtp` section, that's your problem!

### Step 4: Set Config and Redeploy

```bash
# Set config
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"

# Build
cd functions
npm run build

# Deploy (IMPORTANT: Config changes require redeployment!)
firebase deploy --only functions
```

## Why Firebase Callable Functions Should Work

Firebase callable functions (`functions.https.onCall`) automatically:
- Handle CORS headers
- Handle preflight OPTIONS requests
- Authenticate users
- Serialize/deserialize data

If you're seeing CORS errors, the function is likely crashing before it can set these headers.

## Alternative: Use HTTP Function with CORS

If callable functions continue to have issues, we could switch to an HTTP function with explicit CORS headers, but this is not recommended as callable functions are better for this use case.

## Debug Steps

1. Check browser console for the actual error (not just CORS)
2. Check Firebase Functions logs
3. Verify SMTP config is set
4. Rebuild and redeploy function
5. Test again

The CORS error will disappear once the function works correctly!

