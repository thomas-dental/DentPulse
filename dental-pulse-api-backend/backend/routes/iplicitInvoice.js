/**
 * Iplicit Invoice routes — handles invoice creation and updates in Iplicit.
 *
 * Base path: /api/iplicit-invoice
 */

const express = require('express');
const syncAuthMiddleware = require('../middleware/syncAuth');
const iplicitInvoiceService = require('../services/iplicitInvoiceService');

const router = express.Router();

/**
 * POST /api/iplicit-invoice/create
 * Create a purchase invoice in Iplicit
 */
router.post('/create', syncAuthMiddleware, async (req, res) => {
  try {
    const { invoiceId, invoice, connectionId } = req.body;

    console.log('[IplicitInvoice Route] CREATE received:', { invoiceId, connectionId, hasInvoice: !!invoice });

    if (!invoiceId || !invoice) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: invoiceId and invoice',
      });
    }

    const result = await iplicitInvoiceService.createInvoice(invoiceId, invoice, connectionId);

    return res.json({
      success: true,
      iplicitInvoiceId: result.iplicitInvoiceId,
      platformInvoiceId: result.platformInvoiceId,
      message: 'Invoice created in Iplicit successfully',
      data: result.data,
      existingSupplier: result.existingSupplier,
      contactAccountId: result.contactAccountId,
    });

  } catch (err) {
    console.error('[IplicitInvoice] Create error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create invoice in Iplicit',
    });
  }
});

/**
 * POST /api/iplicit-invoice/update
 * Update a purchase invoice in Iplicit (backend calls Iplicit API with PATCH)
 */
router.post('/update', syncAuthMiddleware, async (req, res) => {
  try {
    const { invoiceId, invoice, connectionId } = req.body;

    if (!invoiceId || !invoice) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: invoiceId and invoice',
      });
    }

    const result = await iplicitInvoiceService.updateInvoice(invoiceId, invoice, connectionId);

    return res.json({
      success: true,
      iplicitInvoiceId: result.iplicitInvoiceId,
      platformInvoiceId: result.platformInvoiceId,
      message: 'Invoice updated in Iplicit successfully',
      data: result.data,
    });

  } catch (err) {
    console.error('[IplicitInvoice] Update error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to update invoice in Iplicit',
    });
  }
});

module.exports = router;
