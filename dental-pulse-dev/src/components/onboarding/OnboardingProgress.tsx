import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  id: number;
  title: string;
  description: string;
}

interface OnboardingProgressProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}

const OnboardingProgress = ({ steps, currentStep, onStepClick }: OnboardingProgressProps) => {
  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center flex-1">
            <div
              className={cn("flex flex-col items-center", onStepClick && currentStep > step.id ? "cursor-pointer" : "")}
              onClick={() => onStepClick && currentStep > step.id ? onStepClick(step.id) : undefined}
            >
              <div
                className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-500 ease-out",
                  currentStep > step.id
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                    : currentStep === step.id
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-primary/20"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {currentStep > step.id ? (
                  <Check className="w-5 h-5" />
                ) : (
                  step.id
                )}
              </div>
              <div className="mt-3 text-center">
                <p
                  className={cn(
                    "text-sm font-medium transition-colors duration-300",
                    currentStep >= step.id
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                  {step.description}
                </p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className="flex-1 mx-4 h-0.5 relative">
                <div className="absolute inset-0 bg-muted rounded-full" />
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-700 ease-out",
                    currentStep > step.id ? "w-full" : "w-0"
                  )}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OnboardingProgress;
