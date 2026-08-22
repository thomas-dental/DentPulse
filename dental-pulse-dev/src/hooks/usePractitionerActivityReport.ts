import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { fetchAll, inChunks, localDayRange } from '@/lib/activityReportUtils';

/**
 * All-practitioners "Practitioner Activity" report — the flat, itemized
 * completed-treatment list Dentally itself reports at
 * reports/practitioner_activity, and that fe-dentpulse-live mirrors at
 * /provider/activity (via be-dentpulse's DentallyReportController /
 * GetPractitionerActivityReport). Neither of those has any location/practice
 * filter — each live org has exactly one Dentally connection. This org model
 * supports several locations per organization, so this hook adds that:
 * scoped by the global top-nav location filter (useFilters().selectedLocationId),
 * same mechanism usePractitionerHistoryList already uses.
 *
 * Same reconciled Dentally-matching gate as ProviderActivity's "Practitioner
 * Activity" tab: completed TPIs (tpi_completed + tpi_completed_at), payment-plan
 * attached, charting entries excluded (tpi_treatment_appointment_id NOT NULL).
 */

export interface PractitionerActivityRow {
  id: string;
  completedAt: string;
  patient: string;
  patientId: number | null;
  patientUuid: string | null;
  accountUuid: string | null;
  treatment: string;
  category: string;
  practitionerId: string;
  practitioner: string;
  paymentPlan: string;
  paymentMethod: string;
  duration: number;
  price: number;
  invoicedOn: string;
  paidOn: string;
  status: string;
}

interface ProviderRow {
  id: string;
  name: string;
  external_id: number | null;
  integration_id: string | null;
  location_id: string | null;
}

