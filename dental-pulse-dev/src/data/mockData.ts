// DentPulse Enterprise - Mock Data for 42 Dental Locations

export type StatusType = 'success' | 'warning' | 'danger';

export interface Location {
  id: string;
  code: string;
  name: string;
  fullName: string;
  region: string;
  cluster?: string;
  revenue: {
    mtd: number;
    lastMonth: number;
    budget: number;
    trend: number[];
  };
  ebitda: {
    percentage: number;
    budget: number;
    variance: number;
  };
  collections: {
    mtd: number;
    rate: number;
    target: number;
    trend: number[];
  };
  arDays: number;
  arAgeing: {
    '0-30': number;
    '31-60': number;
    '61-90': number;
    '90+': number;
  };
  claims: {
    denialRate: number;
    daysToPay: number;
    stuckClaims: number;
    pending: number;
    approved: number;
    denied: number;
  };
  status: StatusType;
  rank: number;
  issues?: string[];
}

export interface Region {
  id: string;
  name: string;
  locationCount: number;
}

export const regions: Region[] = [
  { id: 'north', name: 'Region North', locationCount: 18 },
  { id: 'south', name: 'Region South', locationCount: 15 },
  { id: 'london', name: 'Region London', locationCount: 9 },
];

export const clusters = [
  { id: 'london-premium', name: 'London Premium', locationCount: 5 },
  { id: 'ortho-heavy', name: 'Ortho-Heavy', locationCount: 8 },
  { id: 'new-acquisitions', name: 'New Acquisitions 2024', locationCount: 6 },
];

// Generate 12 months of realistic trend data
const generateTrend = (base: number, variance: number = 0.1): number[] => {
  return Array.from({ length: 12 }, (_, i) => {
    const seasonal = Math.sin((i / 12) * Math.PI * 2) * 0.05;
    const random = (Math.random() - 0.5) * variance;
    return Math.round(base * (1 + seasonal + random));
  });
};

// Generate realistic AR ageing distribution
const generateArAgeing = (healthScore: number): Location['arAgeing'] => {
  const base0to30 = 55 + healthScore * 15 + Math.random() * 10;
  const remaining = 100 - base0to30;
  const base31to60 = remaining * (0.4 + Math.random() * 0.2);
  const base61to90 = remaining * (0.25 + Math.random() * 0.1);
  const base90plus = 100 - base0to30 - base31to60 - base61to90;
  
  return {
    '0-30': Math.round(base0to30),
    '31-60': Math.round(base31to60),
    '61-90': Math.round(base61to90),
    '90+': Math.round(Math.max(0, base90plus)),
  };
};

