import { Building2, Globe, Mail, Phone, MapPin, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ImageUpload } from "@/components/ui/image-upload";

export interface OrganizationData {
  name: string;
  legalName: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  practiceCount: string;
  employeeCount: string;
  description: string;
  logoUrl?: string;
}

interface OrganizationStepProps {
  data: OrganizationData;
  onChange: (data: OrganizationData) => void;
  showErrors?: boolean;
}

const OrganizationStep = ({ data, onChange, showErrors }: OrganizationStepProps) => {
  const updateField = (field: keyof OrganizationData, value: string | null) => {
    onChange({ ...data, [field]: value ?? "" });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Tell us about your organization</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Let's start with the basics about your dental group
        </p>
      </div>

      {/* Logo Upload */}
      <div className="flex flex-col items-center gap-3">
        <Label className="text-sm font-medium">Organization Logo</Label>
        <ImageUpload
          value={data.logoUrl}
          onChange={(url) => updateField("logoUrl", url)}
          variant="logo"
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">Upload your logo (PNG, JPG up to 5MB)</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium">
            Organization Name <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="name"
              placeholder="Bright Smiles Dental Group"
              value={data.name}
              onChange={(e) => updateField("name", e.target.value)}
              className={`pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors ${showErrors && !data.name.trim() ? "border-destructive" : ""}`}
            />
          </div>
          {showErrors && !data.name.trim() && (
            <p className="text-xs text-destructive">Please enter your organization name.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="legalName" className="text-sm font-medium">
            Legal Entity Name
          </Label>
          <Input
            id="legalName"
            placeholder="Bright Smiles Holdings LLC"
            value={data.legalName}
            onChange={(e) => updateField("legalName", e.target.value)}
            className="h-12 bg-background border-border/50 focus:border-primary transition-colors"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="website" className="text-sm font-medium">
            Website
          </Label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="website"
              placeholder="https://www.brightsmiles.com"
              value={data.website}
              onChange={(e) => updateField("website", e.target.value)}
              className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            Primary Email <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              placeholder="admin@brightsmiles.com"
              value={data.email}
              onChange={(e) => updateField("email", e.target.value)}
              className={`pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors ${showErrors && !data.email.trim() ? "border-destructive" : ""}`}
            />
          </div>
          {showErrors && !data.email.trim() && (
            <p className="text-xs text-destructive">Please enter your primary email.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone" className="text-sm font-medium">
            Phone Number <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="phone"
              type="tel"
              placeholder="+44 (000) 000-0000"
              value={data.phone}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9+\-() ]/g, "");
                updateField("phone", value);
              }}
              className={`pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors ${showErrors && !data.phone.trim() ? "border-destructive" : ""}`}
            />
          </div>
          {showErrors && !data.phone.trim() && (
            <p className="text-xs text-destructive">Please enter your phone number.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="practiceCount" className="text-sm font-medium">
            Number of Practices <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <Select value={data.practiceCount} onValueChange={(v) => updateField("practiceCount", v)}>
              <SelectTrigger className={`pl-10 h-12 bg-background border-border/50 focus:border-primary ${showErrors && !data.practiceCount.trim() ? "border-destructive" : ""}`}>
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
          {showErrors && !data.practiceCount.trim() && (
            <p className="text-xs text-destructive">Please select the number of practices.</p>
          )}
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="address" className="text-sm font-medium">
            Headquarters Address
          </Label>
          <div className="relative">
            <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              id="address"
              placeholder="123 High Street, London, SW1A 1AA"
              value={data.address}
              onChange={(e) => updateField("address", e.target.value)}
              className="pl-10 h-12 bg-background border-border/50 focus:border-primary transition-colors"
            />
          </div>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description" className="text-sm font-medium">
            Brief Description
          </Label>
          <Textarea
            id="description"
            placeholder="Tell us a bit about your organization, your mission, and what makes you unique..."
            value={data.description}
            onChange={(e) => updateField("description", e.target.value)}
            className="min-h-[100px] bg-background border-border/50 focus:border-primary transition-colors resize-none"
          />
        </div>
      </div>
    </div>
  );
};

export default OrganizationStep;
