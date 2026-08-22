import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useChatbotConfig, type ChatbotConfig } from './useChatbotConfig';
import { isGreetingPending, clearGreetingPending } from './useActivityTracker';

// Returns a non-expired Supabase access token, refreshing if it's within 60s of
// expiry. Without this the chatbot sends a stale JWT to the Node backend and
// gets "Invalid or expired token" after the user idles past the token lifetime.
// `forceRefresh` skips the local-expiry check and unconditionally hits Supabase
// to mint a new token — used as a retry path when the backend rejects a token
// we still believed was valid (clock skew, server-side revocation, etc).
async function getFreshAccessToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (session?.access_token) {
      const expiresAt = session.expires_at ?? 0;
      const now = Math.floor(Date.now() / 1000);
      if (expiresAt > now + 60) return session.access_token;
    }
  }
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) return null;
  return refreshData.session?.access_token ?? null;
}

// Safely serialize pageContext — strips circular references and functions
function safePageContext(ctx: any): Record<string, any> | undefined {
  if (!ctx) return undefined;
  try {
    // Try to stringify then parse — drops circular refs and functions
    return JSON.parse(JSON.stringify(ctx, (_, value) => {
      if (typeof value === 'function') return undefined;
      if (typeof value === 'object' && value !== null && value?.$$typeof) return undefined; // React elements
      return value;
    }));
  } catch {
    // If it still fails, just send the page name
    return { page: ctx?.page || 'unknown' };
  }
}

// Captures a universal snapshot of the page so the bot can answer "anything
// visible on this page" without per-page wiring: URL + document title + the
// rendered text of <main>. Text is collapsed and capped so a long page
// (Treatments, Reports) doesn't blow the request body.
//
// ALSO captures any open Radix/portal-rendered surfaces (dialogs, sheets,
// drawers, popovers, dropdowns, command palettes, tooltips) so the bot can
// answer questions about modal/overlay content that isn't inside <main>.
// Without this the chatbot is blind to anything portaled to document.body.
//
// We exclude the chatbot's OWN drawer to avoid the bot reading its own UI
// (would create echo + waste tokens). Detected by sr-only sheet title
// "DentPulse AI Chat" — see ChatDrawer.tsx.
function captureOverlayText(): string {
  if (typeof document === 'undefined') return '';
  // Defensive — any DOM query failure (custom-element exception, weird
  // shadow root, Radix portal mid-transition, etc.) must not break the
  // chat send flow. Worst case: empty overlays.
  try {
    // Radix sets data-state="open" on every open dialog/sheet/popover/dropdown.
    // role-based selectors catch overlays from other libs (Headless UI, MUI, etc).
    // Tooltips are excluded — too noisy and rarely useful as context.
    const selectors = [
      '[role="dialog"][data-state="open"]',
      '[role="alertdialog"][data-state="open"]',
      '[data-radix-popper-content-wrapper] [data-state="open"]',
      '[role="menu"][data-state="open"]',
      '[role="listbox"][data-state="open"]',
      '[cmdk-root]',
    ];
    const seen = new Set<Element>();
    const parts: string[] = [];
    for (const sel of selectors) {
      let nodes: NodeListOf<Element>;
      try { nodes = document.querySelectorAll(sel); } catch { continue; }
      nodes.forEach((el) => {
        try {
          if (seen.has(el)) return;
          if (el.closest('[data-chatbot-root]')) return;
          const sheetTitle = el.querySelector('h2, [id]');
          if (sheetTitle && /DentPulse AI/i.test(sheetTitle.textContent || '')) return;
          seen.add(el);
          const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length === 0) return;
          const ariaLabel = el.getAttribute('aria-label')
            || el.getAttribute('aria-labelledby')
            || '';
          let label = ariaLabel;
          if (ariaLabel && !ariaLabel.includes(' ')) {
            const ref = document.getElementById(ariaLabel);
            if (ref) label = (ref.textContent || '').trim();
          }
          if (!label) {
            const heading = el.querySelector('h1, h2, h3, [role="heading"]');
            if (heading) label = (heading.textContent || '').trim();
          }
          const prefix = label ? `[${label}] ` : '[Overlay] ';
          parts.push(prefix + text);
        } catch { /* swallow per-element failures */ }
      });
    }
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

function capturePageSnapshot(): { url: string; title: string; visibleText: string; overlays?: string } | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  try {
    const main = document.querySelector('main');
    const raw = main ? (main as HTMLElement).innerText || main.textContent || '' : '';
    // Collapse whitespace and cap at ~12k chars — enough for the biggest pages,
    // small enough to stay well under any model context budget.
    const visibleText = raw.replace(/\s+/g, ' ').trim().slice(0, 12000);
    const overlaysRaw = captureOverlayText();
    // Separate overlay cap (4k) so a wide-open modal doesn't crowd out main
    // page text. Backend can read either field.
    const overlays = overlaysRaw.length > 0 ? overlaysRaw.slice(0, 4000) : undefined;
    return {
      url: window.location.pathname + window.location.search,
      title: document.title || '',
      visibleText,
      overlays,
    };
  } catch (err) {
    // Last-resort fallback — just URL + title so the bot at least knows the
    // page. A failed snapshot must never block the user's message.
    console.warn('[chatbot] page snapshot capture failed:', err);
    return {
      url: window.location.pathname + window.location.search,
      title: document.title || '',
      visibleText: '',
    };
  }
}

