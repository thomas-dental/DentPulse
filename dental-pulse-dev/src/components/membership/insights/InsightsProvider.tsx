import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import "./insights.css";

export type InsightsTab =
  | "plan-revenue"
  | "overview"
  | "members"
  | "clinicians"
  | "capacity"
  | "margin"
  | "scenarios"
  | "treatments"
  | "settings";

/** Members-worklist categories, matching the reference design's five chips
 *  (At risk / Sleeping / Arrears / Upgrade / Data gaps) — each backed by
 *  real data (see useMembersWorklists.ts for exactly what each pulls from). */
export type MemberFilterKey = "at-risk" | "sleeping" | "arrears" | "upgrade" | "gaps";

interface InsightsState {
  activeTab: InsightsTab;
  setActiveTab: (tab: InsightsTab) => void;
  /** Switch to Members pre-filtered to a category (Overview's "Open
   *  worklist" / statement-health "Fix" style buttons). */
  goToMembers: (filter: MemberFilterKey) => void;
  membersFilter: MemberFilterKey;
  setMembersFilter: (filter: MemberFilterKey) => void;
}

const InsightsContext = createContext<InsightsState | null>(null);

export function InsightsProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<InsightsTab>("plan-revenue");
  const [membersFilter, setMembersFilter] = useState<MemberFilterKey>("at-risk");

  const goToMembers = useCallback((filter: MemberFilterKey) => {
    setMembersFilter(filter);
    setActiveTab("members");
  }, []);

  const value = useMemo<InsightsState>(
    () => ({ activeTab, setActiveTab, goToMembers, membersFilter, setMembersFilter }),
    [activeTab, goToMembers, membersFilter],
  );

  return (
    <InsightsContext.Provider value={value}>{children}</InsightsContext.Provider>
  );
}

export function useInsights(): InsightsState {
  const ctx = useContext(InsightsContext);
  if (!ctx) {
    throw new Error("useInsights must be used within an InsightsProvider");
  }
  return ctx;
}
