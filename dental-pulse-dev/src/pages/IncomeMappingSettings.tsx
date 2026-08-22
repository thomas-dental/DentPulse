import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';

interface IncomeMapping {
  privateIncome: string;
  membershipIncome: string;
  nhsIncome: string;
}

const applications = [
  { id: 'pms', label: 'PMS App' },
  { id: 'accounting', label: 'Accounting App' },
  { id: 'dentpulse', label: 'DentPulse' },
];

export default function IncomeMappingSettings() {
  const [mapping, setMapping] = useState<IncomeMapping>({
    privateIncome: 'pms',
    membershipIncome: 'accounting',
    nhsIncome: 'accounting',
  });

  const handleSave = () => {
    // Static UI - no database operations
    console.log('Income mapping:', mapping);
  };

  const incomeTypes = [
    {
      id: 'privateIncome',
      label: 'Private Income',
      value: mapping.privateIncome,
      onChange: (value: string) => setMapping({ ...mapping, privateIncome: value }),
    },
    {
      id: 'membershipIncome',
      label: 'Membership Income',
      value: mapping.membershipIncome,
      onChange: (value: string) => setMapping({ ...mapping, membershipIncome: value }),
    },
    {
      id: 'nhsIncome',
      label: 'NHS Income',
      value: mapping.nhsIncome,
      onChange: (value: string) => setMapping({ ...mapping, nhsIncome: value }),
      showDentPulse: true,
    },
  ];

  return (
    <MainLayout>
      <Helmet>
        <title>Income Stream Mapping</title>
        <meta name="description" content="Configure income category mappings between practice management and accounting applications." />
      </Helmet>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2">
            Configure which application handles each type of income
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg md:text-xl">Income Type Mapping</CardTitle>
            <CardDescription className="text-sm">
              Select the application that should handle each income type
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {incomeTypes.map((incomeType, index) => (
                <div
                  key={incomeType.id}
                  className={cn(
                    'grid grid-cols-1 md:grid-cols-[200px_1fr] items-start md:items-center py-4 px-2 sm:px-4 hover:bg-muted/50 transition-colors gap-3 md:gap-0',
                    index !== incomeTypes.length - 1 && 'border-b border-border'
                  )}
                >
                  <Label className="text-sm font-medium text-foreground mb-2 md:mb-0">
                    {incomeType.label}
                  </Label>
                  <div className="flex flex-wrap items-center gap-4 md:gap-8">
                    <RadioGroup
                      value={incomeType.value}
                      onValueChange={incomeType.onChange}
                      className="flex flex-wrap items-center gap-4 md:gap-8"
                    >
                      {applications
                        .filter((app) => app.id !== 'dentpulse' || incomeType.showDentPulse)
                        .map((app) => (
                          <div key={app.id} className="flex items-center space-x-2">
                            <RadioGroupItem value={app.id} id={`${incomeType.id}-${app.id}`} />
                            <Label
                              htmlFor={`${incomeType.id}-${app.id}`}
                              className="text-sm font-normal cursor-pointer text-foreground"
                            >
                              {app.label}
                            </Label>
                          </div>
                        ))}
                    </RadioGroup>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t border-border">
              <Button onClick={handleSave} className="gap-2 w-full md:w-auto">
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
