import { useState, useEffect, useRef } from "react";
import { UserPlus, Plus, Trash2, Stethoscope, Heart, GraduationCap, Mail, Phone, Building, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/ui/image-upload";
import { Practice } from "./PracticeStep";

export interface TeamMember {
  id: string;
  type: "associate" | "hygienist" | "therapist";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  practiceId: string;
  specialty?: string;
  licenseNumber?: string;
  startDate?: string;
  photoUrl?: string;
}

interface TeamStepProps {
  teamMembers: TeamMember[];
  practices: Practice[];
  onChange: (members: TeamMember[]) => void;
  showErrors?: boolean;
}

const specialties = [
  "General Dentistry",
  "Orthodontics",
  "Periodontics",
  "Endodontics",
  "Oral Surgery",
  "Pediatric Dentistry",
  "Prosthodontics",
  "Cosmetic Dentistry",
];

const memberHasErrors = (member: TeamMember) =>
  !member.firstName.trim() || !member.lastName.trim() || !member.email.trim() || !member.phone.trim();

const TeamStep = ({ teamMembers, practices, onChange, showErrors }: TeamStepProps) => {
  const [activeTab, setActiveTab] = useState<"associate" | "hygienist" | "therapist">("associate");
  const prevShowErrorsRef = useRef(false);

  // Auto-switch to the tab with the first invalid member when showErrors triggers
  useEffect(() => {
    if (showErrors && !prevShowErrorsRef.current) {
      const firstInvalid = teamMembers.find(memberHasErrors);
      if (firstInvalid && firstInvalid.type !== activeTab) {
        setActiveTab(firstInvalid.type);
      }
    }
    prevShowErrorsRef.current = showErrors ?? false;
  }, [showErrors, teamMembers, activeTab]);

  const associates = teamMembers.filter((m) => m.type === "associate");
  const hygienists = teamMembers.filter((m) => m.type === "hygienist");
  const therapists = teamMembers.filter((m) => m.type === "therapist");

  const addMember = (type: "associate" | "hygienist" | "therapist") => {
    const newMember: TeamMember = {
      id: `member-${Date.now()}`,
      type,
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      practiceId: practices[0]?.id || "",
      specialty: type === "associate" ? "" : undefined,
      licenseNumber: "",
      startDate: "",
      photoUrl: "",
    };
    onChange([...teamMembers, newMember]);
  };

  const removeMember = (id: string) => {
    onChange(teamMembers.filter((m) => m.id !== id));
  };

  const updateMember = (id: string, field: keyof TeamMember, value: string | null) => {
    onChange(
      teamMembers.map((m) => (m.id === id ? { ...m, [field]: value ?? "" } : m))
    );
  };

  const renderMemberCard = (member: TeamMember, index: number) => (
    <Card
      key={member.id}
      className={cn(
        "p-6 border-border/50 hover:shadow-md transition-all duration-200 animate-fade-in",
        showErrors && memberHasErrors(member) && "border-destructive ring-1 ring-destructive/30"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          {/* Photo Upload */}
          <ImageUpload
            value={member.photoUrl}
            onChange={(url) => updateMember(member.id, "photoUrl", url)}
            variant="avatar"
          />
          <div>
            <h4 className="font-medium text-foreground">
              {member.firstName && member.lastName
                ? `${member.firstName} ${member.lastName}`
                : member.type === "associate"
                ? `Associate ${index + 1}`
                : member.type === "hygienist"
                ? `Hygienist ${index + 1}`
                : `Therapist ${index + 1}`}
            </h4>
            <p className="text-sm text-muted-foreground">
              {member.specialty || (member.type === "associate" ? "Specialty not set" : member.type === "hygienist" ? "Dental Hygienist" : "Dental Therapist")}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => removeMember(member.id)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">First Name <span className="text-destructive">*</span></Label>
          <Input
            placeholder="John"
            value={member.firstName}
            onChange={(e) => updateMember(member.id, "firstName", e.target.value)}
            className={`h-10 bg-background ${showErrors && !member.firstName.trim() ? "border-destructive" : ""}`}
          />
          {showErrors && !member.firstName.trim() && (
            <p className="text-xs text-destructive">Please enter the first name.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Last Name <span className="text-destructive">*</span></Label>
          <Input
            placeholder="Smith"
            value={member.lastName}
            onChange={(e) => updateMember(member.id, "lastName", e.target.value)}
            className={`h-10 bg-background ${showErrors && !member.lastName.trim() ? "border-destructive" : ""}`}
          />
          {showErrors && !member.lastName.trim() && (
            <p className="text-xs text-destructive">Please enter the last name.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Email <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              placeholder="john@brightsmiles.com"
              value={member.email}
              onChange={(e) => updateMember(member.id, "email", e.target.value)}
              className={`pl-10 h-10 bg-background ${showErrors && !member.email.trim() ? "border-destructive" : ""}`}
            />
          </div>
          {showErrors && !member.email.trim() && (
            <p className="text-xs text-destructive">Please enter the email address.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Phone <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="tel"
              placeholder="+44 7911 123456"
              value={member.phone}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9+\-() ]/g, "");
                updateMember(member.id, "phone", value);
              }}
              className={`pl-10 h-10 bg-background ${showErrors && !member.phone.trim() ? "border-destructive" : ""}`}
            />
          </div>
          {showErrors && !member.phone.trim() && (
            <p className="text-xs text-destructive">Please enter the phone number.</p>
          )}
        </div>

        {member.type === "associate" && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Specialty</Label>
            <div className="relative">
              <GraduationCap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
              <Select
                value={member.specialty}
                onValueChange={(v) => updateMember(member.id, "specialty", v)}
              >
                <SelectTrigger className="pl-10 h-10 bg-background">
                  <SelectValue placeholder="Select specialty" />
                </SelectTrigger>
                <SelectContent>
                  {specialties.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-sm font-medium">Primary Practice</Label>
          <div className="relative">
            <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <Select
              value={member.practiceId}
              onValueChange={(v) => updateMember(member.id, "practiceId", v)}
            >
              <SelectTrigger className="pl-10 h-10 bg-background">
                <SelectValue placeholder="Select practice" />
              </SelectTrigger>
              <SelectContent>
                {practices.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name || "Unnamed Practice"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">License Number</Label>
          <Input
            placeholder="DDS-12345"
            value={member.licenseNumber}
            onChange={(e) => updateMember(member.id, "licenseNumber", e.target.value)}
            className="h-10 bg-background"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Start Date</Label>
          <Input
            type="date"
            value={member.startDate}
            onChange={(e) => updateMember(member.id, "startDate", e.target.value)}
            className="h-10 bg-background"
          />
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <UserPlus className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Build your team</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Add your dental associates, hygienists and therapists
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "associate" | "hygienist" | "therapist")}>
        <TabsList className="grid w-full max-w-xl mx-auto grid-cols-3 h-12">
          <TabsTrigger value="associate" className="gap-2 h-10">
            <Stethoscope className="w-4 h-4" />
            Associates ({associates.length})
          </TabsTrigger>
          <TabsTrigger value="hygienist" className="gap-2 h-10">
            <Heart className="w-4 h-4" />
            Hygienists ({hygienists.length})
          </TabsTrigger>
          <TabsTrigger value="therapist" className="gap-2 h-10">
            <Sparkles className="w-4 h-4" />
            Therapists ({therapists.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="associate" className="mt-6 space-y-4">
          {associates.map((member, index) => renderMemberCard(member, index))}
          <Button
            variant="outline"
            className="w-full h-14 border-dashed border-2 hover:border-blue-500 hover:bg-blue-500/5 hover:text-blue-500 transition-all duration-200"
            onClick={() => addMember("associate")}
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Associate Dentist
          </Button>
        </TabsContent>

        <TabsContent value="hygienist" className="mt-6 space-y-4">
          {hygienists.map((member, index) => renderMemberCard(member, index))}
          <Button
            variant="outline"
            className="w-full h-14 border-dashed border-2 hover:border-pink-500 hover:bg-pink-500/5 hover:text-pink-500 transition-all duration-200"
            onClick={() => addMember("hygienist")}
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Hygienist
          </Button>
        </TabsContent>

        <TabsContent value="therapist" className="mt-6 space-y-4">
          {therapists.map((member, index) => renderMemberCard(member, index))}
          <Button
            variant="outline"
            className="w-full h-14 border-dashed border-2 hover:border-purple-500 hover:bg-purple-500/5 hover:text-purple-500 transition-all duration-200"
            onClick={() => addMember("therapist")}
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Therapist
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TeamStep;
