import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CashflowReportVM } from '@/data/preparingCashflowStatementData';
import { CASHFLOW_TOTAL_COLUMN } from '@/utils/cashflowReportTotals';
import { cn } from '@/lib/utils';

function isTotalColumn(column: string): boolean {
  return column === CASHFLOW_TOTAL_COLUMN;
}

function totalColumnHeaderClass(column: string, currentMonthLabel: string): string {
  if (isTotalColumn(column)) {
    return 'bg-[#3d36a8] font-semibold border-l border-white/25';
  }
  if (column === currentMonthLabel) {
    return 'bg-[#E9E8F7] text-[#4e45be]';
  }
  return '';
}

function totalColumnCellClass(column: string, currentMonthLabel: string, extra?: string): string {
  if (isTotalColumn(column)) {
    return cn('font-semibold bg-muted/15 border-l border-border/60', extra);
  }
  if (column === currentMonthLabel) {
    return cn('bg-[#E9E8F7]/60', extra);
  }
  return cn(extra);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABEL_COL_PX = 220;
const MONTH_COL_PX = 154;
const Y_AXIS_WIDTH = 72;
const CHART_HEIGHT = 340;
const LABEL_COL_WIDTH = 'w-[220px] min-w-[220px] max-w-[220px]';
const MONTH_COL_WIDTH = 'w-[154px] min-w-[154px] max-w-[154px]';
/** Opaque sticky first column so scrolled month values never show through labels. */
const STICKY_LABEL =
  'sticky left-0 z-20 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.12)]';

// Validated categorical palette (see dataviz palette validator) — passes CVD/contrast checks.
const CHART_COLORS = {
  received: '#008300',
  paid: '#e34948',
  netCashflow: '#2a78d6',
  closingBalance: '#eb6834',
};

function CashflowChartTooltip({
  active,
  payload,
  label,
  formatCurrency,
  currencySymbol,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  formatCurrency: (value: number, symbol?: string) => string;
  currencySymbol?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-foreground mb-1.5">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">
              {formatCurrency(Number(entry.value ?? 0), currencySymbol)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function isRedundantCategoryCodeHeader(header: string): boolean {
  const t = header.trim();
  if (!t) return true;
  return /^[A-Z]{2,4}$/.test(t);
}

function statementSectionSpacerRow(key: string, columnCount: number) {
  return (
    <TableRow
      key={key}
      aria-hidden
      className="bg-transparent hover:bg-transparent border-0 pointer-events-none"
    >
      <TableCell className={cn('p-0 h-4 min-h-4 border-0 bg-card', STICKY_LABEL)} />
      {Array.from({ length: columnCount }, (_, ci) => (
        <TableCell key={ci} className="p-0 h-4 min-h-4 border-0 bg-transparent" />
      ))}
    </TableRow>
  );
}

export type CashflowDrilldownParams = {
  rangeGroup: string;
  rangeSubGroup: string;
  categoryName: string;
  locationId: string;
  locationName: string;
  monthLabel: string;
};

interface CashflowStatementMergedTableProps {
  report: CashflowReportVM;
  chartData: Array<Record<string, string | number>>;
  formatCurrency: (value: number, symbol?: string) => string;
  openSections: Record<number, boolean>;
  onToggleSection: (index: number) => void;
  onCategoryDrilldown: (params: CashflowDrilldownParams) => void;
}

export function CashflowStatementMergedTable({
  report,
  chartData,
  formatCurrency,
  openSections,
  onToggleSection,
  onCategoryDrilldown,
}: CashflowStatementMergedTableProps) {
  const [activeGroupIndex, setActiveGroupIndex] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  const handleColumnMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-col-idx]');
    if (!cell) return;
    const idx = Number(cell.dataset.colIdx);
    if (!Number.isNaN(idx)) setHoveredCol(idx);
  };
  const handleColumnMouseLeave = () => setHoveredCol(null);

  const colHoverStyle = (ci: number): React.CSSProperties | undefined =>
    hoveredCol === ci ? { backgroundColor: 'hsl(var(--muted) / 0.5)' } : undefined;
  const colHoverHeaderStyle = (ci: number): React.CSSProperties | undefined =>
    hoveredCol === ci ? { backgroundColor: 'rgba(255,255,255,0.15)' } : undefined;

  const currentMonthLabel = useMemo(() => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    return `${MONTH_NAMES[now.getMonth()]}-${yy}`;
  }, []);

  const focusGroup = (groupIndex: number) => {
    setActiveGroupIndex(groupIndex);
    const el = document.getElementById(`cashflow-group-${groupIndex}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const colCount = report.columns.length;
  const chartColCount = chartData.length;
  const totalOnlyColCount = Math.max(0, colCount - chartColCount);
  const plotWidth = colCount * MONTH_COL_PX;
  const chartPlotWidth = Math.max(chartColCount, 1) * MONTH_COL_PX;
  const tableWidth = LABEL_COL_PX + plotWidth;
  const chartMargin = { top: 8, right: 12, left: 0, bottom: 28 };

  const yDomain = useMemo((): [number, number] => {
    if (!chartData.length) return [0, 1];
    const values = chartData.flatMap((row) => [
      Number(row['Total Received'] ?? 0),
      Number(row['Total Paid'] ?? 0),
      Number(row['Net Cashflow'] ?? 0),
      Number(row['Closing Balance'] ?? 0),
    ]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.08 || 1;
    return [min - pad, max + pad];
  }, [chartData]);

  return (
    <div
      className="overflow-x-auto"
      id="CashflowStatement"
      onMouseOver={handleColumnMouseOver}
      onMouseLeave={handleColumnMouseLeave}
    >
      <Table
        className="border-collapse table-fixed"
        style={{ width: tableWidth }}
      >
        <colgroup>
          <col style={{ width: LABEL_COL_PX }} />
          {report.columns.map((col) => (
            <col key={col} style={{ width: MONTH_COL_PX }} />
          ))}
        </colgroup>
        <TableHeader>
          {/* Chart row — fixed plot width per month column; Y-axis in sticky label column */}
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead
              className={cn(LABEL_COL_WIDTH, STICKY_LABEL, 'z-30 border-0 p-0 bg-card align-bottom')}
            >
              <div style={{ width: LABEL_COL_PX, height: CHART_HEIGHT }}>
                <ComposedChart
                  width={LABEL_COL_PX}
                  height={CHART_HEIGHT}
                  data={chartData}
                  margin={{ top: chartMargin.top, right: 4, left: 0, bottom: chartMargin.bottom }}
                >
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => formatCurrency(Number(v), report.currencySymbol)}
                    width={Y_AXIS_WIDTH}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Line dataKey="Closing Balance" stroke="transparent" dot={false} activeDot={false} />
                </ComposedChart>
              </div>
            </TableHead>
            <TableHead
              colSpan={Math.max(chartColCount, 1)}
              className="border-0 p-0 bg-card"
              style={{ width: chartPlotWidth }}
            >
              <div
                className="chart-wrapper"
                style={{ width: chartPlotWidth, height: CHART_HEIGHT }}
              >
                <ComposedChart
                  width={chartPlotWidth}
                  height={CHART_HEIGHT}
                  data={chartData}
                  margin={chartMargin}
                  barCategoryGap="40%"
                  barGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/60" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={false}
                    axisLine={false}
                    tickLine={false}
                    height={1}
                  />
                  <YAxis hide domain={yDomain} width={0} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                    content={
                      <CashflowChartTooltip
                        formatCurrency={formatCurrency}
                        currencySymbol={report.currencySymbol}
                      />
                    }
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                    iconSize={10}
                    iconType="circle"
                  />
                  <Bar dataKey="Total Received" fill={CHART_COLORS.received} name="Total Received" radius={[4, 4, 0, 0]} maxBarSize={10} />
                  <Bar dataKey="Total Paid" fill={CHART_COLORS.paid} name="Total Paid" radius={[4, 4, 0, 0]} maxBarSize={10} />
                  <Bar dataKey="Net Cashflow" fill={CHART_COLORS.netCashflow} name="Net Cashflow" radius={[4, 4, 0, 0]} maxBarSize={10} />
                  <Line
                    type="monotone"
                    dataKey="Closing Balance"
                    stroke={CHART_COLORS.closingBalance}
                    strokeWidth={2}
                    dot={{ r: 3, fill: CHART_COLORS.closingBalance }}
                    activeDot={{ r: 5, fill: CHART_COLORS.closingBalance, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                    name="Closing Balance"
                  />
                </ComposedChart>
              </div>
            </TableHead>
            {totalOnlyColCount > 0 && (
              <TableHead
                colSpan={totalOnlyColCount}
                className="border-0 p-0 bg-card"
                style={{ width: totalOnlyColCount * MONTH_COL_PX }}
              />
            )}
          </TableRow>

          {/* Month header row — purple bar aligned with chart columns */}
          <TableRow className="bg-[#4e45be] hover:bg-[#4e45be] border-0">
            <TableHead
              className={cn(
                LABEL_COL_WIDTH,
                'sticky left-0 z-30 bg-[#4e45be] text-white font-medium border-0 h-10 shadow-[2px_0_6px_-2px_rgba(0,0,0,0.2)]'
              )}
            />
            {report.columns.map((col, ci) => (
              <TableHead
                key={col}
                data-col-idx={ci}
                style={colHoverHeaderStyle(ci)}
                className={cn(
                  MONTH_COL_WIDTH,
                  'text-center text-white font-medium border-0 h-10 px-2',
                  totalColumnHeaderClass(col, currentMonthLabel)
                )}
              >
                {col}
              </TableHead>
            ))}
          </TableRow>

          {/* Activity section pills */}
          {report.tableGroupDataSet.length > 0 && (
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead
                colSpan={colCount + 1}
                className="border-0 bg-card p-3 font-normal"
              >
                <div className="flex flex-wrap gap-2">
                  {report.tableGroupDataSet.map((group, groupIndex) => {
                    const isUncategorized = group.type === 'UNCATEGORIZED';
                    return (
                    <button
                      key={group.type}
                      type="button"
                      onClick={() => focusGroup(groupIndex)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors',
                        activeGroupIndex === groupIndex
                          ? isUncategorized
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-[#4e45be] bg-[#4e45be] text-white'
                          : isUncategorized
                            ? 'border-amber-500/50 bg-amber-50 text-amber-800 hover:border-amber-600 hover:bg-amber-100'
                            : 'border-[#4e45be]/40 bg-white text-[#4e45be] hover:border-[#4e45be] hover:bg-[#4e45be]/5'
                      )}
                    >
                      {isUncategorized ? 'Uncategorized' : group.type}
                    </button>
                    );
                  })}
                </div>
              </TableHead>
            </TableRow>
          )}
        </TableHeader>

        <TableBody>
          {report.tableGroupDataSet.map((group, groupIndex) => {
            const isUncategorized = group.type === 'UNCATEGORIZED';
            return (
            <React.Fragment key={groupIndex}>
              <TableRow
                id={`cashflow-group-${groupIndex}`}
                className={cn(
                  'font-medium cursor-pointer scroll-mt-4',
                  isUncategorized
                    ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950'
                    : 'bg-muted hover:bg-muted/80'
                )}
                onClick={() => onToggleSection(groupIndex)}
              >
                <TableCell
                  className={cn(
                    LABEL_COL_WIDTH,
                    STICKY_LABEL,
                    isUncategorized ? 'bg-amber-50 dark:bg-amber-950' : 'bg-muted'
                  )}
                >
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      {openSections[groupIndex] ?? true ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      {isUncategorized ? 'UNCATEGORIZED' : group.type}
                    </span>
                    {isUncategorized && (
                      <Link
                        to="/settings/setup-categories"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-normal text-amber-800 underline underline-offset-2 hover:text-amber-950"
                      >
                        Map in Setup Categories
                      </Link>
                    )}
                  </span>
                </TableCell>
                {report.columns.map((col, ci) => (
                  <TableCell key={ci} className={cn(MONTH_COL_WIDTH, 'text-center')} />
                ))}
              </TableRow>

              {(openSections[groupIndex] ?? true) &&
                group.subGroupDataSet.flatMap((sub, subIdx) =>
                  [
                    ...sub.rowDataSet.flatMap((rowSet, rsIdx) => {
                      const keyBase = `${groupIndex}-${subIdx}-${rowSet.id}-${rsIdx}`;
                      const hasSectionTitle = !isRedundantCategoryCodeHeader(rowSet.header);
                      const linePad = hasSectionTitle ? 'pl-10' : 'pl-8';
                      const block: React.ReactNode[] = [];

                      if (hasSectionTitle) {
                        block.push(
                          <TableRow
                            key={`${keyBase}-title`}
                            className="bg-muted border-t border-border/60"
                          >
                            <TableCell
                              className={cn(
                                'pl-8 py-3 font-semibold text-sm text-foreground',
                                LABEL_COL_WIDTH,
                                STICKY_LABEL,
                                'bg-muted'
                              )}
                            >
                              {rowSet.header}
                            </TableCell>
                            {report.columns.map((_, ci) => (
                              <TableCell key={ci} className={cn(MONTH_COL_WIDTH, 'bg-muted')} />
                            ))}
                          </TableRow>
                        );
                      }

                      rowSet.rowData.forEach((row, rowIdx) => {
                        block.push(
                          <TableRow key={`${keyBase}-r-${rowIdx}`}>
                            <TableCell
                              className={cn(linePad, LABEL_COL_WIDTH, STICKY_LABEL, 'bg-card py-2.5')}
                            >
                              <span className="text-foreground">{row.name}</span>
                            </TableCell>
                            {row.colData.map((col, ci) => (
                              <TableCell
                                key={ci}
                                data-col-idx={ci}
                                style={colHoverStyle(ci)}
                                onClick={() => {
                                  const locationId = row.id ? String(row.id) : '';
                                  if (!locationId) return;
                                  const monthLabel = col?.column || report.columns[ci];
                                  if (!monthLabel || isTotalColumn(monthLabel)) return;
                                  onCategoryDrilldown({
                                    rangeGroup: group.type,
                                    rangeSubGroup: sub.rowHeader,
                                    categoryName: rowSet.header,
                                    locationId,
                                    locationName: row.name,
                                    monthLabel,
                                  });
                                }}
                                className={cn(
                                  MONTH_COL_WIDTH,
                                  'text-center tabular-nums py-2.5',
                                  !isTotalColumn(report.columns[ci]) && 'cursor-pointer hover:bg-muted/30',
                                  totalColumnCellClass(report.columns[ci], currentMonthLabel),
                                  col.value < 0 && 'text-destructive'
                                )}
                              >
                                {formatCurrency(col.value, report.currencySymbol)}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      });

                      if (rowSet.total) {
                        block.push(
                          <TableRow key={`${keyBase}-total`} className="bg-muted font-medium">
                            <TableCell
                              className={cn(linePad, LABEL_COL_WIDTH, STICKY_LABEL, 'bg-muted')}
                            >
                              {rowSet.total.name}
                            </TableCell>
                            {rowSet.total.colData.map((col, ci) => (
                              <TableCell
                                key={ci}
                                data-col-idx={ci}
                                style={colHoverStyle(ci)}
                                className={cn(
                                  MONTH_COL_WIDTH,
                                  'text-center tabular-nums',
                                  totalColumnCellClass(report.columns[ci], currentMonthLabel),
                                  col.value < 0 && 'text-destructive'
                                )}
                              >
                                {formatCurrency(col.value, report.currencySymbol)}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      }

                      block.push(statementSectionSpacerRow(`${keyBase}-spacer`, colCount));
                      return block;
                    }),
                    sub.total ? (
                      <TableRow key={`${groupIndex}-${subIdx}-sub-total`} className="bg-muted font-semibold">
                        <TableCell className={cn(LABEL_COL_WIDTH, 'pl-8', STICKY_LABEL, 'bg-muted')}>
                          {sub.total.name}
                        </TableCell>
                        {sub.total.colData.map((col, ci) => (
                          <TableCell
                            key={ci}
                            data-col-idx={ci}
                            style={colHoverStyle(ci)}
                            className={cn(
                              MONTH_COL_WIDTH,
                              'text-center tabular-nums',
                              totalColumnCellClass(report.columns[ci], currentMonthLabel),
                              col.value < 0 && 'text-destructive'
                            )}
                          >
                            {formatCurrency(col.value, report.currencySymbol)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ) : null,
                  ]
                )}

              {(openSections[groupIndex] ?? true) && group.total && (
                <TableRow className="font-bold bg-muted border-t-2">
                  <TableCell className={cn(LABEL_COL_WIDTH, STICKY_LABEL, 'bg-muted pl-6')}>
                    {group.total.name}
                  </TableCell>
                  {group.total.colData.map((col, ci) => (
                    <TableCell
                      key={ci}
                      data-col-idx={ci}
                      style={colHoverStyle(ci)}
                      className={cn(
                        MONTH_COL_WIDTH,
                        'text-center tabular-nums',
                        totalColumnCellClass(report.columns[ci], currentMonthLabel),
                        col.value < 0 && 'text-destructive'
                      )}
                    >
                      {formatCurrency(col.value, report.currencySymbol)}
                    </TableCell>
                  ))}
                </TableRow>
              )}
            </React.Fragment>
            );
          })}

          {report.totalRowDataSet.map((row) => (
            <TableRow key={row.name} className="font-semibold bg-muted">
              <TableCell className={cn(LABEL_COL_WIDTH, STICKY_LABEL, 'bg-muted')}>
                {row.name}
              </TableCell>
              {row.colData.map((col, ci) => (
                <TableCell
                  key={ci}
                  data-col-idx={ci}
                  style={colHoverStyle(ci)}
                  className={cn(
                    MONTH_COL_WIDTH,
                    'text-center tabular-nums',
                    totalColumnCellClass(report.columns[ci], currentMonthLabel),
                    col.value < 0 && 'text-destructive'
                  )}
                >
                  {formatCurrency(col.value, report.currencySymbol)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
