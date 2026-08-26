import { useState, useEffect, useRef } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Banknote, TrendingUp, MapPin, FileSpreadsheet, Settings, SlidersHorizontal, ChevronLeft, ChevronRight, ChevronDown, Users, Stethoscope, UserCheck, Armchair, Zap, Calculator, UserCog, Megaphone, Layers, Briefcase, HeartPulse, Target, ShieldCheck, Wallet, Rocket, Gauge, BarChart3, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE_LOGOS } from "@/lib/integrationLogos";
import { useUserRole } from "@/hooks/useUserRole";
import { usePermissions } from "@/hooks/usePermissions";
import { useModuleAccess } from "@/hooks/useModuleAccess";

interface SubItem {
  label: string;
  path?: string; // omit for no-action items
  cardKey?: string; // permission card key for tab-level visibility
  moduleKey?: string; // override parent moduleKey for sub-items that belong to a different module
}

interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path?: string;
  dropdown?: boolean;
  ownerOnly?: boolean;
  moduleKey?: string;
  cardKey?: string; // permission card key for tab-level visibility, for items with no further nesting
  subItems?: SubItem[];
  children?: NavItem[]; // section-level grouping; rendered the same way as top-level items
}

const navItems: NavItem[] = [
  // '/' now renders the new group dashboard; the previous dashboard lives on
  // unchanged at /dashboard-classic.
  {
    icon: LayoutDashboard,
    label: "Financial Position",
    path: "/",
    moduleKey: "dashboard",
  },
  {
    icon: FileSpreadsheet,
    label: "Financial Statements",
    path: "/financial-reports",
    moduleKey: "financial_reports",
  },
  {
    icon: TrendingUp,
    label: "Profitability",
    path: "/profitability",
    moduleKey: "profitability",
  },
  {
    icon: Banknote,
    label: "Cashflow",
    path: "/cashflow/preparing-statement",
    dropdown: true,
    moduleKey: "cash_flow",
    subItems: [
      {
        label: "Cash Flow Statement",
        path: "/cashflow/preparing-statement",
        cardKey: "preparing_cashflow_page",
      },
      {
        label: "13-Week Forecast",
        path: "/cashflow/13-week-forecast",
        cardKey: "thirteen_week_forecast",
      },
      {
        label: "Bills to Pay",
        path: "/cashflow/bills-to-pay",
        cardKey: "bills_to_pay",
      },
    ],
  },

  // {
  //   icon: Receipt,
  //   label: "Financial Reports",
  //   dropdown: true,
  //   children: [
  //     // {
  //     //   icon: FileSpreadsheet,
  //     //   label: "Financial Statements",
  //     //   path: "/financial-reports",
  //     //   moduleKey: "financial_reports",
  //     // },
  //     // {
  //     //   icon: TrendingUp,
  //     //   label: "Profitability",
  //     //   path: "/profitability",
  //     //   moduleKey: "profitability",
  //     // },
  //     // {
  //     //   icon: Banknote,
  //     //   label: "Cashflow",
  //     //   path: "/cashflow/preparing-statement",
  //     //   dropdown: true,
  //     //   moduleKey: "cash_flow",
  //     //   subItems: [
  //     //     {
  //     //       label: "Cash Flow Statement",
  //     //       path: "/cashflow/preparing-statement",
  //     //       cardKey: "preparing_cashflow_page",
  //     //     },
  //     //     {
  //     //       label: "13-Week Forecast",
  //     //       path: "/cashflow/13-week-forecast",
  //     //       cardKey: "thirteen_week_forecast",
  //     //     },
  //     //     {
  //     //       label: "Bills to Pay",
  //     //       path: "/cashflow/bills-to-pay",
  //     //       cardKey: "bills_to_pay",
  //     //     },
  //     //   ],
  //     // },
  //     // {
  //     //   icon: FileSpreadsheet,
  //     //   label: "Financial Statements",
  //     //   path: "/financial-reports",
  //     //   moduleKey: "financial_reports",
  //     // },
  //     {
  //       icon: Calculator,
  //       label: "Tax",
  //       path: "/tax",
  //       moduleKey: "tax",
  //     },
  //   ],
  // },

  {
    icon: Rocket,
    label: "Profit Engine",
    dropdown: true,
    children: [
      {
        icon: Users,
        label: "Providers",
        dropdown: true,
        moduleKey: "providers",
        subItems: [
          {
            label: "Insights",
            path: "/providers/profit-by-associates",
            cardKey: "profit_by_associates_tab",
          },
          {
            label: "Hygienist",
            path: "/providers/hygienist",
            cardKey: "hygienist_tab",
          },
          {
            label: "Associate",
            path: "/providers/dentist",
            cardKey: "dentist_tab",
          },
          {
            label: "Therapist",
            path: "/providers/therapist",
            cardKey: "therapist_tab",
          },

          { label: "Other", path: "/providers/other", cardKey: "other_tab" },
          // {
          //   label: "Insights",
          //   path: "/providers/profit-by-associates",
          //   cardKey: "profit_by_associates_tab",
          // },
          // { label: "Provider History", path: "/practitioner-history" },
          { label: "Practitioner Activity", path: "/practitioner-activity" },
          {
            label: "Profit Planning by New Associates",
            path: "/planning/associates",
          },
        ],
      },
      {
        icon: Stethoscope,
        label: "Treatments",
        dropdown: true,
        moduleKey: "treatments",
        subItems: [
          {
            label: "Treatment Insights",
            path: "/treatments/insights",
            cardKey: "insights_tab",
          },
          {
            label: "Private Treatment",
            path: "/treatments/private",
            cardKey: "private_tab",
          },
          {
            label: "Membership",
            path: "/treatments/membership",
            cardKey: "membership_tab",
          },
          { label: "NHS", path: "/treatments/nhs", cardKey: "nhs_tab" },
          {
            label: "Profit by Treatments",
            path: "/treatments/profit-by-treatments",
            cardKey: "profit_by_treatments_tab",
          },
          {
            label: "Income Report",
            path: "/treatments/income-report",
          },
          {
            label: "Treatment Setup",
            path: "/treatments/setup",
            cardKey: "setup_treatments_tab",
          },
          {
            label: "Profit Goals",
            path: "/treatments/goals",
            cardKey: "profit_goals_tab",
          },
          // {
          //   label: "Profit Planning by Treatment",
          //   path: "/budget?tab=profit-planning-treatment",
          //   cardKey: "profit_planning_treatment_tab",
          // },
        ],
      },
      {
        icon: Armchair,
        label: "Chairs",
        path: "/chairs",
        moduleKey: "chairs",
      },
      {
        icon: HeartPulse,
        label: "Specialties",
        path: "/specialties",
        moduleKey: "specialties",
      },
      // {
      //   icon: ClipboardList,
      //   label: "Planning",
      //   dropdown: true,
      //   moduleKey: "budget",
      //   subItems: [
      //     // {
      //     //   label: "Profit Planning by Treatment",
      //     //   path: "/budget?tab=profit-planning-treatment",
      //     //   cardKey: "profit_planning_treatment_tab",
      //     // },
      //     // {
      //     //   label: "Profit Planning by Associates",
      //     //   path: "/planning/associates",
      //     // },
      //   ],
      // },
    ],
  },

  {
    icon: Gauge,
    label: "Operational Efficiency",
    dropdown: true,
    children: [
      {
        icon: MapPin,
        label: "Locations",
        path: "/locations",
        moduleKey: "locations",
      },
      {
        icon: Zap,
        label: "Accounts Payable",
        path: "/accounts-payable",
        moduleKey: "accounts_payable",
      },
      {
        icon: Wallet,
        label: "Budget",
        path: "/budget",
        moduleKey: "budget",
      },
    ],
  },

  {
    icon: BarChart3,
    label: "Managing Business Growth",
    dropdown: true,
    children: [
      {
        icon: UserCheck,
        label: "Patients",
        path: "/patients",
        dropdown: true,
        moduleKey: "patients",
        subItems: [
          { label: "Economic Pulse", path: "/patients" },
          { label: "Growth Levers", path: "/patients?tab=growth-levers" },
          { label: "Value & Leakage", path: "/patients?tab=value-leakage" },
          {
            label: "Retention & Reactivation",
            path: "/patients?tab=retention",
          },
          { label: "Patient List", path: "/patients?tab=patient-list" },
          { label: "Patient Records", path: "/patients?tab=patient-records" },
          { label: "Invoices", path: "/patients?tab=invoices" },
          { label: "Goal Settings", path: "/patients?tab=goal-settings" },
          { label: "Settings", path: "/patients?tab=settings" },
        ],
      },
      {
        icon: Megaphone,
        label: "Marketing",
        path: "/marketing",
        moduleKey: "marketing",
      },
      {
        icon: Layers,
        label: "Cost Impact",
        path: "/cost-impact",
        dropdown: true,
        moduleKey: "cost_impact",
        subItems: [
          {
            label: "Material Costs",
            path: "/material-costs",
            cardKey: "material_costs_tab",
          },
          { label: "Lab Fees", path: "/lab-fees", cardKey: "lab_fees_tab" },
          {
            label: "Clinician Costs",
            path: "/clinician-costs",
            cardKey: "clinician_costs_tab",
          },
          {
            label: "Staff Costs",
            path: "/staff-costs",
            cardKey: "staff_costs_tab",
          },
          {
            label: "Operating Leases",
            path: "/operating-leases",
            cardKey: "operating_leases_tab",
          },
          {
            label: "Overhead Costs",
            path: "/overhead-costs",
            cardKey: "overhead_costs_tab",
          },
          {
            label: "Marketing Costs",
            path: "/marketing-costs",
            cardKey: "marketing_costs_tab",
          },
        ],
      },
    ],
  },

  {
    icon: Scale,
    label: "Business valuation",
    dropdown: true,
    children: [
      {
        icon: Target,
        label: "Enterprise Overview",
        path: "/ebitda-valuation",
        moduleKey: "ebitda_to_value",
        cardKey: "enterprise_overview_tab",
      },
      {
        icon: TrendingUp,
        label: "EBITDA Bridge",
        path: "/ebitda-bridge",
        moduleKey: "ebitda_to_value",
        cardKey: "ebitda_bridge_tab",
      },
      // Quality Score moved into a tab on the Multiples page (/multiple-engine)
      // — no longer a separate sidebar link.
      // {
      //   icon: Gauge,
      //   label: "Quality Score",
      //   path: "/quality-score",
      //   moduleKey: "ebitda_to_value",
      //   cardKey: "quality_score_tab",
      // },
      {
        icon: Calculator,
        label: "Multiples",
        path: "/multiple-engine",
        moduleKey: "ebitda_to_value",
        cardKey: "multiple_engine_tab",
      },
      {
        icon: BarChart3,
        label: "Value Driven",
        path: "/gap-analysis",
        moduleKey: "ebitda_to_value",
        cardKey: "value_drivers_tab",
      },
      // Scenario Simulator moved into a tab on the Value Driven page (/gap-analysis)
      // — no longer a separate sidebar link.
      // {
      //   icon: FlaskConical,
      //   label: "Scenario Simulator",
      //   path: "/scenario-simulator",
      //   moduleKey: "ebitda_to_value",
      //   cardKey: "scenario_simulator_tab",
      // },
      // Exit Cockpit, Due Diligence and Group Heatmap moved into tabs on the
      // Enterprise Overview page (/ebitda-valuation) — no longer separate sidebar links.
      // {
      //   icon: Rocket,
      //   label: "Exit Cockpit™",
      //   path: "/exit-cockpit",
      //   moduleKey: "ebitda_to_value",
      //   cardKey: "exit_cockpit_tab",
      // },
      // {
      //   icon: ShieldCheck,
      //   label: "Due Diligence",
      //   path: "/due-diligence",
      //   moduleKey: "ebitda_to_value",
      //   cardKey: "due_diligence_tab",
      // },
      // {
      //   icon: Layers,
      //   label: "Group Heatmap",
      //   path: "/group-heatmap",
      //   moduleKey: "ebitda_to_value",
      //   cardKey: "group_heatmap_tab",
      // },
      // Generate PDF moved into the "Download Business Valuation Report" modal
      // on the Enterprise Overview page (/ebitda-valuation) — no longer a separate sidebar link.
      // {
      //   icon: Receipt,
      //   label: "Generate PDF",
      //   path: "/generate-pdf",
      //   moduleKey: "ebitda_to_value",
      //   cardKey: "generate_pdf_tab",
      // },
      {
        icon: SlidersHorizontal,
        label: "Settings & Adjustments",
        path: "/ebitda-settings",
        moduleKey: "ebitda_to_value",
        cardKey: "settings_adjustments_tab",
      },
    ],
  },

  {
    icon: UserCog,
    label: "Settings",
    dropdown: true,
    children: [
      {
        icon: Briefcase,
        label: "Organization",
        path: "/organization",
        moduleKey: "organization",
      },
      {
        icon: Settings,
        label: "Admin",
        path: "/admin",
        moduleKey: "admin_settings",
      },
      {
        icon: ShieldCheck,
        label: "Roles & Permissions",
        path: "/roles-permissions",
        ownerOnly: true,
        moduleKey: "roles_permissions",
      },
    ],
  },
];

