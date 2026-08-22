import { type ReactNode } from "react";

/** Shared header row for every Membership Plan Insights tab: title +
 *  subtitle. Location/site scope comes from the app's own top-bar Location
 *  filter — no separate control here. */
export function ScopeBar({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mpi-scopebar">
      <div>
        <div className="mpi-title">{title}</div>
        {subtitle && <div className="mpi-sub">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
