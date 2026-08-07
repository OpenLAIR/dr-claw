// ResearchFlow top-level entry — Portfolio ⇄ Project workspace switching.
// Data loading lives here; child views are presentational.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import Portfolio from './Portfolio';
import ProjectWorkspace from './ProjectWorkspace';

export default function ResearchFlowApp() {
  const { t } = useTranslation('researchflow');
  const [projects, setProjects] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadProjects = useCallback(async () => {
    setError(null);
    try {
      const res = await api.rf.listProjects();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProjects((await res.json()).data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleCreate = async (name) => {
    try {
      const res = await api.rf.createProject({ name });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      setActiveProjectId(data.project.id);
      setCreating(false);
    } catch (createError) {
      setError(createError.message);
    }
  };

  if (activeProjectId) {
    return (
      <ProjectWorkspace
        projectId={activeProjectId}
        onBack={() => {
          setActiveProjectId(null);
          void loadProjects();
        }}
      />
    );
  }

  if (error && !projects) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{t('common.error')}</p>
          <p className="mt-1 text-xs text-red-500">{error}</p>
          <button type="button" onClick={() => void loadProjects()} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!projects) {
    return <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>;
  }

  return (
    <Portfolio
      projects={projects}
      onCreate={handleCreate}
      onOpenProject={setActiveProjectId}
      onRefresh={() => void loadProjects()}
      creating={creating}
      setCreating={setCreating}
      error={error}
    />
  );
}
