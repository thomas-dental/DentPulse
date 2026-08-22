import { CheckCircle2, Database, Users, MapPin, Package, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface SyncSummary {
  categoriesSynced: number;
  treatmentsSynced: number;
  practitionersSynced: number;
  locationsSynced: number;
  totalRecords: number;
}

interface SyncSummaryStepProps {
  summary: SyncSummary | null;
}

const SyncSummaryStep = ({ summary }: SyncSummaryStepProps) => {
  if (!summary) {
    return (
      <div className="space-y-8 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground">No Data Synced</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Please go back and sync your data from Dentally first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        {/* <div className="w-20 h-20 bg-gradient-to-br from-primary/20 to-primary/5 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg">
          <CheckCircle2 className="w-10 h-10 text-primary" />
        </div> */}
        <h2 className="text-3xl font-bold text-foreground">Dentally Sync Summary</h2>
        <p className="text-muted-foreground max-w-md mx-auto text-lg">
          Review the data that was synced from Dentally
        </p>
      </div>

      <div className="max-w-5xl mx-auto">
        <Card className="p-8 md:p-10 border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background shadow-xl">
          <div className="flex items-center gap-3 mb-8 pb-6 border-b border-border/50">
            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">Sync Completed Successfully</h3>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
            <div className="bg-background/50 rounded-xl p-6 border border-border/50 hover:border-primary/30 transition-all">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                <Package className="w-5 h-5 text-primary" />
                <span>Categories</span>
              </div>
              <div className="text-4xl font-bold text-foreground">
                {summary.categoriesSynced}
              </div>
            </div>
            
            <div className="bg-background/50 rounded-xl p-6 border border-border/50 hover:border-primary/30 transition-all">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                <Database className="w-5 h-5 text-primary" />
                <span>Treatments</span>
              </div>
              <div className="text-4xl font-bold text-foreground">
                {summary.treatmentsSynced}
              </div>
            </div>
            
            <div className="bg-background/50 rounded-xl p-6 border border-border/50 hover:border-primary/30 transition-all">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                <Users className="w-5 h-5 text-primary" />
                <span>Practitioners</span>
              </div>
              <div className="text-4xl font-bold text-foreground">
                {summary.practitionersSynced}
              </div>
            </div>
            
            <div className="bg-background/50 rounded-xl p-6 border border-border/50 hover:border-primary/30 transition-all">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                <MapPin className="w-5 h-5 text-primary" />
                <span>Locations</span>
              </div>
              <div className="text-4xl font-bold text-foreground">
                {summary.locationsSynced}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t-2 border-border/50 bg-gradient-to-r from-primary/10 to-transparent rounded-xl p-6">
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold text-foreground">Total Records Synced</span>
              <span className="text-5xl font-bold  from-primary to-primary/70 bg-clip-text text-dark">
                {summary.totalRecords}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SyncSummaryStep;
