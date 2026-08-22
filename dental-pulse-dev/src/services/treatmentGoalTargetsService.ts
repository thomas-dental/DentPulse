/**
 * Treatment Goal Targets Service
 * Provides functions to calculate and populate treatment goal targets
 * based on historical treatment data from synced treatment_plan_items
 */

import { supabase } from '@/integrations/supabase/client';
import { startOfMonth, startOfYear } from 'date-fns';

interface TreatmentGoalTargetInput {
  organization_id: string;
  category_name: string;
  period_type: 'month' | 'year';
  period_date: Date;
  location_id?: string | null;
  region_id?: string | null;
  unit_target: number;
  avg_amount_target: number;
  created_by?: string | null;
}

/**
 * Calculate historical averages from treatment_plan_items
 * This can be used to auto-populate targets based on past performance
 */
export async function calculateHistoricalAverages(
  organizationId: string,
  categoryName: string,
  periodType: 'month' | 'year',
  numberOfPeriods: number = 3, // Look at last 3 months/years
  locationId?: string | null,
  regionId?: string | null
): Promise<{ avgUnits: number; avgAmount: number }> {
  if (!organizationId) {
    throw new Error('Organization ID is required');
  }

  // Calculate date range for historical data
  const endDate = new Date();
  const startDate = new Date();
  
  if (periodType === 'month') {
    startDate.setMonth(startDate.getMonth() - numberOfPeriods);
  } else {
    startDate.setFullYear(startDate.getFullYear() - numberOfPeriods);
  }

  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  // Step 1: Get all treatments with their categories
  const treatmentCategoryMap = new Map<number | string, string>();
  const PAGE_SIZE = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    let query = (supabase as any)
      .from('treatments')
      .select('external_id, category_id, category:treatment_categories!treatments_category_id_fkey(id, name)')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .eq('is_active', true)
      .range(from, to);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }
    if (regionId) {
      query = query.eq('region_id', regionId);
    }

    const { data: treatmentsData, error: treatmentsError } = await query;
    if (treatmentsError) throw treatmentsError;

    const treatments = (treatmentsData ?? []) as Array<{
      external_id: number | string | null;
      category_id: string | null;
      category: { id: string; name: string } | null;
    }>;

    for (const treatment of treatments) {
      if (treatment.external_id != null) {
        const extId = typeof treatment.external_id === 'number' 
          ? treatment.external_id 
          : Number(treatment.external_id);
        if (!isNaN(extId)) {
          const catName = treatment.category?.name || 'Uncategorized';
          treatmentCategoryMap.set(extId, catName);
        }
      }
    }

    hasMore = treatments.length === PAGE_SIZE;
    from += PAGE_SIZE;
  }

  // Step 2: Get completed treatment_plan_items for the category in the date range
  let totalUnits = 0;
  let totalRevenue = 0;

  from = 0;
  hasMore = true;
  while (hasMore) {
    const to = from + PAGE_SIZE - 1;
    let query = (supabase as any)
      .from('treatment_plan_items')
      .select('tpi_id, tpi_treatment_id, tpi_price, tpi_completed_at, location_id, region_id')
      .eq('organization_id', organizationId)
      .eq('tpi_completed', true)
      .eq('tpi_charged', true)
      .gte('tpi_completed_at', startDateStr)
      .lte('tpi_completed_at', endDateStr)
      .not('tpi_treatment_id', 'is', null)
      .is('deleted_at', null)
      .range(from, to);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }
    if (regionId) {
      query = query.eq('region_id', regionId);
    }

    const { data: tpiData, error: tpiError } = await query;
    if (tpiError) throw tpiError;

    const tpiRows = (tpiData ?? []) as Array<{
      tpi_id: number | string | null;
      tpi_treatment_id: number | string | null;
      tpi_price: number | string | null;
      tpi_completed_at: string | null;
      location_id: string | null;
      region_id: string | null;
    }>;

    for (const row of tpiRows) {
      if (!row.tpi_treatment_id) continue;

      const treatmentId = typeof row.tpi_treatment_id === 'number' 
        ? row.tpi_treatment_id 
        : Number(row.tpi_treatment_id);
      
      if (isNaN(treatmentId)) continue;

      const catName = treatmentCategoryMap.get(treatmentId);
      if (catName !== categoryName) continue; // Only count this category

      const price = typeof row.tpi_price === 'number' ? row.tpi_price : parseFloat(row.tpi_price || '0') || 0;
      totalUnits += 1;
      totalRevenue += price;
    }

    hasMore = tpiRows.length === PAGE_SIZE;
    from += PAGE_SIZE;
  }

  // Calculate averages
  const avgUnits = numberOfPeriods > 0 ? totalUnits / numberOfPeriods : 0;
  const avgAmount = totalUnits > 0 ? totalRevenue / totalUnits : 0;

  return { avgUnits, avgAmount };
}

