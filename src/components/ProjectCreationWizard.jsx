import React, { useState, useEffect } from 'react';
import { X, FolderPlus, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, FolderOpen, Eye, EyeOff, Plus, RefreshCw, GitBranch } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '../utils/api';
import { useTranslation } from 'react-i18next';
import generateWorkspaceName from '../utils/workspaceNameGenerator';

const ProjectCreationWizard = ({ onClose, onProjectCreated }) => {
  const { t } = useTranslation();
  // Wizard state
  const [step, setStep] = useState(1); // 1: Choose type, 2: Configure, 3: Confirm
  const [workspaceType, setWorkspaceType] = useState('existing'); // 'existing' or 'new' - default to 'existing'

  // Form state
  const [workspacePath, setWorkspacePath] = useState('');
  const [projectName, setProjectName] = useState('');

  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const [pathSuggestions, setPathSuggestions] = useState([]);
  const [showPathDropdown, setShowPathDropdown] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [browserCurrentPath, setBrowserCurrentPath] = useState('~');
  const [browserFolders, setBrowserFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState(generateWorkspaceName());
  const [creatingFolder, setCreatingFolder] = useState(false);

  const appendPathSegment = (basePath, segment) => {
    const separator = basePath.includes('\\') ? '\\' : '/';

    if (basePath.endsWith('/') || basePath.endsWith('\\')) {
      return `${basePath}${segment}`;
    }

    return `${basePath}${separator}${segment}`;
  };

  const normalizePathForComparison = (value) => value.replace(/\\/g, '/').toLowerCase();

  const getParentDirectoryPath = (inputPath) => {
    const trimmedPath = inputPath.trim();
    if (!trimmedPath) return '~';

    const lastSeparatorIndex = Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'));

    if (lastSeparatorIndex < 0) {
      return '~';
    }

    // Handle Windows drive root (e.g. C:\ or C:/) correctly.
    if (/^[A-Za-z]:[\\/]/.test(trimmedPath) && lastSeparatorIndex === 2) {
      return trimmedPath.slice(0, 3);
    }

    if (lastSeparatorIndex === 0) {
      return '/';
    }

    return trimmedPath.slice(0, lastSeparatorIndex);
  };

  // Auto-fill new workspace path so users can continue without opening folder browser.
  useEffect(() => {
    if (step !== 2 || workspaceType !== 'new' || (workspacePath.trim() && projectName.trim())) {
      return;
    }

    const autoFillPath = async () => {
      const suggestedName = generateWorkspaceName();
      try {
        const response = await api.browseFilesystem('~');
        const data = await response.json();
        const basePath = data.path || '~/dr-claw';
        const suggestedPath = appendPathSegment(basePath, suggestedName);
        setWorkspacePath((currentPath) => (currentPath.trim() ? currentPath : suggestedPath));
        setProjectName((currentName) => (currentName.trim() ? currentName : suggestedName));
      } catch (error) {
        console.error('Error auto-filling workspace path:', error);
        const fallbackPath = `~/dr-claw/${suggestedName}`;
        setWorkspacePath((currentPath) => (currentPath.trim() ? currentPath : fallbackPath));
        setProjectName((currentName) => (currentName.trim() ? currentName : suggestedName));
      }
    };

    autoFillPath();
  }, [step, workspaceType, workspacePath, projectName]);

  // Load path suggestions
  useEffect(() => {
    if (workspacePath.length > 2) {
      loadPathSuggestions(workspacePath);
    } else {
      setPathSuggestions([]);
      setShowPathDropdown(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (showFolderBrowser) {
      setNewFolderName(generateWorkspaceName());
    }
  }, [showFolderBrowser]);

  const loadPathSuggestions = async (inputPath) => {
    try {
      // Extract the directory to browse (parent of input)
      const dirPath = getParentDirectoryPath(inputPath);

      const response = await api.browseFilesystem(dirPath);
      const data = await response.json();

      if (data.suggestions) {
        // Filter suggestions based on the input, excluding exact match
        const normalizedInput = normalizePathForComparison(inputPath);
        const filtered = data.suggestions.filter(s =>
          normalizePathForComparison(s.path).startsWith(normalizedInput) &&
          normalizePathForComparison(s.path) !== normalizedInput
        );
        setPathSuggestions(filtered.slice(0, 5));
        setShowPathDropdown(filtered.length > 0);
      }
    } catch (error) {
      console.error('Error loading path suggestions:', error);
    }
  };

  const handleNext = () => {
    setError(null);

    if (step === 1) {
      if (!workspaceType) {
        setError(t('projectWizard.errors.selectType'));
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!workspacePath.trim()) {
        setError(t('projectWizard.errors.providePath'));
        return;
      }

      // If no project name specified, use the last part of path
      if (!projectName.trim()) {
        const parts = workspacePath.split(/[\\/]/).filter(Boolean);
        if (parts.length > 0) {
          setProjectName(parts[parts.length - 1]);
        }
      }

      // No validation for GitHub token - it's optional (only needed for private repos)
      setStep(3);
    }
  };

  const handleBack = () => {
    setError(null);
    setStep(step - 1);
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const payload = {
        workspaceType,
        path: workspacePath.trim(),
        displayName: projectName.trim(),
      };

      const response = await api.createWorkspace(payload);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || t('projectWizard.errors.failedToCreate'));
      }

      if (onProjectCreated) {
        onProjectCreated(data.project);
      }

      onClose();
    } catch (error) {
      console.error('Error creating workspace:', error);
      setError(error.message || t('projectWizard.errors.failedToCreate'));
    } finally {
      setIsCreating(false);
    }
  };

  const selectPathSuggestion = (suggestion) => {
    setWorkspacePath(suggestion.path);
    setShowPathDropdown(false);
  };

  const openFolderBrowser = async () => {
    setShowFolderBrowser(true);
    await loadBrowserFolders('~/dr-claw');
  };

  const loadBrowserFolders = async (path) => {
    try {
      setLoadingFolders(true);
      const response = await api.browseFilesystem(path);
      const data = await response.json();
      setBrowserCurrentPath(data.path || path);
      setBrowserFolders(data.suggestions || []);
    } catch (error) {
      console.error('Error loading folders:', error);
    } finally {
      setLoadingFolders(false);
    }
  };

  const selectFolder = (folderPath, advanceToConfirm = false) => {
    setWorkspacePath(folderPath);
    setShowFolderBrowser(false);
    if (advanceToConfirm) {
      setStep(3);
    }
  };

  const navigateToFolder = async (folderPath) => {
    await loadBrowserFolders(folderPath);
  };

  const createNewFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      const folderPath = appendPathSegment(browserCurrentPath, newFolderName.trim());
      const response = await api.createFolder(folderPath);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t('projectWizard.errors.failedToCreateFolder', 'Failed to create folder'));
      }
      const createdFolderPath = data.path || folderPath;
      setWorkspacePath(createdFolderPath);
      setNewFolderName(generateWorkspaceName());
      setShowNewFolderInput(false);
      setShowFolderBrowser(false);

      if (workspaceType === 'existing') {
        setStep(3);
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      setError(error.message || t('projectWizard.errors.failedToCreateFolder', 'Failed to create folder'));
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-none sm:rounded-lg shadow-xl w-full h-full sm:h-auto sm:max-w-2xl border-0 sm:border border-gray-200 dark:border-gray-700 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <FolderPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('projectWizard.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            disabled={isCreating}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm ${
                      s < step
                        ? 'bg-green-500 text-white'
                        : s === step
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                    }`}
                  >
                    {s < step ? <Check className="w-4 h-4" /> : s}
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">
                    {s === 1 ? t('projectWizard.steps.type') : s === 2 ? t('projectWizard.steps.configure') : t('projectWizard.steps.confirm')}
                  </span>
                </div>
                {s < 3 && (
                  <div
                    className={`flex-1 h-1 mx-2 rounded ${
                      s < step ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 min-h-[300px]">
          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            </div>
          )}

          {/* Step 1: Choose workspace type */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {t('projectWizard.step1.question')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Existing Workspace */}
                  <button
                    onClick={() => setWorkspaceType('existing')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'existing'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FolderPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          {t('projectWizard.step1.existing.title')}
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {t('projectWizard.step1.existing.description')}
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* New Workspace */}
                  <button
                    onClick={() => setWorkspaceType('new')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'new'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          {t('projectWizard.step1.new.title')}
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {t('projectWizard.step1.new.description')}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Configure workspace */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Project Name (Optional/New) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('projectWizard.step2.projectName', 'Project Name')}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={projectName}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setProjectName(newName);

                      // If it's a new workspace and path follows default pattern, update path too
                      if (workspaceType === 'new' && newName.trim()) {
                        const parentPath = getParentDirectoryPath(workspacePath);
                        setWorkspacePath(appendPathSegment(parentPath, newName.trim()));
                      }
                    }}
                    placeholder={t('projectWizard.step2.projectNamePlaceholder', 'Enter project name')}
                    className="flex-1"
                  />
                  {workspaceType === 'new' && (
                    <Button
                      size="icon"
                      variant="outline"
                      type="button"
                      onClick={() => {
                        const suggestedName = generateWorkspaceName();
                        setProjectName(suggestedName);
                        const parentPath = getParentDirectoryPath(workspacePath);
                        setWorkspacePath(appendPathSegment(parentPath, suggestedName));
                      }}
                      title={t('projectWizard.folderBrowser.regenerateName')}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('projectWizard.step2.projectNameHelp', 'A friendly name for your project.')}
                </p>
              </div>

              {/* Workspace Path */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {workspaceType === 'existing' ? t('projectWizard.step2.existingPath') : t('projectWizard.step2.newPath')}
                </label>
                <div className="relative flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      type="text"
                      value={workspacePath}
                      onChange={(e) => setWorkspacePath(e.target.value)}
                      placeholder={workspaceType === 'existing' ? '/path/to/existing/workspace' : '/path/to/new/workspace'}
                      className="w-full"
                    />
                    {showPathDropdown && pathSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {pathSuggestions.map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => selectPathSuggestion(suggestion)}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
                          >
                            <div className="font-medium text-gray-900 dark:text-white">{suggestion.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{suggestion.path}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openFolderBrowser}
                    className="px-3"
                    title="Browse folders"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {workspaceType === 'existing'
                    ? t('projectWizard.step2.existingHelp')
                    : t('projectWizard.step2.newHelp')}
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  {t('projectWizard.step3.reviewConfig')}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.workspaceType')}</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {workspaceType === 'existing' ? t('projectWizard.step3.existingWorkspace') : t('projectWizard.step3.newWorkspace')}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.path')}</span>
                    <span className="font-mono text-xs text-gray-900 dark:text-white break-all">
                      {workspacePath}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {workspaceType === 'existing'
                    ? t('projectWizard.step3.existingInfo')
                    : t('projectWizard.step3.newEmpty')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : handleBack}
            disabled={isCreating}
          >
            {step === 1 ? (
              t('projectWizard.buttons.cancel')
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t('projectWizard.buttons.back')}
              </>
            )}
          </Button>

          <Button
            onClick={step === 3 ? handleCreate : handleNext}
            disabled={isCreating || (step === 1 && !workspaceType)}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('projectWizard.buttons.creating')}
              </>
            ) : step === 3 ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                {t('projectWizard.buttons.createProject')}
              </>
            ) : (
              <>
                {t('projectWizard.buttons.next')}
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Folder Browser Modal */}
      {showFolderBrowser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] border border-gray-200 dark:border-gray-700 flex flex-col">
            {/* Browser Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
                  <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Select Folder
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowHiddenFolders(!showHiddenFolders)}
                  className={`p-2 rounded-md transition-colors ${
                    showHiddenFolders
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
                >
                  {showHiddenFolders ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => {
                    const shouldShowInput = !showNewFolderInput;
                    setShowNewFolderInput(shouldShowInput);
                    if (shouldShowInput) {
                      setNewFolderName(generateWorkspaceName());
                    }
                  }}
                  className={`p-2 rounded-md transition-colors ${
                    showNewFolderInput
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title="Create new folder"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowFolderBrowser(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* New Folder Input */}
            {showNewFolderInput && (
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="New folder name"
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createNewFolder();
                        if (e.key === 'Escape') {
                          setShowNewFolderInput(false);
                          setNewFolderName('');
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      type="button"
                      onClick={() => setNewFolderName(generateWorkspaceName())}
                      title={t('projectWizard.folderBrowser.regenerateName')}
                      aria-label={t('projectWizard.folderBrowser.regenerateName')}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={createNewFolder}
                    disabled={!newFolderName.trim() || creatingFolder}
                  >
                    {creatingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowNewFolderInput(false);
                      setNewFolderName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Folder List */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingFolders ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Parent Directory - check for Windows root (e.g., C:\) and Unix root */}
                  {browserCurrentPath !== '~' && browserCurrentPath !== '/' && !/^[A-Za-z]:\\?$/.test(browserCurrentPath) && (
                    <button
                      onClick={() => {
                        const lastSlash = Math.max(browserCurrentPath.lastIndexOf('/'), browserCurrentPath.lastIndexOf('\\'));
                        let parentPath;
                        if (lastSlash <= 0) {
                          parentPath = '/';
                        } else if (lastSlash === 2 && /^[A-Za-z]:/.test(browserCurrentPath)) {
                          parentPath = browserCurrentPath.substring(0, 3);
                        } else {
                          parentPath = browserCurrentPath.substring(0, lastSlash);
                        }
                        navigateToFolder(parentPath);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3"
                    >
                      <FolderOpen className="w-5 h-5 text-gray-400" />
                      <span className="font-medium text-gray-700 dark:text-gray-300">..</span>
                    </button>
                  )}

                  {/* Folders */}
                  {browserFolders.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No subfolders found
                    </div>
                  ) : (
                    browserFolders
                      .filter(folder => showHiddenFolders || !folder.name.startsWith('.'))
                      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                      .map((folder, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <button
                          onClick={() => navigateToFolder(folder.path)}
                          className="flex-1 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3"
                        >
                          <FolderPlus className="w-5 h-5 text-blue-500" />
                          <span className="font-medium text-gray-900 dark:text-white">{folder.name}</span>
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => selectFolder(folder.path, workspaceType === 'existing')}
                          className="text-xs px-3"
                        >
                          Select
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Browser Footer with Current Path */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Path:</span>
                <code className="text-sm font-mono text-gray-900 dark:text-white flex-1 truncate">
                  {browserCurrentPath}
                </code>
              </div>
              <div className="flex items-center justify-end gap-2 p-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowFolderBrowser(false);
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => selectFolder(browserCurrentPath, workspaceType === 'existing')}
                >
                  Use this folder
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectCreationWizard;
