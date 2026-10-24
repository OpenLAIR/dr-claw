import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readQueue, writeQueue, type SavedQueueItem, type SavedQueue } from '../utils/messageQueueStorage';

export type QueuedMessage = SavedQueueItem & { run?: (sessionId: string | null, isCurrent: () => boolean, text: string) => Promise<boolean> };
type Queue = { items: QueuedMessage[]; paused: boolean; ready: boolean; editing: { id: string; text: string } | null; dispatchingId: string | null; loaded: boolean; storageError: boolean; saving: number; writeChain: Promise<void>; restored: boolean; storageScope: string };
const freshQueue = (scope: string): Queue => ({ items: [], paused: false, ready: false, editing: null, dispatchingId: null, loaded: false, storageError: false, saving: 0, writeChain: Promise.resolve(), restored: false, storageScope: scope });

/** Persist file-bearing drafts by account/project/provider/conversation. Restoration always pauses. */
export function useMessageQueue(scope: string, sessionId: string | null, loading: boolean, connected: boolean, restoreRun: (item: SavedQueueItem, sessionId: string | null, isCurrent: () => boolean) => Promise<boolean>) {
  const queues = useRef(new Map<string, Queue>());
  const active = useRef(scope);
  const previous = useRef(scope);
  const running = useRef(false);
  const mounted = useRef(true);
  const busy = useRef(loading);
  busy.current = loading;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [revision, render] = useState(0);
  const refresh = useCallback(() => render(value => value + 1), []);
  active.current = scope;
  const get = useCallback((key: string) => {
    if (!queues.current.has(key)) queues.current.set(key, freshQueue(key));
    return queues.current.get(key)!;
  }, []);
  const queue = get(scope);
  const restoreRunner = useRef(restoreRun);
  restoreRunner.current = restoreRun;
  const persist = useCallback((current: Queue, removeScope?: string) => {
    const snapshot: SavedQueue = { version: 1, items: current.items.map(({ run: _run, ...item }) => ({ ...item })), editing: current.editing ? { ...current.editing } : null };
    const key = current.storageScope;
    current.saving++;
    current.writeChain = current.writeChain.catch(() => {}).then(() => writeQueue(key, snapshot, removeScope)).then(() => { current.storageError = false; }).catch(() => { current.storageError = true; }).finally(() => { current.saving--; if (mounted.current) refresh(); });
    refresh();
    return current.writeChain;
  }, [refresh]);
  const restore = useCallback(() => {
    let cancelled = false;
    void readQueue(queue.storageScope).then(saved => {
      if (cancelled) return;
      if (saved) { queue.items = saved.items; queue.editing = saved.editing; queue.paused = true; queue.ready = false; queue.restored = saved.items.length > 0; }
      queue.storageError = false; queue.loaded = true; refresh();
    }).catch(() => { if (!cancelled) { queue.storageError = true; refresh(); } });
    return () => { cancelled = true; };
  }, [queue, refresh]);
  useEffect(() => { if (!queue.loaded) return restore(); }, [queue, restore]);
  const retryStorage = useCallback(() => { if (queue.items.length) void persist(queue); else { queue.loaded = false; refresh(); return restore(); } }, [queue, persist, refresh, restore]);
  useEffect(() => {
    const protectQueuedDrafts = (event: BeforeUnloadEvent) => {
      if ([...queues.current.values()].some(current => current.saving > 0 || (current.storageError && current.items.length > 0))) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protectQueuedDrafts);
    return () => window.removeEventListener('beforeunload', protectQueuedDrafts);
  }, []);

  useLayoutEffect(() => {
    // Keep the temporary alias until React has committed the assigned session.
    if (!scope.endsWith(':new')) {
      for (const [key, value] of queues.current) {
        if (key.endsWith(':new') && value === get(scope)) queues.current.delete(key);
      }
    }
    if (previous.current !== scope) {
      const old = get(previous.current);
      if (old.items.length) old.paused = true;
      previous.current = scope;
      refresh();
    }
  }, [scope, get, refresh]);
  useEffect(() => {
    if (!connected && queue.items.length) { queue.paused = true; refresh(); }
  }, [connected, queue, refresh]);

  const enqueue = useCallback((item: QueuedMessage) => {
    const current = get(active.current); current.items.push(item); void persist(current);
  }, [get, persist]);
  const start = useCallback(() => { const current = get(active.current); current.paused = false; current.ready = false; refresh(); }, [get, refresh]);
  const pause = useCallback(() => { get(active.current).paused = true; refresh(); }, [get, refresh]);
  const resume = useCallback(() => {
    const current = get(active.current); current.paused = false; current.ready = true; current.restored = false; refresh();
  }, [get, refresh]);
  const complete = useCallback((success: boolean) => {
    const current = get(active.current);
    if (!success) current.paused = true;
    current.ready = success;
    refresh();
  }, [get, refresh]);
  const bindSession = useCallback((id: string) => {
    const oldScope = active.current;
    if (!oldScope.endsWith(':new')) return;
    const nextScope = oldScope.slice(0, -3) + id;
    const current = get(oldScope);
    current.storageScope = nextScope;
    queues.current.set(nextScope, current);
    void persist(current, oldScope);
    previous.current = nextScope;
  }, [get, persist]);
  const remove = useCallback((id: string) => {
    const current = get(active.current);
    if (current.dispatchingId === id) return;
    current.items = current.items.filter(item => item.id !== id);
    if (current.editing?.id === id) current.editing = null;
    void persist(current);
  }, [get, persist]);

  const beginEdit = useCallback((id: string) => {
    const current = get(active.current);
    const item = current.items.find(entry => entry.id === id);
    if (!item || current.dispatchingId === id || current.editing) return;
    current.editing = { id, text: item.text };
    void persist(current);
  }, [get, persist]);
  const updateEdit = useCallback((text: string) => {
    const current = get(active.current);
    if (current.editing) { current.editing.text = text; void persist(current); }
  }, [get, persist]);
  const cancelEdit = useCallback(() => { const current = get(active.current); current.editing = null; void persist(current); }, [get, persist]);
  const saveEdit = useCallback(() => {
    const current = get(active.current);
    const item = current.items.find(entry => entry.id === current.editing?.id);
    if (!item || !current.editing || current.dispatchingId === item.id) return;
    if (!current.editing.text.trim() && !item.files.length && !item.hasPrompt) return;
    // Keep the same object and position, including its captured files and prompt.
    item.text = current.editing.text;
    current.editing = null;
    void persist(current);
  }, [get, persist]);

  useEffect(() => {
    if (!queue.loaded || loading || !connected || running.current || queue.paused || !queue.ready || !queue.items.length) return;
    const item = queue.items[0];
    if (queue.editing?.id === item.id) return;
    running.current = true;
    queue.ready = false;
    // Defer until lifecycle/session navigation effects have settled.
    setTimeout(async () => {
      if (!mounted.current || active.current !== scope) { running.current = false; refresh(); return; }
      if (queue.paused || busy.current || queue.editing?.id === item.id || !queue.items.includes(item)) {
        running.current = false;
        queue.ready = true;
        refresh();
        return;
      }
      try {
        queue.dispatchingId = item.id;
        refresh();
        item.uncertain = true;
        await persist(queue);
        if (!mounted.current || active.current !== scope || queue.paused || busy.current) {
          item.uncertain = false;
          queue.paused = true;
          void persist(queue);
          return;
        }
        const isCurrent = () => mounted.current && active.current === scope;
        const sent = item.run ? await item.run(sessionId, isCurrent, item.text) : await restoreRunner.current(item, sessionId, isCurrent);
        queue.items = queue.items.filter(entry => entry.id !== item.id);
        if (!sent) queue.ready = true;
        await persist(queue);
      } catch (error) {
        console.warn('Queued message paused:', error);
        item.uncertain = false;
        queue.paused = true;
        void persist(queue);
      } finally {
        queue.dispatchingId = null;
        running.current = false;
        refresh();
      }
    }, 0);

  }, [loading, connected, queue, queue.items.length, queue.paused, queue.ready, queue.editing?.id, queue.loaded, scope, sessionId, refresh, persist, revision]);

  return { restoring: !queue.loaded, storageError: queue.storageError, saving: queue.saving > 0, restored: queue.restored, retryStorage, items: queue.items, paused: queue.paused, editing: queue.editing, dispatchingId: queue.dispatchingId, beginEdit, updateEdit, saveEdit, cancelEdit, enqueue, start, pause, resume, complete, bindSession, remove };
}
