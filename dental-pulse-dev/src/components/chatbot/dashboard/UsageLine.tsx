import { ArrowUp, ArrowDown } from 'lucide-react';
import type { DashboardUsage } from '@/hooks/useChatbot';

/**
 * Muted per-turn meta line under the answer, mirroring the reference UI's
 * "39.3s · ↑104,930 ↓4,406 tokens · $0.0425 · 6 tools".
 */
export function UsageLine({ usage }: { usage?: DashboardUsage }) {
  if (!usage) return null;
  const secs = (usage.latencyMs / 1000).toFixed(1);
  const cost = usage.costUsd > 0 ? `$${usage.costUsd.toFixed(4)}` : '$0';
  const n = (x: number) => (x || 0).toLocaleString('en-GB');

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
      <span>{secs}s</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-0.5">
        <ArrowUp className="h-2.5 w-2.5" />{n(usage.inputTokens)}
        <ArrowDown className="h-2.5 w-2.5 ml-1" />{n(usage.outputTokens)} tokens
      </span>
      <span aria-hidden>·</span>
      <span>{cost}</span>
      <span aria-hidden>·</span>
      <span>{usage.tools} tools</span>
    </div>
  );
}
