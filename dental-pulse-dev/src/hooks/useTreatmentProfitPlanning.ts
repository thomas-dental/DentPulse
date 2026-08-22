import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { useFilters } from '@/contexts/FilterContext';


export interface TreatmentProfitPlanningItem {
  id: string;
  treatmentId: string;
  treatmentName: string;
  categoryId: string | null;
  categoryName: string | null;
  treatmentType: 'private' | 'nhs' | null;
  // Volume & Revenue (from treatment_plan_items)
  currentVolume: number;
  currentRevenue: number;
  // Per-unit cost breakdown (from treatments table)
  avgIncome: number;
  materialCost: number;
  labBill: number;
  therapistPayRate: number;
  opCostPerTreatment: number;
  associatePay: number;
  financeFee: number;
  expensePerUnit: number;
  profitLossPerUnit: number;
  // Totals
  totalExpense: number;
  totalProfitLoss: number;
  principalProfit: number;
  // Percentages
  plPercent: number;
  principalProfitPercent: number;
  // Raw rate fields (for calculator)
  associatePercent: number;   // raw percent_fees
  financePercent: number;     // raw finance_fee %
  hourlyRate: number;         // raw hourly_rate (operating cost per hour)
  durationMinutes: number;    // raw duration_minutes
  // Budget plan (kept for future use)
  plannedVolume: number;
  plannedRevenue: number;
  targetMargin: number;
}

interface TreatmentBudgetPlanning {
  id: string;
  treatment_id: string;
  organization_id: string;
  period: string;
  planned_volume: number;
  planned_revenue: number;
  target_margin: number;
}

/**
 * Hook to fetch treatment profit planning data
 * Uses real cost data from treatments table and volume/revenue from treatment_plan_items
 */
