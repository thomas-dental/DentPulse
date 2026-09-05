/**
 * Shared PE UI tokens aligned with patient-economics-engine-mockup-v5.1.html.
 */

/** Context / intro banner (`.ctx-banner`). */
export const PE_CTX_BANNER_CLASS =
  'flex items-start gap-2.5 rounded-[10px] border border-primary/20 bg-gradient-to-r from-primary/[0.08] to-primary/[0.02] px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground';

export const PE_TABLE_CLASS = 'w-full border-collapse text-[13px]';

export const PE_TABLE_HEAD_CELL_CLASS =
  'px-3.5 py-[11px] text-left text-[12px] font-semibold text-muted-foreground whitespace-nowrap';

export const PE_TABLE_BODY_CELL_CLASS = 'px-3.5 py-[11px] whitespace-nowrap';

export const PE_TABLE_ROW_CLASS =
  'border-b border-border/60 last:border-b-0 hover:bg-primary/[0.04]';

/**
 * Chart typography — keep labels, values, and captions the same size within charts.
 * Use PE_CHART_*_PX in SVG `fontSize`; use *_CLASS in HTML.
 */
export const PE_CHART_LABEL_PX = 12;
export const PE_CHART_VALUE_PX = 12;
export const PE_CHART_CAPTION_PX = 12;

export const PE_CHART_LABEL_CLASS = 'text-[12px] font-semibold text-muted-foreground';
export const PE_CHART_VALUE_CLASS = 'text-[12px] font-bold tabular-nums';
export const PE_CHART_CAPTION_CLASS = 'text-[12px] text-muted-foreground';
