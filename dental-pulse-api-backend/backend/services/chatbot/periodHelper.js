/**
 * Resolves period labels (Q1, This Month, Last Year, etc.) to date ranges.
 * UK dental financial year: April 1 – March 31
 * Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar
 */

const FY_START_MONTH = 3; // April (0-indexed: 0=Jan, 1=Feb, 2=Mar, 3=Apr)

function getToday() {
  return formatDate(new Date());
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Human-readable: "Apr 1, 2025"
function formatDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Get the financial year start for a given date.
 * FY 2025/26 starts April 1, 2025.
 * If current date is Jan-Mar, the FY started previous calendar year.
 */
function getFYStart(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = d.getMonth();
  // If before April, FY started last calendar year
  const fyStartYear = month < FY_START_MONTH ? year - 1 : year;
  return new Date(fyStartYear, FY_START_MONTH, 1);
}

function getFYEnd(fyStart) {
  return new Date(fyStart.getFullYear() + 1, FY_START_MONTH, 0); // March 31 of next year
}

function getFYLabel(fyStart) {
  return `FY ${fyStart.getFullYear()}/${(fyStart.getFullYear() + 1).toString().slice(-2)}`;
}

function resolveperiodLabel(label) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const normalized = (label || '').toLowerCase().trim();

  // Financial Year Quarters (UK: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar)
  const fyStart = getFYStart(now);
  const fyYear = fyStart.getFullYear();

  if (normalized === 'q1') {
    return { from: `${fyYear}-04-01`, to: `${fyYear}-06-30`, label: `Q1 FY${fyYear}/${(fyYear + 1).toString().slice(-2)}` };
  }
  if (normalized === 'q2') {
    return { from: `${fyYear}-07-01`, to: `${fyYear}-09-30`, label: `Q2 FY${fyYear}/${(fyYear + 1).toString().slice(-2)}` };
  }
  if (normalized === 'q3') {
    return { from: `${fyYear}-10-01`, to: `${fyYear}-12-31`, label: `Q3 FY${fyYear}/${(fyYear + 1).toString().slice(-2)}` };
  }
  if (normalized === 'q4') {
    return { from: `${fyYear + 1}-01-01`, to: `${fyYear + 1}-03-31`, label: `Q4 FY${fyYear}/${(fyYear + 1).toString().slice(-2)}` };
  }

  // This/Last Month
  if (normalized === 'this month') {
    const start = new Date(year, month, 1);
    return { from: formatDate(start), to: getToday(), label: 'This Month' };
  }
  if (normalized === 'last month') {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { from: formatDate(start), to: formatDate(end), label: 'Last Month' };
  }

  // This/Last Quarter (financial quarters)
  if (normalized === 'this quarter') {
    // Find which FY quarter we're in
    const fyMonthOffset = (month - FY_START_MONTH + 12) % 12;
    const qIndex = Math.floor(fyMonthOffset / 3);
    const qStartMonth = FY_START_MONTH + (qIndex * 3);
    const qStartYear = qStartMonth > 11 ? year + 1 : (month < FY_START_MONTH ? year - 1 : year);
    const actualMonth = qStartMonth % 12;
    const start = new Date(qStartYear + Math.floor(qStartMonth / 12), actualMonth, 1);
    return { from: formatDate(start), to: getToday(), label: 'This Quarter' };
  }
  if (normalized === 'last quarter') {
    const fyMonthOffset = (month - FY_START_MONTH + 12) % 12;
    const qIndex = Math.floor(fyMonthOffset / 3) - 1;
    const prevQStart = FY_START_MONTH + (((qIndex + 4) % 4) * 3);
    // Simplified: go back 3 months from current quarter start
    const currQStart = FY_START_MONTH + (Math.floor(fyMonthOffset / 3) * 3);
    const start = new Date(year, currQStart - 3, 1);
    const end = new Date(year, currQStart, 0);
    return { from: formatDate(start), to: formatDate(end), label: 'Last Quarter' };
  }

  // This Year / YTD (financial year: April to today)
  if (normalized === 'this year' || normalized === 'ytd' || normalized === 'this financial year') {
    const fy = getFYStart(now);
    return { from: formatDate(fy), to: getToday(), label: getFYLabel(fy) + ' YTD' };
  }

  // Last Year (previous full financial year: April to March)
  if (normalized === 'last year' || normalized === 'last financial year') {
    const currentFY = getFYStart(now);
    const prevFYStart = new Date(currentFY.getFullYear() - 1, FY_START_MONTH, 1);
    const prevFYEnd = new Date(currentFY.getFullYear(), FY_START_MONTH, 0); // March 31
    return { from: formatDate(prevFYStart), to: formatDate(prevFYEnd), label: getFYLabel(prevFYStart) };
  }

  // Last N days
  const daysMatch = normalized.match(/^last (\d+) days?$/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return { from: formatDate(start), to: getToday(), label: `Last ${days} Days` };
  }

  // Last week
  if (normalized === 'last week' || normalized === 'last 7 days') {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return { from: formatDate(start), to: getToday(), label: 'Last 7 Days' };
  }

  return null;
}

const KNOWN_PERIOD_TOKENS = [
  'q1', 'q2', 'q3', 'q4',
  'this month', 'last month',
  'this quarter', 'last quarter',
  'this year', 'last year', 'ytd',
  'this financial year', 'last financial year',
  'last 7 days', 'last 30 days', 'last 90 days',
  'last week',
];

function isperiodToken(text) {
  return KNOWN_PERIOD_TOKENS.includes((text || '').toLowerCase().trim());
}

function getYearAgo(periodInfo) {
  if (!periodInfo) return null;
  const fromDate = new Date(periodInfo.from);
  const toDate = new Date(periodInfo.to);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  toDate.setFullYear(toDate.getFullYear() - 1);
  return {
    from: formatDate(fromDate),
    to: formatDate(toDate),
    label: `${periodInfo.label} (Year Ago)`,
  };
}

function getDefaultPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: formatDate(start), to: getToday(), label: 'This Month' };
}

module.exports = {
  resolveperiodLabel,
  isperiodToken,
  getYearAgo,
  getDefaultPeriod,
  getToday,
  formatDateDisplay,
  getFYStart,
  getFYLabel,
  FY_START_MONTH,
  KNOWN_PERIOD_TOKENS,
};