export function useTreatmentProfitPlanning() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { dateRange, selectedLocationId, selectedRegionId } = useFilters();
  const queryClient = useQueryClient();

  const period = useMemo(() => {
    const month = String(dateRange.startDate.getMonth() + 1).padStart(2, '0');
    return `${dateRange.startDate.getFullYear()}-${month}`;
  }, [dateRange.startDate]);

  // Helper: convert Date to YYYY-MM-DD (local, no timezone shift)
  const toDateStr = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const effectiveFromDate = dateRange.startDate ? toDateStr(dateRange.startDate) : '';
  const effectiveToDate = dateRange.endDate ? toDateStr(dateRange.endDate) : '';

  const { data: planningData = [], isLoading } = useQuery({
    queryKey: [
      'treatment_profit_planning',
      organizationId,
      period,
      effectiveFromDate,
      effectiveToDate,
      selectedLocationId,
      selectedRegionId,
    ],
    queryFn: async () => {
      if (!organizationId) return [];
      if (!effectiveFromDate || !effectiveToDate) return [];

      // Step 1: Fetch treatments with cost fields
      const { data: treatments, error: treatmentsError } = await (supabase as any)
        .from('treatments')
        .select(`
          id,
          treatment_name,
          category_id,
          treatment_type,
          external_id,
          material_cost,
          lab_bill,
          therapist_pay_rate,
          hourly_rate,
          percent_fees,
          finance_fee,
          duration_minutes,
          category:treatment_categories!treatments_category_id_fkey(id, name, deleted_at)
        `)
        .eq('organization_id', organizationId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('treatment_name', { ascending: true });

      if (treatmentsError) {
        console.error('[useTreatmentProfitPlanning] Error fetching treatments:', treatmentsError);
        throw treatmentsError;
      }

      if (!treatments || treatments.length === 0) {
        return [];
      }

      // Build treatment lookup by UUID
      const treatmentById = new Map<string, any>();
      treatments.forEach((t: any) => {
        if (t.id) treatmentById.set(t.id, t);
      });

      // Step 2: Fetch budget plans
      const { data: budgetPlans, error: budgetError } = await (supabase as any)
        .from('treatment_budget_planning')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('period', period);

      if (budgetError) {
        console.error('[useTreatmentProfitPlanning] Error fetching budget plans:', budgetError);
      }

      const budgetPlanMap = new Map<string, TreatmentBudgetPlanning>();
      if (budgetPlans) {
        budgetPlans.forEach((plan: TreatmentBudgetPlanning) => {
          budgetPlanMap.set(plan.treatment_id, plan);
        });
      }

      // Step 3: Fetch profitability data via RPC (same as profitability page)
      const rpcParams = {
        p_organization_id: organizationId,
        p_from_date: effectiveFromDate,
        p_to_date: effectiveToDate,
        p_location_id: selectedLocationId || null,
      };

      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_profitability_invoice_items', rpcParams);

      if (rpcError) {
        console.error('[useTreatmentProfitPlanning] RPC error:', rpcError);
        throw rpcError;
      }

      const rpcRows = (rpcData ?? []) as Array<{
        treatment_id: string | null;
        treatment_name: string;
        treatment_code: string;
        category_name: string;
        paid_month: string;
        no_of_treatments: number;
        total_revenue: number;
        material_cost: number;
        lab_bill: number;
        therapist_pay_rate: number;
        percent_fees: number;
        finance_fee: number;
        hourly_rate: number;
        duration_minutes: number;
      }>;

      // Step 4: Aggregate RPC rows per treatment (across all months)
      // Group by treatment UUID, summing counts and revenue
      const aggregated = new Map<string, {
        count: number; totalPrice: number; treatmentUUID: string | null;
        treatmentName: string; categoryName: string;
        materialCost: number; labBill: number; therapistPayRate: number;
        percentFees: number; financeFee: number; hourlyRate: number; durationMinutes: number;
      }>();

      for (const row of rpcRows) {
        const key = row.treatment_id || `name:${row.treatment_name}`;
        const count = Number(row.no_of_treatments) || 0;
        const totalRev = Number(row.total_revenue) || 0;

        const existing = aggregated.get(key);
        if (existing) {
          existing.count += count;
          existing.totalPrice += totalRev;
        } else {
          aggregated.set(key, {
            count,
            totalPrice: totalRev,
            treatmentUUID: row.treatment_id,
            treatmentName: row.treatment_name,
            categoryName: row.category_name || '-',
            materialCost: Number(row.material_cost) || 0,
            labBill: Number(row.lab_bill) || 0,
            therapistPayRate: Number(row.therapist_pay_rate) || 0,
            percentFees: Number(row.percent_fees) || 0,
            financeFee: Number(row.finance_fee) || 0,
            hourlyRate: Number(row.hourly_rate) || 0,
            durationMinutes: Number(row.duration_minutes) || 0,
          });
        }
      }

      // Track which treatments have RPC data
      const treatmentsWithData = new Set<string>();
      aggregated.forEach((g) => {
        if (g.treatmentUUID) treatmentsWithData.add(g.treatmentUUID);
      });

      // Step 5: Build result rows from aggregated RPC data + zero-volume treatments
      const result: TreatmentProfitPlanningItem[] = [];

      // Rows from RPC data
      for (const [, g] of aggregated) {
        const { totalPrice, count, treatmentUUID } = g;
        const t = treatmentUUID ? treatmentById.get(treatmentUUID) : null;

        const mat = t ? (t.material_cost || 0) : g.materialCost;
        const lab = t ? (t.lab_bill || 0) : g.labBill;
        const thr = t ? (t.therapist_pay_rate || 0) : g.therapistPayRate;
        const opCost = t
          ? (t.hourly_rate || 0) * ((t.duration_minutes || 0) / 60)
          : g.hourlyRate * (g.durationMinutes / 60);
        const pctFees = t ? (t.percent_fees || 0) : g.percentFees;
        const finPct = t ? (t.finance_fee || 0) : g.financeFee;

        const avg = count > 0 ? totalPrice / count : 0;
        const assocPay = avg * (pctFees / 100);
        const finFee = avg * (finPct / 100);
        const expUnit = mat + lab + thr + opCost + assocPay + finFee;
        const plUnit = avg - expUnit;
        const totExp = expUnit * count;
        const totPL = totalPrice - totExp;
        const plPct = totalPrice !== 0 ? (totPL / totalPrice) * 100 : 0;
        const princProfit = totalPrice - assocPay * count;
        const princPct = totalPrice !== 0 ? (princProfit / totalPrice) * 100 : 0;

        let categoryName: string | null = null;
        if (t) {
          const category = t.category;
          if (category) {
            if (Array.isArray(category)) {
              const valid = category.find((c: any) => c && !c.deleted_at);
              categoryName = valid?.name || null;
            } else if (category.name && !category.deleted_at) {
              categoryName = category.name;
            }
          }
        } else {
          categoryName = g.categoryName !== '-' ? g.categoryName : null;
        }

        const treatmentId = t?.id || treatmentUUID || g.treatmentName;
        const budgetPlan = t ? budgetPlanMap.get(t.id) : undefined;

        result.push({
          id: treatmentId,
          treatmentId,
          treatmentName: t ? t.treatment_name : g.treatmentName,
          categoryId: t?.category_id || null,
          categoryName,
          treatmentType: t?.treatment_type || null,
          currentVolume: count,
          currentRevenue: totalPrice,
          avgIncome: Math.round(avg * 100) / 100,
          materialCost: mat,
          labBill: lab,
          therapistPayRate: thr,
          opCostPerTreatment: Math.round(opCost * 100) / 100,
          associatePay: Math.round(assocPay * 100) / 100,
          financeFee: Math.round(finFee * 100) / 100,
          expensePerUnit: Math.round(expUnit * 100) / 100,
          profitLossPerUnit: Math.round(plUnit * 100) / 100,
          totalExpense: Math.round(totExp * 100) / 100,
          totalProfitLoss: Math.round(totPL * 100) / 100,
          principalProfit: Math.round(princProfit * 100) / 100,
          plPercent: Math.round(plPct * 10) / 10,
          principalProfitPercent: Math.round(princPct * 10) / 10,
          associatePercent: pctFees,
          financePercent: finPct,
          hourlyRate: t ? (t.hourly_rate || 0) : g.hourlyRate,
          durationMinutes: t ? (t.duration_minutes || 0) : g.durationMinutes,
          plannedVolume: budgetPlan?.planned_volume || 0,
          plannedRevenue: budgetPlan?.planned_revenue || 0,
          targetMargin: budgetPlan?.target_margin || 0,
        });
      }

      // Add zero-volume rows for treatments with no RPC data
      for (const treatment of treatments) {
        if (treatmentsWithData.has(treatment.id)) continue;

        const category = treatment.category;
        let categoryName: string | null = null;
        if (category) {
          if (Array.isArray(category)) {
            const valid = category.find((c: any) => c && !c.deleted_at);
            categoryName = valid?.name || null;
          } else if (category.name && !category.deleted_at) {
            categoryName = category.name;
          }
        }

        const budgetPlan = budgetPlanMap.get(treatment.id);

        result.push({
          id: treatment.id,
          treatmentId: treatment.id,
          treatmentName: treatment.treatment_name,
          categoryId: treatment.category_id,
          categoryName,
          treatmentType: treatment.treatment_type,
          currentVolume: 0,
          currentRevenue: 0,
          avgIncome: 0,
          materialCost: treatment.material_cost || 0,
          labBill: treatment.lab_bill || 0,
          therapistPayRate: treatment.therapist_pay_rate || 0,
          opCostPerTreatment: Math.round(((treatment.hourly_rate || 0) * ((treatment.duration_minutes || 0) / 60)) * 100) / 100,
          associatePay: 0,
          financeFee: 0,
          expensePerUnit: 0,
          profitLossPerUnit: 0,
          totalExpense: 0,
          totalProfitLoss: 0,
          principalProfit: 0,
          plPercent: 0,
          principalProfitPercent: 0,
          associatePercent: treatment.percent_fees || 0,
          financePercent: treatment.finance_fee || 0,
          hourlyRate: treatment.hourly_rate || 0,
          durationMinutes: treatment.duration_minutes || 0,
          plannedVolume: budgetPlan?.planned_volume || 0,
          plannedRevenue: budgetPlan?.planned_revenue || 0,
          targetMargin: budgetPlan?.target_margin || 0,
        });
      }

      return result;
    },
    enabled: !!organizationId,
  });

  // Save/Update budget plan mutation
  const saveBudgetPlanMutation = useMutation({
    mutationFn: async (data: {
      treatmentId: string;
      plannedVolume: number;
      plannedRevenue: number;
      targetMargin: number;
    }) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const { data: result, error } = await (supabase as any)
        .from('treatment_budget_planning')
        .upsert({
          treatment_id: data.treatmentId,
          organization_id: organizationId,
          period,
          planned_volume: data.plannedVolume,
          planned_revenue: data.plannedRevenue,
          target_margin: data.targetMargin,
          updated_by: user.id,
        }, {
          onConflict: 'treatment_id,organization_id,period',
        })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatment_profit_planning', organizationId] });
    },
  });

  // Save multiple budget plans at once
  const saveBudgetPlansMutation = useMutation({
    mutationFn: async (plans: Array<{
      treatmentId: string;
      plannedVolume: number;
      plannedRevenue: number;
      targetMargin: number;
    }>) => {
      if (!organizationId) throw new Error('No organization selected');
      if (!user?.id) throw new Error('Not authenticated');

      const plansToUpsert = plans.map(plan => ({
        treatment_id: plan.treatmentId,
        organization_id: organizationId,
        period,
        planned_volume: plan.plannedVolume,
        planned_revenue: plan.plannedRevenue,
        target_margin: plan.targetMargin,
        updated_by: user.id,
      }));

      const { error } = await (supabase as any)
        .from('treatment_budget_planning')
        .upsert(plansToUpsert, {
          onConflict: 'treatment_id,organization_id,period',
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treatment_profit_planning', organizationId] });
    },
  });

  return {
    planningData,
    isLoading,
    saveBudgetPlan: saveBudgetPlanMutation.mutateAsync,
    saveBudgetPlans: saveBudgetPlansMutation.mutateAsync,
    isSaving: saveBudgetPlanMutation.isPending || saveBudgetPlansMutation.isPending,
  };
}
