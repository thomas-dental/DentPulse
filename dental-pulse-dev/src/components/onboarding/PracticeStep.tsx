import { useState, useEffect, useRef } from "react";
import { MapPin, Plus, Trash2, Building, Phone, Mail, Clock, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface Practice {
  id: string;
  name: string;
  address: string;
  city: string;
  zipCode: string;
  phone: string;
  email: string;
  chairCount: string;
  operatingDays: string[];
}

interface PracticeStepProps {
  practices: Practice[];
  onChange: (practices: Practice[]) => void;
  showErrors?: boolean;
}

const emptyPractice: Omit<Practice, "id"> = {
  name: "",
  address: "",
  city: "",
  zipCode: "",
  phone: "",
  email: "",
  chairCount: "",
  operatingDays: [],
};

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const hasErrors = (practice: Practice) =>
  !practice.name.trim() || !practice.address.trim() || !practice.city.trim() || !practice.zipCode.trim();

const PracticeStep = ({ practices, onChange, showErrors }: PracticeStepProps) => {
  const [expandedPractice, setExpandedPractice] = useState<string | null>(
    practices[0]?.id || null
  );
  const prevShowErrorsRef = useRef(false);

  // Auto-expand the first practice with errors when showErrors triggers
  useEffect(() => {
    if (showErrors && !prevShowErrorsRef.current) {
      const firstInvalid = practices.find(hasErrors);
      if (firstInvalid) {
        setExpandedPractice(firstInvalid.id);
      }
    }
    prevShowErrorsRef.current = showErrors ?? false;
  }, [showErrors, practices]);

  const addPractice = () => {
    const newPractice: Practice = {
      ...emptyPractice,
      id: `practice-${Date.now()}`,
    };
    onChange([...practices, newPractice]);
    setExpandedPractice(newPractice.id);
  };

  const removePractice = (id: string) => {
    onChange(practices.filter((p) => p.id !== id));
  };

  const updatePractice = (id: string, field: keyof Practice, value: any) => {
    onChange(
      practices.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const toggleDay = (practiceId: string, day: string) => {
    const practice = practices.find((p) => p.id === practiceId);
    if (!practice) return;

    const newDays = practice.operatingDays.includes(day)
      ? practice.operatingDays.filter((d) => d !== day)
      : [...practice.operatingDays, day];

    updatePractice(practiceId, "operatingDays", newDays);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <MapPin className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Add your practices</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Set up each practice location with its details
        </p>
      </div>

      <div className="space-y-4">
        {practices.map((practice, index) => (
          <Card
            key={practice.id}
            className={cn(
              "overflow-hidden transition-all duration-300 border-border/50",
              expandedPractice === practice.id
                ? "shadow-lg ring-1 ring-primary/20"
                : "hover:shadow-md cursor-pointer",
              showErrors && hasErrors(practice) && "border-destructive ring-1 ring-destructive/30"
            )}
          >
            <div
              className="p-4 flex items-center justify-between bg-muted/30"
              onClick={() =>
                setExpandedPractice(
                  expandedPractice === practice.id ? null : practice.id
                )
              }
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">
                    {practice.name || `Practice ${index + 1}`}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {practice.city
                      ? practice.city
                      : "Location not set"}
                  </p>
                </div>
              </div>
              {practices.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePractice(practice.id);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div
              className={cn(
                "grid transition-all duration-300 ease-out",
                expandedPractice === practice.id
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <div className="p-6 space-y-6 border-t border-border/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Practice Name <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="Downtown Dental Center"
                        value={practice.name}
                        onChange={(e) =>
                          updatePractice(practice.id, "name", e.target.value)
                        }
                        className={`h-11 bg-background ${showErrors && !practice.name.trim() ? "border-destructive" : ""}`}
                      />
                      {showErrors && !practice.name.trim() && (
                        <p className="text-xs text-destructive">Please enter the practice name.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Number of Chairs</Label>
                      <div className="relative">
                        <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
                        <Select
                          value={practice.chairCount}
                          onValueChange={(v) =>
                            updatePractice(practice.id, "chairCount", v)
                          }
                        >
                          <SelectTrigger className="pl-10 h-11 bg-background">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {[...Array(15)].map((_, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>
                                {i + 1} {i === 0 ? "chair" : "chairs"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Street Address <span className="text-destructive">*</span></Label>
                    <Input
                      placeholder="123 Main Street, Suite 100"
                      value={practice.address}
                      onChange={(e) =>
                        updatePractice(practice.id, "address", e.target.value)
                      }
                      className={`h-11 bg-background ${showErrors && !practice.address.trim() ? "border-destructive" : ""}`}
                    />
                    {showErrors && !practice.address.trim() && (
                      <p className="text-xs text-destructive">Please enter the street address.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">City <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="London"
                        value={practice.city}
                        onChange={(e) =>
                          updatePractice(practice.id, "city", e.target.value)
                        }
                        className={`h-11 bg-background ${showErrors && !practice.city.trim() ? "border-destructive" : ""}`}
                      />
                      {showErrors && !practice.city.trim() && (
                        <p className="text-xs text-destructive">Please enter the city.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Postcode <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder="SH15 6BP"
                        value={practice.zipCode}
                        onChange={(e) => {
                          const value = e.target.value.replace(/[^a-zA-Z0-9 ]/g, "").toUpperCase();
                          updatePractice(practice.id, "zipCode", value);
                        }}
                        className={`h-11 bg-background ${showErrors && !practice.zipCode.trim() ? "border-destructive" : ""}`}
                      />
                      {showErrors && !practice.zipCode.trim() && (
                        <p className="text-xs text-destructive">Please enter the postcode.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Phone</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="tel"
                          placeholder="+44 (000) 000-0000"
                          value={practice.phone}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9+\-() ]/g, "");
                            updatePractice(practice.id, "phone", value);
                          }}
                          className="pl-10 h-11 bg-background"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="downtown@brightsmiles.com"
                          value={practice.email}
                          onChange={(e) =>
                            updatePractice(practice.id, "email", e.target.value)
                          }
                          className="pl-10 h-11 bg-background"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Operating Days
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {days.map((day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleDay(practice.id, day)}
                          className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                            practice.operatingDays.includes(day)
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ))}

        <Button
          variant="outline"
          className="w-full h-14 border-dashed border-2 hover:border-primary hover:bg-primary/5 hover:text-primary transition-all duration-200"
          onClick={addPractice}
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Another Practice
        </Button>
      </div>
    </div>
  );
};

export default PracticeStep;
