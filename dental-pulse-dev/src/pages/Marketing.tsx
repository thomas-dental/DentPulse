import { Helmet } from 'react-helmet-async';
import { useMemo, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { AISummaryCard } from '@/components/ai/AISummaryCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrendIndicator } from '@/components/dashboard/TrendIndicator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GA4ConnectionCard } from '@/components/marketing/GA4ConnectionCard';
import { GoogleAdsConnectionCard } from '@/components/marketing/GoogleAdsConnectionCard';
import { useGA4Analytics } from '@/hooks/useGA4Analytics';
import { useGoogleAdsData } from '@/hooks/useGoogleAdsData';
import { useGoogleAdsCampaigns } from '@/hooks/useGoogleAdsCampaigns';
import type { DateRange } from '@/hooks/useGoogleAdsCampaigns';
import { useNavigate } from 'react-router-dom';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { formatCurrency as formatCurrencyBase } from '@/lib/currency';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Megaphone,
  TrendingUp,
  Target,
  Users,
  PoundSterling,
  Search,
  Globe,
  Share2,
  Youtube,
  Facebook,
  Loader2,
  CalendarDays,
} from 'lucide-react';

const COLORS = {
  organic: 'hsl(var(--chart-3))',
  paid: 'hsl(var(--primary))',
};

