import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';

admin.initializeApp();

// SMTP Configuration
const getTransporter = () => {
  const config = functions.config().smtp;
  if (!config || !config.user || !config.password) {
    throw new Error('SMTP configuration not found. Please set smtp.user and smtp.password using firebase functions:config:set');
  }

  console.log('Creating SMTP transporter with config:', {
    host: 'smtp.gmail.com',
    port: 587,
    user: config.user,
    hasPassword: !!config.password
  });

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: config.user,
      pass: config.password,
    },
    debug: true, // Enable debug output
    logger: true, // Log to console
  });
};

/**
 * Send password email to vendor
 * Called when a new vendor is created
 */
export const sendVendorPasswordEmail = functions.https.onCall(async (data, context) => {
  try {
    console.log('sendVendorPasswordEmail called with data:', {
      email: data?.email,
      hasPassword: !!data?.password,
      vendorName: data?.vendorName,
      hasAuth: !!context.auth,
      authUid: context.auth?.uid
    });

    // Verify admin access
    if (!context.auth) {
      console.error('No authentication context');
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Check if user is admin
    let userDoc;
    try {
      userDoc = await admin.firestore().collection('users').doc(context.auth.uid).get();
      console.log('User document fetched:', {
        exists: userDoc.exists,
        role: userDoc.data()?.role
      });
    } catch (error: any) {
      console.error('Error fetching user document:', error);
      throw new functions.https.HttpsError('internal', 'Failed to verify user permissions');
    }

    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
      console.error('User is not admin:', {
        exists: userDoc.exists,
        role: userDoc.data()?.role
      });
      throw new functions.https.HttpsError('permission-denied', 'Admin access required');
    }

    const { email, password, vendorName } = data || {};

    if (!email || !password || !vendorName) {
      console.error('Missing required parameters:', { email: !!email, password: !!password, vendorName: !!vendorName });
      throw new functions.https.HttpsError('invalid-argument', 'Email, password, and vendorName are required');
    }

    // Check SMTP configuration
    const smtpConfig = functions.config().smtp;
    console.log('SMTP Config check:', {
      hasConfig: !!smtpConfig,
      hasUser: !!smtpConfig?.user,
      hasPassword: !!smtpConfig?.password,
      user: smtpConfig?.user || 'NOT SET'
    });

    if (!smtpConfig || !smtpConfig.user || !smtpConfig.password) {
      const errorMsg = 'SMTP configuration not found. Please set smtp.user and smtp.password using: firebase functions:config:set smtp.user="your-email" smtp.password="your-password"';
      console.error(errorMsg);
      throw new functions.https.HttpsError('failed-precondition', errorMsg);
    }

    const transporter = getTransporter();
    console.log('Transporter created, attempting to send email to:', email);

    // Verify SMTP connection first
    try {
      await transporter.verify();
      console.log('SMTP connection verified successfully');
    } catch (verifyError: any) {
      console.error('SMTP verification failed:', verifyError);
      throw new functions.https.HttpsError('internal', `SMTP connection failed: ${verifyError.message || 'Unknown error'}`);
    }

    const mailOptions = {
      from: smtpConfig.user,
      to: email,
      subject: 'Your SimpliPharma Vendor Account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2196F3;">Welcome to SimpliPharma!</h2>
          <p>Your vendor account has been created successfully.</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Vendor Name:</strong> ${vendorName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Password:</strong> <code style="background: white; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
          </div>
          <p><strong>Important:</strong> Please keep this password secure and change it after your first login.</p>
          <p>If you have any questions, please contact support.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">This is an automated message. Please do not reply.</p>
        </div>
      `,
    };

    console.log('Sending email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', {
      messageId: result.messageId,
      response: result.response
    });

    return {
      success: true,
      message: 'Password email sent successfully',
      messageId: result.messageId
    };
  } catch (error: any) {
    console.error('Error sending vendor password email:', {
      error: error,
      message: error.message,
      code: error.code,
      response: error.response,
      responseCode: error.responseCode,
      command: error.command,
      stack: error.stack
    });

    // Provide more specific error messages
    let errorMessage = 'Failed to send email';
    if (error.code === 'EAUTH') {
      errorMessage = 'SMTP authentication failed. Please check your email and password in Firebase Functions config.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Could not connect to SMTP server. Please check your network connection.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new functions.https.HttpsError('internal', errorMessage);
  } catch (error: any) {
    // Catch any unexpected errors
    console.error('Unexpected error in sendVendorPasswordEmail:', {
      error: error,
      message: error.message,
      code: error.code,
      stack: error.stack
    });

    // If it's already an HttpsError, re-throw it
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Otherwise, wrap it in an HttpsError
    throw new functions.https.HttpsError('internal', error.message || 'An unexpected error occurred');
  }
});

