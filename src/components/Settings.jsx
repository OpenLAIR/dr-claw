import { useState, useEffect, useRef, useId } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { X, Plus, Settings as SettingsIcon, Shield, AlertTriangle, Moon, Sun, Server, Edit3, Trash2, Globe, Terminal, Zap, FolderOpen, LogIn, Key, GitBranch, Check, Mail, Brain } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import CredentialsSettings from './CredentialsSettings';
import GitSettings from './GitSettings';
import LoginModal from './LoginModal';
import { authenticatedFetch, api } from '../utils/api';
import { isTelemetryEnabled, setTelemetryEnabled } from '../utils/telemetry';
import { writeCliAvailability } from '../utils/cliAvailability';

// New settings components
import AgentListItem from './settings/AgentListItem';
import AccountContent from './settings/AccountContent';
import EmailSettingsContent from './settings/EmailSettingsContent';
import PermissionsContent from './settings/PermissionsContent';
import McpServersContent from './settings/McpServersContent';
import McpServerForm, { withMcpTextDrafts, parseMcpTextDrafts } from './settings/McpServerForm';
import { settingsRequest, useSettingsRequest } from './settings/useSettingsRequest';
import MemoryContent from './settings/MemoryContent';
import AppearanceContent from './settings/AppearanceContent';
import { SettingsDraftProvider, useSettingsDraft, useSettingsNavigation } from './settings/SettingsDraftGuard';

const VALID_SETTINGS_TABS = new Set(['agents', 'email', 'appearance', 'git', 'api']);

