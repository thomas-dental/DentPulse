import { cn } from '@/lib/utils';
import { StatusType } from '@/data/mockData';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const labels = {
    success: 'On Track',
    warning: 'Attention',
    danger: 'Critical',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        {
          'px-2 py-0.5 text-xs': size === 'sm',
          'px-2.5 py-1 text-xs': size === 'md',
          'bg-success-muted text-success': status === 'success',
          'bg-warning-muted text-warning': status === 'warning',
          'bg-danger-muted text-danger': status === 'danger',
        }
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', {
        'bg-success': status === 'success',
        'bg-warning': status === 'warning',
        'bg-danger': status === 'danger',
      })} />
      {label || labels[status]}
    </span>
  );
}
