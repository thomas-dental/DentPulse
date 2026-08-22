import { CheckCircle2, Sparkles, ArrowRight, Building2, MapPin, Users, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CompletionStepProps {
  organizationName: string;
  practiceCount: number;
  teamCount: number;
  onComplete: () => void;
  isLoading?: boolean;
}

const CompletionStep = ({ organizationName, practiceCount, teamCount, onComplete, isLoading }: CompletionStepProps) => {
  const summaryItems = [
    {
      icon: Building2,
      label: "Organization",
      value: organizationName || "Your Organization",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      icon: MapPin,
      label: "Practices",
      value: `${practiceCount} location${practiceCount !== 1 ? "s" : ""} configured`,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      icon: Users,
      label: "Team Members",
      value: `${teamCount} team member${teamCount !== 1 ? "s" : ""} added`,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      icon: Settings,
      label: "Settings",
      value: "Preferences configured",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in text-center">
      <div className="relative">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-32 bg-primary/10 rounded-full animate-ping" />
        </div>
        <div className="relative w-24 h-24 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-primary/30">
          <CheckCircle2 className="w-12 h-12 text-primary-foreground" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-medium text-amber-500 uppercase tracking-wider">
            All Set!
          </span>
          <Sparkles className="w-5 h-5 text-amber-500" />
        </div>
        <h2 className="text-3xl font-bold text-foreground">
          Welcome to DentPulse Enterprise
        </h2>
        <p className="text-muted-foreground max-w-lg mx-auto text-lg">
          Your organization is ready to go. Here's a summary of what we've set up for you.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
        {summaryItems.map((item, index) => (
          <Card
            key={item.label}
            className={cn(
              "p-4 border-border/50 hover:shadow-md transition-all duration-300",
              "animate-fade-in"
            )}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex items-start gap-3">
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", item.bgColor)}>
                <item.icon className={cn("w-5 h-5", item.color)} />
              </div>
              <div className="text-left">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <p className="font-semibold text-foreground">{item.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="pt-4">
        <Button
          size="lg"
          className="h-14 px-8 text-base font-semibold shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 transition-all duration-300"
          onClick={onComplete}
          disabled={isLoading}
        >
          {isLoading ? "Saving..." : "Launch Dashboard"}
          <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
        <p className="text-sm text-muted-foreground mt-4">
          You can always update these settings later from the admin panel.
        </p>
      </div>
    </div>
  );
};

export default CompletionStep;
