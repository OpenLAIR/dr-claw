import { SessionProvider } from '../../../../types/app';
import SessionProviderLogo from '../../../SessionProviderLogo';
import { useTranslation } from 'react-i18next';
import { getProviderDisplayName } from '../../utils/chatFormatting';

type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
  statusText?: string | null;
}


export default function AssistantThinkingIndicator({ selectedProvider, statusText }: AssistantThinkingIndicatorProps) {
  const { t } = useTranslation('chat');
  return (
    <div className="chat-message assistant flex flex-col w-full px-4 sm:px-6">
      <div className="flex flex-col w-full mb-6">
        <div className="flex items-center space-x-2 mb-2">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0">
            <SessionProviderLogo provider={selectedProvider} className="w-full h-full" />
          </div>
          <div className="text-xs font-semibold text-gray-900 dark:text-white">
            {getProviderDisplayName(selectedProvider)}
          </div>
        </div>
        <div className="w-full text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center space-x-1">
            <div className="animate-pulse">.</div>
            <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>
              .
            </div>
            <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>
              .
            </div>
            <span className="ml-2 text-xs">{statusText || t('status.thinking')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
