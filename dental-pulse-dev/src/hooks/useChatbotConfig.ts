import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChatbotConfig {
  active_version: 'v1' | 'v2';
  feature_at_mentions: boolean;
  feature_inline_charts: boolean;
  feature_pdf_reports: boolean;
  feature_email_reports: boolean;
  feature_briefing: boolean;
  feature_anomaly_alerts: boolean;
  feature_recommendations: boolean;
  feature_monitors: boolean;
  feature_forecasting: boolean;
  feature_ai_dashboard: boolean;
}

export function useChatbotConfig() {
  return useQuery<ChatbotConfig>({
    queryKey: ['chatbot-config'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${backendUrl}/api/chatbot/config`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to load chatbot config');
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
