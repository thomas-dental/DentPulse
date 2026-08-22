import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FinancialLineItem } from './FinancialLineItem';
import type { FinancialSection as FinancialSectionType } from '@/data/financialReportsData';

interface FinancialSectionProps {
  section: FinancialSectionType;
  defaultExpanded?: boolean;
}

const formatCurrency = (value: number) => {
  const absValue = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absValue);
  return value < 0 ? `(${formatted})` : formatted;
};

export function FinancialSection({ section, defaultExpanded = true }: FinancialSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const variance = section.total.currentPeriod - section.total.budget;
  const variancePercent = section.total.budget !== 0 ? (variance / Math.abs(section.total.budget)) * 100 : 0;

  return (
    <div className="mb-4">
      {/* Section Header */}
      <div
        className="flex items-center justify-between py-3 px-4 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
          <span className="font-semibold text-foreground">{section.name}</span>
        </div>
        <div className="flex items-center gap-8 text-sm">
          <span className="font-semibold">{formatCurrency(section.total.currentPeriod)}</span>
          <span className="text-muted-foreground w-24 text-right">{formatCurrency(section.total.priorPeriod)}</span>
          <span className="text-muted-foreground w-24 text-right">{formatCurrency(section.total.budget)}</span>
          <span className={cn(
            'font-medium w-32 text-right',
            variance >= 0 ? 'text-success' : 'text-danger'
          )}>
            {formatCurrency(variance)} ({variancePercent >= 0 ? '+' : ''}{variancePercent.toFixed(1)}%)
          </span>
        </div>
      </div>

      {/* Section Items */}
      {isExpanded && (
        <div className="mt-2 border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="py-2 px-4 text-left font-medium">Line Item</th>
                <th className="py-2 px-4 text-center font-medium">Current Period</th>
                <th className="py-2 px-4 text-center font-medium">Prior Period</th>
                <th className="py-2 px-4 text-center font-medium">Budget</th>
                <th className="py-2 px-4 text-center font-medium">Variance</th>
                <th className="py-2 px-4 text-center font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {section.items.map(item => (
                <FinancialLineItem key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
