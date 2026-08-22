import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useLocations } from './useLocations';
import { useFilters } from '@/contexts/FilterContext';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface ImplantLocationPerformance {
  location: string;
  locationId: string;
  actual: number; // Month to date completed cases (unique patients)
  target: number; // From treatment_goal_targets table
  gap: number; // Calculated from actual - target
  revenue: number; // Dynamic - sum of tpi_price for completed items
  conversion: number; // Completed cases / total cases in period (%)
}

/**
 * Get implant surgeons performance data by location
 *
 * Flow:
 * 1. Get all locations
 * 2. Get implant treatments (type_of_treatment = 'implant')
 * 3. Get treatment plan items for implant treatments, filtered by:
 *    - Month to date (tpi_completed_at in current month)
 *    - Grouped by location_id
 * 4. Calculate cases (unique patients) and revenue per location
 * 5. Fetch real targets from treatment_goal_targets table
 * 6. Calculate conversion rate from completed vs total treatment plan items
 */
export function useImplantSurgeonsByLocation(enabled: boolean = true) {
  const { organizationId } = useOrganization();
  const { allAvailableLocations } = useLocations();
  const { dateRange: globalDateRange, selectedLocationId } = useFilters();

  const userOrgIds = useMemo(() => {
    if (allAvailableLocations.length === 0) return organizationId ? [organizationId] : [];
    return [...new Set(allAvailableLocations.map(l => l.organization_id))];
  }, [allAvailableLocations, organizationId]);

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

  // Use the global date filter
  // Europe/London day-boundary instants — viewer-independent, unlike
  // toISOString() on local Dates (wrong outside UK browsers).
  const filterStartDate = ukDayStartInstant(globalDateRange.startDate);
  const filterEndDate = ukDayEndInstant(globalDateRange.endDate);

  return useQuery({
    queryKey: ['implant_surgeons_by_location', orgIdsKey, filterStartDate, filterEndDate, selectedLocationId],
    queryFn: async (): Promise<ImplantLocationPerformance[]> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useImplantSurgeonsByLocation] No organizationId provided');
        return [];
      }

      const dateRange = {
        startDate: filterStartDate,
        endDate: filterEndDate,
      };

      // Period string for target lookup (M-YYYY format) based on filter start date
      const filterDate = globalDateRange.startDate;
      const currentMonthStr = `${filterDate.getMonth() + 1}-${filterDate.getFullYear()}`;

      // Use combined locations list
      const allLocations = allAvailableLocations;

      console.log(`[useImplantSurgeonsByLocation] Date range (MTD): ${dateRange.startDate} to ${dateRange.endDate}`);
      console.log(`[useImplantSurgeonsByLocation] Locations available: ${allLocations.length}`);

      if (allLocations.length === 0) {
        console.log('[useImplantSurgeonsByLocation] No locations found. Make sure locations are synced from Dentally.');
        return [];
      }

      try {
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
          console.error('[useImplantSurgeonsByLocation] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }

        if (!implantTreatments || implantTreatments.length === 0) {
          console.log('[useImplantSurgeonsByLocation] No implant treatments found');
          return [];
        }

        // Get implant treatment external_ids
        const implantTreatmentExternalIds = implantTreatments
          .map((t: any) => t.external_id)
          .filter((id: any) => id != null)
          .map((id: any) => {
            const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(numId) ? null : numId;
          })
          .filter((id: any) => id != null) as number[];

        if (implantTreatmentExternalIds.length === 0) {
          console.log('[useImplantSurgeonsByLocation] No implant treatments have external_id');
          return [];
        }

        // ============================================
        // STEP 2: Get Treatment Plan Items for current month (MTD)
        // ============================================
        let tpiQuery = (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_id, tpi_patient_id, tpi_treatment_id, tpi_completed_at, tpi_completed, tpi_price, location_id, created_at, tpi_updated_at')
          .in('organization_id', effectiveOrgIds)
          .in('tpi_treatment_id', implantTreatmentExternalIds)
          .is('deleted_at', null);

        const { data: allTreatmentPlanItems, error: tpiError } = await tpiQuery;

        if (tpiError) {
          console.error('[useImplantSurgeonsByLocation] Error fetching treatment plan items:', tpiError);
          throw tpiError;
        }

        // Filter by month-to-date (current month)
        const mtdTreatmentPlanItems = (allTreatmentPlanItems || []).filter((tpi: any) => {
          const dateToCheck = tpi.tpi_completed_at || tpi.created_at || tpi.tpi_updated_at;
          if (!dateToCheck) return false;

          const itemDate = new Date(dateToCheck);
          const startDate = new Date(dateRange.startDate);
          const endDate = new Date(dateRange.endDate);

          return itemDate >= startDate && itemDate <= endDate;
        });

        console.log(`[useImplantSurgeonsByLocation] Found ${mtdTreatmentPlanItems.length} MTD treatment plan items from ${allTreatmentPlanItems?.length || 0} total`);

        // ============================================
        // STEP 2b: Get completed appointments for implant patients in date range.
        // Actual = unique patients with completed appointments per location.
        // Appointments have location_id (from Dentally site_id mapping).
        // ============================================
        const implantPatientIds = Array.from(new Set(
          (allTreatmentPlanItems || [])
            .map((tpi: any) => tpi.tpi_patient_id)
            .filter((id: any) => id != null)
        ));

        const completedApptsByLocation = new Map<string, Set<number>>();
        const patientLocationMap = new Map<number, string>();

        if (implantPatientIds.length > 0) {
          const PAGE_SIZE = 1000;
          let from = 0;
          let hasMore = true;
          while (hasMore) {
            const { data: appts, error: apptError } = await (supabase as any)
              .from('appointments')
              .select('apmt_patient_id, location_id')
              .in('organization_id', effectiveOrgIds)
              .in('apmt_patient_id', implantPatientIds)
              .eq('apmt_state', 'Completed')
              .gte('apmt_start_time', dateRange.startDate)
              .lte('apmt_start_time', dateRange.endDate)
              .not('location_id', 'is', null)
              .is('deleted_at', null)
              .range(from, from + PAGE_SIZE - 1);
            if (apptError) {
              console.error('[useImplantSurgeonsByLocation] Error fetching completed appointments:', apptError);
              break;
            }
            const rows = appts || [];
            for (const appt of rows) {
              if (appt.apmt_patient_id != null && appt.location_id) {
                const pid = typeof appt.apmt_patient_id === 'string' ? parseInt(appt.apmt_patient_id, 10) : Number(appt.apmt_patient_id);
                if (!isNaN(pid)) {
                  patientLocationMap.set(pid, appt.location_id);
                  if (!completedApptsByLocation.has(appt.location_id)) {
                    completedApptsByLocation.set(appt.location_id, new Set());
                  }
                  completedApptsByLocation.get(appt.location_id)!.add(pid);
                }
              }
            }
            hasMore = rows.length === PAGE_SIZE;
            from += PAGE_SIZE;
          }
          console.log(`[useImplantSurgeonsByLocation] Completed appointments: ${completedApptsByLocation.size} locations, ${patientLocationMap.size} patients`);
        }

        // ============================================
        // STEP 3: Aggregate by location
        // Actual = unique patients with completed appointments per location
        // Revenue = sum of tpi_price from completed TPIs, resolved to location via patient→location map
        // ============================================
        const locationStats = new Map<string, {
          locationId: string;
          completedCases: Set<number>;
          revenue: number;
        }>();

        // Initialize stats for all locations
        allLocations.forEach((location) => {
          locationStats.set(location.id, {
            locationId: location.id,
            completedCases: completedApptsByLocation.get(location.id) ?? new Set<number>(),
            revenue: 0,
          });
        });

        // Aggregate revenue from completed treatment plan items
        let itemsWithoutLocation = 0;
        mtdTreatmentPlanItems.forEach((tpi: any) => {
          if (tpi.tpi_completed !== true || !tpi.tpi_completed_at) return;
          if (!tpi.tpi_price) return;

          let resolvedLocationId = tpi.location_id;
          if (!resolvedLocationId && tpi.tpi_patient_id != null) {
            const pid = typeof tpi.tpi_patient_id === 'string' ? parseInt(tpi.tpi_patient_id, 10) : Number(tpi.tpi_patient_id);
            if (!isNaN(pid)) {
              resolvedLocationId = patientLocationMap.get(pid) ?? null;
            }
          }

          if (!resolvedLocationId) {
            itemsWithoutLocation++;
            return;
          }

          const stats = locationStats.get(resolvedLocationId);
          if (stats) {
            stats.revenue += Number(tpi.tpi_price) || 0;
          }
        });

        if (itemsWithoutLocation > 0) {
          console.log(`[useImplantSurgeonsByLocation] Warning: ${itemsWithoutLocation} completed TPIs have no resolved location`);
        }

        // ============================================
        // STEP 4: Fetch real targets from treatment_goal_targets
        // ============================================
        // First try per-location targets
        const locationIds = allLocations.map(l => l.id);
        const { data: perLocationTargets } = await (supabase as any)
          .from('treatment_goal_targets')
          .select('location_id, unit_target')
          .in('organization_id', effectiveOrgIds)
          .eq('category_name', 'Implants - Luke')
          .eq('period_type', 'month')
          .eq('period_date', currentMonthStr)
          .in('location_id', locationIds);

        // Build a map of location_id -> unit_target
        const locationTargetMap = new Map<string, number>();
        if (perLocationTargets && perLocationTargets.length > 0) {
          perLocationTargets.forEach((t: any) => {
            if (t.location_id) {
              locationTargetMap.set(t.location_id, t.unit_target ?? 0);
            }
          });
        }

        // Fallback: org-wide target (location_id IS NULL)
        let orgWideTarget = 0;
        if (locationTargetMap.size === 0) {
          const { data: orgTarget } = await (supabase as any)
            .from('treatment_goal_targets')
            .select('unit_target')
            .in('organization_id', effectiveOrgIds)
            .eq('category_name', 'Implants - Luke')
            .eq('period_type', 'month')
            .eq('period_date', currentMonthStr)
            .is('location_id', null)
            .maybeSingle();

          if (orgTarget) {
            orgWideTarget = orgTarget.unit_target ?? 0;
          } else {
            // Fallback to most recent target for this category
            const { data: fallbackTarget } = await (supabase as any)
              .from('treatment_goal_targets')
              .select('unit_target')
              .in('organization_id', effectiveOrgIds)
              .eq('category_name', 'Implants - Luke')
              .eq('period_type', 'month')
              .is('location_id', null)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (fallbackTarget) {
              orgWideTarget = fallbackTarget.unit_target ?? 0;
            }
          }
        }

        console.log(`[useImplantSurgeonsByLocation] Targets - per-location: ${locationTargetMap.size}, org-wide: ${orgWideTarget}`);

        // ============================================
        // STEP 5: Convert to final format
        // Show ALL locations, even if they have no activity
        // ============================================
        console.log(`[useImplantSurgeonsByLocation] Processing ${allLocations.length} locations`);
        console.log(`[useImplantSurgeonsByLocation] Location stats map has ${locationStats.size} entries`);

        const result: ImplantLocationPerformance[] = allLocations
          .map((location) => {
            const stats = locationStats.get(location.id);

            const completedCases = stats ? stats.completedCases.size : 0;
            const revenue = stats ? stats.revenue : 0;

            // Get target: per-location first, then org-wide fallback
            const target = locationTargetMap.get(location.id) ?? orgWideTarget;

            // Conversion: actual / target (%)
            const conversion = target > 0
              ? Math.round((completedCases / target) * 100)
              : 0;

            return {
              location: location.location_name,
              locationId: location.id,
              actual: completedCases,
              target,
              gap: completedCases - target,
              revenue,
              conversion,
            };
          })
          .sort((a, b) => {
            // Sort by revenue descending, but show all locations
            if (b.revenue !== a.revenue) {
              return b.revenue - a.revenue;
            }
            // If revenue is same, sort by location name
            return a.location.localeCompare(b.location);
          });

        console.log(`[useImplantSurgeonsByLocation] Returning ${result.length} locations (including locations with no activity)`);
        console.log(`[useImplantSurgeonsByLocation] Sample locations:`, result.slice(0, 3).map(l => ({ name: l.location, cases: l.actual, target: l.target, revenue: l.revenue, conversion: l.conversion })));

        return result;
      } catch (error) {
        console.error('[useImplantSurgeonsByLocation] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0 && allAvailableLocations.length > 0,
    retry: 1,
  });
}
