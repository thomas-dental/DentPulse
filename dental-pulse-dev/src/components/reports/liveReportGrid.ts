/** Shared CSS grid layout for live P&L / Balance Sheet tables. */

export const LIVE_REPORT_LOCATION_COL_PX = 140;
export const LIVE_REPORT_LINE_ITEM_COL_PX = 280;
/** Fits "£1,234,567.89" and date headers like "11 Aug 2026" without collision. */
export const LIVE_REPORT_AMOUNT_COL_PX = 152;
/**
 * Wider variant for Compare Locations' "side by side"/"Group (Average)"
 * modes, where each amount column's header also carries a location name
 * (e.g. "Woodbridge Dental Care — 11 Aug 2026") — the plain-date width above
 * has no room for that even after truncating, which is what caused headers
 * to visually overlap into neighboring columns.
 */
export const LIVE_REPORT_AMOUNT_WITH_LOCATION_COL_PX = 176;

export function buildLiveReportGridLayout(
  columnCount: number,
  showLocationColumn: boolean,
  hasColumnLocationNames = false,
): { gridTemplateColumns: string; minWidthPx: number } {
  const amountColPx = hasColumnLocationNames
    ? LIVE_REPORT_AMOUNT_WITH_LOCATION_COL_PX
    : LIVE_REPORT_AMOUNT_COL_PX;
  const locationPx = showLocationColumn ? LIVE_REPORT_LOCATION_COL_PX : 0;
  const minWidthPx =
    locationPx +
    LIVE_REPORT_LINE_ITEM_COL_PX +
    Math.max(columnCount, 0) * amountColPx;

  // ≤2 periods: let columns grow to fill the card. More periods: fixed tracks +
  // horizontal scroll so LINE ITEM stays readable and amounts stay aligned.
  const fewColumns = columnCount <= 2;
  const locationTrack = showLocationColumn
    ? `${LIVE_REPORT_LOCATION_COL_PX}px `
    : '';
  const lineItemTrack = fewColumns
    ? `minmax(${LIVE_REPORT_LINE_ITEM_COL_PX}px, 1fr)`
    : `${LIVE_REPORT_LINE_ITEM_COL_PX}px`;
  const amountTrack = fewColumns
    ? `repeat(${columnCount}, minmax(${amountColPx}px, 1fr))`
    : `repeat(${columnCount}, ${amountColPx}px)`;

  return {
    gridTemplateColumns: `${locationTrack}${lineItemTrack} ${amountTrack}`,
    minWidthPx,
  };
}
