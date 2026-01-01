# Test Function Locally Before Deploying

## Step 1: Install Firebase Emulator (if not installed)

```bash
npm install -g firebase-tools
```

## Step 2: Start Firebase Emulator

```bash
cd functions
npm run serve
```

This will:
- Build the TypeScript code
- Start the Firebase emulator
- Make functions available at `http://localhost:5001`

## Step 3: Test the Function

You can test using curl or a simple Node.js script.

### Option A: Using curl

```bash
curl -X POST http://localhost:5001/simplipharma/us-central1/sendVendorPasswordEmail \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "email": "test@example.com",
      "password": "test123",
      "vendorName": "Test Vendor"
    }
  }'
```

### Option B: Create a test script

Create `functions/test-function.js`:

```javascript
const admin = require('firebase-admin');
const functions = require('firebase-functions-test')();

// Initialize admin
admin.initializeApp();

// Import the function
const { sendVendorPasswordEmail } = require('./lib/index');

// Test data
const testData = {
  email: 'test@example.com',
  password: 'test123',
  vendorName: 'Test Vendor'
};

const testContext = {
  auth: {
    uid: 'test-uid'
  }
};

// Mock Firestore
admin.firestore().collection('users').doc('test-uid').set({
  role: 'admin'
}).then(() => {
  // Call the function
  return sendVendorPasswordEmail(testData, testContext);
}).then(result => {
  console.log('Success:', result);
  process.exit(0);
}).catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
```

Run it:
```bash
node test-function.js
```

## Step 4: Check Logs

The emulator will show logs in the terminal. Look for:
- Function invocation
- SMTP config status
- Any errors

## Common Issues

1. **SMTP Config Not Set in Emulator**
   - Emulator uses local config
   - Set it: `firebase functions:config:get > .runtimeconfig.json`
   - Or set environment variables

2. **Function Not Found**
   - Make sure you ran `npm run build`
   - Check `lib/index.js` exists

3. **TypeScript Errors**
   - Run `npm run build` to see errors
   - Fix any TypeScript issues

