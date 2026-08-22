import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface InvisalignPipelineData {
  consultationsBooked: number;
  consultationsCompleted: number;
  treatmentPlansPresented: number;
  treatmentPlansAccepted: number;
  inProgress: number;
  completed: number;
}

/**
 * Get Invisalign Pipeline data
 * 
 * Flow:
 * 1. Get all treatments where type_of_treatment = 'invisalign' (with external_id)
 * 2. Get all appointments (booked and completed) - Month to Date (MTD)
 * 3. Get treatment plans for invisalign treatments - All time (cumulative)
 * 4. Get treatment plan items for accepted plans - All time (cumulative)
 * 
 * Date Range:
 * - Consultations: Month to Date (current month)
 * - Treatment Plans, Plans Accepted, In Progress, Completed: All time (cumulative)
 */
export function useInvisalignPipeline(enabled: boolean = true) {
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();

  const userOrgIds = useMemo(() => {
    if (allAvailableLocations.length === 0) return organizationId ? [organizationId] : [];
    return [...new Set(allAvailableLocations.map(l => l.organization_id))];
  }, [allAvailableLocations, organizationId]);

  const { dateRange: globalDateRange, selectedLocationId } = useFilters();

  // When a specific location is selected, resolve its organization_id
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

  // Use the global date filter instead of hardcoded MTD.
  // Europe/London day-boundary instants — viewer-independent, unlike
  // toISOString() on local Dates (wrong outside UK browsers).
  const mtdDateRange = {
    startDate: ukDayStartInstant(globalDateRange.startDate),
    endDate: ukDayEndInstant(globalDateRange.endDate),
  };

  return useQuery({
    queryKey: ['invisalign_pipeline', orgIdsKey, mtdDateRange.startDate, mtdDateRange.endDate, selectedLocationId],
    queryFn: async (): Promise<InvisalignPipelineData> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useInvisalignPipeline] No organizationId provided');
        return {
          consultationsBooked: 0,
          consultationsCompleted: 0,
          treatmentPlansPresented: 0,
          treatmentPlansAccepted: 0,
          inProgress: 0,
          completed: 0,
        };
      }

      try {
        console.log(`[useInvisalignPipeline] Date range (MTD): ${mtdDateRange.startDate} to ${mtdDateRange.endDate}`);

        // ============================================
        // STEP 1: Get all invisalign treatments
        // ============================================
        const { data: invisalignTreatments, error: treatmentsError } = await (supabase as any)
          .from('treatments')
          .select('id, external_id, treatment_name')
          .in('organization_id', effectiveOrgIds)
          .eq('type_of_treatment', 'invisalign')
          .is('deleted_at', null)
          .eq('is_active', true);

        if (treatmentsError) {
          console.error('[useInvisalignPipeline] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }

        const invisalignTreatmentExternalIds = invisalignTreatments
          ?.map((t: any) => t.external_id)
          .filter((id: any) => id != null)
          .map((id: any) => {
            const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(numId) ? null : numId;
          })
          .filter((id: any) => id != null) as number[] || [];

        // ============================================
        // STEP 2: Get patient IDs who have invisalign treatment plans
        // Link: treatment_plan_items.tpi_treatment_id -> treatments.external_id
        // ============================================
        let invisalignPatientIds: number[] = [];
        if (invisalignTreatmentExternalIds.length > 0) {
          // Get treatment plan items for invisalign treatments
          let tpiPatientQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_patient_id')
            .in('organization_id', effectiveOrgIds)
            .in('tpi_treatment_id', invisalignTreatmentExternalIds)
            .is('deleted_at', null);



          const { data: invisalignTPIs, error: tpiError } = await tpiPatientQuery;

          if (!tpiError && invisalignTPIs) {
            invisalignPatientIds = Array.from(new Set(
              invisalignTPIs
                .map((tpi: any) => tpi.tpi_patient_id)
                .filter((id: any) => id != null)
            ));
          }
        }

        // ============================================
        // STEP 3: Get Consultations Booked (Month to Date)
        // Appointments for patients who have invisalign treatment plans
        // Filtered by apmt_start_time for current month
        // ============================================
        let consultationsBooked: any[] = [];
        if (invisalignPatientIds.length > 0) {
          let bookedQuery = (supabase as any)
            .from('appointments')
            .select('apmt_id')
            .in('organization_id', effectiveOrgIds)
            .in('apmt_patient_id', invisalignPatientIds)
            .gte('apmt_start_time', mtdDateRange.startDate)
            .lte('apmt_start_time', mtdDateRange.endDate)
            .is('deleted_at', null);



          const { data: booked, error: bookedError } = await bookedQuery;

          if (bookedError) {
            console.error('[useInvisalignPipeline] Error fetching consultations booked:', bookedError);
            throw bookedError;
          }
          consultationsBooked = booked || [];
        }

        // ============================================
        // STEP 4: Get Consultations Completed (Month to Date)
        // Appointments for patients who have invisalign treatment plans, where state = 'Completed'
        // Filtered by apmt_start_time for current month
        // ============================================
        let consultationsCompleted: any[] = [];
        if (invisalignPatientIds.length > 0) {
          let completedQuery = (supabase as any)
            .from('appointments')
            .select('apmt_id')
            .in('organization_id', effectiveOrgIds)
            .eq('apmt_state', 'Completed')
            .in('apmt_patient_id', invisalignPatientIds)
            .gte('apmt_start_time', mtdDateRange.startDate)
            .lte('apmt_start_time', mtdDateRange.endDate)
            .is('deleted_at', null);



          const { data: completed, error: completedError } = await completedQuery;

          if (completedError) {
            console.error('[useInvisalignPipeline] Error fetching consultations completed:', completedError);
            throw completedError;
          }
          consultationsCompleted = completed || [];
        }

        // ============================================
        // STEP 5: Get Treatment Plans Presented (All Time - Cumulative)
        // Count distinct treatment plans that contain invisalign treatment plan items
        // Link: treatment_plan_items.tpi_treatment_plan_id -> treatment_plans.tp_id
        // Filter: treatment_plan_items.tpi_treatment_id IN (invisalign treatment external_ids)
        // This is cumulative/all-time data, not filtered by date
        // ============================================
        let treatmentPlansPresented = 0;
        if (invisalignTreatmentExternalIds.length > 0) {
          // Get unique treatment plan IDs from treatment plan items for invisalign treatments
          let tpiPlansQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_treatment_plan_id')
            .in('organization_id', effectiveOrgIds)
            .in('tpi_treatment_id', invisalignTreatmentExternalIds)
            .not('tpi_treatment_plan_id', 'is', null)
            .is('deleted_at', null);



          const { data: invisalignTPIs, error: tpiError } = await tpiPlansQuery;

          if (tpiError) {
            console.error('[useInvisalignPipeline] Error fetching treatment plan items for plans count:', tpiError);
            throw tpiError;
          }

          // Get unique treatment plan IDs
          const uniqueTreatmentPlanIds = Array.from(new Set(
            (invisalignTPIs || [])
              .map((tpi: any) => tpi.tpi_treatment_plan_id)
              .filter((id: any) => id != null)
              .map((id: any) => {
                const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
                return isNaN(numId) ? null : numId;
              })
              .filter((id: any) => id != null)
          )) as number[];

          // Count distinct treatment plans
          if (uniqueTreatmentPlanIds.length > 0) {
            const { data: treatmentPlans, error: plansError } = await (supabase as any)
              .from('treatment_plans')
              .select('tp_id')
              .in('organization_id', effectiveOrgIds)
              .in('tp_id', uniqueTreatmentPlanIds)
              .is('deleted_at', null);

            if (plansError) {
              console.error('[useInvisalignPipeline] Error fetching treatment plans:', plansError);
              throw plansError;
            }
            treatmentPlansPresented = treatmentPlans?.length || 0;
            console.log(`[useInvisalignPipeline] Found ${treatmentPlansPresented} treatment plans with invisalign items (from ${uniqueTreatmentPlanIds.length} unique plan IDs)`);
          } else {
            console.log('[useInvisalignPipeline] No treatment plan items found for invisalign treatments');
          }
        }

        // ============================================
        // STEP 6: Get Treatment Plans Accepted (All Time - Cumulative)
        // Treatment plan items that are completed for invisalign treatments
        // This is cumulative/all-time data, not filtered by date
        // ============================================
        let treatmentPlansAccepted = 0;
        if (invisalignTreatmentExternalIds.length > 0) {
          let acceptedQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id')
            .in('organization_id', effectiveOrgIds)
            .eq('tpi_completed', true)
            .in('tpi_treatment_id', invisalignTreatmentExternalIds)
            .is('deleted_at', null);



          const { data: acceptedPlans, error: acceptedError } = await acceptedQuery;

          if (acceptedError) {
            console.error('[useInvisalignPipeline] Error fetching accepted plans:', acceptedError);
          } else {
            treatmentPlansAccepted = acceptedPlans?.length || 0;
          }
        }

        // ============================================
        // STEP 7: Get In Progress and Completed (All Time - Cumulative)
        // Treatment plan items that are in progress (not completed) and completed
        // This is cumulative/all-time data showing current state
        // ============================================
        let inProgress = 0;
        let completed = 0;

        if (invisalignTreatmentExternalIds.length > 0) {
          let inProgressQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id')
            .in('organization_id', effectiveOrgIds)
            .eq('tpi_completed', false)
            .in('tpi_treatment_id', invisalignTreatmentExternalIds)
            .is('deleted_at', null);

          let completedQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id')
            .in('organization_id', effectiveOrgIds)
            .eq('tpi_completed', true)
            .in('tpi_treatment_id', invisalignTreatmentExternalIds)
            .is('deleted_at', null);



          const { data: inProgressItems, error: inProgressError } = await inProgressQuery;
          const { data: completedItems, error: completedError } = await completedQuery;

          if (!inProgressError) {
            inProgress = inProgressItems?.length || 0;
          }
          if (!completedError) {
            completed = completedItems?.length || 0;
          }
        }

        const result: InvisalignPipelineData = {
          consultationsBooked: consultationsBooked.length || 0,
          consultationsCompleted: consultationsCompleted.length || 0,
          treatmentPlansPresented: treatmentPlansPresented,
          treatmentPlansAccepted: treatmentPlansAccepted,
          inProgress: inProgress,
          completed: completed,
        };

        console.log('[useInvisalignPipeline] Pipeline data:', result);
        return result;
      } catch (error) {
        console.error('[useInvisalignPipeline] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0,
    retry: 1,
  });
}
