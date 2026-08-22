import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LiveFinancialLineItem } from './LiveFinancialLineItem';
import { buildLiveReportGridLayout } from './liveReportGrid';
import type { LiveSection } from '@/hooks/useAccountingFinancialReports';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { stripLeadingReportOperator } from '@/lib/financialStatementLayout';

interface LiveFinancialSectionProps {
  section: LiveSection;
  defaultExpanded?: boolean;
  /** One header label per amount column, e.g. ["31 Aug 2026", "31 Jul 2026", "30 Jun 2026"] — index-aligned with section.totalAmounts / item.amounts. */
  columnLabels: string[];
  /** When true, shows a Location column before the line item name (All Locations view). */
  showLocationColumn?: boolean;
  /**
   * Optional shared grid from the parent page. When provided, section columns
   * match summary rows (Total Assets, etc.) pixel-for-pixel inside one scroll pane.
   */
  gridTemplateColumns?: string;
  /** Xero-style "Plus" / "Less" prefix on the section header. */
  operator?: "plus" | "less" | null;
}

const formatCurrency = (value: number, showDecimals: boolean) => {
  const absValue = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(absValue);
  return value < 0 ? `(${formatted})` : formatted;
};

/**
 * Renders one section of a live Xero/QuickBooks report (Profit & Loss or
 * Balance Sheet) — account name plus one amount per period column. No
 * Budget/Variance/Source columns: those aren't data the accounting platforms
 * return, only the mock/Iplicit report model has them (see FinancialSection
 * for that version).
 *
 * The number of columns is dynamic — Xero/QuickBooks' own "Compare with"
 * returns one column per period (current + N comparison periods), not just a
 * single prior column. Every line item and the trailing "Total {name}" row
 * share the exact same CSS grid column template (built once by the caller
 * and passed in), so amounts line up pixel-for-pixel regardless of how many
 * columns there are.
 */
export function LiveFinancialSection({
  section,
  defaultExpanded = true,
  columnLabels,
  showLocationColumn = false,
  gridTemplateColumns: gridTemplateColumnsProp,
  operator = null,
}: LiveFinancialSectionProps) {
  const { showDecimals } = useOrganizationSettings();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const { gridTemplateColumns: builtGrid } = buildLiveReportGridLayout(
    columnLabels.length,
    showLocationColumn,
  );
  const gridTemplateColumns = gridTemplateColumnsProp ?? builtGrid;
  const displayName = operator
    ? stripLeadingReportOperator(section.name)
    : section.name;

  return (
    <div className="mb-4">
      {/* Section Header — name only; the total is shown in its own row below the line items, not here. */}
      <div
        className="flex items-center gap-2 py-3 px-4 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
        <span className="font-semibold text-foreground">
          {operator && (
            <em className="font-normal italic mr-1.5 text-muted-foreground">
              {operator === "less" ? "Less" : "Plus"}
            </em>
          )}
          {displayName}
        </span>
      </div>

      {/* Section Items — overflow kept visible so the page-level horizontal scroll owns clipping. */}
      {isExpanded && (
        <div className="mt-2 border border-border rounded-lg">
          <div
            className="grid items-center bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide py-2.5 px-4"
            style={{ gridTemplateColumns }}
          >
            {showLocationColumn && (
              <span className="text-left font-medium pr-3 whitespace-nowrap">
                Location
              </span>
            )}
            <span className="text-left font-medium pr-4">Line Item</span>
            {columnLabels.map((label, i) => {
              // Compare Locations headers are "<Location Name> — <date>" —
              // stack them on two lines and truncate each independently so a
              // long name (e.g. "Woodbridge Dental Care") can't overflow its
              // fixed-width column and visually overlap the next one. `min-w-0`
              // is required for a grid item to actually respect its track
              // width instead of growing to fit its content.
              const sepIndex = label.indexOf(' — ');
              const locationPart = sepIndex === -1 ? null : label.slice(0, sepIndex);
              const datePart = sepIndex === -1 ? label : label.slice(sepIndex + 3);
              return (
                <span
                  key={i}
                  className="min-w-0 text-right font-medium px-2"
                  title={label}
                >
                  {locationPart && (
                    <span className="block truncate normal-case text-[10px] leading-tight text-muted-foreground/90">
                      {locationPart}
                    </span>
                  )}
                  <span className="block truncate whitespace-nowrap">
                    {datePart}
                  </span>
                </span>
              );
            })}
          </div>
          {section.items.map((item) => (
            <LiveFinancialLineItem
              key={item.id}
              item={item}
              gridTemplateColumns={gridTemplateColumns}
              showLocationColumn={showLocationColumn}
            />
          ))}
          <div
            className="grid items-center bg-muted/20 py-3 px-4 border-t border-border"
            style={{ gridTemplateColumns }}
          >
            {showLocationColumn && <span />}
            <span className="text-sm font-semibold text-foreground pr-4">
              Total {displayName}
            </span>
            {section.totalAmounts.map((amount, i) => (
              <span
                key={i}
                className={cn(
                  'font-semibold text-sm text-right px-2 whitespace-nowrap tabular-nums',
                  i > 0 && 'text-muted-foreground',
                )}
              >
                {formatCurrency(amount)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
