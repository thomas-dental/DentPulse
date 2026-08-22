/**
 * Splits a date range into monthly chunks for paginated syncing.
 *
 * Each chunk is { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 * where endDate is the last day of that month (or today for the current month).
 */

/**
 * Generate monthly chunks from startDate to now.
 * @param {string} startDate - ISO date string (e.g. '2023-01-15')
 * @returns {Array<{startDate: string, endDate: string}>}
 */
function generateMonthlyChunks(startDate) {
  const chunks = [];
  const now = new Date();

  let cursor = new Date(startDate);
  // Start from the 1st of the start month
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor <= now) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();

    const chunkStart = new Date(Date.UTC(year, month, 1));

    // End of month or today, whichever is earlier
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0)); // last day of month
    const chunkEnd = endOfMonth > now ? now : endOfMonth;

    chunks.push({
      startDate: formatDate(chunkStart),
      endDate: formatDate(chunkEnd),
    });

    // Move to next month
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  return chunks;
}

function formatDate(d) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get a human-readable label for a month chunk.
 * @param {string} startDate
 * @returns {string} e.g. "2025-03"
 */
function chunkLabel(startDate) {
  return startDate.substring(0, 7);
}

/**
 * Generate monthly chunks from today backward for daysBack days.
 * Returns chunks in reverse chronological order (newest month first).
 * @param {number} daysBack - Number of days to go back (default 365)
 * @returns {Array<{startDate: string, endDate: string}>}
 */
function generateReverseMonthlyChunks(daysBack = 365) {
  const chunks = [];
  const now = new Date();

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);
  // Go to the 1st of the cutoff month
  cutoff.setUTCDate(1);
  cutoff.setUTCHours(0, 0, 0, 0);

  // Start from the current month, go backward
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();

  while (true) {
    const chunkStart = new Date(Date.UTC(year, month, 1));

    // Stop if we've gone past the cutoff
    if (chunkStart < cutoff) break;

    const endOfMonth = new Date(Date.UTC(year, month + 1, 0)); // last day of month
    const chunkEnd = endOfMonth > now ? now : endOfMonth;

    chunks.push({
      startDate: formatDate(chunkStart),
      endDate: formatDate(chunkEnd),
    });

    // Move to previous month
    month--;
    if (month < 0) {
      month = 11;
      year--;
    }
  }

  return chunks;
}

/**
 * Generate monthly chunks from a specific date range, in reverse chronological order.
 * @param {string} startDateStr - Start date 'YYYY-MM-DD'
 * @param {string} endDateStr - End date 'YYYY-MM-DD'
 * @returns {Array<{startDate: string, endDate: string}>}
 */
function generateReverseMonthlyChunksFromRange(startDateStr, endDateStr) {
  const chunks = [];

  const endDate = new Date(endDateStr + 'T00:00:00Z');
  const startDate = new Date(startDateStr + 'T00:00:00Z');
  const startCutoff = new Date(startDateStr + 'T00:00:00Z');
  // Go to the 1st of the start month
  startCutoff.setUTCDate(1);

  // Start from the end date's month, go backward
  let year = endDate.getUTCFullYear();
  let month = endDate.getUTCMonth();

  while (true) {
    const chunkStart = new Date(Date.UTC(year, month, 1));

    // Stop if we've gone past the cutoff
    if (chunkStart < startCutoff) break;

    const endOfMonth = new Date(Date.UTC(year, month + 1, 0)); // last day of month
    const chunkEnd = endOfMonth > endDate ? endDate : endOfMonth;

    // Clamp chunk start to the actual start date (don't fetch before user's start date)
    const effectiveStart = chunkStart < startDate ? startDate : chunkStart;

    chunks.push({
      startDate: formatDate(effectiveStart),
      endDate: formatDate(chunkEnd),
    });

    // Move to previous month
    month--;
    if (month < 0) {
      month = 11;
      year--;
    }
  }

  return chunks;
}

/**
 * Generate weekly chunks from a specific date range, in reverse chronological order.
 * Used for high-volume entities like treatment_plan_items to keep each job small.
 * @param {string} startDateStr - Start date 'YYYY-MM-DD'
 * @param {string} endDateStr - End date 'YYYY-MM-DD'
 * @returns {Array<{startDate: string, endDate: string}>}
 */
function generateReverseWeeklyChunksFromRange(startDateStr, endDateStr) {
  const chunks = [];
  const endDate = new Date(endDateStr + 'T00:00:00Z');
  const startDate = new Date(startDateStr + 'T00:00:00Z');

  // Start from end date, go backward in 7-day chunks
  let chunkEnd = new Date(endDate);

  while (chunkEnd >= startDate) {
    const chunkStart = new Date(chunkEnd);
    chunkStart.setUTCDate(chunkStart.getUTCDate() - 6); // 7-day window

    // Don't go before the overall start date
    const effectiveStart = chunkStart < startDate ? startDate : chunkStart;

    chunks.push({
      startDate: formatDate(effectiveStart),
      endDate: formatDate(chunkEnd),
    });

    // Move to previous week
    chunkEnd = new Date(effectiveStart);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() - 1);
  }

  return chunks;
}

module.exports = { generateMonthlyChunks, generateReverseMonthlyChunks, generateReverseMonthlyChunksFromRange, generateReverseWeeklyChunksFromRange, chunkLabel, formatDate };
