/**
 * Patient Economics Settings — NHS contract inputs for UDA delivery / clawback.
 * uda_rate is DB-generated: nhs_contract_value ÷ total_uda_obligation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { ukDentalFinancialYear } from '@/utils/dentpulseNhsIncome';
import { PE_PRACTICE_UDA_RATE_QUERY_KEY } from '@/components/patient-economics/ClinicianRemunerationProfiles';

type PeNhsUdaContractSettingsProps = {
  organizationId?: string | null;
};

function formatRate(contractValue: number, obligation: number): string {
  if (!(obligation > 0) || !(contractValue >= 0)) return '—';
  const rate = contractValue / obligation;
  const rounded = Math.round(rate * 10000) / 10000;
  return `£${rounded.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} / UDA`;
}

export function PeNhsUdaContractSettings({
  organizationId,
}: PeNhsUdaContractSettingsProps) {
  const queryClient = useQueryClient();
  const fy = useMemo(() => ukDentalFinancialYear(new Date()), []);
  const [contractValue, setContractValue] = useState('');
  const [obligation, setObligation] = useState('');
  const [storedRate, setStoredRate] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      // Prefer practice-wide row (location_id null); else sum location rows for display.
      const { data: orgRow, error: orgErr } = await (supabase as any)
        .from('uda_settings')
        .select('nhs_contract_value, total_uda_obligation, uda_rate')
        .eq('organization_id', organizationId)
        .eq('financial_year', fy)
        .eq('contract_type', 'NHS')
        .is('location_id', null)
        .maybeSingle();

      if (orgErr) throw orgErr;

      if (orgRow) {
        setContractValue(
          orgRow.nhs_contract_value != null ? String(orgRow.nhs_contract_value) : '',
        );
        setObligation(
          orgRow.total_uda_obligation != null ? String(orgRow.total_uda_obligation) : '',
        );
        setStoredRate(
          orgRow.uda_rate != null && Number.isFinite(Number(orgRow.uda_rate))
            ? Number(orgRow.uda_rate)
            : null,
        );
        return;
      }

      const { data: locRows, error: locErr } = await (supabase as any)
        .from('uda_settings')
        .select('nhs_contract_value, total_uda_obligation, uda_rate')
        .eq('organization_id', organizationId)
        .eq('financial_year', fy)
        .eq('contract_type', 'NHS')
        .not('location_id', 'is', null);

      if (locErr) throw locErr;

      if (locRows && locRows.length > 0) {
        let cv = 0;
        let ob = 0;
        for (const r of locRows as Array<{
          nhs_contract_value: number | string | null;
          total_uda_obligation: number | string | null;
        }>) {
          cv += Number(r.nhs_contract_value) || 0;
          ob += Number(r.total_uda_obligation) || 0;
        }
        setContractValue(cv > 0 ? String(cv) : '');
        setObligation(ob > 0 ? String(ob) : '');
        setStoredRate(ob > 0 ? cv / ob : null);
        return;
      }

      setContractValue('');
      setObligation('');
      setStoredRate(null);
    } catch (err) {
      console.error('[PE UDA settings] load:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load UDA settings');
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, fy]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedContract = Number(contractValue);
  const parsedObligation = Number(obligation);

  const liveRateLabel = (() => {
    if (
      contractValue.trim() !== '' &&
      obligation.trim() !== '' &&
      Number.isFinite(parsedContract) &&
      Number.isFinite(parsedObligation) &&
      parsedObligation > 0
    ) {
      return formatRate(parsedContract, parsedObligation);
    }
    if (storedRate != null) {
      return `£${storedRate.toLocaleString('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })} / UDA`;
    }
    return '—';
  })();

  const save = async () => {
    if (!organizationId) return;
    const cv = contractValue.trim() === '' ? null : Number(contractValue);
    const ob = obligation.trim() === '' ? null : Number(obligation);
    if (cv != null && (!Number.isFinite(cv) || cv < 0)) {
      toast.error('Contract value must be a non-negative number');
      return;
    }
    if (ob != null && (!Number.isFinite(ob) || ob < 0)) {
      toast.error('UDA obligation must be a non-negative number');
      return;
    }
    if ((cv == null || cv === 0) && (ob == null || ob === 0)) {
      toast.error('Enter NHS contract value and/or total UDA obligation');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await (supabase as any).from('uda_settings').upsert(
        {
          organization_id: organizationId,
          location_id: null,
          financial_year: fy,
          contract_type: 'NHS',
          nhs_contract_value: cv,
          total_uda_obligation: ob,
        },
        {
          onConflict: 'organization_id,location_id,financial_year,contract_type',
        },
      );
      if (error) throw error;
      toast.success('NHS / UDA contract saved');
      await queryClient.invalidateQueries({
        queryKey: ['v_invoice_contribution', 'summary'],
      });
      await queryClient.invalidateQueries({
        queryKey: [PE_PRACTICE_UDA_RATE_QUERY_KEY, organizationId],
      });
      await load();
    } catch (err) {
      console.error('[PE UDA settings] save:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save UDA settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (!organizationId) {
    return (
      <p className="py-2 text-[12.5px] text-muted-foreground">
        Select a practice to configure the NHS UDA contract.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-3 space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-3 rounded-[10px] border border-danger/30 bg-danger-muted px-3 py-2.5 text-sm text-danger-strong">
        {loadError}
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      <p className="text-[12.5px] text-muted-foreground">
        Financial year <span className="font-semibold text-foreground">{fy}</span> (1 Apr{' '}
        {fy} – 31 Mar {fy + 1}). UDA rate is calculated automatically from contract value ÷
        obligation — used by Economic Pulse for delivery % and clawback.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pe-nhs-contract-value" className="text-[12.5px]">
            NHS contract value (£)
          </Label>
          <Input
            id="pe-nhs-contract-value"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="e.g. 300000"
            value={contractValue}
            onChange={(e) => setContractValue(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-uda-obligation" className="text-[12.5px]">
            Total UDA obligation
          </Label>
          <Input
            id="pe-uda-obligation"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="e.g. 10000"
            value={obligation}
            onChange={(e) => setObligation(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border bg-muted/40 px-3.5 py-2.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            UDA rate (auto)
          </div>
          <div className="mt-0.5 text-[15px] font-bold text-foreground">{liveRateLabel}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" variant="outline" size="sm" className="h-8 text-xs">
            <Link to="/treatments/nhs">Full NHS contract page</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void save()}
            disabled={isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save contract
          </Button>
        </div>
      </div>
    </div>
  );
}
