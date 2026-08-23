/**
 * Entity transformation functions.
 * Each transformer converts raw Dentally API data into our database schema.
 *
 * Ported from: dental-pulse-dev/supabase/functions/dentally-sync/index.ts
 */

const { parseBigInt, mapSiteIdToLocationId, mapNhsBand, truncate, parseUuid } = require('../../utils/helpers');

/**
 * Transform a single record based on entity type.
 * @param {string} entityAlias
 * @param {object} record - Raw API record
 * @param {object} ctx - Context: { organizationId, userId, locationMap, categoryMap }
 * @returns {object|null} Transformed record or null
 */
function transformRecord(entityAlias, record, ctx) {
  const { organizationId, userId, locationMap, categoryMap } = ctx;

  const base = {
    organization_id: organizationId,
    user_id: userId,
  };

  const { cancellationReasonMap } = ctx;

  switch (entityAlias) {
    case 'appointments':
    case 'appointments_current_month':
    case 'appointments_dna':
      return transformAppointment(record, base, locationMap, cancellationReasonMap);
    case 'practitioners':
      return transformPractitioner(record, base, locationMap);
    case 'payment_plans':
      return transformPaymentPlan(record, base, locationMap);
    case 'treatment_plans':
      return transformTreatmentPlan(record, base, locationMap);
    case 'treatment_plan_items':
      return transformTreatmentPlanItem(record, base, locationMap);
    case 'treatment_appointments':
      return transformTreatmentAppointment(record, base, locationMap);
    case 'sundries':
      return transformSundry(record, base);
    case 'treatments':
      return transformTreatment(record, base, categoryMap);
    case 'appointment_cancellation_reasons':
      return transformAppointmentCancellationReason(record, base);
    case 'treatment_category':
      return transformTreatmentCategory(record, base);
    case 'locations':
      return transformLocation(record, base);
    case 'patients':
      return transformPatient(record, base, locationMap);
    case 'payments':
      return transformPayment(record, base, locationMap);
    case 'sundries':
      return transformPayment(record, base, locationMap);
    case 'invoices':
      return transformInvoice(record, base, locationMap);
    case 'nhs_claims':
      return transformNhsClaim(record, base, locationMap);
    case 'accounts':
      return transformAccount(record, base, locationMap);
    default:
      console.warn(`No transformation defined for entity: ${entityAlias}`);
      return null;
  }
}

function transformAppointment(record, base, locationMap, cancellationReasonMap) {
  // Resolve cancellation reason name from the map (acr_id -> acr_name)
  let cancellationReasonName = null;
  if (record.appointment_cancellation_reason_id && cancellationReasonMap && cancellationReasonMap.size > 0) {
    cancellationReasonName = cancellationReasonMap.get(String(record.appointment_cancellation_reason_id)) || null;
  }

  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id || record.practitioner_site_id, locationMap, 'appointments')
               || locationMap.get('__default__') || null,
    apmt_unique_id: record.uuid || null,
    apmt_id: record.id || null,
    apmt_practitioner_id: record.practitioner_id || null,
    apmt_practitioner_name: truncate(record.practitioner_name, 255),
    apmt_practitioner_site_id: record.practitioner_site_id || null,
    apmt_user_id: record.user_id || null,
    apmt_arrived_at: record.arrived_at || null,
    apmt_cancelled_at: record.cancelled_at || null,
    apmt_completed_at: record.completed_at || null,
    apmt_confirmed_at: record.confirmed_at || null,
    apmt_created_at: record.created_at || null,
    apmt_duration: record.duration || null,
    apmt_finish_time: record.finish_time || null,
    apmt_in_surgery_at: record.in_surgery_at || null,
    apmt_patient_id: record.patient_id || null,
    apmt_patient_image_url: record.patient_image_url || null,
    apmt_patient_name: truncate(record.patient_name, 255),
    apmt_payment_plan_id: record.payment_plan_id || null,
    apmt_pending_at: record.pending_at || null,
    apmt_reason: truncate(record.reason, 255),
    apmt_start_time: record.start_time || null,
    apmt_state: truncate(record.state, 50),
    apmt_treatment_description: record.treatment_description || null,
    apmt_booked_via_api: record.booked_via_api || false,
    apmt_updated_at: record.updated_at || null,
    apmt_appointment_cancellation_reason_id: parseBigInt(record.appointment_cancellation_reason_id),
    apmt_cancellation_reason_name: cancellationReasonName,
    apmt_did_not_attend_at: record.did_not_attend_at || null,
    apmt_notes: record.notes || null,
  };
}

