import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api';
import {
  applyLocalToggle,
  buildBulkChanges,
  buildToggleChange,
  type SkillBaseline,
  type SkillDefaultsResponse,
} from './skillDefaultsModel';

async function readJson(response: Response): Promise<SkillDefaultsResponse> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }
  return response.json();
}

/**
 * Enabled state of every bundled skill for the global defaults
 * (projectName null) or for one project.
 */
export function useSkillDefaults(projectName: string | null) {
  const [data, setData] = useState<SkillDefaultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(0);
  const scope = projectName ? 'project' : 'global';

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const next = await readJson(await api.getSkillDefaults(projectName));
      if (id === requestId.current) setData(next);
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (request: () => Promise<Response>, optimistic?: SkillDefaultsResponse) => {
    const id = ++requestId.current;
    const previous = data;
    if (optimistic) setData(optimistic);
    setSaving(true);
    setError(null);
    try {
      const next = await readJson(await request());
      if (id === requestId.current) setData(next);
      return true;
    } catch (err) {
      if (id === requestId.current) {
        setData(previous);
        setError(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      if (id === requestId.current) setSaving(false);
    }
  }, [data]);

  const toggleSkill = useCallback((name: string, nextEnabled: boolean) => {
    if (!data) return Promise.resolve(false);
    const state = data.skills.find((skill) => skill.name === name);
    if (!state) return Promise.resolve(false);
    const change = buildToggleChange(state, nextEnabled, scope);
    const optimistic = applyLocalToggle(data, name, nextEnabled, scope);
    return save(
      () => (projectName
        ? api.updateProjectSkillOverrides(projectName, { overrides: { [name]: change } })
        : api.updateSkillDefaults({ overrides: { [name]: change } })),
      optimistic,
    );
  }, [data, projectName, save, scope]);

  const setSkillsEnabled = useCallback((names: string[], nextEnabled: boolean) => {
    if (!data) return Promise.resolve(false);
    const wanted = new Set(names);
    const states = data.skills.filter((skill) => wanted.has(skill.name));
    const changes = buildBulkChanges(states, nextEnabled, scope);
    if (Object.keys(changes).length === 0) return Promise.resolve(true);
    const optimistic = Object.keys(changes).reduce(
      (current, name) => applyLocalToggle(current, name, nextEnabled, scope),
      data,
    );
    return save(
      () => (projectName
        ? api.updateProjectSkillOverrides(projectName, { overrides: changes })
        : api.updateSkillDefaults({ overrides: changes })),
      optimistic,
    );
  }, [data, projectName, save, scope]);

  // Choosing a preset gives exactly that preset: per-skill global changes are dropped.
  const setBaseline = useCallback(
    (baseline: SkillBaseline) => save(() => api.updateSkillDefaults({ baseline, resetOverrides: true })),
    [save],
  );

  const resetProject = useCallback(() => {
    if (!projectName) return Promise.resolve(false);
    return save(() => api.updateProjectSkillOverrides(projectName, { reset: true }));
  }, [projectName, save]);

  const acknowledgeNew = useCallback(() => {
    if (!data) return Promise.resolve(false);
    const optimistic = { ...data, newSkills: [], skills: data.skills.map((skill) => ({ ...skill, isNew: false })) };
    return save(async () => {
      const response = await api.updateSkillDefaults({ acknowledgeNew: true });
      // In project scope the PUT answers with the global view; reload this one.
      return projectName && response.ok ? api.getSkillDefaults(projectName) : response;
    }, optimistic);
  }, [data, projectName, save]);

  return { data, loading, saving, error, scope, reload: load, toggleSkill, setSkillsEnabled, setBaseline, resetProject, acknowledgeNew } as const;
}
