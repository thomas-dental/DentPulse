import { ReactNode, useState, useMemo } from 'react';
import { AppSidebar } from './AppSidebar';
import { TopBar } from './TopBar';
import { AIChatWidget } from '@/components/ai/AIChatWidget';
import { ChatDrawer } from '@/components/chatbot/ChatDrawer';
import { useChatbot } from '@/hooks/useChatbot';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { useAuth } from '@/hooks/useAuth';
import { useFilters } from '@/contexts/FilterContext';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  children: ReactNode;
  userRole?: string;
  aiContext?: Record<string, any>;
  /** Override main content padding (defaults to p-6 pt-[4.5rem]). */
  contentClassName?: string;
}

export function MainLayout({
  children,
  userRole = 'admin',
  aiContext,
  contentClassName,
}: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { profile } = useAuth();
  useActivityTracker(profile?.user_id || null); // Platform-wide activity detection (user-scoped)

  // Forward location/region so page-aware queries don't need to re-ask which
  // site the user means, but intentionally OMIT the resolved period_from/to.
  // Forwarding concrete dates makes the bot silently assume that range for
  // every question (e.g. "Total Paid" → returns the current topbar window
  // instead of prompting). date_range_id is sent as a soft hint only.
  const { selectedLocationId, selectedRegionId, selectedDateRangeId } = useFilters();
  const enrichedContext = useMemo(() => ({
    ...(aiContext || {}),
    filters: {
      location_id: selectedLocationId,
      region_id: selectedRegionId,
      date_range_id: selectedDateRangeId,
      // Surface the page's provider-type filter (Dentist / Therapist / Hygienist
      // / Other) so the chatbot can scope chart_get_production_metrics by the
      // same type the page shows — otherwise asking "top 5" on the Dentist page
      // would still return hygienists/lab entries.
      provider_type: (aiContext as Record<string, unknown> | undefined)?.providerType ?? null,
    },
  }), [aiContext, selectedLocationId, selectedRegionId, selectedDateRangeId]);

  const chatbot = useChatbot(enrichedContext);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
      <TopBar sidebarCollapsed={sidebarCollapsed} />
      <main
        className={cn(
          'pt-[4.5rem] transition-all duration-300',
          sidebarCollapsed ? 'ml-16' : 'ml-[17.5rem]',
          contentClassName ?? 'p-6',
        )}
      >
        {children}
      </main>

      {/* Version-aware chatbot rendering */}
      {chatbot.activeVersion === 'v1' && (
        <AIChatWidget
          messages={chatbot.messages}
          isLoading={chatbot.isLoading}
          error={chatbot.error}
          onSend={chatbot.sendMessage}
          onClear={chatbot.clearMessages}
        />
      )}
      {chatbot.activeVersion === 'v2' && (
        <ChatDrawer
          messages={chatbot.messages}
          isLoading={chatbot.isLoading}
          error={chatbot.error}
          onSend={chatbot.sendMessage}
          onClear={chatbot.clearMessages}
          activeVersion="v2"
          features={chatbot.features}
          organizationId={chatbot.organizationId || undefined}
          sessionId={chatbot.sessionId}
          loadSession={chatbot.loadSession}
          isRestoring={chatbot.isRestoring}
          checkAndDeliverGreeting={chatbot.checkAndDeliverGreeting}
          greetingCard={chatbot.greetingCard}
        />
      )}
    </div>
  );
}
