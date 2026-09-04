/**
 * Inbound Dentally webhooks — payment and appointment events update local
 * tables and refresh linked Patient Economics data in real time.
 *
 * POST /api/dentally-webhook/payments?practice_id={organization_uuid}
 * POST /api/dentally-webhook/appointments?practice_id={organization_uuid}
 */

const express = require('express');
const { findDentallyIntegration } = require('../services/patientEconomics/integrationCredentials');
const { verifyDentallySignature } = require('../services/patientEconomics/webhooks/verifyDentallySignature');
const {
  isPaymentWebhookEvent,
  parsePaymentAction,
  parseWebhookPayload,
  extractPaymentId,
} = require('../services/patientEconomics/webhooks/paymentWebhookHelpers');
const {
  isAppointmentWebhookEvent,
  parseAppointmentAction,
  extractAppointmentId,
} = require('../services/patientEconomics/webhooks/appointmentWebhookHelpers');
const { insertWebhookLog, updateWebhookLog } = require('../services/patientEconomics/webhooks/webhookLog');
const { processPaymentWebhook } = require('../services/patientEconomics/webhooks/processPaymentWebhook');
const { processAppointmentWebhook } = require('../services/patientEconomics/webhooks/processAppointmentWebhook');

const router = express.Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

async function handleWebhookRequest(req, res, config) {
  const practiceId = req.query?.practice_id;
  if (!isUuid(practiceId)) {
    return res.status(400).json({ success: false, error: 'practice_id (UUID) is required' });
  }

  const rawBody = req.rawBody || JSON.stringify(req.body ?? {});
  const payload = req.body ?? {};
  const { event, object, data } = parseWebhookPayload(payload);
  const headerSignature = req.get('X-Dentally-Signature') || req.get('x-dentally-signature');

  let integration;
  try {
    integration = await findDentallyIntegration(practiceId, { requireEncrypted: false });
  } catch (err) {
    console.error('[DentallyWebhook] integration load failed:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load integration' });
  }

  const secret = integration?.webhook_secret || process.env.DENTALLY_WEBHOOK_SECRET || null;
  const signatureValid = verifyDentallySignature(rawBody, headerSignature, secret);
  const action = config.parseAction(event) || 'unknown';
  const objectId = config.extractObjectId(data);

  const logRow = await insertWebhookLog({
    practiceId,
    resource: object || config.defaultResource,
    action,
    objectId,
    eventName: event,
    signatureValid,
    statusCode: null,
    processingStatus: 'pending',
    payload,
  });

  const finishLog = async (statusCode, processingStatus, patch = {}) => {
    if (!logRow?.id) return;
    await updateWebhookLog(logRow.id, {
      statusCode,
      processingStatus,
      invoiceIds: patch.invoiceIds,
      errorMessage: patch.errorMessage,
    });
  };

  if (!signatureValid) {
    await finishLog(401, 'failed', { errorMessage: 'Invalid webhook signature' });
    return res.status(401).json({ success: false, error: 'Invalid signature' });
  }

  if (!secret) {
    await finishLog(503, 'failed', {
      errorMessage: 'Webhook secret not configured for this practice',
    });
    return res.status(503).json({ success: false, error: 'Webhook secret not configured' });
  }

  if (!config.isSupportedEvent(event, object)) {
    await finishLog(204, 'ignored', { errorMessage: `Ignored event: ${event || '(empty)'}` });
    return res.status(204).send();
  }

  try {
    const result = await config.process({ practiceId, eventName: event, data });
    const response = await config.onSuccess({ finishLog, result });
    return res.status(200).json(response);
  } catch (err) {
    console.error(`[DentallyWebhook] ${config.defaultResource} processing failed:`, err.message);
    const statusCode =
      err.code === config.missingIdCode || err.code === 'UNSUPPORTED_EVENT'
        ? 400
        : err.code === config.notFoundCode
          ? 404
          : err.code === 'NO_CREDENTIAL' || err.code === 'NEEDS_RECONNECTION'
            ? 503
            : 500;

    await finishLog(statusCode, 'failed', { errorMessage: err.message });
    return res.status(statusCode).json({ success: false, error: err.message });
  }
}

/**
 * POST /payments?practice_id=
 */
router.post('/payments', async (req, res) => {
  return handleWebhookRequest(req, res, {
    defaultResource: 'payments',
    parseAction: parsePaymentAction,
    extractObjectId: extractPaymentId,
    isSupportedEvent: (event, object) => isPaymentWebhookEvent(event) && object === 'payment',
    missingIdCode: 'MISSING_PAYMENT_ID',
    notFoundCode: 'PAYMENT_NOT_FOUND',
    process: processPaymentWebhook,
    onSuccess: async ({ finishLog, result }) => {
      await finishLog(200, 'processed', { invoiceIds: result.invoiceIds });
      return {
        success: true,
        paymentId: result.paymentId,
        invoiceIds: result.invoiceIds,
        paymentUpserted: result.paymentUpserted,
        invoicesRefreshed: result.invoicesRefreshed,
      };
    },
  });
});

/**
 * POST /appointments?practice_id=
 */
router.post('/appointments', async (req, res) => {
  return handleWebhookRequest(req, res, {
    defaultResource: 'appointments',
    parseAction: parseAppointmentAction,
    extractObjectId: extractAppointmentId,
    isSupportedEvent: (event, object) => isAppointmentWebhookEvent(event) && object === 'appointment',
    missingIdCode: 'MISSING_APPOINTMENT_ID',
    notFoundCode: 'APPOINTMENT_NOT_FOUND',
    process: processAppointmentWebhook,
    onSuccess: async ({ finishLog, result }) => {
      await finishLog(200, 'processed');
      return {
        success: true,
        appointmentId: result.appointmentId,
        appointmentUpserted: result.appointmentUpserted,
        treatmentAppointmentsRefreshed: result.treatmentAppointmentsRefreshed,
        ledgerEventsWritten: result.ledgerEventsWritten,
      };
    },
  });
});

module.exports = router;