export interface ChartPayload {
  type: 'bar' | 'line';
  title: string;
  labels: string[];
  values: number[];
  secondaryValues?: number[];
  valueUnit: 'currency' | 'percent' | 'count';
}

// ── Conversational BI dashboard payload (mirrors the backend
// dashboardOrchestrator output; see backend/services/chatbot/bi/) ──
export type DashboardWidgetType = 'kpi' | 'bar' | 'line' | 'pie' | 'table' | 'text';

export interface DashboardPoint {
  label: string;
  value: number;
  count?: number;
}

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetType;
  title: string;
  description?: string;
  gridSpan: 1 | 2;
  data: {
    // kpi
    value?: number;
    // bar | line | pie
    points?: DashboardPoint[];
    // table
    columns?: string[];
    rows?: (string | number)[][];
    valueColumnIndex?: number;
    // text
    markdown?: string;
    unit?: 'currency' | 'count';
  };
  meta?: Record<string, any>;
}

export interface DashboardStep {
  key: string;
  label: string;
  ok: boolean;
}

export interface DashboardUsage {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  tools: number;
}

export interface DashboardPayload {
  title: string;
  period?: { from: string; to: string; label: string };
  steps?: DashboardStep[];
  usage?: DashboardUsage;
  insights: { text: string; widgetId?: string }[];
  widgets: DashboardWidget[];
  followUps: string[];
}

export type AttachmentKind = 'image' | 'pdf' | 'doc';

export interface ChatAttachment {
  id?: string;
  name: string;
  dataUrl: string;
  kind: AttachmentKind;
  mediaType: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
  chart?: ChartPayload | null;
  dashboard?: DashboardPayload | null;
  timestamp?: string; // ISO string
  version?: 'v1' | 'v2';
  attachments?: ChatAttachment[]; // UI-only, not persisted
}

export interface ChatError {
  message: string;
  errorCode?: string;
  isAdmin?: boolean;
}

