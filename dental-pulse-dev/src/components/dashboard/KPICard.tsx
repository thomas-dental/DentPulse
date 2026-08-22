import { ReactNode } from 'react';
import { TrendingUp, TrendingDown, ArrowRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusType } from '@/data/mockData';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  trendLabel?: string;
  status?: StatusType;
  sparklineData?: number[];
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
  /** Plain-language "how this is calculated" help, shown behind an ⓘ next to the title. */
  helpText?: ReactNode;
}

export function KPICard({
  title,
  value,
  subtitle,
  trend,
  trendLabel,
  status = 'success',
  sparklineData,
  children,
  onClick,
  className,
  helpText,
}: KPICardProps) {
  const isPositiveTrend = trend !== undefined && trend >= 0;

  return (
    <div
      className={cn(
        'kpi-card cursor-pointer group',
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={cn('status-dot', {
            'status-dot-success': status === 'success',
            'status-dot-warning': status === 'warning',
            'status-dot-danger': status === 'danger',
          })} />
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          {helpText && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`How ${title} is calculated`}
                    className="text-muted-foreground/70 hover:text-foreground transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  sideOffset={8}
                  collisionPadding={16}
                  className="!overflow-visible w-[340px] max-w-[calc(100vw-2rem)] p-4 whitespace-normal break-words"
                >
                  {helpText}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {trend !== undefined && (
          <div className={cn(
            'flex items-center gap-1 text-sm font-medium',
            isPositiveTrend ? 'text-success' : 'text-danger'
          )}>
            {isPositiveTrend ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            <span>{isPositiveTrend ? '+' : ''}{trend.toFixed(2)}%</span>
          </div>
        )}
      </div>

      <div className="mb-3">
        <p className="text-3xl font-semibold text-foreground tracking-tight">{value}</p>
        {trendLabel && (
          <p className="text-sm text-muted-foreground mt-1">{trendLabel}</p>
        )}
      </div>

      {sparklineData && sparklineData.length > 0 && (
        <div className="h-12 -mx-2 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData.map((v, i) => ({ value: v, index: i }))}>
              <defs>
                <linearGradient id={`gradient-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop 
                    offset="0%" 
                    stopColor={status === 'success' ? 'hsl(var(--success))' : status === 'warning' ? 'hsl(var(--warning))' : 'hsl(var(--danger))'} 
                    stopOpacity={0.3} 
                  />
                  <stop 
                    offset="100%" 
                    stopColor={status === 'success' ? 'hsl(var(--success))' : status === 'warning' ? 'hsl(var(--warning))' : 'hsl(var(--danger))'} 
                    stopOpacity={0} 
                  />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={status === 'success' ? 'hsl(var(--success))' : status === 'warning' ? 'hsl(var(--warning))' : 'hsl(var(--danger))'}
                strokeWidth={1.5}
                fill={`url(#gradient-${title.replace(/\s/g, '')})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {children}

      {subtitle && (
        <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>
      )}

      <div className="flex items-center gap-1 text-xs text-accent mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <span>View by location</span>
        <ArrowRight className="w-3 h-3" />
      </div>
    </div>
  );
}
