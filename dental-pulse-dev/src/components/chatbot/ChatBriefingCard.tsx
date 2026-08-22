import { Sun, Moon, Sunrise, TrendingUp, TrendingDown } from 'lucide-react';
import { Bot } from 'lucide-react';

interface BriefingHighlight {
  label: string;
  value: string;
  trend: { direction: 'up' | 'down'; pct: string } | null;
}

interface BriefingData {
  greeting: string;
  periodLabel: string;
  highlights: BriefingHighlight[];
  empty?: boolean;
}

interface ChatBriefingCardProps {
  briefing: BriefingData;
}

function GreetingIcon() {
  const hour = new Date().getHours();
  if (hour < 12) return <Sunrise className="h-3.5 w-3.5 text-amber-500" />;
  if (hour < 18) return <Sun className="h-3.5 w-3.5 text-amber-500" />;
  return <Moon className="h-3.5 w-3.5 text-indigo-400" />;
}

function formatTime() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function ChatBriefingCard({ briefing }: ChatBriefingCardProps) {
  return (
    <div className="flex gap-2.5">
      {/* Bot avatar */}
      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/40 dark:to-purple-900/20 flex items-center justify-center shadow-sm">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>

      {/* Card */}
      <div className="max-w-[92%] flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-blue-200 border-l-[3px] border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800 dark:border-l-blue-400 px-3.5 py-3">
          {/* Greeting header */}
          <div className="flex items-center gap-1.5 mb-2">
            <GreetingIcon />
            <span className="text-sm font-semibold text-foreground">{briefing.greeting}</span>
          </div>

          {briefing.empty ? (
            <p className="text-xs text-muted-foreground">No recent data available. Start your day and check back later!</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-2.5">Here&apos;s your <span className="font-medium text-foreground">{briefing.periodLabel}</span> snapshot:</p>

              {/* Highlights */}
              <div className="space-y-1.5">
                {briefing.highlights.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{h.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-foreground">{h.value}</span>
                      {h.trend && typeof h.trend === 'object' && (
                        <span className={`flex items-center gap-0.5 text-[10px] font-medium ${
                          h.trend.direction === 'up' ? 'text-emerald-600' : 'text-red-500'
                        }`}>
                          {h.trend.direction === 'up'
                            ? <TrendingUp className="h-2.5 w-2.5" />
                            : <TrendingDown className="h-2.5 w-2.5" />
                          }
                          {h.trend.pct}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Timestamp */}
        <p className="text-[10px] text-muted-foreground mt-1 text-right">{formatTime()}</p>
      </div>
    </div>
  );
}
