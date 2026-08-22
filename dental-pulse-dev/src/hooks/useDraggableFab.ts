import { useCallback, useRef, useState } from 'react';

interface Position {
  x: number;
  y: number;
}

const DRAG_THRESHOLD_PX = 5;

function clamp(pos: Position, size: number): Position {
  const maxX = Math.max(window.innerWidth - size - 8, 8);
  const maxY = Math.max(window.innerHeight - size - 8, 8);
  return {
    x: Math.min(Math.max(pos.x, 8), maxX),
    y: Math.min(Math.max(pos.y, 8), maxY),
  };
}

function readStoredPosition(storageKey: string, size: number, margin: number): Position {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        return clamp(parsed, size);
      }
    }
  } catch {
    // ignore malformed storage
  }
  return clamp(
    { x: window.innerWidth - size - margin, y: window.innerHeight - size - margin },
    size,
  );
}

/** Drag-to-reposition a fixed-position floating button, persisted to localStorage. */
export function useDraggableFab(storageKey: string, size = 56, margin = 24) {
  const [position, setPosition] = useState<Position>(() => readStoredPosition(storageKey, size, margin));
  const draggingRef = useRef(false);
  const draggedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    draggedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    offsetRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (!draggedRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      draggedRef.current = true;
    }
    if (draggedRef.current) {
      setPosition(clamp({ x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y }, size));
    }
  }, [size]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (draggedRef.current) {
      setPosition((p) => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(p));
        } catch {
          // ignore storage failures (private mode, quota, etc.)
        }
        return p;
      });
    }
  }, [storageKey]);

  /** Wrap a click handler so a drag doesn't also fire it as a click. */
  const wrapClick = useCallback((onClick?: () => void) => () => {
    if (draggedRef.current) return;
    onClick?.();
  }, []);

  return { position, onPointerDown, onPointerMove, onPointerUp, wrapClick };
}
