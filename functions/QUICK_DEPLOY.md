# Quick Deploy Guide for Vendor Password Email

## Step 1: Check if Functions are Deployed

Run this command to see if `sendVendorPasswordEmail` function exists:

```bash
firebase functions:list
```

If you see `sendVendorPasswordEmail` in the list, functions are deployed. If not, continue to Step 2.

## Step 2: Install Dependencies

```bash
cd functions
npm install
```

## Step 3: Set SMTP Configuration

```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
```

## Step 4: Build TypeScript

```bash
npm run build
```

## Step 5: Deploy Functions

```bash
firebase deploy --only functions
```

Or use the npm script:

```bash
npm run deploy
```

## Step 6: Verify Deployment

After deployment, check the browser console when creating a vendor. You should see:
- "Attempting to send vendor password email..."
- "Vendor password email sent successfully"

If you see errors, check:
1. Firebase Functions logs: `firebase functions:log`
2. Browser console for error messages
3. Make sure you're logged in as an admin user

## Troubleshooting

### Error: "Function not found"
- Functions are not deployed. Run Step 5.

### Error: "Permission denied"
- Make sure you're logged in: `firebase login`
- Verify your user has `role: 'admin'` in Firestore `users` collection

### Error: "SMTP configuration not found"
- Run Step 3 to set SMTP credentials

### Email not received
- Check spam folder
- Verify email address is correct
- Check Firebase Functions logs for errors
- Test SMTP: `npm run test-smtp`

