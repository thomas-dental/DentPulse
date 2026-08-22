import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { User, Calendar, Users, Search, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface Provider {
  id: string;
  name: string;
  provider_role: string | null;
}

interface Alias {
  id: string;
  alias_name: string;
}

interface ChatMentionPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (value: string, type: 'provider' | 'period' | 'alias' | 'page') => void;
  anchorRef: React.RefObject<HTMLElement>;
  organizationId?: string;
  features?: {
    atMentions?: boolean;
  };
  /**
   * Optional live filter from the parent — when the user is composing an
   * @-mention in the chat input, this is the text typed after the '@'. The
   * picker filters its lists by this value automatically.
   */
  searchPrefilter?: string;
}

const PERIOD_TOKENS = [
  { label: 'This Month', value: 'This Month' },
  { label: 'Last Month', value: 'Last Month' },
  { label: 'This Quarter (FY)', value: 'This Quarter' },
  { label: 'Last Quarter (FY)', value: 'Last Quarter' },
  { label: 'Q1 (Apr-Jun)', value: 'Q1' },
  { label: 'Q2 (Jul-Sep)', value: 'Q2' },
  { label: 'Q3 (Oct-Dec)', value: 'Q3' },
  { label: 'Q4 (Jan-Mar)', value: 'Q4' },
  { label: 'This Financial Year', value: 'This Year' },
  { label: 'Last Financial Year', value: 'Last Year' },
  { label: 'YTD', value: 'YTD' },
  { label: 'Last 7 Days', value: 'Last 7 Days' },
  { label: 'Last 30 Days', value: 'Last 30 Days' },
  { label: 'Last 90 Days', value: 'Last 90 Days' },
];

// Page mentions: mirror the sidebar's visible navigation so users only see
// pages that actually exist. Labels match AppSidebar entries.
const PAGE_TOKENS = [
  { label: 'Dashboard', value: 'Dashboard', section: 'Overview' },
  { label: 'Cash Flow Statement', value: 'Cash Flow Statement', section: 'Cash Flow' },
  { label: 'Profitability Analysis', value: 'Profitability Analysis', section: 'Profitability' },
  { label: 'Profit Benchmark', value: 'Profit Benchmark', section: 'Profitability' },
  { label: 'Tax', value: 'Tax', section: 'Finance' },
  { label: 'Profit Planning by Treatment', value: 'Profit Planning by Treatment', section: 'Planning' },
  { label: 'Profit Planning by Associates', value: 'Profit Planning by Associates', section: 'Planning' },
  { label: 'Locations', value: 'Locations', section: 'Operations' },
  { label: 'Dentist', value: 'Dentist', section: 'Providers' },
  { label: 'Therapist', value: 'Therapist', section: 'Providers' },
  { label: 'Hygienist', value: 'Hygienist', section: 'Providers' },
  { label: 'Other Providers', value: 'Other Providers', section: 'Providers' },
  { label: 'Provider History', value: 'Provider History', section: 'Providers' },
  { label: 'Treatment Insights', value: 'Treatment Insights', section: 'Treatments' },
  { label: 'Private Treatment', value: 'Private Treatment', section: 'Treatments' },
  { label: 'Membership', value: 'Membership', section: 'Treatments' },
  { label: 'NHS', value: 'NHS', section: 'Treatments' },
  { label: 'Treatment Profitability', value: 'Treatment Profitability', section: 'Treatments' },
  { label: 'Treatment Setup', value: 'Treatment Setup', section: 'Treatments' },
  { label: 'Profit Goals', value: 'Profit Goals', section: 'Treatments' },
  { label: 'Specialties', value: 'Specialties', section: 'Operations' },
  { label: 'Chairs', value: 'Chairs', section: 'Operations' },
  { label: 'Accounts Payable', value: 'Accounts Payable', section: 'Costs' },
  { label: 'Lab Fees', value: 'Lab Fees', section: 'Cost Impact' },
  { label: 'Staff Costs', value: 'Staff Costs', section: 'Cost Impact' },
  { label: 'Operating Leases', value: 'Operating Leases', section: 'Cost Impact' },
  { label: 'Clinician Costs', value: 'Clinician Costs', section: 'Cost Impact' },
  { label: 'Overhead Costs', value: 'Overhead Costs', section: 'Cost Impact' },
  { label: 'Material Costs', value: 'Material Costs', section: 'Cost Impact' },
  { label: 'Marketing', value: 'Marketing', section: 'Growth' },
  { label: 'Organization', value: 'Organization', section: 'Admin' },
  { label: 'Admin', value: 'Admin', section: 'Admin' },
  { label: 'Enterprise Overview', value: 'Enterprise Overview', section: 'EBITDA to value' },
  { label: 'EBITDA Bridge', value: 'EBITDA Bridge', section: 'EBITDA to value' },
  { label: 'Quality Score', value: 'Quality Score', section: 'EBITDA to value' },
  { label: 'Multiple Engine', value: 'Multiple Engine', section: 'EBITDA to value' },
  { label: 'Value Drivers', value: 'Value Drivers', section: 'EBITDA to value' },
  { label: 'Scenario Simulator', value: 'Scenario Simulator', section: 'EBITDA to value' },
  { label: 'Exit Cockpit', value: 'Exit Cockpit', section: 'EBITDA to value' },
  { label: 'Due Diligence', value: 'Due Diligence', section: 'EBITDA to value' },
  { label: 'Group Heatmap', value: 'Group Heatmap', section: 'EBITDA to value' },
];

