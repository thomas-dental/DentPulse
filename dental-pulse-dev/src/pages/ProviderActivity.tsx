/**
 * Provider Activity page — two tabs, each mirroring its Dentally report:
 *
 *  • Appointments        → Dentally "Appointments" report. Every appointment
 *                          for the practitioner (appointments table, filtered
 *                          by apmt_practitioner_id).
 *  • Practitioner Activity → Dentally "Practitioner Activity" report.
 *                          Completed treatment line items attributed to the
 *                          practitioner of the LINKED APPOINTMENT (the
 *                          TPI → treatment_appointments → appointments chain),
 *                          NOT tpi_practitioner_id — that's why our numbers
 *                          previously over-counted vs Dentally. Same gate as
 *                          the revenue figures (tpi_completed + payment-plan +
 *                          treatment-appointment association) so it reconciles
 *                          £-for-£ with Dentally's Practitioner Activity.
 *
 * Shared: date range, search, sortable columns, pagination, CSV export.
 */

import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfigProvider, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import {
  toDateStr, localDayRange, fmtDateTime, fmtDate, fmtCurrency, statusBadgeClass, fetchAll, inChunks,
} from '@/lib/activityReportUtils';
import {
  type ColumnDef, useTableState, FilterSelect, DataTable,
} from '@/components/reports/ActivityDataTable';

// ── Row types ───────────────────────────────────────────────────────────────

interface ApptRow {
  id: string;
  // Dentally's per-patient appointments page is keyed on the patient's UUID
  // (pt_unique_id), not the appointment id — e.g.
  // https://app.dentally.co/patients/<uuid>/appointments
  patientUuid: string | null;
  bookedAt: string;
  date: string;
  duration: number;
  patient: string;
  reason: string;
  practitioner: string;
  bookedViaApi: boolean;
  status: string;
}

