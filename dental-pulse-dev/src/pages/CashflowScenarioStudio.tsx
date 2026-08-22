/**
 * Cash Flow Scenario Studio — standalone module (URL access only, not in sidebar).
 *
 * Route: /cashflow/scenario-studio
 *
 * A self-contained two-stage tool that implements two skills end-to-end:
 *   1. cash-flow-model-builder     → build a Week-0 13-week forecast from
 *      messy CSV/Excel exports (or a sample), preview the 7 workbook tabs,
 *      download week0_13_week_cash_flow_forecast.xlsx.
 *   2. cash-flow-scenario-dashboard → drive scenario levers on that model:
 *      presets, KPIs, base-vs-scenario chart, impact table, CFO exceptions.
 *
 * No org/Supabase dependencies — runs entirely client-side so the demo works
 * anywhere the URL is opened.
 */

import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { toast } from 'sonner';
import { LayoutGrid, SlidersHorizontal, Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModelBuilderPanel } from '@/components/cashflowStudio/ModelBuilderPanel';
import { ScenarioDashboard } from '@/components/cashflowStudio/ScenarioDashboard';
import { buildSampleModel } from '@/lib/cashflowStudio/sample';
import { parseFilesToModel } from '@/lib/cashflowStudio/parseFiles';
import { exportModelToXlsx } from '@/lib/cashflowStudio/exportXlsx';
import { useDentpulseCashModel } from '@/hooks/useDentpulseCashModel';
import type { CashFlowModel } from '@/lib/cashflowStudio/types';

type View = 'builder' | 'dashboard';

export default function CashflowScenarioStudio() {
  const [model, setModel] = useState<CashFlowModel | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [view, setView] = useState<View>('builder');

  // Live DentPulse loader state.
  const { load: loadDentpulse, hasOrg } = useDentpulseCashModel();
  const [openingCash, setOpeningCash] = useState<string>('');
  const [threshold, setThreshold] = useState<string>('25000');
  const [isLoadingLive, setIsLoadingLive] = useState(false);

  const loadSample = () => {
    setModel(buildSampleModel());
    setWarnings([]);
    toast.success('Sample 13-week model loaded');
  };

  const loadFromDentpulse = async () => {
    setIsLoadingLive(true);
    setWarnings([]);
    try {
      const { model: built, warnings: w } = await loadDentpulse({
        openingCash: Number(openingCash) || 0,
        threshold: Number(threshold) || 0,
      });
      setModel(built);
      setWarnings(w);
      toast.success('Built model from live DentPulse data');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsLoadingLive(false);
    }
  };

  const handleFiles = async (files: FileList) => {
    setIsParsing(true);
    setWarnings([]);
    try {
      const { model: built, warnings: w } = await parseFilesToModel(Array.from(files));
      setModel(built);
      setWarnings(w);
      toast.success(`Built model from ${files.length} file(s)`);
    } catch (e) {
      toast.error(`Could not build model: ${(e as Error).message}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDownload = () => {
    if (!model) return;
    exportModelToXlsx(model);
    toast.success('Workbook downloaded');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>Cash Flow Scenario Studio</title>
      </Helmet>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Cash Flow Scenario Studio</div>
            <div className="text-xs text-muted-foreground">
              Week-0 model builder + 13-week scenario dashboard
            </div>
          </div>
          <div className="flex gap-1 rounded-lg border p-1">
            <Button
              size="sm"
              variant={view === 'builder' ? 'default' : 'ghost'}
              onClick={() => setView('builder')}
            >
              <LayoutGrid className="mr-2 h-4 w-4" />
              Model Builder
            </Button>
            <Button
              size="sm"
              variant={view === 'dashboard' ? 'default' : 'ghost'}
              onClick={() => setView('dashboard')}
              disabled={!model}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Scenario Dashboard
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {view === 'builder' ? (
          <ModelBuilderPanel
            model={model}
            warnings={warnings}
            isParsing={isParsing}
            onLoadSample={loadSample}
            onFiles={handleFiles}
            onDownload={handleDownload}
            onOpenDashboard={() => setView('dashboard')}
            dentpulseSlot={
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Database className="h-4 w-4" />
                  Build from live DentPulse data
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Pulls real patient takings and trailing P&amp;L costs for the currently selected
                  organization and location, and projects them across the next 13 weeks. Enter your
                  current bank balance so ending cash is meaningful.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Opening bank balance (£)</label>
                    <Input
                      type="number"
                      placeholder="e.g. 120000"
                      value={openingCash}
                      onChange={(e) => setOpeningCash(e.target.value)}
                      className="w-44"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Cash threshold (£)</label>
                    <Input
                      type="number"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      className="w-36"
                    />
                  </div>
                  <Button onClick={loadFromDentpulse} disabled={isLoadingLive || !hasOrg}>
                    {isLoadingLive ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                    Load from DentPulse
                  </Button>
                </div>
                {!hasOrg && (
                  <p className="mt-2 text-xs text-amber-600">
                    No organization in context — open this from within a signed-in DentPulse session.
                  </p>
                )}
              </div>
            }
          />
        ) : model ? (
          <ScenarioDashboard model={model} />
        ) : null}
      </main>
    </div>
  );
}
