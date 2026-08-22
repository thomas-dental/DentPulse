const nodemailer = require('nodemailer');

// Rate limiting: track sends per user
const rateLimits = new Map(); // userId → { count, resetAt }
const MAX_EMAILS_PER_HOUR = 5;

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + 3600_000 });
    return true;
  }

  if (entry.count >= MAX_EMAILS_PER_HOUR) {
    return false;
  }

  entry.count++;
  return true;
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT || process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.MAIL_USERNAME || process.env.SMTP_USER,
      pass: process.env.MAIL_PASSWORD || process.env.SMTP_PASS,
    },
  });
}

async function sendReportEmail({ to, subject, body, pdfBuffer, pdfFilename, userId }) {
  if (!checkRateLimit(userId)) {
    throw new Error('Email rate limit exceeded (max 5 per hour). Please try again later.');
  }

  const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.SMTP_FROM || 'noreply@dentpulse.com';
  const fromName = process.env.MAIL_FROM_NAME || 'DentPulse Reports';

  const transporter = createTransporter();

  const mailOptions = {
    from: `${fromName} <${fromAddress}>`,
    to,
    subject: subject || 'DentPulse Report',
    html: body || '<p>Please find the attached report.</p>',
    attachments: pdfBuffer ? [{
      filename: pdfFilename || 'report.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    }] : [],
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[CHATBOT-EMAIL] Sent to ${to}, messageId: ${info.messageId}`);
  return info;
}

module.exports = { sendReportEmail, checkRateLimit };
