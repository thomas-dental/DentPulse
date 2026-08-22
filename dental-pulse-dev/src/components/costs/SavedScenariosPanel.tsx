import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bookmark, Plus, Trash2, Check, Loader2, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ScenarioCostCenter {
  key: string;
  name: string;
  shortLabel: string;
  currentPercent: number;
  /** DB column name in saved_scenarios, e.g. "lab_fees_percent" */
  dbField: string;
}

interface SavedScenariosPanelProps {
  costCenters: ScenarioCostCenter[];
  totalRevenue: number;
  currentEBITDA: number;
  onLoadScenario: (percents: Record<string, number>) => void;
  /** @deprecated - kept for backward compat */
  labFeesPercent?: number;
  staffCostsPercent?: number;
  operatingLeasesPercent?: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

export function SavedScenariosPanel({
  costCenters,
  totalRevenue,
  currentEBITDA,
  onLoadScenario,
}: SavedScenariosPanelProps) {
  const { user, profile } = useAuth();
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDescription, setScenarioDescription] = useState('');

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

  useEffect(() => { fetchScenarios(); }, [profile?.current_organization_id]);

  const handleSaveScenario = async () => {
    if (!user || !profile?.current_organization_id || !scenarioName.trim()) {
      toast.error('Please enter a scenario name');
      return;
    }
    setIsSaving(true);
    try {
      const insertData: Record<string, any> = {
        organization_id: profile.current_organization_id,
        user_id: user.id,
        name: scenarioName.trim(),
        description: scenarioDescription.trim() || null,
        total_revenue: totalRevenue,
        current_ebitda: currentEBITDA,
      };
      for (const c of costCenters) {
        insertData[c.dbField] = c.currentPercent;
      }
      const { error } = await supabase.from('saved_scenarios').insert(insertData);
      if (error) throw error;
      toast.success('Scenario saved successfully');
      setScenarioName('');
      setScenarioDescription('');
      setDialogOpen(false);
      fetchScenarios();
    } catch (error) {
      console.error('Error saving scenario:', error);
      toast.error('Failed to save scenario');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteScenario = async (id: string) => {
    try {
      const { error } = await supabase.from('saved_scenarios').delete().eq('id', id);
      if (error) throw error;
      toast.success('Scenario deleted');
      fetchScenarios();
    } catch (error) {
      console.error('Error deleting scenario:', error);
      toast.error('Failed to delete scenario');
    }
  };

  const getScenarioPercent = (scenario: any, center: ScenarioCostCenter): number => {
    return scenario[center.dbField] ?? 0;
  };

  const calculateAvgChange = (scenario: any): number => {
    if (costCenters.length === 0) return 0;
    const sum = costCenters.reduce((s, c) => s + getScenarioPercent(scenario, c), 0);
    return sum / costCenters.length;
  };

  const handleLoad = (scenario: any) => {
    const percents: Record<string, number> = {};
    for (const c of costCenters) {
      percents[c.key] = getScenarioPercent(scenario, c);
    }
    onLoadScenario(percents);
  };

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bookmark className="w-5 h-5" />
            Saved Scenarios
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">Sign in to save and compare scenarios</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bookmark className="w-5 h-5" />
            Saved Scenarios
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="w-4 h-4" />
                Save Current
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save Current Scenario</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Scenario Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Q1 2024 Cost Reduction Plan"
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="Add notes about this scenario..."
                    value={scenarioDescription}
                    onChange={(e) => setScenarioDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-1">
                  <p className="font-medium">Current Settings:</p>
                  {costCenters.map(c => (
                    <p key={c.key}>{c.name}: {c.currentPercent > 0 ? '+' : ''}{c.currentPercent}%</p>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleSaveScenario} disabled={isSaving || !scenarioName.trim()}>
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                  ) : (
                    <><Check className="w-4 h-4 mr-2" />Save Scenario</>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : scenarios.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Bookmark className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No saved scenarios yet</p>
            <p className="text-xs mt-1">Save your current settings to compare later</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-3">
              {scenarios.map((scenario) => {
                const avgChange = calculateAvgChange(scenario);
                const isReduction = avgChange < 0;

                return (
                  <div key={scenario.id} className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm truncate">{scenario.name}</h4>
                          <Badge
                            variant={isReduction ? "default" : "destructive"}
                            className="text-xs flex-shrink-0"
                          >
                            {isReduction ? <TrendingDown className="w-3 h-3 mr-1" /> : <TrendingUp className="w-3 h-3 mr-1" />}
                            {avgChange > 0 ? '+' : ''}{avgChange.toFixed(0)}% avg
                          </Badge>
                        </div>
                        {scenario.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{scenario.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                          {costCenters.map(c => {
                            const pct = getScenarioPercent(scenario, c);
                            return (
                              <span key={c.key}>{c.shortLabel}: {pct > 0 ? '+' : ''}{pct}%</span>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {new Date(scenario.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => handleLoad(scenario)}>Load</Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Scenario</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{scenario.name}"? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteScenario(scenario.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