function transformPractitioner(record, base, locationMap) {
  const firstName = record.user?.first_name || '';
  const lastName = record.user?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim() || 'Provider';

  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'practitioners'),
    external_id: record.id || null,
    dentally_uuid: record.uuid || null,
    name: fullName,
    email: record.user?.email || null,
    phone: record.user?.mobile_phone || null,
    photo_url: record.user?.image_url || null,
    is_active: record.active !== false,
    gdc_number: record.gdc_number || null,
    nhs_number: record.nhs_number || null,
    uda_target: record.uda_target || null,
    uoa_target: record.uoa_target || null,
    provider_role: record.user?.role || null,
    joining_date: record.user?.created_at || record.created_at || null,
    revenue: 0,
    patients: 0,
    avg_rev_per_patient: 0,
    utilisation: 0,
    trend: 0,
  };
}

function transformPaymentPlan(record, base, locationMap) {
  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'payment_plans'),
    pp_id: record.id,
    pp_name: record.name,
    pp_is_active: record.active,
    pp_dentist_recall_interval: record.dentist_recall_interval,
    pp_emergency_duration: record.emergency_duration,
    pp_exam_appointments_included: record.exam_appointments_included,
    pp_exam_duration: record.exam_duration,
    pp_exam_scale_and_polish_duration: record.exam_scale_and_polish_duration,
    pp_hygiene_appointments_included: record.hygiene_appointments_included,
    pp_hygienist_recall_interval: record.hygienist_recall_interval,
    pp_monthly_memberhsip_fee: parseFloat(record.monthly_memberhsip_fee || '0'),
    pp_patient_friendly_name: record.patient_friendly_name,
    pp_recall_method: record.recall_method,
    pp_scale_and_polish_duration: record.scale_and_polish_duration,
    pp_colour: record.colour,
    pp_site_id: mapSiteIdToLocationId(record.site_id, locationMap, 'payment_plans_site'),
    pp_created_at: record.created_at,
  };
}

function transformTreatmentPlan(record, base, locationMap) {
  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'treatment_plans'),
    tp_id: parseBigInt(record.id),
    tp_nickname: record.nickname || null,
    tp_patient_id: parseBigInt(record.patient_id),
    tp_practitioner_id: parseBigInt(record.practitioner_id),
    tp_private_treatment_value: record.private_treatment_value || null,
    tp_start_date: record.start_date || null,
    tp_completed_at: record.completed_at || null,
    tp_is_completed: record.completed_at ? true : false,
    tp_end_date: record.end_date || null,
    tp_last_completed_at: record.last_completed_at || null,
    tp_created_at: record.created_at || null,
    tp_updated_at: record.updated_at || null,
  };
}

function transformTreatmentPlanItem(record, base, locationMap) {
  // Dentally API does NOT return site_id for TPIs — it's always null.
  // location_id is resolved post-sync from the appointment chain (processor.js / backfill).
  // Only include location_id if Dentally actually provides site_id; otherwise omit it
  // so the upsert doesn't overwrite a previously resolved value back to NULL.
  const resolvedLocId = mapSiteIdToLocationId(record.site_id, locationMap, 'treatment_plan_items');
  const result = {
    ...base,
    tpi_id: parseBigInt(record.id),
    tpi_charged: record.charged || false,
    tpi_completed_at: record.completed_at || null,
    tpi_completed: record.completed || false,
    tpi_invoice_id: parseBigInt(record.invoice_id),
    tpi_patient_id: parseBigInt(record.patient_id),
    tpi_patient_nomenclature: record.patient_nomenclature || null,
    tpi_payment_plan_id: parseBigInt(record.payment_plan_id),
    tpi_practitioner_id: parseBigInt(record.practitioner_id),
    tpi_price: record.price ? parseFloat(record.price.toString()) : null,
    tpi_treatment_appointment_id: parseBigInt(record.treatment_appointment_id),
    tpi_treatment_plan_id: parseBigInt(record.treatment_plan_id),
    tpi_treatment_id: parseBigInt(record.treatment_id),
    tpi_updated_at: record.updated_at || null,
    duration: record.duration ? parseInt(record.duration.toString(), 10) : null,
    tpi_created_at: record.created_at || null,
  };
  if (resolvedLocId) {
    result.location_id = resolvedLocId;
  }
  return result;
}

