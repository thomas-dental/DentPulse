import { cn } from '@/lib/utils';

interface ARAgingBarProps {
  data: {
    '0-30': number;
    '31-60': number;
    '61-90': number;
    '90+': number;
  };
  showLabels?: boolean;
  size?: 'sm' | 'md';
}

export function ARAgingBar({ data, showLabels = true, size = 'md' }: ARAgingBarProps) {
  const segments = [
    { key: '0-30', label: '0-30', color: 'bg-success', value: data['0-30'] },
    { key: '31-60', label: '31-60', color: 'bg-warning', value: data['31-60'] },
    { key: '61-90', label: '61-90', color: 'bg-danger/70', value: data['61-90'] },
    { key: '90+', label: '90+', color: 'bg-danger', value: data['90+'] },
  ];

  return (
    <div className="space-y-2">
      <div className={cn('flex rounded-full overflow-hidden', {
        'h-2': size === 'sm',
        'h-3': size === 'md',
      })}>
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={cn(segment.color, 'transition-all')}
            style={{ width: `${segment.value}%` }}
          />
        ))}
      </div>
      {showLabels && (
        <div className="flex gap-3 text-xs">
          {segments.map((segment) => (
            <div key={segment.key} className="flex items-center gap-1.5">
              <div className={cn('w-2 h-2 rounded-sm', segment.color)} />
              <span className="text-muted-foreground">{segment.label}:</span>
              <span className="font-medium">{segment.value}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
