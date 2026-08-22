import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface SummaryCardProps {
  title: string;
  currentValue: number;
  priorValue: number;
  budgetValue?: number;
  format?: 'currency' | 'percent' | 'ratio';
  inverse?: boolean; // For metrics where lower is better
}

const formatValue = (value: number, format: 'currency' | 'percent' | 'ratio') => {
  switch (format) {
    case 'currency': {
      const absValue = Math.abs(value);
      const isCompact = absValue >= 1000000;
      const formatted = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        notation: isCompact ? 'compact' : 'standard',
      }).format(absValue);
      return value < 0 ? `(${formatted})` : formatted;
    }
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'ratio':
      return value.toFixed(2);
    default:
      return value.toLocaleString();
  }
};

export function SummaryCard({ title, currentValue, priorValue, budgetValue, format = 'currency', inverse = false }: SummaryCardProps) {
  const change = priorValue !== 0 ? ((currentValue - priorValue) / Math.abs(priorValue)) * 100 : 0;
  const isPositive = inverse ? change < 0 : change > 0;
  const isNeutral = Math.abs(change) < 1;

  const budgetVariance = budgetValue ? currentValue - budgetValue : null;
  const budgetVariancePercent = budgetValue && budgetValue !== 0 ? (budgetVariance! / Math.abs(budgetValue)) * 100 : null;

  return (
    <div className="bg-card rounded-xl border border-border p-5 hover:shadow-md transition-shadow">
      <p className="text-sm text-muted-foreground mb-2">{title}</p>
      <p className="text-2xl font-bold text-foreground mb-3">{formatValue(currentValue, format)}</p>
      
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          {isNeutral ? (
            <Minus className="w-3.5 h-3.5 text-muted-foreground" />
          ) : isPositive ? (
            <TrendingUp className="w-3.5 h-3.5 text-success" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-danger" />
          )}
          <span className={cn(
            'font-medium',
            isNeutral ? 'text-muted-foreground' : isPositive ? 'text-success' : 'text-danger'
          )}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs prior
          </span>
        </div>
        
        {budgetVariancePercent !== null && (
          <span className={cn(
            'font-medium',
            Math.abs(budgetVariancePercent) <= 3 ? 'text-success' : 
            Math.abs(budgetVariancePercent) <= 7 ? 'text-warning' : 'text-danger'
          )}>
            {budgetVariancePercent >= 0 ? '+' : ''}{budgetVariancePercent.toFixed(1)}% vs budget
          </span>
        )}
      </div>
    </div>
  );
}
