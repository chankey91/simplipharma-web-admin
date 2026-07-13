/**
 * SMTP Credentials Test Script
 *
 * Usage (set credentials via env — never commit real passwords):
 *   SMTP_USER=your@email.com SMTP_PASSWORD=your-app-password node test-smtp.js
 *
 * Or read from Firebase Functions config:
 *   firebase functions:config:get
 *   then export SMTP_USER / SMTP_PASSWORD from the smtp section.
 */

const nodemailer = require('nodemailer');

const SMTP_CONFIG = {
  user: process.env.SMTP_USER || '',
  password: process.env.SMTP_PASSWORD || '',
  host: process.env.SMTP_HOST || 'smtp.zoho.in',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
};

// Test email configuration
const TEST_EMAIL = {
  from: SMTP_CONFIG.user,
  to: SMTP_CONFIG.user, // Send test email to yourself
  subject: 'SimpliPharma SMTP Test',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2196F3;">SMTP Credentials Test</h2>
      <p>This is a test email to verify SMTP credentials are working correctly.</p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>SMTP Host:</strong> ${SMTP_CONFIG.host}</p>
        <p><strong>SMTP Port:</strong> ${SMTP_CONFIG.port}</p>
        <p><strong>From Email:</strong> ${SMTP_CONFIG.user}</p>
        <p><strong>Test Time:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p>If you received this email, your SMTP credentials are configured correctly! ✅</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">This is an automated test message.</p>
    </div>
  `,
  text: 'This is a test email to verify SMTP credentials are working correctly.',
};

async function testSMTP() {
  if (!SMTP_CONFIG.user || !SMTP_CONFIG.password) {
    console.error('❌ Missing SMTP credentials.');
    console.error('Set SMTP_USER and SMTP_PASSWORD environment variables, e.g.:');
    console.error('  SMTP_USER=your@email.com SMTP_PASSWORD=your-app-password node test-smtp.js');
    process.exit(1);
  }

  console.log('🔍 Testing SMTP Credentials...\n');
  console.log('Configuration:');
  console.log(`  Host: ${SMTP_CONFIG.host}`);
  console.log(`  Port: ${SMTP_CONFIG.port}`);
  console.log(`  User: ${SMTP_CONFIG.user}`);
  console.log(`  Password: ${SMTP_CONFIG.password.substring(0, 3)}***`);
  console.log(`  Password Length: ${SMTP_CONFIG.password.length} characters`);
  console.log('');

  // Create transporter with enhanced options
  const transporter = nodemailer.createTransport({
    host: SMTP_CONFIG.host,
    port: SMTP_CONFIG.port,
    secure: SMTP_CONFIG.secure,
    auth: {
      user: SMTP_CONFIG.user,
      pass: SMTP_CONFIG.password,
    },
    debug: true,
    logger: true,
  });

  try {
    // Verify connection
    console.log('📡 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified successfully!\n');

    // Send test email
    console.log(`📧 Sending test email to ${TEST_EMAIL.to}...`);
    const info = await transporter.sendMail(TEST_EMAIL);

    console.log('✅ Test email sent successfully!');
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}`);
    console.log('');
    console.log('🎉 SMTP credentials are working correctly!');
    console.log(`   Please check your inbox at ${TEST_EMAIL.to} for the test email.`);

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ SMTP test failed!');
    console.error('');
    console.error('Error details:');
    console.error(`  Code: ${error.code || 'N/A'}`);
    console.error(`  Command: ${error.command || 'N/A'}`);
    console.error(`  Message: ${error.message}`);
    console.error('');

    if (error.code === 'EAUTH') {
      console.error('🔐 Authentication Error:');
      console.error('   - Check if email and password are correct');
      console.error('   - For Gmail, you may need to use an App Password');
      console.error('   - Enable "Less secure app access" or use App Password');
      console.error('   - Generate App Password: https://myaccount.google.com/apppasswords');
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      console.error('🌐 Connection Error:');
      console.error('   - Check your internet connection');
      console.error('   - Verify SMTP host and port are correct');
      console.error('   - Check if firewall is blocking the connection');
    } else {
      console.error('💡 Troubleshooting:');
      console.error('   - Verify SMTP credentials are correct');
      console.error('   - Check if email account has 2-Step Verification enabled');
      console.error('   - For Gmail, use App Password instead of regular password');
    }

    return { success: false, error: error.message };
  }
}

// Run the test
testSMTP()
  .then((result) => {
    if (result.success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
