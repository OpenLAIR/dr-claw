import React, { useState } from 'react';
import { Maximize2, Eye, Moon, Sun, ArrowDown, Mic, Brain, Sparkles, FileText, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DarkModeToggle from './DarkModeToggle';
import { useUiPreferences } from '../hooks/useUiPreferences';
import { useTheme } from '../contexts/ThemeContext';
import LanguageSelector from './LanguageSelector';

// Hosted in conversation configuration. Preference keys and sync events stay intact.
const QuickSettingsPanel = () => {
  const { t } = useTranslation('settings');
  const [whisperMode, setWhisperMode] = useState(() => localStorage.getItem('whisperMode') || 'default');
  const { isDarkMode } = useTheme();
  const { preferences, setPreference } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;
  return <details className="mt-5 border-t border-border pt-4">
    <summary className="cursor-pointer text-sm font-medium">{t('quickSettings.title')}</summary>
    <div className="mt-4 space-y-5">
            {/* Appearance Settings */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">{t('quickSettings.sections.appearance')}</h4>

              <div className="flex items-center justify-between gap-3 py-3">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  {isDarkMode ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
                  {t('quickSettings.darkMode')}
                </span>
                <DarkModeToggle />
              </div>

              {/* Language Selector */}
              <div>
                <LanguageSelector compact={true} />
              </div>
            </div>

            {/* Tool Display Settings */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">{t('quickSettings.sections.toolDisplay')}</h4>

              <label className="flex items-center justify-between gap-3 py-3 cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Maximize2 className="h-4 w-4 text-muted-foreground" />
                  {t('quickSettings.autoExpandTools')}
                </span>
                <input
                  type="checkbox"
                  checked={autoExpandTools}
                  onChange={(e) => setPreference('autoExpandTools', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-3 cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  {t('quickSettings.showRawParameters')}
                </span>
                <input
                  type="checkbox"
                  checked={showRawParameters}
                  onChange={(e) => setPreference('showRawParameters', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>

              <label className="flex items-center justify-between gap-3 py-3 cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Brain className="h-4 w-4 text-muted-foreground" />
                  {t('quickSettings.showThinking')}
                </span>
                <input
                  type="checkbox"
                  checked={showThinking}
                  onChange={(e) => setPreference('showThinking', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>
            </div>
            {/* View Options */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">{t('quickSettings.sections.viewOptions')}</h4>

              <label className="flex items-center justify-between gap-3 py-3 cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <ArrowDown className="h-4 w-4 text-muted-foreground" />
                  {t('quickSettings.autoScrollToBottom')}
                </span>
                <input
                  type="checkbox"
                  checked={autoScrollToBottom}
                  onChange={(e) => setPreference('autoScrollToBottom', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>
            </div>

            {/* Input Settings */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">{t('quickSettings.sections.inputSettings')}</h4>

              <label className="flex items-center justify-between gap-3 py-3 cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  {t('quickSettings.sendByCtrlEnter')}
                </span>
                <input
                  type="checkbox"
                  checked={sendByCtrlEnter}
                  onChange={(e) => setPreference('sendByCtrlEnter', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>
              <p className="text-xs text-muted-foreground ml-3">
                {t('quickSettings.sendByCtrlEnterDescription')}
              </p>
            </div>

            {/* Whisper Dictation Settings - HIDDEN */}
            <div className="space-y-2" style={{ display: 'none' }}>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">{t('quickSettings.sections.whisperDictation')}</h4>
              
              <div className="space-y-2">
                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="default"
                    checked={whisperMode === 'default'}
                    onChange={() => {
                      setWhisperMode('default');
                      localStorage.setItem('whisperMode', 'default');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Mic className="h-4 w-4 text-muted-foreground" />
                      {t('quickSettings.whisper.modes.default')}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('quickSettings.whisper.modes.defaultDescription')}
                    </p>
                  </div>
                </label>

                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="prompt"
                    checked={whisperMode === 'prompt'}
                    onChange={() => {
                      setWhisperMode('prompt');
                      localStorage.setItem('whisperMode', 'prompt');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      {t('quickSettings.whisper.modes.prompt')}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('quickSettings.whisper.modes.promptDescription')}
                    </p>
                  </div>
                </label>

                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="vibe"
                    checked={whisperMode === 'vibe' || whisperMode === 'instructions' || whisperMode === 'architect'}
                    onChange={() => {
                      setWhisperMode('vibe');
                      localStorage.setItem('whisperMode', 'vibe');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {t('quickSettings.whisper.modes.vibe')}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('quickSettings.whisper.modes.vibeDescription')}
                    </p>
                  </div>
                </label>
              </div>
            </div>
    </div>
  </details>;
};

export default QuickSettingsPanel;
