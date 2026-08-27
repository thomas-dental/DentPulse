/**
 * Dev inspector overview — status, PAT, row counts for a practice.
 */

const { supabaseAdmin } = require('../../../config/supabase');
const {
  SCHEDULED_RESOURCE_TYPES,
  getSyncStatusByPractice,
} = require('./cursorStore');
const { getPracticePatValidity } = require('./credentialsStatus');

/** UI resource rows (invoice_items shares invoices cursor). */
const INSPECTOR_RESOURCES = [
  'acquisition_sources',
  'practitioners',
  'patients',
  'accounts',
  'recalls',
  'appointments',
  'treatment_appointments',
  'treatment_plans',
  'treatment_items',
  'invoices',
  'invoice_items',
  'payments',
];

/** Patients with at least one recall field set (shared with browse filter). */
const RECALL_ROWS_OR =
  'pt_dentist_recall_date.not.is.null,pt_hygienist_recall_date.not.is.null,pt_recall_method.not.is.null';

const COUNT_SPECS = [
  { key: 'acquisition_sources', table: 'acquisition_sources' },
  { key: 'practitioners', table: 'providers' },
  { key: 'patients', table: 'patients' },
  { key: 'accounts', table: 'dentally_patients_accounts' },
  {
    key: 'recalls',
    table: 'patients',
    note: 'recall rows (filtered patients)',
    orFilter: RECALL_ROWS_OR,
  },
  { key: 'appointments', table: 'appointments' },
  { key: 'treatment_appointments', table: 'treatment_appointments' },
  { key: 'treatment_plans', table: 'treatment_plans' },
  { key: 'treatment_items', table: 'treatment_plan_items' },
  { key: 'invoices', table: 'platform_integration_invoices' },
  { key: 'invoice_items', table: 'platform_integration_invoice_line_items' },
  { key: 'payments', table: 'dentally_payments' },
  { key: 'payment_explanations', table: 'dentally_payment_explanations' },
  { key: 'membership', table: 'membership_upload_members' },
];

async function countTable(table, practiceId, orFilter = null) {
  let query = supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', practiceId);
  if (orFilter) {
    query = query.or(orFilter);
  }
  const { count, error } = await query;
  if (error) {
    return { count: null, error: error.message };
  }
  return { count: count ?? 0, error: null };
}

function resolvePatDisplay(validity) {
  if (!validity.ok) {
    if (validity.reason === 'no_credential') {
      return { status: 'not_connected', label: 'Not connected', validatedAt: null };
    }
    if (validity.reason === 'needs_reconnection') {
      return {
        status: 'invalid',
        label: 'Token invalid',
        validatedAt: validity.row?.validated_at || null,
      };
    }
    if (validity.reason === 'not_validated') {
      return {
        status: 'not_validated',
        label: 'Not yet validated',
        validatedAt: null,
      };
    }
    return { status: 'invalid', label: 'Invalid', validatedAt: null };
  }
  return {
    status: 'connected',
    label: 'Connected',
    validatedAt: validity.row?.validated_at || null,
  };
}

async function getDevCounts(practiceId) {
  const counts = {};
  await Promise.all(
    COUNT_SPECS.map(async (spec) => {
      const result = await countTable(spec.table, practiceId, spec.orFilter || null);
      counts[spec.key] = {
        table: spec.table,
        count: result.count,
        error: result.error,
        note: spec.note || null,
      };
    })
  );
  return { practiceId, counts };
}

async function getDevOverview(practiceId) {
  const [validity, cursorRows] = await Promise.all([
    getPracticePatValidity(practiceId),
    getSyncStatusByPractice(practiceId),
  ]);

  const byType = new Map(cursorRows.map((r) => [r.resourceType, r]));

  const resources = INSPECTOR_RESOURCES.map((resourceType) => {
    const cursorKey = resourceType === 'invoice_items' ? 'invoices' : resourceType;
    const row = byType.get(cursorKey);
    if (!row) {
      return {
        resourceType,
        status: 'never_run',
        updatedAt: null,
        lastIncrementalCompletedAt: null,
        lastFullCompletedAt: null,
        lastError: null,
        lastErrorCode: null,
        cursorAliasOf: resourceType === 'invoice_items' ? 'invoices' : null,
      };
    }
    return {
      resourceType,
      status: row.status,
      updatedAt: row.updatedAt,
      lastIncrementalCompletedAt: row.lastIncrementalCompletedAt,
      lastFullCompletedAt: row.lastFullCompletedAt,
      lastError: row.lastError,
      lastErrorCode: row.lastErrorCode,
      page: row.page,
      chunkStart: row.chunkStart,
      chunkEnd: row.chunkEnd,
      kickoffMode: row.kickoffMode,
      cursorAliasOf: resourceType === 'invoice_items' ? 'invoices' : null,
    };
  });

  return {
    practiceId,
    pat: resolvePatDisplay(validity),
    resources,
    scheduledResourceTypes: SCHEDULED_RESOURCE_TYPES,
  };
}

