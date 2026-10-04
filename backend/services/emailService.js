const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

let transporter = null;

// Initialize Transporter with environment credentials or fallback mock
function getTransporter() {
    if (transporter) return transporter;

    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
        console.log(`[EmailService] ✅ SMTP Transporter initialized with host: ${process.env.SMTP_HOST}`);
    } else {
        console.log('[EmailService] ℹ️ SMTP credentials not found in .env. Running in development logger mode.');
        transporter = null;
    }
    return transporter;
}

/**
 * Generate modern, styled HTML email template for Guardian Invitation
 * including RFC 6238 TOTP QR code, provisioning URI link, and access handle.
 */
function buildGuardianInviteTemplate({
    recipientName,
    senderName,
    senderPhone,
    accessCode,
    relationship,
    totpProvisioningUri,
    totpSecret,
    qrDataUrl
}) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SafeCircle Guardian Invitation & Security Setup</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0B1120; color: #F1F5F9; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #1E293B; border-radius: 16px; border: 1px solid #334155; overflow: hidden; }
    .header { background: linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%); padding: 30px; text-align: center; border-bottom: 2px solid #3B82F6; }
    .header h1 { margin: 0; color: #60A5FA; font-size: 24px; letter-spacing: 0.5px; }
    .header p { margin: 6px 0 0 0; color: #94A3B8; font-size: 13px; }
    .content { padding: 30px; }
    .greeting { font-size: 18px; font-weight: 600; color: #FFFFFF; margin-bottom: 12px; }
    .message-box { background-color: #0F172A; border-left: 4px solid #3B82F6; padding: 14px 18px; border-radius: 8px; margin: 16px 0; color: #CBD5E1; font-size: 14px; line-height: 1.5; }
    
    .code-card { background: linear-gradient(180deg, #0F172A 0%, #162032 100%); border: 1px solid #38BDF8; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
    .code-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #38BDF8; font-weight: 700; margin-bottom: 8px; }
    .code-value { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #38BDF8; font-family: monospace; }
    .code-subtext { font-size: 12px; color: #64748B; margin-top: 8px; }

    .qr-card { background-color: #0F172A; border: 1px solid #334155; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
    .qr-title { font-size: 15px; font-weight: 700; color: #10B981; margin-bottom: 6px; letter-spacing: 0.5px; }
    .qr-desc { font-size: 13px; color: #94A3B8; margin-bottom: 16px; line-height: 1.4; }
    .qr-image { width: 180px; height: 180px; background: white; padding: 10px; border-radius: 12px; display: block; margin: 0 auto 16px auto; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .secret-box { background-color: #1E293B; border: 1px dashed #475569; padding: 10px 14px; border-radius: 8px; display: inline-block; margin-top: 10px; }
    .secret-label { font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 1px; }
    .secret-key { font-family: monospace; font-size: 15px; font-weight: 700; color: #38BDF8; letter-spacing: 2px; }

    .steps-box { background-color: #0F172A; border-radius: 10px; padding: 18px 22px; margin: 20px 0; }
    .steps-title { font-size: 13px; font-weight: 700; color: #F8FAFC; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
    .step-item { font-size: 13px; color: #CBD5E1; margin-bottom: 8px; line-height: 1.5; }
    
    .actions { text-align: center; margin: 26px 0 16px 0; }
    .btn { display: inline-block; background-color: #2563EB; color: #FFFFFF; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; margin: 6px 4px; }
    .btn-green { background-color: #059669; }
    .footer { background-color: #0F172A; padding: 20px; text-align: center; font-size: 12px; color: #64748B; border-top: 1px solid #1E293B; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ SafeCircle Security Network</h1>
      <p>Decentralized Social Recovery & Real-Time Incident Protection</p>
    </div>
    <div class="content">
      <div class="greeting">Hello ${recipientName || 'Guardian'},</div>
      <p style="color: #94A3B8; font-size: 14px; line-height: 1.5;">
        <strong>${senderName}</strong> (${relationship || 'Contact'}) has designated you as their <strong>Trusted Emergency Guardian</strong> on SafeCircle.
      </p>

      <div class="message-box">
        If ${senderName} experiences a phone theft or triggers an emergency SOS, you are authorized to establish a view-only tracking session to pinpoint their real-time location and audio evidence.
      </div>

      <!-- Handle Card -->
      <div class="code-card">
        <div class="code-label">Step 1: Your Contact Handle</div>
        <div class="code-value">${accessCode}</div>
        <div class="code-subtext">This identifies your guardian relationship in the SafeCircle Portal.</div>
      </div>

      <!-- TOTP Authenticator Provisioning Card -->
      <div class="qr-card">
        <div class="qr-title">🔐 Step 2: Setup 2FA Authenticator (RFC 6238 TOTP)</div>
        <div class="qr-desc">
          To protect ${senderName}'s privacy, access requires a rotating 6-digit verification code from your authenticator app (Google Authenticator, Authy, or Microsoft Authenticator).
        </div>

        ${qrDataUrl ? `<img src="${qrDataUrl}" alt="SafeCircle TOTP QR Code" class="qr-image" />` : ''}

        <div style="margin-top: 12px;">
          ${totpProvisioningUri ? `<a href="${totpProvisioningUri}" class="btn btn-green">📱 Open in Authenticator App</a>` : ''}
        </div>

        ${totpSecret ? `
        <div class="secret-box">
          <div class="secret-label">Manual Setup Secret Key:</div>
          <div class="secret-key">${totpSecret}</div>
        </div>` : ''}
      </div>

      <!-- Instructions Box -->
      <div class="steps-box">
        <div class="steps-title">📋 Quick Setup Instructions</div>
        <div class="step-item">1. Open <strong>Google Authenticator</strong> or <strong>Authy</strong> on your mobile device.</div>
        <div class="step-item">2. Scan the QR code above (or tap "Open in Authenticator App" if reading on your phone).</div>
        <div class="step-item">3. During an emergency, enter your Contact Handle (<strong>${accessCode}</strong>) and the current 6-digit code in the SafeCircle Tracker Portal.</div>
      </div>

      <div class="actions">
        <a href="https://safecircle.app/track?code=${accessCode}" class="btn">Open Live Incident Portal</a>
      </div>

      <p style="font-size: 12px; color: #64748B; text-align: center; margin-top: 20px;">
        Sender Phone: ${senderPhone || 'Not specified'}
      </p>
    </div>
    <div class="footer">
      SafeCircle Automated Security Service • Cryptographically Secured RFC 6238 TOTP Protocol
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Dispatch an automated Guardian Invitation Email with QR code and TOTP setup
 * @param {Object} options Recipient, sender, access code, and TOTP provisioning details
 */
async function sendGuardianInvitationEmail({
    recipientEmail,
    recipientName,
    senderName,
    senderPhone,
    accessCode,
    relationship,
    totpProvisioningUri,
    totpSecret
}) {
    if (!recipientEmail || !recipientEmail.includes('@')) {
        console.log('[EmailService] Invalid recipient email. Skipping email dispatch.');
        return { success: false, reason: 'INVALID_EMAIL' };
    }

    // 1. Generate QR Code Data URL from the TOTP provisioning URI
    let qrDataUrl = null;
    let qrBuffer = null;
    if (totpProvisioningUri) {
        try {
            qrDataUrl = await QRCode.toDataURL(totpProvisioningUri, {
                width: 250,
                margin: 2,
                color: {
                    dark: '#0F172A',
                    light: '#FFFFFF'
                }
            });
            qrBuffer = await QRCode.toBuffer(totpProvisioningUri, {
                width: 250,
                margin: 2
            });
        } catch (qrErr) {
            console.warn('[EmailService] Failed to generate TOTP QR code image:', qrErr.message);
        }
    }

    const htmlContent = buildGuardianInviteTemplate({
        recipientName,
        senderName,
        senderPhone,
        accessCode,
        relationship,
        totpProvisioningUri,
        totpSecret,
        qrDataUrl
    });

    const mailOptions = {
        from: process.env.SMTP_FROM || '"SafeCircle Safety Network" <alerts@safecircle.app>',
        to: recipientEmail,
        subject: `🛡️ ${senderName} designated you as their Trusted Guardian on SafeCircle`,
        text: `Hello ${recipientName},\n\n${senderName} added you as their emergency guardian on SafeCircle.\n\nYour Contact Handle: ${accessCode}\nTOTP Secret: ${totpSecret || 'See HTML email'}\nProvisioning URI: ${totpProvisioningUri || 'N/A'}\n\nTracker Portal: https://safecircle.app/track?code=${accessCode}`,
        html: htmlContent,
    };

    if (qrBuffer) {
        mailOptions.attachments = [
            {
                filename: 'safecircle-totp-qr.png',
                content: qrBuffer,
                cid: 'safecircle_totp_qr'
            }
        ];
    }

    const client = getTransporter();

    if (client) {
        try {
            const info = await client.sendMail(mailOptions);
            console.log(`[EmailService] ✉️ Guardian invitation email with TOTP QR code sent to ${recipientEmail} (ID: ${info.messageId})`);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('[EmailService Error] Failed to send email via SMTP:', error.message);
            return { success: false, error: error.message };
        }
    } else {
        // Development / Test logger mode: output rich details to console
        console.log(`[EmailService Mock] ✉️ Simulated Guardian Email to: "${recipientEmail}" for Ward: "${senderName}"`);
        console.log(`  Access Handle: ${accessCode}`);
        console.log(`  TOTP Secret:   ${totpSecret}`);
        console.log(`  Provisioning:  ${totpProvisioningUri}`);
        return { success: true, simulated: true, accessCode, totpProvisioningUri };
    }
}

module.exports = {
    sendGuardianInvitationEmail,
};

