# ⚠️ URGENT: Deploy Cloud Functions to Enable Email Sending

You're seeing the "password email could not be sent" message because **Cloud Functions are not deployed yet**.

## Quick Deploy Steps

### 1. Open Terminal/Command Prompt

Navigate to your project root:
```bash
cd D:\Work\pharma-app\simplipharma-web-admin
```

### 2. Go to Functions Directory

```bash
cd functions
```

### 3. Install Dependencies (if not done)

```bash
npm install
```

This installs:
- `firebase-admin`
- `firebase-functions`
- `nodemailer`
- `typescript`

### 4. Set SMTP Configuration

```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
```

### 5. Build TypeScript

```bash
npm run build
```

This compiles `src/index.ts` to `lib/index.js`.

### 6. Deploy Functions

```bash
firebase deploy --only functions
```

Or use the npm script:
```bash
npm run deploy
```

### 7. Verify Deployment

After deployment, check if functions are deployed:
```bash
firebase functions:list
```

You should see `sendVendorPasswordEmail` in the list.

## After Deployment

Once deployed:
1. Create a new vendor with an email address
2. The password email will be sent automatically
3. No more "share credentials manually" popup!

## Troubleshooting

### Error: "firebase: command not found"
Install Firebase CLI:
```bash
npm install -g firebase-tools
firebase login
```

### Error: "Permission denied"
Make sure you're logged in:
```bash
firebase login
```

### Error: "SMTP configuration not found"
Run step 4 again to set SMTP credentials.

### Still not working?
Check Firebase Functions logs:
```bash
firebase functions:log
```

Look for errors related to `sendVendorPasswordEmail`.

