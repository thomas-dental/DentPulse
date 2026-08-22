import { useEffect, useRef } from 'react';

const STORAGE_PREFIX = 'dp_activity_';
const INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const CHECK_INTERVAL_MS = 60 * 1000; // check every 1 minute
const THROTTLE_MS = 10_000; // throttle activity updates to every 10 seconds

interface ActivityState {
  lastActivityAt: number;      // timestamp of last user interaction
  greetingPending: boolean;    // flag: should chatbot greet on next open?
}

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function getState(userId: string): ActivityState {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt data — reset */ }
  // First-ever visit for this user → greeting pending
  return { lastActivityAt: Date.now(), greetingPending: true };
}

function setState(userId: string, state: ActivityState) {
  localStorage.setItem(getStorageKey(userId), JSON.stringify(state));
}

/** Check if greeting is pending for a specific user (called by useChatbot) */
export function isGreetingPending(userId: string): boolean {
  if (!userId) return false;
  return getState(userId).greetingPending;
}

/** Clear the greeting flag after it's been shown (called by useChatbot) */
export function clearGreetingPending(userId: string) {
  if (!userId) return;
  const state = getState(userId);
  state.greetingPending = false;
  setState(userId, state);
}

/**
 * Platform-wide activity tracker (user-scoped).
 * Listens to user interactions (click, keydown, scroll, mousemove, touchstart).
 * When user goes inactive for 30+ minutes, sets greetingPending = true.
 * Each user gets their own localStorage entry — logout + login as different user is safe.
 * Mount this once in MainLayout — it covers all pages.
 */
export function useActivityTracker(userId: string | null) {
  const lastWriteRef = useRef(0);

  useEffect(() => {
    if (!userId) return;

    // On mount: check if returning after inactivity (e.g. closed browser, came back)
    const state = getState(userId);
    const gap = Date.now() - state.lastActivityAt;
    if (gap >= INACTIVITY_THRESHOLD_MS && !state.greetingPending) {
      setState(userId, { lastActivityAt: Date.now(), greetingPending: true });
    } else {
      // User is here — update activity time (but don't clear greeting flag)
      setState(userId, { ...state, lastActivityAt: Date.now() });
    }

    // Throttled activity handler
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastWriteRef.current < THROTTLE_MS) return;
      lastWriteRef.current = now;

      const s = getState(userId);
      s.lastActivityAt = now;
      setState(userId, s);
    };

    // Periodic check: has user gone inactive?
    const intervalId = setInterval(() => {
      const s = getState(userId);
      const idle = Date.now() - s.lastActivityAt;
      if (idle >= INACTIVITY_THRESHOLD_MS && !s.greetingPending) {
        setState(userId, { ...s, greetingPending: true });
      }
    }, CHECK_INTERVAL_MS);

    // Listen to platform-wide user interactions
    const events: (keyof WindowEventMap)[] = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
    events.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }));

    return () => {
      clearInterval(intervalId);
      events.forEach(evt => window.removeEventListener(evt, handleActivity));
    };
  }, [userId]);
}
