import type { LiveLineItem } from '@/hooks/useAccountingFinancialReports';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';

interface LiveFinancialLineItemProps {
  item: LiveLineItem;
  /** Must match the parent section's gridTemplateColumns so amounts land in the same columns as the header. */
  gridTemplateColumns: string;
  /** When true, a Location cell is rendered before the line item name. */
  showLocationColumn?: boolean;
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

export function LiveFinancialLineItem({
  item,
  gridTemplateColumns,
  showLocationColumn = false,
}: LiveFinancialLineItemProps) {
  const { showDecimals } = useOrganizationSettings();
  return (
    <div
      className="grid items-start border-b border-border/50 hover:bg-muted/30 transition-colors py-3 px-4"
      style={{ gridTemplateColumns }}
    >
      {showLocationColumn && (
        <span className="text-sm text-muted-foreground pr-3 truncate">
          {item.locationName || '—'}
        </span>
      )}
      <span className="text-sm font-medium text-foreground pr-4 pl-4 leading-snug break-words">
        {item.name}
      </span>
      {item.amounts.map((amount, i) => (
        <span
          key={i}
          className="text-sm font-medium text-right px-2 whitespace-nowrap tabular-nums leading-snug"
        >
          {formatCurrency(amount)}
        </span>
      ))}
    </div>
  );
}
