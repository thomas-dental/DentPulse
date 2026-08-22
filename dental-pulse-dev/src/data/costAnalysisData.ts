// Cost Analysis Mock Data

export interface CostBreakdown {
  id: string;
  name: string;
  amount: number;
  percentOfRevenue: number;
  trend: number;
  benchmark: number;
}

export interface LocationCostImpact {
  locationId: string;
  locationName: string;
  cost: number;
  percentOfRevenue: number;
  costPerPatient: number;
  variance: number;
  status: 'success' | 'warning' | 'danger';
}

export interface MonthlyCostTrend {
  month: string;
  actual: number;
  budget: number;
  benchmark: number;
}

// Lab Fees Data
export const labFeesOverview = {
  totalCost: 2847000,
  percentOfRevenue: 8.2,
  trend: 3.4,
  benchmark: 7.5,
  costPerProcedure: 142,
  topCategories: [
    { name: 'Crowns & Bridges', amount: 892000, percent: 31.3 },
    { name: 'Dentures', amount: 654000, percent: 23.0 },
    { name: 'Implant Components', amount: 548000, percent: 19.2 },
    { name: 'Orthodontic Appliances', amount: 412000, percent: 14.5 },
    { name: 'Other Prosthetics', amount: 341000, percent: 12.0 },
  ],
};

export const labFeesLocationImpact: LocationCostImpact[] = [
  { locationId: '1', locationName: 'Downtown Seattle', cost: 245000, percentOfRevenue: 7.8, costPerPatient: 128, variance: -2.1, status: 'success' },
  { locationId: '2', locationName: 'Bellevue Square', cost: 198000, percentOfRevenue: 8.1, costPerPatient: 135, variance: 0.8, status: 'success' },
  { locationId: '3', locationName: 'Tacoma Central', cost: 287000, percentOfRevenue: 9.8, costPerPatient: 167, variance: 4.2, status: 'danger' },
  { locationId: '4', locationName: 'Kirkland', cost: 156000, percentOfRevenue: 7.2, costPerPatient: 118, variance: -3.8, status: 'success' },
  { locationId: '5', locationName: 'Redmond', cost: 312000, percentOfRevenue: 10.2, costPerPatient: 178, variance: 5.6, status: 'danger' },
  { locationId: '6', locationName: 'Everett', cost: 178000, percentOfRevenue: 8.4, costPerPatient: 142, variance: 1.2, status: 'warning' },
  { locationId: '7', locationName: 'Federal Way', cost: 203000, percentOfRevenue: 8.9, costPerPatient: 151, variance: 2.4, status: 'warning' },
  { locationId: '8', locationName: 'Olympia', cost: 189000, percentOfRevenue: 7.9, costPerPatient: 131, variance: -0.5, status: 'success' },
];

export const labFeesTrend: MonthlyCostTrend[] = [
  { month: 'Jul', actual: 215000, budget: 220000, benchmark: 210000 },
  { month: 'Aug', actual: 228000, budget: 225000, benchmark: 215000 },
  { month: 'Sep', actual: 242000, budget: 230000, benchmark: 220000 },
  { month: 'Oct', actual: 235000, budget: 235000, benchmark: 225000 },
  { month: 'Nov', actual: 251000, budget: 240000, benchmark: 230000 },
  { month: 'Dec', actual: 248000, budget: 245000, benchmark: 235000 },
];

export const labFeesImpactMetrics = [
  { metric: 'Impact on EBITDA', value: -847000, description: 'Reduces margin by 2.4%' },
  { metric: 'Cost per Crown', value: 285, description: 'vs £245 industry avg' },
  { metric: 'Turnaround Delays', value: 12, description: '% of cases delayed >5 days' },
  { metric: 'Remake Rate', value: 4.2, description: '% requiring redo work' },
];

// Staff Costs Data
export const staffCostsOverview = {
  totalCost: 14250000,
  percentOfRevenue: 41.2,
  trend: 2.1,
  benchmark: 38.0,
  categories: [
    { name: 'Dentist Compensation', amount: 6200000, percent: 43.5, trend: 1.8 },
    { name: 'Hygienist Wages', amount: 3150000, percent: 22.1, trend: 2.4 },
    { name: 'Front Office', amount: 1890000, percent: 13.3, trend: 3.2 },
    { name: 'Dental Assistants', amount: 1680000, percent: 11.8, trend: 1.5 },
    { name: 'Benefits & Taxes', amount: 1330000, percent: 9.3, trend: 4.1 },
  ],
};

export const staffCostsLocationImpact: LocationCostImpact[] = [
  { locationId: '1', locationName: 'Downtown Seattle', cost: 1245000, percentOfRevenue: 39.5, costPerPatient: 652, variance: -4.5, status: 'success' },
  { locationId: '2', locationName: 'Bellevue Square', cost: 1098000, percentOfRevenue: 44.8, costPerPatient: 748, variance: 3.2, status: 'warning' },
  { locationId: '3', locationName: 'Tacoma Central', cost: 987000, percentOfRevenue: 33.7, costPerPatient: 575, variance: -11.2, status: 'success' },
  { locationId: '4', locationName: 'Kirkland', cost: 1156000, percentOfRevenue: 53.2, costPerPatient: 874, variance: 12.0, status: 'danger' },
  { locationId: '5', locationName: 'Redmond', cost: 1312000, percentOfRevenue: 42.8, costPerPatient: 751, variance: 1.6, status: 'warning' },
  { locationId: '6', locationName: 'Everett', cost: 878000, percentOfRevenue: 41.4, costPerPatient: 702, variance: -0.2, status: 'success' },
  { locationId: '7', locationName: 'Federal Way', cost: 1023000, percentOfRevenue: 44.9, costPerPatient: 762, variance: 3.7, status: 'warning' },
  { locationId: '8', locationName: 'Olympia', cost: 989000, percentOfRevenue: 41.2, costPerPatient: 687, variance: 0.0, status: 'success' },
];