function transformTreatmentAppointment(record, base, locationMap) {
  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'treatment_appointments'),
    ta_id: parseBigInt(record.id),
    ta_appointment_id: parseBigInt(record.appointment_id),
    ta_bookable: record.bookable || false,
    ta_patient_id: parseBigInt(record.patient_id),
    ta_treatment_plan_id: parseBigInt(record.treatment_plan_id),
    ta_created_at: record.created_at || null,
    ta_updated_at: record.updated_at || null,
  };
}

function transformSundry(record, base) {
  return {
    ...base,
    external_id: record.id || null,
    name: record.name || record.description || 'Sundry',
    cost: record.cost != null ? parseFloat(record.cost) : 0,
    is_active: record.active !== false,
  };
}

function transformTreatment(record, base, categoryMap) {
  let categoryId = null;
  if (record.treatment_category_id && categoryMap && categoryMap.size > 0) {
    // Try both number and string key for type-safe lookup
    const mapped = categoryMap.get(record.treatment_category_id)
      || categoryMap.get(Number(record.treatment_category_id))
      || categoryMap.get(String(record.treatment_category_id));
    if (mapped) {
      categoryId = mapped;
    }
  }

  return {
    ...base,
    external_id: record.id || null,
    category_id: categoryId,
    treatment_name: record.nomenclature || record.description || record.patient_nomenclature || 'Treatment',
    treatment_code: record.code || null,
    description: record.description || record.patient_description || null,
    treatment_type: record.nhs_treatment_cat ? 'nhs' : 'private',
    price: 0,
    nhs_band: mapNhsBand(record.uda_band),
    is_active: record.active !== false,
    insurance_classification: record.insurance_classification || null,
    nhs_treatment_cat: record.nhs_treatment_cat || null,
    nomenclature: record.nomenclature || null,
    owner: record.owner || null,
    patient_description: record.patient_description || null,
    patient_nomenclature: record.patient_nomenclature || null,
    region: record.region || null,
    uda_band: record.uda_band || null,
  };
}

function transformAppointmentCancellationReason(record, base) {
  return {
    ...base,
    acr_id: record.id ? String(record.id) : null,
    acr_name: record.reason || 'Unknown Reason',
    acr_is_active: record.archived === true ? false : true,
    acr_reason_type: record.reason_type || null,
    acr_created_at: record.created_at || null,
    acr_updated_at: record.updated_at || null,
  };
}

function transformTreatmentCategory(record, base) {
  return {
    ...base,
    external_id: record.id || null,
    name: record.name || 'Unknown Category',
    description: record.description || null,
    display_order: record.display_order || 0,
  };
}

function transformLocation(record, base) {
  const siteId = record.id ? String(record.id) : null;

  // Dentally's opening_hours is keyed by day name (Monday/Tuesday/...) with
  // { open: "09:00", close: "17:00" }. Normalise to lowercase keys so the
  // Postgres get_chair_metrics function can look them up consistently.
  // Only include days where open/close are present and non-empty.
  let operatingHours = null;
  if (record.opening_hours && typeof record.opening_hours === 'object') {
    const out = {};
    for (const key of Object.keys(record.opening_hours)) {
      const h = record.opening_hours[key];
      if (h && h.open && h.close) {
        out[key.toLowerCase()] = { open: h.open, close: h.close };
      }
    }
    if (Object.keys(out).length > 0) operatingHours = out;
  }

  return {
    ...base,
    api_record_unique_id: siteId,
    location_name: record.name || record.nickname || 'Practice Location',
    location_code: record.nickname || null,
    address_line1: record.address_line_1 || null,
    address_line2: record.address_line_2 || null,
    city: record.town || null,
    state: record.county || null,
    postal_code: record.postcode || null,
    phone: truncate(record.phone_number, 20),
    email: truncate(record.email_address, 255),
    logo_url: record.logo_url || null,
    is_active: record.active !== false,
    is_primary: false,
    notes: record.website ? `Website: ${record.website}` : null,
    operating_hours: operatingHours,
  };
}

