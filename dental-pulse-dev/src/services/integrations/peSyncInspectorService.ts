import { supabase } from '@/integrations/supabase/client';

function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    const isLocal = h === 'localhost' || h.startsWith('127.');
    const isLAN = h.startsWith('192.168.') || h.startsWith('10.');
    return (
      import.meta.env.VITE_BACKEND_URL ||
      import.meta.env.VITE_SYNC_BACKEND_URL ||
      (isLocal ? 'http://localhost:4000' : isLAN ? '' : 'https://dent-enterprise-api.dentpulse.com')
    );
  }
  return 'http://localhost:4000';
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
    error,
  } = await supabase.auth.refreshSession();
  if (error || !session) {
    const {
      data: { session: cached },
    } = await supabase.auth.getSession();
    if (!cached) throw new Error('No active session');
    return {
      Authorization: `Bearer ${cached.access_token}`,
      'Content-Type': 'application/json',
    };
  }
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

export type PeRowCounts = Record<
  string,
  { table: string; count: number | null; error: string | null; note: string | null }
>;

export type PeDevOverview = {
  practiceId: string;
  pat: {
    status: string;
    label: string;
    validatedAt: string | null;
  };
  resources: Array<{
    resourceType: string;
    status: string;
    updatedAt: string | null;
    lastIncrementalCompletedAt: string | null;
    lastFullCompletedAt: string | null;
    lastError: string | null;
    lastErrorCode: string | null;
    page?: number;
    chunkStart?: string | null;
    chunkEnd?: string | null;
    kickoffMode?: string | null;
    cursorAliasOf?: string | null;
  }>;
};

export type PeTick = {
  at: string;
  kind: string;
  practicesConsidered?: number;
  kicked?: number;
  skipped?: number;
  processed?: number;
  results?: Array<Record<string, unknown>>;
};

export const BROWSE_RESOURCES = [
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
] as const;

export type BrowseResource = (typeof BROWSE_RESOURCES)[number];

export const BROWSE_CONFIG: Record<
  BrowseResource,
  { table: string; columns: string[]; order?: string; orFilter?: string }
> = {
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
    // Must match peDevOverview RECALL_ROWS_OR
    orFilter:
      'pt_dentist_recall_date.not.is.null,pt_hygienist_recall_date.not.is.null,pt_recall_method.not.is.null',
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
      'platform_invoice_id',
      'patient_id',
      'account_id',
      'subtotal',
      'amount_outstanding',
      'status',
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
      'treatment_plan_item_id',
      'description',
      'line_amount',
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

export const TRIGGER_PATH: Record<string, string> = {
  acquisition_sources: '/sync/acquisition-sources',
  patients: '/sync/patients',
  accounts: '/sync/accounts',
  recalls: '/sync/recalls',
  appointments: '/sync/appointments',
  treatment_appointments: '/sync/treatment-appointments',
  treatment_plans: '/sync/treatment-plans',
  treatment_items: '/sync/treatment-items',
  invoices: '/sync/invoices',
  invoice_items: '/sync/invoices',
  payments: '/sync/payments',
};

export async function fetchPeDevCounts(practiceId: string): Promise<PeRowCounts> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/sync/dev/counts?practiceId=${encodeURIComponent(practiceId)}`,
    { headers }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Counts failed (${res.status})`);
  }
  return (body.counts || {}) as PeRowCounts;
}

export async function fetchPeDevOverview(practiceId: string): Promise<PeDevOverview> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/sync/dev/overview?practiceId=${encodeURIComponent(practiceId)}`,
    { headers }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Overview failed (${res.status})`);
  }
  return body as PeDevOverview;
}

export async function fetchPeDevTicks(): Promise<PeTick[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine/sync/dev/ticks`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Ticks failed (${res.status})`);
  }
  return (body.ticks || []) as PeTick[];
}

export async function triggerPeSyncChunk(
  practiceId: string,
  resourceType: string
): Promise<Record<string, unknown>> {
  const path = TRIGGER_PATH[resourceType];
  if (!path) throw new Error(`No trigger path for ${resourceType}`);
  const headers = await getAuthHeaders();
  const res = await fetch(`${getBackendUrl()}/api/economics-engine${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ practiceId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && body.success === false) {
    throw new Error(body.error || `Trigger failed (${res.status})`);
  }
  return body;
}

export async function browsePeRows(
  practiceId: string,
  resource: BrowseResource,
  page: number,
  pageSize = 25
): Promise<{ rows: Record<string, unknown>[]; total: number | null }> {
  const headers = await getAuthHeaders();
  const qs = new URLSearchParams({
    practiceId,
    resource,
    page: String(page),
    pageSize: String(pageSize),
  });
  const res = await fetch(
    `${getBackendUrl()}/api/economics-engine/sync/dev/browse?${qs}`,
    { headers }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(body.error || `Browse failed (${res.status})`);
  }
  return {
    rows: (body.rows || []) as Record<string, unknown>[],
    total: body.total ?? null,
  };
}
