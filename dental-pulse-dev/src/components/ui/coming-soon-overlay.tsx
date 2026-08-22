import { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComingSoonOverlayProps {
  children: ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export function ComingSoonOverlay({
  children,
  title = 'Coming Soon',
  description = "We're putting the finishing touches on this page. Check back shortly.",
  className,
}: ComingSoonOverlayProps) {
  return (
    <div className={cn('relative max-h-[70vh] overflow-hidden rounded-xl', className)}>
      <div className="absolute inset-0 z-10 rounded-xl bg-background/70 backdrop-blur-md" />
      <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card/95 px-8 py-7 text-center shadow-lg">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
      <div className="pointer-events-none select-none opacity-40 blur-[2px]" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
