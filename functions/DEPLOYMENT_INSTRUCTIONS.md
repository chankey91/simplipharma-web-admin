# Cloud Functions Deployment Instructions

## Prerequisites

1. Install Firebase CLI globally:
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Navigate to functions directory:
   ```bash
   cd functions
   ```

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

This will install:
- `firebase-admin` - Admin SDK for server-side operations
- `firebase-functions` - Firebase Cloud Functions SDK
- `nodemailer` - Email sending library
- `typescript` - TypeScript compiler (dev dependency)

### 2. Configure SMTP Credentials

Set the SMTP credentials for email sending:

```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
```

**Note:** The password should be a Gmail App Password, not the regular account password.

### 3. Build TypeScript

```bash
npm run build
```

This compiles the TypeScript code in `src/index.ts` to JavaScript in `lib/index.js`.

### 4. Deploy Functions

```bash
npm run deploy
```

Or directly:
```bash
firebase deploy --only functions
```

This will deploy:
- `sendVendorPasswordEmail` - Sends password email when a vendor is created

## Available Functions

### sendVendorPasswordEmail

**Purpose:** Sends a password email to a vendor when they are created.

**Trigger:** Called from the frontend when creating a new vendor.

**Parameters:**
- `email` (string, required) - Vendor's email address
- `password` (string, required) - Generated password for the vendor
- `vendorName` (string, required) - Name of the vendor

**Authentication:** Requires admin user authentication.

**Returns:**
```json
{
  "success": true,
  "message": "Password email sent successfully"
}
```

## Testing

### Test SMTP Configuration

You can test the SMTP configuration using the test script:

```bash
npm run test-smtp
```

This will:
1. Verify SMTP connection
2. Send a test email to `simplipharma.2025@gmail.com`

## Troubleshooting

### Function Not Found Error

If you get a "function not found" error from the frontend:
1. Make sure functions are deployed: `firebase deploy --only functions`
2. Check that you're logged in: `firebase login`
3. Verify the function name matches: `sendVendorPasswordEmail`

### SMTP Authentication Error

If email sending fails with authentication error:
1. Verify SMTP credentials are set: `firebase functions:config:get`
2. Make sure you're using a Gmail App Password (not regular password)
3. Ensure 2-Step Verification is enabled on the Gmail account
4. Test SMTP with: `npm run test-smtp`

### Permission Denied Error

If you get "permission-denied" error:
1. Make sure the user is logged in
2. Verify the user has `role: 'admin'` in Firestore `users` collection
3. Check Firebase Authentication is properly configured

## Updating Functions

After making changes to `src/index.ts`:

1. Build: `npm run build`
2. Deploy: `npm run deploy`

Or use the watch mode for development:
```bash
npm run serve
```

This starts the Firebase emulator for local testing.

