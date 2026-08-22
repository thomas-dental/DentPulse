import { useState, useEffect } from 'react';
import { useTabPermissions } from '@/hooks/useTabPermissions';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart } from 'recharts';

// Mock data for individual entity tax
const entityTaxData = [
  { entity: 'London Central', profit: 850000, taxableProfit: 820000, taxRate: 0.25, taxLiability: 205000, taxPaid: 150000, outstanding: 55000, dueDate: '2024-04-01' },
  { entity: 'Manchester North', profit: 620000, taxableProfit: 595000, taxRate: 0.25, taxLiability: 148750, taxPaid: 100000, outstanding: 48750, dueDate: '2024-04-01' },
  { entity: 'Birmingham East', profit: 480000, taxableProfit: 460000, taxRate: 0.19, taxLiability: 87400, taxPaid: 87400, outstanding: 0, dueDate: '2024-04-01' },
  { entity: 'Leeds Central', profit: 390000, taxableProfit: 375000, taxRate: 0.19, taxLiability: 71250, taxPaid: 50000, outstanding: 21250, dueDate: '2024-04-01' },
  { entity: 'Bristol South', profit: 520000, taxableProfit: 500000, taxRate: 0.25, taxLiability: 125000, taxPaid: 80000, outstanding: 45000, dueDate: '2024-04-01' },
  { entity: 'Edinburgh', profit: 340000, taxableProfit: 325000, taxRate: 0.19, taxLiability: 61750, taxPaid: 61750, outstanding: 0, dueDate: '2024-04-01' },
  { entity: 'Cardiff', profit: 280000, taxableProfit: 265000, taxRate: 0.19, taxLiability: 50350, taxPaid: 30000, outstanding: 20350, dueDate: '2024-04-01' },
  { entity: 'Newcastle', profit: 310000, taxableProfit: 295000, taxRate: 0.19, taxLiability: 56050, taxPaid: 56050, outstanding: 0, dueDate: '2024-04-01' },
];

// Group consolidated tax
const groupTaxSummary = {
  totalProfit: 3790000,
  totalTaxableProfit: 3635000,
  totalTaxLiability: 805550,
  totalTaxPaid: 615200,
  totalOutstanding: 190350,
  effectiveTaxRate: 0.2216,
  groupRelief: 45000,
  lossesCarriedForward: 125000,
};

// Tax calculation breakdown
const taxCalculation = [
  { item: 'Revenue', current: 12500000, prior: 11200000 },
  { item: 'Less: Operating Expenses', current: -8200000, prior: -7400000 },
  { item: 'Operating Profit', current: 4300000, prior: 3800000, isSubtotal: true },
  { item: 'Less: Interest Expense', current: -180000, prior: -200000 },
  { item: 'Less: Depreciation', current: -330000, prior: -300000 },
  { item: 'Profit Before Tax', current: 3790000, prior: 3300000, isSubtotal: true },
  { item: 'Add: Disallowable Expenses', current: 85000, prior: 70000 },
  { item: 'Less: Capital Allowances', current: -240000, prior: -220000 },
  { item: 'Taxable Profit', current: 3635000, prior: 3150000, isTotal: true },
  { item: 'Corporation Tax @ 25%', current: 908750, prior: 787500 },
  { item: 'Less: Marginal Relief', current: -58200, prior: -47500 },
  { item: 'Less: Group Relief', current: -45000, prior: -40000 },
  { item: 'Tax Liability', current: 805550, prior: 700000, isTotal: true },
];

// Tax planning scenarios
const taxPlanningScenarios = [
  { scenario: 'Base Case', taxableProfit: 3635000, taxLiability: 805550, effectiveRate: 22.16, savings: 0 },
  { scenario: 'Maximise Capital Allowances', taxableProfit: 3435000, taxLiability: 755500, effectiveRate: 22.00, savings: 50050 },
  { scenario: 'R&D Tax Credits', taxableProfit: 3485000, taxLiability: 768250, effectiveRate: 22.04, savings: 37300 },
  { scenario: 'Pension Contributions', taxableProfit: 3535000, taxLiability: 780500, effectiveRate: 22.08, savings: 25050 },
  { scenario: 'All Optimisations', taxableProfit: 3185000, taxLiability: 693250, effectiveRate: 21.77, savings: 112300 },
];

