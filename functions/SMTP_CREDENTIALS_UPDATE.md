# SMTP Credentials Update Instructions

## Current SMTP Credentials

- **Email:** simplipharma.2025@gmail.com
- **Password:** yyebnebjqbtuasys (App Password)

## How to Update SMTP Credentials in Firebase Cloud Functions

### Prerequisites

1. Install Firebase CLI (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Navigate to your project directory (where `firebase.json` exists)

### Update SMTP Credentials

Run the following command to set/update SMTP credentials:

```bash
firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="yyebnebjqbtuasys"
```

### Verify Configuration

To verify the credentials were set correctly:

```bash
firebase functions:config:get
```

You should see:
```
smtp:
  user: "simplipharma.2025@gmail.com"
  password: "Nitin@2406"
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

**Email not sending:**
- Verify credentials are correct
- Check if Gmail requires App Password
- Check Firebase Functions logs for errors
- Ensure Cloud Functions are deployed

**Authentication failed:**
- Verify email and password are correct
- For Gmail, ensure "Less secure app access" is enabled OR use App Password
- Check if account has 2-Step Verification enabled

---

**Last Updated:** 2025-01-XX  
**Updated By:** System Administrator

