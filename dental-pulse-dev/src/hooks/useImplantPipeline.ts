import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface ImplantPipelineData {
  consultationsBooked: number;
  consultationsCompleted: number;
  ctScansCompleted: number;
  treatmentPlansPresented: number;
  treatmentPlansAccepted: number;
  surgeriesScheduled: number;
  inProgress: number;
  completed: number;
}

/**
 * Get Implant Pipeline data
 * 
 * Flow:
 * 1. Get all treatments where type_of_treatment = 'implant' (with external_id)
 * 2. Get all appointments (booked and completed) - Month to Date (MTD)
 * 3. Get appointments for CT scans (scan type_of_treatment or reason contains "scan" or "ct") - Month to Date (MTD)
 * 4. Get treatment plans for implant treatments - All time (cumulative)
 * 5. Get treatment plan items for accepted plans - All time (cumulative)
 * 
 * Date Range:
 * - Consultations, CT Scans, Surgeries: Month to Date (current month)
 * - Treatment Plans, Plans Accepted, In Progress, Completed: All time (cumulative)
 */
export function useImplantPipeline(enabled: boolean = true) {
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

  // Use the global date filter instead of hardcoded MTD
  // Europe/London day-boundary instants — viewer-independent, unlike
  // toISOString() on local Dates (wrong outside UK browsers).
  const mtdDateRange = {
    startDate: ukDayStartInstant(globalDateRange.startDate),
    endDate: ukDayEndInstant(globalDateRange.endDate),
  };

  return useQuery({
    queryKey: ['implant_pipeline', orgIdsKey, mtdDateRange.startDate, mtdDateRange.endDate, selectedLocationId],
    queryFn: async (): Promise<ImplantPipelineData> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useImplantPipeline] No organizationId provided');
        return {
          consultationsBooked: 0,
          consultationsCompleted: 0,
          ctScansCompleted: 0,
          treatmentPlansPresented: 0,
          treatmentPlansAccepted: 0,
          surgeriesScheduled: 0,
          inProgress: 0,
          completed: 0,
        };
      }

      try {
        console.log(`[useImplantPipeline] Date range (MTD): ${mtdDateRange.startDate} to ${mtdDateRange.endDate}`);

        // ============================================
        // STEP 1: Get all implant treatments
        // ============================================
        const { data: implantTreatments, error: treatmentsError } = await (supabase as any)
          .from('treatments')
          .select('id, external_id, treatment_name')
          .in('organization_id', effectiveOrgIds)
          .eq('type_of_treatment', 'implant')
          .is('deleted_at', null)
          .eq('is_active', true);

        if (treatmentsError) {
          console.error('[useImplantPipeline] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }

        const implantTreatmentExternalIds = implantTreatments
          ?.map((t: any) => t.external_id)
          .filter((id: any) => id != null)
          .map((id: any) => {
            const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(numId) ? null : numId;
          })
          .filter((id: any) => id != null) as number[] || [];

        // ============================================
        // STEP 2: Get patient IDs who have implant treatment plans
        // Link: treatment_plan_items.tpi_treatment_id -> treatments.external_id
        // ============================================
        let implantPatientIds: number[] = [];
        if (implantTreatmentExternalIds.length > 0) {
          // Get treatment plan items for implant treatments
          let tpiPatientQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_patient_id')
            .in('organization_id', effectiveOrgIds)
            .in('tpi_treatment_id', implantTreatmentExternalIds)
            .is('deleted_at', null);



          const { data: implantTPIs, error: tpiError } = await tpiPatientQuery;

          if (!tpiError && implantTPIs) {
            implantPatientIds = Array.from(new Set(
              implantTPIs
                .map((tpi: any) => tpi.tpi_patient_id)
                .filter((id: any) => id != null)
            ));
          }
        }

        // ============================================
        // STEP 3: Get Consultations Booked (Month to Date)
        // Appointments for patients who have implant treatment plans
        // Filtered by apmt_start_time for current month
        // ============================================
        let consultationsBooked: any[] = [];
        if (implantPatientIds.length > 0) {
          let bookedQuery = (supabase as any)
            .from('appointments')
            .select('apmt_id')
            .in('organization_id', effectiveOrgIds)
            .in('apmt_patient_id', implantPatientIds)
            .gte('apmt_start_time', mtdDateRange.startDate)
            .lte('apmt_start_time', mtdDateRange.endDate)
            .is('deleted_at', null);



          const { data: booked, error: bookedError } = await bookedQuery;

          if (bookedError) {
            console.error('[useImplantPipeline] Error fetching consultations booked:', bookedError);
            throw bookedError;
          }
          consultationsBooked = booked || [];
        }

        // ============================================
        // STEP 4: Get Consultations Completed (Month to Date)
        // Appointments for patients who have implant treatment plans, where state = 'Completed'
        // Filtered by apmt_start_time for current month
        // ============================================
        let consultationsCompleted: any[] = [];
        if (implantPatientIds.length > 0) {
          let completedQuery = (supabase as any)
            .from('appointments')
            .select('apmt_id')
            .in('organization_id', effectiveOrgIds)
            .eq('apmt_state', 'Completed')
            .in('apmt_patient_id', implantPatientIds)
            .gte('apmt_start_time', mtdDateRange.startDate)
            .lte('apmt_start_time', mtdDateRange.endDate)
            .is('deleted_at', null);



          const { data: completed, error: completedError } = await completedQuery;

          if (completedError) {
            console.error('[useImplantPipeline] Error fetching consultations completed:', completedError);
            throw completedError;
          }
          consultationsCompleted = completed || [];
        }

        // ============================================
        // STEP 5: Get CT Scans Completed (Month to Date)
        // Appointments for patients who have implant treatment plans, where reason contains "scan" or "ct" and state = 'Completed'
        // Filtered by apmt_start_time for current month
        // ============================================
        let ctScans: any[] = [];
        if (implantPatientIds.length > 0) {
          let scansQuery = (supabase as any)
            .from('appointments')
            .select('apmt_id')
            .in('organization_id', effectiveOrgIds)
            .eq('apmt_state', 'Completed')
            .in('apmt_patient_id', implantPatientIds)
            .or('apmt_reason.ilike.%scan%,apmt_reason.ilike.%ct%,apmt_reason.ilike.%scanning%')
            .gte('apmt_start_time', mtdDateRange.startDate)
            .lte('apmt_start_time', mtdDateRange.endDate)
            .is('deleted_at', null);



          const { data: scans, error: scansError } = await scansQuery;

          if (scansError) {
            console.error('[useImplantPipeline] Error fetching CT scans:', scansError);
            throw scansError;
          }
          ctScans = scans || [];
        }

        // ============================================
        // STEP 6: Get Treatment Plans Presented (All Time - Cumulative)
        // Count distinct treatment plans that contain implant treatment plan items
        // Link: treatment_plan_items.tpi_treatment_plan_id -> treatment_plans.tp_id
        // Filter: treatment_plan_items.tpi_treatment_id IN (implant treatment external_ids)
        // This is cumulative/all-time data, not filtered by date
        // ============================================
        let treatmentPlansPresented = 0;
        if (implantTreatmentExternalIds.length > 0) {
          // Get unique treatment plan IDs from treatment plan items for implant treatments
          let tpiPlansQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_treatment_plan_id')
            .in('organization_id', effectiveOrgIds)
            .in('tpi_treatment_id', implantTreatmentExternalIds)
            .not('tpi_treatment_plan_id', 'is', null)
            .is('deleted_at', null);



          const { data: implantTPIs, error: tpiError } = await tpiPlansQuery;

          if (tpiError) {
            console.error('[useImplantPipeline] Error fetching treatment plan items for plans count:', tpiError);
            throw tpiError;
          }

          // Get unique treatment plan IDs
          const uniqueTreatmentPlanIds = Array.from(new Set(
            (implantTPIs || [])
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
              console.error('[useImplantPipeline] Error fetching treatment plans:', plansError);
              throw plansError;
            }
            treatmentPlansPresented = treatmentPlans?.length || 0;
            console.log(`[useImplantPipeline] Found ${treatmentPlansPresented} treatment plans with implant items (from ${uniqueTreatmentPlanIds.length} unique plan IDs)`);
          } else {
            console.log('[useImplantPipeline] No treatment plan items found for implant treatments');
          }
        }

        // ============================================
        // STEP 7: Get Treatment Plans Accepted (All Time - Cumulative)
        // Treatment plan items that are completed for implant treatments
        // This is cumulative/all-time data, not filtered by date
        // ============================================
        let treatmentPlansAccepted = 0;
        if (implantTreatmentExternalIds.length > 0) {
          let acceptedQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id')
            .in('organization_id', effectiveOrgIds)
            .eq('tpi_completed', true)
            .in('tpi_treatment_id', implantTreatmentExternalIds)
            .is('deleted_at', null);



          const { data: acceptedPlans, error: acceptedError } = await acceptedQuery;

          if (acceptedError) {
            console.error('[useImplantPipeline] Error fetching accepted plans:', acceptedError);
          } else {
            treatmentPlansAccepted = acceptedPlans?.length || 0;
          }
        }

        // ============================================
        // STEP 8: Get Surgeries Scheduled (Month to Date)
        // Appointments for patients who have implant treatment plans, with state = 'Confirmed' or 'Pending'
        // Filtered by apmt_start_time for current month
        // ============================================
        let surgeriesScheduled: any[] = [];
        if (implantPatientIds.length > 0) {
          let surgeriesQuery = (supabase as any)
            .from('appointments')
            .select('apmt_id')
            .in('organization_id', effectiveOrgIds)
            .in('apmt_state', ['Confirmed', 'Pending'])
            .in('apmt_patient_id', implantPatientIds)
            .or('apmt_reason.ilike.%surgery%,apmt_reason.ilike.%implant%,apmt_treatment_description.ilike.%implant%')
            .gte('apmt_start_time', mtdDateRange.startDate)
            .lte('apmt_start_time', mtdDateRange.endDate)
            .is('deleted_at', null);



          const { data: surgeries, error: surgeriesError } = await surgeriesQuery;

          if (surgeriesError) {
            console.error('[useImplantPipeline] Error fetching surgeries scheduled:', surgeriesError);
            throw surgeriesError;
          }
          surgeriesScheduled = surgeries || [];
        }

        // ============================================
        // STEP 9: Get In Progress and Completed (All Time - Cumulative)
        // Treatment plan items that are in progress (not completed) and completed
        // This is cumulative/all-time data showing current state
        // ============================================
        let inProgress = 0;
        let completed = 0;

        if (implantTreatmentExternalIds.length > 0) {
          let inProgressQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id')
            .in('organization_id', effectiveOrgIds)
            .eq('tpi_completed', false)
            .in('tpi_treatment_id', implantTreatmentExternalIds)
            .is('deleted_at', null);

          let completedQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id')
            .in('organization_id', effectiveOrgIds)
            .eq('tpi_completed', true)
            .in('tpi_treatment_id', implantTreatmentExternalIds)
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

        const result: ImplantPipelineData = {
          consultationsBooked: consultationsBooked.length || 0,
          consultationsCompleted: consultationsCompleted.length || 0,
          ctScansCompleted: ctScans.length || 0,
          treatmentPlansPresented: treatmentPlansPresented,
          treatmentPlansAccepted: treatmentPlansAccepted,
          surgeriesScheduled: surgeriesScheduled.length || 0,
          inProgress: inProgress,
          completed: completed,
        };

        console.log('[useImplantPipeline] Pipeline data:', result);
        return result;
      } catch (error) {
        console.error('[useImplantPipeline] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0,
    retry: 1,
  });
}
