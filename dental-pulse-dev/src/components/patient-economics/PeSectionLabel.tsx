import type { ReactNode } from 'react';

/**
 * Section divider label — mockup v5.1 `.section-label`.
 */
export function PeSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 mt-[26px] text-[11px] font-bold uppercase tracking-[0.08em] text-primary">
      {children}
    </div>
  );
}
