import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../utils/api';

export async function settingsRequest(url, options) {
  const response = await authenticatedFetch(url, options);
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok || data.success === false || data.error) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return data;
}

// Each form keeps its own feedback. Locks cover the interval before React has
// rendered disabled controls; obsolete completions cannot update another tab.
export function useSettingsRequest() {
  const [states, setStates] = useState({});
  const epoch = useRef(0);
  const locks = useRef(new Map());
  useEffect(() => {
    epoch.current++;
    return () => { epoch.current++; locks.current.clear(); };
  }, []);
  const run = useCallback(async (key, operation, apply) => {
    if (locks.current.has(key)) return false;
    const generation = epoch.current;
    const token = {};
    locks.current.set(key, token);
    setStates(previous => ({ ...previous, [key]: { pending: true } }));
    try {
      const data = await operation();
      if (epoch.current !== generation) return false;
      apply?.(data);
      setStates(previous => ({ ...previous, [key]: { success: true } }));
      return true;
    } catch (error) {
      if (epoch.current === generation) setStates(previous => ({ ...previous, [key]: { error: error.message || String(error) } }));
      return false;
    } finally {
      if (locks.current.get(key) === token) locks.current.delete(key);
    }
  }, []);
  const clear = useCallback(key => setStates(previous => ({ ...previous, [key]: undefined })), []);
  return { states, run, clear };
}