export const staffCostsTrend: MonthlyCostTrend[] = [
  { month: 'Jul', actual: 1125000, budget: 1150000, benchmark: 1100000 },
  { month: 'Aug', actual: 1178000, budget: 1160000, benchmark: 1110000 },
  { month: 'Sep', actual: 1195000, budget: 1170000, benchmark: 1120000 },
  { month: 'Oct', actual: 1210000, budget: 1180000, benchmark: 1130000 },
  { month: 'Nov', actual: 1242000, budget: 1190000, benchmark: 1140000 },
  { month: 'Dec', actual: 1258000, budget: 1200000, benchmark: 1150000 },
];

export const staffProductivityMetrics = [
  { role: 'Dentists', productionPerHour: 485, benchmark: 520, utilization: 78 },
  { role: 'Hygienists', productionPerHour: 165, benchmark: 175, utilization: 82 },
  { role: 'Assistants', patientsPerDay: 12, benchmark: 14, utilization: 85 },
  { role: 'Front Office', callsHandled: 48, benchmark: 55, utilization: 87 },
];

// Operating Leases Data
export const operatingLeasesOverview = {
  totalCost: 4680000,
  percentOfRevenue: 13.5,
  trend: 0.8,
  benchmark: 12.0,
  categories: [
    { name: 'Building Leases', amount: 3420000, percent: 73.1 },
    { name: 'Equipment Leases', amount: 756000, percent: 16.2 },
    { name: 'Vehicle Leases', amount: 312000, percent: 6.7 },
    { name: 'IT & Software', amount: 192000, percent: 4.1 },
  ],
};

export const operatingLeasesLocationImpact: LocationCostImpact[] = [
  { locationId: '1', locationName: 'Downtown Seattle', cost: 542000, percentOfRevenue: 17.2, costPerPatient: 284, variance: 4.3, status: 'danger' },
  { locationId: '2', locationName: 'Bellevue Square', cost: 498000, percentOfRevenue: 20.3, costPerPatient: 339, variance: 7.4, status: 'danger' },
  { locationId: '3', locationName: 'Tacoma Central', cost: 312000, percentOfRevenue: 10.7, costPerPatient: 182, variance: -4.2, status: 'success' },
  { locationId: '4', locationName: 'Kirkland', cost: 287000, percentOfRevenue: 13.2, costPerPatient: 217, variance: 0.3, status: 'success' },
  { locationId: '5', locationName: 'Redmond', cost: 378000, percentOfRevenue: 12.3, costPerPatient: 216, variance: -0.6, status: 'success' },
  { locationId: '6', locationName: 'Everett', cost: 245000, percentOfRevenue: 11.6, costPerPatient: 196, variance: -1.3, status: 'success' },
  { locationId: '7', locationName: 'Federal Way', cost: 298000, percentOfRevenue: 13.1, costPerPatient: 222, variance: 0.2, status: 'success' },
  { locationId: '8', locationName: 'Olympia', cost: 267000, percentOfRevenue: 11.1, costPerPatient: 185, variance: -1.8, status: 'success' },
];

export const operatingLeasesTrend: MonthlyCostTrend[] = [
  { month: 'Jul', actual: 385000, budget: 380000, benchmark: 365000 },
  { month: 'Aug', actual: 388000, budget: 382000, benchmark: 368000 },
  { month: 'Sep', actual: 392000, budget: 385000, benchmark: 370000 },
  { month: 'Oct', actual: 395000, budget: 388000, benchmark: 372000 },
  { month: 'Nov', actual: 398000, budget: 390000, benchmark: 375000 },
  { month: 'Dec', actual: 402000, budget: 392000, benchmark: 378000 },
];

export const leaseExpirations = [
  { location: 'Downtown Seattle', expiresIn: 8, monthlyRent: 28500, action: 'Renegotiate' },
  { location: 'Bellevue Square', expiresIn: 24, monthlyRent: 32000, action: 'Review options' },
  { location: 'Tacoma Central', expiresIn: 36, monthlyRent: 18500, action: 'No action' },
  { location: 'Kirkland', expiresIn: 6, monthlyRent: 19200, action: 'Urgent: Renew' },
  { location: 'Redmond', expiresIn: 18, monthlyRent: 24800, action: 'Market analysis' },
];

export const costImpactSummary = {
  labFees: {
    ebitdaImpact: -0.7,
    marginDrag: 'Lab fees 0.7% above benchmark, reducing EBITDA margin',
    topOpportunity: 'Consolidate vendors to negotiate 8-12% discount',
  },
  staffCosts: {
    ebitdaImpact: -3.2,
    marginDrag: 'Staff costs 3.2% above industry benchmark',
    topOpportunity: 'Improve hygienist utilization from 82% to 90%',
  },
  operatingLeases: {
    ebitdaImpact: -1.5,
    marginDrag: 'Occupancy costs 1.5% above target',
    topOpportunity: 'Renegotiate Downtown Seattle lease expiring in 8 months',
  },
};