/**
 * Auto-populate targets for a period based on historical averages
 */
export async function autoPopulateTargets(
  organizationId: string,
  periodType: 'month' | 'year',
  periodDate: Date,
  locationId?: string | null,
  regionId?: string | null,
  numberOfPeriods: number = 3,
  userId?: string | null
): Promise<{ created: number; updated: number }> {
  if (!organizationId) {
    throw new Error('Organization ID is required');
  }

  // Get all categories for this organization
  let categoriesQuery = (supabase as any)
    .from('treatment_categories')
    .select('id, name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null);

  if (locationId) {
    categoriesQuery = categoriesQuery.eq('location_id', locationId);
  }
  if (regionId) {
    categoriesQuery = categoriesQuery.eq('region_id', regionId);
  }

  const { data: categories, error: categoriesError } = await categoriesQuery;
  if (categoriesError) {
    console.error('[TreatmentGoalTargets] Error fetching categories:', categoriesError);
    throw new Error(`Failed to fetch categories: ${categoriesError.message}`);
  }

  if (!categories || categories.length === 0) {
    console.log('[TreatmentGoalTargets] No categories found for organization');
    return { created: 0, updated: 0 };
  }

  const periodStartDate = periodType === 'month' 
    ? startOfMonth(periodDate)
    : startOfYear(periodDate);
  const periodDateStr = periodStartDate.toISOString().split('T')[0];

  let created = 0;
  let updated = 0;

  // Calculate and save targets for each category
  for (const category of categories) {
    try {
      const { avgUnits, avgAmount } = await calculateHistoricalAverages(
        organizationId,
        category.name,
        periodType,
        numberOfPeriods,
        locationId,
        regionId
      );

      // Round to reasonable values
      const unitTarget = Math.round(avgUnits);
      const avgAmountTarget = Math.round(avgAmount * 100) / 100; // Round to 2 decimal places

      // Check if target already exists
      let checkQuery = (supabase as any)
        .from('treatment_goal_targets')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('category_name', category.name)
        .eq('period_type', periodType)
        .eq('period_date', periodDateStr)
        .limit(1);

      if (locationId) {
        checkQuery = checkQuery.eq('location_id', locationId);
      } else {
        checkQuery = checkQuery.is('location_id', null);
      }

      if (regionId) {
        checkQuery = checkQuery.eq('region_id', regionId);
      } else {
        checkQuery = checkQuery.is('region_id', null);
      }

      const { data: existing, error: checkError } = await checkQuery.maybeSingle();
      
      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 is "no rows returned" which is fine, we'll create a new record
        console.error(`[TreatmentGoalTargets] Error checking existing target for ${category.name}:`, checkError);
        continue;
      }

      const targetData: any = {
        organization_id: organizationId,
        location_id: locationId || null,
        region_id: regionId || null,
        category_name: category.name,
        period_type: periodType,
        period_date: periodDateStr,
        unit_target: unitTarget,
        avg_amount_target: avgAmountTarget,
        updated_by: userId,
      };

      if (existing) {
        // Update existing target
        const { error: updateError } = await (supabase as any)
          .from('treatment_goal_targets')
          .update(targetData)
          .eq('id', existing.id);

        if (updateError) {
          console.error(`[TreatmentGoalTargets] Failed to update target for ${category.name}:`, updateError);
          if (updateError.message?.includes('API key') || updateError.message?.includes('does not exist') || updateError.code === '42P01') {
            throw new Error('Treatment goal targets table does not exist. Please run the database migration first.');
          }
        } else {
          updated++;
        }
      } else {
        // Create new target
        targetData.created_by = userId;
        const { error: insertError } = await (supabase as any)
          .from('treatment_goal_targets')
          .insert(targetData);

        if (insertError) {
          console.error(`[TreatmentGoalTargets] Failed to create target for ${category.name}:`, insertError);
          if (insertError.message?.includes('API key') || insertError.message?.includes('does not exist') || insertError.code === '42P01') {
            throw new Error('Treatment goal targets table does not exist. Please run the database migration first.');
          }
        } else {
          created++;
        }
      }
    } catch (error) {
      console.error(`[TreatmentGoalTargets] Error processing category ${category.name}:`, error);
    }
  }

  return { created, updated };
}

