import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Flag, Download, MessageSquarePlus } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ARAgingBar } from '@/components/dashboard/ARAgingBar';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { locations } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const formatCurrency = (value: number): string => {
  if (value >= 1000000) {
    return `£${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `£${(value / 1000).toFixed(0)}K`;
  }
  return `£${value.toFixed(0)}`;
};

export default function LocationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = locations.find(loc => loc.id === id);

  if (!location) {
    return (
      <MainLayout aiContext={{ page: 'location-detail', locationId: id ?? null, locationName: null, error: 'not-found' }}>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <p className="text-lg text-muted-foreground">Location not found</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/performance')}>
            Back to Performance
          </Button>
        </div>
      </MainLayout>
    );
  }

  const revenueVariance = ((location.revenue.mtd / location.revenue.budget - 1) * 100).toFixed(1);

  // Generate waterfall data for this location
  const waterfallData = [
    { name: 'Revenue', value: location.revenue.mtd, fill: 'hsl(var(--chart-1))' },
    { name: 'Clinician', value: -Math.round(location.revenue.mtd * 0.35), fill: 'hsl(var(--chart-4))' },
    { name: 'Staff', value: -Math.round(location.revenue.mtd * 0.15), fill: 'hsl(var(--chart-4))' },
    { name: 'Materials', value: -Math.round(location.revenue.mtd * 0.10), fill: 'hsl(var(--chart-4))' },
    { name: 'Overhead', value: -Math.round(location.revenue.mtd * 0.08), fill: 'hsl(var(--chart-4))' },
    { name: 'EBITDA', value: Math.round(location.revenue.mtd * (location.ebitda.percentage / 100)), fill: 'hsl(var(--chart-2))' },
  ];

  // Monthly collections data
  const collectionsData = location.collections.trend.map((rate, idx) => ({
    month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][idx],
    rate,
    target: 98,
  }));

  // Build AI context for chatbot — single location detail (mock data)
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const aiRevenueTrend = (location.revenue.trend || []).slice(0, 24).map((v, i) => ({
    month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i % 12],
    revenue: round2(v),
  }));
  const aiContextData = {
    page: 'location-detail',
    locationId: location.id,
    locationName: location.fullName,
    locationCode: location.code,
    region: location.region,
    cluster: location.cluster ?? null,
    rank: location.rank,
    status: location.status,
    summary: {
      revenueMtd: round2(location.revenue.mtd),
      revenueBudget: round2(location.revenue.budget),
      revenueVariancePercent: round2(parseFloat(revenueVariance)),
      ebitdaPercent: location.ebitda.percentage,
      ebitdaTargetPercent: location.ebitda.budget,
      ebitdaVariancePercent: location.ebitda.variance,
      collectionRatePercent: location.collections.rate,
      collectionsTargetPercent: location.collections.target,
      arDays: location.arDays,
      claimsPending: location.claims.pending,
      claimsApproved: location.claims.approved,
      claimsDenied: location.claims.denied,
      claimsDenialRatePercent: location.claims.denialRate,
      claimsDaysToPay: location.claims.daysToPay,
      stuckClaimsValue: round2(location.claims.stuckClaims),
    },
    issues: location.issues ?? [],
    revenueTrend: aiRevenueTrend,
    collectionsTrend: collectionsData.map(c => ({ month: c.month, ratePercent: c.rate, targetPercent: c.target })),
    waterfall: waterfallData.map(w => ({ name: w.name, value: round2(w.value) })),
    arAgeing: location.arAgeing ?? null,
  };

  return (
    <MainLayout aiContext={aiContextData}>
      <Helmet>
        <title>Practice Location Overview</title>
        <meta name="description" content="Detailed performance metrics, financial analysis, and trends for individual practice locations." />
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        {/* Back Navigation */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Performance
        </button>

        {/* Location Header */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className={cn(
                'w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold',
                location.status === 'success' ? 'bg-success-muted text-success' :
                location.status === 'warning' ? 'bg-warning-muted text-warning' :
                'bg-danger-muted text-danger'
              )}>
                #{location.rank}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-xl font-semibold">{location.fullName}</h1>
                  <StatusBadge status={location.status} />
                </div>
                <p className="text-muted-foreground text-sm">{location.code} • {
                  location.region === 'north' ? 'Region North' :
                  location.region === 'south' ? 'Region South' : 'Region London'
                }</p>
                {location.cluster && (
                  <span className="inline-block mt-2 text-xs px-2 py-1 bg-accent/10 text-accent rounded-full">
                    {location.cluster === 'london-premium' ? 'London Premium' :
                     location.cluster === 'ortho-heavy' ? 'Ortho-Heavy' : 'New Acquisitions 2024'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2">
                <Flag className="w-4 h-4" />
                Flag for Review
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="w-4 h-4" />
                Export Report
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <MessageSquarePlus className="w-4 h-4" />
                Add Note
              </Button>
            </div>
          </div>

          {/* Quick Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
            <div>
              <p className="text-sm text-muted-foreground">Revenue (MTD)</p>
              <p className="text-xl font-semibold">{formatCurrency(location.revenue.mtd)}</p>
              <TrendIndicator value={parseFloat(revenueVariance)} label="vs budget" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">EBITDA Margin</p>
              <p className={cn(
                'text-xl font-semibold',
                location.ebitda.percentage < 28 ? 'text-danger' :
                location.ebitda.percentage < 32 ? 'text-warning' : ''
              )}>{location.ebitda.percentage}%</p>
              <TrendIndicator value={location.ebitda.variance} label="vs target" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Collection Rate</p>
              <p className={cn(
                'text-xl font-semibold',
                location.collections.rate < 95 ? 'text-danger' :
                location.collections.rate < 97 ? 'text-warning' : ''
              )}>{location.collections.rate}%</p>
              <p className="text-xs text-muted-foreground">Target: {location.collections.target}%</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">AR Days</p>
              <p className={cn(
                'text-xl font-semibold',
                location.arDays > 45 ? 'text-danger' :
                location.arDays > 35 ? 'text-warning' : ''
              )}>{location.arDays} days</p>
              <p className="text-xs text-muted-foreground">Target: ≤35 days</p>
            </div>
          </div>
        </div>

        {/* Tabbed Content */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-muted/50 p-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="cash-ar">Cash & AR</TabsTrigger>
            <TabsTrigger value="profitability">Profitability</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Revenue Trend */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-4">Revenue Trend (Last 12 Months)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={location.revenue.trend.map((v, i) => ({
                      month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
                      revenue: v,
                    }))}>
                      <defs>
                        <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `£${v}K`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                        formatter={(value: number) => [`£${value}K`, 'Revenue']}
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(var(--accent))"
                        strokeWidth={2}
                        fill="url(#revenueGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Key Metrics Grid */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-4">Key Performance Indicators</h3>
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-muted/30">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm">Revenue vs Budget</span>
                      <span className={cn(
                        'text-sm font-medium',
                        parseFloat(revenueVariance) < 0 ? 'text-danger' : 'text-success'
                      )}>{revenueVariance}%</span>
                    </div>
                    <ProgressBar
                      value={location.revenue.mtd}
                      max={location.revenue.budget}
                      variant={parseFloat(revenueVariance) < -5 ? 'danger' : parseFloat(revenueVariance) < 0 ? 'warning' : 'success'}
                    />
                  </div>

                  <div className="p-4 rounded-lg bg-muted/30">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm">EBITDA vs Target</span>
                      <span className={cn(
                        'text-sm font-medium',
                        location.ebitda.variance < -2 ? 'text-danger' :
                        location.ebitda.variance < 0 ? 'text-warning' : 'text-success'
                      )}>{location.ebitda.variance > 0 ? '+' : ''}{location.ebitda.variance}%</span>
                    </div>
                    <ProgressBar
                      value={location.ebitda.percentage}
                      max={location.ebitda.budget}
                      variant={location.ebitda.variance < -2 ? 'danger' : location.ebitda.variance < 0 ? 'warning' : 'success'}
                    />
                  </div>

                  <div className="p-4 rounded-lg bg-muted/30">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm">Collection Rate</span>
                      <span className={cn(
                        'text-sm font-medium',
                        location.collections.rate < 95 ? 'text-danger' :
                        location.collections.rate < 97 ? 'text-warning' : 'text-success'
                      )}>{location.collections.rate}%</span>
                    </div>
                    <ProgressBar
                      value={location.collections.rate}
                      max={100}
                      variant={location.collections.rate < 95 ? 'danger' : location.collections.rate < 97 ? 'warning' : 'success'}
                    />
                  </div>

                  <div className="p-4 rounded-lg bg-muted/30">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm">Claim Denial Rate</span>
                      <span className={cn(
                        'text-sm font-medium',
                        location.claims.denialRate > 5 ? 'text-danger' :
                        location.claims.denialRate > 3 ? 'text-warning' : 'text-success'
                      )}>{location.claims.denialRate}%</span>
                    </div>
                    <ProgressBar
                      value={10 - location.claims.denialRate}
                      max={10}
                      variant={location.claims.denialRate > 5 ? 'danger' : location.claims.denialRate > 3 ? 'warning' : 'success'}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Issues */}
            {location.issues && location.issues.length > 0 && (
              <div className="bg-warning-muted border border-warning/30 rounded-xl p-5">
                <h3 className="text-sm font-medium mb-3 text-warning">Issues Detected</h3>
                <div className="flex flex-wrap gap-2">
                  {location.issues.map((issue, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-warning/20 text-warning text-sm rounded-lg">
                      {issue}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Cash & AR Tab */}
          <TabsContent value="cash-ar" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* AR Ageing */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-4">AR Ageing Breakdown</h3>
                <ARAgingBar data={location.arAgeing} size="md" />
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Outstanding</span>
                    <span className="font-medium">{formatCurrency(location.revenue.mtd * 0.15)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">AR Days</span>
                    <span className={cn(
                      'font-medium',
                      location.arDays > 45 ? 'text-danger' : location.arDays > 35 ? 'text-warning' : ''
                    )}>{location.arDays} days</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Target</span>
                    <span className="font-medium">≤35 days</span>
                  </div>
                </div>
              </div>

              {/* Collections Trend */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium mb-4">Collection Rate Trend</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={collectionsData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis domain={[85, 100]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        stroke="hsl(var(--accent))"
                        strokeWidth={2}
                        dot={{ fill: 'hsl(var(--accent))' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="target"
                        stroke="hsl(var(--success))"
                        strokeDasharray="5 5"
                        strokeWidth={1}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Profitability Tab */}
          <TabsContent value="profitability" className="space-y-6">
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-medium mb-4">Margin Waterfall: Revenue to EBITDA</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={waterfallData} layout="horizontal">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatCurrency(Math.abs(v))} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [formatCurrency(Math.abs(value)), '']}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {waterfallData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          {/* Claims Tab */}
          <TabsContent value="claims" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Pending Claims</p>
                <p className="text-2xl font-semibold">{location.claims.pending}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Approved (MTD)</p>
                <p className="text-2xl font-semibold text-success">{location.claims.approved}</p>
              </div>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-muted-foreground mb-1">Denied (MTD)</p>
                <p className="text-2xl font-semibold text-danger">{location.claims.denied}</p>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-medium mb-4">Claims Metrics</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="text-sm">Denial Rate</span>
                  <span className={cn(
                    'font-medium',
                    location.claims.denialRate > 5 ? 'text-danger' :
                    location.claims.denialRate > 3 ? 'text-warning' : 'text-success'
                  )}>{location.claims.denialRate}%</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="text-sm">Average Days to Pay</span>
                  <span className="font-medium">{location.claims.daysToPay} days</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                  <span className="text-sm">Stuck Claims Value</span>
                  <span className="font-medium text-danger">{formatCurrency(location.claims.stuckClaims)}</span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