export function usePractitionerActivityReport(from: string, to: string) {
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();
  const specificLocation = !!selectedLocationId && selectedLocationId !== 'all';

  return useQuery({
    queryKey: ['practitioner-activity-report-v2', organizationId, specificLocation ? selectedLocationId : 'all', from, to],
    queryFn: async (): Promise<PractitionerActivityRow[]> => {
      if (!organizationId) return [];

      // 1. Practitioner roster (same pattern as usePractitionerHistoryList).
      // Include inactive providers so leavers still show their historical completed treatments.
      //
      // Do NOT filter providers by location_id. providers.location_id is the
      // practitioner's HOME site, not where the treatment was delivered, and the
      // two disagree whenever a practitioner works across sites (or holds a
      // second Dentally practitioner record at another practice). Scoping the
      // roster by home site both drops cross-site work done AT the selected
      // location and pulls in work done ELSEWHERE by a locally-homed
      // practitioner — the exact mis-tagging fixed for net production in
      // 20260817000002_net_production_use_appointment_location.sql. Site scoping
      // belongs on the TPI rows below, whose location_id the sync backfills from
      // the appointment site (queue/processor.js Method 1) — which is what
      // Dentally's own site-filtered Practitioner Activity report uses.
      const provQuery = (supabase as any)
        .from('providers')
        .select('id, name, external_id, integration_id, location_id')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);
      const { data: providersData, error: provErr } = await provQuery;
      if (provErr) { console.error('[usePractitionerActivityReport] providers error:', provErr); return []; }

      const providerList = (providersData ?? []) as ProviderRow[];
      const extIdToProvider = new Map<number, ProviderRow>();
      for (const p of providerList) {
        if (p.external_id != null) extIdToProvider.set(p.external_id, p);
      }
      if (extIdToProvider.size === 0) return [];

      // Group by integration — a Dentally id (external_id, treatment id,
      // payment-plan id, patient id, invoice id) is only unique PER Dentally
      // practice, so an org with more than one connected practice must not mix
      // rows/lookups across integrations (same gotcha ProviderActivity guards
      // against for a single practitioner, extended here across all of them).
      const extIdsByIntegration = new Map<string, number[]>();
      for (const [extId, p] of extIdToProvider) {
        const key = p.integration_id ?? '';
        const list = extIdsByIntegration.get(key) ?? [];
        list.push(extId);
        extIdsByIntegration.set(key, list);
      }

      const { start, endExclusive } = localDayRange(from, to);

      // ── DEV-ONLY reconciliation probe ────────────────────────────────────
      // Re-runs the window with NO gates applied and reports which predicate
      // removes each row, so a disagreement with Dentally's own
      // practitioner_activity totals can be attributed to a specific filter
      // instead of guessed at. Logs once per query to the browser console.
      // Safe to delete once the reconciliation is closed.
      if (import.meta.env.DEV) {
        void (async () => {
          try {
            const probeRows = await fetchAll<any>(() =>
              (supabase as any)
                .from('treatment_plan_items')
                .select('tpi_id, tpi_price, tpi_patient_id, tpi_practitioner_id, tpi_payment_plan_id, tpi_treatment_appointment_id, location_id, duration, integration_id')
                .eq('organization_id', organizationId)
                .eq('tpi_completed', true)
                .not('tpi_completed_at', 'is', null)
                .gte('tpi_completed_at', start)
                .lt('tpi_completed_at', endExclusive),
            );

            const bucket: Record<string, { rows: number; money: number; minutes: number; patients: Set<number> }> = {};
            const add = (name: string, r: any) => {
              const b = bucket[name] ?? (bucket[name] = { rows: 0, money: 0, minutes: 0, patients: new Set() });
              b.rows += 1;
              b.money += Number(r.tpi_price) || 0;
              b.minutes += Number(r.duration) || 0;
              if (r.tpi_patient_id != null) b.patients.add(Number(r.tpi_patient_id));
            };

            for (const r of probeRows) {
              // Collect EVERY failing predicate, not just the first. A row cut by
              // two gates cannot be recovered by relaxing one of them, so only the
              // "ONLY:" buckets below name a gate that is actually load-bearing for
              // the row count we still differ from Dentally on.
              const fails: string[] = [];
              if (!extIdToProvider.has(Number(r.tpi_practitioner_id))) fails.push('practitioner not in providers roster');
              if (r.tpi_payment_plan_id == null) fails.push('no payment plan');
              if (r.tpi_treatment_appointment_id == null) fails.push('charting entry (no treatment appointment)');
              if (specificLocation && r.location_id !== selectedLocationId) {
                fails.push(r.location_id == null ? 'location_id is NULL' : 'location_id is another site');
              }

              if (fails.length === 0) add('INCLUDED in report', r);
              else if (fails.length === 1) add(`ONLY cut by: ${fails[0]}`, r);
              else add(`cut by ${fails.length}: ${fails.join(' + ')}`, r);
            }

            const summary = Object.entries(bucket)
              .map(([reason, b]) => ({
                reason,
                rows: b.rows,
                patients: b.patients.size,
                money: Math.round(b.money * 100) / 100,
                hours: Math.round((b.minutes / 60) * 10) / 10,
              }))
              .sort((a, b) => b.rows - a.rows);

            console.log(
              `[ActivityProbe] ${from}..${to} — ${probeRows.length} completed TPIs in window before any gate`,
            );
            console.table(summary);

            // Of the rows that pass every gate, which would the real query still
            // miss? It scopes each practitioner's TPIs by that practitioner's own
            // providers.integration_id, so a TPI stamped with a different (or no)
            // integration is unreachable even though the treatment is ours.
            let lostRows = 0;
            let lostMoney = 0;
            const lostIntegrationValues = new Map<string, number>();
            for (const r of probeRows) {
              const prov = extIdToProvider.get(Number(r.tpi_practitioner_id));
              if (!prov) continue;
              if (r.tpi_payment_plan_id == null) continue;
              if (r.tpi_treatment_appointment_id == null) continue;
              if (specificLocation && r.location_id !== selectedLocationId) continue;
              const provInt = prov.integration_id ?? null;
              if (provInt && r.integration_id !== provInt) {
                lostRows += 1;
                lostMoney += Number(r.tpi_price) || 0;
                const k = r.integration_id == null ? '(null)' : String(r.integration_id);
                lostIntegrationValues.set(k, (lostIntegrationValues.get(k) ?? 0) + 1);
              }
            }
            console.log(
              `[ActivityProbe] pass all gates but unreachable via integration scoping: ${lostRows} rows, money ${Math.round(lostMoney * 100) / 100}`,
            );
            console.log('[ActivityProbe] their integration_id values:', [...lostIntegrationValues.entries()]);
          } catch (err) {
            console.error('[ActivityProbe] failed:', err);
          }
        })();
      }

      // 2. Completed TPIs for each integration's practitioners, in range.
      const tpiGroups = await Promise.all(
        [...extIdsByIntegration.entries()].map(async ([integrationId, extIds]) => {
          const rows = await fetchAll<any>(() => {
            let q = (supabase as any)
              .from('treatment_plan_items')
              .select('tpi_id, tpi_price, tpi_treatment_id, tpi_patient_id, tpi_patient_nomenclature, tpi_completed_at, tpi_payment_plan_id, tpi_invoice_id, duration, tpi_practitioner_id')
              .eq('organization_id', organizationId)
              .eq('tpi_completed', true)
              .not('tpi_completed_at', 'is', null)
              .not('tpi_payment_plan_id', 'is', null)
              .not('tpi_treatment_appointment_id', 'is', null)
              .gte('tpi_completed_at', start)
              .lt('tpi_completed_at', endExclusive)
              .in('tpi_practitioner_id', extIds);
            // Scope to this practitioner's integration, but keep TPIs that carry
            // no integration stamp at all. Dentally ids are only unique per
            // integration, so the scoping matters — yet rows synced before
            // integration_id was populated have NULL, and an .eq() silently drops
            // them, losing completed treatments the practitioner really did.
            if (integrationId) q = q.or(`integration_id.eq.${integrationId},integration_id.is.null`);
            // Site scope on the treatment row (appointment site), not the
            // practitioner's home site — see the roster comment above.
            if (specificLocation) q = q.eq('location_id', selectedLocationId);
            return q;
          });
          return rows.map((r) => ({ ...r, __integrationId: integrationId || null }));
        }),
      );
      const mine = tpiGroups.flat();
      if (mine.length === 0) return [];

      // 3. Lookups (treatment, category, payment plan, patient, account, invoice,
      // payment method) — one pass per integration group, same as step 2.
      const rowsByIntegration = new Map<string, any[]>();
      for (const r of mine) {
        const key = r.__integrationId ?? '';
        const list = rowsByIntegration.get(key) ?? [];
        list.push(r);
        rowsByIntegration.set(key, list);
      }

      const allRows: PractitionerActivityRow[] = [];
      const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      for (const [integrationKey, rows] of rowsByIntegration) {
        const integrationId = integrationKey || null;

        const txIds = [...new Set(rows.map(t => t.tpi_treatment_id).filter((x): x is number => x != null))];
        const ppIds = [...new Set(rows.map(t => t.tpi_payment_plan_id).filter((x): x is number => x != null))];
        const patIds = [...new Set(rows.map(t => t.tpi_patient_id).filter((x): x is number => x != null))];

        const txMap = new Map<number, { name: string; categoryId: string | null }>();
        const catMap = new Map<string, string>();
        const ppMap = new Map<number, string>();
        const patMap = new Map<number, string>();
        const patLocationMap = new Map<number, string | null>();
        const patUuidMap = new Map<number, string>();
        const patAccountIdMap = new Map<number, number>();

        const txRows = await inChunks<any>('treatments', 'external_id, treatment_name, category_id', 'external_id', txIds, organizationId, integrationId);
        for (const t of txRows) txMap.set(t.external_id, { name: t.treatment_name, categoryId: t.category_id });
        const catIds = [...new Set([...txMap.values()].map(v => v.categoryId).filter((x): x is string => !!x))];
        const catRows = await inChunks<any>('treatment_categories', 'id, name', 'id', catIds, organizationId);
        for (const c of catRows) catMap.set(c.id, c.name);
        const ppRows = await inChunks<any>('payment_plans', 'pp_id, pp_name', 'pp_id', ppIds, organizationId, integrationId);
        for (const pp of ppRows) ppMap.set(pp.pp_id, pp.pp_name ?? `Plan #${pp.pp_id}`);

        const patRows = await inChunks<any>('patients', 'pt_id, pt_first_name, pt_last_name, location_id, pt_unique_id, pt_account_id', 'pt_id', patIds, organizationId, integrationId);
        for (const p of patRows) {
          patMap.set(p.pt_id, `${p.pt_first_name ?? ''} ${p.pt_last_name ?? ''}`.trim() || `Patient #${p.pt_id}`);
          patLocationMap.set(p.pt_id, p.location_id ?? null);
          if (p.pt_id != null && p.pt_unique_id) patUuidMap.set(Number(p.pt_id), String(p.pt_unique_id));
          if (p.pt_id != null && p.pt_account_id != null) {
            const accId = Number(p.pt_account_id);
            if (Number.isFinite(accId)) patAccountIdMap.set(Number(p.pt_id), accId);
          }
        }

        const accountIds = [...new Set([...patAccountIdMap.values()])];
        const accountUuidByDaId = new Map<number, string>();
        if (accountIds.length > 0) {
          const accRows = await inChunks<any>('dentally_patients_accounts', 'da_id, da_uuid', 'da_id', accountIds, organizationId, integrationId);
          for (const a of accRows) {
            if (a.da_id != null && a.da_uuid) accountUuidByDaId.set(Number(a.da_id), String(a.da_uuid));
          }
        }
        const patAccountUuidMap = new Map<number, string>();
        for (const [ptId, daId] of patAccountIdMap) {
          const uuid = accountUuidByDaId.get(daId);
          if (uuid) patAccountUuidMap.set(ptId, uuid);
        }

        const invIds = [...new Set(rows.map(t => t.tpi_invoice_id).filter((x): x is number => x != null))];
        const invMap = new Map<string, { status: string; invoiceDate: string | null }>();
        const invRows = await inChunks<any>('platform_integration_invoices', 'platform_invoice_id, status, invoice_date', 'platform_invoice_id', invIds, organizationId, integrationId);
        for (const iv of invRows) {
          if (iv.platform_invoice_id != null) {
            invMap.set(String(iv.platform_invoice_id), { status: iv.status ?? 'outstanding', invoiceDate: iv.invoice_date ?? null });
          }
        }

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
          const locMatched = patientLoc ? payments.filter((p) => p.location_id === patientLoc) : [];
          const pool = locMatched.length > 0 ? locMatched : payments;
          pool.sort((a, b) => String(b.dp_dated_on || '').localeCompare(String(a.dp_dated_on || '')));
          paymentMethodMap.set(ptId, pool[0].dp_method);
        }

        for (const t of rows) {
          const provider = extIdToProvider.get(Number(t.tpi_practitioner_id));
          if (!provider) continue; // shouldn't happen — rows are already scoped to known extIds
          const tx = t.tpi_treatment_id != null ? txMap.get(t.tpi_treatment_id) : undefined;
          const inv = t.tpi_invoice_id != null ? invMap.get(String(t.tpi_invoice_id)) : undefined;
          allRows.push({
            id: t.tpi_id != null ? String(t.tpi_id) : `t-${provider.id}-${allRows.length}`,
            completedAt: t.tpi_completed_at || '',
            patient: (t.tpi_patient_id != null ? patMap.get(t.tpi_patient_id) : undefined) || '—',
            patientId: t.tpi_patient_id != null ? Number(t.tpi_patient_id) : null,
            patientUuid: t.tpi_patient_id != null ? (patUuidMap.get(Number(t.tpi_patient_id)) ?? null) : null,
            accountUuid: t.tpi_patient_id != null ? (patAccountUuidMap.get(Number(t.tpi_patient_id)) ?? null) : null,
            treatment: tx?.name || t.tpi_patient_nomenclature || (t.tpi_treatment_id != null ? `Treatment #${t.tpi_treatment_id}` : 'Unknown'),
            category: tx?.categoryId ? (catMap.get(tx.categoryId) || 'Uncategorised') : 'Uncategorised',
            practitionerId: provider.id,
            practitioner: provider.name,
            paymentPlan: t.tpi_payment_plan_id != null ? (ppMap.get(t.tpi_payment_plan_id) || `Plan #${t.tpi_payment_plan_id}`) : '—',
            paymentMethod: (t.tpi_patient_id != null ? paymentMethodMap.get(t.tpi_patient_id) : undefined) || '—',
            duration: Number(t.duration) || 0,
            price: Number(t.tpi_price) || 0,
            invoicedOn: inv?.invoiceDate || '',
            paidOn: '',
            status: inv ? titleCase(inv.status) : 'Not invoiced',
          });
        }
      }

      allRows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      return allRows;
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });
}