// Monthly tax payments
const monthlyTaxPayments = [
  { month: 'Jan', liability: 67129, paid: 67129, cumulative: 67129 },
  { month: 'Feb', liability: 67129, paid: 67129, cumulative: 134258 },
  { month: 'Mar', liability: 67129, paid: 67129, cumulative: 201387 },
  { month: 'Apr', liability: 67129, paid: 67129, cumulative: 268516 },
  { month: 'May', liability: 67129, paid: 67129, cumulative: 335645 },
  { month: 'Jun', liability: 67129, paid: 67129, cumulative: 402774 },
  { month: 'Jul', liability: 67129, paid: 60000, cumulative: 462774 },
  { month: 'Aug', liability: 67129, paid: 55000, cumulative: 517774 },
  { month: 'Sep', liability: 67129, paid: 50000, cumulative: 567774 },
  { month: 'Oct', liability: 67129, paid: 47426, cumulative: 615200 },
  { month: 'Nov', liability: 67129, paid: 0, cumulative: 615200 },
  { month: 'Dec', liability: 67132, paid: 0, cumulative: 615200 },
];

// Tax rate comparison
const taxRateComparison = [
  { entity: 'London Central', effectiveRate: 25.0, statutoryRate: 25, variance: 0 },
  { entity: 'Manchester North', effectiveRate: 25.0, statutoryRate: 25, variance: 0 },
  { entity: 'Birmingham East', effectiveRate: 19.0, statutoryRate: 19, variance: 0 },
  { entity: 'Leeds Central', effectiveRate: 19.0, statutoryRate: 19, variance: 0 },
  { entity: 'Bristol South', effectiveRate: 25.0, statutoryRate: 25, variance: 0 },
  { entity: 'Edinburgh', effectiveRate: 19.0, statutoryRate: 19, variance: 0 },
  { entity: 'Cardiff', effectiveRate: 19.0, statutoryRate: 19, variance: 0 },
  { entity: 'Newcastle', effectiveRate: 19.0, statutoryRate: 19, variance: 0 },
];

