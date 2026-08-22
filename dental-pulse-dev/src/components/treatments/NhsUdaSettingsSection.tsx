import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/hooks/useOrganization';
import { useProviders } from '@/hooks/useProviders';
import { useLocations } from '@/hooks/useLocations';
import { useFilters } from '@/contexts/FilterContext';
import { UdaContractGoalsPanel, type UdaContractType } from '@/components/providers/UdaContractGoalsPanel';

interface NhsUdaSettingsSectionProps {
  contractType: UdaContractType;
}

// UDA Goals Settings, relocated here from the Provider pages (Dentist /
// Therapist / Hygienist / Other each used to show their own copy, scoped to
// that provider type). Here it covers every provider type together -- the
// NHS/MOS split is still what matters, not the provider's role. Rendered
// once per top-level NHS/MOS tab on the NHS Contract Performance page.
export function NhsUdaSettingsSection({ contractType }: NhsUdaSettingsSectionProps) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { selectedLocationId } = useFilters();
  const { allAvailableLocations } = useLocations();
  const { providers } = useProviders(undefined, undefined, { includeInactive: true });
  const [financialMonthStart, setFinancialMonthStart] = useState<number | null>(null);

  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of allAvailableLocations) map.set(loc.id, loc.location_name);
    return map;
  }, [allAvailableLocations]);

  useEffect(() => {
    const load = async () => {
      if (!organizationId) return;
      const { data } = await (supabase as any)
        .from('organization_settings')
        .select('financial_month_start')
        .eq('organization_id', organizationId)
        .maybeSingle();
      setFinancialMonthStart(data?.financial_month_start || 4);
    };
    load();
  }, [organizationId]);

  const locationLabel = selectedLocationId
    ? (locationMap.get(selectedLocationId) ?? 'selected location')
    : 'selected location';

  return (
    <UdaContractGoalsPanel
      contractType={contractType}
      organizationId={organizationId}
      selectedLocationId={selectedLocationId}
      locationLabel={locationLabel}
      financialMonthStart={financialMonthStart}
      filteredProviders={providers}
      providerType={null}
      userId={user?.id}
      userEmail={user?.email}
    />
  );
}
