/**
 * Preview/test component for the new onboarding flow selector design.
 * Clicking a card immediately animates into the relevant form — no Continue button.
 */

import { useState } from "react";
import { ClipboardList, Key, Building2, MapPin, Users, Settings, CheckSquare, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type View = "select" | "dentally" | "manual";

const cards = [
  {
    id: "dentally" as const,
    title: "Yes, I use Dentally",
    subtitle: "Connect your Dentally account for automatic data sync",
    color: "#2563EB",
    bg: "rgba(37,99,235,0.08)",
  },
  {
    id: "manual" as const,
    title: "I don't use Dentally",
    subtitle: "Set up your organisation manually in a few steps",
    color: "#7C3AED",
    bg: "rgba(124,58,237,0.08)",
  },
];

const manualSteps = [
  { icon: Building2,   label: "Organisation", desc: "Basic information" },
  { icon: MapPin,      label: "Practices",    desc: "Location details" },
  { icon: Users,       label: "Team",         desc: "Add team members" },
  { icon: Settings,    label: "Settings",     desc: "Configure preferences" },
  { icon: CheckSquare, label: "Complete",     desc: "Review & finish" },
];

// ── Card selection screen ────────────────────────────────────────────────────
function SelectScreen({ onSelect }: { onSelect: (id: "dentally" | "manual") => void }) {
  return (
    <div className="ob-slide-in space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold text-foreground">How do you manage your dental data?</h2>
        <p className="text-sm text-muted-foreground">
          Choose your setup path — you can always change this later from Settings.
        </p>
      </div>

      <div className="flex gap-5 justify-center flex-wrap">
        {cards.map((card, i) => (
          <div
            key={card.id}
            onClick={() => onSelect(card.id)}
            style={{
              "--card-delay": `${i * 120}ms`,
              "--p-color": card.color,
              "--p-bg": card.bg,
            } as React.CSSProperties}
            className="acct2-card relative flex flex-col items-center gap-3 p-6 w-52 rounded-2xl border cursor-pointer"
          >
            <div
              className={[
                "w-16 h-16 rounded-2xl flex items-center justify-center",
                card.id === "dentally" ? "bg-gradient-to-br from-blue-500 to-cyan-500" : "",
              ].filter(Boolean).join(" ")}
              style={card.id !== "dentally" ? { background: card.bg, border: `1.5px solid ${card.color}30` } : undefined}
            >
              {card.id === "dentally"
                ? <span className="text-2xl">🦷</span>
                : <ClipboardList className="w-8 h-8" style={{ color: card.color }} />
              }
            </div>

            <div className="text-center space-y-1">
              <p className="font-semibold text-sm text-foreground leading-tight">{card.title}</p>
              <p className="text-xs text-muted-foreground leading-snug">{card.subtitle}</p>
            </div>

            {/* Hover arrow hint */}
            <span className="flex items-center gap-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowRight className="w-3 h-3" /> Select
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dentally connection form ─────────────────────────────────────────────────
function DentallyForm({ onBack }: { onBack: () => void }) {
  return (
    <div className="ob-slide-in space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-500 text-xl flex-shrink-0">
          🦷
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Connect Dentally</h2>
          <p className="text-sm text-muted-foreground">Enter your API credentials to start syncing data automatically</p>
        </div>
      </div>

      <div className="max-w-lg space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="api-key">Dentally API Key <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="api-key" placeholder="Enter your Dentally API key" className="pl-9" />
          </div>
          <p className="text-xs text-muted-foreground">Find this in Dentally → Settings → API Keys</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="api-endpoint">API Endpoint <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="api-endpoint" placeholder="https://api.dentally.co" className="pl-9" />
          </div>
        </div>

        <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-700 h-11">
          Connect &amp; Start Syncing <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Manual 5-step overview ───────────────────────────────────────────────────
function ManualForm({ onBack }: { onBack: () => void }) {
  return (
    <div className="ob-slide-in space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(124,58,237,0.1)", border: "1.5px solid rgba(124,58,237,0.3)" }}>
          <ClipboardList className="w-6 h-6 text-violet-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Manual Setup</h2>
          <p className="text-sm text-muted-foreground">Complete 5 quick steps to configure your organisation</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 max-w-2xl">
        {manualSteps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div
              key={i}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border/60 bg-muted/30 text-center"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold">
                {i + 1}
              </div>
              <Icon className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-semibold text-foreground">{step.label}</p>
                <p className="text-[10px] text-muted-foreground">{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      <Button className="gap-2 h-11 px-8" style={{ background: "#7C3AED" }}>
        Begin Setup <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export function OnboardingFlowSelectorPreview() {
  const [view, setView] = useState<View>("select");

  return (
    <div className="rounded-2xl border border-border bg-card p-8 overflow-hidden">
      {view === "select"   && <SelectScreen onSelect={(id) => setView(id)} />}
      {view === "dentally" && <DentallyForm onBack={() => setView("select")} />}
      {view === "manual"   && <ManualForm   onBack={() => setView("select")} />}

      <style>{`
        @keyframes acct2SlideUp {
          from { opacity: 0; translate: 0 16px; }
          to   { opacity: 1; translate: 0 0; }
        }
        @keyframes obSlideIn {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .ob-slide-in {
          animation: obSlideIn 0.35s cubic-bezier(0.22,1,0.36,1) both;
        }
        .acct2-card {
          background: hsl(var(--card));
          animation: acct2SlideUp 0.45s cubic-bezier(0.22,1,0.36,1) both;
          animation-delay: var(--card-delay, 0ms);
          transition: transform .35s cubic-bezier(0.34,1.56,0.64,1), box-shadow .25s ease, border-color .25s ease, background .25s ease;
        }
        .acct2-card:hover {
          transform: translateY(-8px);
          background: var(--p-bg);
          border-color: var(--p-color) !important;
          box-shadow: 0 16px 40px color-mix(in srgb, var(--p-color) 18%, transparent);
        }
      `}</style>
    </div>
  );
}
