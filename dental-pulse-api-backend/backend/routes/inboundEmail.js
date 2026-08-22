const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const inboundEmailService = require('../services/inboundEmailService');

/**
 * GET /api/inbound-email-webhook/view-pdf/:filename
 * Serve PDF file without authentication
 * Public access for viewing invoices in browser
 */
router.get('/view-pdf/:filename', (req, res) => {
  const { filename } = req.params;
  inboundEmailService.streamPdfFile(filename, res);
});

/**
 * POST /api/inbound-email/webhook
 * Receives inbound email from email service provider
 */
router.post('/webhook', async (req, res) => {
  try {
    const result = await inboundEmailService.processInboundEmailWebhook(req.body);
    return res.json(result);
  } catch (error) {
    console.error('[InboundEmail] Webhook error:', error);
    return res.status(500).json({ status: 'error', reason: error.message });
  }
});

/**
 * POST /api/inbound-email-webhook/store-pdf
 * Store PDF file only (no extraction, no Supabase insert)
 * Used when frontend handles extraction
 * Multipart form data: file (PDF)
 */
router.post('/store-pdf', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', reason: 'No file uploaded' });
  }

  try {
    const result = inboundEmailService.storePdfOnly({
      fileBuffer: req.file.buffer,
      filename: req.file.originalname,
    });
    return res.json(result);
  } catch (error) {
    console.error('[InboundEmail] Store PDF error:', error);
    return res.status(500).json({ status: 'error', reason: error.message });
  }
});

module.exports = router;
