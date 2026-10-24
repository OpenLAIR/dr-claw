/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists to localStorage.
 *
 * Props:
 * @param {boolean} compact - If true, uses compact style (default: false)
 */

import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { languages } from '../i18n/languages';

function LanguageSelector({ compact = false }) {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (event) => {
    const newLanguage = event.target.value;
    i18n.changeLanguage(newLanguage);
  };

  // Compact style for QuickSettingsPanel
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 py-3">
        <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
          <Languages className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          {t('account.language')}
        </span>
        <select
          aria-label={t('account.language')}
          value={i18n.language}
          onChange={handleLanguageChange}
          className="w-[100px] text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Full style for Settings page
  return (
    <div className="border-b border-border py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="font-medium mb-1">
            {t('account.languageLabel')}
          </div>
          <div className="text-sm text-muted-foreground">
            {t('account.languageDescription')}
          </div>
        </div>
        <select
          aria-label={t('account.language')}
          value={i18n.language}
          onChange={handleLanguageChange}
          className="min-h-11 max-w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default LanguageSelector;
