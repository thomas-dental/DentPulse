import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface InvisalignMonthlyTrendData {
  month: string;
  actual: number;
  target: number;
  consultations: number;
  conversions: number;
}

/**
 * Get Invisalign monthly trends data
 *
 * Flow:
 * 1. Get all treatments where type_of_treatment = 'invisalign' (with external_id)
 * 2. For each of the last 6 months:
 *    - Get consultations (all appointments)
 *    - Get actual cases (completed treatment plan items for invisalign treatments)
 *    - Calculate conversions (cases / consultations)
 * 3. Return monthly data with targets (from mock data for now)
 */
export function useInvisalignMonthlyTrends(enabled: boolean = true) {
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { selectedLocationId } = useFilters();

  const userOrgIds = useMemo(() => {
    if (allAvailableLocations.length === 0) return organizationId ? [organizationId] : [];
    return [...new Set(allAvailableLocations.map(l => l.organization_id))];
  }, [allAvailableLocations, organizationId]);

  const selectedLocationOrgId = useMemo(() => {
    if (!selectedLocationId || allAvailableLocations.length === 0) return null;
    const loc = allAvailableLocations.find(l => l.id === selectedLocationId);
    return loc?.organization_id ?? null;
  }, [selectedLocationId, allAvailableLocations]);

  const effectiveOrgIds = useMemo(() => {
    if (selectedLocationOrgId) return [selectedLocationOrgId];
    return userOrgIds;
  }, [selectedLocationOrgId, userOrgIds]);

  const orgIdsKey = useMemo(() => effectiveOrgIds.slice().sort().join(','), [effectiveOrgIds]);

  return useQuery({
    queryKey: ['invisalign_monthly_trends', orgIdsKey, selectedLocationId],
    queryFn: async (): Promise<InvisalignMonthlyTrendData[]> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useInvisalignMonthlyTrends] No organizationId provided');
        return [];
      }
      const organizationId = effectiveOrgIds[0];

      try {
        // ============================================
        // STEP 1: Get all invisalign treatments
        // ============================================
        const { data: invisalignTreatments, error: treatmentsError } = await (supabase as any)
          .from('treatments')
          .select('id, external_id, treatment_name')
          .eq('organization_id', organizationId)
          .eq('type_of_treatment', 'invisalign')
          .is('deleted_at', null)
          .eq('is_active', true);

        if (treatmentsError) {
          console.error('[useInvisalignMonthlyTrends] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }

        if (!invisalignTreatments || invisalignTreatments.length === 0) {
          console.log('[useInvisalignMonthlyTrends] No invisalign treatments found');
          return [];
        }

        const invisalignTreatmentExternalIds = invisalignTreatments
          .map((t: any) => t.external_id)
          .filter((id: any) => id != null)
          .map((id: any) => {
            const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(numId) ? null : numId;
          })
          .filter((id: any) => id != null) as number[];

        if (invisalignTreatmentExternalIds.length === 0) {
          console.log('[useInvisalignMonthlyTrends] No invisalign treatments have external_id');
          return [];
        }

        // ============================================
        // STEP 2: Get patient IDs who have invisalign treatment plans
        // Link: treatment_plan_items.tpi_treatment_id -> treatments.external_id
        // ============================================
        let invisalignPatientIds: number[] = [];
        const { data: invisalignTPIs, error: tpiError } = await (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_patient_id')
          .eq('organization_id', organizationId)
          .in('tpi_treatment_id', invisalignTreatmentExternalIds)
          .is('deleted_at', null);

        if (!tpiError && invisalignTPIs) {
          invisalignPatientIds = Array.from(new Set(
            invisalignTPIs
              .map((tpi: any) => tpi.tpi_patient_id)
              .filter((id: any) => id != null)
          ));
        }

        // ============================================
        // STEP 3: Generate last 6 months date ranges
        // ============================================
        const now = new Date();
        const months: InvisalignMonthlyTrendData[] = [];
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Get last 6 months (including current month)
        for (let i = 5; i >= 0; i--) {
          const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
          startOfMonth.setHours(0, 0, 0, 0);
          const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
          endOfMonth.setHours(23, 59, 59, 999);
          // Europe/London month-boundary instants — viewer-independent, unlike
          // toISOString() on local Dates (wrong outside UK browsers).
          const monthStartInstant = ukDayStartInstant(startOfMonth);
          const monthEndInstant = ukDayEndInstant(endOfMonth);
          const monthStartDate = new Date(monthStartInstant);
          const monthEndDate = new Date(monthEndInstant);

          const monthLabel = monthNames[monthDate.getMonth()];

          // ============================================
          // STEP 4: Get Consultations for this month
          // Appointments for patients who have invisalign treatment plans
          // ============================================
          let consultations: any[] = [];
          if (invisalignPatientIds.length > 0) {
            const { data: consults, error: consultationsError } = await (supabase as any)
              .from('appointments')
              .select('apmt_id')
              .eq('organization_id', organizationId)
              .in('apmt_patient_id', invisalignPatientIds)
              .gte('apmt_start_time', monthStartInstant)
              .lte('apmt_start_time', monthEndInstant)
              .is('deleted_at', null);

            if (consultationsError) {
              console.error(`[useInvisalignMonthlyTrends] Error fetching consultations for ${monthLabel}:`, consultationsError);
            } else {
              consultations = consults || [];
            }
          }

          // ============================================
          // STEP 5: Get Actual Cases (completed treatment plan items) for this month
          // ============================================
          let actualCases = 0;
          if (invisalignTreatmentExternalIds.length > 0) {
            const { data: treatmentPlanItems, error: tpiError } = await (supabase as any)
              .from('treatment_plan_items')
              .select('tpi_id, tpi_patient_id, tpi_completed_at, created_at, tpi_updated_at')
              .eq('organization_id', organizationId)
              .eq('tpi_completed', true)
              .in('tpi_treatment_id', invisalignTreatmentExternalIds)
              .is('deleted_at', null);

            if (!tpiError && treatmentPlanItems) {
              // Filter by month
              const monthItems = treatmentPlanItems.filter((tpi: any) => {
                const dateToCheck = tpi.tpi_completed_at || tpi.created_at || tpi.tpi_updated_at;
                if (!dateToCheck) return false;

                const itemDate = new Date(dateToCheck);
                return itemDate >= monthStartDate && itemDate <= monthEndDate;
              });

              // Count unique patients (cases)
              const uniquePatients = new Set(
                monthItems
                  .map((tpi: any) => tpi.tpi_patient_id)
                  .filter((id: any) => id != null)
              );
              actualCases = uniquePatients.size;
            }
          }

          const consultationsCount = consultations.length || 0;
          const conversions = consultationsCount > 0 ? actualCases : 0;

          // Get dummy target from mock data (can be made configurable later)
          const target = 40; // Default target per month

          months.push({
            month: monthLabel,
            actual: actualCases,
            target: target,
            consultations: consultationsCount,
            conversions: conversions,
          });
        }

        console.log('[useInvisalignMonthlyTrends] Returning monthly trends:', months);
        return months;
      } catch (error) {
        console.error('[useInvisalignMonthlyTrends] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0,
    retry: 1,
  });
}
