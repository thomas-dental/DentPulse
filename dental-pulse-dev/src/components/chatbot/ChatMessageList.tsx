import { useRef, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ChatMessage } from './ChatMessage';
import { ChatSuggestions } from './ChatSuggestions';
import { ChatBriefingCard } from './ChatBriefingCard';
import { ChatAnomalyCard } from './ChatAnomalyCard';
import { ChatRecommendationCard } from './ChatRecommendationCard';
import { getPageSuggestions } from './pageSuggestions';
import type { ChatMessage as ChatMessageType } from '@/hooks/useChatbot';
import { useAuth } from '@/hooks/useAuth';
import { Bot, Sparkles, ChevronRight, Activity, Lightbulb, TrendingUp, Sun, Moon, Sunrise, Sunset } from 'lucide-react';

function getTimeOfDay(): { greeting: string; Icon: typeof Sun } {
  const h = new Date().getHours();
  if (h < 5) return { greeting: 'Working late', Icon: Moon };
  if (h < 12) return { greeting: 'Good morning', Icon: Sunrise };
  if (h < 17) return { greeting: 'Good afternoon', Icon: Sun };
  if (h < 21) return { greeting: 'Good evening', Icon: Sunset };
  return { greeting: 'Good evening', Icon: Moon };
}

function getFirstName(fullName?: string | null): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isLoading: boolean;
  isRestoring?: boolean;
  onSuggestionSelect: (suggestion: string) => void;
  greetingCard?: any;
  anomalies?: any[];
  recommendations?: any[];
  onDismissAnomaly?: (id: string) => void;
  onRecommendationAction?: (id: string, action: 'acted' | 'snoozed' | 'dismissed') => void;
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  // "Tuesday, May 5th" style
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  const day = d.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th';
  return `${weekday}, ${month} ${day}${suffix}`;
}

