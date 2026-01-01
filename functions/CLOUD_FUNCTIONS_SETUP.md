/**
 * Firebase Cloud Functions for SimpliPharma Admin
 * 
 * SETUP INSTRUCTIONS:
 * 1. Install Firebase CLI: npm install -g firebase-tools
 * 2. Login: firebase login
 * 3. Initialize functions: firebase init functions
 * 4. Install dependencies: cd functions && npm install
 * 5. Deploy: firebase deploy --only functions
 * 
 * SMTP CONFIGURATION:
 * 
 * Current SMTP Credentials:
 * Email: simplipharma.2025@gmail.com
 * Password: rvpljxxeeygrlfov (App Password)
 * 
 * To set/update SMTP credentials:
 * firebase functions:config:set smtp.user="simplipharma.2025@gmail.com" smtp.password="rvpljxxeeygrlfov"
 * 
 * Note: For Gmail, you may need to use an App Password instead of the regular password.
 * To generate an App Password:
 * 1. Go to Google Account settings
 * 2. Security > 2-Step Verification > App passwords
 * 3. Generate a new app password for "Mail"
 * 4. Use that app password instead of the regular password
 */

// Example Cloud Function (functions/src/index.ts)
/*
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

admin.initializeApp();

const transporter = nodemailer.createTransporter({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: functions.config().smtp.user,
    pass: functions.config().smtp.password,
  },
});

export const createStoreUser = functions.https.onCall(async (data, context) => {
  // Verify admin access
  if (!context.auth || context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { email, password, storeData } = data;
  
  if (!email || !password) {
    throw new functions.https.HttpsError('invalid-argument', 'Email and password are required');
  }

  try {
    // Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false,
      disabled: false,
    });

    // Create Firestore document
    await admin.firestore().collection('users').doc(userRecord.uid).set({
      ...storeData,
      uid: userRecord.uid,
      role: 'retailer',
      mustResetPassword: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
    });

    // Send email with password
    try {
      await transporter.sendMail({
        from: functions.config().smtp.user,
        to: email,
        subject: 'Your SimpliPharma Store Account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2196F3;">Welcome to SimpliPharma!</h2>
            <p>Your store account has been created successfully.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Temporary Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
            </div>
            <p><strong>Important:</strong> Please reset your password on first login for security.</p>
            <p>If you have any questions, please contact support.</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">This is an automated message. Please do not reply.</p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the function if email fails
    }

    return { 
      success: true, 
      uid: userRecord.uid,
      message: 'Store user created successfully. Password email sent.' 
    };
  } catch (error: any) {
    console.error('Error creating store user:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed to create store user');
  }
});

export const resetStorePassword = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { uid, newPassword } = data;
  
  try {
    await admin.auth().updateUser(uid, {
      password: newPassword,
    });

    await admin.firestore().collection('users').doc(uid).update({
      mustResetPassword: true,
    });

    // Get user email for sending
    const userRecord = await admin.auth().getUser(uid);
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    const email = userRecord.email || userDoc.data()?.email;

    if (email) {
      await transporter.sendMail({
        from: functions.config().smtp.user,
        to: email,
        subject: 'SimpliPharma - Password Reset',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2196F3;">Password Reset</h2>
            <p>Your password has been reset by an administrator.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>New Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${newPassword}</code></p>
            </div>
            <p><strong>Important:</strong> Please change your password after logging in.</p>
          </div>
        `,
      });
    }

    return { success: true, message: 'Password reset successfully. Email sent.' };
  } catch (error: any) {
    throw new functions.https.HttpsError('internal', error.message || 'Failed to reset password');
  }
});
*/