/**
 * Sync targets from external source (if needed in future)
 * This follows the same pattern as other sync functions
 */
export async function syncTreatmentGoalTargets(
  organizationId: string,
  targets: TreatmentGoalTargetInput[],
  userId?: string | null
): Promise<{ synced: number; errors: string[] }> {
  if (!organizationId) {
    throw new Error('Organization ID is required');
  }

  let synced = 0;
  const errors: string[] = [];

  for (const target of targets) {
    try {
      const periodStartDate = target.period_type === 'month' 
        ? startOfMonth(target.period_date)
        : startOfYear(target.period_date);
      const periodDateStr = periodStartDate.toISOString().split('T')[0];

      const targetData: any = {
        organization_id: target.organization_id,
        location_id: target.location_id || null,
        region_id: target.region_id || null,
        category_name: target.category_name,
        period_type: target.period_type,
        period_date: periodDateStr,
        unit_target: target.unit_target,
        avg_amount_target: target.avg_amount_target,
        updated_by: userId || target.created_by,
      };

      // Check if target exists
      let checkQuery = (supabase as any)
        .from('treatment_goal_targets')
        .select('id')
        .eq('organization_id', target.organization_id)
        .eq('category_name', target.category_name)
        .eq('period_type', target.period_type)
        .eq('period_date', periodDateStr);

      if (target.location_id) {
        checkQuery = checkQuery.eq('location_id', target.location_id);
      } else {
        checkQuery = checkQuery.is('location_id', null);
      }

      if (target.region_id) {
        checkQuery = checkQuery.eq('region_id', target.region_id);
      } else {
        checkQuery = checkQuery.is('region_id', null);
      }

      const { data: existing, error: checkError } = await checkQuery.maybeSingle();
      
      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 is "no rows returned" which is fine
        errors.push(`Error checking target for ${target.category_name}: ${checkError.message}`);
        continue;
      }

      if (existing) {
        // Update existing
        const { error: updateError } = await (supabase as any)
          .from('treatment_goal_targets')
          .update(targetData)
          .eq('id', existing.id);

        if (updateError) {
          errors.push(`Failed to update target for ${target.category_name}: ${updateError.message}`);
        } else {
          synced++;
        }
      } else {
        // Insert new
        targetData.created_by = userId || target.created_by;
        const { error: insertError } = await (supabase as any)
          .from('treatment_goal_targets')
          .insert(targetData);

        if (insertError) {
          errors.push(`Failed to create target for ${target.category_name}: ${insertError.message}`);
        } else {
          synced++;
        }
      }
    } catch (error: any) {
      errors.push(`Error processing target for ${target.category_name}: ${error.message}`);
    }
  }

  return { synced, errors };
}
