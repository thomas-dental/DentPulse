/**
 * UI-only onboarding preview — no auth, no DB, no API calls.
 * Visit: /onboarding-preview
 *
 * Forms mirror the real onboarding components exactly:
 *   DentallyIntegrationStep  → DentallyConnect
 *   AccountingSoftwareStep   → AccountingSoftware
 *   OrganizationStep         → ManualOrganisation (step 1)
 */

import { useState } from "react";
import {
  ClipboardList, ArrowLeft, ArrowRight, Key, Building2, MapPin, Users,
  Settings, CheckSquare, Check, Sparkles, Loader2, Globe, Mail, Phone,
  CheckCircle2, ExternalLink, User, SkipForward, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTEGRATION_LOGOS } from "@/lib/integrationLogos";

// ─── Types ───────────────────────────────────────────────────────────────────
type Flow = null | "dentally" | "manual";
type DentallyStep = 1 | 2;
type ManualStep = 1 | 2 | 3 | 4 | 5;

const DENTALLY_STEPS = [
  { id: 1, title: "Dentally Integration", description: "Connect & sync data" },
  { id: 2, title: "Accounting Software",  description: "Connect your accounting platform" },
];
const MANUAL_STEPS = [
  { id: 1, title: "Organisation", description: "Basic information",      icon: Building2 },
  { id: 2, title: "Practices",    description: "Location details",       icon: MapPin },
  { id: 3, title: "Team",         description: "Add team members",       icon: Users },
  { id: 4, title: "Settings",     description: "Configure preferences",  icon: Settings },
  { id: 5, title: "Complete",     description: "Review & finish",        icon: CheckSquare },
];

const ACCOUNTING_PLATFORMS = [
  { id: "xero",       name: "Xero",       logo: INTEGRATION_LOGOS.xero,       color: "#13B5EA", bg: "rgba(19,181,234,0.08)", comingSoon: false },
  { id: "quickbooks", name: "QuickBooks", logo: INTEGRATION_LOGOS.quickbooks, color: "#2CA01C", bg: "rgba(44,160,28,0.08)",  comingSoon: true  },
  { id: "iplicit",    name: "iplicit",    logo: INTEGRATION_LOGOS.iplicit,    color: "#6366F1", bg: "rgba(99,102,241,0.08)", comingSoon: false },
];

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ steps, current }: { steps: { id: number; title: string; description: string }[]; current: number }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm border-2 transition-all ${
              s.id < current   ? "bg-primary border-primary text-white" :
              s.id === current ? "bg-primary border-primary text-white scale-110 shadow-lg shadow-primary/30" :
              "bg-muted border-border text-muted-foreground"
            }`}>
              {s.id < current ? <Check className="w-4 h-4" /> : s.id}
            </div>
            <p className={`text-[10px] mt-1 font-semibold ${s.id === current ? "text-primary" : "text-muted-foreground"}`}>{s.title}</p>
            <p className="text-[9px] text-muted-foreground">{s.description}</p>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-12 h-0.5 mb-5 mx-1 ${s.id < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Flow selector ────────────────────────────────────────────────────────────
function FlowSelector({ onSelect }: { onSelect: (f: "dentally" | "manual") => void }) {
  const cards = [
    { id: "dentally" as const, title: "Yes, I use Dentally",  subtitle: "Connect your Dentally account for automatic data sync", color: "#2563EB", bg: "rgba(37,99,235,0.08)" },
    { id: "manual"   as const, title: "I don't use Dentally", subtitle: "Set up your organisation manually in a few steps",       color: "#7C3AED", bg: "rgba(124,58,237,0.08)" },
  ];

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">How do you manage your dental data?</h2>
          <p className="text-sm text-muted-foreground">Choose your setup path — you can always change this later from Settings.</p>
        </div>

        <div className="flex gap-5 justify-center flex-wrap">
          {cards.map((card, i) => (
            <div
              key={card.id}
              onClick={() => onSelect(card.id)}
              style={{ "--card-delay": `${i * 120}ms`, "--p-color": card.color, "--p-bg": card.bg } as React.CSSProperties}
              className="ob-flow-card relative flex flex-col items-center gap-3 p-6 w-52 rounded-2xl border cursor-pointer"
            >
              <div
                className={card.id === "dentally" ? "w-16 h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-500" : "w-16 h-16 rounded-2xl flex items-center justify-center"}
                style={card.id !== "dentally" ? { background: card.bg, border: `1.5px solid ${card.color}30` } : undefined}
              >
                {card.id === "dentally" ? <span className="text-2xl">🦷</span> : <ClipboardList className="w-8 h-8" style={{ color: card.color }} />}
              </div>
              <div className="text-center space-y-1">
                <p className="font-semibold text-sm text-foreground leading-tight">{card.title}</p>
                <p className="text-xs text-muted-foreground leading-snug">{card.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes obCardSlideUp { from{opacity:0;translate:0 16px} to{opacity:1;translate:0 0} }
        .ob-flow-card { background:hsl(var(--card)); animation:obCardSlideUp .45s cubic-bezier(.22,1,.36,1) both; animation-delay:var(--card-delay,0ms); transition:transform .35s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease,border-color .25s ease,background .25s ease; }
        .ob-flow-card:hover { transform:translateY(-8px); background:var(--p-bg); border-color:var(--p-color)!important; box-shadow:0 16px 40px color-mix(in srgb,var(--p-color) 18%,transparent); }
      `}</style>
    </div>
  );
}

