import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getAnthropicKey } from '@/lib/aiKey';

interface ActionInput {
  label: string;
  penaltyX: number;
  value: number;
  metric?: string;
  actual?: string;
  target?: string;
  category?: string;
}

interface FinancialContext {
  sustainableEBITDA: number;
  currentEV: number;
  optimisedEV: number;
  qualityScore: number;
  overallReadiness: number;
}

export interface ActionTip {
  actionLabel: string;
  tip: string;
}

const SYSTEM_PROMPT = `You are a dental practice M&A advisor helping practice owners increase their enterprise value before exit.

You will receive a list of priority actions, each with:
- label: the specific improvement needed
- metric: which KPI it relates to (e.g. Associate Dependency, Chair Utilisation, NHS Delivery)
- currentValue: current measured value
- targetValue: the target to hit
- valueImpact: estimated EV uplift in GBP
- category: area (practitioners, revenue, appointments, costs)

Generate a short, specific, actionable tip for each action. Each tip should:
- Be 1-2 sentences maximum
- Include a concrete first step the owner can take this week
- Reference the actual current metric value and what specifically needs to change
- Be specific to UK dental practices (associates, UDAs, NHS contracts, chair utilisation, payment plans, etc.)
- Be encouraging but realistic

Return ONLY a JSON array of objects with "actionLabel" and "tip" fields. No markdown, no explanation.

Example:
[{"actionLabel":"Reduce top associate concentration below 25%","tip":"Start by redistributing new patient bookings — assign 60% of new NHS patients to your second and third associates this month. Document all clinical SOPs so procedures aren't tied to one clinician."}]`;

async function callAnthropicDirect(actions: any[], financialContext: FinancialContext): Promise<ActionTip[]> {
  const apiKey = await getAnthropicKey();

  const userMessage = `Practice financial summary:
- Sustainable EBITDA: £${Math.round(financialContext.sustainableEBITDA).toLocaleString()}
- Current Enterprise Value: £${Math.round(financialContext.currentEV).toLocaleString()}
- Optimised Enterprise Value: £${Math.round(financialContext.optimisedEV).toLocaleString()}
- Quality Score: ${financialContext.qualityScore}/100
- Exit Readiness: ${financialContext.overallReadiness}/100

Priority actions requiring tips:
${JSON.stringify(actions, null, 2)}

Generate one specific, actionable tip for each action based on the practice's actual metrics.`;

  const response = await fetch('/anthropic-api/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: userMessage }],
      system: SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[AI Priority Tips] Anthropic 400 response:', errText);
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text ?? '[]';
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const tips = JSON.parse(cleaned);
  return Array.isArray(tips) ? tips : [];
}

async function callEdgeFunction(actions: any[], financialContext: FinancialContext): Promise<ActionTip[]> {
  const apiKey = await getAnthropicKey();
  const { data: result, error: fnError } = await supabase.functions.invoke('ai-priority-tips', {
    body: { actions, financialContext, apiKey },
  });

  if (fnError) throw new Error(fnError.message || 'Edge function failed');
  if (result?.error) throw new Error(result.error);
  return result?.tips || [];
}

export function useAIPriorityTips() {
  const [tips, setTips] = useState<ActionTip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateTips = useCallback(async (actions: ActionInput[], financialContext: FinancialContext) => {
    setIsLoading(true);
    setError(null);

    const formattedActions = actions.map(a => ({
      label: a.label,
      metric: a.metric,
      currentValue: a.actual,
      targetValue: a.target,
      valueImpact: a.value,
      category: a.category,
    }));

    try {
      // Try direct Anthropic API first (works in dev via Vite proxy)
      const result = await callAnthropicDirect(formattedActions, financialContext);
      setTips(result);
    } catch (directErr) {
      console.warn('[AI Priority Tips] Direct call failed, trying edge function:', directErr);
      try {
        // Fallback to Supabase edge function (works in production)
        const result = await callEdgeFunction(formattedActions, financialContext);
        setTips(result);
      } catch (edgeErr) {
        const errorMessage = edgeErr instanceof Error ? edgeErr.message : 'Failed to generate tips';
        console.warn('[AI Priority Tips] Edge function also failed:', errorMessage);
        setError('AI tips temporarily unavailable.');
        setTips([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { tips, isLoading, error, generateTips };
}
