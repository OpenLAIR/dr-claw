import React, { memo, useMemo } from 'react';
import { User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../SessionProviderLogo';
import type {
  ChatMessage,
  PermissionSuggestion,
  PermissionGrantResult,
  Provider,
} from '../../types/types';
import { Markdown } from './Markdown';
import { formatUsageLimitText } from '../../utils/chatFormatting';
import { getPermissionSuggestion } from '../../utils/chatPermissions';
import type { Project } from '../../../../types/app';
import { ToolRenderer, shouldHideToolResult } from '../../tools';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface MessageComponentProps {
  message: ChatMessage;
  index: number;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: PermissionSuggestion) => PermissionGrantResult | null | undefined;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

type PermissionGrantState = 'idle' | 'granted' | 'error';

const MessageComponent = memo(({ message, index, prevMessage, createDiff, onFileOpen, onShowSettings, onGrantToolPermission, autoExpandTools, showRawParameters, showThinking, selectedProject, provider }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
                   ((prevMessage.type === 'assistant') ||
                    (prevMessage.type === 'user') ||
                    (prevMessage.type === 'tool') ||
                    (prevMessage.type === 'error'));
  const messageRef = React.useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const permissionSuggestion = getPermissionSuggestion(message, provider);
  const [permissionGrantState, setPermissionGrantState] = React.useState<PermissionGrantState>('idle');


  React.useEffect(() => {
    setPermissionGrantState('idle');
  }, [permissionSuggestion?.entry, message.toolId]);

  React.useEffect(() => {
    const node = messageRef.current;
    if (!autoExpandTools || !node || !message.isToolUse) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isExpanded) {
            setIsExpanded(true);
            const details = node.querySelectorAll<HTMLDetailsElement>('details');
            details.forEach((detail) => {
              detail.open = true;
            });
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(node);

    return () => {
      observer.unobserve(node);
    };
  }, [autoExpandTools, isExpanded, message.isToolUse]);

  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  // Only hide thinking messages for Claude; Codex reasoning should always be shown (collapsed)
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking && provider !== 'codex');

  if (shouldHideThinkingMessage) {
    return null;
  }

  return (
    <div
      ref={messageRef}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} flex flex-col w-full px-4 sm:px-6`}
    >
      {message.isSkillContent ? (
        /* Collapsible skill content */
        <div className="w-full mb-4">
          <div className="border border-purple-200/50 dark:border-purple-800/30 rounded-lg bg-purple-50/30 dark:bg-purple-900/10 shadow-sm overflow-hidden">
            <details className="group">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[13px] select-none hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors">
                <svg
                  className="w-3.5 h-3.5 text-purple-400 dark:text-purple-500 transition-transform duration-150 group-open:rotate-90 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="font-bold text-purple-600 dark:text-purple-400 text-xs flex-shrink-0">Skill</span>
                <span className="text-gray-300 dark:text-gray-700 text-[10px] flex-shrink-0 mx-0.5">|</span>
                <span className="text-gray-500 dark:text-gray-400 truncate flex-1 font-medium text-xs">
                  {(() => {
                    const c = message.content || '';
                    const cmdMatch = c.match(/<command-name>([^<]+)<\/command-name>/);
                    if (cmdMatch) return cmdMatch[1];
                    const pathMatch = c.match(/Base directory for this skill:\s*(\S+)/);
                    if (pathMatch) return pathMatch[1].split('/').pop() || t('skill.contentLoaded');
                    return t('skill.contentLoaded');
                  })()}
                </span>
              </summary>
              <div className="px-4 py-3 border-t border-purple-100 dark:border-purple-800/30 max-h-96 overflow-y-auto">
                <Markdown className="prose prose-sm max-w-none dark:prose-invert">
                  {(message.content || '')
                    .replace(/<command-name>[^<]*<\/command-name>/g, '')
                    .replace(/<\/?command-message>/g, '')
                    .replace(/<command-args>[^<]*<\/command-args>/g, '')
                    .replace(/<\/?local-command-stdout>/g, '')
                    .replace(/^[❯>]\s*Base directory for this skill:\s*\S+\s*/m, '')
                    .trim()}
                </Markdown>
              </div>
            </details>
          </div>
        </div>
      ) : message.type === 'user' ? (
        /* User message bubble */
        <div className="flex flex-col items-end w-full mb-4">
          <div className="flex items-center space-x-2 mb-1.5">
            {!isGrouped && (
              <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white flex-shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
          <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-2.5 shadow-sm max-w-[90%] sm:max-w-[85%]">
            <div className="text-[15px] whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </div>
            {message.images && message.images.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {message.images.map((img, idx) => {
                  const isImage = img.mimeType ? img.mimeType.startsWith('image/') : (img.data && img.data.startsWith('data:image/'));
                  if (isImage) {
                    return (
                      <img
                        key={img.name || idx}
                        src={img.data}
                        alt={img.name}
                        className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => window.open(img.data, '_blank')}
                      />
                    );
                  }
                  return (
                    <div key={img.name || idx} className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                      <svg className="w-4 h-4 flex-shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm truncate">{img.name || 'file'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {!isGrouped && (
            <div className="text-[10px] text-gray-400 mt-1 mr-1">
              {formattedTime}
            </div>
          )}
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${message.taskStatus === 'completed' ? 'bg-green-400 dark:bg-green-500' : 'bg-amber-400 dark:bg-amber-500'}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages */
        <div className="flex flex-col w-full mb-6">
          {!isGrouped && (
            <div className="flex items-center space-x-2 mb-2">
              {message.type === 'error' ? (
                <div className="w-6 h-6 bg-red-600 rounded-full flex items-center justify-center text-white text-[10px] flex-shrink-0">
                  !
                </div>
              ) : message.type === 'tool' ? (
                <div className="w-6 h-6 bg-gray-600 dark:bg-gray-700 rounded-full flex items-center justify-center text-white text-[10px] flex-shrink-0">
                  🔧
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0">
                  <SessionProviderLogo provider={provider} className="w-full h-full" />
                </div>
              )}
              <div className="text-xs font-semibold text-gray-900 dark:text-white">
                {message.type === 'error' ? t('messageTypes.error') : message.type === 'tool' ? t('messageTypes.tool') : (provider === 'cursor' ? t('messageTypes.cursor') : provider === 'codex' ? t('messageTypes.codex') : provider === 'gemini' ? 'Gemini' : t('messageTypes.claude'))}
              </div>
            </div>
          )}
          
          <div className="w-full pl-0">

            {message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <Markdown className="prose prose-sm max-w-none dark:prose-invert" onFileOpen={onFileOpen}>
                      {String(message.displayText || '')}
                    </Markdown>
                  </div>
                </div>

                {message.toolInput && (
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    toolInput={message.toolInput}
                    toolResult={message.toolResult}
                    toolId={message.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                    isSubagentContainer={message.isSubagentContainer}
                    subagentState={message.subagentState}
                  />
                )}
                
                {/* Tool Result Section */}
                {message.toolResult && !shouldHideToolResult(message.toolName || 'UnknownTool', message.toolResult) && (
                  message.toolResult.isError ? (
                    // Error results - red error box with content
                    <div
                      id={`tool-result-${message.toolId}`}
                      className="relative mt-2 p-3 rounded border scroll-mt-4 bg-red-50/50 dark:bg-red-950/10 border-red-200/60 dark:border-red-800/40"
                    >
                      <div className="relative flex items-center gap-1.5 mb-2">
                        <svg className="w-4 h-4 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-xs font-medium text-red-700 dark:text-red-300">{t('messageTypes.error')}</span>
                      </div>
                      <div className="relative text-sm text-red-900 dark:text-red-100">
                        <Markdown className="prose prose-sm max-w-none prose-red dark:prose-invert">
                          {String(message.toolResult.content || '')}
                        </Markdown>
                        {permissionSuggestion && (
                          <div className="mt-4 border-t border-red-200/60 dark:border-red-800/60 pt-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!onGrantToolPermission) return;
                                  const result = onGrantToolPermission(permissionSuggestion);
                                  if (result?.success) {
                                    setPermissionGrantState('granted');
                                  } else {
                                    setPermissionGrantState('error');
                                  }
                                }}
                                disabled={permissionSuggestion.isAllowed || permissionGrantState === 'granted'}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                                  permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                    ? 'bg-green-100 dark:bg-green-900/30 border-green-300/70 dark:border-green-800/60 text-green-800 dark:text-green-200 cursor-default'
                                    : 'bg-white/80 dark:bg-gray-900/40 border-red-300/70 dark:border-red-800/60 text-red-700 dark:text-red-200 hover:bg-white dark:hover:bg-gray-900/70'
                                }`}
                              >
                                {permissionSuggestion.isAllowed || permissionGrantState === 'granted'
                                  ? t('permissions.added')
                                  : t('permissions.grant', { tool: permissionSuggestion.toolName })}
                              </button>
                              {onShowSettings && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onShowSettings(); }}
                                  className="text-xs text-red-700 dark:text-red-200 underline hover:text-red-800 dark:hover:text-red-100"
                                >
                                  {t('permissions.openSettings')}
                                </button>
                              )}
                            </div>
                            <div className="mt-2 text-xs text-red-700/90 dark:text-red-200/80">
                              {t('permissions.addTo', { entry: permissionSuggestion.entry })}
                            </div>
                            {permissionGrantState === 'error' && (
                              <div className="mt-2 text-xs text-red-700 dark:text-red-200">
                                {t('permissions.error')}
                              </div>
                            )}
                            {(permissionSuggestion.isAllowed || permissionGrantState === 'granted') && (
                              <div className="mt-2 text-xs text-green-700 dark:text-green-200">
                                {t('permissions.retry')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Non-error results - route through ToolRenderer (single source of truth)
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolRenderer
                        toolName={message.toolName || 'UnknownTool'}
                        toolInput={message.toolInput}
                        toolResult={message.toolResult}
                        toolId={message.toolId}
                        mode="result"
                        onFileOpen={onFileOpen}
                        createDiff={createDiff}
                        selectedProject={selectedProject}
                        autoExpandTools={autoExpandTools}
                      />
                    </div>
                  )
                )}
              </>
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-3">
                      {t('interactive.title')}
                    </h4>
                    {(() => {
                      const lines = (message.content || '').split('\n').filter((line) => line.trim());
                      const questionLine = lines.find((line) => line.includes('?')) || lines[0] || '';
                      const options: InteractiveOption[] = [];
                      
                      // Parse the menu options
                      lines.forEach((line) => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });
                      
                      return (
                        <>
                          <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                            {questionLine}
                          </p>
                          
                          {/* Option buttons */}
                          <div className="space-y-2 mb-4">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                                  option.isSelected
                                    ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                    : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                                } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                    option.isSelected
                                      ? 'bg-white/20'
                                      : 'bg-amber-100 dark:bg-amber-800/50'
                                  }`}>
                                    {option.number}
                                  </span>
                                  <span className="text-sm sm:text-base font-medium flex-1">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                          
                          <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3">
                            <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
                              {t('interactive.waiting')}
                            </p>
                            <p className="text-amber-800 dark:text-amber-200 text-xs">
                              {t('interactive.instruction')}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isThinking ? (
              /* Thinking messages - collapsible by default */
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <details className="group">
                  <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium flex items-center gap-2">
                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span>{t('thinking.emoji')}</span>
                  </summary>
                  <div className="mt-2 pl-4 border-l-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-sm">
                    <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-gray">
                      {message.content}
                    </Markdown>
                  </div>
                </details>
              </div>
            ) : (
              <div className="text-[15px] text-gray-700 dark:text-gray-300">
                {/* Thinking accordion for reasoning */}
                {showThinking && message.reasoning && (
                  <details className="mb-3">
                    <summary className="cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium">
                      {t('thinking.emoji')}
                    </summary>
                    <div className="mt-2 pl-4 border-l-2 border-gray-300 dark:border-gray-600 italic text-gray-600 dark:text-gray-400 text-sm">
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </div>
                  </details>
                )}

                {(() => {
                  const content = formatUsageLimitText(String(message.content || ''));

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                      (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="flex items-center gap-2 mb-2 text-sm text-gray-600 dark:text-gray-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
                            <pre className="p-4 overflow-x-auto">
                              <code className="text-gray-100 dark:text-gray-200 text-sm font-mono block whitespace-pre">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    <Markdown className="prose prose-md max-w-none dark:prose-invert prose-gray text-[15.5px] leading-relaxed" onFileOpen={onFileOpen}>
                      {content}
                    </Markdown>
                  ) : (
                    <div className="whitespace-pre-wrap text-[15.5px] leading-relaxed">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}
            
            {!isGrouped && (
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                {formattedTime}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;

