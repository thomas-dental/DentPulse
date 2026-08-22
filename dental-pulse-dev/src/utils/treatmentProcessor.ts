import { supabase } from '@/integrations/supabase/client';
import { ParsedTreatmentRow } from './fileParser';

export interface ProcessResult {
  success: boolean;
  totalRows: number;
  processedRows: number;
  failedRows: number;
  errors: string[];
}

/**
 * Process and save treatment data to database
 */
export async function processAndSaveTreatments(
  treatments: ParsedTreatmentRow[],
  organizationId: string,
  categoryId?: string | null,
  locationId?: string | null,
  regionId?: string | null,
  createdBy?: string | null
): Promise<ProcessResult> {
  const errors: string[] = [];
  let processedRows = 0;
  let failedRows = 0;
  
  // First, get or create categories if category_name is provided
  const categoryMap = new Map<string, string>();
  
  if (categoryId) {
    categoryMap.set('default', categoryId);
  }
  
  // Process treatments in batches
  const batchSize = 50;
  const batches = [];
  
  for (let i = 0; i < treatments.length; i += batchSize) {
    batches.push(treatments.slice(i, i + batchSize));
  }
  
  for (const batch of batches) {
    const insertData = await Promise.all(
      batch.map(async (treatment) => {
        try {
          // Validate required fields
          if (!treatment.treatment_name || treatment.treatment_name.trim().length < 2) {
            throw new Error('Treatment name must be at least 2 characters');
          }
          
          if (!treatment.price || treatment.price < 0) {
            throw new Error('Price must be a positive number');
          }
          
          if (!treatment.treatment_type || !['private', 'nhs'].includes(treatment.treatment_type)) {
            throw new Error('Treatment type must be "private" or "nhs"');
          }
          
          // Get or create category if category_name is provided
          let finalCategoryId = categoryId || null;
          
          if (treatment.category_name && !finalCategoryId) {
            if (!categoryMap.has(treatment.category_name)) {
              // Try to find existing category
              const { data: existingCategory } = await (supabase as any)
                .from('treatment_categories')
                .select('id')
                .eq('organization_id', organizationId)
                .eq('name', treatment.category_name)
                .is('deleted_at', null)
                .single();
              
              if (existingCategory) {
                categoryMap.set(treatment.category_name, existingCategory.id);
                finalCategoryId = existingCategory.id;
              } else {
                // Create new category
                const { data: newCategory, error: categoryError } = await (supabase as any)
                  .from('treatment_categories')
                  .insert({
                    organization_id: organizationId,
                    location_id: locationId || null,
                    region_id: regionId || null,
                    name: treatment.category_name,
                    created_by: createdBy || null,
                  })
                  .select()
                  .single();
                
                if (categoryError) throw categoryError;
                if (newCategory) {
                  categoryMap.set(treatment.category_name, newCategory.id);
                  finalCategoryId = newCategory.id;
                }
              }
            } else {
              finalCategoryId = categoryMap.get(treatment.category_name) || null;
            }
          }
          
          return {
            organization_id: organizationId,
            category_id: finalCategoryId,
            location_id: locationId || null,
            region_id: regionId || null,
            treatment_name: treatment.treatment_name.trim(),
            treatment_code: treatment.treatment_code?.trim() || null,
            description: treatment.description?.trim() || null,
            treatment_type: treatment.treatment_type,
            price: Number(treatment.price.toFixed(2)), // Ensure 2 decimal places
            private_price: treatment.private_price ? Number(treatment.private_price.toFixed(2)) : null,
            nhs_price: treatment.nhs_price ? Number(treatment.nhs_price.toFixed(2)) : null,
            nhs_band: treatment.nhs_band || null,
            duration_minutes: treatment.duration_minutes ? Math.round(treatment.duration_minutes) : null,
            requires_followup: treatment.requires_followup || false,
            notes: treatment.notes?.trim() || null,
            is_active: true,
            created_by: createdBy || null,
            // DentLedger-specific analytics fields
            no_items: treatment.no_items || null,
            average: treatment.average ? Number(treatment.average.toFixed(2)) : null,
            percent_fees: treatment.percent_fees ? Number(treatment.percent_fees.toFixed(2)) : null,
            hourly_rate: treatment.hourly_rate ? Number(treatment.hourly_rate.toFixed(2)) : null,
            average_time_minutes: treatment.average_time_minutes ? Number(treatment.average_time_minutes.toFixed(2)) : null,
          };
        } catch (error: any) {
          errors.push(`Treatment "${treatment.treatment_name || 'Unknown'}": ${error.message}`);
          failedRows++;
          return null;
        }
      })
    );
    
    // Filter out null values (failed rows)
    const validData = insertData.filter((item) => item !== null) as any[];
    
    if (validData.length > 0) {
      try {
        const { error: insertError } = await (supabase as any)
          .from('treatments')
          .insert(validData);
        
        if (insertError) {
          errors.push(`Batch insert error: ${insertError.message}`);
          failedRows += validData.length;
        } else {
          processedRows += validData.length;
        }
      } catch (error: any) {
        errors.push(`Batch insert error: ${error.message}`);
        failedRows += validData.length;
      }
    }
  }
  
  return {
    success: processedRows > 0,
    totalRows: treatments.length,
    processedRows,
    failedRows,
    errors,
  };
}
