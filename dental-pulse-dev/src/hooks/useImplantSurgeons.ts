import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';
import { useLocations } from './useLocations';
import { ukDayStartInstant, ukDayEndInstant } from '@/utils/dateRangeUtils';

export interface ImplantSurgeon {
  providerId: string;
  name: string;
  cases: number;
  surgeries: number;
  revenue: number;
  conversion: number;
}

/**
 * Simplified data flow for Implant Surgeons using treatment_plan_items:
 *
 * Flow:
 * 1. Get all treatments where type_of_treatment = 'implant' (with external_id = Dentally treatment_id)
 * 2. Get treatment_plan_items where tpi_treatment_id matches treatment external_id
 * 3. Extract tpi_practitioner_id from treatment_plan_items
 * 4. Match tpi_practitioner_id to providers.external_id to get provider names
 * 5. Aggregate metrics (cases, surgeries, revenue, conversion) per provider
 *
 * Key Relationships:
 * - treatments.external_id = Dentally treatment_id
 * - treatment_plan_items.tpi_treatment_id = Dentally treatment_id (matches treatments.external_id)
 * - treatment_plan_items.tpi_practitioner_id = Dentally practitioner_id
 * - providers.external_id = Dentally practitioner_id (matches tpi_practitioner_id)
 */
export function useImplantSurgeons(startDate?: Date | null, endDate?: Date | null, enabled: boolean = true) {
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
    // Set to start of today for end date
    defaultEndDate.setHours(23, 59, 59, 999);
    
    // Start date: 12 months ago from today
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
    queryKey: ['implant_surgeons', orgIdsKey, dateRange.startDate, dateRange.endDate, selectedLocationId],
    queryFn: async (): Promise<ImplantSurgeon[]> => {
      if (effectiveOrgIds.length === 0) {
        console.log('[useImplantSurgeons] No organizationId provided');
        return [];
      }
      const organizationId = effectiveOrgIds[0];

      console.log(`[useImplantSurgeons] Date range: ${dateRange.startDate} to ${dateRange.endDate}`);

      try {
        // ============================================
        // STEP 1: Get all treatments where type_of_treatment = 'implant'
        // ============================================
        const { data: implantTreatments, error: treatmentsError } = await (supabase as any)
          .from('treatments')
          .select('id, external_id, treatment_name')
          .eq('organization_id', organizationId)
          .eq('type_of_treatment', 'implant')
          .is('deleted_at', null)
          .eq('is_active', true);

        if (treatmentsError) {
          console.error('[useImplantSurgeons] Error fetching treatments:', treatmentsError);
          throw treatmentsError;
        }
        
        if (!implantTreatments || implantTreatments.length === 0) {
          console.log('[useImplantSurgeons] No implant treatments found. Make sure treatments have type_of_treatment = "implant" set in Treatment Settings.');
          return [];
        }

        console.log(`[useImplantSurgeons] Found ${implantTreatments.length} implant treatments`);
        
        // Get implant treatment external_ids (Dentally treatment_id)
        const implantTreatmentExternalIds = implantTreatments
          .map((t: any) => t.external_id)
          .filter((id: any) => id != null)
          .map((id: any) => {
            // Handle both string and number external_ids
            const numId = typeof id === 'string' ? parseInt(id, 10) : Number(id);
            return isNaN(numId) ? null : numId;
          })
          .filter((id: any) => id != null) as number[];

        if (implantTreatmentExternalIds.length === 0) {
          console.log('[useImplantSurgeons] ⚠️ No implant treatments have external_id values.');
          console.log('[useImplantSurgeons] Solution: Sync treatments from Dentally to populate external_id.');
          return [];
        }
        
        console.log(`[useImplantSurgeons] Looking for treatment_plan_items with tpi_treatment_id in: [${implantTreatmentExternalIds.slice(0, 5).join(', ')}${implantTreatmentExternalIds.length > 5 ? '...' : ''}]`);

        // ============================================
        // STEP 2: Get Treatment Plan Items for implant treatments
        // Match tpi_treatment_id (BIGINT) with treatment external_id (INTEGER)
        // Only include COMPLETED items (tpi_completed = true) to match Dentally's "Completed on" filter
        // ============================================
        const { data: allTreatmentPlanItems, error: tpiError } = await (supabase as any)
          .from('treatment_plan_items')
          .select('tpi_id, tpi_patient_id, tpi_practitioner_id, tpi_completed, tpi_charged, tpi_price, tpi_treatment_id, tpi_completed_at, created_at, tpi_updated_at')
          .eq('organization_id', organizationId)
          .in('tpi_treatment_id', implantTreatmentExternalIds)
          .eq('tpi_completed', true)
          .is('deleted_at', null);

        if (tpiError) {
          console.error('[useImplantSurgeons] Error fetching treatment plan items:', tpiError);
          throw tpiError;
        }

        console.log(`[useImplantSurgeons] Found ${allTreatmentPlanItems?.length || 0} total treatment plan items before date filtering`);
        console.log(`[useImplantSurgeons] Date range: ${dateRange.startDate} to ${dateRange.endDate}`);

        // Filter by date range: only include items completed within the date range
        // Use tpi_completed_at only (no fallbacks) to match Dentally's "Completed on" date filter
        let treatmentPlanItems = allTreatmentPlanItems || [];

        if (dateRange.startDate && dateRange.endDate) {
          treatmentPlanItems = treatmentPlanItems.filter((tpi: any) => {
            // Only use tpi_completed_at - skip items without a completion date
            if (!tpi.tpi_completed_at) return false;

            const itemDate = new Date(tpi.tpi_completed_at);
            const startDate = new Date(dateRange.startDate);
            const endDate = new Date(dateRange.endDate);

            return itemDate >= startDate && itemDate <= endDate;
          });
        }

        console.log(`[useImplantSurgeons] After filtering: ${treatmentPlanItems.length} items from ${allTreatmentPlanItems?.length || 0} total`);

        console.log(`[useImplantSurgeons] Filtered ${treatmentPlanItems.length} treatment plan items from ${allTreatmentPlanItems?.length || 0} total items (date range: ${dateRange.startDate} to ${dateRange.endDate})`);
        
        if (!treatmentPlanItems || treatmentPlanItems.length === 0) {
          console.log('[useImplantSurgeons] ⚠️ No treatment plan items found for implant treatments.');
          console.log('[useImplantSurgeons] This means there are no treatment plan items with tpi_treatment_id matching implant treatment external_ids.');
          console.log('[useImplantSurgeons] Solution: Sync treatment plan items from Dentally, or ensure tpi_treatment_id is populated.');
          
          // Diagnostic: Check if treatment_plan_items exist at all
          const { data: anyTPI, error: checkError } = await (supabase as any)
            .from('treatment_plan_items')
            .select('tpi_treatment_id')
            .eq('organization_id', organizationId)
            .not('tpi_treatment_id', 'is', null)
            .limit(10);
          
          if (!checkError && anyTPI && anyTPI.length > 0) {
            const existingTreatmentIds = Array.from(new Set(
              anyTPI
                .map((tpi: any) => {
                  const id = tpi.tpi_treatment_id;
                  return typeof id === 'string' ? parseInt(id, 10) : Number(id);
                })
                .filter((id: any) => !isNaN(id))
            ));
            console.log('[useImplantSurgeons] Sample tpi_treatment_id values found:', existingTreatmentIds);
            console.log('[useImplantSurgeons] Implant treatment external_ids we\'re searching for:', implantTreatmentExternalIds);
            
            const matches = implantTreatmentExternalIds.filter(id => existingTreatmentIds.includes(id));
            if (matches.length > 0) {
              console.log('[useImplantSurgeons] ✓ Found matching IDs:', matches);
            } else {
              console.log('[useImplantSurgeons] ⚠️ No matches found! The external_id values don\'t match any tpi_treatment_id.');
            }
          } else {
            console.log('[useImplantSurgeons] No treatment plan items with tpi_treatment_id found in database.');
          }
          
          return [];
        }

        console.log(`[useImplantSurgeons] Found ${treatmentPlanItems.length} treatment plan items for implant treatments`);

        // Get unique practitioner IDs from treatment plan items
        const practitionerIds = Array.from(new Set(
          treatmentPlanItems
            .map((tpi: any) => tpi.tpi_practitioner_id)
            .filter((id: any) => id != null)
            .map((id: any) => {
              // Convert to number if needed
              return typeof id === 'string' ? parseInt(id, 10) : Number(id);
            })
            .filter((id: any) => !isNaN(id))
        )) as number[];

        if (practitionerIds.length === 0) {
          console.log('[useImplantSurgeons] ⚠️ No practitioner_id values found in treatment plan items.');
          console.log('[useImplantSurgeons] Solution: Ensure treatment plan items have tpi_practitioner_id populated from Dentally.');
          return [];
        }
        
        console.log(`[useImplantSurgeons] Found ${practitionerIds.length} unique practitioner IDs: [${practitionerIds.slice(0, 5).join(', ')}${practitionerIds.length > 5 ? '...' : ''}]`);

        // ============================================
        // STEP 3: Get Providers (to get provider names)
        // Match tpi_practitioner_id to provider external_id
        // ============================================
        const { data: providers, error: providersError } = await (supabase as any)
          .from('providers')
          .select('id, name, external_id')
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .in('external_id', practitionerIds);

        if (providersError) {
          console.error('[useImplantSurgeons] Error fetching providers:', providersError);
          throw providersError;
        }
        
        if (!providers || providers.length === 0) {
          console.log('[useImplantSurgeons] ⚠️ No providers found with matching external_id.');
          console.log('[useImplantSurgeons] Looking for providers where external_id matches tpi_practitioner_id from treatment plan items.');
          console.log('[useImplantSurgeons] Practitioner IDs from treatment plan items:', practitionerIds);
          
          // Check if there are any providers at all
          const { data: anyProviders, error: checkError } = await (supabase as any)
            .from('providers')
            .select('id, name, external_id')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .is('deleted_at', null)
            .limit(5);
          
          if (!checkError && anyProviders) {
            console.log(`[useImplantSurgeons] Found ${anyProviders.length} providers in database, but none match the practitioner IDs.`);
            console.log('[useImplantSurgeons] Provider external_ids:', anyProviders.map((p: any) => p.external_id).filter((id: any) => id != null));
            console.log('[useImplantSurgeons] Solution: Sync providers from Dentally, or ensure provider external_id matches tpi_practitioner_id.');
          } else {
            console.log('[useImplantSurgeons] No providers found in database. Need to sync providers from Dentally.');
          }
          
          return [];
        }

        console.log(`[useImplantSurgeons] Found ${providers.length} providers with implant treatments:`, providers.map((p: any) => ({ name: p.name, external_id: p.external_id })));
        
        // Show the complete data flow for verification
        console.log(`[useImplantSurgeons] Data flow verification:`);
        console.log(`[useImplantSurgeons]   1. Treatments with external_id: ${implantTreatmentExternalIds.length} treatments`);
        console.log(`[useImplantSurgeons]   2. Treatment plan items found: ${treatmentPlanItems.length} items`);
        console.log(`[useImplantSurgeons]   3. Unique practitioner IDs: ${practitionerIds.length} practitioners`);
        console.log(`[useImplantSurgeons]   4. Providers matched: ${providers.length} providers`);

        // Create a map: practitioner_id (external_id) -> provider
        const providerByPractitionerId = new Map(
          providers.map((p: any) => [p.external_id, p])
        );

        // ============================================
        // STEP 4: Get Consultations for Conversion Rate
        // Filter by apmt_start_time date range
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
        // STEP 6: Aggregate Data by Provider
        // ============================================
        const surgeonStats = new Map<string, {
          name: string;
          cases: Set<number>; // unique patient IDs
          surgeries: number;
          revenue: number;
          consultations: number;
          acceptedPlans: number;
        }>();

        // Initialize stats for all providers
        providers.forEach((provider: any) => {
          surgeonStats.set(provider.id, {
            name: provider.name,
            cases: new Set<number>(),
            surgeries: 0,
            revenue: 0,
            consultations: 0,
            acceptedPlans: 0,
          });
        });

        // Calculate Revenue, Cases, and Surgeries from completed Treatment Plan Items
        // All items are already filtered to tpi_completed = true and within date range
        treatmentPlanItems.forEach((tpi: any) => {
          if (!tpi.tpi_practitioner_id) return;

          // Convert to number if needed
          const practitionerIdNum = typeof tpi.tpi_practitioner_id === 'string'
            ? parseInt(tpi.tpi_practitioner_id, 10)
            : Number(tpi.tpi_practitioner_id);

          if (isNaN(practitionerIdNum)) return;

          // Match practitioner_id to provider
          const provider = providerByPractitionerId.get(practitionerIdNum);
          if (!provider) return;

          const stats = surgeonStats.get(provider.id);
          if (!stats) return;

          // Add revenue from this completed implant treatment
          if (tpi.tpi_price) {
            stats.revenue += Number(tpi.tpi_price) || 0;
          }

          // Count cases (unique patients)
          if (tpi.tpi_patient_id) {
            stats.cases.add(tpi.tpi_patient_id);
          }

          // Count surgeries (each completed TPI = 1 surgery/treatment)
          stats.surgeries++;

          // Count accepted plans (completed treatment plan items)
          stats.acceptedPlans++;
        });

        // Calculate Consultations per Provider
        (consultations || []).forEach((consult: any) => {
          if (!consult.apmt_practitioner_id) return;

          // Convert to number if needed
          const practitionerIdNum = typeof consult.apmt_practitioner_id === 'string' 
            ? parseInt(consult.apmt_practitioner_id, 10) 
            : Number(consult.apmt_practitioner_id);
          
          if (isNaN(practitionerIdNum)) return;

          const provider = providerByPractitionerId.get(practitionerIdNum);
          if (!provider) return;

          const stats = surgeonStats.get(provider.id);
          if (stats) {
            stats.consultations++;
          }
        });

        // ============================================
        // STEP 7: Convert to final format and calculate conversion rate
        // ============================================
        const result: ImplantSurgeon[] = Array.from(surgeonStats.entries())
          .map(([providerId, stats]) => {
            const conversion = stats.consultations > 0
              ? (stats.acceptedPlans / stats.consultations) * 100
              : 0;

            return {
              providerId,
              name: stats.name,
              cases: stats.cases.size,
              surgeries: stats.surgeries,
              revenue: stats.revenue, // Revenue from treatment plan items (tpi_price)
              conversion: Math.round(conversion * 10) / 10, // Round to 1 decimal place
            };
          })
          .filter((surgeon) => surgeon.cases > 0 || surgeon.surgeries > 0 || surgeon.revenue > 0) // Only include surgeons with activity
          .sort((a, b) => b.revenue - a.revenue); // Sort by revenue descending

        console.log(`[useImplantSurgeons] Returning ${result.length} implant surgeons with data`);
        
        if (result.length === 0) {
          console.log('[useImplantSurgeons] ⚠️ No implant surgeons returned. Reasons could be:');
          console.log('[useImplantSurgeons]   - No treatment plan items found for implant treatments');
          console.log('[useImplantSurgeons]   - No providers matched the practitioner_ids from treatment plan items');
          console.log('[useImplantSurgeons]   - All surgeons filtered out (no cases, surgeries, or revenue)');
          console.log('[useImplantSurgeons] Check the logs above to see which step failed.');
        } else {
          console.log('[useImplantSurgeons] ✓ Successfully found implant surgeons:', result.map(s => s.name));
        }
        
        return result;
      } catch (error) {
        console.error('[useImplantSurgeons] Error in query function:', error);
        throw error;
      }
    },
    enabled: enabled && effectiveOrgIds.length > 0,
    retry: 1,
  });
}
