import { Lightbulb, Check, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Bot } from 'lucide-react';

interface Recommendation {
  id: string;
  recommendation_type: string;
  title: string;
  body: string;
  suggested_action?: string;
  created_at?: string;
}

interface ChatRecommendationCardProps {
  recommendation: Recommendation;
  onAction: (id: string, action: 'acted' | 'snoozed' | 'dismissed') => void;
}

function formatTime(dateStr?: string) {
  if (dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function ChatRecommendationCard({ recommendation, onAction }: ChatRecommendationCardProps) {
  return (
    <div className="flex gap-2.5">
      {/* Bot avatar */}
      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/40 dark:to-purple-900/20 flex items-center justify-center shadow-sm">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>

      {/* Card */}
      <div className="max-w-[92%] flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-purple-200 border-l-[3px] border-l-purple-500 bg-card dark:border-purple-800 dark:border-l-purple-400 px-3.5 py-3">
          {/* Header */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-foreground">{recommendation.title}</span>
          </div>

          {/* Body */}
          <p className="text-xs text-muted-foreground leading-relaxed mb-1">{recommendation.body}</p>

          {/* Estimated impact */}
          {recommendation.suggested_action && (
            <div className="inline-flex items-center text-xs font-medium text-foreground bg-muted/70 border border-border/60 rounded-md px-2 py-1 mt-1 mb-3">
              Estimated impact: <span className="text-primary ml-1 font-bold">{recommendation.suggested_action}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-2">
            <Button
              size="sm"
              className="h-7 text-xs px-3 gap-1.5 bg-primary hover:bg-primary/90"
              onClick={() => onAction(recommendation.id, 'acted')}
            >
              <Check className="h-3 w-3" />
              Act on this
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-3 gap-1.5"
              onClick={() => onAction(recommendation.id, 'snoozed')}
            >
              <Clock className="h-3 w-3" />
              Snooze 7 days
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-3 gap-1.5 text-muted-foreground"
              onClick={() => onAction(recommendation.id, 'dismissed')}
            >
              <X className="h-3 w-3" />
              Dismiss
            </Button>
          </div>
        </div>

        {/* Timestamp */}
        <p className="text-[10px] text-muted-foreground mt-1 text-right">{formatTime(recommendation.created_at)}</p>
      </div>
    </div>
  );
}
