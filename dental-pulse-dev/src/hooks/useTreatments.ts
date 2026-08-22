import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { Treatment, TreatmentInsert, TreatmentUpdate } from '@/types/treatment';
import { toast } from 'sonner';

interface UseTreatmentsOptions {
  treatmentType?: 'private' | 'nhs' | null;
  typeOfTreatment?: string | null; // Filter by type_of_treatment (e.g., 'invisalign', 'implant')
  regionId?: string | null;
  categoryId?: string | null;
  locationId?: string | null; // When set, return only treatments scoped to this location
                              // (plus treatments with NULL location_id, i.e. org-wide catalog entries).
  includeInactive?: boolean;  // When true, include archived/inactive treatments
                              // (Dentally's record.active = false). Default: false
                              // (only active treatments). Treatment Setup uses true
                              // so totals match Dentally's per-practice treatment count.
}

export function useTreatments(options: UseTreatmentsOptions = {}) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const { treatmentType, typeOfTreatment, regionId, categoryId, locationId, includeInactive = false } = options;

  const { data: treatments = [], isLoading } = useQuery({
    queryKey: ['treatments', organizationId, treatmentType, typeOfTreatment, regionId, categoryId, locationId || 'all-locations', includeInactive ? 'with-inactive' : 'active-only'],
    queryFn: async () => {
      if (!organizationId) return [];

      // When a location is selected, resolve it to its Dentally integration id
      // (practice_locations.integration_id), then scope the treatments list by
      // treatments.integration_id. This matches how treatments are imported:
      // each Dentally API key syncs its own treatment catalog, and each
      // practice_location belongs to one API key. Locations that share a key
      // (e.g. TFL Caldicot + Magor) naturally share the same treatment list.
      let locationIntegrationId: string | null = null;
      if (locationId) {
        const { data: locRow, error: locErr } = await (supabase as any)
          .from('practice_locations')
          .select('integration_id')
          .eq('id', locationId)
          .maybeSingle();
        if (locErr) {
          console.error('[useTreatments] location integration lookup error:', locErr);
        } else if (locRow?.integration_id) {
          locationIntegrationId = locRow.integration_id as string;
        }
      }

      // Build a fresh query builder each iteration. PostgREST enforces a
      // server-side max-rows cap (1000 on this project) regardless of the
      // requested .range(), so a single big range silently truncates. We
      // paginate in 1000-row pages until we get a short page.
      const buildQuery = () => {
        let q = (supabase as any)
          .from('treatments')
          .select(`
            id,
            organization_id,
            category_id,
            location_id,
            region_id,
            treatment_name,
            treatment_code,
            description,
            treatment_type,
            type_of_treatment,
            price,
            private_price,
            nhs_price,
            nhs_band,
            duration_minutes,
            requires_followup,
            is_active,
            notes,
            created_at,
            updated_at,
            deleted_at,
            created_by,
            updated_by,
            no_items,
            average,
            percent_fees,
            hourly_rate,
            average_time_minutes,
            therapist_time_mins,
            lab_bill,
            lab_bill_discount,
            material_cost,
            therapist_pay_rate,
            finance_fee,
            external_id,
            insurance_classification,
            nhs_treatment_cat,
            nomenclature,
            owner,
            patient_description,
            patient_nomenclature,
            region,
            uda_band,
            category:treatment_categories!treatments_category_id_fkey(id, name, deleted_at)
          `)
          .eq('organization_id', organizationId)
          .is('deleted_at', null);

        if (!includeInactive) q = q.eq('is_active', true);
        if (treatmentType) q = q.eq('treatment_type', treatmentType);
        if (typeOfTreatment) q = q.eq('type_of_treatment', typeOfTreatment);
        if (regionId) q = q.eq('region_id', regionId);
        if (categoryId) q = q.eq('category_id', categoryId);
        // Location-scoped catalog: rows synced from this location's Dentally
        // integration_id, plus org-wide rows (NULL integration_id) created via
        // "Add Treatment" or CSV import. If the selected location has no
        // integration_id, skip this filter rather than returning nothing.
        if (locationId && locationIntegrationId) {
          q = q.or(`integration_id.eq.${locationIntegrationId},integration_id.is.null`);
        }

        return q.order('treatment_name', { ascending: true });
      };

      const PAGE = 1000;
      const data: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await buildQuery().range(from, from + PAGE - 1);
        if (error) {
          console.error('Error fetching treatments:', error);
          throw error;
        }
        if (!page || page.length === 0) break;
        data.push(...page);
        if (page.length < PAGE) break;
      }

      // Debug: Log sample data to see what we're getting
      if (data && data.length > 0) {
        const sampleWithCategory = data.find((t: any) => t.category_id) || data[0];
        console.log('[useTreatments] Sample treatment data:', {
          treatment_name: sampleWithCategory.treatment_name,
          category_id: sampleWithCategory.category_id,
          category_from_join: sampleWithCategory.category,
          category_type: typeof sampleWithCategory.category,
          is_array: Array.isArray(sampleWithCategory.category),
          treatments_with_category_id: data.filter((t: any) => t.category_id).length,
          total_treatments: data.length
        });
      }

      // Always fetch categories separately to ensure we have them
      // This works around potential RLS issues with Supabase joins
      const { data: allCategories, error: categoriesError } = await (supabase as any)
        .from('treatment_categories')
        .select('id, name')
        .eq('organization_id', organizationId)
        .is('deleted_at', null);

      if (categoriesError) {
        console.error('[useTreatments] Error fetching categories:', categoriesError);
      }

      // Create a map for quick lookup
      const categoryMap = new Map<string, { id: string; name: string }>();
      if (allCategories && Array.isArray(allCategories)) {
        allCategories.forEach((cat: any) => {
          if (cat?.id && cat?.name) {
            categoryMap.set(cat.id, { id: cat.id, name: cat.name });
          }
        });
        console.log(`[useTreatments] Loaded ${categoryMap.size} categories for organization`);
      }

      // Process treatments to extract category information
      // First try from join, then fallback to map lookup
      const processedData = (data || []).map((treatment: any) => {
        let category = null;

        // First, try to get category from the join (if it worked)
        if (treatment.category) {
          // Handle array response (one-to-many relationship)
          if (Array.isArray(treatment.category)) {
            // Filter out deleted categories and get the first valid one
            const validCategory = treatment.category.find(
              (cat: any) => cat && cat.id && cat.name && !cat.deleted_at
            );
            if (validCategory) {
              category = {
                id: validCategory.id,
                name: validCategory.name
              };
            }
          }
          // Handle object response (one-to-one relationship)
          else if (treatment.category && typeof treatment.category === 'object') {
            if (treatment.category.id && treatment.category.name && !treatment.category.deleted_at) {
              category = {
                id: treatment.category.id,
                name: treatment.category.name
              };
            }
          }
        }

        // If join didn't work or category was deleted, use the category map
        // This is the most reliable way to get category names
        if (!category && treatment.category_id) {
          // Try to find category in map (category_id should be UUID string)
          const categoryIdStr = String(treatment.category_id);
          if (categoryMap.has(categoryIdStr)) {
            category = categoryMap.get(categoryIdStr)!;
          } else {
            // Try to find by matching any category ID (case-insensitive, handle UUID format differences)
            const foundCategory = Array.from(categoryMap.values()).find(
              (cat) => cat.id === categoryIdStr || cat.id.toLowerCase() === categoryIdStr.toLowerCase()
            );
            if (foundCategory) {
              category = foundCategory;
            } else {
              // Log if category_id exists but not in map (for debugging)
              console.warn(`[useTreatments] Treatment "${treatment.treatment_name}" (ID: ${treatment.id}) has category_id ${treatment.category_id} but category not found in map. Available categories:`, Array.from(categoryMap.keys()));
            }
          }
        }

        return {
          ...treatment,
          category
        };
      });

      return processedData as Treatment[];
    },
    enabled: !!organizationId,
  });

  // Create treatment
  const createTreatmentMutation = useMutation({
    mutationFn: async (treatment: Omit<TreatmentInsert, 'organization_id' | 'created_by'>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const insertData: TreatmentInsert = {
        ...treatment,
        organization_id: organizationId,
        created_by: user.id,
      };

      const { data, error } = await (supabase as any)
        .from('treatments')
        .insert(insertData)
        .select(`
          id,
          organization_id,
          category_id,
          location_id,
          region_id,
          treatment_name,
          treatment_code,
          description,
          treatment_type,
          type_of_treatment,
          price,
          private_price,
          nhs_price,
          nhs_band,
          duration_minutes,
          requires_followup,
          is_active,
          notes,
          created_at,
          updated_at,
          deleted_at,
          created_by,
          updated_by,
          no_items,
          average,
          percent_fees,
          hourly_rate,
          average_time_minutes,
          therapist_time_mins,
          lab_bill,
          lab_bill_discount,
          material_cost,
          therapist_pay_rate,
          finance_fee,
          external_id,
          insurance_classification,
          nhs_treatment_cat,
          nomenclature,
          owner,
          patient_description,
          patient_nomenclature,
          region,
          uda_band,
          category:treatment_categories!left(id, name, external_id, deleted_at)  -- Join category based on category_id foreign key
        `)
        .single();

      if (error) throw error;

      // Filter out category if it's soft-deleted
      if (data?.category && data.category.deleted_at) {
        data.category = null;
      }

      return data as Treatment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatments', organizationId] });
      toast.success('Treatment created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create treatment: ${error.message}`);
    },
  });

  // Update treatment
  const updateTreatmentMutation = useMutation({
    mutationFn: async ({ id, ...updates }: TreatmentUpdate) => {
      if (!user?.id) throw new Error('Not authenticated');

      const updateData: TreatmentUpdate = {
        ...updates,
        id,
        updated_by: user.id,
      };

      const { data, error } = await (supabase as any)
        .from('treatments')
        .update(updateData)
        .eq('id', id)
        .select(`
          id,
          organization_id,
          category_id,
          location_id,
          region_id,
          treatment_name,
          treatment_code,
          description,
          treatment_type,
          type_of_treatment,
          price,
          private_price,
          nhs_price,
          nhs_band,
          duration_minutes,
          requires_followup,
          is_active,
          notes,
          created_at,
          updated_at,
          deleted_at,
          created_by,
          updated_by,
          no_items,
          average,
          percent_fees,
          hourly_rate,
          average_time_minutes,
          therapist_time_mins,
          lab_bill,
          lab_bill_discount,
          material_cost,
          therapist_pay_rate,
          finance_fee,
          external_id,
          insurance_classification,
          nhs_treatment_cat,
          nomenclature,
          owner,
          patient_description,
          patient_nomenclature,
          region,
          uda_band,
          category:treatment_categories!left(id, name, external_id, deleted_at)  -- Join category based on category_id foreign key
        `)
        .single();

      if (error) throw error;

      // Filter out category if it's soft-deleted
      if (data?.category && data.category.deleted_at) {
        data.category = null;
      }

      return data as Treatment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatments', organizationId] });
    },
  });

  // Batch update type_of_treatment for multiple treatments at once
  // Uses .in() for a single query instead of N parallel mutations to avoid AbortError
  const batchUpdateTypeOfTreatmentMutation = useMutation({
    mutationFn: async ({ treatmentIds, typeOfTreatment }: { treatmentIds: string[]; typeOfTreatment: string | null }) => {
      if (!user?.id) throw new Error('Not authenticated');
      if (treatmentIds.length === 0) return;

      const { error } = await (supabase as any)
        .from('treatments')
        .update({
          type_of_treatment: typeOfTreatment,
          updated_by: user.id,
        })
        .in('id', treatmentIds);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatments', organizationId] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update treatments: ${error.message}`);
    },
  });

  // Delete treatment (soft delete)
  const deleteTreatmentMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { error } = await (supabase as any)
        .from('treatments')
        .update({
          deleted_at: new Date().toISOString(),
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatments', organizationId] });
      toast.success('Treatment deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete treatment: ${error.message}`);
    },
  });

  return {
    treatments,
    isLoading,
    createTreatment: createTreatmentMutation.mutateAsync,
    updateTreatment: updateTreatmentMutation.mutateAsync,
    batchUpdateTypeOfTreatment: batchUpdateTypeOfTreatmentMutation.mutateAsync,
    deleteTreatment: deleteTreatmentMutation.mutate,
    isCreating: createTreatmentMutation.isPending,
    isUpdating: updateTreatmentMutation.isPending,
    isDeleting: deleteTreatmentMutation.isPending,
  };
}
