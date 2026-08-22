import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import nodemailer from "npm:nodemailer@6.9.7";

// SMTP Configuration from environment variables (using MAIL_* prefix)
const SMTP_HOST = Deno.env.get("MAIL_HOST") || "smtp.gmail.com";
const SMTP_PORT = parseInt(Deno.env.get("MAIL_PORT") || "587");
const SMTP_USER = Deno.env.get("MAIL_USERNAME") || "";
const SMTP_PASSWORD = Deno.env.get("MAIL_PASSWORD") || "";
const SMTP_FROM_EMAIL = Deno.env.get("MAIL_FROM_ADDRESS") || SMTP_USER;
const SMTP_FROM_NAME = Deno.env.get("MAIL_FROM_NAME") || "DentPulse";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LineItem {
  item_number: number;
  description: string;
  status: string;
  approver_amount: number;
}

interface EmailPayload {
  approver_name: string;
  approver_email: string;
  invoice_number: string;
  invoice_date: string;
  vendor_name: string;
  line_items: LineItem[];
  total_approver_amount: number;
  currency: string;
  approval_link: string;
}

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    'GBP': '£',
    '£': '£',
    'USD': '$',
    '$': '$',
    'EUR': '€',
    '€': '€',
  };
  return symbols[currency] || currency;
}

function generateEmailHtml(data: EmailPayload): string {
  const currencySymbol = getCurrencySymbol(data.currency);

  const lineItemsHtml = data.line_items.map((item) => `
    <tr>
      <td style="padding: 12px 8px; color: #374151; border-bottom: 1px solid #e5e7eb; width: 60px;">${item.item_number}</td>
      <td style="padding: 12px 8px; color: #374151; border-bottom: 1px solid #e5e7eb;">${item.description}</td>
      <td style="padding: 12px 8px; text-align: center; border-bottom: 1px solid #e5e7eb; width: 120px;">
        <span style="background-color: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 500;">
          ${item.status}
        </span>
      </td>
      <td style="padding: 12px 8px; text-align: right; color: #374151; border-bottom: 1px solid #e5e7eb; width: 150px;">${currencySymbol}${item.approver_amount.toFixed(2)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Item Assigned for Approval</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 800px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">

      <!-- Header -->
      <h1 style="margin: 0 0 8px 0; font-size: 26px; font-weight: 700; color: #111827;">Item Assigned</h1>
      <p style="margin: 0 0 24px 0; color: #6b7280; font-size: 16px;">Hello ${data.approver_name},</p>
      <p style="margin: 0 0 24px 0; color: #374151; font-size: 15px;">A new invoice item has been assigned to you for approval.</p>

      <!-- Invoice Details Card -->
      <div style="border-left: 4px solid #4f46e5; background-color: #f9fafb; padding: 24px; margin-bottom: 24px;">
        <h2 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600; color: #4f46e5;">Invoice Details</h2>

        <div style="margin-bottom: 10px; font-size: 15px;">
          <span style="color: #6b7280;">Invoice Number:</span>
          <span style="color: #111827; font-weight: 500;">${data.invoice_number}</span>
        </div>

        <div style="margin-bottom: 10px; font-size: 15px;">
          <span style="color: #6b7280;">Invoice Date:</span>
          <span style="color: #111827;">${data.invoice_date}</span>
        </div>

        <div style="margin-bottom: 20px; font-size: 15px;">
          <span style="color: #6b7280;">Vendor:</span>
          <span style="color: #111827;">${data.vendor_name}</span>
        </div>

        <!-- Approver Items Section -->
        <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #4f46e5;">Approver Items</h3>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="border-bottom: 2px solid #e5e7eb;">
              <th style="padding: 10px 8px; text-align: left; color: #6b7280; font-weight: 600; width: 60px;">Item</th>
              <th style="padding: 10px 8px; text-align: left; color: #6b7280; font-weight: 600;">Description</th>
              <th style="padding: 10px 8px; text-align: center; color: #6b7280; font-weight: 600; width: 120px;">Status</th>
              <th style="padding: 10px 8px; text-align: right; color: #6b7280; font-weight: 600; width: 150px;">Approver Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHtml}
          </tbody>
        </table>

        <!-- Total Row -->
        <table style="width: 100%; border-collapse: collapse; font-size: 15px; margin-top: 16px; border-top: 2px solid #e5e7eb;">
          <tr>
            <td style="padding: 14px 8px; font-weight: 600; color: #111827;">Total Approver Amount</td>
            <td style="padding: 14px 8px; text-align: right; font-weight: 700; color: #111827; width: 150px;">${currencySymbol}${data.total_approver_amount.toFixed(2)}</td>
          </tr>
        </table>
      </div>

      <!-- Action Section -->
      <p style="margin: 0 0 20px 0; color: #374151; font-size: 15px;">Please review and approve or reject this item by clicking the button below:</p>

      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${data.approval_link}" style="display: inline-block; background-color: #65a30d; color: #ffffff; padding: 16px 40px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">
          View Invoice & Approve
        </a>
      </div>

      <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
      <a href="${data.approval_link}" style="color: #4f46e5; font-size: 14px; word-break: break-all;">${data.approval_link}</a>

      <!-- Footer -->
      <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
          This is an automated message from DentPulse. Please do not reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

serve(async (req) => {
  console.log("=== send-approver-notification function called ===");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: EmailPayload = await req.json();
    console.log("Received payload:", JSON.stringify(payload, null, 2));

    // Static recipient email for testing
    // const recipientEmail = "hitesh.parekh985@gmail.com";
    const recipientEmail = [
      "hitesh.parekh985@gmail.com",
      "yash.vithalani@dentpulse.com"
    ].join(",");

    const emailHtml = generateEmailHtml(payload);

    console.log("SMTP Config:", { SMTP_HOST, SMTP_PORT, SMTP_USER: SMTP_USER ? "SET" : "NOT SET", SMTP_FROM_EMAIL });

    // Create nodemailer transporter
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true for 465, false for other ports
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
    });

    // Send email
    const info = await transporter.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: recipientEmail,
      subject: `Invoice Item Assigned for Approval - ${payload.invoice_number}`,
      text: "Please view this email in HTML format.",
      html: emailHtml,
    });

    console.log("Email sent successfully:", info.messageId);

    return new Response(JSON.stringify({ success: true, message: "Email sent successfully", messageId: info.messageId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
