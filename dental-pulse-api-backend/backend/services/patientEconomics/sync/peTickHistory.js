/**
 * In-memory ring buffer of recent PE scheduler ticks (kickoff + resume).
 * Process-local — cleared on restart. Eng/dev inspector only.
 */

const MAX_TICKS = Number(process.env.PE_SYNC_TICK_HISTORY_SIZE || 25);

/** @type {object[]} */
const ticks = [];

/**
 * @param {{
 *   kind: 'resume'|'kickoff_incremental'|'kickoff_full',
 *   practicesConsidered?: number,
 *   kicked?: number,
 *   skipped?: number,
 *   processed?: number,
 *   results?: object[],
 *   skippedReason?: string,
 * }} entry
 */
function recordTick(entry) {
  ticks.unshift({
    at: new Date().toISOString(),
    ...entry,
  });
  if (ticks.length > MAX_TICKS) {
    ticks.length = MAX_TICKS;
  }
}

function listTicks() {
  return ticks.slice();
}

function clearTicks() {
  ticks.length = 0;
}

module.exports = {
  recordTick,
  listTicks,
  clearTicks,
  MAX_TICKS,
};
