import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface InvisalignProvider {
  providerId: string;
  name: string;
  cases: number;
  revenue: number;
  conversion: number;
  rating?: number; // Optional rating field
}

/**
 * Get Invisalign providers data
 *
 * Flow:
 * 1. Get all treatments where type_of_treatment = 'invisalign' (with external_id = Dentally treatment_id)
 * 2. Get treatment_plan_items where tpi_treatment_id matches treatment external_id
 * 3. Extract tpi_practitioner_id from treatment_plan_items
 * 4. Match tpi_practitioner_id to providers.external_id to get provider names
 * 5. Aggregate metrics (cases, revenue, conversion) per provider
 *
 * Key Relationships:
 * - treatments.external_id = Dentally treatment_id
 * - treatment_plan_items.tpi_treatment_id = Dentally treatment_id (matches treatments.external_id)
 * - treatment_plan_items.tpi_practitioner_id = Dentally practitioner_id
 * - providers.external_id = Dentally practitioner_id (matches tpi_practitioner_id)
 */
export function useInvisalignProviders(startDate?: Date | null, endDate?: Date | null, enabled: boolean = true) {
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

  // Default to "Last 12 Months" if no date range provided
  const getDefaultDateRange = () => {
    const now = new Date();
    const defaultEndDate = endDate || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    defaultEndDate.setHours(23, 59, 59, 999);
    
    const defaultStartDate = startDate || new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    defaultStartDate.setHours(0, 0, 0, 0);
    
    return {
      // Europe/London day-boundary instants — viewer-independent, unlike
      // toISOString() on local Dates (wrong outside UK browsers).
      startDate: ukDayStartInstant(defaultStartDate),
      endDate: ukDayEndInstant(defaultEndDate),
    };
  };

  const dateRange = getDefaultDateRange();

  return useQuery({
    queryKey: ['invisalign_providers', orgIdsKey, dateRange.startDate, dateRange.endDate, selectedLocationId],
    queryFn: async (): Promise<InvisalignProvider[]> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useInvisalignProviders] No organizationId provided');
        return [];
      }
      const organizationId = effectiveOrgIds[0];

      console.log(`[useInvisalignProviders] Date range: ${dateRange.startDate} to ${dateRange.endDate}`);

      try {
        // ============================================
        // STEP 1: Get all treatments where type_of_treatment = 'invisalign'
        // ============================================
        const { data: invisalignTreatments, error: treatmentsError } = await (supabase as any)
          .from('treatments')
          .select('id, external_id, treatment_name')
          .eq('organization_id', organizationId)
          .eq('type_of_treatment', 'invisalign')
          .is('deleted_at', null)
          .eq('is_active', true);

        if (treatmentsError) {
          console.error('[useInvisalignProviders] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }
        
        if (!invisalignTreatments || invisalignTreatments.length === 0) {
          console.warn('[useInvisalignProviders] ❌ No invisalign treatments found.');
          console.warn('[useInvisalignProviders] 📋 Solution: Go to "Treatment Settings" tab and assign "Invisalign" as treatment type to your Invisalign treatments.');
          return [];
        }

        console.log(`[useInvisalignProviders] Found ${invisalignTreatments.length} invisalign treatments`);
        
        // Get invisalign treatment external_ids (Dentally treatment_id)
        const invisalignTreatmentExternalIds = invisalignTreatments
          .map((t: any) => t.external_id)
          .filter((id: any) => id != null)
          .map((id: any) => {
            const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(numId) ? null : numId;
          })
          .filter((id: any) => id != null) as number[];

        if (invisalignTreatmentExternalIds.length === 0) {
          console.warn('[useInvisalignProviders] ❌ No invisalign treatments have external_id values.');
          console.warn('[useInvisalignProviders] 📋 Solution: Run Dentally sync for "treatments" to populate external_id field.');
          console.warn('[useInvisalignProviders] 💡 The external_id is required to match treatment plan items (tpi_treatment_id).');
          return [];
        }
        
        console.log(`[useInvisalignProviders] Looking for treatment_plan_items with tpi_treatment_id in: [${invisalignTreatmentExternalIds.slice(0, 5).join(', ')}${invisalignTreatmentExternalIds.length > 5 ? '...' : ''}]`);

        // ============================================
        // STEP 2: Get Treatment Plan Items for invisalign treatments
        // Only include COMPLETED items to match Dentally's "Completed on" filter
        // ============================================
        const { data: allTreatmentPlanItems, error: tpiError } = await (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_id, tpi_patient_id, tpi_practitioner_id, tpi_completed, tpi_charged, tpi_price, tpi_treatment_id, tpi_completed_at, created_at, tpi_updated_at')
          .eq('organization_id', organizationId)
          .in('tpi_treatment_id', invisalignTreatmentExternalIds)
          .eq('tpi_completed', true)
          .is('deleted_at', null);

        if (tpiError) {
          console.error('[useInvisalignProviders] Error fetching treatment plan items:', tpiError);
          throw tpiError;
        }

        console.log(`[useInvisalignProviders] Found ${allTreatmentPlanItems?.length || 0} total treatment plan items before date filtering`);

        // Filter by date range using tpi_completed_at only (no fallbacks)
        let treatmentPlanItems = allTreatmentPlanItems || [];

        if (dateRange.startDate && dateRange.endDate) {
          treatmentPlanItems = treatmentPlanItems.filter((tpi: any) => {
            if (!tpi.tpi_completed_at) return false;

            const itemDate = new Date(tpi.tpi_completed_at);
            const startDate = new Date(dateRange.startDate);
            const endDate = new Date(dateRange.endDate);

            return itemDate >= startDate && itemDate <= endDate;
          });
        }

        console.log(`[useInvisalignProviders] After filtering: ${treatmentPlanItems.length} items from ${allTreatmentPlanItems?.length || 0} total`);
        
        if (!treatmentPlanItems || treatmentPlanItems.length === 0) {
          console.warn('[useInvisalignProviders] ❌ No treatment plan items found for invisalign treatments.');
          console.warn('[useInvisalignProviders] 📋 Solution: Run Dentally sync for "treatment_plan_items" to sync treatment plans.');
          console.warn('[useInvisalignProviders] 💡 Treatment plan items must have tpi_treatment_id matching treatment external_id.');
          return [];
        }

        console.log(`[useInvisalignProviders] Found ${treatmentPlanItems.length} treatment plan items for invisalign treatments`);

        // Get unique practitioner IDs from treatment plan items
        const practitionerIds = Array.from(new Set(
          treatmentPlanItems
            .map((tpi: any) => tpi.tpi_practitioner_id)
            .filter((id: any) => id != null)
            .map((id: any) => {
              return typeof id === 'string' ? parseInt(id, 10) : Number(id);
            })
            .filter((id: any) => !isNaN(id))
        )) as number[];

        if (practitionerIds.length === 0) {
          console.warn('[useInvisalignProviders] ❌ No practitioner_id values found in treatment plan items.');
          console.warn('[useInvisalignProviders] 📋 Solution: Ensure treatment plan items have tpi_practitioner_id populated from Dentally sync.');
          return [];
        }
        
        console.log(`[useInvisalignProviders] Found ${practitionerIds.length} unique practitioner IDs`);

        // ============================================
        // STEP 3: Get Providers (to get provider names)
        // ============================================
        const { data: providers, error: providersError } = await (supabase as any)
          .from('providers')
          .select('id, name, external_id')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .in('external_id', practitionerIds);

        if (providersError) {
          console.error('[useInvisalignProviders] Error fetching providers:', providersError);
          throw providersError;
        }
        
        if (!providers || providers.length === 0) {
          console.warn('[useInvisalignProviders] ❌ No providers found with matching external_id.');
          console.warn('[useInvisalignProviders] 📋 Solution: Run Dentally sync for "practitioners" to sync providers.');
          console.warn('[useInvisalignProviders] 💡 Provider external_id must match treatment plan item tpi_practitioner_id.');
          return [];
        }

        console.log(`[useInvisalignProviders] Found ${providers.length} providers with invisalign treatments`);

        // Create a map: practitioner_id (external_id) -> provider
        const providerByPractitionerId = new Map(
          providers.map((p: any) => [p.external_id, p])
        );

        // ============================================
        // STEP 4: Get Consultations for Conversion Rate
        // ============================================
        const { data: consultations, error: consultationsError } = await (supabase as any)
          .from('appointments')
          .select('apmt_id, apmt_practitioner_id, apmt_reason, apmt_start_time')
          .eq('organization_id', organizationId)
          .in('apmt_practitioner_id', practitionerIds)
          .or('apmt_reason.ilike.%consultation%,apmt_reason.ilike.%consult%')
          .gte('apmt_start_time', dateRange.startDate)
          .lte('apmt_start_time', dateRange.endDate)
          .is('deleted_at', null);

        if (consultationsError) throw consultationsError;

        // ============================================
        // STEP 5: Aggregate Data by Provider
        // ============================================
        const providerStats = new Map<string, {
          name: string;
          cases: Set<number>; // unique patient IDs
          revenue: number;
          consultations: number;
          acceptedPlans: number;
        }>();

        // Initialize stats for all providers
        providers.forEach((provider: any) => {
          providerStats.set(provider.id, {
            name: provider.name,
            cases: new Set<number>(),
            revenue: 0,
            consultations: 0,
            acceptedPlans: 0,
          });
        });

        // Calculate Revenue and Cases from Treatment Plan Items
        treatmentPlanItems.forEach((tpi: any) => {
          if (!tpi.tpi_practitioner_id) return;

          const practitionerIdNum = typeof tpi.tpi_practitioner_id === 'string' 
            ? parseInt(tpi.tpi_practitioner_id, 10) 
            : Number(tpi.tpi_practitioner_id);
          
          if (isNaN(practitionerIdNum)) return;

          const provider = providerByPractitionerId.get(practitionerIdNum);
          if (!provider) return;

          const stats = providerStats.get(provider.id);
          if (!stats) return;

          // Add revenue from this invisalign treatment
          if (tpi.tpi_price) {
            stats.revenue += Number(tpi.tpi_price) || 0;
          }

          // Count cases (unique patients)
          if (tpi.tpi_patient_id) {
            stats.cases.add(tpi.tpi_patient_id);
          }

          // Count accepted plans (completed treatment plan items)
          if (tpi.tpi_completed) {
            stats.acceptedPlans++;
          }
        });

        // Calculate Consultations per Provider
        (consultations || []).forEach((consult: any) => {
          if (!consult.apmt_practitioner_id) return;

          const practitionerIdNum = typeof consult.apmt_practitioner_id === 'string' 
            ? parseInt(consult.apmt_practitioner_id, 10) 
            : Number(consult.apmt_practitioner_id);
          
          if (isNaN(practitionerIdNum)) return;

          const provider = providerByPractitionerId.get(practitionerIdNum);
          if (!provider) return;

          const stats = providerStats.get(provider.id);
          if (stats) {
            stats.consultations++;
          }
        });

        // ============================================
        // STEP 6: Convert to final format and calculate conversion rate
        // ============================================
        const result: InvisalignProvider[] = Array.from(providerStats.entries())
          .map(([providerId, stats]) => {
            const conversion = stats.consultations > 0
              ? (stats.acceptedPlans / stats.consultations) * 100
              : 0;

            return {
              providerId,
              name: stats.name,
              cases: stats.cases.size,
              revenue: stats.revenue,
              conversion: Math.round(conversion * 10) / 10, // Round to 1 decimal place
              rating: undefined, // Rating not available from current data
            };
          })
          .filter((provider) => provider.cases > 0 || provider.revenue > 0) // Only include providers with activity
          .sort((a, b) => b.revenue - a.revenue); // Sort by revenue descending

        console.log(`[useInvisalignProviders] Returning ${result.length} invisalign providers with data`);
        
        if (result.length === 0) {
          console.warn('[useInvisalignProviders] ❌ No invisalign providers returned (no providers with cases/revenue).');
          console.warn('[useInvisalignProviders] 💡 This means providers exist but have no completed invisalign treatment plan items.');
        } else {
          console.log('[useInvisalignProviders] ✅ Successfully found invisalign providers:', result.map(p => `${p.name} (${p.cases} cases, £${p.revenue})`));
        }
        
        return result;
      } catch (error) {
        console.error('[useInvisalignProviders] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0,
    retry: 1,
  });
}
