// Financial Reports Mock Data

export interface LineItem {
  id: string;
  name: string;
  currentPeriod: number;
  priorPeriod: number;
  budget: number;
  source: string;
  sourceLink: string;
  children?: LineItem[];
}

export interface FinancialSection {
  id: string;
  name: string;
  items: LineItem[];
  total: {
    currentPeriod: number;
    priorPeriod: number;
    budget: number;
  };
}

// Profit & Loss Data
export const profitAndLossData: FinancialSection[] = [
  {
    id: 'revenue',
    name: 'Revenue',
    items: [
      {
        id: 'clinical-revenue',
        name: 'Clinical Revenue',
        currentPeriod: 7250000,
        priorPeriod: 6890000,
        budget: 7100000,
        source: 'PMS Export',
        sourceLink: '/locations',
        children: [
          { id: 'general-dentistry', name: 'General Dentistry', currentPeriod: 3200000, priorPeriod: 3050000, budget: 3150000, source: 'Dentally', sourceLink: '/locations' },
          { id: 'orthodontics', name: 'Orthodontics', currentPeriod: 1850000, priorPeriod: 1720000, budget: 1800000, source: 'Dentally', sourceLink: '/locations' },
          { id: 'cosmetic', name: 'Cosmetic Procedures', currentPeriod: 1420000, priorPeriod: 1350000, budget: 1400000, source: 'Dentally', sourceLink: '/locations' },
          { id: 'hygiene', name: 'Hygiene Services', currentPeriod: 780000, priorPeriod: 770000, budget: 750000, source: 'Dentally', sourceLink: '/locations' },
        ]
      },
      {
        id: 'lab-fees',
        name: 'Lab Fee Revenue',
        currentPeriod: 420000,
        priorPeriod: 380000,
        budget: 400000,
        source: 'Lab Management',
        sourceLink: '/admin'
      },
      {
        id: 'other-revenue',
        name: 'Other Revenue',
        currentPeriod: 180000,
        priorPeriod: 165000,
        budget: 175000,
        source: 'Xero',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: 7850000, priorPeriod: 7435000, budget: 7675000 }
  },
  {
    id: 'direct-costs',
    name: 'Direct Costs',
    items: [
      {
        id: 'clinician-costs',
        name: 'Clinician Compensation',
        currentPeriod: 2120000,
        priorPeriod: 1980000,
        budget: 2050000,
        source: 'Payroll System',
        sourceLink: '/admin',
        children: [
          { id: 'dentist-salaries', name: 'Dentist Salaries', currentPeriod: 1450000, priorPeriod: 1350000, budget: 1400000, source: 'Payroll', sourceLink: '/admin' },
          { id: 'hygienist-salaries', name: 'Hygienist Salaries', currentPeriod: 420000, priorPeriod: 400000, budget: 410000, source: 'Payroll', sourceLink: '/admin' },
          { id: 'clinician-benefits', name: 'Benefits & Pension', currentPeriod: 250000, priorPeriod: 230000, budget: 240000, source: 'Payroll', sourceLink: '/admin' },
        ]
      },
      {
        id: 'lab-costs',
        name: 'Lab & Materials',
        currentPeriod: 680000,
        priorPeriod: 620000,
        budget: 650000,
        source: 'Procurement',
        sourceLink: '/admin'
      },
      {
        id: 'consumables',
        name: 'Clinical Consumables',
        currentPeriod: 340000,
        priorPeriod: 310000,
        budget: 325000,
        source: 'Inventory System',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: 3140000, priorPeriod: 2910000, budget: 3025000 }
  },
  {
    id: 'operating-expenses',
    name: 'Operating Expenses',
    items: [
      {
        id: 'staff-costs',
        name: 'Support Staff',
        currentPeriod: 890000,
        priorPeriod: 850000,
        budget: 875000,
        source: 'Payroll System',
        sourceLink: '/admin',
        children: [
          { id: 'reception', name: 'Reception & Admin', currentPeriod: 480000, priorPeriod: 460000, budget: 470000, source: 'Payroll', sourceLink: '/admin' },
          { id: 'practice-managers', name: 'Practice Managers', currentPeriod: 280000, priorPeriod: 270000, budget: 275000, source: 'Payroll', sourceLink: '/admin' },
          { id: 'support-benefits', name: 'Benefits & Training', currentPeriod: 130000, priorPeriod: 120000, budget: 130000, source: 'Payroll', sourceLink: '/admin' },
        ]
      },
      {
        id: 'occupancy',
        name: 'Occupancy Costs',
        currentPeriod: 720000,
        priorPeriod: 700000,
        budget: 710000,
        source: 'Property Management',
        sourceLink: '/admin',
        children: [
          { id: 'rent', name: 'Rent & Rates', currentPeriod: 520000, priorPeriod: 505000, budget: 515000, source: 'Xero', sourceLink: '/admin' },
          { id: 'utilities', name: 'Utilities', currentPeriod: 120000, priorPeriod: 115000, budget: 115000, source: 'Xero', sourceLink: '/admin' },
          { id: 'maintenance', name: 'Maintenance', currentPeriod: 80000, priorPeriod: 80000, budget: 80000, source: 'Xero', sourceLink: '/admin' },
        ]
      },
      {
        id: 'marketing',
        name: 'Marketing & Acquisition',
        currentPeriod: 280000,
        priorPeriod: 250000,
        budget: 300000,
        source: 'Marketing Platform',
        sourceLink: '/admin'
      },
      {
        id: 'technology',
        name: 'Technology & Systems',
        currentPeriod: 185000,
        priorPeriod: 170000,
        budget: 180000,
        source: 'IT Management',
        sourceLink: '/admin'
      },
      {
        id: 'professional-fees',
        name: 'Professional Fees',
        currentPeriod: 145000,
        priorPeriod: 140000,
        budget: 150000,
        source: 'Xero',
        sourceLink: '/admin'
      },
      {
        id: 'insurance',
        name: 'Insurance',
        currentPeriod: 95000,
        priorPeriod: 90000,
        budget: 92000,
        source: 'Xero',
        sourceLink: '/admin'
      },
      {
        id: 'other-opex',
        name: 'Other Operating Expenses',
        currentPeriod: 120000,
        priorPeriod: 110000,
        budget: 115000,
        source: 'Xero',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: 2435000, priorPeriod: 2310000, budget: 2422000 }
  },
];

// Balance Sheet Data — section order matches Xero account-type layout
// (Current Assets → Bank → Fixed Assets → Non-current Assets → Liabilities → Equity)
export const balanceSheetData: FinancialSection[] = [
  {
    id: 'fixed-assets',
    name: 'Fixed Assets',
    items: [
      {
        id: 'equipment',
        name: 'Dental Equipment',
        currentPeriod: 4200000,
        priorPeriod: 3850000,
        budget: 4100000,
        source: 'Asset Register',
        sourceLink: '/admin',
        children: [
          { id: 'chairs-units', name: 'Chairs & Units', currentPeriod: 2400000, priorPeriod: 2200000, budget: 2350000, source: 'Asset Register', sourceLink: '/admin' },
          { id: 'imaging', name: 'Imaging Equipment', currentPeriod: 1200000, priorPeriod: 1100000, budget: 1150000, source: 'Asset Register', sourceLink: '/admin' },
          { id: 'other-equipment', name: 'Other Equipment', currentPeriod: 600000, priorPeriod: 550000, budget: 600000, source: 'Asset Register', sourceLink: '/admin' },
        ]
      },
      {
        id: 'leasehold',
        name: 'Leasehold Improvements',
        currentPeriod: 2100000,
        priorPeriod: 2000000,
        budget: 2050000,
        source: 'Asset Register',
        sourceLink: '/admin'
      },
      {
        id: 'it-assets',
        name: 'IT & Software',
        currentPeriod: 380000,
        priorPeriod: 350000,
        budget: 370000,
        source: 'IT Asset Register',
        sourceLink: '/admin'
      },
      {
        id: 'accumulated-dep',
        name: 'Accumulated Depreciation',
        currentPeriod: -1850000,
        priorPeriod: -1650000,
        budget: -1750000,
        source: 'Asset Register',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: 4830000, priorPeriod: 4550000, budget: 4770000 }
  },
  {
    id: 'current-assets',
    name: 'Current Assets',
    items: [
      {
        id: 'cash',
        name: 'Cash & Cash Equivalents',
        currentPeriod: 2850000,
        priorPeriod: 2420000,
        budget: 2600000,
        source: 'Bank Feeds',
        sourceLink: '/cashflow/preparing-statement',
        children: [
          { id: 'operating-accounts', name: 'Operating Accounts', currentPeriod: 1950000, priorPeriod: 1680000, budget: 1800000, source: 'Barclays', sourceLink: '/cashflow/preparing-statement' },
          { id: 'savings', name: 'Savings & Reserves', currentPeriod: 800000, priorPeriod: 650000, budget: 700000, source: 'Barclays', sourceLink: '/cashflow/preparing-statement' },
          { id: 'petty-cash', name: 'Petty Cash', currentPeriod: 100000, priorPeriod: 90000, budget: 100000, source: 'Manual', sourceLink: '/cashflow/preparing-statement' },
        ]
      },
      {
        id: 'accounts-receivable',
        name: 'Accounts Receivable',
        currentPeriod: 1680000,
        priorPeriod: 1520000,
        budget: 1450000,
        source: 'AR System',
        sourceLink: '/cashflow/preparing-statement',
        children: [
          { id: 'patient-ar', name: 'Patient Receivables', currentPeriod: 620000, priorPeriod: 560000, budget: 550000, source: 'Dentally', sourceLink: '/cashflow/preparing-statement' },
          { id: 'insurance-ar', name: 'Insurance Receivables', currentPeriod: 980000, priorPeriod: 880000, budget: 820000, source: 'Claims System', sourceLink: '/claims' },
          { id: 'other-ar', name: 'Other Receivables', currentPeriod: 80000, priorPeriod: 80000, budget: 80000, source: 'Xero', sourceLink: '/cashflow/preparing-statement' },
        ]
      },
      {
        id: 'inventory',
        name: 'Inventory',
        currentPeriod: 420000,
        priorPeriod: 380000,
        budget: 400000,
        source: 'Inventory System',
        sourceLink: '/admin'
      },
      {
        id: 'prepaid',
        name: 'Prepaid Expenses',
        currentPeriod: 185000,
        priorPeriod: 170000,
        budget: 175000,
        source: 'Xero',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: 5135000, priorPeriod: 4490000, budget: 4625000 }
  },
  {
    id: 'current-liabilities',
    name: 'Current Liabilities',
    items: [
      {
        id: 'accounts-payable',
        name: 'Accounts Payable',
        currentPeriod: 890000,
        priorPeriod: 820000,
        budget: 850000,
        source: 'AP System',
        sourceLink: '/admin',
        children: [
          { id: 'supplier-payables', name: 'Supplier Payables', currentPeriod: 520000, priorPeriod: 480000, budget: 500000, source: 'Xero', sourceLink: '/admin' },
          { id: 'lab-payables', name: 'Lab Payables', currentPeriod: 280000, priorPeriod: 260000, budget: 270000, source: 'Xero', sourceLink: '/admin' },
          { id: 'other-payables', name: 'Other Payables', currentPeriod: 90000, priorPeriod: 80000, budget: 80000, source: 'Xero', sourceLink: '/admin' },
        ]
      },
      {
        id: 'accrued-expenses',
        name: 'Accrued Expenses',
        currentPeriod: 420000,
        priorPeriod: 380000,
        budget: 400000,
        source: 'Xero',
        sourceLink: '/admin'
      },
      {
        id: 'deferred-revenue',
        name: 'Deferred Revenue',
        currentPeriod: 680000,
        priorPeriod: 620000,
        budget: 650000,
        source: 'PMS',
        sourceLink: '/locations'
      },
      {
        id: 'current-debt',
        name: 'Current Portion of Debt',
        currentPeriod: 450000,
        priorPeriod: 450000,
        budget: 450000,
        source: 'Loan Schedule',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: 2440000, priorPeriod: 2270000, budget: 2350000 }
  },
  {
    id: 'long-term-liabilities',
    name: 'Long-Term Liabilities',
    items: [
      {
        id: 'term-loans',
        name: 'Term Loans',
        currentPeriod: 3200000,
        priorPeriod: 3500000,
        budget: 3300000,
        source: 'Loan Schedule',
        sourceLink: '/admin'
      },
      {
        id: 'lease-liabilities',
        name: 'Lease Liabilities',
        currentPeriod: 1850000,
        priorPeriod: 1950000,
        budget: 1900000,
        source: 'Lease Schedule',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: 5050000, priorPeriod: 5450000, budget: 5200000 }
  },
];

// Cash Flow Data
export const cashFlowData: FinancialSection[] = [
  {
    id: 'operating-activities',
    name: 'Operating Activities',
    items: [
      {
        id: 'net-income',
        name: 'Net Income',
        currentPeriod: 1890000,
        priorPeriod: 1720000,
        budget: 1850000,
        source: 'P&L',
        sourceLink: '/reports'
      },
      {
        id: 'depreciation',
        name: 'Depreciation & Amortization',
        currentPeriod: 200000,
        priorPeriod: 185000,
        budget: 195000,
        source: 'Asset Register',
        sourceLink: '/admin'
      },
      {
        id: 'ar-change',
        name: 'Change in Accounts Receivable',
        currentPeriod: -160000,
        priorPeriod: -120000,
        budget: -100000,
        source: 'AR System',
        sourceLink: '/cashflow/preparing-statement'
      },
      {
        id: 'inventory-change',
        name: 'Change in Inventory',
        currentPeriod: -40000,
        priorPeriod: -30000,
        budget: -25000,
        source: 'Inventory System',
        sourceLink: '/admin'
      },
      {
        id: 'ap-change',
        name: 'Change in Accounts Payable',
        currentPeriod: 70000,
        priorPeriod: 50000,
        budget: 60000,
        source: 'AP System',
        sourceLink: '/admin'
      },
      {
        id: 'deferred-rev-change',
        name: 'Change in Deferred Revenue',
        currentPeriod: 60000,
        priorPeriod: 45000,
        budget: 50000,
        source: 'PMS',
        sourceLink: '/locations'
      },
    ],
    total: { currentPeriod: 2020000, priorPeriod: 1850000, budget: 2030000 }
  },
  {
    id: 'investing-activities',
    name: 'Investing Activities',
    items: [
      {
        id: 'equipment-purchases',
        name: 'Equipment Purchases',
        currentPeriod: -480000,
        priorPeriod: -420000,
        budget: -450000,
        source: 'Asset Register',
        sourceLink: '/admin',
        children: [
          { id: 'dental-equipment', name: 'Dental Equipment', currentPeriod: -350000, priorPeriod: -300000, budget: -320000, source: 'Asset Register', sourceLink: '/admin' },
          { id: 'it-equipment', name: 'IT Equipment', currentPeriod: -80000, priorPeriod: -70000, budget: -80000, source: 'IT Assets', sourceLink: '/admin' },
          { id: 'other-capex', name: 'Other CapEx', currentPeriod: -50000, priorPeriod: -50000, budget: -50000, source: 'Asset Register', sourceLink: '/admin' },
        ]
      },
      {
        id: 'leasehold-improvements',
        name: 'Leasehold Improvements',
        currentPeriod: -150000,
        priorPeriod: -180000,
        budget: -200000,
        source: 'Project Costs',
        sourceLink: '/admin'
      },
      {
        id: 'acquisition-costs',
        name: 'Practice Acquisition Costs',
        currentPeriod: -320000,
        priorPeriod: -850000,
        budget: -400000,
        source: 'M&A',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: -950000, priorPeriod: -1450000, budget: -1050000 }
  },
  {
    id: 'financing-activities',
    name: 'Financing Activities',
    items: [
      {
        id: 'debt-repayment',
        name: 'Debt Repayments',
        currentPeriod: -400000,
        priorPeriod: -380000,
        budget: -400000,
        source: 'Loan Schedule',
        sourceLink: '/admin'
      },
      {
        id: 'new-borrowings',
        name: 'New Borrowings',
        currentPeriod: 0,
        priorPeriod: 500000,
        budget: 0,
        source: 'Loan Schedule',
        sourceLink: '/admin'
      },
      {
        id: 'lease-payments',
        name: 'Lease Payments',
        currentPeriod: -180000,
        priorPeriod: -170000,
        budget: -175000,
        source: 'Lease Schedule',
        sourceLink: '/admin'
      },
      {
        id: 'dividends',
        name: 'Dividends Paid',
        currentPeriod: -350000,
        priorPeriod: -300000,
        budget: -350000,
        source: 'Board Minutes',
        sourceLink: '/admin'
      },
    ],
    total: { currentPeriod: -930000, priorPeriod: -350000, budget: -925000 }
  },
];

// Summary calculations
export const getPLSummary = () => {
  const revenue = profitAndLossData.find(s => s.id === 'revenue')!.total;
  const directCosts = profitAndLossData.find(s => s.id === 'direct-costs')!.total;
  const opex = profitAndLossData.find(s => s.id === 'operating-expenses')!.total;
  
  return {
    revenue,
    grossProfit: {
      currentPeriod: revenue.currentPeriod - directCosts.currentPeriod,
      priorPeriod: revenue.priorPeriod - directCosts.priorPeriod,
      budget: revenue.budget - directCosts.budget,
    },
    ebitda: {
      currentPeriod: revenue.currentPeriod - directCosts.currentPeriod - opex.currentPeriod,
      priorPeriod: revenue.priorPeriod - directCosts.priorPeriod - opex.priorPeriod,
      budget: revenue.budget - directCosts.budget - opex.budget,
    },
    grossMargin: {
      currentPeriod: ((revenue.currentPeriod - directCosts.currentPeriod) / revenue.currentPeriod) * 100,
      priorPeriod: ((revenue.priorPeriod - directCosts.priorPeriod) / revenue.priorPeriod) * 100,
      budget: ((revenue.budget - directCosts.budget) / revenue.budget) * 100,
    },
    ebitdaMargin: {
      currentPeriod: ((revenue.currentPeriod - directCosts.currentPeriod - opex.currentPeriod) / revenue.currentPeriod) * 100,
      priorPeriod: ((revenue.priorPeriod - directCosts.priorPeriod - opex.priorPeriod) / revenue.priorPeriod) * 100,
      budget: ((revenue.budget - directCosts.budget - opex.budget) / revenue.budget) * 100,
    },
  };
};

export const getBalanceSheetSummary = () => {
  const currentAssets = balanceSheetData.find(s => s.id === 'current-assets')!.total;
  const fixedAssets = balanceSheetData.find(s => s.id === 'fixed-assets')!.total;
  const currentLiabilities = balanceSheetData.find(s => s.id === 'current-liabilities')!.total;
  const longTermLiabilities = balanceSheetData.find(s => s.id === 'long-term-liabilities')!.total;
  
  return {
    totalAssets: {
      currentPeriod: currentAssets.currentPeriod + fixedAssets.currentPeriod,
      priorPeriod: currentAssets.priorPeriod + fixedAssets.priorPeriod,
      budget: currentAssets.budget + fixedAssets.budget,
    },
    totalLiabilities: {
      currentPeriod: currentLiabilities.currentPeriod + longTermLiabilities.currentPeriod,
      priorPeriod: currentLiabilities.priorPeriod + longTermLiabilities.priorPeriod,
      budget: currentLiabilities.budget + longTermLiabilities.budget,
    },
    equity: {
      currentPeriod: (currentAssets.currentPeriod + fixedAssets.currentPeriod) - (currentLiabilities.currentPeriod + longTermLiabilities.currentPeriod),
      priorPeriod: (currentAssets.priorPeriod + fixedAssets.priorPeriod) - (currentLiabilities.priorPeriod + longTermLiabilities.priorPeriod),
      budget: (currentAssets.budget + fixedAssets.budget) - (currentLiabilities.budget + longTermLiabilities.budget),
    },
    workingCapital: {
      currentPeriod: currentAssets.currentPeriod - currentLiabilities.currentPeriod,
      priorPeriod: currentAssets.priorPeriod - currentLiabilities.priorPeriod,
      budget: currentAssets.budget - currentLiabilities.budget,
    },
    currentRatio: {
      currentPeriod: currentAssets.currentPeriod / currentLiabilities.currentPeriod,
      priorPeriod: currentAssets.priorPeriod / currentLiabilities.priorPeriod,
      budget: currentAssets.budget / currentLiabilities.budget,
    },
  };
};

export const getCashFlowSummary = () => {
  const operating = cashFlowData.find(s => s.id === 'operating-activities')!.total;
  const investing = cashFlowData.find(s => s.id === 'investing-activities')!.total;
  const financing = cashFlowData.find(s => s.id === 'financing-activities')!.total;
  
  return {
    operatingCashFlow: operating,
    investingCashFlow: investing,
    financingCashFlow: financing,
    netCashFlow: {
      currentPeriod: operating.currentPeriod + investing.currentPeriod + financing.currentPeriod,
      priorPeriod: operating.priorPeriod + investing.priorPeriod + financing.priorPeriod,
      budget: operating.budget + investing.budget + financing.budget,
    },
    freeCashFlow: {
      currentPeriod: operating.currentPeriod + investing.currentPeriod,
      priorPeriod: operating.priorPeriod + investing.priorPeriod,
      budget: operating.budget + investing.budget,
    },
  };
};
