import { Helmet } from 'react-helmet-async';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { PLAN_TIERS, PLAN_LABELS, PlanTier } from '@/lib/planRegistry';

interface OrgRow {
  id: string;
  name: string;
  plan_tier: string;
}

export default function PlatformAdminOrganizations() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ['platform-admin-organizations'],
    queryFn: async (): Promise<OrgRow[]> => {
      // Cast to `any`: plan_tier isn't in the generated Supabase types yet —
      // regenerate types after applying the organization_plan_tier migration
      // to drop this cast (same situation as useModuleAccess.ts).
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('id, name, plan_tier')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as OrgRow[];
    },
  });

  const filtered = organizations.filter((org) =>
    org.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const handlePlanChange = async (orgId: string, planTier: PlanTier) => {
    setSavingId(orgId);
    const { error } = await (supabase as any)
      .from('organizations')
      .update({ plan_tier: planTier })
      .eq('id', orgId);
    setSavingId(null);

    if (error) {
      toast.error('Failed to update plan', { description: error.message });
      return;
    }
    toast.success('Plan updated.');
    queryClient.setQueryData<OrgRow[]>(['platform-admin-organizations'], (prev) =>
      (prev ?? []).map((org) => (org.id === orgId ? { ...org, plan_tier: planTier } : org)),
    );
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <Helmet>
        <title>Platform Admin — Organizations</title>
      </Helmet>

      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Organization Plans</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Set each organization's subscription plan (Basic / Essential / Growth / Accelerate).
            This controls which modules appear in their sidebar and are reachable by URL.
          </p>
        </div>

        <Input
          placeholder="Search organizations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead className="w-48">Plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    No organizations found.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>
                    <Select
                      value={org.plan_tier}
                      disabled={savingId === org.id}
                      onValueChange={(value) => handlePlanChange(org.id, value as PlanTier)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLAN_TIERS.map((tier) => (
                          <SelectItem key={tier} value={tier}>
                            {PLAN_LABELS[tier]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
