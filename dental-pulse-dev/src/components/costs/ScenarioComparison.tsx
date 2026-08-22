import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  GitCompare,
  TrendingUp,
  Loader2,
  Info,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface SavedScenario {
  id: string;
  name: string;
  description: string | null;
  lab_fees_percent: number;
  staff_costs_percent: number;
  operating_leases_percent: number;
  clinician_cost_percent: number;
  overhead_cost_percent: number;
  material_cost_percent: number;
  total_revenue: number;
  current_ebitda: number;
  created_at: string;
}

export interface ComparisonCostCenter {
  key: string;
  name: string;
  icon: React.ElementType;
  currentCost: number;
  currentPercent: number;
  colorClass: string;
  /** DB column name in saved_scenarios for this cost center's percent */
  scenarioField: string;
}

interface ScenarioComparisonProps {
  costCenters: ComparisonCostCenter[];
  totalRevenue: number;
  currentEBITDA: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

export function ScenarioComparison({
  costCenters,
  totalRevenue,
  currentEBITDA,
}: ScenarioComparisonProps) {
  const { user, profile } = useAuth();
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchScenarios = async () => {
    if (!profile?.current_organization_id) return;
    try {
      const { data, error } = await supabase
        .from('saved_scenarios')
        .select('*')
        .eq('organization_id', profile.current_organization_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setScenarios(data || []);
    } catch (error) {
      console.error('Error fetching scenarios:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchScenarios();
  }, [profile?.current_organization_id]);

  const toggleScenario = (id: string) => {
    setSelectedScenarios(prev => {
      if (prev.includes(id)) return prev.filter(s => s !== id);
      if (prev.length >= 3) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const getPercent = (scenario: SavedScenario | 'current', center: ComparisonCostCenter): number => {
    if (scenario === 'current') return center.currentPercent;
    return (scenario as any)[center.scenarioField] ?? 0;
  };

  const calculateMetrics = (scenario: SavedScenario | 'current') => {
    let totalChange = 0;
    const percents: Record<string, number> = {};
    for (const c of costCenters) {
      const pct = getPercent(scenario, c);
      percents[c.key] = pct;
      totalChange += c.currentCost * (pct / 100);
    }
    const ebitdaImpact = -totalChange;
    const newEBITDA = currentEBITDA + ebitdaImpact;
    return { percents, totalChange, ebitdaImpact, newEBITDA };
  };

  const selectedScenarioData = selectedScenarios
    .map(id => scenarios.find(s => s.id === id))
    .filter(Boolean) as SavedScenario[];

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <GitCompare className="w-5 h-5" />
            Scenario Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">Sign in to compare scenarios</p>
        </CardContent>
      </Card>
    );
  }

  const currentMetrics = calculateMetrics('current');

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <GitCompare className="w-5 h-5" />
          Scenario Comparison
          <Popover>
            <PopoverTrigger asChild>
              <button className="ml-1 text-muted-foreground hover:text-foreground transition-colors">
                <Info className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 text-sm" side="bottom" align="start">
              <p className="font-medium mb-2">How this is calculated</p>
              <ul className="space-y-1 text-muted-foreground text-xs">
                <li>- Each row shows the % adjustment for that cost center</li>
                <li>- <strong>Cost Change</strong> = Sum of (current cost x %) for all centers</li>
                <li>- <strong>EBITDA Impact</strong> = -(Cost Change) — cost reductions increase EBITDA</li>
                <li>- <strong>New EBITDA</strong> = Current EBITDA + EBITDA Impact</li>
              </ul>
            </PopoverContent>
          </Popover>
        </CardTitle>
        <p className="text-sm text-muted-foreground">Select up to 3 saved scenarios to compare side-by-side</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : scenarios.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <GitCompare className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No saved scenarios to compare</p>
            <p className="text-xs mt-1">Save scenarios first to compare them</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Scenario Selection */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Select Scenarios:</p>
              <ScrollArea className="h-[120px]">
                <div className="space-y-2">
                  {scenarios.map((scenario) => (
                    <div
                      key={scenario.id}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
                        selectedScenarios.includes(scenario.id)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      )}
                      onClick={() => toggleScenario(scenario.id)}
                    >
                      <Checkbox
                        checked={selectedScenarios.includes(scenario.id)}
                        onCheckedChange={() => toggleScenario(scenario.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{scenario.name}</p>
                        <p className="text-xs text-muted-foreground">{new Date(scenario.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Comparison Table */}
            {selectedScenarioData.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">Metric</th>
                      <th className="text-center py-2 px-3 font-medium bg-muted/30">Current</th>
                      {selectedScenarioData.map(s => (
                        <th key={s.id} className="text-center py-2 px-3 font-medium">
                          <span className="truncate block max-w-[100px]">{s.name}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Dynamic cost center rows */}
                    {costCenters.map(center => {
                      const Icon = center.icon;
                      const curPct = currentMetrics.percents[center.key];
                      return (
                        <tr key={center.key} className="border-b">
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <Icon className={cn("w-4 h-4", center.colorClass)} />
                              {center.name}
                            </div>
                          </td>
                          <td className="text-center py-2 px-3 bg-muted/30">
                            {curPct > 0 ? '+' : ''}{curPct}%
                          </td>
                          {selectedScenarioData.map(s => {
                            const pct = getPercent(s, center);
                            return (
                              <td key={s.id} className="text-center py-2 px-3">
                                <span className={cn(pct < 0 ? "text-success" : pct > 0 ? "text-destructive" : "")}>
                                  {pct > 0 ? '+' : ''}{pct}%
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className="bg-muted/30">
                      <td colSpan={2 + selectedScenarioData.length} className="py-1" />
                    </tr>
                    {/* Cost Change */}
                    <tr className="border-b">
                      <td className="py-2 px-3 font-medium">Cost Change</td>
                      <td className="text-center py-2 px-3 bg-muted/30">
                        <span className={cn("font-medium", currentMetrics.totalChange < 0 ? "text-success" : currentMetrics.totalChange > 0 ? "text-destructive" : "")}>
                          {formatCurrency(currentMetrics.totalChange)}
                        </span>
                      </td>
                      {selectedScenarioData.map(s => {
                        const m = calculateMetrics(s);
                        return (
                          <td key={s.id} className="text-center py-2 px-3">
                            <span className={cn("font-medium", m.totalChange < 0 ? "text-success" : m.totalChange > 0 ? "text-destructive" : "")}>
                              {formatCurrency(m.totalChange)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                    {/* EBITDA Impact */}
                    <tr className="border-b">
                      <td className="py-2 px-3 font-medium">EBITDA Impact</td>
                      <td className="text-center py-2 px-3 bg-muted/30">
                        <span className={cn("font-medium", currentMetrics.ebitdaImpact > 0 ? "text-success" : currentMetrics.ebitdaImpact < 0 ? "text-destructive" : "")}>
                          {currentMetrics.ebitdaImpact > 0 ? '+' : ''}{formatCurrency(currentMetrics.ebitdaImpact)}
                        </span>
                      </td>
                      {selectedScenarioData.map(s => {
                        const m = calculateMetrics(s);
                        return (
                          <td key={s.id} className="text-center py-2 px-3">
                            <span className={cn("font-medium", m.ebitdaImpact > 0 ? "text-success" : m.ebitdaImpact < 0 ? "text-destructive" : "")}>
                              {m.ebitdaImpact > 0 ? '+' : ''}{formatCurrency(m.ebitdaImpact)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                    {/* New EBITDA */}
                    <tr className="font-bold">
                      <td className="py-2 px-3">New EBITDA</td>
                      <td className="text-center py-2 px-3 bg-muted/30">{formatCurrency(currentMetrics.newEBITDA)}</td>
                      {selectedScenarioData.map(s => {
                        const m = calculateMetrics(s);
                        const isBetter = m.newEBITDA > currentMetrics.newEBITDA;
                        return (
                          <td key={s.id} className="text-center py-2 px-3">
                            <div className="flex items-center justify-center gap-1">
                              {formatCurrency(m.newEBITDA)}
                              {isBetter && <TrendingUp className="w-4 h-4 text-success" />}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {selectedScenarioData.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">Select scenarios above to compare</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
