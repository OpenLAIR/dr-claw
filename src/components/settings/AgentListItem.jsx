import SessionProviderLogo from '../SessionProviderLogo';
import { useTranslation } from 'react-i18next';

const agentConfig = {
  claude: {
    name: 'Claude',
    color: 'blue',
  },
  cursor: {
    name: 'Cursor',
    color: 'purple',
  },
  codex: {
    name: 'Codex',
    color: 'gray',
  },
  gemini: {
    name: 'Gemini',
    color: 'blue',
  },
  openrouter: {
    name: 'OpenRouter',
    color: 'purple',
  },
};

const colorClasses = {
  blue: {
    border: 'border-l-blue-500 md:border-l-blue-500',
    borderBottom: 'border-b-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    dot: 'bg-blue-500',
  },
  purple: {
    border: 'border-l-purple-500 md:border-l-purple-500',
    borderBottom: 'border-b-purple-500',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    dot: 'bg-purple-500',
  },
  gray: {
    border: 'border-l-gray-700 dark:border-l-gray-300',
    borderBottom: 'border-b-gray-700 dark:border-b-gray-300',
    bg: 'bg-gray-100 dark:bg-gray-800/50',
    dot: 'bg-gray-700 dark:bg-gray-300',
  },
};

export default function AgentListItem({ agentId, authStatus, isSelected, onClick, isMobile = false }) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agentId];
  const colors = colorClasses[config.color];
  const cliMissing = authStatus?.cliAvailable === false;

  // Mobile: horizontal layout with bottom border
  if (isMobile) {
    return (
      <button
        onClick={onClick}
        className={`flex-1 text-center py-3 px-2 border-b-2 transition-colors ${
          isSelected
            ? `${colors.borderBottom} ${colors.bg}`
            : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        <div className="flex flex-col items-center gap-1">
          <SessionProviderLogo provider={agentId} className="w-5 h-5" />
          <span className="text-xs font-medium text-foreground">{config.name}</span>
          {authStatus?.authenticated && (
            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
          )}
          {cliMissing && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          )}
        </div>
      </button>
    );
  }

  // Desktop: vertical layout with left border
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 border-l-4 transition-colors ${
        isSelected
          ? `${colors.border} ${colors.bg}`
          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <SessionProviderLogo provider={agentId} className="w-4 h-4" />
        <span className="font-medium text-foreground">{config.name}</span>
      </div>
      <div className="text-xs text-muted-foreground pl-6">
        {authStatus?.loading ? (
          <span className="text-gray-400">{t('agents.authStatus.checking')}</span>
        ) : authStatus?.authenticated ? (
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
            <span className="truncate max-w-[120px]" title={authStatus.email}>
              {authStatus.email || t('agents.authStatus.connected')}
            </span>
          </div>
        ) : cliMissing ? (
          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>{t('agents.authStatus.installRequired')}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            <span>{t('agents.authStatus.notConnected')}</span>
          </div>
        )}
      </div>
    </button>
  );
}
