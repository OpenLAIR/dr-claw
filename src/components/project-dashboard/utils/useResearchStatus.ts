import { useEffect, useState } from 'react';
import { api } from '../../../utils/api';

export type ResearchRun = { status: string; startedAt?: string; finishedAt?: string; error?: string | null };
export type ResearchStatus = {
  state: 'ready' | 'error';
  activeRun?: ResearchRun | null;
  latestRun?: ResearchRun | null;
};

// Limit filesystem-backed status requests, and poll only while this view is visible.
export function useResearchStatus(projectNames: string[], refresh = 0) {
  const key = JSON.stringify([...new Set(projectNames)].sort());
  const [statuses, setStatuses] = useState<Record<string, ResearchStatus>>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const names: string[] = JSON.parse(key);
    let cancelled = false;
    let polling = false;
    setStatuses({});
    const poll = async () => {
      if (cancelled || polling || document.hidden) return;
      polling = true;
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
        while (!cancelled && index < names.length) {
          const name = names[index++];
          let status: ResearchStatus;
          try {
            const response = await api.autoResearch.status(name);
            if (!response.ok) throw new Error('status');
            const data = await response.json();
            if (data.success !== true) throw new Error('status');
            status = { state: 'ready', activeRun: data.activeRun, latestRun: data.latestRun };
          } catch { status = { state: 'error' }; }
          if (!cancelled) setStatuses(previous => ({ ...previous, [name]: status }));
        }
      }));
      polling = false;
    };
    void poll();
    const interval = window.setInterval(poll, 30_000);
    document.addEventListener('visibilitychange', poll);
    return () => { cancelled = true; window.clearInterval(interval); document.removeEventListener('visibilitychange', poll); };
  }, [key, refresh, retry]);
  return { statuses, retry: () => setRetry(value => value + 1) };
}
