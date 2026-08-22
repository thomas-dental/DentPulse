import { Settings, PoundSterling, Calendar, Bell, Shield, Percent } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SettingsData {
  fiscalYearStart: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  defaultProviderSplit: string;
  hygienistPayModel: string;
  emailNotifications: boolean;
  weeklyReports: boolean;
  budgetAlerts: boolean;
  performanceAlerts: boolean;
  dataRetention: string;
  twoFactorRequired: boolean;
}

interface SettingsStepProps {
  data: SettingsData;
  onChange: (data: SettingsData) => void;
}

const SettingsStep = ({ data, onChange }: SettingsStepProps) => {
  const updateField = <K extends keyof SettingsData>(field: K, value: SettingsData[K]) => {
    onChange({ ...data, [field]: value });
  };

  const settingSections = [
    {
      title: "Financial Settings",
      icon: PoundSterling,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      fields: [
        {
          id: "fiscalYearStart",
          label: "Fiscal Year Start",
          type: "select",
          options: [
            { value: "january", label: "January" },
            { value: "april", label: "April" },
            { value: "july", label: "July" },
            { value: "october", label: "October" },
          ],
        },
        {
          id: "currency",
          label: "Currency",
          type: "select",
          options: [
            { value: "USD", label: "USD ($)" },
            { value: "GBP", label: "GBP (£)" },
            { value: "EUR", label: "EUR (€)" },
            { value: "CAD", label: "CAD ($)" },
          ],
        },
        {
          id: "defaultProviderSplit",
          label: "Default Provider Split (%)",
          type: "input",
          placeholder: "35",
          icon: Percent,
        },
        {
          id: "hygienistPayModel",
          label: "Hygienist Pay Model",
          type: "select",
          options: [
            { value: "hourly", label: "Hourly Rate" },
            { value: "daily", label: "Daily Rate" },
            { value: "production", label: "Production %" },
            { value: "hybrid", label: "Base + Production" },
          ],
        },
      ],
    },
    {
      title: "Regional Settings",
      icon: Calendar,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      fields: [
        {
          id: "timezone",
          label: "Timezone",
          type: "select",
          options: [
            { value: "America/New_York", label: "Eastern Time (ET)" },
            { value: "America/Chicago", label: "Central Time (CT)" },
            { value: "America/Denver", label: "Mountain Time (MT)" },
            { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
            { value: "Europe/London", label: "UK Time (GMT/BST)" },
          ],
        },
        {
          id: "dateFormat",
          label: "Date Format",
          type: "select",
          options: [
            { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
            { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
            { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
          ],
        },
      ],
    },
  ];

  const notificationSettings = [
    {
      id: "emailNotifications",
      label: "Email Notifications",
      description: "Receive important updates via email",
    },
    {
      id: "weeklyReports",
      label: "Weekly Reports",
      description: "Get automated performance summaries",
    },
    {
      id: "budgetAlerts",
      label: "Budget Alerts",
      description: "Notify when budgets exceed thresholds",
    },
    {
      id: "performanceAlerts",
      label: "Performance Alerts",
      description: "Alert on significant KPI changes",
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Settings className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-foreground">Configure your preferences</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Set up your financial, regional, and notification preferences
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {settingSections.map((section) => (
          <Card key={section.title} className="p-6 border-border/50">
            <div className="flex items-center gap-3 mb-6">
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", section.bgColor)}>
                <section.icon className={cn("w-5 h-5", section.color)} />
              </div>
              <h3 className="font-semibold text-foreground">{section.title}</h3>
            </div>
            <div className="space-y-4">
              {section.fields.map((field) => (
                <div key={field.id} className="space-y-2">
                  <Label className="text-sm font-medium">{field.label}</Label>
                  {field.type === "select" ? (
                    <Select
                      value={data[field.id as keyof SettingsData] as string}
                      onValueChange={(v) => updateField(field.id as keyof SettingsData, v as any)}
                    >
                      <SelectTrigger className="h-11 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="relative">
                      {field.icon && (
                        <field.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      )}
                      <Input
                        placeholder={field.placeholder}
                        value={data[field.id as keyof SettingsData] as string}
                        onChange={(e) => updateField(field.id as keyof SettingsData, e.target.value as any)}
                        className={cn("h-11 bg-background", field.icon && "pl-10")}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}

        <Card className="p-6 border-border/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-amber-500" />
            </div>
            <h3 className="font-semibold text-foreground">Notifications</h3>
          </div>
          <div className="space-y-4">
            {notificationSettings.map((setting) => (
              <div key={setting.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium text-foreground">{setting.label}</p>
                  <p className="text-sm text-muted-foreground">{setting.description}</p>
                </div>
                <Switch
                  checked={data[setting.id as keyof SettingsData] as boolean}
                  onCheckedChange={(v) => updateField(setting.id as keyof SettingsData, v as any)}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6 border-border/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-purple-500" />
            </div>
            <h3 className="font-semibold text-foreground">Security & Compliance</h3>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Data Retention Period</Label>
              <Select
                value={data.dataRetention}
                onValueChange={(v) => updateField("dataRetention", v)}
              >
                <SelectTrigger className="h-11 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1year">1 Year</SelectItem>
                  <SelectItem value="3years">3 Years</SelectItem>
                  <SelectItem value="5years">5 Years</SelectItem>
                  <SelectItem value="7years">7 Years</SelectItem>
                  <SelectItem value="indefinite">Indefinite</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-foreground">Require Two-Factor Auth</p>
                <p className="text-sm text-muted-foreground">Enforce 2FA for all users</p>
              </div>
              <Switch
                checked={data.twoFactorRequired}
                onCheckedChange={(v) => updateField("twoFactorRequired", v)}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SettingsStep;
