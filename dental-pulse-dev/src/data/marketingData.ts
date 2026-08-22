// Marketing ROI Data

export interface MarketingChannel {
  id: string;
  name: string;
  type: 'organic' | 'paid';
  spend: number;
  revenue: number;
  leads: number;
  conversions: number;
  roi: number;
  cpl: number; // Cost per lead
  cpa: number; // Cost per acquisition
  trend: number;
}

export interface MonthlyMarketingData {
  month: string;
  organicLeads: number;
  paidLeads: number;
  organicRevenue: number;
  paidRevenue: number;
  totalSpend: number;
}

export interface CampaignPerformance {
  id: string;
  name: string;
  channel: string;
  status: 'active' | 'paused' | 'completed';
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  ctr: number;
  roi: number;
}

// Overview metrics
export const marketingOverview = {
  totalSpend: 187500,
  totalRevenue: 892000,
  totalROI: 376,
  totalLeads: 2847,
  totalConversions: 412,
  averageCPL: 65.8,
  averageCPA: 455,
  organicShare: 42,
  paidShare: 58,
};

// Channel breakdown
export const marketingChannels: MarketingChannel[] = [
  // Organic channels
  {
    id: 'organic-seo',
    name: 'SEO / Organic Search',
    type: 'organic',
    spend: 12000, // Content & SEO tools
    revenue: 312000,
    leads: 856,
    conversions: 124,
    roi: 2500,
    cpl: 14.0,
    cpa: 96.8,
    trend: 8.2,
  },
  {
    id: 'organic-referral',
    name: 'Patient Referrals',
    type: 'organic',
    spend: 8500, // Referral program costs
    revenue: 198000,
    leads: 342,
    conversions: 89,
    roi: 2229,
    cpl: 24.9,
    cpa: 95.5,
    trend: 5.4,
  },
  {
    id: 'organic-social',
    name: 'Organic Social Media',
    type: 'organic',
    spend: 4200, // Content creation
    revenue: 45000,
    leads: 198,
    conversions: 28,
    roi: 971,
    cpl: 21.2,
    cpa: 150.0,
    trend: 12.1,
  },
  // Paid channels
  {
    id: 'google-ads',
    name: 'Google Ads',
    type: 'paid',
    spend: 68000,
    revenue: 198000,
    leads: 687,
    conversions: 92,
    roi: 191,
    cpl: 99.0,
    cpa: 739.1,
    trend: 3.2,
  },
  {
    id: 'facebook-ads',
    name: 'Facebook Ads',
    type: 'paid',
    spend: 42000,
    revenue: 78000,
    leads: 412,
    conversions: 48,
    roi: 86,
    cpl: 101.9,
    cpa: 875.0,
    trend: -2.4,
  },
  {
    id: 'instagram-ads',
    name: 'Instagram Ads',
    type: 'paid',
    spend: 28000,
    revenue: 42000,
    leads: 234,
    conversions: 22,
    roi: 50,
    cpl: 119.7,
    cpa: 1272.7,
    trend: 6.8,
  },
  {
    id: 'youtube-ads',
    name: 'YouTube Ads',
    type: 'paid',
    spend: 24800,
    revenue: 19000,
    leads: 118,
    conversions: 9,
    roi: -23,
    cpl: 210.2,
    cpa: 2755.6,
    trend: -8.5,
  },
];

// Monthly trends
export const monthlyMarketingTrend: MonthlyMarketingData[] = [
  { month: 'Jul', organicLeads: 195, paidLeads: 220, organicRevenue: 78000, paidRevenue: 52000, totalSpend: 28500 },
  { month: 'Aug', organicLeads: 212, paidLeads: 235, organicRevenue: 85000, paidRevenue: 58000, totalSpend: 29200 },
  { month: 'Sep', organicLeads: 228, paidLeads: 248, organicRevenue: 91000, paidRevenue: 54000, totalSpend: 30100 },
  { month: 'Oct', organicLeads: 235, paidLeads: 262, organicRevenue: 94000, paidRevenue: 56000, totalSpend: 31500 },
  { month: 'Nov', organicLeads: 248, paidLeads: 275, organicRevenue: 98000, paidRevenue: 58000, totalSpend: 32800 },
  { month: 'Dec', organicLeads: 278, paidLeads: 211, organicRevenue: 109000, paidRevenue: 59000, totalSpend: 35400 },
];

// Campaign performance
export const activeCampaigns: CampaignPerformance[] = [
  {
    id: '1',
    name: 'Invisalign Spring Promo',
    channel: 'Google Ads',
    status: 'active',
    spend: 12500,
    impressions: 245000,
    clicks: 4890,
    leads: 156,
    conversions: 23,
    ctr: 2.0,
    roi: 284,
  },
  {
    id: '2',
    name: 'New Patient Special',
    channel: 'Facebook Ads',
    status: 'active',
    spend: 8200,
    impressions: 189000,
    clicks: 3780,
    leads: 98,
    conversions: 14,
    ctr: 2.0,
    roi: 171,
  },
  {
    id: '3',
    name: 'Teeth Whitening Awareness',
    channel: 'Instagram Ads',
    status: 'active',
    spend: 5400,
    impressions: 156000,
    clicks: 4680,
    leads: 67,
    conversions: 8,
    ctr: 3.0,
    roi: 148,
  },
  {
    id: '4',
    name: 'Brand Awareness Video',
    channel: 'YouTube Ads',
    status: 'active',
    spend: 7800,
    impressions: 312000,
    clicks: 6240,
    leads: 34,
    conversions: 3,
    ctr: 2.0,
    roi: -15,
  },
  {
    id: '5',
    name: 'Dental Implants Campaign',
    channel: 'Google Ads',
    status: 'paused',
    spend: 15200,
    impressions: 178000,
    clicks: 3560,
    leads: 89,
    conversions: 12,
    ctr: 2.0,
    roi: 158,
  },
];

// ROI by location
export const locationMarketingROI = [
  { locationId: '1', locationName: 'Downtown Seattle', spend: 28500, revenue: 142000, roi: 398, leads: 412 },
  { locationId: '2', locationName: 'Bellevue Square', spend: 24200, revenue: 118000, roi: 388, leads: 356 },
  { locationId: '3', locationName: 'Tacoma Central', spend: 18900, revenue: 87000, roi: 360, leads: 287 },
  { locationId: '4', locationName: 'Kirkland', spend: 21500, revenue: 105000, roi: 388, leads: 324 },
  { locationId: '5', locationName: 'Redmond', spend: 32400, revenue: 98000, roi: 202, leads: 298 },
  { locationId: '6', locationName: 'Everett', spend: 19800, revenue: 112000, roi: 466, leads: 342 },
  { locationId: '7', locationName: 'Federal Way', spend: 22100, revenue: 124000, roi: 461, leads: 398 },
  { locationId: '8', locationName: 'Olympia', spend: 20100, revenue: 106000, roi: 427, leads: 430 },
];

// Channel icons mapping
export const channelIcons: Record<string, string> = {
  'google-ads': 'Search',
  'facebook-ads': 'Facebook',
  'instagram-ads': 'Instagram',
  'youtube-ads': 'Youtube',
  'organic-seo': 'Globe',
  'organic-referral': 'Users',
  'organic-social': 'Share2',
};
