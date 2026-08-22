import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';

export interface ImplantTypePerformance {
  type: string;
  actual: number;
  target: number;
  revenue: number;
  avgValue: number;
}

/**
 * Get Implant performance data by type
 * 
 * Flow:
 * 1. Get all treatments where type_of_treatment = 'implant'
 * 2. Categorize treatments by name patterns:
 *    - Single Implant: treatment_name contains "single" or "one"
 *    - Multiple Implants: treatment_name contains "multiple" or "several"
 *    - All-on-4: treatment_name contains "all-on-4" or "all on 4"
 *    - Bone Grafts: treatment_name contains "bone graft" or "graft"
 * 3. Get treatment plan items for each category
 * 4. Calculate cases, revenue, and average for each type
 */
export function useImplantByType(enabled: boolean = true) {
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

  const filterStartDate = globalDateRange.startDate.toISOString();
  const filterEndDate = globalDateRange.endDate.toISOString();

  return useQuery({
    queryKey: ['implant_by_type', orgIdsKey, filterStartDate, filterEndDate, selectedLocationId],
    queryFn: async (): Promise<ImplantTypePerformance[]> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useImplantByType] No organizationId provided');
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
          console.error('[useImplantByType] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }

        if (!implantTreatments || implantTreatments.length === 0) {
          console.log('[useImplantByType] No implant treatments found');
          return [];
        }

        // ============================================
        // STEP 2: Categorize treatments by name patterns
        // ============================================
        const categorizeTreatment = (treatmentName: string): string | null => {
          const nameLower = treatmentName.toLowerCase();
          
          if (nameLower.includes('all-on-4') || nameLower.includes('all on 4') || nameLower.includes('allon4')) {
            return 'All-on-4';
          }
          if (nameLower.includes('bone graft') || nameLower.includes('graft') && nameLower.includes('bone')) {
            return 'Bone Grafts';
          }
          if (nameLower.includes('multiple') || nameLower.includes('several') || nameLower.includes('multi')) {
            return 'Multiple Implants';
          }
          if (nameLower.includes('single') || nameLower.includes('one') || nameLower.includes('1')) {
            return 'Single Implant';
          }
          
          // Default to Single Implant if no pattern matches
          return 'Single Implant';
        };

        // Group treatments by category
        const treatmentsByCategory = new Map<string, number[]>();
        
        implantTreatments.forEach((treatment: any) => {
          if (!treatment.external_id) return;
          
          const category = categorizeTreatment(treatment.treatment_name || '');
          if (!category) return;
          
          const numId = typeof treatment.external_id === 'string' 
            ? parseInt(treatment.external_id, 10) 
            : Number(treatment.external_id);
          
          if (isNaN(numId)) return;
          
          if (!treatmentsByCategory.has(category)) {
            treatmentsByCategory.set(category, []);
          }
          treatmentsByCategory.get(category)!.push(numId);
        });

        // ============================================
        // STEP 3: Get treatment plan items for each category
        // ============================================
        const categoryStats = new Map<string, {
          cases: Set<number>; // unique patient IDs
          revenue: number;
        }>();

        // Initialize stats for all categories
        const categories = ['Single Implant', 'Multiple Implants', 'All-on-4', 'Bone Grafts'];
        categories.forEach(cat => {
          categoryStats.set(cat, {
            cases: new Set<number>(),
            revenue: 0,
          });
        });

        // Process each category
        for (const [category, treatmentIds] of treatmentsByCategory.entries()) {
          if (treatmentIds.length === 0) continue;

          let tpiQuery = (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_id, tpi_patient_id, tpi_price, tpi_completed, tpi_completed_at, created_at')
            .in('organization_id', effectiveOrgIds)
            .in('tpi_treatment_id', treatmentIds)
            .is('deleted_at', null);

          const { data: allTreatmentPlanItems, error: tpiError } = await tpiQuery;

          // Filter by date range from global filter
          const treatmentPlanItems = (allTreatmentPlanItems || []).filter((tpi: any) => {
            const dateToCheck = tpi.tpi_completed_at || tpi.created_at;
            if (!dateToCheck) return false;
            const itemDate = new Date(dateToCheck);
            return itemDate >= globalDateRange.startDate && itemDate <= globalDateRange.endDate;
          });

          if (tpiError) {
            console.error(`[useImplantByType] Error fetching treatment plan items for ${category}:`, tpiError);
            continue;
          }

          const stats = categoryStats.get(category);
          if (!stats) continue;

          (treatmentPlanItems || []).forEach((tpi: any) => {
            // Count cases (unique patients)
            if (tpi.tpi_patient_id) {
              stats.cases.add(tpi.tpi_patient_id);
            }

            // Add revenue (only for completed items)
            if (tpi.tpi_completed && tpi.tpi_price) {
              stats.revenue += Number(tpi.tpi_price) || 0;
            }
          });
        }

        // ============================================
        // STEP 4: Convert to final format
        // ============================================
        const result: ImplantTypePerformance[] = categories
          .map((category) => {
            const stats = categoryStats.get(category);
            if (!stats) {
              // Return default values if no data
              return {
                type: category,
                actual: 0,
                target: 0, // Keep target from mock data for now
                revenue: 0,
                avgValue: 0,
              };
            }

            const cases = stats.cases.size;
            const revenue = stats.revenue;
            const avgValue = cases > 0 ? revenue / cases : 0;

            // Get dummy target from mock data (can be made configurable later)
            const targetMap: Record<string, number> = {
              'Single Implant': 110,
              'Multiple Implants': 50,
              'All-on-4': 30,
              'Bone Grafts': 10,
            };

            return {
              type: category,
              actual: cases,
              target: targetMap[category] || 0,
              revenue: revenue,
              avgValue: avgValue,
            };
          })
          .filter(item => item.actual > 0 || item.revenue > 0) // Only show categories with data
          .sort((a, b) => b.revenue - a.revenue); // Sort by revenue descending

        console.log('[useImplantByType] Returning implant by type data:', result);
        return result;
      } catch (error) {
        console.error('[useImplantByType] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0,
    retry: 1,
  });
}