export function useChatbot(pageContext?: Record<string, any>) {
  const { data: config } = useChatbotConfig();
  const { profile } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const greetingDeliveredRef = useRef(false);

  // Each page mount starts a fresh chat so the bot's context matches the
  // page the user is actually on. Past conversations remain available via
  // the History button (loadSession).
  const [isRestoring] = useState(false);

  const sendMessage = useCallback(async (
    userMessage: string,
    attachments?: ChatAttachment[],
    mentions?: { value: string; type: string }[],
  ) => {
    const hasText = userMessage.trim().length > 0;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!hasText && !hasAttachments) return;

    // Auto-remove greeting card when user starts working
    setGreetingCard(null);
    if (userId) clearGreetingPending(userId);

    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
      attachments: hasAttachments ? attachments : undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const accessToken = await getFreshAccessToken();
      if (!accessToken) throw new Error('Session expired. Please log in again.');

      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      // Backend accepts both legacy `images` (array of data URLs) and the new
      // `attachments` (typed). Send both so older backend builds still work for
      // image attachments, and PDFs/DOCs flow through `attachments`.
      const imageDataUrls = hasAttachments
        ? attachments!.filter(a => a.kind === 'image').map(a => a.dataUrl)
        : [];
      // Merge the page's structured data with a live snapshot of what's
      // rendered. The snapshot lets the model answer questions about any
      // visible value on any page — table rows, chart labels, KPI tiles —
      // without each page having to enumerate them in `aiContext.data`.
      const structured = safePageContext(pageContext) || {};
      const snapshot = capturePageSnapshot();
      // Heuristic: if the page passed almost no structured data AND the visible
      // text is short (under ~600 chars), the page is likely still loading.
      // Flag this so the backend prompt can tell the bot "data may still be
      // loading" instead of pretending zeros are real values.
      const structuredKeys = Object.keys(structured || {}).filter(k => k !== 'page');
      const looksLoading = structuredKeys.length <= 1
        && (snapshot?.visibleText?.length ?? 0) < 600;
      const body = JSON.stringify({
        message: userMessage,
        sessionId: sessionIdRef.current,
        pageContext: { ...structured, snapshot, isPageLoading: looksLoading || undefined },
        images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
        mentions: Array.isArray(mentions) && mentions.length > 0 ? mentions : undefined,
        attachments: hasAttachments ? attachments!.map(a => ({
          name: a.name,
          kind: a.kind,
          mediaType: a.mediaType,
          dataUrl: a.dataUrl,
        })) : undefined,
      });
      const postOnce = (token: string) => fetch(`${backendUrl}/api/chatbot/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body,
      });

      let res = await postOnce(accessToken);

      // If the backend rejected the JWT (stale local session, clock skew,
      // server-side revocation), force-refresh once and retry. We only retry
      // for 401 specifically so genuine 5xx/400 errors aren't masked.
      if (res.status === 401) {
        const refreshed = await getFreshAccessToken(true);
        if (refreshed) {
          res = await postOnce(refreshed);
        }
      }

      // Dev-only: the Node backend runs under watch mode, so saving a backend
      // file restarts it and the Vite proxy drops any in-flight chat request
      // with a 504 { errorCode: 'BACKEND_UNREACHABLE' } (see vite.config.ts).
      // The backend usually reboots within a few seconds; resend so the user
      // doesn't have to. Two attempts with backoff (2.5s, then 5s) so a
      // slightly longer restart window still recovers. Safe/idempotent: the
      // dropped request never reached saveMessages, and slot-fill state is
      // already persisted server-side from the prior turn. Inert in prod
      // (no proxy → this errorCode never occurs).
      const RETRY_DELAYS_MS = [2500, 5000];
      for (const delay of RETRY_DELAYS_MS) {
        if (res.status !== 504) break;
        const probe: { errorCode?: string } = await res.clone().json().catch(() => ({}));
        if (probe?.errorCode !== 'BACKEND_UNREACHABLE') break;
        await new Promise(r => setTimeout(r, delay));
        const retryToken = await getFreshAccessToken();
        if (!retryToken) break;
        res = await postOnce(retryToken);
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        let errMessage = errorData.error || `Request failed with status ${res.status}`;
        // Translate the backend's terse 401 into something actionable for the user.
        if (res.status === 401) {
          errMessage = 'Your session has expired. Please reload the page or sign in again.';
        }
        // NO_API_KEY keeps the dedicated banner UI so admins can jump to
        // Settings → AI. Every other failure (billing, auth, overload, …)
        // is rendered as an assistant chat message instead of a red banner,
        // so it stays inline with the conversation.
        if (errorData.errorCode === 'NO_API_KEY') {
          setError({
            message: errMessage,
            errorCode: errorData.errorCode,
            isAdmin: errorData.isAdmin,
          });
        } else {
          const errorMsg: ChatMessage = {
            role: 'assistant',
            content: errMessage,
            timestamp: new Date().toISOString(),
          };
          setMessages(prev => [...prev, errorMsg]);
        }
        return;
      }

      const data = await res.json();
      sessionIdRef.current = data.sessionId;

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.message,
        suggestions: data.suggestions || [],
        chart: data.chart || null,
        dashboard: data.dashboard || null,
        version: data.version,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Failed to get response',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [pageContext]);

  const loadSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const accessToken = await getFreshAccessToken();
      if (!accessToken) throw new Error('Session expired. Please log in again.');

      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${backendUrl}/api/chatbot/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to load session');

      const data = await res.json();
      const loaded: ChatMessage[] = (data || []).map((m: any) => ({
        role: m.role,
        content: m.content,
        chart: m.chart_json || null,
        dashboard: m.data_json?.dashboard || null,
        suggestions: m.data_json?.suggestions || [],
        timestamp: m.created_at || null,
      }));

      setMessages(loaded);
      sessionIdRef.current = sessionId;
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Failed to load session' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Ephemeral greeting card — never stored in DB, auto-cleared on first send
  const [greetingCard, setGreetingCard] = useState<any>(null);

  const userId = profile?.user_id || null;

  // Check greeting flag and load briefing data when chatbot drawer opens
  const checkAndDeliverGreeting = useCallback(async (orgId?: string) => {
    if (greetingDeliveredRef.current) return;
    if (!userId || !isGreetingPending(userId)) return;
    if (!orgId) return;

    greetingDeliveredRef.current = true;

    try {
      const accessToken = await getFreshAccessToken();
      if (!accessToken) return;

      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${backendUrl}/api/chatbot/briefing/${orgId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;

      const briefing = await res.json();
      if (!briefing) return;

      setGreetingCard(briefing);
    } catch {
      // Silent — don't block chatbot if greeting fails
    }
  }, [userId]);

  // Reset greeting delivered flag when starting a new chat
  const clearMessagesWithGreetingReset = useCallback(() => {
    setMessages([]);
    sessionIdRef.current = null;
    setError(null);
    setGreetingCard(null);
    if (userId) clearGreetingPending(userId);
    greetingDeliveredRef.current = false;
  }, [userId]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages: clearMessagesWithGreetingReset,
    loadSession,
    isRestoring,
    activeVersion: config?.active_version || 'v2',
    features: config || {} as ChatbotConfig,
    organizationId: profile?.current_organization_id || null,
    sessionId: sessionIdRef.current,
    checkAndDeliverGreeting,
    greetingCard,
  };
}
