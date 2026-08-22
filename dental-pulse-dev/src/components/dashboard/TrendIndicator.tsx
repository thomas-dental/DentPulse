import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendIndicatorProps {
  value: number;
  label?: string;
  showIcon?: boolean;
  reverse?: boolean; // For metrics where lower is better (e.g., AR Days)
}

export function TrendIndicator({ value, label, showIcon = true, reverse = false }: TrendIndicatorProps) {
  const isPositive = reverse ? value < 0 : value > 0;
  const isNegative = reverse ? value > 0 : value < 0;
  const isNeutral = value === 0;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium',
        {
          'text-success': isPositive,
          'text-danger': isNegative,
          'text-muted-foreground': isNeutral,
        }
      )}
    >
      {showIcon && (
        <>
          {isPositive && <TrendingUp className="w-4 h-4" />}
          {isNegative && <TrendingDown className="w-4 h-4" />}
          {isNeutral && <Minus className="w-4 h-4" />}
        </>
      )}
      <span>
        {value > 0 ? '+' : ''}{value.toFixed(1)}%
        {label && <span className="text-muted-foreground ml-1">{label}</span>}
      </span>
    </div>
  );
}
