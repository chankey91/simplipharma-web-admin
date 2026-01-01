# Test SMTP Credentials

## Quick Test

To test if your SMTP credentials are working correctly, follow these steps:

### Option 1: Using Node.js Test Script (Recommended)

1. **Navigate to functions directory:**
   ```bash
   cd functions
   ```

2. **Install dependencies:**
   ```bash
   npm install nodemailer
   ```

3. **Run the test script:**
   ```bash
   node test-smtp.js
   ```

4. **Check the output:**
   - ✅ If successful, you'll see "SMTP credentials are working correctly!"
   - Check your email inbox (`simplipharma.2025@gmail.com`) for the test email
   - ❌ If failed, the script will show specific error messages

### Option 2: Using Firebase Functions Config

If you've already set the credentials in Firebase Functions:

1. **Get current config:**
   ```bash
   firebase functions:config:get
   ```

2. **Update the test script** (`functions/test-smtp.js`) with the credentials from Firebase config

3. **Run the test:**
   ```bash
   cd functions
   node test-smtp.js
   ```

### Current SMTP Credentials

- **Email:** simplipharma.2025@gmail.com
- **Password:** Nitin@2406
- **Host:** smtp.gmail.com
- **Port:** 587

### Common Issues

#### 1. Authentication Error (EAUTH)

**Problem:** Gmail authentication failed

**Solution:**
- Use an App Password instead of regular password
- Generate App Password: https://myaccount.google.com/apppasswords
- Select "Mail" and device type
- Use the generated 16-character password

#### 2. Connection Timeout

**Problem:** Cannot connect to SMTP server

**Solution:**
- Check internet connection
- Verify firewall isn't blocking port 587
- Try port 465 with `secure: true`

#### 3. "Less secure app access" Error

**Problem:** Gmail blocks the connection

**Solution:**
- Enable 2-Step Verification
- Generate App Password
- Use App Password in the config

### Expected Output (Success)

```
🔍 Testing SMTP Credentials...

Configuration:
  Host: smtp.gmail.com
  Port: 587
  User: simplipharma.2025@gmail.com
  Password: Nit***

📡 Verifying SMTP connection...
✅ SMTP connection verified successfully!

📧 Sending test email to simplipharma.2025@gmail.com...
✅ Test email sent successfully!
   Message ID: <...>
   Response: 250 2.0.0 OK

🎉 SMTP credentials are working correctly!
   Please check your inbox at simplipharma.2025@gmail.com for the test email.
```

### Expected Output (Failure)

```
❌ SMTP test failed!

Error details:
  Code: EAUTH
  Message: Invalid login: 535-5.7.8 Username and Password not accepted

🔐 Authentication Error:
   - Check if email and password are correct
   - For Gmail, you may need to use an App Password
   - Enable "Less secure app access" or use App Password
   - Generate App Password: https://myaccount.google.com/apppasswords
```

---

**Note:** This test sends an email to the same address (simplipharma.2025@gmail.com) to verify the credentials work.

