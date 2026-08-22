import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface MonthlyTrendData {
  month: string;
  actual: number;
  target: number;
  consultations: number;
  conversions: number;
}

/**
 * Get Implant monthly trends data
 *
 * Flow:
 * 1. Get all treatments where type_of_treatment = 'implant' (with external_id)
 * 2. For each of the last 6 months:
 *    - Get consultations (all appointments)
 *    - Get actual cases (completed treatment plan items for implant treatments)
 *    - Calculate conversions (cases / consultations)
 * 3. Return monthly data with targets (from mock data for now)
 */
export function useImplantMonthlyTrends(enabled: boolean = true) {
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
    queryKey: ['implant_monthly_trends', orgIdsKey, selectedLocationId],
    queryFn: async (): Promise<MonthlyTrendData[]> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useImplantMonthlyTrends] No organizationId provided');
        return [];
      }
      const organizationId = effectiveOrgIds[0];

      try {
        // ============================================
        // STEP 1: Get all implant treatments
        // ============================================
        const { data: implantTreatments, error: treatmentsError } = await (supabase as any)
          .from('treatments')
          .select('id, external_id, treatment_name')
          .eq('organization_id', organizationId)
          .eq('type_of_treatment', 'implant')
          .is('deleted_at', null)
          .eq('is_active', true);

        if (treatmentsError) {
          console.error('[useImplantMonthlyTrends] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }

        if (!implantTreatments || implantTreatments.length === 0) {
          console.log('[useImplantMonthlyTrends] No implant treatments found');
          return [];
        }

        const implantTreatmentExternalIds = implantTreatments
          .map((t: any) => t.external_id)
          .filter((id: any) => id != null)
          .map((id: any) => {
            const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(numId) ? null : numId;
          })
          .filter((id: any) => id != null) as number[];

        if (implantTreatmentExternalIds.length === 0) {
          console.log('[useImplantMonthlyTrends] No implant treatments have external_id');
          return [];
        }

        // ============================================
        // STEP 2: Get patient IDs who have implant treatment plans
        // Link: treatment_plan_items.tpi_treatment_id -> treatments.external_id
        // ============================================
        let implantPatientIds: number[] = [];
        const { data: implantTPIs, error: tpiError } = await (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_patient_id')
          .eq('organization_id', organizationId)
          .in('tpi_treatment_id', implantTreatmentExternalIds)
          .is('deleted_at', null);

        if (!tpiError && implantTPIs) {
          implantPatientIds = Array.from(new Set(
            implantTPIs
              .map((tpi: any) => tpi.tpi_patient_id)
              .filter((id: any) => id != null)
          ));
        }

        // ============================================
        // STEP 3: Generate last 6 months date ranges
        // ============================================
        const now = new Date();
        const months: MonthlyTrendData[] = [];
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
          // Appointments for patients who have implant treatment plans
          // ============================================
          let consultations: any[] = [];
          if (implantPatientIds.length > 0) {
            const { data: consults, error: consultationsError } = await (supabase as any)
              .from('appointments')
              .select('apmt_id')
              .eq('organization_id', organizationId)
              .in('apmt_patient_id', implantPatientIds)
              .gte('apmt_start_time', monthStartInstant)
              .lte('apmt_start_time', monthEndInstant)
              .is('deleted_at', null);

            if (consultationsError) {
              console.error(`[useImplantMonthlyTrends] Error fetching consultations for ${monthLabel}:`, consultationsError);
            } else {
              consultations = consults || [];
            }
          }

          // ============================================
          // STEP 5: Get Actual Cases (completed treatment plan items) for this month
          // ============================================
          let actualCases = 0;
          if (implantTreatmentExternalIds.length > 0) {
            const { data: treatmentPlanItems, error: tpiError } = await (supabase as any)
              .from('treatment_plan_items')
              .select('tpi_id, tpi_patient_id, tpi_completed_at, created_at, tpi_updated_at')
              .eq('organization_id', organizationId)
              .eq('tpi_completed', true)
              .in('tpi_treatment_id', implantTreatmentExternalIds)
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
          const target = 33; // Default target per month

          months.push({
            month: monthLabel,
            actual: actualCases,
            target: target,
            consultations: consultationsCount,
            conversions: conversions,
          });
        }

        console.log('[useImplantMonthlyTrends] Returning monthly trends:', months);
        return months;
      } catch (error) {
        console.error('[useImplantMonthlyTrends] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0,
    retry: 1,
  });
}