const CHANNEL_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--primary))',
  'hsl(var(--secondary))',
];

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `£${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `£${(value / 1000).toFixed(0)}K`;
  return `£${value.toFixed(2)}`;
};

// Format number with commas
const formatAdsNumber = (value: number): string => {
  return new Intl.NumberFormat('en-GB').format(value);
};

const getChannelIcon = (channelId: string) => {
  switch (channelId) {
    case 'google-ads':
      return <Search className="w-4 h-4" />;
    case 'youtube-ads':
      return <Youtube className="w-4 h-4" />;
    case 'facebook-ads':
    case 'instagram-ads':
      return <Facebook className="w-4 h-4" />;
    case 'organic-seo':
      return <Globe className="w-4 h-4" />;
    case 'organic-referral':
      return <Users className="w-4 h-4" />;
    case 'organic-social':
      return <Share2 className="w-4 h-4" />;
    default:
      return <Megaphone className="w-4 h-4" />;
  }
};

export default function Marketing() {
  const { showDecimals } = useOrganizationSettings();
  // Format currency for Google Ads data (from DB)
  const formatAdsCurrency = (value: number, currency: string = 'GBP'): string =>
    formatCurrencyBase(value, showDecimals, currency);
  // Summary-tile numbers always show whole pounds, regardless of the Show Decimals setting.
  const formatAdsCurrencyWhole = (value: number, currency: string = 'GBP'): string =>
    formatCurrencyBase(value, false, currency);
  const navigate = useNavigate();
  const {
    isConnected,
    analyticsData,
    isLoadingAnalytics,
    isRefreshingAnalytics,
    ga4Data,
  } = useGA4Analytics();

  // Google Ads data
  const {
    isConnected: isGoogleAdsConnected,
    analyticsData: googleAdsAnalytics,
    isLoadingAnalytics: isLoadingGoogleAds,
    isRefreshingAnalytics: isRefreshingGoogleAds,
    googleAdsData,
  } = useGoogleAdsData();

  // Date range state (default: current month)
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
    };
  });

  // RPC-based campaign data with date range filtering
  const {
    summary: rpcSummary,
    campaigns: rpcCampaigns,
    chartData: rpcChartData,
    isLoading: isLoadingRpc,
    hasData: hasRpcData,
  } = useGoogleAdsCampaigns(dateRange);

  // Get campaigns and metrics from database (googleAdsData.raw_campaigns)
  const googleAdsCampaigns = useMemo(() => {
    if (googleAdsData?.raw_campaigns && Array.isArray(googleAdsData.raw_campaigns)) {
      return googleAdsData.raw_campaigns;
    }
    return [];
  }, [googleAdsData]);

  const googleAdsMetrics = useMemo(() => {
    if (googleAdsData) {
      return {
        totalImpressions: googleAdsData.total_impressions || 0,
        totalClicks: googleAdsData.total_clicks || 0,
        totalCost: googleAdsData.total_spend || 0,
        totalConversions: googleAdsData.total_conversions || 0,
        costPerLead: googleAdsData.cost_per_conversion || 0,
        averageCtr: googleAdsData.total_impressions > 0
          ? `${((googleAdsData.total_clicks / googleAdsData.total_impressions) * 100).toFixed(2)}%`
          : '0%',
        currency: googleAdsData.currency || 'GBP',
      };
    }
    return {
      totalImpressions: 0,
      totalClicks: 0,
      totalCost: 0,
      totalConversions: 0,
      costPerLead: 0,
      averageCtr: '0%',
      currency: 'GBP',
    };
  }, [googleAdsData]);

  // Combined loading state for sections (initial load or refresh)
  const isDataLoading = isLoadingAnalytics || isRefreshingAnalytics;

  // Transform GA4 channel mix data for Paid Channels table
  const displayPaidChannels = useMemo(() => {
    if (isConnected && analyticsData?.channelMix && analyticsData.channelMix.length > 0) {
      const paidChannelNames = ['Paid Search', 'Paid Social', 'Display', 'Paid Video', 'Affiliates'];
      const paidData = analyticsData.channelMix
        .filter(c => paidChannelNames.some(name => c.channel.toLowerCase().includes(name.toLowerCase())))
        .map((channel, index) => {
          const estimatedSpend = channel.sessions * 2; // Estimate
          const estimatedRevenue = channel.conversions * 150; // Estimate revenue per conversion
          const roi = estimatedSpend > 0 ? Math.round(((estimatedRevenue - estimatedSpend) / estimatedSpend) * 100) : 0;
          const cpl = channel.sessions > 0 ? estimatedSpend / channel.sessions : 0;
          const cpa = channel.conversions > 0 ? estimatedSpend / channel.conversions : 0;

          return {
            id: `paid-${index}`,
            name: channel.channel,
            type: 'paid' as const,
            spend: estimatedSpend,
            revenue: estimatedRevenue,
            roi,
            leads: channel.sessions,
            conversions: channel.conversions,
            cpl,
            cpa,
            trend: 0, // GA4 doesn't provide trend data
          };
        });

      return paidData;
    }
    return [];
  }, [isConnected, analyticsData]);

  // Transform GA4 channel mix data for Organic Channels table
  const displayOrganicChannels = useMemo(() => {
    if (isConnected && analyticsData?.channelMix && analyticsData.channelMix.length > 0) {
      const organicChannelNames = ['Organic Search', 'Direct', 'Referral', 'Organic Social', 'Email', 'Organic Video'];
      const organicData = analyticsData.channelMix
        .filter(c => organicChannelNames.some(name => c.channel.toLowerCase().includes(name.toLowerCase())))
        .map((channel, index) => {
          const estimatedInvestment = channel.sessions * 0.5; // Lower cost for organic
          const estimatedRevenue = channel.conversions * 200; // Higher value for organic leads
          const roi = estimatedInvestment > 0 ? Math.round(((estimatedRevenue - estimatedInvestment) / estimatedInvestment) * 100) : 0;
          const cpl = channel.sessions > 0 ? estimatedInvestment / channel.sessions : 0;

          return {
            id: `organic-${index}`,
            name: channel.channel,
            type: 'organic' as const,
            spend: estimatedInvestment,
            revenue: estimatedRevenue,
            roi,
            leads: channel.sessions,
            conversions: channel.conversions,
            cpl,
            cpa: channel.conversions > 0 ? estimatedInvestment / channel.conversions : 0,
            trend: 0,
          };
        });

      return organicData;
    }
    return [];
  }, [isConnected, analyticsData]);

  // Fallback to static data if not connected
  const organicChannels = displayOrganicChannels;
  const paidChannels = displayPaidChannels;

  // Transform GA4 session sources for Traffic Sources table
  const displaySessionSources = useMemo(() => {
    if (isConnected && analyticsData?.sessionSources && analyticsData.sessionSources.length > 0) {
      return analyticsData.sessionSources.map((source, index) => ({
        id: String(index + 1),
        source: source.source,
        medium: source.medium,
        sessions: source.sessions,
        conversions: source.conversions,
        bounceRate: source.bounceRate,
        engagementRate: source.engagementRate,
        conversionRate: source.sessions > 0 ? (source.conversions / source.sessions) * 100 : 0,
      }));
    }
    return [];
  }, [isConnected, analyticsData]);

  // Transform GA4 data for campaigns (Google Ads only)
  const displayCampaigns = useMemo(() => {
    if (isConnected && analyticsData?.campaigns && analyticsData.campaigns.length > 0) {
      return analyticsData.campaigns.map((campaign, index) => ({
        id: String(index + 1),
        name: campaign.name || 'Unknown Campaign',
        channel: 'Google Ads',
        status: 'active' as const,
        spend: campaign.revenue * 0.3,
        impressions: campaign.sessions * 50,
        clicks: campaign.sessions,
        leads: campaign.conversions,
        conversions: campaign.conversions,
        ctr: 2.0,
        roi: campaign.roi,
      }));
    }
    return [];
  }, [isConnected, analyticsData]);

  // Transform GA4 geographic data for display
  const displayLocationROI = useMemo(() => {
    if (isConnected) {
      // When connected, only show real GA4 data
      if (analyticsData?.geographicROI && analyticsData.geographicROI.length > 0) {
        return analyticsData.geographicROI.slice(0, 10).map((geo) => ({
          locationId: geo.city,
          locationName: geo.city !== '(not set)' ? `${geo.city}, ${geo.country}` : geo.country,
          sessions: geo.sessions,
          conversions: geo.conversions,
          conversionRate: geo.sessions > 0 ? Math.round((geo.conversions / geo.sessions) * 100) : 0,
          revenue: geo.revenue || 0,
        }));
      }
      // Connected but no data - return empty array
      return [];
    }
    // Not connected - no data
    return [];
  }, [isConnected, analyticsData]);

  // Calculate channel mix for pie chart
  // GA4 Default Channel Groups: https://support.google.com/analytics/answer/9756891
  const pieData = useMemo(() => {
    if (isConnected && analyticsData?.channelMix && analyticsData.channelMix.length > 0) {
      // Paid channels in GA4: Paid Search, Paid Social, Paid Video, Paid Shopping, Display, Affiliates, Cross-network
      const paidChannels = ['Paid Search', 'Paid Social', 'Paid Video', 'Paid Shopping', 'Display', 'Affiliates', 'Cross-network'];
      // Organic/Free channels: Direct, Organic Search, Organic Social, Organic Video, Organic Shopping, Referral, Email, Audio, SMS, Mobile Push Notifications
      const organicChannels = ['Direct', 'Organic Search', 'Organic Social', 'Organic Video', 'Organic Shopping', 'Referral', 'Email', 'Audio', 'SMS', 'Mobile Push Notifications'];

      let paidPercentage = 0;
      let organicPercentage = 0;

      analyticsData.channelMix.forEach(c => {
        const channelLower = c.channel.toLowerCase();
        // Check if it's a paid channel (either exact match or starts with "paid")
        if (paidChannels.includes(c.channel) || channelLower.startsWith('paid')) {
          paidPercentage += c.percentage;
        }
        // Check if it's an organic channel
        else if (organicChannels.includes(c.channel) || channelLower.startsWith('organic')) {
          organicPercentage += c.percentage;
        }
        // For unclassified channels (Unassigned, Other, etc.), add to organic as they are not paid
        else {
          organicPercentage += c.percentage;
        }
      });

      return [
        { name: 'Organic', value: organicPercentage },
        { name: 'Paid', value: paidPercentage },
      ];
    }
    return [
      { name: 'Organic', value: 0 },
      { name: 'Paid', value: 0 },
    ];
  }, [isConnected, analyticsData]);

  // Transform lead trend data for chart
  const displayLeadTrend = useMemo(() => {
    if (isConnected && analyticsData?.leadTrend && analyticsData.leadTrend.length > 0) {
      // Group by week or show last 6 data points
      const recentTrend = analyticsData.leadTrend.slice(-30);
      // Aggregate into weekly buckets
      const weeklyData: { [key: string]: { organic: number; paid: number } } = {};

      recentTrend.forEach((item, index) => {
        const weekIndex = Math.floor(index / 5); // Group every 5 days
        const weekKey = `Week ${weekIndex + 1}`;
        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = { organic: 0, paid: 0 };
        }
        // Split conversions between organic and paid (estimate)
        weeklyData[weekKey].organic += Math.round(item.conversions * 0.4);
        weeklyData[weekKey].paid += Math.round(item.conversions * 0.6);
      });

      return Object.entries(weeklyData).slice(0, 6).map(([month, data]) => ({
        month,
        organicLeads: data.organic,
        paidLeads: data.paid,
        organicRevenue: data.organic * 400,
        paidRevenue: data.paid * 300,
        totalSpend: data.paid * 100,
      }));
    }
    return [];
  }, [isConnected, analyticsData]);

  // Calculate overview metrics from GA4 data (only real metrics)
  const displayOverview = useMemo(() => {
    if (isConnected && analyticsData) {
      let totalSessions = 0;
      let totalConversions = 0;

      // Get sessions and conversions from channel mix (most complete data)
      if (analyticsData.channelMix && analyticsData.channelMix.length > 0) {
        totalSessions = analyticsData.channelMix.reduce((sum, c) => sum + c.sessions, 0);
        totalConversions = analyticsData.channelMix.reduce((sum, c) => sum + c.conversions, 0);
      }

      // Fallback to lead trend if channel mix is empty
      if (totalSessions === 0 && analyticsData.leadTrend && analyticsData.leadTrend.length > 0) {
        totalSessions = analyticsData.leadTrend.reduce((sum, t) => sum + t.sessions, 0);
        totalConversions = analyticsData.leadTrend.reduce((sum, t) => sum + t.conversions, 0);
      }

      return {
        totalSessions,
        totalConversions,
      };
    }
    return {
      totalSessions: 0,
      totalConversions: 0,
    };
  }, [isConnected, analyticsData]);

  const aiContextData = {
    overview: displayOverview,
    channels: [...paidChannels, ...organicChannels],
    campaigns: displayCampaigns,
    locationROI: displayLocationROI,
    isGA4Connected: isConnected,
    selectedProperty: ga4Data?.property_name,
    isGoogleAdsConnected,
    googleAdsMetrics: googleAdsAnalytics?.accountMetrics || null,
    googleAdsCampaigns: googleAdsAnalytics?.campaigns || [],
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>Marketing Analytics & ROI</title>
        <meta name="description" content="Analyze marketing performance with GA4 analytics, Google Ads data, ROI tracking, and campaign management." />
      </Helmet>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Marketing ROI</h1>
            <p className="text-muted-foreground">Track organic and paid marketing performance</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-lg">
            <Megaphone className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">Marketing</span>
          </div>
        </div>

        {/* Integration Connection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <GA4ConnectionCard />
          <GoogleAdsConnectionCard />
        </div>

        {/* AI Summary */}
        <AISummaryCard page="marketing" data={aiContextData} />

        {/* Show prompt when no account is connected */}
        {!isConnected && !isGoogleAdsConnected && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Megaphone className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Accounts Connected</h3>
              <p className="text-muted-foreground text-center max-w-md">
                Connect your Google Analytics (GA4) or Google Ads account above to start tracking your marketing performance, campaigns, and ROI.
              </p>
            </CardContent>
          </Card>
        )}

        {(isConnected || isGoogleAdsConnected) && (<>
        {/* Date Range Filter */}
        {isGoogleAdsConnected && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Date Range</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="from-date" className="text-xs text-muted-foreground">From</Label>
                  <Input
                    id="from-date"
                    type="date"
                    value={dateRange.from}
                    onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                    className="w-auto h-8 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="to-date" className="text-xs text-muted-foreground">To</Label>
                  <Input
                    id="to-date"
                    type="date"
                    value={dateRange.to}
                    onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                    className="w-auto h-8 text-sm"
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      const now = new Date();
                      const from = new Date(now.getFullYear(), now.getMonth(), 1);
                      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                      setDateRange({ from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] });
                    }}
                  >
                    This Month
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      const to = new Date();
                      const from = new Date();
                      from.setDate(from.getDate() - 30);
                      setDateRange({ from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] });
                    }}
                  >
                    Last 30 Days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      const to = new Date();
                      const from = new Date();
                      from.setDate(from.getDate() - 90);
                      setDateRange({ from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] });
                    }}
                  >
                    Last 90 Days
                  </Button>
                </div>
                {hasRpcData && (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">
                    Synced Data
                  </Badge>
                )}
                {isLoadingRpc && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Overview KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Spend</p>
                  {isLoadingGoogleAds || isLoadingRpc ? (
                    <Loader2 className="w-5 h-5 animate-spin mt-1" />
                  ) : hasRpcData ? (
                    <p className="text-2xl font-bold">
                      {formatAdsCurrencyWhole(rpcSummary!.total_spend)}
                    </p>
                  ) : isGoogleAdsConnected && googleAdsAnalytics?.accountMetrics?.totalSpend ? (
                    <p className="text-2xl font-bold">
                      {formatAdsCurrencyWhole(googleAdsAnalytics.accountMetrics.totalSpend)}
                    </p>
                  ) : googleAdsMetrics.totalCost > 0 ? (
                    <p className="text-2xl font-bold">
                      {formatAdsCurrencyWhole(googleAdsMetrics.totalCost)}
                    </p>
                  ) : (
                    <p className="text-2xl font-bold text-muted-foreground">-</p>
                  )}
                </div>
                <PoundSterling className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {hasRpcData ? `${dateRange.from} to ${dateRange.to}` : isGoogleAdsConnected ? 'Google Ads API • Last 30 days' : googleAdsMetrics.totalCost > 0 ? 'Google Ads (DB)' : 'Connect Google Ads'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Cost per Conversion</p>
                  {isLoadingGoogleAds || isLoadingRpc ? (
                    <Loader2 className="w-5 h-5 animate-spin mt-1" />
                  ) : hasRpcData ? (
                    <p className="text-2xl font-bold">
                      {formatAdsCurrencyWhole(rpcSummary!.cost_per_conversion)}
                    </p>
                  ) : isGoogleAdsConnected && googleAdsAnalytics?.accountMetrics?.costPerConversion ? (
                    <p className="text-2xl font-bold">
                      {formatAdsCurrencyWhole(googleAdsAnalytics.accountMetrics.costPerConversion)}
                    </p>
                  ) : googleAdsMetrics.costPerLead > 0 ? (
                    <p className="text-2xl font-bold">
                      {formatAdsCurrencyWhole(googleAdsMetrics.costPerLead)}
                    </p>
                  ) : (
                    <p className="text-2xl font-bold text-muted-foreground">-</p>
                  )}
                </div>
                <TrendingUp className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {hasRpcData ? `${dateRange.from} to ${dateRange.to}` : isGoogleAdsConnected ? 'Google Ads API • Last 30 days' : googleAdsMetrics.costPerLead > 0 ? 'Google Ads (DB)' : 'Connect Google Ads'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Clicks</p>
                  {isLoadingGoogleAds || isLoadingRpc ? (
                    <Loader2 className="w-5 h-5 animate-spin mt-1" />
                  ) : hasRpcData ? (
                    <p className="text-2xl font-bold">
                      {formatAdsNumber(rpcSummary!.total_clicks)}
                    </p>
                  ) : isGoogleAdsConnected && googleAdsAnalytics?.accountMetrics?.totalClicks ? (
                    <p className="text-2xl font-bold">
                      {googleAdsAnalytics.accountMetrics.totalClicks.toLocaleString()}
                    </p>
                  ) : googleAdsMetrics.totalClicks > 0 ? (
                    <p className="text-2xl font-bold">
                      {formatAdsNumber(googleAdsMetrics.totalClicks)}
                    </p>
                  ) : (
                    <p className="text-2xl font-bold text-muted-foreground">-</p>
                  )}
                </div>
                <Target className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {hasRpcData ? `${dateRange.from} to ${dateRange.to}` : isGoogleAdsConnected ? 'Google Ads API • Last 30 days' : googleAdsMetrics.totalClicks > 0 ? 'Google Ads (DB)' : 'Connect Google Ads'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Ad Conversions</p>
                  {isLoadingGoogleAds || isLoadingRpc ? (
                    <Loader2 className="w-5 h-5 animate-spin mt-1" />
                  ) : hasRpcData ? (
                    <p className="text-2xl font-bold">
                      {formatAdsNumber(Math.round(rpcSummary!.total_conversions))}
                    </p>
                  ) : isGoogleAdsConnected && googleAdsAnalytics?.accountMetrics?.totalConversions !== undefined ? (
                    <p className="text-2xl font-bold">
                      {googleAdsAnalytics.accountMetrics.totalConversions.toLocaleString()}
                    </p>
                  ) : googleAdsMetrics.totalConversions > 0 ? (
                    <p className="text-2xl font-bold">
                      {formatAdsNumber(Math.round(googleAdsMetrics.totalConversions))}
                    </p>
                  ) : (
                    <p className="text-2xl font-bold text-muted-foreground">-</p>
                  )}
                </div>
                <Users className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {hasRpcData ? `${dateRange.from} to ${dateRange.to}` : isGoogleAdsConnected ? 'Google Ads API • Last 30 days' : googleAdsMetrics.totalConversions > 0 ? 'Google Ads (DB)' : 'Connect Google Ads'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Sessions</p>
                  <p className="text-2xl font-bold">{displayOverview.totalSessions.toLocaleString()}</p>
                </div>
                <Users className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">GA4 • Last 30 days</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Site Conversions</p>
                  <p className="text-2xl font-bold">{displayOverview.totalConversions.toLocaleString()}</p>
                </div>
                <Target className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {displayOverview.totalSessions > 0
                  ? `${((displayOverview.totalConversions / displayOverview.totalSessions) * 100).toFixed(1)}% conversion rate`
                  : 'GA4 • Last 30 days'
                }
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Organic vs Paid Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Channel Mix
                {isConnected && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    <Globe className="w-3 h-3 mr-1" />
                    GA4 Data
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isDataLoading && isConnected ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          <Cell fill={COLORS.organic} />
                          <Cell fill={COLORS.paid} />
                        </Pie>
                        <Tooltip formatter={(value: number) => `${Math.round(value)}%`} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-chart-3" />
                        Organic
                      </span>
                      <span className="font-medium">{Math.round(pieData[0]?.value || 0)}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-primary" />
                        Paid
                      </span>
                      <span className="font-medium">{Math.round(pieData[1]?.value || 0)}%</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Lead Generation Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {isDataLoading && isConnected ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">
                    {isRefreshingAnalytics ? 'Refreshing...' : 'Loading...'}
                  </span>
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={displayLeadTrend}>
                      <XAxis dataKey="month" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="organicLeads"
                        stroke={COLORS.organic}
                        strokeWidth={2}
                        dot={false}
                        name="Organic Leads"
                      />
                      <Line
                        type="monotone"
                        dataKey="paidLeads"
                        stroke={COLORS.paid}
                        strokeWidth={2}
                        dot={false}
                        name="Paid Leads"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Daily Google Ads Trend Chart (from synced data) */}
        {hasRpcData && rpcChartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Daily Ad Spend & Clicks
                <Badge variant="outline" className="ml-2 text-xs bg-green-500/10 text-green-600">
                  Synced Data
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingRpc ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rpcChartData}>
                      <XAxis
                        dataKey="report_date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          return `${d.getDate()}/${d.getMonth() + 1}`;
                        }}
                      />
                      <YAxis
                        yAxisId="spend"
                        orientation="left"
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `£${v}`}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="clicks"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => {
                          if (name === 'Spend') return [`£${value.toFixed(2)}`, name];
                          return [value.toLocaleString(), name];
                        }}
                        labelFormatter={(label) => {
                          const d = new Date(label);
                          return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                        }}
                      />
                      <Legend />
                      <Line
                        yAxisId="spend"
                        type="monotone"
                        dataKey="total_spend"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={false}
                        name="Spend"
                      />
                      <Line
                        yAxisId="clicks"
                        type="monotone"
                        dataKey="total_clicks"
                        stroke="hsl(var(--chart-3))"
                        strokeWidth={2}
                        dot={false}
                        name="Clicks"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Channel Performance Tabs */}
        <Tabs defaultValue="paid" className="space-y-4">
          <TabsList>
            <TabsTrigger value="paid">Paid Channels</TabsTrigger>
            <TabsTrigger value="organic">Organic Channels</TabsTrigger>
          </TabsList>

          <TabsContent value="paid">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Paid Channel Performance
                  {isConnected && displaySessionSources.length > 0 ? (
                    <Badge variant="outline" className="ml-2 text-xs">
                      <Search className="w-3 h-3 mr-1" />
                      GA4 Session Source
                    </Badge>
                  ) : googleAdsCampaigns.length > 0 ? (
                    <Badge variant="outline" className="ml-2 text-xs">
                      <Search className="w-3 h-3 mr-1" />
                      Google Ads (DB)
                    </Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isDataLoading && isConnected ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">
                      {isRefreshingAnalytics ? 'Refreshing data...' : 'Loading data...'}
                    </span>
                  </div>
                ) : (
                  (() => {
                    // Filter for paid sources (cpc, ppc, paid, display, etc.)
                    const paidSources = isConnected && displaySessionSources.length > 0
                      ? displaySessionSources.filter(s =>
                          s.medium === 'cpc' ||
                          s.medium === 'ppc' ||
                          s.medium === 'paid' ||
                          s.medium === 'display' ||
                          s.medium === 'paidsocial' ||
                          s.medium === 'paid_social' ||
                          s.medium === 'cpm' ||
                          s.medium === 'cpv'
                        )
                      : [];

                    // If we have GA4 paid sources, show them
                    if (paidSources.length > 0) {
                      return (
                        <div className="overflow-x-auto">
                          <div className={paidSources.length > 10 ? 'max-h-[480px] overflow-y-auto' : ''}>
                            <table className="w-full">
                              <thead className="sticky top-0 bg-card z-10">
                                <tr className="border-b border-border">
                                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Source</th>
                                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Medium</th>
                                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Sessions</th>
                                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Conversions</th>
                                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Conv. Rate</th>
                                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Bounce Rate</th>
                                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Engagement</th>
                                </tr>
                              </thead>
                              <tbody>
                                {paidSources.map((source) => (
                                  <tr key={source.id} className="border-b border-border/50 hover:bg-muted/50">
                                    <td className="py-3 px-4 font-medium">{source.source}</td>
                                    <td className="py-3 px-4">
                                      <Badge variant="default">{source.medium}</Badge>
                                    </td>
                                    <td className="py-3 px-4 text-right">{source.sessions.toLocaleString()}</td>
                                    <td className="py-3 px-4 text-right">{source.conversions}</td>
                                    <td className="py-3 px-4 text-right">
                                      <span className={source.conversionRate > 2 ? 'text-success' : ''}>
                                        {source.conversionRate.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                      <span className={source.bounceRate > 70 ? 'text-destructive' : source.bounceRate < 40 ? 'text-success' : ''}>
                                        {source.bounceRate.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                      <span className={source.engagementRate > 60 ? 'text-success' : ''}>
                                        {source.engagementRate.toFixed(1)}%
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {paidSources.length > 10 && (
                            <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                              Showing {paidSources.length} sources • Scroll to see more
                            </div>
                          )}
                        </div>
                      );
                    }

                    // If we have Google Ads CSV data, show aggregated by campaign type
                    if (googleAdsCampaigns.length > 0) {
                      // Aggregate by campaign type
                      const searchCampaigns = googleAdsCampaigns.filter(c => c.campaignType === 'Search');
                      const pmaxCampaigns = googleAdsCampaigns.filter(c => c.campaignType === 'Performance Max');

                      const aggregatedData = [
                        {
                          id: 'search',
                          name: 'Google Search',
                          type: 'Search',
                          spend: searchCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0),
                          clicks: searchCampaigns.reduce((sum, c) => sum + (c.clicks || 0), 0),
                          impressions: searchCampaigns.reduce((sum, c) => sum + (c.impressions || 0), 0),
                          conversions: searchCampaigns.reduce((sum, c) => sum + (c.conversions || 0), 0),
                          campaigns: searchCampaigns.length,
                        },
                        {
                          id: 'pmax',
                          name: 'Performance Max',
                          type: 'Performance Max',
                          spend: pmaxCampaigns.reduce((sum, c) => sum + (c.spend || 0), 0),
                          clicks: pmaxCampaigns.reduce((sum, c) => sum + (c.clicks || 0), 0),
                          impressions: pmaxCampaigns.reduce((sum, c) => sum + (c.impressions || 0), 0),
                          conversions: pmaxCampaigns.reduce((sum, c) => sum + (c.conversions || 0), 0),
                          campaigns: pmaxCampaigns.length,
                        },
                      ];

                      return (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Channel</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Campaigns</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Spend</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Clicks</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Impressions</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">CTR</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Conversions</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">CPC</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Cost/Conv.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {aggregatedData.map((channel) => {
                                const ctr = channel.impressions > 0 ? (channel.clicks / channel.impressions) * 100 : 0;
                                const cpc = channel.clicks > 0 ? channel.spend / channel.clicks : 0;
                                const costPerConv = channel.conversions > 0 ? channel.spend / channel.conversions : 0;

                                return (
                                  <tr key={channel.id} className="border-b border-border/50 hover:bg-muted/50">
                                    <td className="py-3 px-4">
                                      <div className="flex items-center gap-2">
                                        <Search className="w-4 h-4 text-primary" />
                                        <span className="font-medium">{channel.name}</span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4 text-right">{channel.campaigns}</td>
                                    <td className="py-3 px-4 text-right font-medium">{formatAdsCurrency(channel.spend)}</td>
                                    <td className="py-3 px-4 text-right">{formatAdsNumber(channel.clicks)}</td>
                                    <td className="py-3 px-4 text-right">{formatAdsNumber(channel.impressions)}</td>
                                    <td className="py-3 px-4 text-right">{ctr.toFixed(2)}%</td>
                                    <td className="py-3 px-4 text-right">{formatAdsNumber(Math.round(channel.conversions))}</td>
                                    <td className="py-3 px-4 text-right">{formatAdsCurrency(cpc)}</td>
                                    <td className="py-3 px-4 text-right">
                                      {channel.conversions > 0 ? formatAdsCurrency(costPerConv) : '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* Total row */}
                              <tr className="bg-muted/50 font-medium">
                                <td className="py-3 px-4">Total</td>
                                <td className="py-3 px-4 text-right">{googleAdsCampaigns.length}</td>
                                <td className="py-3 px-4 text-right">{formatAdsCurrency(googleAdsMetrics.totalCost)}</td>
                                <td className="py-3 px-4 text-right">{formatAdsNumber(googleAdsMetrics.totalClicks)}</td>
                                <td className="py-3 px-4 text-right">{formatAdsNumber(googleAdsMetrics.totalImpressions)}</td>
                                <td className="py-3 px-4 text-right">{googleAdsMetrics.averageCtr}</td>
                                <td className="py-3 px-4 text-right">{formatAdsNumber(Math.round(googleAdsMetrics.totalConversions))}</td>
                                <td className="py-3 px-4 text-right">
                                  {formatAdsCurrency(googleAdsMetrics.totalCost / googleAdsMetrics.totalClicks)}
                                </td>
                                <td className="py-3 px-4 text-right">{formatAdsCurrency(googleAdsMetrics.costPerLead)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      );
                    }

                    // Fallback to static demo data
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Channel</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Spend</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Revenue</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">ROI</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Leads</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">CPL</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">CPA</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Trend</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paidChannels.map((channel) => (
                              <tr key={channel.id} className="border-b border-border/50 hover:bg-muted/50">
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    {getChannelIcon(channel.id)}
                                    <span className="font-medium">{channel.name}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-right">{formatCurrency(channel.spend)}</td>
                                <td className="py-3 px-4 text-right">{formatCurrency(channel.revenue)}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={channel.roi >= 0 ? 'text-success' : 'text-destructive'}>
                                    {channel.roi}%
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">{channel.leads}</td>
                                <td className="py-3 px-4 text-right">£{channel.cpl.toFixed(0)}</td>
                                <td className="py-3 px-4 text-right">£{channel.cpa.toFixed(0)}</td>
                                <td className="py-3 px-4 text-right">
                                  <TrendIndicator value={channel.trend} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="organic">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Organic Channel Performance
                  {isConnected && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      <Globe className="w-3 h-3 mr-1" />
                      Session Source
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isDataLoading && isConnected ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">
                      {isRefreshingAnalytics ? 'Refreshing data...' : 'Loading data...'}
                    </span>
                  </div>
                ) : (
                  (() => {
                    // Filter for organic sources (organic, referral, (none) which is direct)
                    const organicSources = isConnected && displaySessionSources.length > 0
                      ? displaySessionSources.filter(s =>
                          s.medium === 'organic' ||
                          s.medium === 'referral' ||
                          s.medium === '(none)' ||
                          s.medium === 'email' ||
                          s.medium === 'social'
                        )
                      : [];

                    if (organicSources.length === 0 && isConnected) {
                      return (
                        <div className="text-center py-8 text-muted-foreground">
                          No organic traffic data found for the selected period.
                        </div>
                      );
                    }

                    if (!isConnected) {
                      return (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Channel</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Investment</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Revenue</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">ROI</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Leads</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">CPL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {organicChannels.map((channel) => (
                                <tr key={channel.id} className="border-b border-border/50 hover:bg-muted/50">
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      {getChannelIcon(channel.id)}
                                      <span className="font-medium">{channel.name}</span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4 text-right">{formatCurrency(channel.spend)}</td>
                                  <td className="py-3 px-4 text-right">{formatCurrency(channel.revenue)}</td>
                                  <td className="py-3 px-4 text-right">
                                    <span className="text-success">{channel.roi}%</span>
                                  </td>
                                  <td className="py-3 px-4 text-right">{channel.leads}</td>
                                  <td className="py-3 px-4 text-right">£{channel.cpl.toFixed(0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    }

                    return (
                      <div className="overflow-x-auto">
                        <div className={organicSources.length > 10 ? 'max-h-[480px] overflow-y-auto' : ''}>
                          <table className="w-full">
                            <thead className="sticky top-0 bg-card z-10">
                              <tr className="border-b border-border">
                                <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Source</th>
                                <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Medium</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Sessions</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Conversions</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Conv. Rate</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Bounce Rate</th>
                                <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Engagement</th>
                              </tr>
                            </thead>
                            <tbody>
                              {organicSources.map((source) => (
                                <tr key={source.id} className="border-b border-border/50 hover:bg-muted/50">
                                  <td className="py-3 px-4 font-medium">{source.source}</td>
                                  <td className="py-3 px-4">
                                    <Badge variant="secondary">{source.medium}</Badge>
                                  </td>
                                  <td className="py-3 px-4 text-right">{source.sessions.toLocaleString()}</td>
                                  <td className="py-3 px-4 text-right">{source.conversions}</td>
                                  <td className="py-3 px-4 text-right">
                                    <span className={source.conversionRate > 2 ? 'text-success' : ''}>
                                      {source.conversionRate.toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <span className={source.bounceRate > 70 ? 'text-destructive' : source.bounceRate < 40 ? 'text-success' : ''}>
                                      {source.bounceRate.toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <span className={source.engagementRate > 60 ? 'text-success' : ''}>
                                      {source.engagementRate.toFixed(1)}%
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {organicSources.length > 10 && (
                          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                            Showing {organicSources.length} sources • Scroll to see more
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Active Campaigns */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Active Campaigns
              {hasRpcData && rpcCampaigns.length > 0 ? (
                <Badge variant="outline" className="ml-2 text-xs bg-green-500/10 text-green-600">
                  <Search className="w-3 h-3 mr-1" />
                  Synced Data
                </Badge>
              ) : isGoogleAdsConnected && googleAdsAnalytics?.campaigns && googleAdsAnalytics.campaigns.length > 0 ? (
                <Badge variant="outline" className="ml-2 text-xs">
                  <Search className="w-3 h-3 mr-1" />
                  Google Ads API
                </Badge>
              ) : googleAdsCampaigns.length > 0 ? (
                <Badge variant="outline" className="ml-2 text-xs">
                  <Search className="w-3 h-3 mr-1" />
                  Google Ads (DB)
                </Badge>
              ) : isConnected && displayCampaigns.length > 0 ? (
                <Badge variant="outline" className="ml-2 text-xs">
                  <Search className="w-3 h-3 mr-1" />
                  CPC Traffic
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Loading state */}
            {(isLoadingGoogleAds || isLoadingRpc || (isDataLoading && isConnected)) ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading campaigns...</span>
              </div>
            ) : hasRpcData && rpcCampaigns.length > 0 ? (
              /* RPC-based Campaigns Table (synced daily data) */
              <div className="overflow-x-auto">
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Campaign</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Type</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Status</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Spend</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Clicks</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Impressions</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">CTR</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Conversions</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Cost/Conv.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rpcCampaigns.map((campaign) => (
                        <tr key={campaign.campaign_id} className="border-b border-border/50 hover:bg-muted/50">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  campaign.campaign_status === 'ENABLED' ? 'bg-green-500' : 'bg-yellow-500'
                                }`}
                              />
                              <span className="font-medium text-sm">{campaign.campaign_name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className="text-xs">{campaign.campaign_type}</Badge>
                          </td>
                          <td className="py-3 px-4">
                            <Badge
                              variant={campaign.campaign_status === 'ENABLED' ? 'default' : 'secondary'}
                              className={
                                campaign.campaign_status === 'ENABLED'
                                  ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                                  : 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20'
                              }
                            >
                              {campaign.campaign_status === 'ENABLED' ? 'Enabled' : campaign.campaign_status === 'PAUSED' ? 'Paused' : campaign.campaign_status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right font-medium">{formatAdsCurrency(campaign.total_spend)}</td>
                          <td className="py-3 px-4 text-right">{formatAdsNumber(campaign.total_clicks)}</td>
                          <td className="py-3 px-4 text-right">{formatAdsNumber(campaign.total_impressions)}</td>
                          <td className="py-3 px-4 text-right">{(campaign.avg_ctr * 100).toFixed(2)}%</td>
                          <td className="py-3 px-4 text-right">{formatAdsNumber(Math.round(campaign.total_conversions))}</td>
                          <td className="py-3 px-4 text-right">
                            {campaign.total_conversions > 0 ? formatAdsCurrency(campaign.avg_cost_per_conversion) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    {rpcCampaigns.length} campaigns • {dateRange.from} to {dateRange.to}
                  </p>
                  <div className="text-sm font-medium">
                    Total Spend: {formatAdsCurrency(rpcSummary?.total_spend || 0)}
                  </div>
                </div>
              </div>
            ) : isGoogleAdsConnected && googleAdsAnalytics?.campaigns && googleAdsAnalytics.campaigns.length > 0 ? (
              /* Google Ads API Campaigns Table */
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Campaign</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Spend</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Clicks</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Impressions</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Conversions</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Cost/Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleAdsAnalytics.campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{campaign.name}</td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={campaign.status?.toUpperCase() === 'ENABLED' ? 'default' : 'secondary'}
                            className={
                              campaign.status?.toUpperCase() === 'ENABLED'
                                ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                                : 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20'
                            }
                          >
                            {campaign.status?.toUpperCase() === 'ENABLED' ? 'Enabled' : campaign.status?.toUpperCase() === 'PAUSED' ? 'Paused' : campaign.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">{formatAdsCurrency(campaign.spend)}</td>
                        <td className="py-3 px-4 text-right">{campaign.clicks.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">{campaign.impressions.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">{Math.round(campaign.conversions)}</td>
                        <td className="py-3 px-4 text-right">
                          {campaign.conversions > 0 ? formatAdsCurrency(campaign.costPerConversion) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : googleAdsCampaigns.length > 0 ? (
              /* Google Ads CSV Data Campaigns Table */
              <div className="overflow-x-auto">
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Campaign</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Type</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Status</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Clicks</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Impressions</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">CTR</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Conversions</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Spend</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground bg-card">Cost/Conv.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {googleAdsCampaigns.map((campaign) => (
                        <tr key={campaign.id} className="border-b border-border/50 hover:bg-muted/50">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  campaign.status === 'Enabled' ? 'bg-green-500' : 'bg-yellow-500'
                                }`}
                              />
                              <span className="font-medium text-sm">{campaign.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className="text-xs">
                              {campaign.campaignType}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <Badge
                              variant={campaign.status === 'Enabled' ? 'default' : 'secondary'}
                              className={
                                campaign.status === 'Enabled'
                                  ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                                  : 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20'
                              }
                            >
                              {campaign.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right">{formatAdsNumber(campaign.clicks || 0)}</td>
                          <td className="py-3 px-4 text-right">{formatAdsNumber(campaign.impressions || 0)}</td>
                          <td className="py-3 px-4 text-right">{campaign.ctr || '0%'}</td>
                          <td className="py-3 px-4 text-right">{formatAdsNumber(Math.round(campaign.conversions || 0))}</td>
                          <td className="py-3 px-4 text-right font-medium">{formatAdsCurrency(campaign.spend || 0)}</td>
                          <td className="py-3 px-4 text-right">
                            {(campaign.conversions || 0) > 0 ? formatAdsCurrency(campaign.costPerConversion || 0) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    Showing {googleAdsCampaigns.length} campaigns from database
                  </p>
                  <div className="text-sm font-medium">
                    Total Spend: {formatAdsCurrency(googleAdsMetrics.totalCost)}
                  </div>
                </div>
              </div>
            ) : displayCampaigns.length > 0 ? (
              /* GA4 CPC Campaigns Table (fallback) */
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Campaign</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Sessions</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Conversions</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Conv. Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayCampaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{campaign.name}</td>
                        <td className="py-3 px-4 text-right">{campaign.clicks.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">{campaign.conversions}</td>
                        <td className="py-3 px-4 text-right">
                          {campaign.clicks > 0 ? ((campaign.conversions / campaign.clicks) * 100).toFixed(1) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No campaign data available. Import CSV data or connect Google Ads.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sessions by Location */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {isConnected ? 'Sessions by Location' : 'Marketing ROI by Location'}
              {isConnected && (
                <Badge variant="outline" className="ml-2 text-xs">
                  <Globe className="w-3 h-3 mr-1" />
                  Geographic Data
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isDataLoading && isConnected ? (
              <div className="flex items-center justify-center h-72">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">
                  {isRefreshingAnalytics ? 'Refreshing geographic data...' : 'Loading geographic data...'}
                </span>
              </div>
            ) : displayLocationROI.length === 0 ? (
              <div className="flex items-center justify-center h-72 text-muted-foreground">
                {isConnected
                  ? 'No geographic data available for the selected period.'
                  : 'Connect GA4 to view geographic data.'}
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={displayLocationROI} layout="vertical">
                    <XAxis
                      type="number"
                      tickFormatter={(v) => isConnected ? v.toLocaleString() : `${v}%`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis type="category" dataKey="locationName" axisLine={false} tickLine={false} width={160} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0].payload;
                        if (isConnected) {
                          return (
                            <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
                              <p className="font-medium mb-2">{data.locationName}</p>
                              <div className="space-y-1 text-muted-foreground">
                                <p>Sessions: <span className="text-foreground font-medium">{data.sessions.toLocaleString()}</span></p>
                                <p>Conversions: <span className="text-foreground font-medium">{data.conversions}</span></p>
                                <p>Conv. Rate: <span className="text-foreground font-medium">{data.conversionRate}%</span></p>
                                {data.revenue > 0 && (
                                  <p>Revenue: <span className="text-foreground font-medium">£{data.revenue.toLocaleString()}</span></p>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                            <p className="font-medium">{data.locationName}</p>
                            <p className="text-muted-foreground">ROI: {data.roi}%</p>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey={isConnected ? 'sessions' : 'roi'}
                      fill="hsl(var(--primary))"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        </>)}
      </div>
    </MainLayout>
  );
}
