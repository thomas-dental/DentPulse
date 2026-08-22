import { useState, useEffect, useCallback, useMemo } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ChatHeader } from './ChatHeader';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput, type AttachedFile } from './ChatInput';
import { ChatFloatingButton } from './ChatFloatingButton';
import { ChatHistory } from './ChatHistory';
import { DashboardCanvas } from './dashboard/DashboardCanvas';
import type { ChatMessage, ChatError } from '@/hooks/useChatbot';
import type { ChatbotConfig } from '@/hooks/useChatbotConfig';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface ChatDrawerProps {
  messages: ChatMessage[];
  isLoading: boolean;
  error: ChatError | null;
  onSend: (message: string, attachments?: AttachedFile[], mentions?: { value: string; type: string }[]) => void;
  onClear: () => void;
  activeVersion: 'v1' | 'v2';
  features: Partial<ChatbotConfig>;
  organizationId?: string;
  sessionId?: string | null;
  loadSession?: (sessionId: string) => void;
  isRestoring?: boolean;
  checkAndDeliverGreeting?: (orgId?: string) => void;
  greetingCard?: any;
}

export function ChatDrawer({
  messages,
  isLoading,
  error,
  onSend,
  onClear,
  activeVersion,
  features,
  organizationId,
  sessionId,
  loadSession,
  isRestoring,
  checkAndDeliverGreeting,
  greetingCard,
}: ChatDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Most recent dashboard in the conversation drives the right-hand canvas.
  // When present the drawer widens into a two-pane split (chat | dashboard);
  // otherwise it stays the narrow single-column drawer.
  const latestDashboard = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.dashboard) return m.dashboard;
    }
    return null;
  }, [messages]);
  const splitMode = !!latestDashboard;

  // Canvas full-screen state lives here so we can drop the Sheet's modal
  // scroll-lock while expanded — Radix's react-remove-scroll otherwise kills
  // wheel scrolling on the body-portaled full-screen overlay.
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  useEffect(() => { if (!splitMode) setCanvasExpanded(false); }, [splitMode]);

  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

  const getAuthHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
  }, []);

  // Deliver greeting + load Phase 4 data when drawer opens
  useEffect(() => {
    if (!isOpen || !organizationId) return;

    checkAndDeliverGreeting?.(organizationId);

    const loadPhase4 = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const base = import.meta.env.VITE_BACKEND_URL || '';

        try {
          const res = await fetch(`${base}/api/chatbot/anomalies/${organizationId}`, { headers });
          if (res.ok) setAnomalies(await res.json());
        } catch { /* silent */ }

        try {
          const res = await fetch(`${base}/api/chatbot/recommendations/${organizationId}`, { headers });
          if (res.ok) setRecommendations(await res.json());
        } catch { /* silent */ }
      } catch { /* silent */ }
    };

    loadPhase4();
  }, [isOpen, organizationId, checkAndDeliverGreeting]);

  const handleDismissAnomaly = async (id: string) => {
    const headers = await getAuthHeaders();
    await fetch(`${backendUrl}/api/chatbot/anomalies/${id}/action`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismissed' }),
    });
    setAnomalies(prev => prev.filter(a => a.id !== id));
  };

  const handleRecommendationAction = async (id: string, action: 'acted' | 'snoozed' | 'dismissed') => {
    const headers = await getAuthHeaders();
    await fetch(`${backendUrl}/api/chatbot/recommendations/${id}/action`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setRecommendations(prev => prev.filter(r => r.id !== id));
  };

  const handleDownloadPdf = async () => {
    if (!sessionId) return;
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const base = import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${base}/api/chatbot/sessions/${sessionId}/export-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authSession?.access_token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dentpulse-report-${sessionId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silent fail
    }
  };

  const handleSuggestionSelect = (suggestion: string) => {
    const lower = suggestion.toLowerCase();
    if (lower === 'download pdf' || lower === 'download report') {
      handleDownloadPdf();
      return;
    }
    onSend(suggestion);
  };

  return (
    <>
      <ChatFloatingButton onClick={() => setIsOpen(true)} />

      <Sheet
        open={isOpen}
        onOpenChange={(o) => { setIsOpen(o); if (!o) setCanvasExpanded(false); }}
        modal={!canvasExpanded}
      >
        <SheetContent
          data-chatbot-root
          side="right"
          className={cn(
            'p-0 flex flex-col [&>button.absolute]:hidden',
            splitMode ? 'w-full sm:w-[1140px] sm:max-w-[95vw]' : 'w-full sm:w-[720px] sm:max-w-[50vw]',
          )}
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">DentPulse AI Chat</SheetTitle>

          <div className="flex flex-1 min-h-0">
            {/* ── Chat column ── */}
            <div
              className={cn(
                'flex flex-col min-h-0',
                splitMode ? 'w-full sm:w-[420px] sm:shrink-0 sm:border-r sm:border-border/40' : 'flex-1',
              )}
            >
              <ChatHeader
                activeVersion={activeVersion}
                onClear={() => { onClear(); setShowHistory(false); }}
                onClose={() => setIsOpen(false)}
                sessionId={sessionId}
                hasMessages={messages.length > 0}
                onShowHistory={() => setShowHistory(true)}
              />

              {/* Chat History overlay */}
              <ChatHistory
                open={showHistory}
                onClose={() => setShowHistory(false)}
                onSelectSession={(id) => { loadSession?.(id); }}
                onNewChat={onClear}
                currentSessionId={sessionId}
              />

              {/* All cards now render inside ChatMessageList */}
              <ChatMessageList
                messages={messages}
                isLoading={isLoading}
                isRestoring={isRestoring}
                onSuggestionSelect={handleSuggestionSelect}
                greetingCard={greetingCard}
                anomalies={anomalies}
                recommendations={recommendations}
                onDismissAnomaly={handleDismissAnomaly}
                onRecommendationAction={handleRecommendationAction}
              />

              {error && (
                <div className="mx-3 mb-2 p-3 rounded-md bg-destructive/10 text-destructive text-xs">
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <p>{error.message}</p>
                  </div>
                </div>
              )}

              <ChatInput
                onSend={onSend}
                disabled={isLoading}
                organizationId={organizationId}
                features={{ atMentions: features.feature_at_mentions }}
              />
            </div>

            {/* ── Dashboard canvas (split mode, ≥sm) ── */}
            {splitMode && latestDashboard && (
              <div className="hidden sm:flex flex-1 min-w-0 min-h-0">
                <DashboardCanvas
                  dashboard={latestDashboard}
                  expanded={canvasExpanded}
                  onExpandedChange={setCanvasExpanded}
                />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
