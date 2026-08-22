import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  showTarget?: boolean;
  targetLabel?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
}

export function ProgressBar({
  value,
  max,
  label,
  showTarget = false,
  targetLabel,
  variant = 'default',
  size = 'md',
}: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  const colors = {
    default: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  };

  return (
    <div className="space-y-1.5">
      {(label || showTarget) && (
        <div className="flex justify-between text-xs">
          {label && <span className="text-muted-foreground">{label}</span>}
          {showTarget && targetLabel && (
            <span className="text-muted-foreground">{targetLabel}</span>
          )}
        </div>
      )}
      <div className={cn('w-full bg-secondary rounded-full overflow-hidden', {
        'h-1.5': size === 'sm',
        'h-2': size === 'md',
      })}>
        <div
          className={cn(colors[variant], 'h-full rounded-full transition-all duration-500')}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
