import { Helmet } from 'react-helmet-async';
import { useState, useEffect } from 'react';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FinancialSection } from '@/components/reports/FinancialSection';
import { SummaryCard } from '@/components/reports/SummaryCard';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import {
  profitAndLossData as staticPLData,
  balanceSheetData as staticBSData,
  cashFlowData,
  getPLSummary as getStaticPLSummary,
  getBalanceSheetSummary as getStaticBSSummary,
  getCashFlowSummary
} from '@/data/financialReportsData';
import { useIplicitReports, useIplicitLegalEntities } from '@/hooks/useIplicitReports';
import { FileSpreadsheet, Download, Printer, Calendar, Loader2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Map tab value to permission card key
const tabToCardKey: Record<string, string> = {
  'profit-loss': 'profit_loss_tab',
  'balance-sheet': 'balance_sheet_tab',
  'cash-flow': 'cash_flow_tab',
};

export default function Reports() {
  const { can } = usePermissions();
  const { canViewTab, defaultTab } = useTabPermissions('reports');
  const [activeTab, setActiveTab] = useState(defaultTab || 'profit-loss');

  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('all');
  const { data: legalEntities = [], isLoading: entitiesLoading } = useIplicitLegalEntities();
  const iplicit = useIplicitReports(selectedEntityId === 'all' ? undefined : selectedEntityId);

  // Use Iplicit data if available, otherwise fall back to static mock data
  const useDynamic = iplicit.hasData && !iplicit.isLoading;

  const profitAndLossData = useDynamic ? iplicit.profitAndLossData : staticPLData;
  const balanceSheetData = useDynamic ? iplicit.balanceSheetData : staticBSData;

  const staticPL = getStaticPLSummary();
  const staticBS = getStaticBSSummary();
  const cfSummary = getCashFlowSummary();

  const plSummary = useDynamic
    ? {
        revenue: { currentPeriod: iplicit.plSummary.revenue, priorPeriod: 0, budget: 0 },
        grossProfit: { currentPeriod: iplicit.plSummary.grossProfit, priorPeriod: 0, budget: 0 },
        grossMargin: { currentPeriod: iplicit.plSummary.grossMargin, priorPeriod: 0, budget: 0 },
        ebitda: { currentPeriod: iplicit.plSummary.ebitda, priorPeriod: 0, budget: 0 },
        ebitdaMargin: { currentPeriod: iplicit.plSummary.ebitdaMargin, priorPeriod: 0, budget: 0 },
      }
    : staticPL;

  const bsSummary = useDynamic
    ? {
        totalAssets: { currentPeriod: iplicit.bsSummary.totalAssets, priorPeriod: 0, budget: 0 },
        totalLiabilities: { currentPeriod: iplicit.bsSummary.totalLiabilities, priorPeriod: 0, budget: 0 },
        equity: { currentPeriod: iplicit.bsSummary.equity, priorPeriod: 0, budget: 0 },
        workingCapital: { currentPeriod: iplicit.bsSummary.workingCapital, priorPeriod: 0, budget: 0 },
        currentRatio: { currentPeriod: iplicit.bsSummary.currentRatio, priorPeriod: 0, budget: 0 },
      }
    : staticBS;

  // AI context data
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Build per-section line item rows from the active statement (works for both static and Iplicit shapes)
  const flattenSection = (sections: any[]): { section: string; name: string; current: number; prior: number }[] => {
    const out: { section: string; name: string; current: number; prior: number }[] = [];
    const walk = (sectionName: string, items: any[]) => {
      for (const it of items || []) {
        if (Array.isArray(it.items) && it.items.length) {
          walk(sectionName, it.items);
        } else {
          out.push({
            section: sectionName,
            name: it.name ?? String(it.id ?? ''),
            current: round2(Number(it.currentPeriod) || 0),
            prior: round2(Number(it.priorPeriod) || 0),
          });
        }
      }
    };
    for (const s of sections || []) {
      const items = s.items ?? [];
      walk(s.name ?? s.id ?? 'Section', items);
    }
    return out;
  };

  const plRows = flattenSection(profitAndLossData).slice(0, 50);
  const bsRows = flattenSection(balanceSheetData).slice(0, 50);

  const selectedEntityName = selectedEntityId === 'all'
    ? 'All Entities'
    : (legalEntities.find((e) => e.platform_org_id === selectedEntityId)?.platform_org_name ?? 'Selected Entity');

  const sortedByMagnitudeDesc = (rows: typeof plRows) =>
    [...rows].sort((a, b) => Math.abs(b.current) - Math.abs(a.current)).slice(0, 10);

  const activeRows = activeTab === 'balance-sheet' ? bsRows : activeTab === 'cash-flow' ? [] : plRows;

  const reportsData = {
    revenue: round2(plSummary.revenue.currentPeriod),
    grossProfit: round2(plSummary.grossProfit.currentPeriod),
    grossMargin: round2(plSummary.grossMargin.currentPeriod),
    ebitda: round2(plSummary.ebitda.currentPeriod),
    ebitdaMargin: round2(plSummary.ebitdaMargin.currentPeriod),
    totalAssets: round2(bsSummary.totalAssets.currentPeriod),
    totalLiabilities: round2(bsSummary.totalLiabilities.currentPeriod),
    workingCapital: round2(bsSummary.workingCapital.currentPeriod),
    operatingCashFlow: round2(cfSummary.operatingCashFlow.currentPeriod),
    netCashFlow: round2(cfSummary.netCashFlow.currentPeriod),
    activeTab,
    selectedEntityName,
    statementTotals: {
      pl: {
        revenue: round2(plSummary.revenue.currentPeriod),
        grossProfit: round2(plSummary.grossProfit.currentPeriod),
        ebitda: round2(plSummary.ebitda.currentPeriod),
      },
      balanceSheet: {
        totalAssets: round2(bsSummary.totalAssets.currentPeriod),
        totalLiabilities: round2(bsSummary.totalLiabilities.currentPeriod),
        equity: round2(bsSummary.equity.currentPeriod),
        currentRatio: round2(bsSummary.currentRatio.currentPeriod),
      },
      cashFlow: {
        operating: round2(cfSummary.operatingCashFlow.currentPeriod),
        investing: round2(cfSummary.investingCashFlow.currentPeriod),
        financing: round2(cfSummary.financingCashFlow.currentPeriod),
        net: round2(cfSummary.netCashFlow.currentPeriod),
        free: round2(cfSummary.freeCashFlow.currentPeriod),
      },
    },
    rows: {
      profitAndLoss: plRows,
      balanceSheet: bsRows,
    },
    rankings: {
      topLineItemsByMagnitude: sortedByMagnitudeDesc(activeRows),
      topPLByMagnitude: sortedByMagnitudeDesc(plRows),
      topBSByMagnitude: sortedByMagnitudeDesc(bsRows),
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'reports', data: reportsData }}>
      <Helmet>
        <title>Financial Reports</title>
        <meta name="description" content="Consolidated financial statements including P&L, balance sheet, and cash flow analysis with drill-down details." />
      </Helmet>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <FileSpreadsheet className="w-7 h-7 text-primary" />
              Financial Reports
            </h1>
            <p className="text-muted-foreground mt-1">
              Consolidated financial statements with drill-down to source data
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {legalEntities.length > 0 && (
              <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                <SelectTrigger className="w-[220px] h-9">
                  <Building2 className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="All Entities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  {legalEntities.map((entity) => (
                    <SelectItem key={entity.platform_org_id} value={entity.platform_org_id}>
                      {entity.platform_org_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
              <Calendar className="w-4 h-4" />
              <span>{useDynamic ? 'Source: Iplicit' : 'Sample Data'}</span>
              {iplicit.isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            </div>
            {can('reports', 'export', tabToCardKey[activeTab] || 'profit_loss_tab') && (
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="w-4 h-4" />
                Export
              </Button>
            )}
            {can('reports', 'export', tabToCardKey[activeTab] || 'profit_loss_tab') && (
              <Button variant="outline" size="sm" className="gap-2">
                <Printer className="w-4 h-4" />
                Print
              </Button>
            )}
          </div>
        </div>

        {/* AI Summary */}
        <AISummaryCard page="reports" data={reportsData} />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full max-w-md bg-muted/50 p-1 h-12">
            {canViewTab('profit-loss') && (
              <TabsTrigger
                value="profit-loss"
                className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                Profit & Loss
              </TabsTrigger>
            )}
            {canViewTab('balance-sheet') && (
              <TabsTrigger
                value="balance-sheet"
                className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                Balance Sheet
              </TabsTrigger>
            )}
            {canViewTab('cash-flow') && (
              <TabsTrigger
                value="cash-flow"
                className="flex-1 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                Cash Flow
              </TabsTrigger>
            )}
          </TabsList>

          {/* Profit & Loss Tab */}
          <TabsContent value="profit-loss" className="mt-6 space-y-6">
            {/* P&L Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <SummaryCard 
                title="Total Revenue"
                currentValue={plSummary.revenue.currentPeriod}
                priorValue={plSummary.revenue.priorPeriod}
                budgetValue={plSummary.revenue.budget}
                format="currency"
              />
              <SummaryCard 
                title="Gross Profit"
                currentValue={plSummary.grossProfit.currentPeriod}
                priorValue={plSummary.grossProfit.priorPeriod}
                budgetValue={plSummary.grossProfit.budget}
                format="currency"
              />
              <SummaryCard 
                title="Gross Margin"
                currentValue={plSummary.grossMargin.currentPeriod}
                priorValue={plSummary.grossMargin.priorPeriod}
                budgetValue={plSummary.grossMargin.budget}
                format="percent"
              />
              <SummaryCard 
                title="EBITDA"
                currentValue={plSummary.ebitda.currentPeriod}
                priorValue={plSummary.ebitda.priorPeriod}
                budgetValue={plSummary.ebitda.budget}
                format="currency"
              />
              <SummaryCard 
                title="EBITDA Margin"
                currentValue={plSummary.ebitdaMargin.currentPeriod}
                priorValue={plSummary.ebitdaMargin.priorPeriod}
                budgetValue={plSummary.ebitdaMargin.budget}
                format="percent"
              />
            </div>

            {/* P&L Detail Sections */}
            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">Profit & Loss Statement</h2>
              {profitAndLossData.map(section => (
                <FinancialSection key={section.id} section={section} />
              ))}
              
              {/* Totals Row */}
              <div className="mt-4 pt-4 border-t-2 border-border">
                <div className="flex items-center justify-between py-3 px-4 bg-primary/5 rounded-lg">
                  <span className="font-bold text-foreground">Net Income (EBITDA)</span>
                  <div className="flex items-center gap-8 text-sm">
                    <span className="font-bold text-lg">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(plSummary.ebitda.currentPeriod)}
                    </span>
                    <span className="text-muted-foreground w-24 text-right">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(plSummary.ebitda.priorPeriod)}
                    </span>
                    <span className="text-muted-foreground w-24 text-right">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(plSummary.ebitda.budget)}
                    </span>
                    <span className={`font-medium w-32 text-right ${plSummary.ebitda.currentPeriod >= plSummary.ebitda.budget ? 'text-success' : 'text-danger'}`}>
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(plSummary.ebitda.currentPeriod - plSummary.ebitda.budget)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Balance Sheet Tab */}
          <TabsContent value="balance-sheet" className="mt-6 space-y-6">
            {/* Balance Sheet Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <SummaryCard 
                title="Total Assets"
                currentValue={bsSummary.totalAssets.currentPeriod}
                priorValue={bsSummary.totalAssets.priorPeriod}
                budgetValue={bsSummary.totalAssets.budget}
                format="currency"
              />
              <SummaryCard 
                title="Total Liabilities"
                currentValue={bsSummary.totalLiabilities.currentPeriod}
                priorValue={bsSummary.totalLiabilities.priorPeriod}
                budgetValue={bsSummary.totalLiabilities.budget}
                format="currency"
                inverse
              />
              <SummaryCard 
                title="Shareholders' Equity"
                currentValue={bsSummary.equity.currentPeriod}
                priorValue={bsSummary.equity.priorPeriod}
                budgetValue={bsSummary.equity.budget}
                format="currency"
              />
              <SummaryCard 
                title="Working Capital"
                currentValue={bsSummary.workingCapital.currentPeriod}
                priorValue={bsSummary.workingCapital.priorPeriod}
                budgetValue={bsSummary.workingCapital.budget}
                format="currency"
              />
              <SummaryCard 
                title="Current Ratio"
                currentValue={bsSummary.currentRatio.currentPeriod}
                priorValue={bsSummary.currentRatio.priorPeriod}
                budgetValue={bsSummary.currentRatio.budget}
                format="ratio"
              />
            </div>

            {/* Balance Sheet Detail Sections */}
            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">Balance Sheet</h2>
              
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Assets</h3>
              {balanceSheetData.filter(s => {
                const n = s.name.toLowerCase();
                return n.includes('asset') || s.id.includes('assets');
              }).map(section => (
                <FinancialSection key={section.id} section={section} />
              ))}

              <div className="my-4 py-3 px-4 bg-muted/30 rounded-lg flex items-center justify-between">
                <span className="font-semibold">Total Assets</span>
                <span className="font-bold text-lg">
                  {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(bsSummary.totalAssets.currentPeriod)}
                </span>
              </div>

              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3 mt-6">Liabilities</h3>
              {balanceSheetData.filter(s => {
                const n = s.name.toLowerCase();
                return n.includes('liabilit') || n.includes('creditor') || s.id.includes('liabilities');
              }).map(section => (
                <FinancialSection key={section.id} section={section} />
              ))}
              
              <div className="my-4 py-3 px-4 bg-muted/30 rounded-lg flex items-center justify-between">
                <span className="font-semibold">Total Liabilities</span>
                <span className="font-bold text-lg">
                  {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(bsSummary.totalLiabilities.currentPeriod)}
                </span>
              </div>

              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3 mt-6">Equity</h3>
              {balanceSheetData.filter(s => {
                const n = s.name.toLowerCase();
                return n.includes('equity') || n.includes('capital') || n.includes('reserves') || n.includes('retained earnings') || n.includes('share capital');
              }).map(section => (
                <FinancialSection key={section.id} section={section} />
              ))}

              {/* Equity Total */}
              <div className="mt-4 pt-4 border-t-2 border-border">
                <div className="flex items-center justify-between py-3 px-4 bg-primary/5 rounded-lg">
                  <span className="font-bold text-foreground">Shareholders' Equity</span>
                  <span className="font-bold text-lg">
                    {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(bsSummary.equity.currentPeriod)}
                  </span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Cash Flow Tab */}
          <TabsContent value="cash-flow" className="mt-6 space-y-6">
            {/* Cash Flow Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <SummaryCard 
                title="Operating Cash Flow"
                currentValue={cfSummary.operatingCashFlow.currentPeriod}
                priorValue={cfSummary.operatingCashFlow.priorPeriod}
                budgetValue={cfSummary.operatingCashFlow.budget}
                format="currency"
              />
              <SummaryCard 
                title="Investing Cash Flow"
                currentValue={cfSummary.investingCashFlow.currentPeriod}
                priorValue={cfSummary.investingCashFlow.priorPeriod}
                budgetValue={cfSummary.investingCashFlow.budget}
                format="currency"
              />
              <SummaryCard 
                title="Financing Cash Flow"
                currentValue={cfSummary.financingCashFlow.currentPeriod}
                priorValue={cfSummary.financingCashFlow.priorPeriod}
                budgetValue={cfSummary.financingCashFlow.budget}
                format="currency"
              />
              <SummaryCard 
                title="Net Cash Flow"
                currentValue={cfSummary.netCashFlow.currentPeriod}
                priorValue={cfSummary.netCashFlow.priorPeriod}
                budgetValue={cfSummary.netCashFlow.budget}
                format="currency"
              />
              <SummaryCard 
                title="Free Cash Flow"
                currentValue={cfSummary.freeCashFlow.currentPeriod}
                priorValue={cfSummary.freeCashFlow.priorPeriod}
                budgetValue={cfSummary.freeCashFlow.budget}
                format="currency"
              />
            </div>

            {/* Cash Flow Detail Sections */}
            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">Statement of Cash Flows</h2>
              {cashFlowData.map(section => (
                <FinancialSection key={section.id} section={section} />
              ))}
              
              {/* Net Cash Flow Row */}
              <div className="mt-4 pt-4 border-t-2 border-border">
                <div className="flex items-center justify-between py-3 px-4 bg-primary/5 rounded-lg">
                  <span className="font-bold text-foreground">Net Change in Cash</span>
                  <div className="flex items-center gap-8 text-sm">
                    <span className={`font-bold text-lg ${cfSummary.netCashFlow.currentPeriod >= 0 ? 'text-success' : 'text-danger'}`}>
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(cfSummary.netCashFlow.currentPeriod)}
                    </span>
                    <span className="text-muted-foreground w-24 text-right">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(cfSummary.netCashFlow.priorPeriod)}
                    </span>
                    <span className="text-muted-foreground w-24 text-right">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(cfSummary.netCashFlow.budget)}
                    </span>
                    <span className={`font-medium w-32 text-right ${cfSummary.netCashFlow.currentPeriod >= cfSummary.netCashFlow.budget ? 'text-success' : 'text-danger'}`}>
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(cfSummary.netCashFlow.currentPeriod - cfSummary.netCashFlow.budget)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
