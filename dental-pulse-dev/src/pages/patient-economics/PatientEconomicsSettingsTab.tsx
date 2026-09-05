/**
 * Patient Economics Engine — Settings tab (/patients?tab=settings).
 * Layout aligned with patient-economics-engine-mockup-v5.1.html #settings.
 */

import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/hooks/useOrganization';
import { ClinicianRemunerationProfiles } from '@/components/patient-economics/ClinicianRemunerationProfiles';
import { PeEconomicAssumptionsPanel } from '@/components/patient-economics/PeEconomicAssumptionsPanel';
import { PeConversionProbabilitiesPanel } from '@/components/patient-economics/PeConversionProbabilitiesPanel';
import { PeProvenanceConfidencePanel } from '@/components/patient-economics/PeProvenanceConfidencePanel';
import { PeNhsUdaContractSettings } from '@/components/patient-economics/PeNhsUdaContractSettings';
import { cn } from '@/lib/utils';
import { PE_CTX_BANNER_CLASS } from '@/lib/peVisualTokens';

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

export function PatientEconomicsSettingsTab() {
  const { organizationId, isLoading: orgLoading } = useOrganization();

  return (
    <div className="space-y-5">
      {!orgLoading && !organizationId && (
        <div className={PE_CTX_BANNER_CLASS}>
          Select a practice to configure economic assumptions.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SettingsCard
          title="Economic Assumptions"
          subtitle="Practice-level thresholds and windows — defaults match production behaviour until you change them"
          primary
          className="xl:col-span-2"
        >
          <ClinicianRemunerationProfiles organizationId={organizationId} />
          <div className="mt-2 border-t border-border pt-1">
            <PeEconomicAssumptionsPanel organizationId={organizationId} />
          </div>
        </SettingsCard>

        <SettingsCard
          title="Conversion Probabilities"
          subtitle="Commitment Rate–derived opportunity weighting (D16)"
        >
          <PeConversionProbabilitiesPanel />
        </SettingsCard>

        <SettingsCard
          title="Data Provenance & Confidence™"
          subtitle="Every figure is tagged by where it comes from, not just how sure we are."
          primary
        >
          <PeProvenanceConfidencePanel />
        </SettingsCard>

        <SettingsCard
          title="Status, Recall & Data Source"
          subtitle="Definitions that drive the calculations — partial; see PE_SETTINGS_NOTES.md"
        >
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Scheduling window and retention day thresholds live in Economic Assumptions. Full
            integration health panel deferred.
          </p>
          <SetRow
            label="Active window"
            description="Mockup placeholder — superseded by 4-tier retention (Economic Assumptions)."
            control={
              <span className="text-xs text-muted-foreground">See retention thresholds</span>
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
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Contribution exclusion and separate UDA tracking are always enforced in the view and
            Pulse UI. Clawback threshold and mixed-patient options deferred — see PE_SETTINGS_NOTES.md.
          </p>
          <div className="grid gap-0 md:grid-cols-2">
            <SetRow
              label="Exclude UDA income from contribution"
              description="UDA is contract-value based, not margin-based."
              control={
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Always enforced
                </span>
              }
            />
            <SetRow
              label="Track UDA delivery separately"
              description="Delivered vs contracted UDAs in its own lens."
              control={
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  Always enforced
                </span>
              }
            />
          </div>

          <div className="mt-2 border-t border-border pt-1">
            <div className="pt-3 text-[13px] font-semibold text-foreground">
              NHS contract (this practice)
            </div>
            <PeNhsUdaContractSettings organizationId={organizationId} />
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
