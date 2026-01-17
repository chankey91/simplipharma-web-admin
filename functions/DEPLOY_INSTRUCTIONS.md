# Deploy Instructions for Vendor Email Function

## Quick Deploy

```bash
cd functions
npm install
npm run build
firebase deploy --only functions:sendVendorPasswordEmailHttp
```

## Full Deploy (All Functions)

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```

## Verify Deployment

After deployment, check if the function is available:

```bash
# Check function logs
firebase functions:log --only sendVendorPasswordEmailHttp --limit 10

# List all functions
firebase functions:list
```

## Test the Function

You can test the function using curl:

```bash
curl -X OPTIONS https://us-central1-simplipharma.cloudfunctions.net/sendVendorPasswordEmailHttp \
  -H "Origin: https://simplipharma.sanchet.in" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v
```

You should see `Access-Control-Allow-Origin: *` in the response headers.

## Troubleshooting

If you still get CORS errors:

1. **Verify function is deployed:**
   ```bash
   firebase functions:list
   ```
   Should show `sendVendorPasswordEmailHttp`

2. **Check function logs:**
   ```bash
   firebase functions:log --only sendVendorPasswordEmailHttp
   ```

3. **Redeploy if needed:**
   ```bash
   firebase deploy --only functions:sendVendorPasswordEmailHttp --force
   ```

4. **Clear browser cache** and try again

