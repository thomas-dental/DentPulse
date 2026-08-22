import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getAnthropicKey } from '@/lib/aiKey';

const SYSTEM_PROMPT = `You are a dental M&A due diligence advisor. Based on the practice's financial data, generate exactly 5 specific buyer questions that a potential acquirer would ask during due diligence.

Rules:
- Each question must reference specific numbers from the data provided
- Questions should cover: revenue sustainability, cost structure, NHS risk, associate dependency, and operational efficiency
- Be specific and actionable — avoid generic questions
- Format: Return ONLY a JSON array of 5 strings, no markdown, no explanation

Example output:
["Question 1 with specific numbers...", "Question 2...", "Question 3...", "Question 4...", "Question 5..."]`;

async function callAnthropicDirect(financialData: Record<string, any>): Promise<string[]> {
  const apiKey = await getAnthropicKey();

  const userMessage = `Practice financial data for due diligence question generation:

${JSON.stringify(financialData, null, 2)}

Generate 5 specific buyer questions based on this data.`;

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
    console.error('[AI Buyer Questions] Anthropic response:', errText);
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text ?? '[]';
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const questions = JSON.parse(cleaned);
  return Array.isArray(questions) ? questions : [];
}

async function callEdgeFunction(financialData: Record<string, any>): Promise<string[]> {
  const apiKey = await getAnthropicKey();
  const { data: result, error: fnError } = await supabase.functions.invoke('ai-buyer-questions', {
    body: { financialData, apiKey },
  });

  if (fnError) throw new Error(fnError.message || 'Edge function failed');
  if (result?.error) throw new Error(result.error);
  return result?.questions || [];
}

export function useAIBuyerQuestions() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateQuestions = useCallback(async (financialData: Record<string, any>) => {
    setIsLoading(true);
    setError(null);

    try {
      // Try direct Anthropic API first (works in dev via Vite proxy)
      const result = await callAnthropicDirect(financialData);
      setQuestions(result);
    } catch (directErr) {
      console.warn('[AI Buyer Questions] Direct call failed, trying edge function:', directErr);
      try {
        // Fallback to Supabase edge function (works in production)
        const result = await callEdgeFunction(financialData);
        setQuestions(result);
      } catch (edgeErr) {
        const errorMessage = edgeErr instanceof Error ? edgeErr.message : 'Failed to generate questions';
        console.warn('[AI Buyer Questions] Edge function also failed:', errorMessage);
        setError('AI questions temporarily unavailable.');
        setQuestions([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { questions, isLoading, error, generateQuestions };
}