const locationNames = [
  { name: 'Wimbledon Dental Centre', code: 'LDN-07', region: 'london', cluster: 'london-premium' },
  { name: 'Mayfair Smile Clinic', code: 'LDN-01', region: 'london', cluster: 'london-premium' },
  { name: 'Chelsea Orthodontics', code: 'LDN-02', region: 'london', cluster: 'london-premium' },
  { name: 'Kensington Family Dental', code: 'LDN-03', region: 'london', cluster: 'london-premium' },
  { name: 'Canary Wharf Practice', code: 'LDN-04', region: 'london', cluster: 'london-premium' },
  { name: 'Hampstead Dental Care', code: 'LDN-05', region: 'london' },
  { name: 'Shoreditch Smile Studio', code: 'LDN-06', region: 'london' },
  { name: 'Richmond Orthodontics', code: 'LDN-08', region: 'london', cluster: 'ortho-heavy' },
  { name: 'Islington Dental Hub', code: 'LDN-09', region: 'london' },
  { name: 'Brighton Family Practice', code: 'SOU-03', region: 'south', cluster: 'new-acquisitions' },
  { name: 'Southampton Dental Centre', code: 'SOU-01', region: 'south' },
  { name: 'Portsmouth Smile Clinic', code: 'SOU-02', region: 'south' },
  { name: 'Bournemouth Orthodontics', code: 'SOU-04', region: 'south', cluster: 'ortho-heavy' },
  { name: 'Guildford Family Dental', code: 'SOU-05', region: 'south' },
  { name: 'Reading Dental Practice', code: 'SOU-06', region: 'south', cluster: 'new-acquisitions' },
  { name: 'Oxford Smile Studio', code: 'SOU-07', region: 'south' },
  { name: 'Canterbury Dental Care', code: 'SOU-08', region: 'south' },
  { name: 'Tunbridge Wells Dental', code: 'SOU-09', region: 'south' },
  { name: 'Maidstone Orthodontics', code: 'SOU-10', region: 'south', cluster: 'ortho-heavy' },
  { name: 'Eastbourne Family Dental', code: 'SOU-11', region: 'south', cluster: 'new-acquisitions' },
  { name: 'Worthing Dental Centre', code: 'SOU-12', region: 'south' },
  { name: 'Chichester Smile Clinic', code: 'SOU-13', region: 'south' },
  { name: 'Hastings Dental Practice', code: 'SOU-14', region: 'south', cluster: 'new-acquisitions' },
  { name: 'Ashford Dental Hub', code: 'SOU-15', region: 'south' },
  { name: 'Manchester Orthodontics', code: 'NOR-12', region: 'north', cluster: 'ortho-heavy' },
  { name: 'Liverpool Dental Centre', code: 'NOR-01', region: 'north' },
  { name: 'Leeds Smile Clinic', code: 'NOR-02', region: 'north' },
  { name: 'Sheffield Family Dental', code: 'NOR-03', region: 'north' },
  { name: 'Newcastle Dental Practice', code: 'NOR-04', region: 'north' },
  { name: 'Birmingham Orthodontics', code: 'NOR-05', region: 'north', cluster: 'ortho-heavy' },
  { name: 'Nottingham Smile Studio', code: 'NOR-06', region: 'north' },
  { name: 'Bristol Dental Care', code: 'NOR-07', region: 'north' },
  { name: 'Cardiff Family Dental', code: 'NOR-08', region: 'north', cluster: 'new-acquisitions' },
  { name: 'Edinburgh Dental Hub', code: 'NOR-09', region: 'north' },
  { name: 'Glasgow Smile Centre', code: 'NOR-10', region: 'north' },
  { name: 'York Dental Practice', code: 'NOR-11', region: 'north' },
  { name: 'Hull Orthodontics', code: 'NOR-13', region: 'north', cluster: 'ortho-heavy' },
  { name: 'Bradford Family Dental', code: 'NOR-14', region: 'north', cluster: 'new-acquisitions' },
  { name: 'Coventry Dental Centre', code: 'NOR-15', region: 'north' },
  { name: 'Leicester Smile Clinic', code: 'NOR-16', region: 'north' },
  { name: 'Derby Dental Practice', code: 'NOR-17', region: 'north' },
  { name: 'Wolverhampton Dental Hub', code: 'NOR-18', region: 'north' },
];

// Generate locations with realistic variance
export const locations: Location[] = locationNames.map((loc, index) => {
  // Determine performance tier (8 excellent, 22 average, 8 underperforming, 4 critical)
  let tier: 'excellent' | 'average' | 'underperforming' | 'critical';
  let healthScore: number;
  
  if (index < 8) {
    tier = 'excellent';
    healthScore = 0.85 + Math.random() * 0.15;
  } else if (index < 30) {
    tier = 'average';
    healthScore = 0.6 + Math.random() * 0.25;
  } else if (index < 38) {
    tier = 'underperforming';
    healthScore = 0.35 + Math.random() * 0.25;
  } else {
    tier = 'critical';
    healthScore = 0.1 + Math.random() * 0.25;
  }

  const baseRevenue = 150000 + Math.random() * 150000;
  const revenueVariance = tier === 'excellent' ? 0.05 : tier === 'average' ? 0.1 : 0.2;
  
  const ebitdaBase = tier === 'excellent' ? 35 : tier === 'average' ? 30 : tier === 'underperforming' ? 25 : 20;
  const ebitdaVariance = (Math.random() - 0.5) * 8;
  const ebitdaActual = ebitdaBase + ebitdaVariance;
  const ebitdaBudget = 34;
  
  const collectionRateBase = tier === 'excellent' ? 98 : tier === 'average' ? 96 : tier === 'underperforming' ? 93 : 88;
  const collectionRateVariance = (Math.random() - 0.5) * 4;
  const collectionRate = Math.min(100, collectionRateBase + collectionRateVariance);
  
  const arDaysBase = tier === 'excellent' ? 28 : tier === 'average' ? 38 : tier === 'underperforming' ? 48 : 58;
  const arDaysVariance = Math.round((Math.random() - 0.5) * 10);
  const arDays = arDaysBase + arDaysVariance;
  
  const denialRateBase = tier === 'excellent' ? 2 : tier === 'average' ? 4 : tier === 'underperforming' ? 6 : 9;
  const denialRate = Math.max(0.5, denialRateBase + (Math.random() - 0.5) * 2);

  const mtdRevenue = Math.round(baseRevenue * (0.9 + Math.random() * 0.2));
  const lastMonthRevenue = Math.round(baseRevenue * (0.9 + Math.random() * 0.2));
  const budgetRevenue = Math.round(baseRevenue * 1.05);

  // Determine status based on metrics
  let status: StatusType;
  if (tier === 'excellent' || tier === 'average') {
    status = arDays > 45 || collectionRate < 94 || ebitdaActual < 26 ? 'warning' : 'success';
  } else if (tier === 'underperforming') {
    status = arDays > 50 || collectionRate < 91 ? 'danger' : 'warning';
  } else {
    status = 'danger';
  }

  const issues: string[] = [];
  if (arDays > 45) issues.push('High AR Days');
  if (collectionRate < 94) issues.push('Low Collection Rate');
  if (ebitdaActual < 28) issues.push('Below Target Margin');
  if (denialRate > 5) issues.push('High Denial Rate');

  return {
    id: `loc-${index + 1}`,
    code: loc.code,
    name: loc.name.split(' ').slice(0, 2).join(' '),
    fullName: loc.name,
    region: loc.region,
    cluster: loc.cluster,
    revenue: {
      mtd: mtdRevenue,
      lastMonth: lastMonthRevenue,
      budget: budgetRevenue,
      trend: generateTrend(baseRevenue / 1000, revenueVariance),
    },
    ebitda: {
      percentage: Math.round(ebitdaActual * 10) / 10,
      budget: ebitdaBudget,
      variance: Math.round((ebitdaActual - ebitdaBudget) * 10) / 10,
    },
    collections: {
      mtd: Math.round(mtdRevenue * (collectionRate / 100)),
      rate: Math.round(collectionRate * 10) / 10,
      target: 98,
      trend: generateTrend(collectionRate, 0.03),
    },
    arDays,
    arAgeing: generateArAgeing(healthScore),
    claims: {
      denialRate: Math.round(denialRate * 10) / 10,
      daysToPay: Math.round(35 + (1 - healthScore) * 20 + Math.random() * 10),
      stuckClaims: Math.round((1 - healthScore) * 50000 + Math.random() * 20000),
      pending: Math.round(20 + Math.random() * 30),
      approved: Math.round(150 + Math.random() * 100),
      denied: Math.round(denialRate * 3),
    },
    status,
    rank: index + 1,
    issues,
  };
});