// Deferred tax items
const deferredTaxItems = [
  { item: 'Accelerated Capital Allowances', asset: 0, liability: 125000, net: -125000 },
  { item: 'Provisions', asset: 45000, liability: 0, net: 45000 },
  { item: 'Share-based Payments', asset: 18000, liability: 0, net: 18000 },
  { item: 'Pension Deficit', asset: 32000, liability: 0, net: 32000 },
  { item: 'Lease Liabilities', asset: 0, liability: 28000, net: -28000 },
  { item: 'Intangibles', asset: 0, liability: 15000, net: -15000 },
];

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export default function Tax() {
  const { canViewTab, visibleTabs, defaultTab } = useTabPermissions('tax');
  const [activeTab, setActiveTab] = useState(defaultTab || 'entity');
  const [selectedPeriod, setSelectedPeriod] = useState('2024');
  const [selectedEntity, setSelectedEntity] = useState('all');

  useEffect(() => {
    if (defaultTab && !canViewTab(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  // Pie chart data for tax distribution
  const taxDistributionData = entityTaxData.map(entity => ({
    name: entity.entity,
    value: entity.taxLiability,
  }));

  // AI context data
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const entityRows = entityTaxData.map((e) => ({
    entity: e.entity,
    profit: round2(e.profit),
    taxableProfit: round2(e.taxableProfit),
    taxRatePct: round2(e.taxRate * 100),
    liability: round2(e.taxLiability),
    paid: round2(e.taxPaid),
    outstanding: round2(e.outstanding),
    effectiveRatePct: e.profit > 0 ? round2((e.taxLiability / e.profit) * 100) : 0,
    dueDate: e.dueDate,
  })).slice(0, 50);

  const scenarioRows = taxPlanningScenarios.map((s) => ({
    scenario: s.scenario,
    taxableProfit: round2(s.taxableProfit),
    taxLiability: round2(s.taxLiability),
    effectiveRatePct: round2(s.effectiveRate),
    savings: round2(s.savings),
  }));

  const deferredRows = deferredTaxItems.map((d) => ({
    item: d.item,
    asset: round2(d.asset),
    liability: round2(d.liability),
    net: round2(d.net),
  }));

  const taxData = {
    totalTaxLiability: groupTaxSummary.totalTaxLiability,
    totalTaxPaid: groupTaxSummary.totalTaxPaid,
    totalOutstanding: groupTaxSummary.totalOutstanding,
    effectiveTaxRate: (groupTaxSummary.effectiveTaxRate * 100).toFixed(2),
    entitiesCount: entityTaxData.length,
    entitiesPaid: entityTaxData.filter(e => e.outstanding === 0).length,
    groupRelief: groupTaxSummary.groupRelief,
    potentialSavings: taxPlanningScenarios[4]?.savings || 0,
    selectedEntityName: selectedEntity === 'all' ? 'All Entities' : selectedEntity,
    period: { fy: selectedPeriod },
    rows: {
      entities: entityRows,
      scenarios: scenarioRows,
      deferredItems: deferredRows,
    },
    rankings: {
      topEntitiesByLiability: [...entityRows].sort((a, b) => b.liability - a.liability).slice(0, 10),
      topEntitiesByOutstanding: [...entityRows].sort((a, b) => b.outstanding - a.outstanding).slice(0, 10),
      highestEffectiveRate: [...entityRows].sort((a, b) => b.effectiveRatePct - a.effectiveRatePct).slice(0, 10),
      bestSavingScenarios: [...scenarioRows].sort((a, b) => b.savings - a.savings).slice(0, 10),
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={{ page: 'tax', data: taxData }}>
      <Helmet>
        <title>Tax Planning & Liability</title>
        <meta name="description" content="Analyze tax liabilities by entity, track tax paid, and plan tax strategy with group relief analysis." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tax Management</h1>
            <p className="text-muted-foreground">Corporation tax exposure, calculations, and planning</p>
          </div>
          <div className="flex gap-3">
            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2024">FY 2024</SelectItem>
                <SelectItem value="2023">FY 2023</SelectItem>
                <SelectItem value="2022">FY 2022</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedEntity} onValueChange={setSelectedEntity}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {entityTaxData.map(entity => (
                  <SelectItem key={entity.entity} value={entity.entity}>{entity.entity}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* AI Summary */}
        <AISummaryCard page="tax" data={taxData} />

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Total Tax Liability</div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(groupTaxSummary.totalTaxLiability)}</div>
              <div className="flex items-center gap-2 mt-1">
                <TrendIndicator value={15.1} />
                <span className="text-xs text-muted-foreground">vs prior year</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Tax Paid YTD</div>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(groupTaxSummary.totalTaxPaid)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatPercent((groupTaxSummary.totalTaxPaid / groupTaxSummary.totalTaxLiability) * 100)} of liability
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Outstanding</div>
              <div className="text-2xl font-bold text-destructive">{formatCurrency(groupTaxSummary.totalOutstanding)}</div>
              <div className="text-xs text-muted-foreground mt-1">Due by Apr 2024</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground">Effective Tax Rate</div>
              <div className="text-2xl font-bold text-foreground">{Math.round(groupTaxSummary.effectiveTaxRate * 100)}%</div>
              <div className="text-xs text-muted-foreground mt-1">Blended group rate</div>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className={`grid w-full ${visibleTabs.length === 1 ? 'grid-cols-1' : visibleTabs.length === 2 ? 'grid-cols-2' : visibleTabs.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {canViewTab('entity') && <TabsTrigger value="entity">Entity Tax</TabsTrigger>}
            {canViewTab('group') && <TabsTrigger value="group">Group Tax</TabsTrigger>}
            {canViewTab('calculation') && <TabsTrigger value="calculation">Tax Calculation</TabsTrigger>}
            {canViewTab('planning') && <TabsTrigger value="planning">Tax Planning</TabsTrigger>}
          </TabsList>

          {/* Entity Tax Tab */}
          <TabsContent value="entity" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Entity Tax Table */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Corporation Tax by Entity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-3 font-medium text-muted-foreground">Entity</th>
                          <th className="text-right py-3 font-medium text-muted-foreground">Profit</th>
                          <th className="text-right py-3 font-medium text-muted-foreground">Tax Rate</th>
                          <th className="text-right py-3 font-medium text-muted-foreground">Liability</th>
                          <th className="text-right py-3 font-medium text-muted-foreground">Paid</th>
                          <th className="text-right py-3 font-medium text-muted-foreground">Outstanding</th>
                          <th className="text-center py-3 font-medium text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entityTaxData.map((entity, idx) => (
                          <tr key={entity.entity} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                            <td className="py-3 font-medium text-foreground">{entity.entity}</td>
                            <td className="py-3 text-right text-foreground">{formatCurrency(entity.profit)}</td>
                            <td className="py-3 text-right text-foreground">{formatPercent(entity.taxRate * 100)}</td>
                            <td className="py-3 text-right text-foreground">{formatCurrency(entity.taxLiability)}</td>
                            <td className="py-3 text-right text-foreground">{formatCurrency(entity.taxPaid)}</td>
                            <td className="py-3 text-right font-medium text-foreground">
                              {entity.outstanding > 0 ? (
                                <span className="text-destructive">{formatCurrency(entity.outstanding)}</span>
                              ) : (
                                <span className="text-green-600">{formatCurrency(0)}</span>
                              )}
                            </td>
                            <td className="py-3 text-center">
                              {entity.outstanding === 0 ? (
                                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">Paid</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Pending</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border font-bold">
                          <td className="py-3 text-foreground">Group Total</td>
                          <td className="py-3 text-right text-foreground">{formatCurrency(groupTaxSummary.totalProfit)}</td>
                          <td className="py-3 text-right text-foreground">{formatPercent(groupTaxSummary.effectiveTaxRate * 100)}</td>
                          <td className="py-3 text-right text-foreground">{formatCurrency(groupTaxSummary.totalTaxLiability)}</td>
                          <td className="py-3 text-right text-foreground">{formatCurrency(groupTaxSummary.totalTaxPaid)}</td>
                          <td className="py-3 text-right text-destructive">{formatCurrency(groupTaxSummary.totalOutstanding)}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Tax Distribution Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Tax Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={taxDistributionData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {taxDistributionData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 space-y-2">
                    {taxDistributionData.slice(0, 4).map((item, idx) => (
                      <div key={item.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx] }} />
                          <span className="text-muted-foreground">{item.name}</span>
                        </div>
                        <span className="font-medium text-foreground">{formatCurrency(item.value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tax Rate Comparison */}
            <Card>
              <CardHeader>
                <CardTitle>Tax Rate Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={taxRateComparison} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" domain={[0, 30]} tickFormatter={(v) => `${v}%`} stroke="hsl(var(--muted-foreground))" />
                      <YAxis type="category" dataKey="entity" width={120} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        formatter={(value: number) => `${value}%`}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="effectiveRate" name="Effective Rate" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="statutoryRate" name="Statutory Rate" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Group Tax Tab */}
          <TabsContent value="group" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payment Schedule */}
              <Card>
                <CardHeader>
                  <CardTitle>Tax Payment Schedule</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyTaxPayments}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                        <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="liability" name="Monthly Liability" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="paid" name="Paid" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="cumulative" name="Cumulative Paid" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Group Relief Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Group Tax Benefits</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-muted/30 rounded-lg">
                      <div className="text-sm text-muted-foreground">Group Relief Claimed</div>
                      <div className="text-xl font-bold text-foreground">{formatCurrency(groupTaxSummary.groupRelief)}</div>
                      <div className="text-xs text-green-600 mt-1">Tax saved: {formatCurrency(groupTaxSummary.groupRelief * 0.25)}</div>
                    </div>
                    <div className="p-4 bg-muted/30 rounded-lg">
                      <div className="text-sm text-muted-foreground">Losses C/F</div>
                      <div className="text-xl font-bold text-foreground">{formatCurrency(groupTaxSummary.lossesCarriedForward)}</div>
                      <div className="text-xs text-muted-foreground mt-1">Available for offset</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-3">Deferred Tax Position</h4>
                    <div className="space-y-2">
                      {deferredTaxItems.map((item) => (
                        <div key={item.item} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                          <span className="text-sm text-muted-foreground">{item.item}</span>
                          <span className={`text-sm font-medium ${item.net >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {item.net >= 0 ? '+' : ''}{formatCurrency(item.net)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between py-2 font-bold">
                        <span className="text-foreground">Net Deferred Tax</span>
                        <span className="text-destructive">
                          {formatCurrency(deferredTaxItems.reduce((acc, item) => acc + item.net, 0))}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Consolidated Tax Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Consolidated Tax Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-sm text-muted-foreground">Total Profit</div>
                    <div className="text-xl font-bold text-foreground">{formatCurrency(groupTaxSummary.totalProfit)}</div>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-sm text-muted-foreground">Taxable Profit</div>
                    <div className="text-xl font-bold text-foreground">{formatCurrency(groupTaxSummary.totalTaxableProfit)}</div>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-sm text-muted-foreground">Tax Liability</div>
                    <div className="text-xl font-bold text-foreground">{formatCurrency(groupTaxSummary.totalTaxLiability)}</div>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-sm text-muted-foreground">Tax Paid</div>
                    <div className="text-xl font-bold text-green-600">{formatCurrency(groupTaxSummary.totalTaxPaid)}</div>
                  </div>
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-sm text-muted-foreground">Outstanding</div>
                    <div className="text-xl font-bold text-destructive">{formatCurrency(groupTaxSummary.totalOutstanding)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tax Calculation Tab */}
          <TabsContent value="calculation" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Tax Computation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 font-medium text-muted-foreground">Item</th>
                        <th className="text-right py-3 font-medium text-muted-foreground">Current Period</th>
                        <th className="text-right py-3 font-medium text-muted-foreground">Prior Period</th>
                        <th className="text-right py-3 font-medium text-muted-foreground">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxCalculation.map((item, idx) => {
                        const variance = item.current - item.prior;
                        const isPositive = item.item.includes('Less') ? variance < 0 : variance > 0;
                        return (
                          <tr 
                            key={item.item} 
                            className={`${idx % 2 === 0 ? 'bg-muted/30' : ''} ${item.isSubtotal ? 'font-semibold border-t border-border' : ''} ${item.isTotal ? 'font-bold border-t-2 border-border bg-muted/50' : ''}`}
                          >
                            <td className={`py-3 ${item.isSubtotal || item.isTotal ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {item.item}
                            </td>
                            <td className="py-3 text-right text-foreground">{formatCurrency(item.current)}</td>
                            <td className="py-3 text-right text-foreground">{formatCurrency(item.prior)}</td>
                            <td className={`py-3 text-right font-medium ${isPositive ? 'text-green-600' : 'text-destructive'}`}>
                              {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Key Adjustments */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Disallowable Expenses</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Entertainment</span>
                      <span className="text-foreground">{formatCurrency(35000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Non-business travel</span>
                      <span className="text-foreground">{formatCurrency(25000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Legal fines</span>
                      <span className="text-foreground">{formatCurrency(15000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Other</span>
                      <span className="text-foreground">{formatCurrency(10000)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border font-medium">
                      <span className="text-foreground">Total</span>
                      <span className="text-foreground">{formatCurrency(85000)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Capital Allowances</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Annual Investment</span>
                      <span className="text-foreground">{formatCurrency(150000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Writing Down (18%)</span>
                      <span className="text-foreground">{formatCurrency(65000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Special Rate (6%)</span>
                      <span className="text-foreground">{formatCurrency(25000)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border font-medium">
                      <span className="text-foreground">Total</span>
                      <span className="text-foreground">{formatCurrency(240000)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Tax Reliefs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Marginal Relief</span>
                      <span className="text-foreground">{formatCurrency(58200)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Group Relief</span>
                      <span className="text-foreground">{formatCurrency(45000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">R&D Credits</span>
                      <span className="text-foreground">{formatCurrency(0)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border font-medium">
                      <span className="text-foreground">Total</span>
                      <span className="text-foreground">{formatCurrency(103200)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Tax Planning Tab */}
          <TabsContent value="planning" className="space-y-6">
            {/* Scenario Comparison */}
            <Card>
              <CardHeader>
                <CardTitle>Tax Planning Scenarios</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={taxPlanningScenarios}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="scenario" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                      <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          name === 'savings' ? formatCurrency(value) : formatCurrency(value),
                          name === 'taxLiability' ? 'Tax Liability' : 'Potential Savings'
                        ]}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="taxLiability" name="Tax Liability" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="savings" name="Potential Savings" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 font-medium text-muted-foreground">Scenario</th>
                        <th className="text-right py-3 font-medium text-muted-foreground">Taxable Profit</th>
                        <th className="text-right py-3 font-medium text-muted-foreground">Tax Liability</th>
                        <th className="text-right py-3 font-medium text-muted-foreground">Effective Rate</th>
                        <th className="text-right py-3 font-medium text-muted-foreground">Savings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxPlanningScenarios.map((scenario, idx) => (
                        <tr key={scenario.scenario} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                          <td className="py-3 font-medium text-foreground">{scenario.scenario}</td>
                          <td className="py-3 text-right text-foreground">{formatCurrency(scenario.taxableProfit)}</td>
                          <td className="py-3 text-right text-foreground">{formatCurrency(scenario.taxLiability)}</td>
                          <td className="py-3 text-right text-foreground">{formatPercent(scenario.effectiveRate)}</td>
                          <td className="py-3 text-right">
                            {scenario.savings > 0 ? (
                              <span className="text-green-600 font-medium">+{formatCurrency(scenario.savings)}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Planning Recommendations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Immediate Opportunities</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-foreground">Maximise Capital Allowances</span>
                      <Badge variant="outline" className="bg-green-500/10 text-green-600">High Impact</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Accelerate equipment purchases before year-end to claim full Annual Investment Allowance.
                    </p>
                    <div className="text-sm font-medium text-green-600">Potential saving: {formatCurrency(50050)}</div>
                  </div>

                  <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-foreground">R&D Tax Credits</span>
                      <Badge variant="outline" className="bg-blue-500/10 text-blue-600">Medium Impact</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Review qualifying R&D expenditure for software development and process improvements.
                    </p>
                    <div className="text-sm font-medium text-blue-600">Potential saving: {formatCurrency(37300)}</div>
                  </div>

                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-foreground">Pension Contributions</span>
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600">Low Impact</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Increase employer pension contributions to reduce taxable profits.
                    </p>
                    <div className="text-sm font-medium text-amber-600">Potential saving: {formatCurrency(25050)}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Future Year Planning</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium text-foreground mb-2">Group Structure Optimisation</h4>
                    <p className="text-sm text-muted-foreground">
                      Review entity structure for optimal group relief utilisation and loss offset opportunities.
                    </p>
                  </div>

                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium text-foreground mb-2">Transfer Pricing Review</h4>
                    <p className="text-sm text-muted-foreground">
                      Ensure intercompany charges are at arm's length and documented appropriately.
                    </p>
                  </div>

                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium text-foreground mb-2">Capital Gains Planning</h4>
                    <p className="text-sm text-muted-foreground">
                      Consider timing of asset disposals and utilisation of Substantial Shareholding Exemption.
                    </p>
                  </div>

                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium text-foreground mb-2">VAT Grouping</h4>
                    <p className="text-sm text-muted-foreground">
                      Evaluate benefits of VAT group registration for cash flow and compliance efficiency.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
