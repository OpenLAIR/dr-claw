import { authenticatedFetch } from './api';
import { isTelemetryEnabled } from './telemetry';

type AutoresearchEvent = {
  name: string;
  source: string;
  data: Record<string, unknown>;
  clientAt: string;
};

const FLUSH_DELAY_MS = 500;
const MAX_BATCH_SIZE = 10;
const MAX_QUEUE_SIZE = 200;

let queue: AutoresearchEvent[] = [];
let flushTimer: number | null = null;
let isFlushing = false;

const scheduleFlush = () => {
  if (flushTimer !== null || typeof window === 'undefined') {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
};

const flush = async () => {
  if (isFlushing || queue.length === 0) {
    return;
  }
  if (!isTelemetryEnabled()) {
    queue = [];
    return;
  }

  isFlushing = true;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    await authenticatedFetch('/api/telemetry/events', {
      method: 'POST',
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    queue = [...batch, ...queue].slice(0, MAX_QUEUE_SIZE);
  } finally {
    isFlushing = false;
    if (queue.length > 0) {
      scheduleFlush();
    }
  }
};

export function emitAutoresearchEvent(
  name: string,
  data: Record<string, unknown> = {},
  source: string = 'autoresearch-ui',
): void {
  if (typeof window === 'undefined' || !isTelemetryEnabled()) {
    return;
  }

  queue.push({
    name,
    source,
    data,
    clientAt: new Date().toISOString(),
  });

  if (queue.length > MAX_QUEUE_SIZE) {
    queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
  }

  if (queue.length >= MAX_BATCH_SIZE) {
    void flush();
    return;
  }

  scheduleFlush();
}
