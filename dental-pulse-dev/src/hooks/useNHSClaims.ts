import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocations } from '@/hooks/useLocations';
import { useOrganization } from '@/hooks/useOrganization';
import { useFilters } from '@/contexts/FilterContext';

/**
 * Claim-level detail behind the NHS "Total Claims" card. Mirrors the location +
 * period scoping of useNHSContractPerformance (completed claims, by
 * nc_submitted_date, scoped to the selected location/region), then enriches each
 * claim with patient name, treatment-plan course dates, performer and contract.
 *
 * Dentally ids (pt_id, tp_id, external_id) are unique PER integration_id, not
 * per org, so patient/treatment-plan lookups are keyed by `${integration_id}:${id}`.
 */
export interface NHSClaimRow {
  id: string;
  nhsId: string | null;            // nc_sequence_number
  tpId: number | null;             // nc_treatment_plan_id
  patientId: number | null;        // nc_patient_id (Dentally)
  patient: string;
  submitted: string | null;        // nc_submitted_date (ISO)
  start: string | null;            // treatment_plans.tp_start_date
  end: string | null;              // treatment_plans.tp_end_date
  performer: string;
  contract: string;
  dentistChargeDelivered: number;  // nc_dentist_charge
  dentistChargeExpected: number;   // nc_expected (delivered/expected "X / Y")
  patientCharge: number;           // nc_patient_charge
  status: string;                  // nc_claim_status
  comments: string;                // nc_status_comments
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function useNHSClaims() {
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { selectedLocationId, selectedRegionId, dateRange } = useFilters();

  const queryStartDate = useMemo(() => dateRange.startDate.toISOString(), [dateRange.startDate]);
  const queryEndDate = useMemo(() => {
    const end = new Date(dateRange.endDate);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }, [dateRange.endDate]);

  const locationIdsForQuery = useMemo(() => {
    if (selectedLocationId) return [selectedLocationId];
    if (selectedRegionId) {
      const ids = allAvailableLocations
        .filter(l => l.region_id === selectedRegionId)
        .map(l => l.id);
      return ids.length > 0 ? ids : null;
    }
    return null;
  }, [selectedLocationId, selectedRegionId, allAvailableLocations]);

  const locationKey = locationIdsForQuery ? locationIdsForQuery.slice().sort().join(',') : 'all';

  const query = useQuery({
    queryKey: ['nhs_claims_detail', organizationId, queryStartDate, queryEndDate, locationKey],
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<NHSClaimRow[]> => {
      if (!organizationId) return [];

      // Location → Dentally site UUIDs (same approach as useNHSContractPerformance).
      let dentallyUUIDs: Set<string> | null = null;
      if (locationIdsForQuery) {
        const { data: locRows } = await (supabase as any)
          .from('practice_locations')
          .select('api_record_unique_id')
          .in('id', locationIdsForQuery)
          .is('deleted_at', null);
        const uuids = ((locRows ?? []) as Array<{ api_record_unique_id: string | null }>)
          .map(r => r.api_record_unique_id?.toLowerCase())
          .filter((v): v is string => !!v);
        if (uuids.length > 0) dentallyUUIDs = new Set(uuids);
      }

      // 1. Fetch completed claims in range (mirrors the card's count).
      const PAGE_SIZE = 1000;
      type Raw = {
        id: string;
        nc_sequence_number: string | null;
        nc_treatment_plan_id: number | null;
        nc_patient_id: number | null;
        nc_practitioner_id: number | null;
        nc_contract_id: number | null;
        nc_submitted_date: string | null;
        nc_dentist_charge: number | null;
        nc_expected_uda: number | null;
        nc_patient_charge: number | null;
        nc_claim_status: string | null;
        nc_status_comments: string | null;
        nc_site_id: string | null;
        location_id: string | null;
        integration_id: string | null;
      };
      const claims: Raw[] = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await (supabase as any)
          .from('nhs_claims')
          .select('id, nc_sequence_number, nc_treatment_plan_id, nc_patient_id, nc_practitioner_id, nc_contract_id, nc_submitted_date, nc_dentist_charge, nc_expected_uda, nc_patient_charge, nc_claim_status, nc_status_comments, nc_site_id, location_id, integration_id')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .gte('nc_submitted_date', queryStartDate)
          .lte('nc_submitted_date', queryEndDate)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = (data ?? []) as Raw[];
        for (const row of rows) {
          if (dentallyUUIDs) {
            const siteId = row.nc_site_id?.toLowerCase();
            if (siteId && dentallyUUIDs.has(siteId)) claims.push(row);
            else if (row.location_id && locationIdsForQuery?.includes(row.location_id)) claims.push(row);
          } else {
            claims.push(row);
          }
        }
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      if (claims.length === 0) return [];

      // 2. Enrich. Dentally ids are per-integration, so key lookups by integration.
      const patientIds = [...new Set(claims.map(c => c.nc_patient_id).filter((v): v is number => v != null))];
      const tpIds = [...new Set(claims.map(c => c.nc_treatment_plan_id).filter((v): v is number => v != null))];
      const practitionerIds = [...new Set(claims.map(c => c.nc_practitioner_id).filter((v): v is number => v != null))];

      const inChunks = async <T,>(ids: (number | string)[], fetcher: (chunk: (number | string)[]) => Promise<T[]>): Promise<T[]> => {
        const out: T[] = [];
        for (let i = 0; i < ids.length; i += 500) {
          out.push(...(await fetcher(ids.slice(i, i + 500))));
        }
        return out;
      };

      const [patientRows, tpRows, providerRows] = await Promise.all([
        patientIds.length
          ? inChunks(patientIds, async chunk => {
              const { data } = await (supabase as any)
                .from('patients')
                .select('pt_id, pt_first_name, pt_last_name, integration_id')
                .eq('organization_id', organizationId)
                .in('pt_id', chunk);
              return (data ?? []) as Array<{ pt_id: number; pt_first_name: string | null; pt_last_name: string | null; integration_id: string | null }>;
            })
          : Promise.resolve([] as Array<{ pt_id: number; pt_first_name: string | null; pt_last_name: string | null; integration_id: string | null }>),
        tpIds.length
          ? inChunks(tpIds, async chunk => {
              const { data } = await (supabase as any)
                .from('treatment_plans')
                .select('tp_id, tp_start_date, tp_end_date, integration_id')
                .eq('organization_id', organizationId)
                .in('tp_id', chunk);
              return (data ?? []) as Array<{ tp_id: number; tp_start_date: string | null; tp_end_date: string | null; integration_id: string | null }>;
            })
          : Promise.resolve([] as Array<{ tp_id: number; tp_start_date: string | null; tp_end_date: string | null; integration_id: string | null }>),
        practitionerIds.length
          ? inChunks(practitionerIds, async chunk => {
              const { data } = await (supabase as any)
                .from('providers')
                .select('external_id, name')
                .eq('organization_id', organizationId)
                .in('external_id', chunk);
              return (data ?? []) as Array<{ external_id: number | null; name: string }>;
            })
          : Promise.resolve([] as Array<{ external_id: number | null; name: string }>),
      ]);

      const patientMap = new Map<string, string>();
      for (const p of patientRows) {
        patientMap.set(`${p.integration_id}:${p.pt_id}`, `${p.pt_first_name ?? ''} ${p.pt_last_name ?? ''}`.trim());
      }
      const tpMap = new Map<string, { start: string | null; end: string | null }>();
      for (const t of tpRows) {
        tpMap.set(`${t.integration_id}:${t.tp_id}`, { start: t.tp_start_date, end: t.tp_end_date });
      }
      const providerMap = new Map<number, string>();
      for (const pr of providerRows) {
        if (pr.external_id != null) providerMap.set(pr.external_id, pr.name);
      }

      const rows: NHSClaimRow[] = claims.map(c => {
        const tp = c.nc_treatment_plan_id != null ? tpMap.get(`${c.integration_id}:${c.nc_treatment_plan_id}`) : undefined;
        const patientName = c.nc_patient_id != null
          ? (patientMap.get(`${c.integration_id}:${c.nc_patient_id}`) || `Patient #${c.nc_patient_id}`)
          : '—';
        return {
          id: c.id,
          nhsId: c.nc_sequence_number,
          tpId: c.nc_treatment_plan_id,
          patientId: c.nc_patient_id,
          patient: patientName,
          submitted: c.nc_submitted_date,
          start: tp?.start ?? null,
          end: tp?.end ?? null,
          performer: c.nc_practitioner_id != null ? (providerMap.get(c.nc_practitioner_id) || '—') : '—',
          contract: c.nc_contract_id != null && c.nc_contract_id !== 0 ? `NHS Contract - ${c.nc_contract_id}` : 'NHS Contract',
          dentistChargeDelivered: asNumber(c.nc_dentist_charge),
          dentistChargeExpected: asNumber(c.nc_expected_uda),
          patientCharge: asNumber(c.nc_patient_charge),
          status: c.nc_claim_status ?? '—',
          comments: c.nc_status_comments ?? '',
        };
      });

      // Newest submission first.
      rows.sort((a, b) => (b.submitted ?? '').localeCompare(a.submitted ?? ''));
      return rows;
    },
  });

  const practitionerOptions = useMemo(() => {
    const names = [...new Set((query.data ?? []).map(r => r.performer).filter(n => n && n !== '—'))].sort();
    return [{ value: 'all', label: 'All' }, ...names.map(n => ({ value: n, label: n }))];
  }, [query.data]);

  const statusOptions = useMemo(() => {
    const statuses = [...new Set((query.data ?? []).map(r => r.status).filter(s => s && s !== '—'))].sort();
    return [{ value: 'all', label: 'All' }, ...statuses.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))];
  }, [query.data]);

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    practitionerOptions,
    statusOptions,
  };
}
