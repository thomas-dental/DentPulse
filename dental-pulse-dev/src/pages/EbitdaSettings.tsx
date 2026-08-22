import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { usePermissions } from '@/hooks/usePermissions';

// ─── HELPERS ───
const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

// ─── SETTINGS PANEL ───
function SettingsPanel({
  settingsApi,
  adjustmentsApi,
}: {
  settingsApi: { current: any; update: (v: any) => Promise<void> };
  adjustmentsApi: { items: any[]; add: (v: any) => Promise<void>; update: (v: any) => Promise<void>; remove: (id: string) => Promise<void> };
}) {
  const { can } = usePermissions();
  const canUpdateSettings = can('ebitda_to_value', 'update', 'settings_adjustments_tab');
  const canAddAdjustment = can('ebitda_to_value', 'add', 'settings_adjustments_tab');
  const canDeleteAdjustment = can('ebitda_to_value', 'delete', 'settings_adjustments_tab');
  const s = settingsApi.current;
  const [netDebt, setNetDebt] = useState(String(s.net_debt || 0));
  const [baseMultiple, setBaseMultiple] = useState(String(s.base_multiple || 5.8));
  const [rampUp, setRampUp] = useState(String(s.new_associate_ramp_up || 0));
  const [rampConf, setRampConf] = useState(String(s.new_associate_ramp_confidence || 50));
  const [utilImprove, setUtilImprove] = useState(String(s.utilisation_improvement || 0));
  const [utilConf, setUtilConf] = useState(String(s.utilisation_improvement_confidence || 70));
  const [departureRisk, setDepartureRisk] = useState(String(s.departure_risk_factor ?? 30));
  const [mgmtDepth, setMgmtDepth] = useState(String(s.mgmt_depth_penalty ?? -0.3));
  const [standardisation, setStandardisation] = useState(String(s.standardisation_penalty ?? -0.2));
  const [leverageRisk, setLeverageRisk] = useState(String(s.leverage_penalty ?? -0.2));
  // User-added custom Multiple Impact Penalties (label + value-as-string for
  // editing). Persisted to ebitda_valuation_settings.custom_penalties.
  const [customPenalties, setCustomPenalties] = useState<Array<{ id: string; label: string; value: string }>>(
    (s.custom_penalties ?? []).map(p => ({ id: p.id, label: p.label, value: String(p.value) }))
  );

  // Sync local state when settings load or change externally
  useEffect(() => {
    setNetDebt(String(s.net_debt || 0));
    setBaseMultiple(String(s.base_multiple || 5.8));
    setRampUp(String(s.new_associate_ramp_up || 0));
    setRampConf(String(s.new_associate_ramp_confidence || 50));
    setUtilImprove(String(s.utilisation_improvement || 0));
    setUtilConf(String(s.utilisation_improvement_confidence || 70));
    setDepartureRisk(String(s.departure_risk_factor ?? 30));
    setMgmtDepth(String(s.mgmt_depth_penalty ?? -0.3));
    setStandardisation(String(s.standardisation_penalty ?? -0.2));
    setLeverageRisk(String(s.leverage_penalty ?? -0.2));
    setCustomPenalties((s.custom_penalties ?? []).map(p => ({ id: p.id, label: p.label, value: String(p.value) })));
  }, [s]);
  const [saving, setSaving] = useState(false);

  // New adjustment form
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState<'normalisation' | 'sustainability_manual'>('normalisation');
  const [newConf, setNewConf] = useState('');
  const [adding, setAdding] = useState(false);

  async function handleSaveSettings() {
    setSaving(true);
    try {
      await settingsApi.update({
        net_debt: parseFloat(netDebt) || 0,
        base_multiple: parseFloat(baseMultiple) || 5.8,
        new_associate_ramp_up: parseFloat(rampUp) || 0,
        new_associate_ramp_confidence: parseInt(rampConf) || 50,
        utilisation_improvement: parseFloat(utilImprove) || 0,
        utilisation_improvement_confidence: parseInt(utilConf) || 70,
        departure_risk_factor: parseInt(departureRisk) || 30,
        mgmt_depth_penalty: mgmtDepth !== '' ? parseFloat(mgmtDepth) : -0.3,
        standardisation_penalty: standardisation !== '' ? parseFloat(standardisation) : -0.2,
        leverage_penalty: leverageRisk !== '' ? parseFloat(leverageRisk) : -0.2,
        custom_penalties: customPenalties
          .map(p => ({ id: p.id, label: p.label.trim(), value: parseFloat(p.value) }))
          .filter(p => p.label !== '' && Number.isFinite(p.value)),
      });
      toast.success('Valuation settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAdjustment() {
    if (!newLabel.trim() || !newAmount.trim()) return;
    setAdding(true);
    try {
      await adjustmentsApi.add({
        label: newLabel.trim(),
        amount: parseFloat(newAmount) || 0,
        category: newCategory,
        confidence_pct: newCategory === 'sustainability_manual' && newConf ? parseInt(newConf) : null,
        notes: null,
      });
      setNewLabel('');
      setNewAmount('');
      setNewConf('');
      toast.success('Adjustment added');
    } catch {
      toast.error('Failed to add adjustment');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await adjustmentsApi.remove(id);
      toast.success('Adjustment removed');
    } catch {
      toast.error('Failed to remove');
    }
  }

  return (
    <div className="space-y-6">
      {/* Valuation Settings */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Valuation Settings</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Net Debt (£)</label>
            <Input type="number" value={netDebt} onChange={e => setNetDebt(e.target.value)} placeholder="0" disabled={!canUpdateSettings} />
            <div className="mt-2 p-2 bg-muted/50 rounded-md border border-border/50">
              <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Changing this will also update</div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">Enterprise Overview</span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="font-medium text-foreground">Equity Value</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">Multiple Engine</span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="font-medium text-foreground">Debt Mgmt Premium (+0.1x)</span>
                </div>
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Base Multiple (×)</label>
            <Input type="number" step="0.1" value={baseMultiple} onChange={e => setBaseMultiple(e.target.value)} placeholder="5.8" disabled={!canUpdateSettings} />
            <div className="mt-2 p-2 bg-muted/50 rounded-md border border-border/50">
              <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Changing this will also update</div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">Multiple Engine</span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="font-medium text-foreground">Base Market (starting point of waterfall)</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">Multiple Engine</span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="font-medium text-foreground">Final Multiple</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">Enterprise Overview</span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="font-medium text-foreground">Enterprise Value &amp; Equity Value</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">Enterprise Overview</span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="font-medium text-foreground">Value Progression (baseline &amp; optimised)</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-muted-foreground">Scenario Simulator</span>
                  <span className="text-muted-foreground/40">&rarr;</span>
                  <span className="font-medium text-foreground">Live Valuation output</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sustainability Assumptions */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Sustainability Assumptions</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">New Associate Ramp-up (£)</label>
              <Input type="number" value={rampUp} onChange={e => setRampUp(e.target.value)} placeholder="0" disabled={!canUpdateSettings} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Confidence (%)</label>
              <Input type="number" min="0" max="100" value={rampConf} onChange={e => setRampConf(e.target.value)} placeholder="50" disabled={!canUpdateSettings} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Utilisation Improvement (£)</label>
              <Input type="number" value={utilImprove} onChange={e => setUtilImprove(e.target.value)} placeholder="0" disabled={!canUpdateSettings} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Confidence (%)</label>
              <Input type="number" min="0" max="100" value={utilConf} onChange={e => setUtilConf(e.target.value)} placeholder="70" disabled={!canUpdateSettings} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Departure Risk Factor (%)</label>
            <Input type="number" min="0" max="100" value={departureRisk} onChange={e => setDepartureRisk(e.target.value)} placeholder="30" disabled={!canUpdateSettings} />
          </div>
          <div className="mt-2 p-2 bg-muted/50 rounded-md border border-border/50">
            <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Changing these will also update</div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-1 h-1 rounded-full bg-warning flex-shrink-0" />
                <span className="text-muted-foreground">EBITDA Bridge</span>
                <span className="text-muted-foreground/40">&rarr;</span>
                <span className="font-medium text-foreground">Sustainability Haircuts &amp; Sustainable EBITDA</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-1 h-1 rounded-full bg-warning flex-shrink-0" />
                <span className="text-muted-foreground">Enterprise Overview</span>
                <span className="text-muted-foreground/40">&rarr;</span>
                <span className="font-medium text-foreground">Enterprise Value &amp; Equity Value</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-1 h-1 rounded-full bg-warning flex-shrink-0" />
                <span className="text-muted-foreground">Enterprise Overview</span>
                <span className="text-muted-foreground/40">&rarr;</span>
                <span className="font-medium text-foreground">Value Progression (baseline &amp; optimised)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Multiple Impact Penalties */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Multiple Impact Penalties</h3>
          {canUpdateSettings && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              title="Add multiplier"
              onClick={() => setCustomPenalties(prev => [
                ...prev,
                {
                  id: (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `cp_${Date.now()}_${prev.length}`,
                  label: '',
                  value: '',
                },
              ])}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add multiplier
            </Button>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Management Depth (×)</label>
            <Input type="number" step="0.1" value={mgmtDepth} onChange={e => setMgmtDepth(e.target.value)} placeholder="-0.3" disabled={!canUpdateSettings} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Standardisation (×)</label>
            <Input type="number" step="0.1" value={standardisation} onChange={e => setStandardisation(e.target.value)} placeholder="-0.2" disabled={!canUpdateSettings} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Leverage Risk (×)</label>
            <Input type="number" step="0.1" value={leverageRisk} onChange={e => setLeverageRisk(e.target.value)} placeholder="-0.2" disabled={!canUpdateSettings} />
          </div>

          {/* User-added custom multipliers — same layout as the fixed rows
              above (label line + full-width value input); the label is an
              inline-editable name and gets a remove button on its right. */}
          {customPenalties.map((cp, idx) => (
            <div key={cp.id}>
              <div className="flex items-center justify-between mb-1">
                <input
                  type="text"
                  value={cp.label}
                  onChange={e => setCustomPenalties(prev => prev.map((p, i) => i === idx ? { ...p, label: e.target.value } : p))}
                  placeholder="Custom multiplier (×)"
                  disabled={!canUpdateSettings}
                  className="flex-1 bg-transparent border-0 p-0 text-xs text-muted-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 disabled:opacity-100"
                />
                {canUpdateSettings && (
                  <button
                    type="button"
                    title="Remove multiplier"
                    onClick={() => setCustomPenalties(prev => prev.filter((_, i) => i !== idx))}
                    className="ml-2 shrink-0 text-destructive hover:text-destructive/70"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Input
                type="number"
                step="0.1"
                value={cp.value}
                onChange={e => setCustomPenalties(prev => prev.map((p, i) => i === idx ? { ...p, value: e.target.value } : p))}
                placeholder="-0.2"
                disabled={!canUpdateSettings}
              />
            </div>
          ))}
          <div className="mt-2 p-2 bg-muted/50 rounded-md border border-border/50">
            <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Changing these will also update</div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-1 h-1 rounded-full bg-destructive flex-shrink-0" />
                <span className="text-muted-foreground">Multiple Engine</span>
                <span className="text-muted-foreground/40">&rarr;</span>
                <span className="font-medium text-foreground">Management Depth, Standardisation &amp; Leverage Risk factors</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-1 h-1 rounded-full bg-destructive flex-shrink-0" />
                <span className="text-muted-foreground">Multiple Engine</span>
                <span className="text-muted-foreground/40">&rarr;</span>
                <span className="font-medium text-foreground">Final Multiple</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-1 h-1 rounded-full bg-destructive flex-shrink-0" />
                <span className="text-muted-foreground">Enterprise Overview</span>
                <span className="text-muted-foreground/40">&rarr;</span>
                <span className="font-medium text-foreground">Enterprise Value &amp; Equity Value</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {canUpdateSettings && (
      <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
        Save Settings
      </Button>
      )}

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">EBITDA Adjustments</h3>

        {/* Existing items */}
        {adjustmentsApi.items.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {adjustmentsApi.items.map(adj => (
              <div key={adj.id} className="flex items-center gap-2 py-1.5 px-2 bg-muted/50 rounded-md text-xs">
                <div className="flex-1">
                  <div className="font-medium">{adj.label}</div>
                  <div className="text-muted-foreground">
                    {adj.category === 'normalisation' ? 'Normalisation' : 'Sustainability'}
                    {adj.confidence_pct != null && ` · ${adj.confidence_pct}% conf.`}
                  </div>
                </div>
                <span className={cn('font-semibold tabular-nums', adj.amount > 0 ? 'text-success' : 'text-danger')}>
                  {adj.amount > 0 ? '+' : ''}{formatCurrency(adj.amount)}
                </span>
                {canDeleteAdjustment && (
                <button onClick={() => handleDelete(adj.id)} className="text-muted-foreground hover:text-danger transition-colors p-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add new */}
        {canAddAdjustment && (
        <div className="space-y-2 p-3 border border-border rounded-lg">
          <div className="text-xs font-semibold text-muted-foreground mb-1">Add New Adjustment</div>
          <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Owner salary add-back" className="text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="Amount (£)" className="text-xs" />
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as any)}
              className="text-xs rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="normalisation">Normalisation</option>
              <option value="sustainability_manual">Sustainability</option>
            </select>
          </div>
          {newCategory === 'sustainability_manual' && (
            <Input type="number" min="0" max="100" value={newConf} onChange={e => setNewConf(e.target.value)} placeholder="Confidence % (e.g. 50)" className="text-xs" />
          )}
          <Button size="sm" onClick={handleAddAdjustment} disabled={adding || !newLabel.trim() || !newAmount.trim()} className="w-full">
            {adding ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
            Add Adjustment
          </Button>
        </div>
        )}
      </div>
    </div>
  );
}

// ─── PAGE ───

export default function EbitdaSettings() {
  const { isLoading, settingsApi, adjustmentsApi } = useEbitdaValuation();

  if (isLoading) {
    return (
      <MainLayout userRole="admin">
        <Helmet><title>Settings & Adjustments | DentPulse</title></Helmet>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userRole="admin">
      <Helmet><title>Settings & Adjustments | DentPulse</title></Helmet>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings & Adjustments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">EBITDA valuation settings, quality weights and manual adjustments</p>
        </div>
        <SettingsPanel settingsApi={settingsApi} adjustmentsApi={adjustmentsApi} />
      </div>
    </MainLayout>
  );
}
