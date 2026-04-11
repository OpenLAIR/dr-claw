import CommandMenu from "../../../CommandMenu";
import ClaudeStatus from "../../../ClaudeStatus";
import { MicButton } from "../../../MicButton.jsx";
import ImageAttachment from "./ImageAttachment";
import PermissionRequestsBanner from "./PermissionRequestsBanner";
import ChatInputControls from "./ChatInputControls";
import ReferencePicker from "../../../references/view/ReferencePicker";
import PromptBadgeDropdown from "./PromptBadgeDropdown";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from "react";
import type { CodexReasoningEffortId } from "../../constants/codexReasoningEfforts";
import type { GeminiThinkingModeId } from "../../../../../shared/geminiThinkingSupport";
import type {
  AttachedPrompt,
  PendingPermissionRequest,
  PermissionMode,
  Provider,
  QueuedTurn,
  TokenBudget,
} from "../../types/types";

interface MentionableFile {
  name: string;
  path: string;
}

function getFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: {
      allow?: boolean;
      message?: string;
      rememberEntry?: string | null;
      updatedInput?: unknown;
    },
  ) => void;
  handleGrantToolPermission: (suggestion: {
    entry: string;
    toolName: string;
  }) => { success: boolean };
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  onAbortSession: () => void;
  provider: Provider | string;
  permissionMode: PermissionMode | string;
  onModeSwitch: () => void;
  codexModel: string;
  geminiModel: string;
  thinkingMode: string;
  setThinkingMode: Dispatch<SetStateAction<string>>;
  codexReasoningEffort: CodexReasoningEffortId;
  setCodexReasoningEffort: Dispatch<SetStateAction<CodexReasoningEffortId>>;
  geminiThinkingMode: GeminiThinkingModeId;
  setGeminiThinkingMode: Dispatch<SetStateAction<GeminiThinkingModeId>>;
  tokenBudget: TokenBudget | null;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  onSubmit: (
    event:
      | FormEvent<HTMLFormElement>
      | MouseEvent<HTMLButtonElement>
      | TouchEvent<HTMLButtonElement>,
  ) => void;
  isDragActive: boolean;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (
    command: SlashCommand,
    index: number,
    isHover: boolean,
  ) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openFilePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  isInputFocused?: boolean;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  onTranscript: (text: string) => void;
  projectName?: string;
  onReferenceContext?: (context: string) => void;
  attachedPrompt: AttachedPrompt | null;
  onRemoveAttachedPrompt: () => void;
  onUpdateAttachedPrompt: (promptText: string) => void;
  steerMode: boolean;
  onSteerModeChange: Dispatch<SetStateAction<boolean>>;
  queuedTurns: QueuedTurn[];
  queuePaused: boolean;
  onRemoveQueuedTurn: (turnId: string) => void;
  onPromoteQueuedTurnToSteer: (turnId: string) => void;
  onResumeQueuedTurns: () => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  claudeStatus,
  isLoading,
  onAbortSession,
  provider,
  permissionMode,
  onModeSwitch,
  codexModel,
  geminiModel,
  thinkingMode,
  setThinkingMode,
  codexReasoningEffort,
  setCodexReasoningEffort,
  geminiThinkingMode,
  setGeminiThinkingMode,
  tokenBudget,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  onSubmit,
  isDragActive,
  attachedFiles,
  onRemoveFile,
  uploadingFiles,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openFilePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  isInputFocused,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  onTranscript,
  projectName,
  onReferenceContext,
  attachedPrompt,
  onRemoveAttachedPrompt,
  onUpdateAttachedPrompt,
  steerMode,
  onSteerModeChange,
  queuedTurns,
  queuePaused,
  onRemoveQueuedTurn,
  onPromoteQueuedTurnToSteer,
  onResumeQueuedTurns,
}: ChatComposerProps) {
  const { t } = useTranslation("chat");
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const AnyCommandMenu = CommandMenu as any;
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === "AskUserQuestion",
  );

  // On mobile, when input is focused, float the input box at the bottom
  const mobileFloatingClass = isInputFocused
    ? "max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.15)]"
    : "";
  const disableComposer = isLoading && provider !== "codex";

  return (
    <div
      className={`p-2 sm:p-4 md:p-4 flex-shrink-0 pb-2 sm:pb-4 md:pb-6 ${mobileFloatingClass}`}
    >
      <div className="max-w-5xl mx-auto mb-3">
        <PermissionRequestsBanner
          provider={provider}
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />

        {!hasQuestionPanel && (
          <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
            <ClaudeStatus
              status={claudeStatus}
              isLoading={isLoading}
              onAbort={onAbortSession}
              provider={provider}
            />
            <ChatInputControls
              permissionMode={permissionMode}
              onModeSwitch={onModeSwitch}
              provider={provider}
              codexModel={codexModel}
              geminiModel={geminiModel}
              thinkingMode={thinkingMode}
              setThinkingMode={setThinkingMode}
              codexReasoningEffort={codexReasoningEffort}
              setCodexReasoningEffort={setCodexReasoningEffort}
              geminiThinkingMode={geminiThinkingMode}
              setGeminiThinkingMode={setGeminiThinkingMode}
              tokenBudget={tokenBudget}
              slashCommandsCount={slashCommandsCount}
              onToggleCommandMenu={onToggleCommandMenu}
              hasInput={hasInput}
              onClearInput={onClearInput}
              isUserScrolledUp={isUserScrolledUp}
              hasMessages={hasMessages}
              onScrollToBottom={onScrollToBottom}
            />
          </div>
        )}
      </div>

      {!hasQuestionPanel && (
        <form
          onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void}
          className="relative max-w-5xl mx-auto"
        >
          {provider === "codex" && queuedTurns.length > 0 && (
            <div className="mb-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-foreground">
                  Queued Turns ({queuedTurns.length})
                </div>
                {queuePaused && (
                  <button
                    type="button"
                    onClick={onResumeQueuedTurns}
                    className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Continue Queue
                  </button>
                )}
              </div>
              <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                {queuedTurns.map((turn, index) => (
                  <div
                    key={turn.id}
                    className="flex items-center gap-2 rounded-md bg-background/80 px-2 py-1"
                  >
                    <span className="text-[11px] text-muted-foreground">
                      #{index + 1}
                    </span>
                    <span
                      className={`text-[11px] font-medium ${
                        turn.kind === "steer"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {turn.kind === "steer" ? "STEER" : "QUEUE"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {turn.text}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {turn.status === "paused" ? "paused" : "queued"}
                    </span>
                    {turn.kind !== "steer" && (
                      <button
                        type="button"
                        onClick={() => onPromoteQueuedTurnToSteer(turn.id)}
                        className="rounded-md px-1.5 py-0.5 text-[11px] text-amber-700 hover:bg-amber-500/10 transition-colors"
                        title="Convert queued turn to steer"
                      >
                        Steer
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveQueuedTurn(turn.id)}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-500/10 transition-colors"
                      title="Remove queued turn"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isDragActive && (
            <div className="absolute inset-0 bg-primary/15 border-2 border-dashed border-primary/50 rounded-2xl flex items-center justify-center z-50">
              <div className="bg-card rounded-xl p-4 shadow-lg border border-border/30">
                <svg
                  className="w-8 h-8 text-primary mx-auto mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">
                  {t("input.dropFilesHere")}
                </p>
              </div>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="mb-2 p-2 bg-muted/40 rounded-xl">
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <ImageAttachment
                    key={index}
                    file={file}
                    onRemove={() => onRemoveFile(index)}
                    uploadProgress={uploadingFiles.get(getFileKey(file))}
                  />
                ))}
              </div>
            </div>
          )}

          {fileErrors.size > 0 && (
            <div className="mb-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-600">
              {[...new Set(fileErrors.values())].map((error) => (
                <div key={error} className="truncate">
                  {error}
                </div>
              ))}
            </div>
          )}

          {showFileDropdown && filteredFiles.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
              {filteredFiles.map((file, index) => (
                <div
                  key={file.path}
                  className={`px-4 py-3 cursor-pointer border-b border-border/30 last:border-b-0 touch-manipulation ${
                    index === selectedFileIndex
                      ? "bg-primary/8 text-primary"
                      : "hover:bg-accent/50 text-foreground"
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectFile(file);
                  }}
                >
                  <div className="font-medium text-sm">{file.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {file.path}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showReferencePicker && projectName && onReferenceContext && (
            <ReferencePicker
              projectName={projectName}
              onSelect={(context) => {
                onReferenceContext?.(context);
              }}
              onClose={() => setShowReferencePicker(false)}
            />
          )}

          <AnyCommandMenu
            commands={filteredCommands}
            selectedIndex={selectedCommandIndex}
            onSelect={onCommandSelect}
            onClose={onCloseCommandMenu}
            position={commandMenuPosition}
            isOpen={isCommandMenuOpen}
            frequentCommands={frequentCommands}
          />

          <div
            {...getRootProps()}
            className={`relative bg-card/80 backdrop-blur-sm rounded-2xl shadow-sm border border-border/50 focus-within:shadow-md focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/15 transition-all duration-200 overflow-hidden ${
              isTextareaExpanded ? "chat-input-expanded" : ""
            }`}
          >
            <input {...getInputProps()} />
            {attachedPrompt && (
              <PromptBadgeDropdown
                prompt={attachedPrompt}
                onRemove={onRemoveAttachedPrompt}
                onUpdate={onUpdateAttachedPrompt}
              />
            )}
            <div
              ref={inputHighlightRef}
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
            >
              <div
                className={`chat-input-placeholder block w-full ${projectName ? "pl-[5.5rem]" : "pl-12"} pr-20 sm:pr-40 py-1.5 sm:py-4 text-transparent text-base leading-6 whitespace-pre-wrap break-words`}
              >
                {renderInputWithMentions(input)}
              </div>
            </div>

            <div className="relative z-10">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={onInputChange}
                onClick={onTextareaClick}
                onKeyDown={onTextareaKeyDown}
                onPaste={onTextareaPaste}
                onScroll={(event) =>
                  onTextareaScrollSync(event.target as HTMLTextAreaElement)
                }
                onFocus={() => onInputFocusChange?.(true)}
                onBlur={() => onInputFocusChange?.(false)}
                onInput={onTextareaInput}
                placeholder={placeholder}
                disabled={disableComposer}
                className={`chat-input-placeholder block w-full ${projectName ? "pl-[5.5rem]" : "pl-12"} pr-20 sm:pr-40 py-1.5 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-foreground placeholder-muted-foreground/50 disabled:opacity-50 resize-none min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-base leading-6 transition-all duration-200`}
                style={{ height: "50px" }}
              />

              <div className="absolute left-1 top-1/2 transform -translate-y-1/2 flex items-center">
                <button
                  type="button"
                  onClick={openFilePicker}
                  className="p-2 hover:bg-accent/60 rounded-xl transition-colors"
                  title={t("input.attachFiles")}
                >
                  <svg
                    className="w-5 h-5 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                </button>
                {projectName && onReferenceContext && (
                  <button
                    type="button"
                    onClick={() => setShowReferencePicker(!showReferencePicker)}
                    className="p-2 hover:bg-accent/60 rounded-xl transition-colors"
                    title={t("input.attachReferences")}
                  >
                    <svg
                      className="w-5 h-5 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <div className="absolute right-14 top-1/2 transform -translate-y-1/2">
                <MicButton onTranscript={onTranscript} className="!w-9 !h-9" />
              </div>

              {provider === "codex" && (
                <button
                  type="button"
                  onClick={() => onSteerModeChange((previous) => !previous)}
                  className={`absolute right-24 top-1/2 transform -translate-y-1/2 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                    steerMode
                      ? "bg-amber-500 text-amber-950 hover:bg-amber-400"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  title="Toggle steer mode for high-priority queued instruction"
                >
                  Steer
                </button>
              )}

              <button
                type="submit"
                disabled={
                  (!input.trim() &&
                    attachedFiles.length === 0 &&
                    !attachedPrompt) ||
                  disableComposer
                }
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSubmit(event);
                }}
                onTouchStart={(event) => {
                  event.preventDefault();
                  onSubmit(event);
                }}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-1 focus:ring-offset-background"
              >
                <svg
                  className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-primary-foreground transform rotate-90"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>

              <div
                className={`absolute bottom-1 ${projectName ? "left-[5.5rem]" : "left-12"} right-14 sm:right-40 text-xs text-muted-foreground/50 pointer-events-none hidden sm:block transition-opacity duration-200 ${
                  input.trim() ? "opacity-0" : "opacity-100"
                }`}
              >
                {sendByCtrlEnter
                  ? t("input.hintText.ctrlEnter")
                  : t("input.hintText.enter")}
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
