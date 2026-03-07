# SMTP Credentials Update Instructions

## Quick Start: Configure SMTP for Email Sending

If users are being created but **emails are not being sent**, configure SMTP with these 3 steps:

### Step 1: Set SMTP credentials in Firebase

From your project root (where `firebase.json` exists), run:

```bash
firebase functions:config:set smtp.user="YOUR_GMAIL@gmail.com" smtp.password="YOUR_APP_PASSWORD"
```

**Replace:**
- `YOUR_GMAIL@gmail.com` → Your Gmail address
- `YOUR_APP_PASSWORD` → Gmail App Password (see Step 2 if you don't have one)

### Step 2: Get Gmail App Password (required for Gmail)

Gmail blocks regular passwords for SMTP. Use an **App Password**:

1. Go to [Google Account](https://myaccount.google.com/) → **Security**
2. Enable **2-Step Verification** (if not already)
3. Go to **2-Step Verification** → **App passwords**
4. Select app: **Mail**, device: **Other** (type "SimpliPharma")
5. Click **Generate** → Copy the 16-character password
6. Use this password in the command above (no spaces)

### Step 3: Redeploy Cloud Functions

Config changes only apply after redeploying:

```bash
firebase deploy --only functions
```

---

## Verify Configuration

To verify the credentials were set correctly:

```bash
firebase functions:config:get
```

You should see:
```
smtp:
  user: "your-email@gmail.com"
  password: "your-app-password"
```

### Important Notes

1. **Gmail App Password:** If you're using Gmail and 2-Step Verification is enabled, you may need to use an App Password instead of the regular password:
   - Go to Google Account settings
   - Security > 2-Step Verification > App passwords
   - Generate a new app password for "Mail"
   - Use that app password in the config command

2. **After Updating:** You need to redeploy your Cloud Functions for the changes to take effect:
   ```bash
   firebase deploy --only functions
   ```

3. **Security:** These credentials are stored securely in Firebase and are not exposed in your code.

### Testing Email Functionality

After updating credentials and redeploying:

1. Try creating a new store from the admin panel
2. Check if the email is received at the store's email address
3. Check Firebase Functions logs if email fails:
   ```bash
   firebase functions:log
   ```

### Troubleshooting

**"535 Username and Password not accepted" / "BadCredentials":**

This means Gmail is rejecting your App Password. Fix it:

1. **Generate a NEW App Password** (old ones can expire or be revoked):
   - Go to https://myaccount.google.com/apppasswords
   - Sign in to simplipharma.2025@gmail.com
   - If you don't see "App passwords", enable 2-Step Verification first
   - Click "Select app" → **Mail**
   - Click "Select device" → **Other** → type "SimpliPharma"
   - Click **Generate** → Copy the 16-character password (e.g. `abcd efgh ijkl mnop`)
   - **Remove all spaces** when using in the command: `abcdefghijklmnop`

2. **Update and redeploy:**
   ```bash
   firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="NEW_16_CHAR_PASSWORD"
   firebase deploy --only functions
   ```

3. **Check logs** after creating a user:
   ```bash
   firebase functions:log
   ```

**Other issues:**
- Ensure 2-Step Verification is ON (required for App Passwords)
- Never use your regular Gmail password - only App Passwords work for SMTP
- If the account was recently created, wait a few hours before using SMTP

---

**Last Updated:** 2025-01-XX  
**Updated By:** System Administrator

