import { LedgerLabel, type CalcRow } from "./LedgerLabel";

/** Generic segmented bar row — mirrors the prototype's bar(): a label, a
 *  track split into colored segments, and a right-aligned value. Used by
 *  Capacity (redemption) and Margin (distribution) tabs. */
export function Bar({
  label,
  segments,
  value,
  onClick,
  calc,
}: {
  label: string;
  segments: Array<{ pct: number; color: string }>;
  value: string;
  /** When set, renders the row as a button so callers can drill into which
   *  members make up this bar (e.g. Capacity's redemption buckets). */
  onClick?: () => void;
  /** Optional live worked-sum rows shown behind an ⓘ next to the label —
   *  the same tooltip shape the Margin ledger rows use. */
  calc?: CalcRow[];
}) {
  const content = (
    <>
      <span style={{ color: "var(--mpi-t2)" }}>
        {calc && calc.length > 0 ? <LedgerLabel label={label} calc={calc} /> : label}
      </span>
      <div className="mpi-btrack">
        {segments.map((s, i) => (
          <div key={i} className="mpi-bseg" style={{ width: `${s.pct}%`, background: s.color }} />
        ))}
      </div>
      <span className="mpi-bval num">{value}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="mpi-bline mpi-bline-clickable" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="mpi-bline">{content}</div>;
}
