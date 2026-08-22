import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MessageSquare, ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatSessionSkeleton } from './ChatSkeleton';
import { formatDistanceToNow } from 'date-fns';

interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  last_activity_at: string;
}

interface ChatHistoryProps {
  open: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  currentSessionId?: string | null;
}

export function ChatHistory({ open, onClose, onSelectSession, onNewChat, currentSessionId }: ChatHistoryProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`${backendUrl}/api/chatbot/sessions`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [backendUrl]);

  useEffect(() => {
    if (open) loadSessions();
  }, [open, loadSessions]);

  async function handleDelete(e: React.MouseEvent | null, sessionId: string) {
    e?.stopPropagation();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${backendUrl}/api/chatbot/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch { /* silent */ }
  }

  if (!open) return null;

  return (
    <div className="absolute inset-0 bg-background z-10 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-sm">Chat History</span>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { onNewChat(); onClose(); }}>
          <Plus className="h-3 w-3" /> New Chat
        </Button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <ChatSessionSkeleton />
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">No chat history yet</div>
        ) : (
          <div className="p-2 space-y-1">
            {sessions.map(s => (
              <div
                key={s.id}
                className={`flex items-center rounded-lg px-3 py-2.5 transition-colors hover:bg-muted ${
                  currentSessionId === s.id ? 'bg-primary/10 border border-primary/20' : ''
                }`}
              >
                <button
                  onClick={() => { onSelectSession(s.id); onClose(); }}
                  className="flex items-start gap-2 flex-1 min-w-0 text-left"
                >
                  <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.title || 'Untitled chat'}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(s.last_activity_at), { addSuffix: true })}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(null, s.id)}
                  className="ml-2 shrink-0 w-7 h-7 flex items-center justify-center rounded text-red-400 hover:text-red-600 hover:bg-red-50"
                  title="Delete chat"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
