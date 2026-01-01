# Quick Fix for Vendor Password Email

## The Problem

The function is failing with CORS/internal errors. This usually means:
1. SMTP config is not set
2. Function needs to be rebuilt/redeployed
3. Function is crashing before it can respond

## Quick Fix (5 Steps)

### Step 1: Check SMTP Config
```bash
firebase functions:config:get
```

If empty or no `smtp` section, continue to Step 2.

### Step 2: Set SMTP Config
```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
```

### Step 3: Build Function
```bash
cd functions
npm run build
```

### Step 4: Deploy Function
```bash
firebase deploy --only functions
```

### Step 5: Test
Create a vendor with email and check if it works.

## If Still Failing

### Check Logs
```bash
firebase functions:log --only sendVendorPasswordEmail --limit 20
```

Look for:
- "SMTP configuration not found" → Run Step 2
- "EAUTH" → Wrong password, use App Password
- "ECONNECTION" → Network issue
- Any other error → Share the error message

### Verify Function is Deployed
```bash
firebase functions:list
```

Should see `sendVendorPasswordEmail` in the list.

### Force Redeploy
```bash
firebase deploy --only functions --force
```

## Most Common Issue

**SMTP config not set or not deployed after setting**

Solution:
1. Set config (Step 2)
2. **MUST redeploy** (Step 4) - config changes require redeployment!

