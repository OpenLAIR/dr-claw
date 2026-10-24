import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const STORAGE_KEY = 'chat-session-context-width';
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 360;
const MAX_WIDTH = 840;
const MIN_CHAT_WIDTH = 400;

export function useContextSidebarResize(enabled: boolean, isMobile: boolean, isCollapsed: boolean) {
  const asideRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(MAX_WIDTH + MIN_CHAT_WIDTH);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try {
      const saved = Number.parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
      return Number.isFinite(saved) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, saved)) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  // On compact desktop windows share the space; never push the chat offscreen.
  const maxWidth = Math.min(MAX_WIDTH, availableWidth - Math.min(MIN_CHAT_WIDTH, availableWidth / 2));
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const sidebarWidth = Math.round(Math.max(minWidth, Math.min(maxWidth, preferredWidth)));

  useLayoutEffect(() => {
    // The immediate parent uses display: contents and has no measurable box.
    const container = asideRef.current?.closest('[data-chat-workspace]');
    if (!container || !enabled || isMobile) return;
    const measure = () => {
      const width = container.getBoundingClientRect().width;
      if (width > 0) setAvailableWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled, isMobile, isCollapsed]);

  const updateWidth = useCallback((width: number) => {
    const next = Math.round(Math.max(minWidth, Math.min(maxWidth, width)));
    setPreferredWidth(next);
    return next;
  }, [minWidth, maxWidth]);

  const persistWidth = useCallback((width: number) => {
    try { localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* Storage can be unavailable. */ }
  }, []);

  const resetWidth = useCallback(() => {
    persistWidth(updateWidth(DEFAULT_WIDTH));
  }, [persistWidth, updateWidth]);

  const handleResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (isMobile || isCollapsed || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    cleanupRef.current?.();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = asideRef.current?.getBoundingClientRect().width ?? sidebarWidth;
    let lastWidth = startWidth;
    let frame: number | null = null;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    target.focus({ preventScroll: true });
    target.setPointerCapture(pointerId);
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      lastWidth = startWidth + startX - moveEvent.clientX;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        updateWidth(lastWidth);
        frame = null;
      });
    };
    const finish = (endEvent?: globalThis.PointerEvent) => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      if (frame !== null) cancelAnimationFrame(frame);
      persistWidth(updateWidth(lastWidth));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', blur);
      target.removeEventListener('lostpointercapture', finish);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      cleanupRef.current = null;
      setIsResizing(false);
    };
    const blur = () => finish();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', blur);
    target.addEventListener('lostpointercapture', finish);
    cleanupRef.current = () => finish();
  }, [isMobile, isCollapsed, sidebarWidth, updateWidth, persistWidth]);

  useLayoutEffect(() => () => cleanupRef.current?.(), [enabled, isMobile, isCollapsed]);

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 10;
    const next = event.key === 'ArrowLeft' ? sidebarWidth + step
      : event.key === 'ArrowRight' ? sidebarWidth - step
      : event.key === 'Home' ? minWidth
      : event.key === 'End' ? maxWidth
      : event.key === 'Enter' ? DEFAULT_WIDTH : null;
    if (next === null) return;
    event.preventDefault();
    persistWidth(updateWidth(next));
  }, [sidebarWidth, minWidth, maxWidth, persistWidth, updateWidth]);

  return { asideRef, sidebarWidth, minWidth, maxWidth, isResizing, handleResizeStart, handleResizeKeyDown, resetWidth };
}
