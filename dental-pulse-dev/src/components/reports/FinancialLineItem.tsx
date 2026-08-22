import { useState } from 'react';
import { ChevronRight, ChevronDown, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { LineItem } from '@/data/financialReportsData';

interface FinancialLineItemProps {
  item: LineItem;
  level?: number;
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

const getVarianceClass = (current: number, budget: number, isExpense: boolean = false) => {
  const variance = isExpense ? budget - current : current - budget;
  const variancePercent = Math.abs(variance / budget) * 100;

  if (variancePercent <= 3) return 'text-success';
  if (variancePercent <= 7) return 'text-warning';
  return 'text-danger';
};

export function FinancialLineItem({ item, level = 0 }: FinancialLineItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;

  const variance = item.currentPeriod - item.budget;
  const variancePercent = item.budget !== 0 ? (variance / Math.abs(item.budget)) * 100 : 0;
  const isExpense = item.currentPeriod < 0 || item.name.toLowerCase().includes('cost') || item.name.toLowerCase().includes('expense');

  return (
    <>
      <tr
        className={cn(
          'border-b border-border/50 hover:bg-muted/30 transition-colors',
          level > 0 && 'bg-muted/20'
        )}
      >
        <td className="py-3 px-4">
          <div
            className={cn(
              'flex items-center gap-2',
              hasChildren && 'cursor-pointer'
            )}
            style={{ paddingLeft: `${level * 24}px` }}
            onClick={() => hasChildren && setIsExpanded(!isExpanded)}
          >
            {hasChildren && (
              <span className="text-muted-foreground">
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
            )}
            <span className={cn(
              'text-sm',
              level === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}>
              {item.name}
            </span>
          </div>
        </td>
        <td className="py-3 px-4 text-center">
          <span className="text-sm font-medium">{formatCurrency(item.currentPeriod)}</span>
        </td>
        <td className="py-3 px-4 text-center">
          <span className="text-sm text-muted-foreground">{formatCurrency(item.priorPeriod)}</span>
        </td>
        <td className="py-3 px-4 text-center">
          <span className="text-sm text-muted-foreground">{formatCurrency(item.budget)}</span>
        </td>
        <td className="py-3 px-4 text-center">
          <span className={cn('text-sm font-medium', getVarianceClass(item.currentPeriod, item.budget, isExpense))}>
            {formatCurrency(variance)} ({variancePercent >= 0 ? '+' : ''}{variancePercent.toFixed(1)}%)
          </span>
        </td>
        <td className="py-3 px-4 text-center">
          <Link
            to={item.sourceLink}
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <span>{item.source}</span>
            <ExternalLink className="w-3 h-3" />
          </Link>
        </td>
      </tr>
      {hasChildren && isExpanded && item.children?.map(child => (
        <FinancialLineItem key={child.id} item={child} level={level + 1} />
      ))}
    </>
  );
}