interface AppSidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function AppSidebar({
  collapsed: collapsedProp,
  onCollapsedChange,
}: AppSidebarProps = {}) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed =
    collapsedProp !== undefined ? collapsedProp : internalCollapsed;
  const setCollapsed = (value: boolean) => {
    setInternalCollapsed(value);
    onCollapsedChange?.(value);
  };
  const [openDropdowns, setOpenDropdowns] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { isOwner } = useUserRole();
  const { can, canAccessModule, isOwner: isOwnerPerm } = usePermissions();
  const { isModuleEnabled } = useModuleAccess();

  // Filter a single item (top-level or nested under a section) by:
  // owner-only flag + module-level permission, then filter its subItems (if
  // any) by card-level and sub-item module-level permission. Returns null
  // when the item itself should be hidden.
  const filterItem = (item: NavItem): NavItem | null => {
    if (item.ownerOnly && !isOwner()) return null;
    // Org-wide module gate (SuperAdmin) — applies to everyone, even owners.
    if (item.moduleKey && !isModuleEnabled(item.moduleKey)) return null;
    if (isOwnerPerm) return item;
    // For dropdowns with sub-items that have their own moduleKey, skip parent
    // moduleKey check and let sub-item filtering handle visibility.
    const skipParentModuleCheck =
      item.dropdown && item.subItems?.some((sub) => sub.moduleKey);
    if (
      !skipParentModuleCheck &&
      item.moduleKey &&
      !canAccessModule(item.moduleKey)
    )
      return null;
    // Card-level check for a leaf item (no further nesting) with its own
    // permission card key, e.g. a former sub-item promoted to a direct child.
    if (item.cardKey && item.moduleKey && !can(item.moduleKey, "view", item.cardKey))
      return null;
    if (!item.subItems) return item;

    const parentModule = item.moduleKey;
    const filteredSubItems = item.subItems.filter((sub) => {
      // Sub-item has its own module key — check that module's access
      const effectiveModule = sub.moduleKey || parentModule;
      if (effectiveModule && !canAccessModule(effectiveModule)) return false;
      // Card-level check within the effective module
      if (sub.cardKey && effectiveModule) {
        return can(effectiveModule, "view", sub.cardKey);
      }
      return true;
    });
    // Hide dropdowns that have no visible sub-items after filtering
    if (item.dropdown && filteredSubItems.length === 0) return null;
    return { ...item, subItems: filteredSubItems };
  };

  const visibleNavItems = navItems
    .map((item) => {
      if (!item.children) return filterItem(item);
      const filteredChildren = item.children
        .map(filterItem)
        .filter((child): child is NavItem => child !== null);
      if (filteredChildren.length === 0) return null;
      return { ...item, children: filteredChildren };
    })
    .filter((item): item is NavItem => item !== null);

  const searchTerm = searchQuery.trim().toLowerCase();
  // Filter a single (non-section) item against the search box — it survives
  // if its own label matches (showing all its sub-items) or if any sub-item
  // matches (showing only those matches).
  const matchesSearch = (item: NavItem): NavItem | null => {
    const labelMatches = item.label.toLowerCase().includes(searchTerm);
    if (item.dropdown && item.subItems) {
      const matchingSubItems = labelMatches
        ? item.subItems
        : item.subItems.filter((sub) =>
            sub.label.toLowerCase().includes(searchTerm),
          );
      if (labelMatches || matchingSubItems.length > 0) {
        return { ...item, subItems: matchingSubItems };
      }
      return null;
    }
    return labelMatches ? item : null;
  };

  // Filter by the search box — a section survives if its own label matches
  // (showing all its children) or if any child (or nested sub-item) matches
  // (showing only those matches). Matching children/sub-items force their
  // dropdowns open below.
  const displayNavItems =
    searchTerm === ""
      ? visibleNavItems
      : visibleNavItems.reduce<typeof visibleNavItems>((acc, item) => {
          if (item.children) {
            const labelMatches = item.label.toLowerCase().includes(searchTerm);
            const matchingChildren = labelMatches
              ? item.children
              : item.children
                  .map(matchesSearch)
                  .filter((child): child is NavItem => child !== null);
            if (labelMatches || matchingChildren.length > 0) {
              acc.push({ ...item, children: matchingChildren });
            }
            return acc;
          }
          const matched = matchesSearch(item);
          if (matched) acc.push(matched);
          return acc;
        }, []);

  // Search sits right after the very first item ("Your Financial
  // Position") — everything else (remaining standalone items + sections)
  // renders below it.
  const [firstNavItem, ...restNavItems] = displayNavItems;

  const subItemMatchesLocation = (subItemPath: string | undefined) => {
    if (!subItemPath) return false;
    const [basePath, query] = subItemPath.split("?");
    const tabParam = new URLSearchParams(location.search).get("tab");
    if (query) {
      const itemTabParam = new URLSearchParams(query).get("tab");
      return location.pathname === basePath && tabParam === itemTabParam;
    }
    // Bare /patients = Economic Pulse only (not when another ?tab= is selected)
    if (basePath === "/patients") {
      return location.pathname === "/patients" && !tabParam;
    }
    return (
      location.pathname === basePath ||
      location.pathname.startsWith(basePath + "/")
    );
  };

  // Check if current path matches or starts with the nav item path.
  // Budget and Planning share /budget — Budget is active only for
  // budget-actual / budget-settings (or bare /budget). Items whose path
  // carries its own query string (e.g. Balance Sheet ->
  // /financial-reports?tab=balance-sheet) match on that query param
  // instead of the plain prefix check.
  const planningTabsOnBudgetPath = new Set(["profit-planning-treatment"]);
  const isPathActive = (path: string | undefined) => {
    if (!path) return false;
    const tabParam = new URLSearchParams(location.search).get("tab");
    const [basePath, query] = path.split("?");
    if (path === "/budget") {
      return (
        location.pathname === "/budget" &&
        (!tabParam || !planningTabsOnBudgetPath.has(tabParam))
      );
    }
    if (query) {
      const itemTabParam = new URLSearchParams(query).get("tab");
      return location.pathname === basePath && tabParam === itemTabParam;
    }
    return (
      location.pathname === basePath ||
      location.pathname.startsWith(basePath + "/")
    );
  };

  // Whether an item (or, recursively, any of its children/sub-items) is the
  // active route — used to highlight section and dropdown headers.
  const isItemActive = (item: NavItem): boolean => {
    if (item.children) return item.children.some(isItemActive);
    if (item.subItems) {
      return item.subItems.some((sub) => subItemMatchesLocation(sub.path));
    }
    return isPathActive(item.path);
  };

  // Auto-open dropdowns (and their parent section) when on a sub-page.
  useEffect(() => {
    const newOpenDropdowns = new Set<string>();
    const visit = (item: NavItem): boolean => {
      if (item.children) {
        const anyChildOpen = item.children.reduce(
          (open, child) => visit(child) || open,
          false,
        );
        if (anyChildOpen) newOpenDropdowns.add(item.label);
        return anyChildOpen;
      }
      if (item.dropdown && item.subItems) {
        const isSubItemActive = item.subItems.some((subItem) =>
          subItemMatchesLocation(subItem.path),
        );
        if (isSubItemActive) newOpenDropdowns.add(item.label);
        return isSubItemActive;
      }
      return isPathActive(item.path);
    };
    navItems.forEach(visit);
    setOpenDropdowns(newOpenDropdowns);
  }, [location.pathname, location.search]);

  // Keep the active sidebar item in view — including sub-items inside
  // dropdowns. MainLayout wraps every page, so navigating remounts the
  // sidebar and wipes its scroll position. Without this, items lower in the
  // nav (or sub-items in a just-opened dropdown) disappear above the viewport
  // after clicking.
  //
  // Deps: pathname (handles the remount after navigation) + openDropdowns
  // (handles the parent dropdown expanding its sub-items on mount or toggle).
  // requestAnimationFrame defers the scroll one frame so newly-rendered
  // dropdown contents are laid out before we measure their position.
  // block: 'nearest' only scrolls when the target is off-screen, so there's
  // no jitter when it's already visible.
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const raf = requestAnimationFrame(() => {
      // Prefer the deepest active item (a leaf sub-item, then a nested
      // dropdown header, then a section header) over shallower ones — same
      // class is applied at every level when a descendant is active.
      const active =
        nav.querySelector<HTMLElement>("ul ul ul .sidebar-sub-item-active") ||
        nav.querySelector<HTMLElement>("ul ul ul .sidebar-item-active") ||
        nav.querySelector<HTMLElement>("ul ul .sidebar-sub-item-active") ||
        nav.querySelector<HTMLElement>("ul ul .sidebar-item-active") ||
        nav.querySelector<HTMLElement>(".sidebar-sub-item-active") ||
        nav.querySelector<HTMLElement>(".sidebar-item-active");
      if (active) active.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname, openDropdowns]);

  const toggleDropdown = (label: string) => {
    setOpenDropdowns((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(label)) {
        newSet.delete(label);
      } else {
        newSet.add(label);
      }
      return newSet;
    });
  };

  const renderNavItem = (item: NavItem, index: number) => {
    // Section: a dropdown whose children are full nav items (rendered via
    // this same function), rather than leaf sub-items.
    if (item.dropdown && item.children) {
      const isOpen = searchTerm !== "" || openDropdowns.has(item.label);
      const isAnyChildActive = item.children.some(isItemActive);
      return (
        <li key={`${item.label}-${index}`}>
          <button
            onClick={() => toggleDropdown(item.label)}
            className={cn(
              "sidebar-item w-full",
              isAnyChildActive && "sidebar-item-active",
            )}
            title={item.label}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left font-semibold">
                  {item.label}
                </span>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 flex-shrink-0 transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                />
              </>
            )}
          </button>
          {!collapsed && isOpen && (
            <ul className="sidebar-sub">
              {item.children.map((child, childIndex) =>
                renderNavItem(child, childIndex),
              )}
            </ul>
          )}
        </li>
      );
    }

    if (item.dropdown) {
      // While searching, force every surviving dropdown open so its matching
      // sub-items (already filtered into displayNavItems) are visible.
      const isOpen = searchTerm !== "" || openDropdowns.has(item.label);
      const isAnySubItemActive = item.subItems?.some((subItem) =>
        subItemMatchesLocation(subItem.path),
      );
      return (
        <li key={`${item.label}-${index}`}>
          <button
            onClick={() => {
              toggleDropdown(item.label);
              if (item.path) {
                navigate(item.path);
              }
            }}
            className={cn(
              "sidebar-item w-full",
              isAnySubItemActive && "sidebar-item-active",
            )}
            title={item.label}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left font-medium">
                  {item.label}
                </span>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 flex-shrink-0 transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                />
              </>
            )}
          </button>
          {!collapsed && isOpen && item.subItems && (
            <ul className="sidebar-sub">
              {item.subItems.map((subItem) => {
                const isSubItemActive = subItemMatchesLocation(subItem.path);
                if (!subItem.path) {
                  return (
                    <li key={subItem.label}>
                      <span className="sidebar-sub-item cursor-default opacity-50 select-none">
                        {subItem.label}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={subItem.path}>
                    <NavLink
                      to={subItem.path}
                      className={cn(
                        "sidebar-sub-item",
                        isSubItemActive && "sidebar-sub-item-active",
                      )}
                      title={subItem.label}
                    >
                      {subItem.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      );
    }

    const isActive = isPathActive(item.path);

    return (
      <li key={item.path}>
        <NavLink
          to={item.path!}
          className={cn("sidebar-item", isActive && "sidebar-item-active")}
          title={item.label}
        >
          <item.icon className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>{item.label}</span>}
        </NavLink>
      </li>
    );
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-sidebar flex flex-col transition-all duration-300 z-50",
        collapsed ? "w-16" : "w-[17.5rem]",
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-center border-b border-sidebar-border overflow-hidden h-16">
        {collapsed ? (
          <img
            src={SITE_LOGOS.menuIcon}
            alt="DentPulse Enterprise"
            className="w-9 h-9"
          />
        ) : (
          <img
            src={SITE_LOGOS.logoLight}
            alt="DentPulse Enterprise"
            className="w-40 h-15"
          />
        )}
      </div>

      {/* Navigation */}
      <nav
        ref={navRef}
        className="flex-1 overflow-y-auto px-3 py-3.5 sidebar-scrollbar"
      >
        {firstNavItem && (
          <ul className="space-y-1">{renderNavItem(firstNavItem, 0)}</ul>
        )}

        {/* {!collapsed && (
          <div className="relative my-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-white text-foreground placeholder:text-muted-foreground border border-transparent focus:outline-none focus:ring-2 focus:ring-sidebar-ring"
            />
          </div>
        )} */}

        <ul className="space-y-1">
          {restNavItems.map((item, index) => renderNavItem(item, index))}
        </ul>
      </nav>

      {/* Collapse Button */}
      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="sidebar-item w-full justify-center"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
