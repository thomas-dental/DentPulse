import { type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InsightsProvider, useInsights, type InsightsTab } from "./InsightsProvider";
import { OverviewTab } from "./OverviewTab";
import { MembersTab } from "./MembersTab";
import { CliniciansTab } from "./CliniciansTab";
import { CapacityTab } from "./CapacityTab";
import { MarginTab } from "./MarginTab";
import { ScenariosTab } from "./ScenariosTab";
import { TreatmentSettingsTab } from "./TreatmentSettingsTab";
import { SettingsTab } from "./SettingsTab";

/**
 * Tab strip for Membership Performance. "Plan Revenue" is the page's
 * existing, untouched content (passed through unchanged as a prop so it
 * keeps every hook/closure it already had). Overview through Settings are
 * the new preview screens ported from the design mockup, replacing the
 * mockup's left-rail navigation with tabs.
 */
export function MembershipInsightsTabs({
  planRevenueContent,
}: {
  planRevenueContent: ReactNode;
}) {
  return (
    <InsightsProvider>
      <TabsShell planRevenueContent={planRevenueContent} />
    </InsightsProvider>
  );
}

function TabsShell({ planRevenueContent }: { planRevenueContent: ReactNode }) {
  const { activeTab, setActiveTab } = useInsights();

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as InsightsTab)}
      className="space-y-6"
    >
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="plan-revenue">Plan Revenue</TabsTrigger>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="clinicians">Clinicians</TabsTrigger>
        <TabsTrigger value="capacity">Capacity</TabsTrigger>
        <TabsTrigger value="margin">Margin</TabsTrigger>
        <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
        <TabsTrigger value="treatments">Treatments</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="plan-revenue" className="space-y-6">
        {planRevenueContent}
      </TabsContent>

      <TabsContent value="overview" className="mpi space-y-6">
        <OverviewTab />
      </TabsContent>
      <TabsContent value="members" className="mpi space-y-6">
        <MembersTab />
      </TabsContent>
      <TabsContent value="clinicians" className="mpi space-y-6">
        <CliniciansTab />
      </TabsContent>
      <TabsContent value="capacity" className="mpi space-y-6">
        <CapacityTab />
      </TabsContent>
      <TabsContent value="margin" className="mpi space-y-6">
        <MarginTab />
      </TabsContent>
      <TabsContent value="scenarios" className="mpi space-y-6">
        <ScenariosTab />
      </TabsContent>
      <TabsContent value="treatments" className="mpi space-y-6">
        <TreatmentSettingsTab />
      </TabsContent>
      <TabsContent value="settings" className="mpi space-y-6">
        <SettingsTab />
      </TabsContent>
    </Tabs>
  );
}
