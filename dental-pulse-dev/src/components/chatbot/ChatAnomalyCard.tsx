import { AlertTriangle, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Bot } from 'lucide-react';

interface AnomalyAlert {
  id: string;
  metric: string;
  severity: 'low' | 'medium' | 'high';
  direction: 'up' | 'down';
  description: string;
  z_score: number;
  created_at?: string;
}

interface ChatAnomalyCardProps {
  alert: AnomalyAlert;
  onDismiss: (id: string) => void;
  onTellMore?: (alert: AnomalyAlert) => void;
}

const SEVERITY_BADGE = {
  low: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  medium: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const BORDER_COLOR = {
  low: 'border-yellow-300 border-l-yellow-500 dark:border-yellow-800 dark:border-l-yellow-500',
  medium: 'border-orange-300 border-l-orange-500 dark:border-orange-800 dark:border-l-orange-500',
  high: 'border-red-300 border-l-red-500 dark:border-red-800 dark:border-l-red-500',
};

function formatTime(dateStr?: string) {
  if (dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function ChatAnomalyCard({ alert, onDismiss, onTellMore }: ChatAnomalyCardProps) {
  return (
    <div className="flex gap-2.5">
      {/* Bot avatar */}
      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/40 dark:to-purple-900/20 flex items-center justify-center shadow-sm">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>

      {/* Card */}
      <div className="max-w-[92%] flex-1">
        <div className={`rounded-2xl rounded-tl-sm border border-l-[3px] bg-card px-3.5 py-3 ${BORDER_COLOR[alert.severity]}`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-foreground">Anomaly detected</span>
            </div>
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_BADGE[alert.severity]}`}>
              {alert.severity}
            </span>
          </div>

          {/* Description */}
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{alert.description}</p>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs px-3 gap-1.5 bg-foreground text-background hover:bg-foreground/90"
              onClick={() => onTellMore?.(alert)}
            >
              <Search className="h-3 w-3" />
              Tell me more
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-3 gap-1.5"
              onClick={() => onDismiss(alert.id)}
            >
              <X className="h-3 w-3" />
              Dismiss
            </Button>
          </div>
        </div>

        {/* Timestamp */}
        <p className="text-[10px] text-muted-foreground mt-1 text-right">{formatTime(alert.created_at)}</p>
      </div>
    </div>
  );
}