// Sort locations by rank for consistent display
locations.sort((a, b) => {
  // Sort by status (success first, then warning, then danger)
  const statusOrder = { success: 0, warning: 1, danger: 2 };
  if (statusOrder[a.status] !== statusOrder[b.status]) {
    return statusOrder[a.status] - statusOrder[b.status];
  }
  // Then by EBITDA
  return b.ebitda.percentage - a.ebitda.percentage;
}).forEach((loc, idx) => loc.rank = idx + 1);

// Aggregate metrics
export const aggregateMetrics = {
  totalRevenue: {
    mtd: locations.reduce((sum, loc) => sum + loc.revenue.mtd, 0),
    lastMonth: locations.reduce((sum, loc) => sum + loc.revenue.lastMonth, 0),
    trend: 4.2,
    runRate: 0,
  },
  ebitda: {
    percentage: 32.4,
    budget: 34.2,
    variance: -1.8,
    varianceAmount: -180000,
  },
  collections: {
    mtd: locations.reduce((sum, loc) => sum + loc.collections.mtd, 0),
    rate: 96.8,
    target: 98,
    trend: -1.2,
  },
  arDays: {
    current: 38,
    target: 35,
    ageing: {
      '0-30': 62,
      '31-60': 22,
      '61-90': 11,
      '90+': 5,
    },
  },
  claims: {
    denialRate: 4.2,
    avgDaysToPay: 42,
    stuckClaims: 340000,
    flaggedCount: 12,
  },
};

// Calculate run rate
aggregateMetrics.totalRevenue.runRate = aggregateMetrics.totalRevenue.mtd * 12;

// Weekly changes for "What Changed" section
export const weeklyChanges = [
  { metric: 'Net Production', lastWeek: '£7.9M', thisWeek: '£8.4M', change: '+6.3%', status: 'success' as StatusType },
  { metric: 'Collection Amount', lastWeek: '£0', thisWeek: '£0', change: '0.0%', status: 'success' as StatusType },
  { metric: 'EBITDA Margin', lastWeek: '33.1%', thisWeek: '32.4%', change: '-2.1%', status: 'warning' as StatusType },
  { metric: 'Active Patients', lastWeek: '45,200', thisWeek: '46,100', change: '+2.0%', status: 'success' as StatusType },
];

