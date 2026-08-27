/**
 * Patient Economics Engine — Settings tab (/patients?tab=settings).
 * Layout aligned with patient-economics-engine-mockup-v5.1.html #settings.
 */

import { Link } from 'react-router-dom';
import { Check, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrganization } from '@/hooks/useOrganization';
import { ClinicianRemunerationProfiles } from '@/components/patient-economics/ClinicianRemunerationProfiles';
import { cn } from '@/lib/utils';

function SettingsCard({
  title,
  subtitle,
  primary = false,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  primary?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[14px] border bg-card px-5 py-[18px] shadow-sm',
        primary ? 'border-primary/35' : 'border-border',
        className,
      )}
    >
      <h3 className={cn('text-[15px] font-bold', primary ? 'text-primary' : 'text-foreground')}>
        {title}
      </h3>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function SetRow({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{label}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ProvenanceChip({ kind }: { kind: 'dentally' | 'derived' | 'modelled' | 'external' }) {
  const styles = {
    dentally: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    derived: 'bg-primary/10 text-primary border-primary/25',
    modelled: 'bg-amber-50 text-amber-800 border-amber-200',
    external: 'bg-violet-50 text-violet-700 border-violet-200',
  };
  const labels = {
    dentally: 'Dentally',
    derived: 'Derived',
    modelled: 'Modelled',
    external: 'External',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        styles[kind],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {labels[kind]}
    </span>
  );
}

export function PatientEconomicsSettingsTab() {
  const { organizationId, isLoading: orgLoading } = useOrganization();

  return (
    <div className="space-y-5">
      {!orgLoading && !organizationId && (
        <div className="rounded-[10px] border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
          Select a practice to configure economic assumptions.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SettingsCard
          title="Economic Assumptions"
          subtitle="Used to compute contribution where live cost feeds aren't connected — the “only a few assumptions” layer"
          primary
        >
          <ClinicianRemunerationProfiles organizationId={organizationId} />

          <SetRow
            label="Lab cost source"
            description="Where treatment lab cost comes from."
            control={
              <Select defaultValue="standard" disabled>
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xero">Dentally item → Xero (Phase 2)</SelectItem>
                  <SelectItem value="standard">Treatment standard cost</SelectItem>
                </SelectContent>
              </Select>
            }
          />

          <SetRow
            label="Material standard-cost library"
            description="Per-treatment consumable cost (TPE library)."
            control={
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled>
                Edit · 48 treatments
              </Button>
            }
          />

          <SetRow
            label="Membership service cost"
            description="Annual expected delivery cost per member."
            control={
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] text-muted-foreground">£</span>
                <Input className="h-8 w-20 text-xs" defaultValue="205" disabled />
              </div>
            }
          />
        </SettingsCard>

        <SettingsCard
          title="Conversion Probabilities"
          subtitle="Weight the opportunity pipeline — never collapse gross & weighted"
        >
          <SetRow
            label="Auto-learn from your history"
            description="Use each treatment's real planned→completed rate when the sample is large enough."
            control={<Switch disabled defaultChecked />}
          />
          <SetRow
            label="Implant"
            description="Manual override when history is thin."
            control={
              <div className="flex items-center gap-1.5">
                <Input className="h-8 w-[70px] text-xs" defaultValue="34" disabled />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            }
          />
          <SetRow
            label="Churn model"
            description="Drives Contribution-at-Risk weighting."
            control={
              <Select defaultValue="recall" disabled>
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recall">Recall-gap based</SelectItem>
                  <SelectItem value="behavioural">Behavioural (attendance + gap)</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </SettingsCard>

        <SettingsCard
          title="Data Provenance & Confidence™"
          subtitle="Every figure is tagged by where it comes from, not just how sure we are."
          primary
        >
          <div className="mb-3 flex flex-wrap gap-2 rounded-[10px] bg-muted/50 p-3">
            <ProvenanceChip kind="dentally" />
            <ProvenanceChip kind="derived" />
            <ProvenanceChip kind="modelled" />
            <ProvenanceChip kind="external" />
          </div>
          <SetRow
            label="Associate, lab, materials, CAC"
            description="Contracts, Xero / QBO, marketing spend. Not from Dentally."
            control={<ProvenanceChip kind="external" />}
          />
          <SetRow
            label="Show provenance tags in UI"
            description="Display the chip beside every computed figure."
            control={<Switch disabled defaultChecked />}
          />
        </SettingsCard>

        <SettingsCard
          title="Status, Recall & Data Source"
          subtitle="Definitions that drive the calculations"
        >
          <SetRow
            label="Active window"
            description="Seen within N months = Active."
            control={
              <div className="flex items-center gap-1.5">
                <Input className="h-8 w-16 text-xs" defaultValue="18" disabled />
                <span className="text-xs text-muted-foreground">mo</span>
              </div>
            }
          />
          <SetRow
            label="Primary source"
            description="Practice management integration."
            control={
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                Dentally · Connected
              </span>
            }
          />
          <SetRow
            label="Dentally PAT (admin)"
            description="Encrypted token for Patient Economics sync — managed in app Settings."
            control={
              <Button asChild type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Link to="/settings">
                  <Settings2 className="h-3 w-3" />
                  App Settings
                </Link>
              </Button>
            }
          />
        </SettingsCard>

        <SettingsCard
          title="NHS / UDA treatment"
          subtitle="How NHS work is treated so it never distorts private contribution"
          className="xl:col-span-2"
        >
          <div className="grid gap-0 md:grid-cols-2">
            <SetRow
              label="Exclude UDA income from contribution"
              description="UDA is contract-value based, not margin-based."
              control={<Switch disabled defaultChecked />}
            />
            <SetRow
              label="Track UDA delivery separately"
              description="Delivered vs contracted UDAs in its own lens."
              control={<Switch disabled defaultChecked />}
            />
          </div>
        </SettingsCard>
      </div>

      <div className="flex justify-end gap-2.5 pt-1">
        <Button type="button" variant="outline" size="sm" disabled>
          Reset
        </Button>
        <Button type="button" size="sm" className="gap-1.5" disabled>
          <Check className="h-3.5 w-3.5" />
          Save changes
        </Button>
      </div>
    </div>
  );
}