function transformPatient(record, base, locationMap) {
  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'patients'),
    pt_unique_id: parseUuid(record.uuid),
    pt_id: parseBigInt(record.id),
    pt_account_id: record.account_id ? String(record.account_id) : null,
    pt_legacy_id: record.legacy_id != null ? String(record.legacy_id) : null,
    is_active: record.active !== false,
    pt_title: truncate(record.title, 50),
    pt_first_name: truncate(record.first_name, 255),
    pt_middle_name: truncate(record.middle_name, 255),
    pt_last_name: truncate(record.last_name, 255),
    pt_site_id: parseUuid(record.site_id),
    pt_address_line_1: truncate(record.address_line_1, 255),
    pt_address_line_2: truncate(record.address_line_2, 255),
    pt_address_line_3: truncate(record.address_line_3, 255),
    pt_county: truncate(record.county, 255),
    pt_dob: record.date_of_birth || null,
    pt_dentist_id: parseBigInt(record.dentist_id),
    pt_dentist_recall_date: record.dentist_recall_date || null,
    pt_dentist_recall_interval: record.dentist_recall_interval || null,
    pt_hygienist_recall_date: record.hygienist_recall_date || null,
    pt_hygienist_recall_interval: record.hygienist_recall_interval || null,
    pt_recall_method: truncate(record.recall_method, 50),
    pt_doctor_id: parseBigInt(record.doctor_id),
    pt_email: truncate(record.email, 255),
    pt_family_id: parseBigInt(record.family_id),
    pt_gender: truncate(record.gender, 50),
    pt_image_url: record.image_url || null,
    pt_is_student: record.is_student || false,
    pt_mobile_phone: truncate(record.mobile_phone, 50),
    pt_payment_plan_id: parseBigInt(record.payment_plan_id),
    pt_payment_plan_subscription_id: record.payment_plan_subscription_id ? String(record.payment_plan_subscription_id) : null,
    pt_payment_plan_subscription_status: truncate(record.payment_plan_subscription_status, 100),
    pt_postcode: truncate(record.postcode, 20),
    pt_region: truncate(record.region, 255),
    pt_town: truncate(record.town, 255),
    pt_created_at: record.created_at || null,
    pt_updated_at: record.updated_at || null,
  };
}

function transformPayment(record, base, locationMap) {
  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'payments'),
    dp_id: parseBigInt(record.id),
    dp_account_id: parseBigInt(record.account_id),
    dp_amount: record.amount ? parseFloat(record.amount) : null,
    dp_amount_unexplained: record.amount_unexplained ? parseFloat(record.amount_unexplained) : null,
    dp_dated_on: record.dated_on || null,
    dp_deleted: record.deleted || false,
    dp_fully_explained: record.fully_explained || false,
    dp_method: truncate(record.method, 100),
    dp_patient_id: parseBigInt(record.patient_id),
    dp_payment_plan_id: parseBigInt(record.payment_plan_id),
    dp_practitioner_id: parseBigInt(record.practitioner_id),
    dp_reference: truncate(record.reference, 255),
    dp_site_id: record.site_id || null,
    dp_status: truncate(record.status, 50),
    dp_transaction_number: truncate(record.transaction_number, 255),
    dp_user_id: parseBigInt(record.user_id),
    _explanations: record.explanations || [],
  };
}

/**
 * Resolve the invoice's deep-link UUID (used by Dentally app URLs:
 * /patients/{uuid}/account/{uuid}/invoices/{INVOICE_UUID}).
 *
 * The invoice object exposes only a numeric `id`, and `invoice_items[].invoice_id`
 * is also numeric — verified against the live /v1/invoices and /v1/invoice_items
 * endpoints. The only invoice-related UUID the API returns is the line item's
 * own `id` (an "invoiced item" UUID). Dentally's web app opens the invoice via
 * that UUID, so we use the first line item's `id` as the invoice's deep-link uuid.
 */
function resolveInvoiceUuid(record) {
  for (const item of (record.invoice_items || [])) {
    const id = parseUuid(item.id);
    if (id) return id;
  }
  return null;
}