export function ChatMentionPicker({ open, onClose, onSelect, anchorRef, organizationId, features, searchPrefilter }: ChatMentionPickerProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [search, setSearch] = useState('');
  const { session } = useAuth();

  // When the parent supplies a live mention fragment (the user typing after
  // '@' in the chat input), keep the picker's internal search synced to it so
  // results filter in real time without requiring an extra click into the
  // search box.
  useEffect(() => {
    if (typeof searchPrefilter === 'string') {
      setSearch(searchPrefilter);
    }
  }, [searchPrefilter]);

  useEffect(() => {
    if (open && organizationId) {
      loadProviders();
      loadAliases();
    }
  }, [open, organizationId]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  async function loadProviders() {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${backendUrl}/api/chatbot/providers/${organizationId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) setProviders(await res.json());
    } catch { /* silent */ }
  }

  async function loadAliases() {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${backendUrl}/api/chatbot/aliases/${organizationId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) setAliases(await res.json() || []);
    } catch { /* silent */ }
  }

  const lower = search.toLowerCase();
  const filteredProviders = providers.filter(p => p.name.toLowerCase().includes(lower)).slice(0, 10);
  const filteredPeriods = PERIOD_TOKENS.filter(p => p.label.toLowerCase().includes(lower));
  const filteredAliases = aliases.filter(a => a.alias_name.toLowerCase().includes(lower));
  const filteredPages = PAGE_TOKENS.filter(p => p.label.toLowerCase().includes(lower));

  return (
    <Popover open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <PopoverTrigger asChild>
        <span ref={anchorRef as any} className="absolute" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0 ml-3"
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Search input */}
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers, periods, pages..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Scrollable list */}
        <div className="max-h-[260px] overflow-y-auto p-1" onWheel={(e) => e.stopPropagation()}>
          {filteredProviders.length === 0 && filteredPeriods.length === 0 && filteredAliases.length === 0 && filteredPages.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No results found</p>
          )}

          {/* Providers */}
          {filteredProviders.length > 0 && (
            <div>
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Providers</p>
              {filteredProviders.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onSelect(p.name, 'provider'); onClose(); }}
                  className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-primary hover:text-white cursor-pointer"
                >
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 text-left">{p.name}</span>
                  {p.provider_role && (
                    <span className="text-[10px] text-muted-foreground group-hover:text-white/80">{p.provider_role}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Periods */}
          {filteredPeriods.length > 0 && (
            <div>
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Periods</p>
              {filteredPeriods.map(p => (
                <button
                  key={p.value}
                  onClick={() => { onSelect(p.value, 'period'); onClose(); }}
                  className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-primary hover:text-white cursor-pointer"
                >
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 text-left">{p.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Aliases */}
          {filteredAliases.length > 0 && (
            <div>
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">My Aliases</p>
              {filteredAliases.map(a => (
                <button
                  key={a.id}
                  onClick={() => { onSelect(a.alias_name, 'alias'); onClose(); }}
                  className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-primary hover:text-white cursor-pointer"
                >
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 text-left">@{a.alias_name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Pages */}
          {filteredPages.length > 0 && (
            <div>
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Pages</p>
              {filteredPages.map(p => (
                <button
                  key={p.value}
                  onClick={() => { onSelect(p.value, 'page'); onClose(); }}
                  className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-primary hover:text-white cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 text-left">{p.label}</span>
                  <span className="text-[10px] text-muted-foreground group-hover:text-white/80">{p.section}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
