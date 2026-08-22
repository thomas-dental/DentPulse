/** Tiny decorative per-row trend glyph for the Overview site-comparison
 *  table — mirrors the prototype's mini(). Not an interactive chart, so a
 *  hand-rolled inline SVG path is proportionate (Recharts would be overkill
 *  for a 64×20px table-cell glyph). */
export function MiniSparkline({ values }: { values: number[] }) {
  const W = 64;
  const H = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => [
    (i * W) / (values.length - 1),
    H - 2 - ((v - min) / range) * (H - 4),
  ]);
  const rising = values[values.length - 1] >= values[0];
  const color = rising ? "var(--mpi-verd)" : "var(--mpi-brick)";
  const d = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
