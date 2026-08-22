import { useState, useEffect, useRef } from "react";
import { CheckCircle2, Loader2, Globe, User, Key, Sparkles, SkipForward, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { INTEGRATION_LOGOS } from "@/lib/integrationLogos";
import { supabase } from "@/integrations/supabase/client";

interface AccountingSoftwareStepProps {
  organizationId: string;
  onComplete: () => void;
}

type PlatformId = "xero" | "quickbooks" | "iplicit";

const platforms: { id: PlatformId; name: string; logo: string; color: string; bg: string; comingSoon: boolean }[] = [
  { id: "xero",       name: "Xero",       logo: INTEGRATION_LOGOS.xero,       color: "#13B5EA", bg: "rgba(19,181,234,0.08)", comingSoon: false },
  { id: "quickbooks", name: "QuickBooks", logo: INTEGRATION_LOGOS.quickbooks, color: "#2CA01C", bg: "rgba(44,160,28,0.08)",  comingSoon: true  },
  { id: "iplicit",    name: "iplicit",    logo: INTEGRATION_LOGOS.iplicit,    color: "#6366F1", bg: "rgba(99,102,241,0.08)", comingSoon: false },
];

// Resolve backend URL
let BACKEND_URL = "http://localhost:4000";
if (typeof window !== "undefined" && window?.location?.hostname) {
  const hostname = window.location.hostname;
  const isLocal = hostname === "localhost" || hostname.startsWith("127.");
  const isLAN   = hostname.startsWith("192.168.") || hostname.startsWith("10.");
  BACKEND_URL =
    import.meta.env.VITE_SYNC_BACKEND_URL ||
    (isLocal ? "http://localhost:4000" : isLAN ? "" : "https://dent-enterprise-api.dentpulse.com");
}

const AccountingSoftwareStep = ({ organizationId, onComplete }: AccountingSoftwareStepProps) => {
  const { session } = useAuth();
  const [selected,        setSelected]        = useState<PlatformId | null>(null);
  const [domain,          setDomain]          = useState("");
  const [username,        setUsername]        = useState("");
  const [apiKey,          setApiKey]          = useState("");
  const [isConnecting,    setIsConnecting]    = useState(false);
  const [connected,       setConnected]       = useState(false);
  const [isSkipping,      setIsSkipping]      = useState(false);
  const [isConnectingXero, setIsConnectingXero] = useState(false);
  const xeroPopupRef = useRef<Window | null>(null);

  // Listen for Xero OAuth popup message
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type !== 'XERO_AUTH_SUCCESS') return;
      // Close popup if still open
      if (xeroPopupRef.current && !xeroPopupRef.current.closed) {
        xeroPopupRef.current.close();
      }
      setIsConnectingXero(false);
      setConnected(true);
      toast.success('Xero connected! Financial data sync running in background.', { duration: 4000 });

      // Fire backend sync in background (non-blocking)
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (token && organizationId) {
          fetch(`${BACKEND_URL}/api/xero-sync/trigger/${organizationId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(err => console.warn('[XeroOnboard] Background sync trigger failed:', err.message));
        }
      } catch (e) {
        // Non-fatal — sync can be triggered manually from settings
      }

      setTimeout(() => onComplete(), 1500);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onComplete, organizationId]);

  const handleXeroConnect = async () => {
    if (!organizationId) return;
    setIsConnectingXero(true);
    try {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData?.session) {
        toast.error('Session expired. Please log in again.');
        setIsConnectingXero(false);
        return;
      }
      const response = await supabase.functions.invoke('xero-auth', {
        // Onboarding first connect → silent SSO (no forced login / MFA churn).
        // Explicit for consistency with the Settings hub contract.
        body: { organizationId, currentOrigin: window.location.origin, forceXeroLogin: false },
      });
      if (response.error) throw new Error(response.error.message || 'Failed to initiate Xero OAuth');
      const { authorizationUrl } = response.data;
      if (!authorizationUrl) throw new Error('No authorization URL received');

      // Open OAuth in popup
      const popup = window.open(
        authorizationUrl,
        'xero-auth',
        'width=620,height=720,left=' + Math.round((screen.width - 620) / 2) + ',top=' + Math.round((screen.height - 720) / 2) + ',toolbar=no,menubar=no,scrollbars=yes'
      );
      xeroPopupRef.current = popup;

      // Poll for popup closed without completing (user cancelled)
      const poll = setInterval(() => {
        if (popup && popup.closed) {
          clearInterval(poll);
          setIsConnectingXero(false);
        }
      }, 500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to connect Xero');
      setIsConnectingXero(false);
    }
  };

  const handleConnect = async () => {
    if (!domain.trim() || !username.trim() || !apiKey.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    setIsConnecting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/onboard/iplicit`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId,
          domain:   domain.trim(),
          username: username.trim(),
          apiKey:   apiKey.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to connect iplicit");

      setConnected(true);
      toast.success(
        `iplicit connected! ${data.jobCount} sync jobs started in background.`,
        { duration: 4000 }
      );
      setTimeout(() => onComplete(), 1500);
    } catch (err: any) {
      toast.error(err.message || "Failed to connect iplicit");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background via-background to-primary/5 p-8">

      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-violet-500/8 blur-3xl" />

      {/* Two-column layout */}
      <div className="relative flex gap-5 items-start">

        {/* LEFT: Compact vertical sync pipeline */}
        <div className="flex-shrink-0 flex flex-col items-center pt-12 w-[72px]">

          {/* Node: Dentally */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-gradient-to-br from-blue-500 to-cyan-500 vp-nd">
            🦷
          </div>
          <p className="text-[10px] font-semibold text-foreground mt-1">Dentally</p>

          {/* Flowing data pipe */}
          <div className="relative flex flex-col items-center my-2 h-10">
            <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-full bg-green-200 rounded-full" />
            <div className="vp-dot vp-dot1 absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-green-500" />
            <div className="vp-dot vp-dot2 absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-green-400" />
            <div className="vp-dot vp-dot3 absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-green-300" />
          </div>

          {/* Node: DentPulse */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center vp-np"
            style={{ background: "hsl(var(--primary))", border: "2px solid hsl(var(--primary))" }}>
            <img src="https://fpqesehkowpvxraommsc.supabase.co/storage/v1/object/public/site-logo/DentPulseLIghtMenu.svg" alt="DentPulse" className="w-7 h-7 object-contain" />
          </div>
          <p className="text-[10px] font-semibold text-foreground mt-1">DentPulse</p>

          {/* Live status */}
          <div className="flex flex-col items-center gap-1 mt-3 pt-3 border-t border-border/40 w-full">
            <span className="relative w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75"/>
              <span className="block w-2 h-2 rounded-full bg-green-500"/>
            </span>
            <p className="text-[9px] text-green-600 font-semibold text-center tracking-wide uppercase">Live</p>
          </div>
        </div>

        {/* Vertical divider */}
        <div className="w-px self-stretch bg-border/50 flex-shrink-0 mt-1" />

        {/* RIGHT: Main content */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Header */}
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              Step 2 of 2
            </div>
            <h2 className="text-2xl font-bold text-foreground">Connect Accounting Software</h2>
            <p className="text-muted-foreground text-sm">
              Link your accounting platform to unlock profit & loss reports, invoice sync, and real-time financial insights.
            </p>
          </div>

          {/* Platform cards */}
          <div className="flex gap-4 flex-wrap">
            {platforms.map((p, i) => {
              const isSelected = selected === p.id && !connected;
              const isDone     = connected && selected === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => { if (!p.comingSoon && !connected) setSelected(isSelected ? null : p.id as PlatformId); }}
                  style={{ "--card-delay": `${i * 90}ms`, "--p-color": p.color, "--p-bg": p.bg } as React.CSSProperties}
                  className={[
                    "acct2-card relative flex flex-col items-center gap-2.5 p-4 w-36 rounded-2xl border",
                    p.comingSoon ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    isSelected ? "acct2-card--sel" : "",
                    isDone     ? "acct2-card--done" : "",
                  ].filter(Boolean).join(" ")}
                >
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: p.bg, border: `1.5px solid ${p.color}30` }}>
                    <img src={p.logo} alt={p.name} className="w-9 h-9 object-contain" />
                  </div>
                  <span className="font-semibold text-sm text-foreground">{p.name}</span>
                  {p.comingSoon && <Badge variant="secondary" className="text-xs py-0">Coming soon</Badge>}
                  {isDone && (
                    <span className="flex items-center gap-1 text-xs text-green-600 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                    </span>
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 rounded-2xl pointer-events-none"
                      style={{ boxShadow: `0 0 0 2px ${p.color}, 0 8px 32px ${p.color}30` }} />
                  )}
                </div>
              );
            })}

            {/* Skip For Now card */}
            {!connected && (
              <div
                onClick={() => {
                  if (isSkipping) return;
                  setIsSkipping(true);
                  onComplete();
                }}
                style={{ "--card-delay": `${platforms.length * 90}ms` } as React.CSSProperties}
                className={`acct2-card acct2-card--skip relative flex flex-col items-center gap-2.5 p-4 w-36 rounded-2xl border border-dashed border-muted-foreground/40 ${isSkipping ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-muted/60">
                  {isSkipping
                    ? <Loader2 className="w-7 h-7 text-muted-foreground animate-spin" />
                    : <SkipForward className="w-7 h-7 text-muted-foreground" />
                  }
                </div>
                <span className="font-semibold text-sm text-foreground text-center">
                  {isSkipping ? "Skipping…" : "Skip For Now"}
                </span>
                <span className="text-[10px] text-muted-foreground text-center leading-tight">Connect later from Settings</span>
              </div>
            )}
          </div>

          {/* Xero OAuth section */}
          {selected === "xero" && !connected && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-border/60">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(19,181,234,0.1)" }}>
                  <img src={INTEGRATION_LOGOS.xero} alt="Xero" className="w-4 h-4 object-contain" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">Connect to Xero</h3>
                  <p className="text-xs text-muted-foreground">Authorize via Xero — a popup will open for secure login</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl bg-[rgba(19,181,234,0.06)] border border-[rgba(19,181,234,0.2)]">
                <ExternalLink className="w-4 h-4 text-[#13B5EA] mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Clicking <strong className="text-foreground">Connect with Xero</strong> will open a secure Xero login popup.
                  Complete authorization there and this page will update automatically.
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="gap-2 px-5"
                  style={{ background: "#13B5EA" }}
                  onClick={handleXeroConnect}
                  disabled={isConnectingXero}
                >
                  {isConnectingXero ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for Xero…</>
                  ) : (
                    <><ExternalLink className="w-3.5 h-3.5" /> Connect with Xero</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* iplicit credentials form */}
          {selected === "iplicit" && !connected && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-border/60">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(99,102,241,0.1)" }}>
                  <img src={INTEGRATION_LOGOS.iplicit} alt="iplicit" className="w-4 h-4 object-contain" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">iplicit Credentials</h3>
                  <p className="text-xs text-muted-foreground">Encrypted and stored securely</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <Globe className="w-4 h-4 text-primary" /> iplicit Domain *
                  </Label>
                  <Input placeholder="e.g., yourcompany.demo" className="h-9" value={domain}
                    onChange={e => setDomain(e.target.value)} disabled={isConnecting} />
                  <p className="text-xs text-muted-foreground">Without https://</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <User className="w-4 h-4 text-primary" /> API Username *
                  </Label>
                  <Input placeholder="Enter your iplicit username" className="h-9" value={username}
                    onChange={e => setUsername(e.target.value)} disabled={isConnecting} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <Key className="w-4 h-4 text-primary" /> API Key *
                  </Label>
                  <Input type="password" placeholder="Enter your iplicit API key" className="h-9" value={apiKey}
                    onChange={e => setApiKey(e.target.value)} disabled={isConnecting} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" className="gap-2 px-5" onClick={handleConnect}
                  disabled={isConnecting || !domain || !username || !apiKey}>
                  {isConnecting ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</>
                  ) : (
                    "Connect iplicit"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Success banner */}
          {connected && (
            <div className="flex items-center gap-4 p-4 rounded-xl bg-green-500/10 border border-green-500/25">
              <div className="w-9 h-9 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm text-green-700 dark:text-green-400">
                  {selected === "xero" ? "Xero" : "iplicit"} connected successfully!
                </p>
                <p className="text-xs text-green-600/80 dark:text-green-500/80 mt-0.5">Financial data sync running in background…</p>
              </div>
              <Loader2 className="w-4 h-4 animate-spin text-green-600 flex-shrink-0" />
            </div>
          )}
        </div>
      </div>

      <style>{`
        /* Chevron wave */
        @keyframes vpDotFlow {
          0%   { top: 0%;   opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .vp-dot  { animation: vpDotFlow 1.4s ease-in-out infinite; }
        .vp-dot1 { animation-delay: 0s; }
        .vp-dot2 { animation-delay: 0.47s; }
        .vp-dot3 { animation-delay: 0.94s; }
        /* Sequential node glow */
        @keyframes vpNodePulse {
          0%   { box-shadow: none; }
          8%   { box-shadow: 0 0 0 5px var(--ng), 0 0 18px var(--ng); }
          35%  { box-shadow: 0 0 0 2px var(--ngs); }
          100% { box-shadow: none; }
        }
        .vp-nd { animation: vpNodePulse 2.1s ease-out infinite; animation-delay: 0s;   --ng: rgba(56,189,248,0.65);  --ngs: rgba(56,189,248,0.12); }
        .vp-ns { animation: vpNodePulse 2.1s ease-out infinite; animation-delay: 0.7s; --ng: rgba(34,197,94,0.65);   --ngs: rgba(34,197,94,0.12);  }
        .vp-np { animation: vpNodePulse 2.1s ease-out infinite; animation-delay: 1.4s; --ng: rgba(99,102,241,0.65);  --ngs: rgba(99,102,241,0.12); }
        /* Platform cards */
        @keyframes acct2SlideUp {
          from { opacity: 0; translate: 0 16px; }
          to   { opacity: 1; translate: 0 0; }
        }
        .acct2-card {
          background: hsl(var(--card));
          animation: acct2SlideUp 0.45s cubic-bezier(0.22,1,0.36,1) both;
          animation-delay: var(--card-delay, 0ms);
          transition: transform .35s cubic-bezier(0.34,1.56,0.64,1), box-shadow .25s ease, border-color .25s ease, background .25s ease;
        }
        .acct2-card:hover   { transform: translateY(-8px); background: var(--p-bg); border-color: var(--p-color) !important; box-shadow: 0 16px 40px color-mix(in srgb, var(--p-color) 20%, transparent); }
        .acct2-card--sel    { background: var(--p-bg) !important; border-color: var(--p-color) !important; transform: translateY(-6px); }
        .acct2-card--done   { background: rgba(34,197,94,0.06) !important; border-color: #22c55e !important; }
        .acct2-card--skip:hover { transform: translateY(-8px); background: hsl(var(--muted)) !important; border-color: hsl(var(--muted-foreground) / 0.6) !important; box-shadow: 0 16px 40px hsl(var(--muted-foreground) / 0.12); }
      `}</style>
    </div>
  );
};

export default AccountingSoftwareStep;
