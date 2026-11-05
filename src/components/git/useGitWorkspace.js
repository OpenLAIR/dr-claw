import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../utils/api';

const paths = { status: 'status', branches: 'branches', remote: 'remote-status', history: 'commits' };
const emptyData = { status: null, branches: [], remote: null, history: [], diffs: {} };

/** Reads are scoped and latest-wins; mutations keep their drafts until confirmed. */
export function useGitWorkspace(project) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [missingRepo, setMissingRepo] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const requests = useRef(new Map());
  const mutationLock = useRef(false);
  const initializedSelection = useRef(false);

  const request = useCallback(async (path, options) => {
    const response = await authenticatedFetch(`/api/git/${path}`, options);
    const result = await response.json();
    if (!response.ok || result.error || result.success === false) {
      throw new Error([result.error, result.details].filter((value, index, values) => value && values.indexOf(value) === index).join('\n') || `HTTP ${response.status}`);
    }
    return result;
  }, []);

  const read = useCallback(async (key, path, apply) => {
    const generation = epoch.current;
    requests.current.get(key)?.abort();
    const controller = new AbortController();
    requests.current.set(key, controller);
    const current = () => epoch.current === generation && requests.current.get(key) === controller;
    setLoading(prev => ({ ...prev, [key]: true }));
    setErrors(prev => ({ ...prev, [key]: '' }));
    try {
      const result = await request(`${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(project)}`, { signal: controller.signal });
      if (current()) apply(result);
      return current();
    } catch (error) {
      if (current() && error.name !== 'AbortError') {
        if (key === 'status' && /not a git repository/i.test(error.message)) {
          setMissingRepo(true);
          setData(emptyData);
        } else setErrors(prev => ({ ...prev, [key]: error.message }));
      }
      return false;
    } finally {
      if (current()) setLoading(prev => ({ ...prev, [key]: false }));
    }
  }, [project, request]);

  const load = useCallback((key) => read(key, `${paths[key]}${key === 'history' ? '?limit=10' : ''}`, result => {
    if (key === 'status') {
      setMissingRepo(false);
      const files = [...(result.modified || []), ...(result.added || []), ...(result.deleted || []), ...(result.untracked || [])];
      const hasSelection = initializedSelection.current;
      setSelected(prev => new Set(hasSelection ? [...prev].filter(file => files.includes(file)) : files));
      initializedSelection.current = true;
      setData(prev => ({ ...prev, status: result }));
    } else setData(prev => ({ ...prev, [key]: key === 'branches' ? result.branches || [] : key === 'history' ? result.commits || [] : result }));
  }), [read]);

  const refresh = useCallback(async () => {
    const generation = epoch.current;
    if (await load('status') && epoch.current === generation) await Promise.all([load('branches'), load('remote'), load('history')]);
  }, [load]);

  useEffect(() => {
    epoch.current++;
    initializedSelection.current = false;
    setData(emptyData); setSelected(new Set()); setErrors({}); setLoading({});
    setMissingRepo(false); setNotice('');
    if (project) void refresh();
    return () => {
      epoch.current++;
      for (const controller of requests.current.values()) controller.abort();
      requests.current.clear();
    };
  }, [project, refresh]);

  const loadDiff = useCallback((kind, value) => {
    const key = `${kind}:${value}`;
    const query = kind === 'file' ? `diff?file=${encodeURIComponent(value)}` : `commit-diff?commit=${encodeURIComponent(value)}`;
    return read(key, query, result => setData(prev => ({ ...prev, diffs: { ...prev.diffs, [key]: result.diff || '' } })));
  }, [read]);

  const mutate = useCallback(async (action, payload = {}) => {
    if (mutationLock.current) return null;
    mutationLock.current = true;
    const generation = epoch.current;
    setBusy(action); setNotice(''); setErrors(prev => ({ ...prev, action: '' }));
    try {
      const result = await request(action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, ...payload }) });
      if (epoch.current !== generation) return null;
      if (action === 'generate-commit-message' && !result.message?.trim()) throw new Error('No commit message was returned.');
      if (action !== 'generate-commit-message') {
        setData(prev => ({ ...prev, diffs: {} }));
        setNotice(action);
        await refresh();
      }
      return epoch.current === generation ? result : null;
    } catch (error) {
      if (epoch.current === generation) setErrors(prev => ({ ...prev, action: error.message }));
      return null;
    } finally {
      mutationLock.current = false;
      if (epoch.current === generation) setBusy('');
    }
  }, [project, refresh, request]);

  const openFile = useCallback(async (file, onFileOpen) => {
    const generation = epoch.current;
    try {
      const result = await request(`file-with-diff?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`);
      if (epoch.current === generation) onFileOpen?.(file, { old_string: result.oldContent || '', new_string: result.currentContent || '' });
    } catch {
      if (epoch.current === generation) onFileOpen?.(file);
    }
  }, [project, request]);

  const clearActionError = useCallback(() => setErrors(prev => ({ ...prev, action: '' })), []);
  return { ...data, loading, errors, missingRepo, selected, setSelected, busy, notice, load, refresh, loadDiff, mutate, openFile, clearActionError };
}
