import { Lightbulb } from 'lucide-react';

export function InsightsBanner({ insights }: { insights: { text: string }[] }) {
  if (!insights || insights.length === 0) return null;
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1.5">
      {insights.map((ins, i) => (
        <div key={i} className="flex items-start gap-2">
          <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-foreground leading-relaxed">{ins.text}</p>
        </div>
      ))}
    </div>
  );
}