function readStoredSettings(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function readSavedPermissions() {
  const claude = readStoredSettings('claude-settings') || {};
  const cursor = readStoredSettings('cursor-tools-settings') || {};
  const codex = readStoredSettings('codex-settings') || {};
  const gemini = readStoredSettings('gemini-settings') || {};
  return { allowedTools: claude.allowedTools || [], disallowedTools: claude.disallowedTools || [], skipPermissions: claude.skipPermissions || false, cursorAllowedCommands: cursor.allowedCommands || [], cursorDisallowedCommands: cursor.disallowedCommands || [], cursorSkipPermissions: cursor.skipPermissions || false, codexPermissionMode: codex.permissionMode || 'default', geminiPermissionMode: gemini.permissionMode || 'default', geminiAllowedTools: gemini.allowedTools || [], geminiDisallowedTools: gemini.disallowedTools || [] };
}

function SettingsContent({ isOpen, onClose, projects = [], initialTab = 'agents' }) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { t, i18n } = useTranslation('settings');
  const requestNavigation = useSettingsNavigation();
  const requestClose = () => requestNavigation(onClose);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const dialogRef = useRef(null);
  const dialogTitleId = useId();
  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus(); };
  }, [isOpen]);
  const [allowedTools, setAllowedTools] = useState([]);
  const [disallowedTools, setDisallowedTools] = useState([]);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');
  const [geminiAllowedTools, setGeminiAllowedTools] = useState([]);
  const [geminiDisallowedTools, setGeminiDisallowedTools] = useState([]);
  const [newGeminiAllowedTool, setNewGeminiAllowedTool] = useState('');
  const [newGeminiDisallowedTool, setNewGeminiDisallowedTool] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const savedSnapshot = useRef(null);
  const [projectSortOrder, setProjectSortOrder] = useState('date');

  const [mcpServers, setMcpServers] = useState([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState(null);
  const [mcpFormData, setMcpFormData] = useState({
    name: '',
    type: 'stdio',
    scope: 'user',
    projectPath: '', // For local scope
    config: {
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {},
      timeout: 30000
    },
    jsonInput: '', // For JSON import
    importMode: 'form' // 'form' or 'json'
  });
  const [mcpError, setMcpError] = useState('');
  const [codexMcpError, setCodexMcpError] = useState('');
  const mcpWriteLock = useRef(false);
  const codexMcpWriteLock = useRef(false);
  const { states: mcpReads, run: runMcpRead } = useSettingsRequest();
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpTestResults, setMcpTestResults] = useState({});
  const [mcpServerTools, setMcpServerTools] = useState({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState({});
  const [activeTab, setActiveTab] = useState(
    VALID_SETTINGS_TABS.has(initialTab) ? initialTab : 'agents',
  );
  const [jsonValidationError, setJsonValidationError] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('claude'); // 'claude', 'cursor', or 'codex'
  const [selectedCategory, setSelectedCategory] = useState('account'); // 'account', 'email', 'permissions', 'mcp', or 'memory'
  const hasIndependentSave = activeTab !== 'appearance' && !(activeTab === 'agents' && selectedCategory === 'permissions');

  // Code Editor settings
  const [codeEditorTheme, setCodeEditorTheme] = useState(() =>
    localStorage.getItem('codeEditorTheme') || 'dark'
  );
  const [codeEditorWordWrap, setCodeEditorWordWrap] = useState(() =>
    localStorage.getItem('codeEditorWordWrap') === 'true'
  );
  const [codeEditorShowMinimap, setCodeEditorShowMinimap] = useState(() =>
    localStorage.getItem('codeEditorShowMinimap') !== 'false' // Default true
  );
  const [codeEditorLineNumbers, setCodeEditorLineNumbers] = useState(() =>
    localStorage.getItem('codeEditorLineNumbers') !== 'false' // Default true
  );
  const [codeEditorFontSize, setCodeEditorFontSize] = useState(() =>
    localStorage.getItem('codeEditorFontSize') || '14'
  );
  const [telemetryEnabled, setTelemetryEnabledState] = useState(() => isTelemetryEnabled());

  const [mcpDraftBaseline, setMcpDraftBaseline] = useState(null);
  const [codexMcpDraftBaseline, setCodexMcpDraftBaseline] = useState(null);
  
  // Cursor-specific states
  const [cursorAllowedCommands, setCursorAllowedCommands] = useState([]);
  const [cursorDisallowedCommands, setCursorDisallowedCommands] = useState([]);
  const [cursorSkipPermissions, setCursorSkipPermissions] = useState(false);
  const [newCursorCommand, setNewCursorCommand] = useState('');
  const [newCursorDisallowedCommand, setNewCursorDisallowedCommand] = useState('');
  const [cursorMcpServers, setCursorMcpServers] = useState([]);

  // Codex-specific states
  const [codexMcpServers, setCodexMcpServers] = useState([]);
  const [codexPermissionMode, setCodexPermissionMode] = useState('default');
  const [showCodexMcpForm, setShowCodexMcpForm] = useState(false);

  // Gemini-specific states
  const [geminiPermissionMode, setGeminiPermissionMode] = useState('default');
  const [codexMcpFormData, setCodexMcpFormData] = useState({
    name: '',
    type: 'stdio',
    config: {
      command: '',
      args: [],
      env: {}
    }
  });
  const [editingCodexMcpServer, setEditingCodexMcpServer] = useState(null);
  const [codexMcpLoading, setCodexMcpLoading] = useState(false);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);

  const [claudeAuthStatus, setClaudeAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'claude',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    docsUrl: null,
    downloadUrl: null
  });
  const [cursorAuthStatus, setCursorAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'agent',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    docsUrl: null,
    downloadUrl: null
  });
  const [codexAuthStatus, setCodexAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'codex',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    docsUrl: null,
    downloadUrl: null
  });
  const [geminiAuthStatus, setGeminiAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'gemini',
    installHint: null,
    loading: true,
    error: null,
    installable: false,
    docsUrl: null,
    downloadUrl: null
  });
  const [openrouterAuthStatus, setOpenrouterAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'openrouter',
    installHint: null,
    loading: true,
    error: null
  });
  const [localAuthStatus, setLocalAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: null,
    installHint: null,
    loading: true,
    error: null
  });

  const buildDefaultAuthState = (overrides = {}) => ({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: null,
    installHint: null,
    loading: false,
    error: null,
    installable: false,
    docsUrl: null,
    downloadUrl: null,
    ...overrides
  });

  // Common tool patterns for Claude
  const commonTools = [
    'Bash(git log:*)',
    'Bash(git diff:*)',
    'Bash(git status:*)',
    'Write',
    'Read',
    'Edit',
    'Glob',
    'Grep',
    'MultiEdit',
    'Task',
    'TodoWrite',
    'TodoRead',
    'WebFetch',
    'WebSearch'
  ];
  
  // Common shell commands for Cursor
  const commonCursorCommands = [
    'Shell(ls)',
    'Shell(mkdir)',
    'Shell(cd)',
    'Shell(cat)',
    'Shell(echo)',
    'Shell(git status)',
    'Shell(git diff)',
    'Shell(git log)',
    'Shell(npm install)',
    'Shell(npm run)',
    'Shell(python)',
    'Shell(node)'
  ];

  const fetchMcpList = (agent, url, apply) => runMcpRead(agent, async () => {
    const data = await settingsRequest(url);
    if (!Array.isArray(data.servers)) throw new Error('Invalid MCP server list.');
    return data.servers;
  }, apply);
  const fetchCursorMcpServers = () => fetchMcpList('cursor', '/api/cursor/mcp', setCursorMcpServers);
  const fetchCodexMcpServers = () => fetchMcpList('codex', '/api/codex/mcp/config/read', setCodexMcpServers);
  const fetchMcpServers = () => fetchMcpList('claude', '/api/mcp/config/read', setMcpServers);

  const saveMcpServer = async (serverData) => {
    if (editingMcpServer) {
      await settingsRequest('/api/mcp/config/server', { method: 'PUT', body: JSON.stringify({
        originalName: editingMcpServer.name, expected: editingMcpServer.raw,
        name: serverData.name, scope: editingMcpServer.scope, projectPath: editingMcpServer.projectPath,
        type: serverData.type, config: serverData.config
      }) });
    } else {
      await settingsRequest('/api/mcp/cli/add', { method: 'POST', body: JSON.stringify({
        name: serverData.name, type: serverData.type, scope: serverData.scope, projectPath: serverData.projectPath,
        ...serverData.config
      }) });
    }
    await fetchMcpServers();
  };

  const deleteMcpServer = async (serverId, scope = 'user') => {
    try {
      // Use Claude CLI to remove the server with proper scope
      const response = await authenticatedFetch(`/api/mcp/cli/remove/${encodeURIComponent(serverId)}?scope=${encodeURIComponent(scope)}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to delete server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      throw error;
    }
  };

  const testMcpServer = async (serverId, scope = 'user') => {
    try {
      const response = await authenticatedFetch(`/api/mcp/servers/${serverId}/test?scope=${scope}`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        return data.testResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to test server');
      }
    } catch (error) {
      console.error('Error testing MCP server:', error);
      throw error;
    }
  };


  const discoverMcpTools = async (serverId, scope = 'user') => {
    try {
      const response = await authenticatedFetch(`/api/mcp/servers/${serverId}/tools?scope=${scope}`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        return data.toolsResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to discover tools');
      }
    } catch (error) {
      console.error('Error discovering MCP tools:', error);
      throw error;
    }
  };

  const saveCodexMcpServer = async (serverData) => {
    await settingsRequest(editingCodexMcpServer ? '/api/codex/mcp/config/server' : '/api/codex/mcp/cli/add', {
      method: editingCodexMcpServer ? 'PUT' : 'POST',
      body: JSON.stringify(editingCodexMcpServer ? {
        originalName: editingCodexMcpServer.name, expected: editingCodexMcpServer.raw,
        name: serverData.name, type: 'stdio', config: serverData.config
      } : { name: serverData.name, ...serverData.config })
    });
    await fetchCodexMcpServers();
  };

  const deleteCodexMcpServer = async (serverId) => {
    try {
      const response = await authenticatedFetch(`/api/codex/mcp/cli/remove/${encodeURIComponent(serverId)}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchCodexMcpServers();
          return true;
        } else {
          throw new Error(result.error || 'Failed to delete Codex MCP server');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting Codex MCP server:', error);
      throw error;
    }
  };

  const resetCodexMcpForm = () => {
    const nextForm = {
      name: '',
      type: 'stdio',
      config: {
        command: '',
        args: [],
        env: {}
      }
    };
    setCodexMcpFormData(withMcpTextDrafts(nextForm));
    setCodexMcpDraftBaseline(JSON.stringify(withMcpTextDrafts(nextForm)));
    setEditingCodexMcpServer(null);
    setShowCodexMcpForm(false);
  };

  const openCodexMcpForm = (server = null) => {
    setCodexMcpError('');
    if (server) {
      setEditingCodexMcpServer(server);
      const nextForm = {
        name: server.name,
        type: server.type || 'stdio',
        config: {
          command: server.config?.command || '',
          args: server.config?.args || [],
          env: server.config?.env || {}
        }
      };
      setCodexMcpFormData(withMcpTextDrafts(nextForm));
      setCodexMcpDraftBaseline(JSON.stringify(withMcpTextDrafts(nextForm)));
    } else {
      resetCodexMcpForm();
    }
    setShowCodexMcpForm(true);
  };

  const handleCodexMcpSubmit = async (e) => {
    e.preventDefault();
    if (codexMcpWriteLock.current) return;
    codexMcpWriteLock.current = true;
    setCodexMcpLoading(true); setCodexMcpError('');
    try {
      await saveCodexMcpServer(parseMcpTextDrafts(codexMcpFormData));
      resetCodexMcpForm();
    } catch (error) { setCodexMcpError(error.message); }
    finally { codexMcpWriteLock.current = false; setCodexMcpLoading(false); }
  };

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      checkClaudeAuthStatus();
      checkCursorAuthStatus();
      checkCodexAuthStatus();
      checkGeminiAuthStatus();
      checkOpenRouterAuthStatus();
      checkLocalAuthStatus();
      setActiveTab(VALID_SETTINGS_TABS.has(initialTab) ? initialTab : 'agents');
    }
  }, [isOpen, initialTab]);

  // Persist code editor settings to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorTheme', codeEditorTheme);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorTheme]);

  useEffect(() => {
    localStorage.setItem('codeEditorWordWrap', codeEditorWordWrap.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorWordWrap]);

  useEffect(() => {
    localStorage.setItem('codeEditorShowMinimap', codeEditorShowMinimap.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorShowMinimap]);

  useEffect(() => {
    localStorage.setItem('codeEditorLineNumbers', codeEditorLineNumbers.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorLineNumbers]);

  useEffect(() => {
    localStorage.setItem('codeEditorFontSize', codeEditorFontSize);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorFontSize]);

  useEffect(() => {
    setTelemetryEnabled(telemetryEnabled);
  }, [telemetryEnabled]);

  const loadSettings = async () => {
    try {
      
      // Load Claude settings from localStorage
      const savedSettings = localStorage.getItem('claude-settings');
      
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        setAllowedTools(settings.allowedTools || []);
        setDisallowedTools(settings.disallowedTools || []);
        setSkipPermissions(settings.skipPermissions || false);
        setProjectSortOrder(settings.projectSortOrder || 'date');
      } else {
        // Set defaults
        setAllowedTools([]);
        setDisallowedTools([]);
        setSkipPermissions(false);
        setProjectSortOrder('name');
      }
      
      // Load Cursor settings from localStorage
      const savedCursorSettings = localStorage.getItem('cursor-tools-settings');

      if (savedCursorSettings) {
        const cursorSettings = JSON.parse(savedCursorSettings);
        setCursorAllowedCommands(cursorSettings.allowedCommands || []);
        setCursorDisallowedCommands(cursorSettings.disallowedCommands || []);
        setCursorSkipPermissions(cursorSettings.skipPermissions || false);
      } else {
        // Set Cursor defaults
        setCursorAllowedCommands([]);
        setCursorDisallowedCommands([]);
        setCursorSkipPermissions(false);
      }

      // Load Codex settings from localStorage
      const savedCodexSettings = localStorage.getItem('codex-settings');

      if (savedCodexSettings) {
        const codexSettings = JSON.parse(savedCodexSettings);
        setCodexPermissionMode(codexSettings.permissionMode || 'default');
      } else {
        setCodexPermissionMode('default');
      }

      // Load Gemini settings from localStorage
      const savedGeminiSettings = localStorage.getItem('gemini-settings');

      if (savedGeminiSettings) {
        const geminiSettings = JSON.parse(savedGeminiSettings);
        setGeminiPermissionMode(geminiSettings.permissionMode || 'default');
        setGeminiAllowedTools(geminiSettings.allowedTools || []);
        setGeminiDisallowedTools(geminiSettings.disallowedTools || []);
      } else {
        setGeminiPermissionMode('default');
        setGeminiAllowedTools([]);
        setGeminiDisallowedTools([]);
      }

      setSettingsLoaded(true);

      // Load MCP servers from API
      await fetchMcpServers();

      // Load Cursor MCP servers
      await fetchCursorMcpServers();

      // Load Codex MCP servers
      await fetchCodexMcpServers();
    } catch (error) {
      console.error('Error loading tool settings:', error);
      setAllowedTools([]);
      setDisallowedTools([]);
      setSkipPermissions(false);
      setProjectSortOrder('name');
    }
  };

  const checkClaudeAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/claude/status');

      if (response.ok) {
        const data = await response.json();
        setClaudeAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'claude',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null,
          installable: data.installable === true,
          docsUrl: data.docsUrl || null,
          downloadUrl: data.downloadUrl || null
        });
        writeCliAvailability('claude', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'claude',
          installHint: data.installHint || null,
        });
      } else {
        setClaudeAuthStatus(buildDefaultAuthState({
          cliCommand: 'claude',
          error: 'Failed to check authentication status'
        }));
      }
    } catch (error) {
      console.error('Error checking Claude auth status:', error);
      setClaudeAuthStatus(buildDefaultAuthState({
        cliCommand: 'claude',
        error: error.message
      }));
    }
  };

  const checkCursorAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/cursor/status');

      if (response.ok) {
        const data = await response.json();
        setCursorAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'agent',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null,
          installable: data.installable === true,
          docsUrl: data.docsUrl || null,
          downloadUrl: data.downloadUrl || null
        });
        writeCliAvailability('cursor', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'agent',
          installHint: data.installHint || null,
        });
      } else {
        setCursorAuthStatus(buildDefaultAuthState({
          cliCommand: 'agent',
          error: 'Failed to check authentication status'
        }));
      }
    } catch (error) {
      console.error('Error checking Cursor auth status:', error);
      setCursorAuthStatus(buildDefaultAuthState({
        cliCommand: 'agent',
        error: error.message
      }));
    }
  };

  const checkCodexAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/codex/status');

      if (response.ok) {
        const data = await response.json();
        setCodexAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'codex',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null,
          installable: data.installable === true,
          docsUrl: data.docsUrl || null,
          downloadUrl: data.downloadUrl || null
        });
        writeCliAvailability('codex', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'codex',
          installHint: data.installHint || null,
        });
      } else {
        setCodexAuthStatus(buildDefaultAuthState({
          cliCommand: 'codex',
          error: 'Failed to check authentication status'
        }));
      }
    } catch (error) {
      console.error('Error checking Codex auth status:', error);
      setCodexAuthStatus(buildDefaultAuthState({
        cliCommand: 'codex',
        error: error.message
      }));
    }
  };

  const checkGeminiAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/gemini/status');

      if (response.ok) {
        const data = await response.json();
        setGeminiAuthStatus({
          authenticated: data.authenticated,
          hasOAuth: data.hasOAuth, hasApiKey: data.hasApiKey, method: data.method,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'gemini',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null,
          installable: data.installable === true,
          docsUrl: data.docsUrl || null,
          downloadUrl: data.downloadUrl || null
        });
        writeCliAvailability('gemini', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'gemini',
          installHint: data.installHint || null,
        });
      } else {
        setGeminiAuthStatus(buildDefaultAuthState({
          cliCommand: 'gemini',
          error: 'Failed to check authentication status'
        }));
      }
    } catch (error) {
      console.error('Error checking Gemini auth status:', error);
      setGeminiAuthStatus(buildDefaultAuthState({
        cliCommand: 'gemini',
        error: error.message
      }));
    }
  };

  const checkOpenRouterAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/openrouter/status');

      if (response.ok) {
        const data = await response.json();
        setOpenrouterAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'openrouter',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
        writeCliAvailability('openrouter', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'openrouter',
          installHint: data.installHint || null,
        });
      } else {
        setOpenrouterAuthStatus(buildDefaultAuthState({
          cliCommand: 'openrouter',
          error: 'Failed to check authentication status'
        }));
      }
    } catch (error) {
      console.error('Error checking OpenRouter auth status:', error);
      setOpenrouterAuthStatus(buildDefaultAuthState({
        cliCommand: 'openrouter',
        error: error.message
      }));
    }
  };

  const refreshProviderStatus = async (provider) => {
    if (provider === 'claude') {
      await checkClaudeAuthStatus();
      return;
    }

    if (provider === 'cursor') {
      await checkCursorAuthStatus();
      return;
    }

    if (provider === 'codex') {
      await checkCodexAuthStatus();
      return;
    }

    if (provider === 'gemini') {
      await checkGeminiAuthStatus();
    }
  };

  const checkLocalAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/local/status');

      if (response.ok) {
        const data = await response.json();
        setLocalAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: true,
          cliCommand: null,
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
        writeCliAvailability('local', {
          cliAvailable: true,
          cliCommand: null,
          installHint: data.installHint || null,
        });
      } else {
        setLocalAuthStatus({
          authenticated: false,
          email: null,
          cliAvailable: true,
          cliCommand: null,
          installHint: 'Install Ollama from https://ollama.com',
          loading: false,
          error: 'Could not check Ollama status'
        });
      }
    } catch (error) {
      console.error('Error checking Local GPU auth status:', error);
      setLocalAuthStatus({
        authenticated: false,
        email: null,
        cliAvailable: true,
        cliCommand: null,
        installHint: 'Install Ollama from https://ollama.com',
        loading: false,
        error: error.message
      });
    }
  };

  const getDefaultProject = () => projects?.[0] || { name: 'default', fullPath: '' };

  const handleClaudeLogin = () => {
    setLoginProvider('claude');
    setSelectedProject(getDefaultProject());
    setShowLoginModal(true);
  };

  const handleCursorLogin = () => {
    setLoginProvider('cursor');
    setSelectedProject(getDefaultProject());
    setShowLoginModal(true);
  };

  const handleCodexLogin = () => {
    setLoginProvider('codex');
    setSelectedProject(getDefaultProject());
    setShowLoginModal(true);
  };

  const handleGeminiLogin = () => {
    setLoginProvider('gemini');
    setSelectedProject(getDefaultProject());
    setShowLoginModal(true);
  };

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      setSaveStatus('success');

      if (loginProvider === 'claude') {
        checkClaudeAuthStatus();
      } else if (loginProvider === 'cursor') {
        checkCursorAuthStatus();
      } else if (loginProvider === 'codex') {
        checkCodexAuthStatus();
      } else if (loginProvider === 'gemini') {
        checkGeminiAuthStatus();
      }
    }
  };

  const saveSettings = () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      // Save Claude settings
      const claudeSettings = {
        allowedTools,
        disallowedTools,
        skipPermissions,
        projectSortOrder,
        lastUpdated: new Date().toISOString()
      };
      
      // Save Cursor settings
      const cursorSettings = {
        allowedCommands: cursorAllowedCommands,
        disallowedCommands: cursorDisallowedCommands,
        skipPermissions: cursorSkipPermissions,
        lastUpdated: new Date().toISOString()
      };

      // Save Codex settings
      const codexSettings = {
        permissionMode: codexPermissionMode,
        lastUpdated: new Date().toISOString()
      };

      // Save Gemini settings
      const geminiSettings = {
        permissionMode: geminiPermissionMode,
        allowedTools: geminiAllowedTools,
        disallowedTools: geminiDisallowedTools,
        lastUpdated: new Date().toISOString()
      };

      // Save to localStorage
      localStorage.setItem('claude-settings', JSON.stringify(claudeSettings));
      localStorage.setItem('cursor-tools-settings', JSON.stringify(cursorSettings));
      localStorage.setItem('codex-settings', JSON.stringify(codexSettings));
      localStorage.setItem('gemini-settings', JSON.stringify(geminiSettings));

      savedSnapshot.current = editableSnapshot;
      setSaveStatus('success');
    } catch (error) {
      console.error('Error saving tool settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const addAllowedTool = (tool) => {
    if (tool && !allowedTools.includes(tool)) {
      setAllowedTools([...allowedTools, tool]);
      setNewAllowedTool('');
    }
  };

  const removeAllowedTool = (tool) => {
    setAllowedTools(allowedTools.filter(t => t !== tool));
  };

  const addDisallowedTool = (tool) => {
    if (tool && !disallowedTools.includes(tool)) {
      setDisallowedTools([...disallowedTools, tool]);
      setNewDisallowedTool('');
    }
  };

  const removeDisallowedTool = (tool) => {
    setDisallowedTools(disallowedTools.filter(t => t !== tool));
  };

  // MCP form handling functions
  const resetMcpForm = () => {
    const nextForm = {
      name: '',
      type: 'stdio',
      scope: 'user', // Default to user scope
      projectPath: '',
      config: {
        command: '',
        args: [],
        env: {},
        url: '',
        headers: {},
        timeout: 30000
      },
      jsonInput: '',
      importMode: 'form'
    };
    setMcpFormData(withMcpTextDrafts(nextForm));
    setMcpDraftBaseline(JSON.stringify(withMcpTextDrafts(nextForm)));
    setEditingMcpServer(null);
    setShowMcpForm(false);
    setJsonValidationError('');
  };

  const openMcpForm = (server = null) => {
    setMcpError('');
    if (server) {
      setEditingMcpServer(server);
      const nextForm = {
        name: server.name,
        type: server.type,
        scope: server.scope,
        projectPath: server.projectPath || '',
        config: { ...server.config },
        raw: server.raw, // Store raw config for display
        importMode: 'form', // Always use form mode when editing
        jsonInput: ''
      };
      setMcpFormData(withMcpTextDrafts(nextForm));
      setMcpDraftBaseline(JSON.stringify(withMcpTextDrafts(nextForm)));
    } else {
      resetMcpForm();
    }
    setShowMcpForm(true);
  };

  const handleMcpSubmit = async (e) => {
    e.preventDefault();
    if (mcpWriteLock.current) return;
    mcpWriteLock.current = true;
    setMcpLoading(true); setMcpError('');
    try {
      if (mcpFormData.importMode === 'json') {
        JSON.parse(mcpFormData.jsonInput);
        await settingsRequest('/api/mcp/cli/add-json', { method: 'POST', body: JSON.stringify({
          name: mcpFormData.name, jsonConfig: mcpFormData.jsonInput, scope: mcpFormData.scope, projectPath: mcpFormData.projectPath
        }) });
        await fetchMcpServers();
      } else await saveMcpServer(parseMcpTextDrafts(mcpFormData));
      resetMcpForm();
    } catch (error) { setMcpError(error.message); }
    finally { mcpWriteLock.current = false; setMcpLoading(false); }
  };

  const handleMcpTest = async (serverId, scope) => {
    try {
      setMcpTestResults({ ...mcpTestResults, [serverId]: { loading: true } });
      const result = await testMcpServer(serverId, scope);
      setMcpTestResults({ ...mcpTestResults, [serverId]: result });
    } catch (error) {
      setMcpTestResults({ 
        ...mcpTestResults, 
        [serverId]: { 
          success: false, 
          message: error.message,
          details: []
        } 
      });
    }
  };

  const handleMcpToolsDiscovery = async (serverId, scope) => {
    try {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: true });
      const result = await discoverMcpTools(serverId, scope);
      setMcpServerTools({ ...mcpServerTools, [serverId]: result });
    } catch (error) {
      setMcpServerTools({ 
        ...mcpServerTools, 
        [serverId]: { 
          success: false, 
          tools: [], 
          resources: [], 
          prompts: [] 
        } 
      });
    } finally {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: false });
    }
  };

  const updateMcpConfig = (key, value) => {
    setMcpFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value
      }
    }));
  };


  const getTransportIcon = (type) => {
    switch (type) {
      case 'stdio': return <Terminal className="w-4 h-4" />;
      case 'sse': return <Zap className="w-4 h-4" />;
      case 'http': return <Globe className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  };

  const savedPermissions = readSavedPermissions();
  const permissions = { allowedTools, disallowedTools, skipPermissions, cursorAllowedCommands, cursorDisallowedCommands, cursorSkipPermissions, codexPermissionMode, geminiPermissionMode, geminiAllowedTools, geminiDisallowedTools };
  const pendingToolInput = Boolean(newAllowedTool || newDisallowedTool || newCursorCommand || newCursorDisallowedCommand || newGeminiAllowedTool || newGeminiDisallowedTool);
  useSettingsDraft(isOpen && settingsLoaded && activeTab === 'agents' && selectedCategory === 'permissions' && (pendingToolInput || JSON.stringify(permissions) !== JSON.stringify(savedPermissions)), { discard: () => {
    setAllowedTools(savedPermissions.allowedTools); setDisallowedTools(savedPermissions.disallowedTools); setSkipPermissions(savedPermissions.skipPermissions);
    setCursorAllowedCommands(savedPermissions.cursorAllowedCommands); setCursorDisallowedCommands(savedPermissions.cursorDisallowedCommands); setCursorSkipPermissions(savedPermissions.cursorSkipPermissions);
    setCodexPermissionMode(savedPermissions.codexPermissionMode); setGeminiPermissionMode(savedPermissions.geminiPermissionMode); setGeminiAllowedTools(savedPermissions.geminiAllowedTools); setGeminiDisallowedTools(savedPermissions.geminiDisallowedTools);
    setNewAllowedTool(''); setNewDisallowedTool(''); setNewCursorCommand(''); setNewCursorDisallowedCommand(''); setNewGeminiAllowedTool(''); setNewGeminiDisallowedTool('');
  } });
  const savedClaude = readStoredSettings('claude-settings');
  const savedSortOrder = savedClaude ? savedClaude.projectSortOrder || 'date' : 'name';
  const editableSnapshot = JSON.stringify({ language: i18n.resolvedLanguage, permissions, projectSortOrder, newAllowedTool, newDisallowedTool, newCursorCommand, newCursorDisallowedCommand, newGeminiAllowedTool, newGeminiDisallowedTool, isDarkMode, telemetryEnabled, codeEditorTheme, codeEditorWordWrap, codeEditorShowMinimap, codeEditorLineNumbers, codeEditorFontSize });
  useEffect(() => { if (saveStatus === 'success' && savedSnapshot.current !== editableSnapshot) setSaveStatus(null); }, [editableSnapshot, saveStatus]);
  useEffect(() => { setSaveStatus(null); }, [activeTab, selectedAgent, selectedCategory]);
  useSettingsDraft(isOpen && activeTab === 'appearance' && settingsLoaded && projectSortOrder !== savedSortOrder, { discard: () => setProjectSortOrder(savedSortOrder) });
  useSettingsDraft(isOpen && showMcpForm && mcpDraftBaseline !== null && JSON.stringify(mcpFormData) !== mcpDraftBaseline, { busy: isOpen && mcpLoading, discard: resetMcpForm });
  useSettingsDraft(isOpen && showCodexMcpForm && codexMcpDraftBaseline !== null && JSON.stringify(codexMcpFormData) !== codexMcpDraftBaseline, { busy: isOpen && codexMcpLoading, discard: resetCodexMcpForm });

  if (!isOpen) return null;

  return (
    <dialog ref={dialogRef} aria-labelledby={dialogTitleId} onCancel={event => { event.preventDefault(); requestNavigation(showMcpForm ? resetMcpForm : showCodexMcpForm ? resetCodexMcpForm : onClose); }} className="workbench-wizard m-0 h-dvh w-screen max-h-none max-w-none border-0 bg-transparent p-0 text-foreground open:flex items-center justify-center md:p-4">
      <div className="bg-background border border-border md:rounded-lg shadow-xl w-full md:max-w-4xl h-full md:h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-5 h-5 md:w-6 md:h-6 text-muted-foreground" />
            <h2 id={dialogTitleId} className="text-lg md:text-xl font-semibold text-foreground">
              {t('title')}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={requestClose}
            aria-label={t('common:buttons.close')}
            className="text-muted-foreground hover:text-foreground touch-manipulation"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Tab Navigation */}
          <div className="border-b border-border">
            <div role="tablist" aria-label={t('title')} className="flex max-w-full overflow-x-auto px-4 md:px-6" onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
              const index = tabs.indexOf(document.activeElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
            }}>
              <button
                role="tab" aria-selected={activeTab === 'agents'}
                onClick={() => { if (activeTab !== 'agents') requestNavigation(() => setActiveTab('agents')); }}
                className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'agents'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('mainTabs.agents')}
              </button>
              <button
                role="tab" aria-selected={activeTab === 'email'}
                onClick={() => { if (activeTab !== 'email') requestNavigation(() => setActiveTab('email')); }}
                className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'email'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Mail className="w-4 h-4 inline mr-2" />
                {t('mainTabs.email')}
              </button>
              <button
                role="tab" aria-selected={activeTab === 'appearance'}
                onClick={() => { if (activeTab !== 'appearance') requestNavigation(() => setActiveTab('appearance')); }}
                className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'appearance'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('mainTabs.appearance')}
              </button>
              <button
                role="tab" aria-selected={activeTab === 'git'}
                onClick={() => { if (activeTab !== 'git') requestNavigation(() => setActiveTab('git')); }}
                className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'git'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <GitBranch className="w-4 h-4 inline mr-2" />
                {t('mainTabs.git')}
              </button>
              <button
                role="tab" aria-selected={activeTab === 'api'}
                onClick={() => { if (activeTab !== 'api') requestNavigation(() => setActiveTab('api')); }}
                className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'api'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Key className="w-4 h-4 inline mr-2" />
                {t('mainTabs.apiTokens')}
              </button>
            </div>
          </div>

          <div className="p-4 md:p-6 space-y-6 md:space-y-8 pb-safe-area-inset-bottom">
            
            {activeTab === 'appearance' && <AppearanceContent values={{ dark: isDarkMode, telemetry: telemetryEnabled, sort: projectSortOrder, editorDark: codeEditorTheme === 'dark', wordWrap: codeEditorWordWrap, showMinimap: codeEditorShowMinimap, lineNumbers: codeEditorLineNumbers, fontSize: codeEditorFontSize }} actions={{ dark: toggleDarkMode, telemetry: setTelemetryEnabledState, sort: setProjectSortOrder, editorDark: value => setCodeEditorTheme(value ? 'dark' : 'light'), wordWrap: setCodeEditorWordWrap, showMinimap: setCodeEditorShowMinimap, lineNumbers: setCodeEditorLineNumbers, fontSize: setCodeEditorFontSize }} />}

            {activeTab === 'email' && <EmailSettingsContent />}
            {activeTab === 'git' && <GitSettings />}

            {/* Agents Tab */}
            {activeTab === 'agents' && (
              <div className="flex flex-col md:flex-row h-full min-h-[400px] md:min-h-[500px]">
                {/* Mobile: Horizontal Agent Tabs */}
                <div className="md:hidden border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <div className="flex">
                    <AgentListItem
                      agentId="claude"
                      authStatus={claudeAuthStatus}
                      isSelected={selectedAgent === 'claude'}
                      onClick={() => { if (selectedAgent !== 'claude') requestNavigation(() => setSelectedAgent('claude')); }}
                      isMobile={true}
                    />
                    <AgentListItem
                      agentId="codex"
                      authStatus={codexAuthStatus}
                      isSelected={selectedAgent === 'codex'}
                      onClick={() => { if (selectedAgent !== 'codex') requestNavigation(() => setSelectedAgent('codex')); }}
                      isMobile={true}
                    />
                    <AgentListItem
                      agentId="gemini"
                      authStatus={geminiAuthStatus}
                      isSelected={selectedAgent === 'gemini'}
                      onClick={() => { if (selectedAgent !== 'gemini') requestNavigation(() => setSelectedAgent('gemini')); }}
                      isMobile={true}
                    />
                    <AgentListItem
                      agentId="openrouter"
                      authStatus={openrouterAuthStatus}
                      isSelected={selectedAgent === 'openrouter'}
                      onClick={() => { if (selectedAgent !== 'openrouter') requestNavigation(() => setSelectedAgent('openrouter')); }}
                      isMobile={true}
                    />
                    <AgentListItem
                      agentId="local"
                      authStatus={localAuthStatus}
                      isSelected={selectedAgent === 'local'}
                      onClick={() => { if (selectedAgent !== 'local') requestNavigation(() => setSelectedAgent('local')); }}
                      isMobile={true}
                    />
                  </div>
                </div>

                {/* Desktop: Sidebar - Agent List */}
                <div className="hidden md:block w-48 border-r border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <div className="p-2">
                    <AgentListItem
                      agentId="claude"
                      authStatus={claudeAuthStatus}
                      isSelected={selectedAgent === 'claude'}
                      onClick={() => { if (selectedAgent !== 'claude') requestNavigation(() => setSelectedAgent('claude')); }}
                    />
                    <AgentListItem
                      agentId="codex"
                      authStatus={codexAuthStatus}
                      isSelected={selectedAgent === 'codex'}
                      onClick={() => { if (selectedAgent !== 'codex') requestNavigation(() => setSelectedAgent('codex')); }}
                    />
                    <AgentListItem
                      agentId="gemini"
                      authStatus={geminiAuthStatus}
                      isSelected={selectedAgent === 'gemini'}
                      onClick={() => { if (selectedAgent !== 'gemini') requestNavigation(() => setSelectedAgent('gemini')); }}
                    />
                    <AgentListItem
                      agentId="openrouter"
                      authStatus={openrouterAuthStatus}
                      isSelected={selectedAgent === 'openrouter'}
                      onClick={() => { if (selectedAgent !== 'openrouter') requestNavigation(() => setSelectedAgent('openrouter')); }}
                    />
                    <AgentListItem
                      agentId="local"
                      authStatus={localAuthStatus}
                      isSelected={selectedAgent === 'local'}
                      onClick={() => { if (selectedAgent !== 'local') requestNavigation(() => setSelectedAgent('local')); }}
                    />
                  </div>
                </div>

                {/* Main Panel */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Category Tabs */}
                  <div className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                    <div className="flex px-2 md:px-4 overflow-x-auto">
                      <button
                        onClick={() => { if (selectedCategory !== 'account') requestNavigation(() => setSelectedCategory('account')); }}
                        className={`px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          selectedCategory === 'account'
                            ? 'border-foreground text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t('tabs.account')}
                      </button>
                      <button
                        onClick={() => { if (selectedCategory !== 'permissions') requestNavigation(() => setSelectedCategory('permissions')); }}
                        className={`px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          selectedCategory === 'permissions'
                            ? 'border-foreground text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t('tabs.permissions')}
                      </button>
                      <button
                        onClick={() => { if (selectedCategory !== 'mcp') requestNavigation(() => setSelectedCategory('mcp')); }}
                        className={`px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          selectedCategory === 'mcp'
                            ? 'border-foreground text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t('tabs.mcpServers')}
                      </button>
                      <button
                        onClick={() => { if (selectedCategory !== 'memory') requestNavigation(() => setSelectedCategory('memory')); }}
                        className={`px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                          selectedCategory === 'memory'
                            ? 'border-foreground text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Brain className="w-4 h-4" />
                        {t('memorySettings.title')}
                      </button>
                    </div>
                  </div>

                  {/* Category Content */}
                  <div className="flex-1 overflow-y-auto p-3 md:p-4">
                    {/* Account Category */}
                    {selectedCategory === 'account' && (
                      <AccountContent
                        key={selectedAgent}
                        agent={selectedAgent}
                        authStatus={
                          selectedAgent === 'claude' ? claudeAuthStatus :
                          selectedAgent === 'cursor' ? cursorAuthStatus :
                          selectedAgent === 'gemini' ? geminiAuthStatus :
                          selectedAgent === 'openrouter' ? openrouterAuthStatus :
                          selectedAgent === 'local' ? localAuthStatus :
                          codexAuthStatus
                        }
                        onRefreshStatus={{ claude: checkClaudeAuthStatus, cursor: checkCursorAuthStatus, codex: checkCodexAuthStatus, gemini: checkGeminiAuthStatus, openrouter: checkOpenRouterAuthStatus, local: checkLocalAuthStatus }[selectedAgent]}
                        onLogin={
                          selectedAgent === 'claude' ? handleClaudeLogin :
                          selectedAgent === 'cursor' ? handleCursorLogin :
                          selectedAgent === 'gemini' ? handleGeminiLogin :
                          selectedAgent === 'openrouter' ? (() => {}) :
                          selectedAgent === 'local' ? checkLocalAuthStatus :
                          handleCodexLogin
                        }
                      />
                    )}

                    {/* Permissions Category */}
                    {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
                      <PermissionsContent
                        agent="claude"
                        skipPermissions={skipPermissions}
                        setSkipPermissions={setSkipPermissions}
                        allowedTools={allowedTools}
                        setAllowedTools={setAllowedTools}
                        disallowedTools={disallowedTools}
                        setDisallowedTools={setDisallowedTools}
                        newAllowedTool={newAllowedTool}
                        setNewAllowedTool={setNewAllowedTool}
                        newDisallowedTool={newDisallowedTool}
                        setNewDisallowedTool={setNewDisallowedTool}
                      />
                    )}

                    {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
                      <PermissionsContent
                        agent="cursor"
                        skipPermissions={cursorSkipPermissions}
                        setSkipPermissions={setCursorSkipPermissions}
                        allowedCommands={cursorAllowedCommands}
                        setAllowedCommands={setCursorAllowedCommands}
                        disallowedCommands={cursorDisallowedCommands}
                        setDisallowedCommands={setCursorDisallowedCommands}
                        newAllowedCommand={newCursorCommand}
                        setNewAllowedCommand={setNewCursorCommand}
                        newDisallowedCommand={newCursorDisallowedCommand}
                        setNewDisallowedCommand={setNewCursorDisallowedCommand}
                      />
                    )}

                    {selectedCategory === 'permissions' && selectedAgent === 'codex' && (
                      <PermissionsContent
                        agent="codex"
                        permissionMode={codexPermissionMode}
                        setPermissionMode={setCodexPermissionMode}
                      />
                    )}

                    {selectedCategory === 'permissions' && selectedAgent === 'gemini' && (
                      <PermissionsContent
                        agent="gemini"
                        permissionMode={geminiPermissionMode}
                        setPermissionMode={setGeminiPermissionMode}
                        allowedTools={geminiAllowedTools}
                        setAllowedTools={setGeminiAllowedTools}
                        disallowedTools={geminiDisallowedTools}
                        setDisallowedTools={setGeminiDisallowedTools}
                        newAllowedTool={newGeminiAllowedTool}
                        setNewAllowedTool={setNewGeminiAllowedTool}
                        newDisallowedTool={newGeminiDisallowedTool}
                        setNewDisallowedTool={setNewGeminiDisallowedTool}
                      />
                    )}

                    {/* MCP Servers Category */}
                    {selectedCategory === 'mcp' && selectedAgent === 'claude' && (
                      <McpServersContent
                        agent="claude"
                        loadState={mcpReads.claude}
                        onRefresh={fetchMcpServers}
                        servers={mcpServers}
                        onAdd={() => openMcpForm()}
                        onEdit={(server) => openMcpForm(server)}
                        onDelete={(server) => deleteMcpServer(server.id, server.scope)}
                        onTest={(serverId, scope) => handleMcpTest(serverId, scope)}
                        onDiscoverTools={(serverId, scope) => handleMcpToolsDiscovery(serverId, scope)}
                        testResults={mcpTestResults}
                        serverTools={mcpServerTools}
                        toolsLoading={mcpToolsLoading}
                      />
                    )}

                    {selectedCategory === 'mcp' && selectedAgent === 'cursor' && (
                      <McpServersContent
                        agent="cursor"
                        loadState={mcpReads.cursor}
                        onRefresh={fetchCursorMcpServers}
                        servers={cursorMcpServers}
                        onAdd={() => {/* TODO: Add cursor MCP form */}}
                        onEdit={(server) => {/* TODO: Edit cursor MCP form */}}
                        onDelete={(serverId) => {/* TODO: Delete cursor MCP */}}
                      />
                    )}

                    {selectedCategory === 'mcp' && selectedAgent === 'codex' && (
                      <McpServersContent
                        agent="codex"
                        loadState={mcpReads.codex}
                        onRefresh={fetchCodexMcpServers}
                        servers={codexMcpServers}
                        onAdd={() => openCodexMcpForm()}
                        onEdit={(server) => openCodexMcpForm(server)}
                        onDelete={(server) => deleteCodexMcpServer(server.name)}
                      />
                    )}

                    {/* Memory Category */}
                    {selectedCategory === 'memory' && (
                      <MemoryContent />
                    )}
                  </div>
                </div>
              </div>
            )}

            {showMcpForm && <McpServerForm agent="claude" data={mcpFormData} setData={setMcpFormData} editing={editingMcpServer} projects={projects} pending={mcpLoading} error={mcpError} onSubmit={handleMcpSubmit} onClose={() => requestNavigation(resetMcpForm)} />}
            {showCodexMcpForm && <McpServerForm agent="codex" data={codexMcpFormData} setData={setCodexMcpFormData} editing={editingCodexMcpServer} projects={projects} pending={codexMcpLoading} error={codexMcpError} onSubmit={handleCodexMcpSubmit} onClose={() => requestNavigation(resetCodexMcpForm)} />}

            {activeTab === 'api' && (
              <div className="space-y-6 md:space-y-8">
                <CredentialsSettings />
              </div>
            )}
          </div>
        </div>

        <div data-settings-footer className="flex flex-col sm:flex-row sm:items-center sm:justify-end p-4 md:p-6 border-t border-border flex-shrink-0 gap-3 pb-safe-area-inset-bottom">
          {!hasIndependentSave && <div className="flex items-center justify-center sm:justify-start gap-2 order-2 sm:order-1 sm:mr-auto">
            {saveStatus === 'success' && (
              <div role="status" className="text-muted-foreground text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.success')}
              </div>
            )}
            {saveStatus === 'error' && (
              <div role="alert" className="text-destructive text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.error')}
              </div>
            )}
          </div>}
          <div className="flex items-center gap-3 order-1 sm:order-2">
            {hasIndependentSave ? (
              <Button
                onClick={requestClose}
                className="flex-1 sm:flex-none min-h-11 touch-manipulation"
              >
                {t('footerActions.done')}
              </Button>
            ) : <>
            <Button
              variant="outline"
              onClick={requestClose}
              disabled={isSaving}
              className="flex-1 sm:flex-none min-h-11 touch-manipulation"
            >
              {t('footerActions.cancel')}
            </Button>
            <Button
              onClick={saveSettings}
              disabled={isSaving}
              className="flex-1 sm:flex-none min-h-11 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 touch-manipulation"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('saveStatus.saving')}
                </div>
              ) : (
                t('footerActions.save')
              )}
            </Button>
            </>}
          </div>
        </div>
      </div>

      {/* Login Modal */}
      <LoginModal
        key={loginProvider}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider}
        project={selectedProject}
        onComplete={handleLoginComplete}
        isAuthenticated={
          loginProvider === 'claude' ? claudeAuthStatus.authenticated :
          loginProvider === 'cursor' ? cursorAuthStatus.authenticated :
          loginProvider === 'codex' ? codexAuthStatus.authenticated :
          false
        }
        cliAvailable={
          loginProvider === 'claude' ? claudeAuthStatus.cliAvailable !== false :
          loginProvider === 'cursor' ? cursorAuthStatus.cliAvailable !== false :
          loginProvider === 'codex' ? codexAuthStatus.cliAvailable !== false :
          loginProvider === 'gemini' ? geminiAuthStatus.cliAvailable !== false :
          true
        }
        installHint={
          loginProvider === 'claude' ? claudeAuthStatus.installHint :
          loginProvider === 'cursor' ? cursorAuthStatus.installHint :
          loginProvider === 'codex' ? codexAuthStatus.installHint :
          loginProvider === 'gemini' ? geminiAuthStatus.installHint :
          null
        }
        installable={
          loginProvider === 'claude' ? claudeAuthStatus.installable === true :
          loginProvider === 'cursor' ? cursorAuthStatus.installable === true :
          loginProvider === 'codex' ? codexAuthStatus.installable === true :
          loginProvider === 'gemini' ? geminiAuthStatus.installable === true :
          false
        }
        installerAvailable={
          loginProvider === 'claude' ? claudeAuthStatus.installerAvailable !== false :
          loginProvider === 'cursor' ? cursorAuthStatus.installerAvailable !== false :
          loginProvider === 'codex' ? codexAuthStatus.installerAvailable !== false :
          loginProvider === 'gemini' ? geminiAuthStatus.installerAvailable !== false :
          true
        }
        installerHint={
          loginProvider === 'claude' ? claudeAuthStatus.installerHint :
          loginProvider === 'cursor' ? cursorAuthStatus.installerHint :
          loginProvider === 'codex' ? codexAuthStatus.installerHint :
          loginProvider === 'gemini' ? geminiAuthStatus.installerHint :
          null
        }
        docsUrl={
          loginProvider === 'claude' ? claudeAuthStatus.docsUrl :
          loginProvider === 'cursor' ? cursorAuthStatus.docsUrl :
          loginProvider === 'codex' ? codexAuthStatus.docsUrl :
          loginProvider === 'gemini' ? geminiAuthStatus.docsUrl :
          null
        }
        downloadUrl={
          loginProvider === 'claude' ? claudeAuthStatus.downloadUrl :
          loginProvider === 'cursor' ? cursorAuthStatus.downloadUrl :
          loginProvider === 'codex' ? codexAuthStatus.downloadUrl :
          loginProvider === 'gemini' ? geminiAuthStatus.downloadUrl :
          null
        }
        onStatusRefresh={() => refreshProviderStatus(loginProvider)}
      />
    </dialog>
  );
}

export default function Settings(props) {
  return <SettingsDraftProvider><SettingsContent {...props} /></SettingsDraftProvider>;
}