// Top risks
export const topRisks = [
  {
    id: 'risk-1',
    title: 'AR Days Rising in Region South',
    description: 'AR days increased 18% over 2 weeks. 5 locations now exceed 45-day threshold.',
    severity: 'danger' as StatusType,
    metric: 'AR Days: 44 avg',
    action: 'Review details',
  },
  {
    id: 'risk-2',
    title: 'Margin Pressure at Multiple Sites',
    description: '5 locations operating below 28% EBITDA margin. Labour costs elevated.',
    severity: 'warning' as StatusType,
    metric: '5 sites affected',
    action: 'Review details',
  },
  {
    id: 'risk-3',
    title: 'Claim Denials Spiking for Denplan',
    description: 'Denial rate from Denplan up 40% this month. Documentation issues suspected.',
    severity: 'warning' as StatusType,
    metric: 'Denial rate: 6.8%',
    action: 'Review details',
  },
];

// Attention-needed locations (bottom performers)
export const attentionLocations = locations
  .filter(loc => loc.status === 'danger' || loc.status === 'warning')
  .sort((a, b) => {
    if (a.status === 'danger' && b.status !== 'danger') return -1;
    if (a.status !== 'danger' && b.status === 'danger') return 1;
    return a.arDays > b.arDays ? -1 : 1;
  })
  .slice(0, 5);

// Monthly trend data for charts
export const monthlyTrendData = [
  { month: 'Jan', revenue: 7.2, collections: 7.0, target: 7.5 },
  { month: 'Feb', revenue: 7.4, collections: 7.2, target: 7.5 },
  { month: 'Mar', revenue: 7.8, collections: 7.5, target: 7.8 },
  { month: 'Apr', revenue: 8.1, collections: 7.8, target: 8.0 },
  { month: 'May', revenue: 8.0, collections: 7.7, target: 8.0 },
  { month: 'Jun', revenue: 8.3, collections: 8.0, target: 8.2 },
  { month: 'Jul', revenue: 7.9, collections: 7.6, target: 8.2 },
  { month: 'Aug', revenue: 7.5, collections: 7.3, target: 8.0 },
  { month: 'Sep', revenue: 8.2, collections: 8.0, target: 8.3 },
  { month: 'Oct', revenue: 8.5, collections: 8.2, target: 8.4 },
  { month: 'Nov', revenue: 8.3, collections: 8.0, target: 8.4 },
  { month: 'Dec', revenue: 8.4, collections: 7.9, target: 8.5 },
];

// Expense breakdown for profitability waterfall
export const expenseBreakdown = [
  { name: 'Revenue', value: 8400000, fill: 'hsl(var(--chart-1))' },
  { name: 'Clinician Costs', value: -2940000, fill: 'hsl(var(--chart-4))' },
  { name: 'Staff Costs', value: -1260000, fill: 'hsl(var(--chart-4))' },
  { name: 'Lab & Materials', value: -840000, fill: 'hsl(var(--chart-4))' },
  { name: 'Overhead', value: -630000, fill: 'hsl(var(--chart-4))' },
  { name: 'EBITDA', value: 2730000, fill: 'hsl(var(--chart-2))' },
];

// Claims pipeline data
export const claimsPipeline = [
  { stage: 'Submitted', count: 245, value: 890000 },
  { stage: 'In Review', count: 128, value: 465000 },
  { stage: 'Approved', count: 1842, value: 6720000 },
  { stage: 'Denied', count: 89, value: 324000 },
];

// Denial reasons breakdown
export const denialReasons = [
  { reason: 'Missing Documentation', count: 34, percentage: 38 },
  { reason: 'Coding Error', count: 22, percentage: 25 },
  { reason: 'Pre-auth Required', count: 15, percentage: 17 },
  { reason: 'Non-covered Service', count: 10, percentage: 11 },
  { reason: 'Duplicate Claim', count: 8, percentage: 9 },
];

// Budget vs Actual data
export const budgetVsActual = [
  { category: 'Revenue', budget: 8800000, actual: 8400000, variance: -400000, variancePercent: -4.5 },
  { category: 'Clinician Costs', budget: 2900000, actual: 2940000, variance: -40000, variancePercent: -1.4 },
  { category: 'Staff Costs', budget: 1200000, actual: 1260000, variance: -60000, variancePercent: -5.0 },
  { category: 'Lab & Materials', budget: 800000, actual: 840000, variance: -40000, variancePercent: -5.0 },
  { category: 'Overhead', budget: 600000, actual: 630000, variance: -30000, variancePercent: -5.0 },
  { category: 'EBITDA', budget: 3300000, actual: 2730000, variance: -570000, variancePercent: -17.3 },
];
