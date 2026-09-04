/**
 * Persist inbound Dentally webhook events for audit and dev UI.
 */

const { supabaseAdmin } = require('../../../config/supabase');

/**
 * @param {object} row
 * @returns {Promise<{ id: string }|null>}
 */
async function insertWebhookLog(row) {
  const { data, error } = await supabaseAdmin
    .from('dentally_webhook_logs')
    .insert({
      practice_id: row.practiceId,
      resource: row.resource,
      action: row.action,
      object_id: row.objectId != null ? String(row.objectId) : null,
      event_name: row.eventName ?? null,
      signature_valid: row.signatureValid === true,
      status_code: row.statusCode ?? null,
      processing_status: row.processingStatus ?? 'pending',
      error_message: row.errorMessage ?? null,
      payload: row.payload ?? {},
      invoice_ids: row.invoiceIds ?? [],
    })
    .select('id')
    .single();

  if (error) {
    console.error('[WebhookLog] insert failed:', error.message);
    return null;
  }
  return data;
}

/**
 * @param {string} logId
 * @param {object} patch
 */
async function updateWebhookLog(logId, patch) {
  if (!logId) return;
  const update = {};
  if (patch.statusCode != null) update.status_code = patch.statusCode;
  if (patch.processingStatus != null) update.processing_status = patch.processingStatus;
  if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage;
  if (patch.invoiceIds != null) update.invoice_ids = patch.invoiceIds;
  if (patch.signatureValid != null) update.signature_valid = patch.signatureValid;

  const { error } = await supabaseAdmin
    .from('dentally_webhook_logs')
    .update(update)
    .eq('id', logId);

  if (error) {
    console.error('[WebhookLog] update failed:', error.message);
  }
}

module.exports = {
  insertWebhookLog,
  updateWebhookLog,
};
