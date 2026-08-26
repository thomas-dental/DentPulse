import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export type PatientContributionSummary = {
  patientCount: number;
  patientsWithRevenue: number;
  totalContribution: number;
  totalRevenue: number;
  totalNhsExcluded: number;
};

async function fetchPatientContributionSummary(
  practiceId: string,
): Promise<PatientContributionSummary> {
  const pageSize = 1000;
  let offset = 0;
  let patientCount = 0;
  let patientsWithRevenue = 0;
  let totalContribution = 0;
  let totalRevenue = 0;
  let totalNhsExcluded = 0;

  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase
      .from('v_patient_contribution')
      .select('contribution, revenue_private_plan, nhs_excluded_amount')
      .eq('practice_id', practiceId)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      patientCount += 1;
      const revenue = Number(row.revenue_private_plan ?? 0);
      const contribution = Number(row.contribution ?? 0);
      const nhs = Number(row.nhs_excluded_amount ?? 0);
      totalRevenue += revenue;
      totalContribution += contribution;
      totalNhsExcluded += nhs;
      if (revenue > 0) patientsWithRevenue += 1;
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return {
    patientCount,
    patientsWithRevenue,
    totalContribution,
    totalRevenue,
    totalNhsExcluded,
  };
}

export function usePatientContributionSummary() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['v_patient_contribution', 'summary', organizationId],
    enabled: !!organizationId,
    queryFn: () => fetchPatientContributionSummary(organizationId!),
  });
}