function transformInvoice(record, base, locationMap) {
  return {
    ...base,
    platform_type: 'dentally',
    platform_invoice_id: String(record.id),
    // Invoice UUID for Dentally deep links. Sourced from the line items
    // (the invoice object only has a numeric id) — see resolveInvoiceUuid.
    invoice_uuid: resolveInvoiceUuid(record),
    invoice_number: String(record.id),
    reference: record.reference || null,
    invoice_date: record.dated_on || null,
    due_date: record.due_on || null,
    paid_date: record.paid_on || null,
    sent_at: record.sent_at || null,
    status: record.paid ? 'paid' : (record.sent_at ? 'sent' : 'draft'),
    is_paid: record.paid || false,
    currency: 'GBP',
    subtotal: record.amount ? parseFloat(record.amount) : null,
    amount_outstanding: record.amount_outstanding ? parseFloat(record.amount_outstanding) : null,
    nhs_amount: record.nhs_amount ? parseFloat(record.nhs_amount) : null,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'invoices'),
    patient_id: record.patient_id || null,
    account_id: record.account_id || null,
    site_id: record.site_id || null,
    payment_terms: record.payment_terms || null,
    footnote: record.footnote || null,
    invoice_user_id: record.user_id || null,
    api_record_created_at: record.created_at || null,
    api_record_updated_at: record.updated_at || null,
    _invoice_items: record.invoice_items || [],
  };
}

function transformNhsClaim(record, base, locationMap) {
  return {
    ...base,
    location_id: mapSiteIdToLocationId(record.site_id, locationMap, 'nhs_claims'),
    // The /v1/nhs_claims `id` is a UUID, so it can't go in the BIGINT nc_id
    // column — store it in nc_uuid. Dedupe/upsert keys on nc_sequence_number
    // (the NHS reference number) instead; see config.js onConflict.
    nc_uuid: parseUuid(record.id),
    nc_id: null,
    nc_claim_status: record.claim_status || null,
    nc_sequence_number: record.sequence_number || null,
    nc_approval_date: record.approval_date || null,
    nc_submitted_date: record.submitted_date || null,
    nc_awarded_uda: record.awarded_uda != null ? parseFloat(String(record.awarded_uda)) : null,
    nc_expected_uda: record.expected_uda != null ? parseFloat(String(record.expected_uda)) : null,
    nc_uda_band: record.uda_band || null,
    nc_dentist_charge: record.dentist_charge != null ? parseFloat(String(record.dentist_charge)) : null,
    nc_patient_charge: record.patient_charge != null ? parseFloat(String(record.patient_charge)) : null,
    nc_patient_id: parseBigInt(record.patient_id),
    nc_practitioner_id: parseBigInt(record.practitioner_id),
    nc_treatment_plan_id: parseBigInt(record.treatment_plan_id),
    nc_site_id: record.site_id || null,
    nc_contract_id: parseBigInt(record.contract_id),
    nc_ortho: record.ortho || false,
    nc_continuation_part_number: record.continuation_part_number || null,
    nc_status_comments: record.status_comments || null,
    nc_ni_dentist_fee: record.ni_calculated_dentist_fee != null ? parseFloat(String(record.ni_calculated_dentist_fee)) : null,
    nc_ni_patient_fee: record.ni_calculated_patient_fee != null ? parseFloat(String(record.ni_calculated_patient_fee)) : null,
    nc_scot_amount_authorised: record.scot_amount_authorised != null ? parseFloat(String(record.scot_amount_authorised)) : null,
    nc_scot_amount_expected: record.scot_amount_expected != null ? parseFloat(String(record.scot_amount_expected)) : null,
    nc_created_at: record.created_at || null,
    nc_updated_at: record.updated_at || null,
    nc_nhs_updated_at: record.nhs_updated_at || null,
  };
}

function transformAccount(record, base, locationMap) {
  // Dentally /v1/accounts does NOT return site_id — accounts are per-patient.
  // location_id is left null and resolved post-sync from the patient's location
  // (similar to how treatment_plan_items has its location resolved post-sync).
  return {
    ...base,
    da_id: parseBigInt(record.id),
    // Dentally returns a `uuid` alongside numeric `id` on most entities
    // (patients, appointments, etc). Stored for building Dentally deep links.
    da_uuid: parseUuid(record.uuid),
    da_patient_id: parseBigInt(record.patient_id),
    da_patient_name: truncate(record.patient_name, 510),
    da_current_balance: record.current_balance != null ? parseFloat(String(record.current_balance)) : null,
    da_opening_balance: record.opening_balance != null ? parseFloat(String(record.opening_balance)) : null,
    da_planned_nhs_treatment_value: record.planned_nhs_treatment_value != null
      ? parseFloat(String(record.planned_nhs_treatment_value)) : null,
    da_planned_private_treatment_value: record.planned_private_treatment_value != null
      ? parseFloat(String(record.planned_private_treatment_value)) : null,
  };
}

module.exports = { transformRecord };
