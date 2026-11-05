import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../utils/api';
import type { Reference, ReferenceTag, ZoteroStatus } from '../types';

interface UseReferencesDataOptions {
  projectName?: string;
  autoFetch?: boolean;
}

export function useReferencesData({ projectName, autoFetch = true }: UseReferencesDataOptions = {}) {
  const [references, setReferences] = useState<Reference[]>([]);
  const [projectReferences, setProjectReferences] = useState<Reference[]>([]);
  const [tags, setTags] = useState<ReferenceTag[]>([]);
  const [zoteroStatus, setZoteroStatus] = useState<ZoteroStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const projectRequest = useRef(0);
  const [projectError, setProjectError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReferences = useCallback(async (search?: string, filterTags?: string[]) => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (filterTags && filterTags.length > 0) params.tags = filterTags.join(',');
      const res = await api.references.list(params);
      if (!res.ok) throw new Error('Failed to fetch references');
      const data = await res.json();
      setReferences(data.references || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProjectReferences = useCallback(async () => {
    if (!projectName) return;
    const request = ++projectRequest.current;
    setProjectError(false);
    try {
      const res = await api.references.projectRefs(projectName);
      if (!res.ok) throw new Error('Failed to fetch project references');
      const data = await res.json();
      if (request === projectRequest.current) setProjectReferences(data.references || []);
    } catch (err) {
      if (request === projectRequest.current) setProjectError(true);
      console.error('Error fetching project references:', err);
    }
  }, [projectName]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await api.references.tags();
      if (!res.ok) throw new Error('Failed to fetch tags');
      const data = await res.json();
      setTags(data.tags || []);
    } catch (err) {
      console.error('Error fetching tags:', err);
    }
  }, []);

  const checkZoteroStatus = useCallback(async () => {
    try {
      const res = await api.references.zoteroStatus();
      if (res.ok) {
        const data = await res.json();
        setZoteroStatus(data);
      } else {
        setZoteroStatus({ connected: false, mode: null, localAvailable: false, localRunning: false, localApiDisabled: false });
      }
    } catch {
      setZoteroStatus({ connected: false, mode: null, localAvailable: false, localRunning: false, localApiDisabled: false });
    }
  }, []);

  const linkToProject = useCallback(async (referenceId: string) => {
    if (!projectName) return;
    try {
      const res = await api.references.linkToProject(projectName, referenceId);
      if (res.ok) {
        await fetchProjectReferences();
      }
    } catch (err) {
      console.error('Error linking reference:', err);
    }
  }, [projectName, fetchProjectReferences]);

  const unlinkFromProject = useCallback(async (referenceId: string) => {
    if (!projectName) return;
    try {
      const res = await api.references.unlinkFromProject(projectName, referenceId);
      if (res.ok) {
        await fetchProjectReferences();
      }
    } catch (err) {
      console.error('Error unlinking reference:', err);
    }
  }, [projectName, fetchProjectReferences]);

  const deleteReference = useCallback(async (referenceId: string) => {
    try {
      const res = await api.references.delete(referenceId);
      if (!res.ok) throw new Error('Failed to delete reference');
      setReferences(prev => prev.filter(r => r.id !== referenceId));
      setProjectReferences(prev => prev.filter(r => r.id !== referenceId));
    } catch (err) {
      console.error('Error deleting reference:', err);
      throw err;
    }
  }, []);

  const bulkDeleteReferences = useCallback(async (referenceIds: string[]) => {
    if (referenceIds.length === 0) return;
    try {
      const res = await api.references.bulkDelete(referenceIds);
      if (!res.ok) throw new Error('Failed to delete references');
      const idSet = new Set(referenceIds);
      setReferences(prev => prev.filter(r => !idSet.has(r.id)));
      setProjectReferences(prev => prev.filter(r => !idSet.has(r.id)));
    } catch (err) {
      console.error('Error bulk-deleting references:', err);
      throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([
      fetchReferences(),
      fetchProjectReferences(),
      fetchTags(),
      checkZoteroStatus(),
    ]);
  }, [fetchReferences, fetchProjectReferences, fetchTags, checkZoteroStatus]);

  useEffect(() => {
    setProjectReferences([]);
    return () => { projectRequest.current++; };
  }, [projectName]);

  useEffect(() => {
    if (autoFetch) {
      void refresh();
    }
  }, [autoFetch, refresh]);

  return {
    references,
    projectReferences,
    projectError,
    tags,
    zoteroStatus,
    loading,
    error,
    fetchReferences,
    fetchProjectReferences,
    fetchTags,
    checkZoteroStatus,
    linkToProject,
    unlinkFromProject,
    deleteReference,
    bulkDeleteReferences,
    refresh,
  };
}
