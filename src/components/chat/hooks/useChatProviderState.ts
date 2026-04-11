import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS, GEMINI_MODELS, LOCAL_MODELS, NANO_CLAUDE_CODE_MODELS, OPENROUTER_MODELS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode, Provider } from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<SessionProvider>(() => {
    return (localStorage.getItem('selected-provider') as SessionProvider) || 'claude';
  });
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return localStorage.getItem('cursor-model') || CURSOR_MODELS.DEFAULT;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return localStorage.getItem('claude-model') || CLAUDE_MODELS.DEFAULT;
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT;
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem('gemini-model') || GEMINI_MODELS.DEFAULT;
  });
  const [openrouterModel, setOpenrouterModel] = useState<string>(() => {
    return localStorage.getItem('openrouter-model') || OPENROUTER_MODELS.DEFAULT;
  });
  const [localModel, setLocalModel] = useState<string>(() => {
    return localStorage.getItem('local-model') || LOCAL_MODELS.DEFAULT;
  });
  const [nanoModel, setNanoModel] = useState<string>(() => {
    return (
      localStorage.getItem('nano-claude-code-model') ||
      NANO_CLAUDE_CODE_MODELS.DEFAULT
    );
  });

  const lastProviderRef = useRef(provider);

  const getProviderPermissionModes = useCallback((p: SessionProvider): PermissionMode[] => {
    return p === 'codex'
      ? ['default', 'acceptEdits', 'bypassPermissions']
      : ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
  }, []);

  const getProviderModeStorageKey = useCallback((p: SessionProvider) => `permissionMode-provider-${p}`, []);

  useEffect(() => {
    const validModes = getProviderPermissionModes(provider);
    const providerMode = localStorage.getItem(getProviderModeStorageKey(provider));
    const defaultMode: PermissionMode = validModes.includes((providerMode as PermissionMode))
      ? (providerMode as PermissionMode)
      : 'default';

    if (!selectedSession?.id) {
      setPermissionMode(defaultMode);
      return;
    }

    const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`);
    if (savedMode && validModes.includes(savedMode as PermissionMode)) {
      setPermissionMode(savedMode as PermissionMode);
    } else {
      setPermissionMode(defaultMode);
    }
  }, [selectedSession?.id, provider, getProviderPermissionModes, getProviderModeStorageKey]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    setProvider(selectedSession.__provider);
    localStorage.setItem('selected-provider', selectedSession.__provider);
  }, [provider, selectedSession]);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  useEffect(() => {
    if (provider !== 'cursor') {
      return;
    }

    authenticatedFetch('/api/cursor/config')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success || !data.config?.model?.modelId) {
          return;
        }

        const modelId = data.config.model.modelId as string;
        if (!localStorage.getItem('cursor-model')) {
          setCursorModel(modelId);
        }
      })
      .catch((error) => {
        console.error('Error loading Cursor config:', error);
      });
  }, [provider]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getProviderPermissionModes(provider);

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);
    localStorage.setItem(getProviderModeStorageKey(provider), nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id, getProviderPermissionModes, getProviderModeStorageKey]);

  return {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    openrouterModel,
    setOpenrouterModel,
    localModel,
    setLocalModel,
    nanoModel,
    setNanoModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