function isSameDay(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

// Pick a contextual loading hint based on what the user just asked. Cost-trend
// + journal-scan questions are the slowest (3-7s); calling out the work so the
// "..." dots aren't just an opaque wait. Returns null for questions that don't
// match a known slow pattern (the dots alone suffice for quick lookups).
function getLoadingHint(lastUserMessage?: string): string | null {
  const m = (lastUserMessage || '').toLowerCase();
  if (!m) return null;
  // 6-month / multi-month cost trends → multi-page journal scan
  if (/\b(?:cost|costs|expense|expenses|lab\s*fees?|staff\s*costs?|clinician\s*costs?|material\s*costs?|operating\s*leases?|overheads?|admin)\b/.test(m)
    && /\b(?:trend|over\s+(?:the\s+)?(?:last|past)\s+\d+\s+(?:month|months|quarter|year)|by\s+month|monthly|months?\s+(?:trend|history))\b/.test(m)) {
    return 'Reading multiple months of journal data — typically 3-5s.';
  }
  // Single-period cost breakdowns → one journal scan
  if (/\b(?:cost|costs|expense|expenses|lab\s*fees?|staff\s*costs?|clinician\s*costs?|material\s*costs?|operating\s*leases?|overheads?)\b/.test(m)) {
    return 'Reading journal data from your accounting integration.';
  }
  // Treatment profitability (RPC + treatments join)
  if (/\b(?:profitability|loss-?making|margin|profit\s+per|unprofitable)\b/.test(m) && /\b(?:treatment|treatments)\b/.test(m)) {
    return 'Computing per-treatment profitability — this can take a few seconds.';
  }
  // EBITDA / valuation — multi-step compute
  if (/\b(?:ebitda|valuation|enterprise\s+value|practice\s+(?:value|worth))\b/.test(m)) {
    return 'Computing EBITDA across revenue and costs.';
  }
  // Why / driver questions — two RPC calls (current + previous)
  if (/\bwhy\s+(?:is|are|did|has|have)\b/.test(m) || /\bwhat\s+drove\b/.test(m)) {
    return 'Comparing current and previous period drivers.';
  }
  // Plan mix / by-X breakdowns
  if (/\bplan\s*mix|payor\s*(?:mix|split)\b/.test(m)) {
    return 'Reading payment-plan revenue distribution.';
  }
  // Treatment revenue with category resolution
  if (/\btreatments?\b.*\b(?:revenue|income|by\s+category|by\s+treatment)\b|\b(?:revenue|income)\b.*\btreatments?\b/.test(m)) {
    return 'Aggregating treatment revenue by category.';
  }
  // Provider ranking / list
  if (/\b(?:top|bottom|rank|list)\b.*\b(?:provider|providers|dentist|hygienist|practitioner)\b/.test(m)) {
    return 'Ranking providers by the metrics you asked for.';
  }
  // Advisory / how-to / strategic
  if (/\bhow\s+(?:can|do|should|could)\b|\bsuggest|recommend|advise|advice\b/.test(m)) {
    return 'Reading the page snapshot and preparing analyst-grade advice.';
  }
  return null;
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-3">
      <div className="flex-1 h-px bg-border/50" />
      <span className="mx-3 text-[11px] font-medium text-muted-foreground bg-background border border-border/60 rounded-full px-3 py-1 shadow-sm">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

export function ChatMessageList({
  messages,
  isLoading,
  isRestoring,
  onSuggestionSelect,
  greetingCard,
  anomalies = [],
  recommendations = [],
  onDismissAnomaly,
  onRecommendationAction,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasCards = greetingCard || anomalies.length > 0 || recommendations.length > 0;
  const { pathname } = useLocation();
  const starterSuggestions = useMemo(() => getPageSuggestions(pathname), [pathname]);
  const { profile } = useAuth();
  const { greeting, Icon: TimeIcon } = useMemo(() => getTimeOfDay(), []);
  const firstName = useMemo(() => getFirstName(profile?.full_name), [profile?.full_name]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, greetingCard, anomalies, recommendations]);

  // Contextual loading hint — derived from the most recent user message so
  // the "..." dots tell the user roughly what's being done and how long it
  // tends to take. Quick lookups stay just dots; cost / EBITDA / treatment
  // profitability questions get a one-liner that calibrates expectations.
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'user' && typeof m.content === 'string') {
        return m.content;
      }
    }
    return undefined;
  }, [messages]);
  const loadingHint = useMemo(() => getLoadingHint(lastUserMessage), [lastUserMessage]);

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="space-y-3">
        {isRestoring && messages.length === 0 && (
          <div className="flex flex-col items-center pt-4 pb-2 px-1 animate-pulse">
            {/* Icon skeleton */}
            <div className="w-16 h-16 rounded-2xl bg-muted mb-4" />
            {/* Greeting skeleton */}
            <div className="h-4 w-40 rounded bg-muted mb-2" />
            {/* Subtitle skeleton */}
            <div className="h-3 w-56 rounded bg-muted/70 mb-4" />
            {/* Badges skeleton */}
            <div className="flex gap-1.5 mb-6">
              <div className="h-4 w-16 rounded-full bg-muted/70" />
              <div className="h-4 w-16 rounded-full bg-muted/70" />
              <div className="h-4 w-16 rounded-full bg-muted/70" />
            </div>
            {/* Divider skeleton */}
            <div className="w-full h-3 mb-3" />
            {/* Suggestion skeletons */}
            <div className="w-full space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border/40">
                  <div className="w-9 h-9 rounded-lg bg-muted shrink-0" />
                  <div className="h-3.5 rounded bg-muted flex-1" style={{ width: `${50 + i * 10}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.length === 0 && !isLoading && !isRestoring && (
          <div className="flex flex-col items-center pt-4 pb-2 px-1">
            {/* Hero zone */}
            <div className="relative w-full flex flex-col items-center pb-6">
              {/* Soft ambient glow behind icon — adds depth without being loud */}
              <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 w-56 h-56 bg-gradient-to-br from-violet-500/15 via-fuchsia-400/10 to-indigo-500/15 rounded-full blur-3xl" />

              {/* Icon with conic gradient ring (the ring rotates, the icon stays still) */}
              <div className="relative w-16 h-16 mb-4">
                <div
                  className="absolute inset-0 rounded-2xl animate-spin"
                  style={{
                    background: 'conic-gradient(from 0deg, hsl(var(--primary)) 0%, transparent 35%, hsl(var(--primary)) 70%, transparent 100%)',
                    animationDuration: '8s',
                  }}
                />
                <div className="absolute inset-[2px] rounded-2xl bg-background flex items-center justify-center shadow-sm">
                  <Sparkles className="h-7 w-7 text-primary" strokeWidth={2.2} />
                </div>
              </div>

              {/* Greeting line */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <TimeIcon className="h-3.5 w-3.5 text-amber-500" />
                <h2 className="text-base font-semibold text-foreground tracking-tight">
                  {greeting}{firstName ? `, ${firstName}` : ''}
                </h2>
              </div>
              <p className="text-xs text-muted-foreground text-center max-w-[280px] leading-relaxed">
                Ask anything about your practice.
              </p>

              {/* Capability badges — establishes the AI's strengths at a glance */}
              <div className="flex items-center gap-1.5 mt-4">
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-300 bg-violet-100/70 dark:bg-violet-950/40 border border-violet-200/60 dark:border-violet-900/40 px-2 py-0.5 rounded-full">
                  <Activity className="w-2.5 h-2.5" /> Live data
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/40 px-2 py-0.5 rounded-full">
                  <Lightbulb className="w-2.5 h-2.5" /> Insights
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-900/40 px-2 py-0.5 rounded-full">
                  <TrendingUp className="w-2.5 h-2.5" /> Trends
                </span>
              </div>
            </div>

            {/* Section header for suggestions */}
            <div className="w-full flex items-center gap-2 mb-2.5">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1">
                Try asking
              </p>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            </div>

            {/* Suggestion cards — staggered fade-in, icon tile + arrow */}
            <div className="w-full space-y-2">
              {starterSuggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onSuggestionSelect(s.text)}
                  className="group relative w-full overflow-hidden flex items-center gap-3 text-left px-3.5 py-3 rounded-xl border border-border/50 bg-card hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'backwards' }}
                >
                  {/* Soft hover sheen */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/0 to-primary/[0.06] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <span className="relative shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/40 dark:to-indigo-950/40 border border-violet-100/60 dark:border-violet-900/40 flex items-center justify-center text-base group-hover:scale-105 transition-transform duration-200">
                    {s.icon}
                  </span>
                  <span className="relative flex-1 text-sm text-foreground/85 group-hover:text-foreground transition-colors leading-snug">
                    {s.text}
                  </span>
                  <ChevronRight className="relative w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-200" />
                </button>
              ))}
            </div>

            {/* Subtle footer hint */}
            <p className="mt-5 text-[10px] text-muted-foreground/60 text-center leading-relaxed">
              Tip: I can also analyse anything you have open in modals or sidebars.
            </p>
          </div>
        )}

        {/* Chat messages with day separators */}
        {messages.map((msg, i) => {
          const prevMsg = i > 0 ? messages[i - 1] : null;
          const showDaySep = msg.timestamp && (i === 0 || !isSameDay(prevMsg?.timestamp, msg.timestamp));

          return (
            <div key={i}>
              {showDaySep && msg.timestamp && (
                <DaySeparator label={getDayLabel(msg.timestamp)} />
              )}
              <ChatMessage message={msg} />
              {msg.role === 'assistant' && msg.suggestions && msg.suggestions.length > 0 && (
                <ChatSuggestions
                  suggestions={msg.suggestions}
                  onSelect={onSuggestionSelect}
                  disabled={isLoading}
                />
              )}
            </div>
          );
        })}

        {/* Phase 4 cards — rendered at the bottom of chat flow (after messages) */}
        {greetingCard && (
          <ChatBriefingCard briefing={greetingCard} />
        )}

        {anomalies.slice(0, 3).map(alert => (
          <ChatAnomalyCard
            key={alert.id}
            alert={alert}
            onDismiss={(id) => onDismissAnomaly?.(id)}
          />
        ))}

        {recommendations.slice(0, 3).map(rec => (
          <ChatRecommendationCard
            key={rec.id}
            recommendation={rec}
            onAction={(id, action) => onRecommendationAction?.(id, action)}
          />
        ))}

        {isLoading && (
          <div className="flex gap-2.5">
            <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/40 dark:to-purple-900/20 flex items-center justify-center shadow-sm">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="bg-muted/70 border border-border/40 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '0.6s' }} />
                <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '150ms', animationDuration: '0.6s' }} />
                <span className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '300ms', animationDuration: '0.6s' }} />
              </div>
              {loadingHint && (
                <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">{loadingHint}</p>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