// ─── Dentally step 1: exactly matches DentallyIntegrationStep ─────────────────
function DentallyConnect({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  const handleConnect = () => {
    if (!apiKey.trim()) return;
    setIsConnecting(true);
    setStatusMessage("Validating API key...");
    setTimeout(() => setStatusMessage("Setting up organizations & sync..."), 700);
    setTimeout(() => {
      setIsConnecting(false);
      setStatusMessage(null);
      setSynced(true);
      setTimeout(() => onNext(), 800);
    }, 1800);
  };

  return (
    <div className="ob-slide-in space-y-8 animate-fade-in w-full relative">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center">
          <img
            src="/icons/logo-d95916a4.png"
            alt="Dentally Logo"
            style={{ width: "200px", height: "100%", objectFit: "contain" }}
          />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Connect Dentally</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Enter your Dentally API key to connect and sync your practice data.
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* API Key Input */}
        <div className="space-y-2">
          <Label htmlFor="apiKey" className="text-sm font-medium">
            Dentally API Key <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="apiKey"
              type="password"
              placeholder="Enter your Dentally API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={isConnecting || synced}
              className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            You can find your API key in your Dentally account settings
          </p>
        </div>

        {/* Connect Button */}
        {!synced ? (
          <Button
            onClick={handleConnect}
            disabled={isConnecting || !apiKey.trim()}
            className="w-full h-12 gap-2"
            size="lg"
          >
            {isConnecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{statusMessage || "Connecting..."}</>
            ) : (
              <>Connect</>
            )}
          </Button>
        ) : (
          <Button disabled className="w-full h-12 gap-2 bg-green-600 hover:bg-green-600" size="lg">
            <CheckCircle2 className="w-4 h-4" />
            Connected - Syncing Data
          </Button>
        )}

        {/* Back */}
        <div className="flex pt-2">
          <Button variant="outline" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Change setup path
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Dentally step 2: exactly matches AccountingSoftwareStep ──────────────────
function AccountingSoftware({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [selected, setSelected]         = useState<string | null>(null);
  const [connected, setConnected]       = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSkipping, setIsSkipping]     = useState(false);
  const [domain, setDomain]             = useState("");
  const [username, setUsername]         = useState("");
  const [apiKey, setApiKey]             = useState("");
  const [isXeroWaiting, setIsXeroWaiting] = useState(false);

  const handleIplicitConnect = () => {
    if (!domain.trim() || !username.trim() || !apiKey.trim()) return;
    setIsConnecting(true);
    setTimeout(() => { setIsConnecting(false); setConnected(true); setTimeout(() => onNext(), 1500); }, 1800);
  };

  const handleXeroConnect = () => {
    setIsXeroWaiting(true);
    setTimeout(() => { setIsXeroWaiting(false); setConnected(true); setTimeout(() => onNext(), 1500); }, 2000);
  };

  const handleSkip = () => { setIsSkipping(true); onNext(); };

  return (
    <div className="ob-slide-in relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background via-background to-primary/5 p-8">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-violet-500/8 blur-3xl" />

      {/* Two-column layout */}
      <div className="relative flex gap-5 items-start">

        {/* LEFT: Compact vertical sync pipeline */}
        <div className="flex-shrink-0 flex flex-col items-center pt-12 w-[72px]">
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

          <div className="w-11 h-11 rounded-xl flex items-center justify-center vp-np"
            style={{ background: "hsl(var(--primary))", border: "2px solid hsl(var(--primary))" }}>
            <img src="https://fpqesehkowpvxraommsc.supabase.co/storage/v1/object/public/site-logo/DentPulseLIghtMenu.svg" alt="DentPulse" className="w-7 h-7 object-contain" />
          </div>
          <p className="text-[10px] font-semibold text-foreground mt-1">DentPulse</p>

          <div className="flex flex-col items-center gap-1 mt-3 pt-3 border-t border-border/40 w-full">
            <span className="relative w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
              <span className="block w-2 h-2 rounded-full bg-green-500" />
            </span>
            <p className="text-[9px] text-green-600 font-semibold text-center tracking-wide uppercase">Live</p>
          </div>
        </div>

        {/* Vertical divider */}
        <div className="w-px self-stretch bg-border/50 flex-shrink-0 mt-1" />

        {/* RIGHT: Main content */}
        <div className="flex-1 min-w-0 space-y-6">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" /> Step 2 of 2
            </div>
            <h2 className="text-2xl font-bold text-foreground">Connect Accounting Software</h2>
            <p className="text-muted-foreground text-sm">
              Link your accounting platform to unlock profit &amp; loss reports, invoice sync, and real-time financial insights.
            </p>
          </div>

          {/* Platform cards */}
          <div className="flex gap-4 flex-wrap">
            {ACCOUNTING_PLATFORMS.map((p, i) => {
              const isSelected = selected === p.id && !connected;
              const isDone     = connected && selected === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => { if (!p.comingSoon && !connected) setSelected(isSelected ? null : p.id); }}
                  style={{ "--card-delay": `${i * 90}ms`, "--p-color": p.color, "--p-bg": p.bg } as React.CSSProperties}
                  className={[
                    "acct2-card relative flex flex-col items-center gap-2.5 p-4 w-36 rounded-2xl border",
                    p.comingSoon ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    isSelected ? "acct2-card--sel" : "",
                    isDone ? "acct2-card--done" : "",
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

            {/* Skip For Now */}
            {!connected && (
              <div
                onClick={handleSkip}
                style={{ "--card-delay": `${ACCOUNTING_PLATFORMS.length * 90}ms` } as React.CSSProperties}
                className={`acct2-card acct2-card--skip relative flex flex-col items-center gap-2.5 p-4 w-36 rounded-2xl border border-dashed border-muted-foreground/40 ${isSkipping ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-muted/60">
                  {isSkipping ? <Loader2 className="w-7 h-7 text-muted-foreground animate-spin" /> : <SkipForward className="w-7 h-7 text-muted-foreground" />}
                </div>
                <span className="font-semibold text-sm text-foreground text-center">{isSkipping ? "Skipping…" : "Skip For Now"}</span>
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
                <Button size="sm" className="gap-2 px-5" style={{ background: "#13B5EA" }} onClick={handleXeroConnect} disabled={isXeroWaiting}>
                  {isXeroWaiting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for Xero…</> : <><ExternalLink className="w-3.5 h-3.5" /> Connect with Xero</>}
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
                  <Input placeholder="e.g., yourcompany.demo" className="h-9" value={domain} onChange={e => setDomain(e.target.value)} disabled={isConnecting} />
                  <p className="text-xs text-muted-foreground">Without https://</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <User className="w-4 h-4 text-primary" /> API Username *
                  </Label>
                  <Input placeholder="Enter your iplicit username" className="h-9" value={username} onChange={e => setUsername(e.target.value)} disabled={isConnecting} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <Key className="w-4 h-4 text-primary" /> API Key *
                  </Label>
                  <Input type="password" placeholder="Enter your iplicit API key" className="h-9" value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={isConnecting} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" className="gap-2 px-5" onClick={handleIplicitConnect} disabled={isConnecting || !domain || !username || !apiKey}>
                  {isConnecting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : "Connect iplicit"}
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

          {/* Back */}
          <div className="flex pt-2">
            <Button variant="outline" onClick={onBack} className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes vpDotFlow { 0%{top:0%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:100%;opacity:0} }
        .vp-dot  { animation:vpDotFlow 1.4s ease-in-out infinite; }
        .vp-dot1 { animation-delay:0s; }
        .vp-dot2 { animation-delay:0.47s; }
        .vp-dot3 { animation-delay:0.94s; }
        @keyframes vpNodePulse { 0%{box-shadow:none} 8%{box-shadow:0 0 0 5px var(--ng),0 0 18px var(--ng)} 35%{box-shadow:0 0 0 2px var(--ngs)} 100%{box-shadow:none} }
        .vp-nd { animation:vpNodePulse 2.1s ease-out infinite; animation-delay:0s;   --ng:rgba(56,189,248,0.65); --ngs:rgba(56,189,248,0.12); }
        .vp-np { animation:vpNodePulse 2.1s ease-out infinite; animation-delay:1.4s; --ng:rgba(99,102,241,0.65); --ngs:rgba(99,102,241,0.12); }
        @keyframes acct2SlideUp { from{opacity:0;translate:0 16px} to{opacity:1;translate:0 0} }
        .acct2-card { background:hsl(var(--card)); animation:acct2SlideUp .45s cubic-bezier(.22,1,.36,1) both; animation-delay:var(--card-delay,0ms); transition:transform .35s cubic-bezier(.34,1.56,.64,1),box-shadow .25s ease,border-color .25s ease,background .25s ease; }
        .acct2-card:hover { transform:translateY(-8px); background:var(--p-bg); border-color:var(--p-color)!important; box-shadow:0 16px 40px color-mix(in srgb,var(--p-color) 20%,transparent); }
        .acct2-card--sel  { background:var(--p-bg)!important; border-color:var(--p-color)!important; transform:translateY(-6px); }
        .acct2-card--done { background:rgba(34,197,94,0.06)!important; border-color:#22c55e!important; }
        .acct2-card--skip:hover { transform:translateY(-8px); background:hsl(var(--muted))!important; border-color:hsl(var(--muted-foreground)/0.6)!important; box-shadow:0 16px 40px hsl(var(--muted-foreground)/0.12); }
      `}</style>
    </div>
  );
}

// ─── Manual step 1: exactly matches OrganizationStep ──────────────────────────
function ManualOrganisation({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [name,          setName]          = useState("Bright Smiles Dental Group");
  const [legalName,     setLegalName]     = useState("Bright Smiles Holdings LLC");
  const [website,       setWebsite]       = useState("https://www.brightsmiles.com");
  const [email,         setEmail]         = useState("admin@brightsmiles.com");
  const [phone,         setPhone]         = useState("+44 (000) 000-0000");
  const [practiceCount, setPracticeCount] = useState("");
  const [address,       setAddress]       = useState("123 High Street, London, SW1A 1AA");
  const [description,   setDescription]   = useState("");

  return (
    <div className="ob-slide-in space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Tell us about your organization</h2>
        <p className="text-muted-foreground max-w-md mx-auto">Let's start with the basics about your dental group</p>
      </div>

      {/* Logo Upload (UI-only mock) */}
      <div className="flex flex-col items-center gap-3">
        <Label className="text-sm font-medium">Organization Logo</Label>
        <div className="max-w-xs w-full border-2 border-dashed border-border/60 rounded-xl flex flex-col items-center justify-center gap-2 py-8 px-4 cursor-pointer hover:border-primary/50 transition-colors">
          <Upload className="w-6 h-6 text-primary" />
          <span className="text-sm text-primary font-medium">Click to upload or drag &amp; drop</span>
          <span className="text-xs text-muted-foreground">PNG, JPG up to 5MB</span>
        </div>
        <p className="text-xs text-muted-foreground">Upload your logo (PNG, JPG up to 5MB)</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="org-name" className="text-sm font-medium">Organization Name <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="org-name" placeholder="Bright Smiles Dental Group" value={name} onChange={e => setName(e.target.value)} className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="legal-name" className="text-sm font-medium">Legal Entity Name</Label>
          <Input id="legal-name" placeholder="Bright Smiles Holdings LLC" value={legalName} onChange={e => setLegalName(e.target.value)} className="h-12 bg-background border-border/50 focus:border-primary transition-colors" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="website" className="text-sm font-medium">Website</Label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="website" placeholder="https://www.brightsmiles.com" value={website} onChange={e => setWebsite(e.target.value)} className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">Primary Email <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="email" type="email" placeholder="admin@brightsmiles.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone" className="text-sm font-medium">Phone Number <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="phone" type="tel" placeholder="+44 (000) 000-0000" value={phone} onChange={e => setPhone(e.target.value)} className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="practice-count" className="text-sm font-medium">Number of Practices <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <Select value={practiceCount} onValueChange={setPracticeCount}>
              <SelectTrigger className="pl-10 h-12 bg-background border-border/50 focus:border-primary">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1-5">1-5 practices</SelectItem>
                <SelectItem value="6-15">6-15 practices</SelectItem>
                <SelectItem value="16-30">16-30 practices</SelectItem>
                <SelectItem value="31-50">31-50 practices</SelectItem>
                <SelectItem value="50+">50+ practices</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="address" className="text-sm font-medium">Headquarters Address</Label>
          <div className="relative">
            <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input id="address" placeholder="123 High Street, London, SW1A 1AA" value={address} onChange={e => setAddress(e.target.value)} className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors" />
          </div>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description" className="text-sm font-medium">Brief Description</Label>
          <Textarea
            id="description"
            placeholder="Tell us a bit about your organization, your mission, and what makes you unique..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="min-h-[100px] bg-background border-border/50 focus:border-primary transition-colors resize-none"
          />
        </div>
      </div>

      <div className="flex justify-between pt-4 border-t border-border/30">
        <Button variant="outline" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Login
        </Button>
        <Button onClick={onNext} className="gap-2">Next <ArrowRight className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}

// ─── Manual steps 2-5: simple placeholder forms ───────────────────────────────
function ManualStepForm({ step, onNext, onBack }: { step: ManualStep; onNext: () => void; onBack: () => void }) {
  const isLast = step === 5;
  return (
    <div className="ob-slide-in space-y-6">
      {step === 2 && <>
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground">Practice Details</h2>
          <p className="text-muted-foreground">Add your practice locations</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2"><Label>Practice Name <span className="text-destructive">*</span></Label><Input defaultValue="Bright Smiles - London" className="h-12" /></div>
          <div className="space-y-1.5 col-span-2"><Label>Address <span className="text-destructive">*</span></Label><Input defaultValue="123 Dental Street, London" className="h-12" /></div>
          <div className="space-y-1.5"><Label>City <span className="text-destructive">*</span></Label><Input defaultValue="London" className="h-12" /></div>
          <div className="space-y-1.5"><Label>Postcode <span className="text-destructive">*</span></Label><Input defaultValue="EC1A 1BB" className="h-12" /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input defaultValue="+44 20 1234 5678" className="h-12" /></div>
          <div className="space-y-1.5"><Label>Chairs</Label><Input placeholder="6" defaultValue="6" className="h-12" /></div>
        </div>
      </>}

      {step === 3 && <>
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground">Add Team Members</h2>
          <p className="text-muted-foreground">Invite your team to DentPulse</p>
        </div>
        <div className="space-y-3 max-w-lg mx-auto">
          {["sarah.jones@brightsmiles.com", "mark.patel@brightsmiles.com"].map((email, i) => (
            <div key={i} className="flex gap-3">
              <Input defaultValue={email} className="flex-1 h-12" />
              <Input defaultValue={i === 0 ? "Admin" : "Manager"} className="w-28 h-12" />
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">+ Add another member</Button>
        </div>
      </>}

      {step === 4 && <>
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Settings className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground">Configure Preferences</h2>
          <p className="text-muted-foreground">Set up your default settings</p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
          <div className="space-y-1.5"><Label>Currency</Label><Input defaultValue="GBP (£)" className="h-12" /></div>
          <div className="space-y-1.5"><Label>Timezone</Label><Input defaultValue="Europe/London" className="h-12" /></div>
          <div className="space-y-1.5"><Label>Fiscal Year Start</Label><Input defaultValue="April" className="h-12" /></div>
          <div className="space-y-1.5"><Label>Date Format</Label><Input defaultValue="DD/MM/YYYY" className="h-12" /></div>
        </div>
      </>}

      {step === 5 && (
        <div className="text-center space-y-4 py-6">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold">You're all set!</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">Your organisation has been configured. You can now start using DentPulse.</p>
          <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto text-left mt-4">
            {["Organisation created", "Practices added", "Team invited", "Settings configured"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm"><Check className="w-4 h-4 text-green-500 flex-shrink-0" />{item}</div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4 border-t border-border/30">
        <Button variant="outline" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Button>
        {!isLast
          ? <Button onClick={onNext} className="gap-2">Next <ArrowRight className="w-4 h-4" /></Button>
          : <Button className="gap-2 bg-green-600 hover:bg-green-700" onClick={onNext}>Go to Dashboard <ArrowRight className="w-4 h-4" /></Button>
        }
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OnboardingUIPreview() {
  const [flow, setFlow] = useState<Flow>(null);
  const [step, setStep] = useState(1);

  const dentallySteps = DENTALLY_STEPS;
  const manualSteps   = MANUAL_STEPS.map(s => ({ id: s.id, title: s.title, description: s.description }));
  const steps         = flow === "dentally" ? dentallySteps : manualSteps;

  const selectFlow = (f: "dentally" | "manual") => { setFlow(f); setStep(1); };
  const backToSelector = () => { setFlow(null); setStep(1); };
  const next = () => setStep(s => s + 1);
  const back = () => { if (step === 1) backToSelector(); else setStep(s => s - 1); };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-border/30 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white text-xs font-bold">DP</span>
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground leading-none">DentPulse Enterprise</p>
            <p className="text-[11px] text-muted-foreground">Setup Wizard</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">UI Preview — no data saved</span>
          {flow && <span className="text-xs text-muted-foreground">Step {step} of {steps.length}</span>}
        </div>
      </header>

      {/* Flow selector */}
      {flow === null && <FlowSelector onSelect={selectFlow} />}

      {/* Steps */}
      {flow !== null && (
        <>
          {/* Progress */}
          <div className="py-5 px-6 border-b border-border/30 bg-muted/20">
            <ProgressBar steps={steps} current={step} />
          </div>

          {/* Content */}
          <main className="flex-1 flex justify-center py-8 px-6">
            <div className="w-full max-w-2xl">
              {flow === "dentally" && step === 1 && <DentallyConnect onNext={next} onBack={back} />}
              {flow === "dentally" && step === 2 && <AccountingSoftware onNext={next} onBack={back} />}
              {flow === "dentally" && step === 3 && (
                <div className="ob-slide-in text-center space-y-4 py-6">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                    <Check className="w-8 h-8 text-green-600" />
                  </div>
                  <h2 className="text-2xl font-bold">All Connected!</h2>
                  <p className="text-muted-foreground">Dentally is syncing your data. You'll be redirected to your dashboard shortly.</p>
                  <Button className="gap-2 bg-green-600 hover:bg-green-700">Go to Dashboard <ArrowRight className="w-4 h-4" /></Button>
                </div>
              )}
              {flow === "manual" && step === 1 && <ManualOrganisation onNext={next} onBack={back} />}
              {flow === "manual" && step > 1  && <ManualStepForm step={step as ManualStep} onNext={next} onBack={back} />}
            </div>
          </main>
        </>
      )}

      <style>{`
        @keyframes obSlideIn { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
        .ob-slide-in { animation:obSlideIn .35s cubic-bezier(.22,1,.36,1) both; }
      `}</style>
    </div>
  );
}