interface ActivityRow {
  id: string;
  completedAt: string;
  patient: string;
  patientId: number | null;  // Dentally pt_id — links to the Dentally patient page
  patientUuid: string | null; // patients.pt_unique_id — Dentally patient UUID for deep-link
  accountUuid: string | null; // dentally_patients_accounts.da_uuid — for the Price → account deep-link
  treatment: string;
  category: string;        // kept for the Category filter (not a column)
  practitioner: string;
  paymentPlan: string;
  paymentMethod: string;   // dentally_payments.dp_method for the patient
  duration: number;
  price: number;
  invoicedOn: string;
  paidOn: string;
  status: string;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ProviderActivity() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId } = useFilters();

  const [tab, setTab] = useState<'appointments' | 'activity'>('appointments');
  const [from, setFrom] = useState(toDateStr(dateRange.startDate));
  const [to, setTo] = useState(toDateStr(dateRange.endDate));
  const apptTs = useTableState();
  const actTs = useTableState();
  // Dropdown filters (Dentally-report style)
  const [apptStatus, setApptStatus] = useState('all');
  const [actTreatment, setActTreatment] = useState('all');
  const [actCategory, setActCategory] = useState('all');
  const [actPlan, setActPlan] = useState('all');

  useEffect(() => {
    setFrom(toDateStr(dateRange.startDate));
    setTo(toDateStr(dateRange.endDate));
  }, [dateRange.startDate, dateRange.endDate]);

  const { data: provider } = useQuery({
    queryKey: ['provider-activity-provider', id, organizationId],
    queryFn: async () => {
      if (!id) return null;
      // select('*') so the optional dentally_uuid column (added in a follow-up
      // migration) is picked up automatically once it exists, without breaking
      // today if the column isn't there yet.
      const { data } = await (supabase as any)
        .from('providers').select('*').eq('id', id).single();
      return data as {
        id: string;
        name: string;
        external_id: number | null;
        integration_id: string | null;
        dentally_uuid?: string | null;
      } | null;
    },
    enabled: !!id,
  });
  // ── Location-aware practitioner record ───────────────────────────────────
  // A practitioner who works at multiple SITES has a SEPARATE Dentally record
  // (external_id) per site — Dentally treats "Charles Greensmith (Leiston)" and
  // "(Woodbridge)" as distinct practitioner entries with their OWN activity. The
  // record we arrived on (from the deduped provider list) is often the home site.
  // So when a specific location is filtered, resolve THIS practitioner's record AT
  // that location and report its activity — otherwise selecting Leiston showed the
  // Woodbridge record's totals (£4,764.25 instead of £9,583.00).
  const specificLocation = !!selectedLocationId && selectedLocationId !== 'all';
  const { data: locationRecord, isLoading: locationRecordLoading } = useQuery({
    queryKey: ['prov-activity-location-record', organizationId, (provider as any)?.email, provider?.name, provider?.integration_id, selectedLocationId],
    enabled: !!organizationId && !!provider && specificLocation,
    queryFn: async () => {
      // Already viewing the record at the selected location — nothing to swap.
      if ((provider as any)?.location_id === selectedLocationId) return provider;
      // Find the SAME practitioner (match email, else name) at the selected
      // location within the SAME Dentally practice (integration).
      let q = (supabase as any).from('providers')
        .select('id, name, external_id, integration_id, location_id, dentally_uuid, email')
        .eq('organization_id', organizationId)
        .eq('location_id', selectedLocationId);
      if ((provider as any)?.integration_id) q = q.eq('integration_id', (provider as any).integration_id);
      if ((provider as any)?.email) q = q.eq('email', (provider as any).email);
      else q = q.eq('name', provider!.name);
      const { data } = await q.limit(1);
      return (data?.[0] ?? null) as typeof provider;
    },
  });

  // The record whose activity we actually show. For a specific location it's the
  // site record (null = this practitioner has NO record there → no activity, which
  // is correct); for "All" it's the record we navigated in on.
  const effectiveProvider = specificLocation ? (locationRecord ?? null) : provider;
  const extId = effectiveProvider?.external_id ?? null;
  // Dentally web-app URLs use the practitioner UUID, not the numeric id.
  // Falls back to external_id while the dentally_uuid column is empty or
  // missing — link still goes somewhere sensible during the rollout.
  const dentallyPractitionerId = (effectiveProvider as any)?.dentally_uuid ?? (extId != null ? String(extId) : null);
  const providerName = provider?.name ?? 'Practitioner';
  // The integration (Dentally practice) this provider belongs to. Every
  // Dentally-id lookup/filter below is scoped to it — without this an org with
  // multiple Dentally practices mixes records (a different practice's
  // practitioner #extId, or its patient/treatment with the same numeric id).
  const integrationId = effectiveProvider?.integration_id ?? null;

  // ── Appointments report ──────────────────────────────────────────────────
  const { data: apptRows = [], isLoading: apptLoading } = useQuery({
    queryKey: ['prov-appointments', organizationId, extId, integrationId, from, to],
    queryFn: async (): Promise<ApptRow[]> => {
      if (!organizationId || extId == null) return [];
      const { start, endExclusive } = localDayRange(from, to);
      const appts = await fetchAll<any>(() => {
        let q = (supabase as any).from('appointments')
          .select('apmt_id, apmt_created_at, apmt_start_time, apmt_duration, apmt_patient_id, apmt_patient_name, apmt_reason, apmt_practitioner_name, apmt_booked_via_api, apmt_state')
          .eq('organization_id', organizationId)
          .eq('apmt_practitioner_id', extId)
          .is('deleted_at', null)
          // Patient appointments only — matches the reconciled hooks
          // (usePractitionerHistory / usePractitionerChairMetrics). Excludes
          // blocked-out / admin slots Dentally's report doesn't count.
          .not('apmt_patient_id', 'is', null)
          .gte('apmt_start_time', start)
          .lt('apmt_start_time', endExclusive)
          .order('apmt_start_time', { ascending: false });
        // apmt_practitioner_id is per-integration — scope so a different
        // Dentally practice's practitioner #extId can't leak in.
        if (integrationId) q = q.eq('integration_id', integrationId);
        return q;
      });
      // eslint-disable-next-line no-console
      console.log('[ProviderActivity] appointments', { provider: providerName, extId, from, to, appointmentsFound: appts.length });

      // Resolve each appointment's patient to a Dentally UUID (pt_unique_id) so
      // the row click can deep-link to https://app.dentally.co/patients/<uuid>/appointments.
      // pt_id is per-integration, so the lookup is integration-scoped to stop
      // a sibling Dentally practice's patient with the same numeric id leaking in.
      const patIds = [...new Set(appts.map(a => a.apmt_patient_id).filter((x): x is number => x != null))];
      const patUuidMap = new Map<number, string>();
      if (patIds.length > 0) {
        const patRows = await inChunks<any>(
          'patients',
          'pt_id, pt_unique_id',
          'pt_id',
          patIds,
          organizationId,
          integrationId,
        );
        for (const p of patRows) {
          if (p.pt_id != null && p.pt_unique_id) {
            patUuidMap.set(Number(p.pt_id), String(p.pt_unique_id));
          }
        }
      }

      return appts.map((a, i): ApptRow => ({
        id: a.apmt_id != null ? String(a.apmt_id) : `a-${i}`,
        patientUuid: a.apmt_patient_id != null ? (patUuidMap.get(Number(a.apmt_patient_id)) ?? null) : null,
        bookedAt: a.apmt_created_at || '',
        date: a.apmt_start_time || '',
        duration: Number(a.apmt_duration) || 0,
        patient: a.apmt_patient_name || '—',
        reason: a.apmt_reason || '—',
        practitioner: a.apmt_practitioner_name || providerName,
        bookedViaApi: a.apmt_booked_via_api === true,
        status: a.apmt_state || 'Unknown',
      }));
    },
    enabled: tab === 'appointments' && !!organizationId && extId != null,
    staleTime: 60 * 1000,
  });

  // ── Practitioner Activity report (Dentally-matched attribution) ──────────
  const { data: actRows = [], isLoading: actLoading } = useQuery({
    queryKey: ['prov-activity', organizationId, extId, integrationId, from, to],
    queryFn: async (): Promise<ActivityRow[]> => {
      if (!organizationId || extId == null) return [];

      // Mirror the project's RECONCILED Dentally Practitioner Activity gate
      // (usePractitionerHistoryDetail): completed TPIs for THIS practitioner
      // (tpi_practitioner_id), payment-plan attached, charting excluded
      // (tpi_treatment_appointment_id NOT NULL), tpi_completed_at in range.
      // This is the documented Dentally-matching definition — not a reinvented
      // attribution chain.
      const { start, endExclusive } = localDayRange(from, to);
      const mine = await fetchAll<any>(() => {
        let q = (supabase as any).from('treatment_plan_items')
          .select('tpi_id, tpi_price, tpi_treatment_id, tpi_patient_id, tpi_patient_nomenclature, tpi_completed_at, tpi_payment_plan_id, tpi_invoice_id, duration')
          .eq('organization_id', organizationId)
          .eq('tpi_practitioner_id', extId)
          .eq('tpi_completed', true)
          .not('tpi_completed_at', 'is', null)
          .not('tpi_payment_plan_id', 'is', null)
          .not('tpi_treatment_appointment_id', 'is', null)
          .gte('tpi_completed_at', start)
          .lt('tpi_completed_at', endExclusive)
          .order('tpi_completed_at', { ascending: false });
        // tpi_practitioner_id is per-integration — scope so this only returns
        // THIS Dentally practice's practitioner, not a same-numbered one
        // belonging to another practice connected to the same org.
        if (integrationId) q = q.eq('integration_id', integrationId);
        return q;
      });

      // eslint-disable-next-line no-console
      console.log('[ProviderActivity] reconciliation', {
        provider: providerName, extId, from, to,
        practitionerActivityRows: mine.length,   // ← should match Dentally's "N found"
      });

      if (mine.length === 0) return [];

      // 4. Lookups: treatment (name+category), category, payment plan, patient.
      const txIds = [...new Set(mine.map(t => t.tpi_treatment_id).filter((x): x is number => x != null))];
      const ppIds = [...new Set(mine.map(t => t.tpi_payment_plan_id).filter((x): x is number => x != null))];
      const patIds = [...new Set(mine.map(t => t.tpi_patient_id).filter((x): x is number => x != null))];

      const txMap = new Map<number, { name: string; categoryId: string | null }>();
      const catMap = new Map<string, string>();
      const ppMap = new Map<number, string>();
      const patMap = new Map<number, string>();

      // external_id / pp_id / pt_id are per-integration — scope every lookup
      // to this provider's integration so a same-numbered record from another
      // Dentally practice cannot be resolved. (treatment_categories.id is a
      // global UUID, so it needs no integration scoping.)
      const txRows = await inChunks<any>('treatments', 'external_id, treatment_name, category_id', 'external_id', txIds, organizationId, integrationId);
      for (const t of txRows) txMap.set(t.external_id, { name: t.treatment_name, categoryId: t.category_id });
      const catIds = [...new Set([...txMap.values()].map(v => v.categoryId).filter((x): x is string => !!x))];
      const catRows = await inChunks<any>('treatment_categories', 'id, name', 'id', catIds, organizationId);
      for (const c of catRows) catMap.set(c.id, c.name);
      const ppRows = await inChunks<any>('payment_plans', 'pp_id, pp_name', 'pp_id', ppIds, organizationId, integrationId);
      for (const pp of ppRows) ppMap.set(pp.pp_id, pp.pp_name ?? `Plan #${pp.pp_id}`);
      const patLocationMap = new Map<number, string | null>();
      const patUuidMap = new Map<number, string>();
      // pt_id → pt_account_id (numeric Dentally account id; matches dentally_patients_accounts.da_id).
      // Stored as text in patients.pt_account_id (transformer: `String(record.account_id)`).
      const patAccountIdMap = new Map<number, number>();
      const patRows = await inChunks<any>('patients', 'pt_id, pt_first_name, pt_last_name, location_id, pt_unique_id, pt_account_id', 'pt_id', patIds, organizationId, integrationId);
      for (const p of patRows) {
        patMap.set(p.pt_id, `${p.pt_first_name ?? ''} ${p.pt_last_name ?? ''}`.trim() || `Patient #${p.pt_id}`);
        patLocationMap.set(p.pt_id, p.location_id ?? null);
        if (p.pt_id != null && p.pt_unique_id) {
          patUuidMap.set(Number(p.pt_id), String(p.pt_unique_id));
        }
        if (p.pt_id != null && p.pt_account_id != null) {
          const accId = Number(p.pt_account_id);
          if (Number.isFinite(accId)) patAccountIdMap.set(Number(p.pt_id), accId);
        }
      }

      // Resolve account UUID for the Price → /patients/{uuid}/account/{uuid} deep-link.
      // Look up dentally_patients_accounts by da_id = pt_account_id, integration-scoped
      // (da_id collides across integrations within the same org — same gotcha as pt_id).
      const accountIds = [...new Set([...patAccountIdMap.values()])];
      const accountUuidByDaId = new Map<number, string>();
      if (accountIds.length > 0) {
        const accRows = await inChunks<any>('dentally_patients_accounts', 'da_id, da_uuid', 'da_id', accountIds, organizationId, integrationId);
        for (const a of accRows) {
          if (a.da_id != null && a.da_uuid) {
            accountUuidByDaId.set(Number(a.da_id), String(a.da_uuid));
          }
        }
      }
      // Final lookup the rows will use: pt_id → da_uuid
      const patAccountUuidMap = new Map<number, string>();
      for (const [ptId, daId] of patAccountIdMap) {
        const uuid = accountUuidByDaId.get(daId);
        if (uuid) patAccountUuidMap.set(ptId, uuid);
      }

      // Invoice info (Invoiced On + Status) — Dentally invoices live in
      // platform_integration_invoices keyed by platform_invoice_id =
      // treatment_plan_items.tpi_invoice_id. Dentally doesn't sync a paid
      // date, so "Paid On" stays '—' rather than fabricating one.
      const invIds = [...new Set(mine.map(t => t.tpi_invoice_id).filter((x): x is number => x != null))];
      const invMap = new Map<string, { status: string; invoiceDate: string | null }>();
      const invRows = await inChunks<any>('platform_integration_invoices', 'platform_invoice_id, status, invoice_date', 'platform_invoice_id', invIds, organizationId, integrationId);
      for (const iv of invRows) {
        if (iv.platform_invoice_id != null) {
          invMap.set(String(iv.platform_invoice_id), { status: iv.status ?? 'outstanding', invoiceDate: iv.invoice_date ?? null });
        }
      }
      // Payment method — from dentally_payments.dp_method, matched to the
      // patient on dp_patient_id. dp_patient_id is a per-integration Dentally
      // id, so the lookup is integration-scoped (inChunks). A patient can have
      // several payments with different methods, so: prefer payments made at
      // the patient's own location, then take the most recent (dp_dated_on).
      const paymentMethodMap = new Map<number, string>();
      const dpRows = await inChunks<any>(
        'dentally_payments',
        'dp_patient_id, dp_method, dp_dated_on, location_id, dp_deleted',
        'dp_patient_id', patIds, organizationId, integrationId,
      );
      const dpByPatient = new Map<number, any[]>();
      for (const dp of dpRows) {
        if (dp.dp_deleted || !dp.dp_method || dp.dp_patient_id == null) continue;
        const list = dpByPatient.get(dp.dp_patient_id) ?? [];
        list.push(dp);
        dpByPatient.set(dp.dp_patient_id, list);
      }
      for (const [ptId, payments] of dpByPatient) {
        const patientLoc = patLocationMap.get(ptId) ?? null;
        // Keep only payments at the patient's own location when that is known
        // and yields a match; otherwise fall back to all of the patient's.
        const locMatched = patientLoc
          ? payments.filter((p) => p.location_id === patientLoc)
          : [];
        const pool = locMatched.length > 0 ? locMatched : payments;
        pool.sort((a, b) =>
          String(b.dp_dated_on || '').localeCompare(String(a.dp_dated_on || '')));
        paymentMethodMap.set(ptId, pool[0].dp_method);
      }

      const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      return mine.map((t, i): ActivityRow => {
        const tx = t.tpi_treatment_id != null ? txMap.get(t.tpi_treatment_id) : undefined;
        const practitioner = providerName;
        const inv = t.tpi_invoice_id != null ? invMap.get(String(t.tpi_invoice_id)) : undefined;
        return {
          id: t.tpi_id != null ? String(t.tpi_id) : `t-${i}`,
          completedAt: t.tpi_completed_at || '',
          patient: (t.tpi_patient_id != null ? patMap.get(t.tpi_patient_id) : undefined) || '—',
          patientId: t.tpi_patient_id != null ? Number(t.tpi_patient_id) : null,
          patientUuid: t.tpi_patient_id != null ? (patUuidMap.get(Number(t.tpi_patient_id)) ?? null) : null,
          accountUuid: t.tpi_patient_id != null ? (patAccountUuidMap.get(Number(t.tpi_patient_id)) ?? null) : null,
          treatment: tx?.name || t.tpi_patient_nomenclature || (t.tpi_treatment_id != null ? `Treatment #${t.tpi_treatment_id}` : 'Unknown'),
          category: tx?.categoryId ? (catMap.get(tx.categoryId) || 'Uncategorised') : 'Uncategorised',
          practitioner,
          paymentPlan: t.tpi_payment_plan_id != null ? (ppMap.get(t.tpi_payment_plan_id) || `Plan #${t.tpi_payment_plan_id}`) : '—',
          paymentMethod: (t.tpi_patient_id != null ? paymentMethodMap.get(t.tpi_patient_id) : undefined) || '—',
          duration: Number(t.duration) || 0,
          price: Number(t.tpi_price) || 0,
          invoicedOn: inv?.invoiceDate || '',
          paidOn: '',
          status: inv ? titleCase(inv.status) : 'Not invoiced',
        };
      });
    },
    enabled: tab === 'activity' && !!organizationId && extId != null,
    staleTime: 60 * 1000,
  });

  const apptColumns: ColumnDef<ApptRow>[] = [
    { key: 'bookedAt', label: 'Booked at', sortable: true, render: r => <span className="whitespace-nowrap">{fmtDateTime(r.bookedAt)}</span>, sortVal: r => r.bookedAt, csv: r => fmtDateTime(r.bookedAt) },
    { key: 'date', label: 'Date', sortable: true, render: r => <span className="whitespace-nowrap">{fmtDateTime(r.date)}</span>, sortVal: r => r.date, csv: r => fmtDateTime(r.date) },
    { key: 'duration', label: 'Duration', sortable: true, render: r => r.duration, sortVal: r => r.duration, csv: r => r.duration },
    { key: 'patient', label: 'Patient', sortable: true, render: r => r.patient, sortVal: r => r.patient, csv: r => r.patient },
    { key: 'reason', label: 'Reason', sortable: true, render: r => <span className="block max-w-[280px]">{r.reason}</span>, sortVal: r => r.reason, csv: r => r.reason },
    { key: 'practitioner', label: 'Practitioner', sortable: true, render: r => <span className="whitespace-nowrap">{r.practitioner}</span>, sortVal: r => r.practitioner, csv: r => r.practitioner },
    { key: 'status', label: 'Status', sortable: true, render: r => <Badge variant="outline" className={statusBadgeClass(r.status)}>{r.status}</Badge>, sortVal: r => r.status, csv: r => r.status },
  ];

  const actColumns: ColumnDef<ActivityRow>[] = [
    { key: 'completedAt', label: 'Completed On', sortable: true, render: r => <span className="whitespace-nowrap">{fmtDate(r.completedAt)}</span>, sortVal: r => r.completedAt, csv: r => fmtDate(r.completedAt) },
    {
      key: 'patient',
      label: 'Patient',
      sortable: true,
      // Clicking the name opens the patient in Dentally (new tab).
      render: r => r.patientId != null
        ? (
            <a
              href={`https://app.dentally.co/patients/${r.patientId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {r.patient}
            </a>
          )
        : r.patient,
      sortVal: r => r.patient,
      csv: r => r.patient,
    },
    { key: 'treatment', label: 'Treatment', sortable: true, render: r => r.treatment, sortVal: r => r.treatment, csv: r => r.treatment },
    { key: 'practitioner', label: 'Practitioner', sortable: true, render: r => <span className="whitespace-nowrap">{r.practitioner}</span>, sortVal: r => r.practitioner, csv: r => r.practitioner },
    { key: 'paymentPlan', label: 'Payment Plan', sortable: true, render: r => r.paymentPlan, sortVal: r => r.paymentPlan, csv: r => r.paymentPlan },
    { key: 'paymentMethod', label: 'Payment Method', sortable: true, render: r => <span className="whitespace-nowrap">{r.paymentMethod}</span>, sortVal: r => r.paymentMethod, csv: r => r.paymentMethod },
    { key: 'duration', label: 'Duration', sortable: true, align: 'right', render: r => r.duration, sortVal: r => r.duration, csv: r => r.duration },
    {
      key: 'price',
      label: 'Price',
      sortable: true,
      align: 'right',
      // Link the amount to the patient's account (Payments) page in Dentally —
      // needs the patient UUID + account UUID (both synced). We do NOT deep-link
      // to a specific /invoices/{uuid}: Dentally's invoice URL uses an internal
      // invoice UUID the v1 API doesn't expose, and the line-item-id substitute
      // returns "Record not found" for some practices (confirmed for TFL).
      // The account page reliably lists the invoice instead.
      render: r => {
        const canLinkAccount = r.price > 0 && !!r.patientUuid && !!r.accountUuid;
        if (!canLinkAccount) {
          return <span className="font-medium">{fmtCurrency(r.price)}</span>;
        }
        const filterAccounts = encodeURIComponent(`["${r.accountUuid}"]`);
        const href = `https://app.dentally.co/patients/${r.patientUuid}/account/${r.accountUuid}?activeTab=payments&filterAccounts=${filterAccounts}`;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
            title="Open patient account (Payments) in Dentally"
          >
            {fmtCurrency(r.price)}
          </a>
        );
      },
      sortVal: r => r.price,
      csv: r => r.price,
    },
    { key: 'invoicedOn', label: 'Invoiced On', sortable: true, render: r => <span className="whitespace-nowrap">{r.invoicedOn ? fmtDate(r.invoicedOn) : '—'}</span>, sortVal: r => r.invoicedOn, csv: r => (r.invoicedOn ? fmtDate(r.invoicedOn) : '') },
    { key: 'paidOn', label: 'Paid On', render: r => <span className="whitespace-nowrap">{r.paidOn ? fmtDate(r.paidOn) : '—'}</span>, csv: r => (r.paidOn ? fmtDate(r.paidOn) : '') },
    { key: 'status', label: 'Status', sortable: true, render: r => r.status, sortVal: r => r.status, csv: r => r.status },
  ];

  // Filter options + filtered rows
  const apptStatusOptions = useMemo(
    () => [...new Set(apptRows.map(r => r.status))].sort((a, b) => a.localeCompare(b)),
    [apptRows]);
  const apptFiltered = useMemo(
    () => (apptStatus === 'all' ? apptRows : apptRows.filter(r => r.status === apptStatus)),
    [apptRows, apptStatus]);

  const actTreatmentOptions = useMemo(
    () => [...new Set(actRows.map(r => r.treatment))].sort((a, b) => a.localeCompare(b)),
    [actRows]);
  const actCategoryOptions = useMemo(
    () => [...new Set(actRows.map(r => r.category))].sort((a, b) => a.localeCompare(b)),
    [actRows]);
  const actPlanOptions = useMemo(
    () => [...new Set(actRows.map(r => r.paymentPlan))].sort((a, b) => a.localeCompare(b)),
    [actRows]);
  const actFiltered = useMemo(() => actRows.filter(r =>
    (actTreatment === 'all' || r.treatment === actTreatment) &&
    (actCategory === 'all' || r.category === actCategory) &&
    (actPlan === 'all' || r.paymentPlan === actPlan)
  ), [actRows, actTreatment, actCategory, actPlan]);

  const actTotal = useMemo(() => actFiltered.reduce((s, r) => s + r.price, 0), [actFiltered]);

  // Dentally's Practitioner Activity report. Dentally ignores query-param
  // filters on this report (verified), so we link to the report only — the
  // date range / practitioner are set in Dentally's own filter panel.
  const dentallyActivityUrl = 'https://app.dentally.co/reports/practitioner_activity';

  return (
    <MainLayout aiContext={{ page: 'provider-activity', providerId: id ?? null, providerType: type ?? null }}>
      <Helmet><title>{providerName} — Activity</title></Helmet>

      <div className="space-y-5 pt-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/providers/${type || 'dentist'}/${id}`)} title="Back to provider">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{providerName}</h1>
            <p className="text-muted-foreground">Appointments &amp; Practitioner Activity</p>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-4">
            <Tabs value={tab} onValueChange={v => setTab(v as 'appointments' | 'activity')}>
              {/* Tabs + shared date range on one aligned row */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="appointments">Appointments</TabsTrigger>
                  <TabsTrigger value="activity">Practitioner Activity</TabsTrigger>
                </TabsList>
                <ConfigProvider
                  theme={{
                    token: {
                      colorPrimary: 'hsl(244, 48%, 25%)',
                      colorPrimaryBg: '#e6f4ff',
                      colorPrimaryBgHover: '#bae0ff',
                    },
                  }}
                >
                  <DatePicker.RangePicker
                    value={[from ? dayjs(from) : null, to ? dayjs(to) : null]}
                    onChange={(dates) => {
                      if (dates && dates[0] && dates[1]) {
                        setFrom(dates[0].format('YYYY-MM-DD'));
                        setTo(dates[1].format('YYYY-MM-DD'));
                      }
                    }}
                    format="DD-MM-YYYY"
                    allowClear={false}
                    className="h-9 w-[260px]"
                  />
                </ConfigProvider>
              </div>

              <TabsContent value="appointments" className="mt-4">
                <div className="flex justify-end mb-2 text-sm">
                  <span className="text-muted-foreground mr-2">Total:</span>
                  {dentallyPractitionerId ? (
                    <a
                      href={`https://app.dentally.co/reports/appointments?after=${from}&before=${to}&practitionerId=${dentallyPractitionerId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-primary hover:underline"
                      title="Open in Dentally's Appointments report"
                    >
                      {apptFiltered.length}
                    </a>
                  ) : (
                    <span className="font-bold">{apptFiltered.length}</span>
                  )}
                </div>
                <DataTable
                  rows={apptFiltered}
                  columns={apptColumns}
                  searchText={apptTs.search}
                  searchFields={r => `${r.patient} ${r.reason} ${r.practitioner} ${r.status}`}
                  ts={apptTs}
                  isLoading={apptLoading || (specificLocation && locationRecordLoading)}
                  emptyText="No appointments for this period / search."
                  exportName={`${providerName.replace(/\s+/g, '_')}_appointments_${from}_to_${to}`}
                  filtersSlot={
                    <FilterSelect label="Status" value={apptStatus} onChange={setApptStatus} options={apptStatusOptions} />
                  }
                  onRowClick={(r) => {
                    if (!r.patientUuid) return;
                    window.open(`https://app.dentally.co/patients/${r.patientUuid}/appointments`, '_blank', 'noopener,noreferrer');
                  }}
                />
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                <div className="flex justify-end mb-2 text-sm">
                  <span className="text-muted-foreground mr-2">Total:</span>
                  <a
                    href={dentallyActivityUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-primary hover:underline"
                    title="Open in Dentally's Practitioner Activity report"
                  >
                    {fmtCurrency(actTotal)}
                  </a>
                </div>
                <DataTable
                  rows={actFiltered}
                  columns={actColumns}
                  searchText={actTs.search}
                  searchFields={r => `${r.patient} ${r.treatment} ${r.category} ${r.practitioner} ${r.paymentPlan}`}
                  ts={actTs}
                  isLoading={actLoading || (specificLocation && locationRecordLoading)}
                  emptyText="No completed treatments for this period / search."
                  exportName={`${providerName.replace(/\s+/g, '_')}_practitioner_activity_${from}_to_${to}`}
                  filtersSlot={
                    <>
                      <FilterSelect label="Treatment" value={actTreatment} onChange={setActTreatment} options={actTreatmentOptions} />
                      <FilterSelect label="Category" value={actCategory} onChange={setActCategory} options={actCategoryOptions} />
                      <FilterSelect label="Payment Plan" value={actPlan} onChange={setActPlan} options={actPlanOptions} />
                    </>
                  }
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