/** Full overview including counts (single round-trip). */
async function getDevOverviewWithCounts(practiceId) {
  const [overview, { counts }] = await Promise.all([
    getDevOverview(practiceId),
    getDevCounts(practiceId),
  ]);
  return { ...overview, counts };
}

/** Browse configs — same tables/columns as the inspector UI. */
const BROWSE_SPECS = {
  practitioners: {
    table: 'providers',
    columns: ['external_id', 'name', 'email', 'is_active', 'location_id', 'provider_role'],
    order: 'external_id',
  },
  patients: {
    table: 'patients',
    columns: [
      'pt_id',
      'pt_unique_id',
      'pt_first_name',
      'pt_last_name',
      'pt_acquisition_source_name',
      'pt_acquisition_source_id',
    ],
    order: 'pt_id',
  },
  recalls: {
    table: 'patients',
    columns: [
      'pt_id',
      'pt_first_name',
      'pt_last_name',
      'pt_dentist_recall_date',
      'pt_dentist_recall_interval',
      'pt_hygienist_recall_date',
      'pt_hygienist_recall_interval',
      'pt_recall_method',
    ],
    order: 'pt_dentist_recall_date',
    orFilter: RECALL_ROWS_OR,
  },
  accounts: {
    table: 'dentally_patients_accounts',
    columns: [
      'da_id',
      'da_patient_id',
      'da_patient_name',
      'da_current_balance',
      'da_opening_balance',
    ],
    order: 'da_id',
  },
  appointments: {
    table: 'appointments',
    columns: [
      'apmt_id',
      'apmt_start_time',
      'apmt_patient_id',
      'apmt_patient_name',
      'apmt_state',
      'apmt_reason',
    ],
    order: 'apmt_start_time',
  },
  treatment_appointments: {
    table: 'treatment_appointments',
    columns: [
      'ta_id',
      'ta_patient_id',
      'ta_appointment_id',
      'ta_treatment_plan_id',
      'ta_bookable',
      'ta_updated_at',
    ],
    order: 'ta_id',
  },
  treatment_plans: {
    table: 'treatment_plans',
    columns: [
      'tp_id',
      'tp_patient_id',
      'tp_nickname',
      'tp_private_treatment_value',
      'tp_start_date',
      'tp_completed_at',
      'tp_is_completed',
    ],
    order: 'tp_id',
  },
  treatment_items: {
    table: 'treatment_plan_items',
    columns: [
      'tpi_id',
      'tpi_patient_id',
      'tpi_treatment_plan_id',
      'tpi_price',
      'tpi_charged',
      'tpi_completed',
      'tpi_completed_at',
    ],
    order: 'tpi_id',
  },
  invoices: {
    table: 'platform_integration_invoices',
    columns: [
      'id',
      'platform_invoice_id',
      'patient_id',
      'account_id',
      'total',
      'subtotal',
      'nhs_amount',
      'invoice_date',
      'is_paid',
    ],
    order: 'invoice_date',
  },
  invoice_items: {
    table: 'platform_integration_invoice_line_items',
    columns: [
      'id',
      'invoice_id',
      'dentally_invoice_id',
      'practitioner_id',
      'treatment_plan_item_id',
      'description',
      'line_amount',
      'is_nhs',
      'gross',
      'net',
    ],
    order: 'created_at',
  },
  payments: {
    table: 'dentally_payments',
    columns: [
      'dp_id',
      'dp_patient_id',
      'dp_account_id',
      'dp_amount',
      'dp_dated_on',
      'dp_status',
      'dp_method',
    ],
    order: 'dp_dated_on',
  },
};

/**
 * Paginated browse of synced rows (service-role) — same data onboarding wrote.
 * @returns {Promise<{ resource: string, rows: object[], total: number|null, page: number, pageSize: number }>}
 */
async function browseDevRows(practiceId, resource, page = 0, pageSize = 25) {
  const spec = BROWSE_SPECS[resource];
  if (!spec) {
    throw Object.assign(new Error(`Unknown browse resource: ${resource}`), { status: 400 });
  }

  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const pageNum = Math.max(Number(page) || 0, 0);
  const from = pageNum * size;
  const to = from + size - 1;

  let query = supabaseAdmin
    .from(spec.table)
    .select(spec.columns.join(','), { count: 'exact' })
    .eq('organization_id', practiceId)
    .range(from, to);

  if (spec.orFilter) {
    query = query.or(spec.orFilter);
  }
  if (spec.order) {
    query = query.order(spec.order, { ascending: false, nullsFirst: false });
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return {
    resource,
    rows: data || [],
    total: count ?? null,
    page: pageNum,
    pageSize: size,
  };
}

module.exports = {
  INSPECTOR_RESOURCES,
  COUNT_SPECS,
  BROWSE_SPECS,
  RECALL_ROWS_OR,
  getDevCounts,
  getDevOverview,
  getDevOverviewWithCounts,
  browseDevRows,
};
