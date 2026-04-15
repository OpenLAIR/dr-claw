import type { AttachedPrompt, ChatMessage } from '../types/types';

export interface MessageDraft {
  content: string;
  attachedPrompt: AttachedPrompt | null;
}

const toOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const createChatMessageId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).substring(2, 15);
};

export const getChatMessageId = (message: Pick<ChatMessage, 'messageId' | 'id'>): string | null => {
  return toOptionalString(message.messageId) ?? toOptionalString(message.id);
};

export const getMessageReplayContent = (
  message: Pick<ChatMessage, 'content' | 'submittedContent'>,
): string => {
  if (typeof message.submittedContent === 'string') {
    return message.submittedContent;
  }

  return typeof message.content === 'string' ? message.content : '';
};

export const buildReplayMessageDraft = (
  message: Pick<ChatMessage, 'content' | 'submittedContent' | 'attachedPrompt'>,
): MessageDraft | null => {
  const hasSubmittedContent =
    typeof message.submittedContent === 'string' && message.submittedContent.trim().length > 0;
  const content: string = hasSubmittedContent
    ? message.submittedContent!
    : typeof message.content === 'string'
    ? message.content
    : '';

  if (!content.trim() && !message.attachedPrompt) {
    return null;
  }

  return {
    content,
    attachedPrompt: hasSubmittedContent ? null : message.attachedPrompt ?? null,
  };
};

export const buildEditableMessageDraft = (
  message: Pick<ChatMessage, 'content' | 'submittedContent' | 'attachedPrompt'>,
): MessageDraft | null => {
  const content: string =
    typeof message.content === 'string'
      ? message.content
      : getMessageReplayContent(message);

  if (!content.trim() && !message.attachedPrompt) {
    return null;
  }

  return {
    content,
    attachedPrompt: message.attachedPrompt ?? null,
  };
};

export const isShellEditableUserMessage = (
  message: Pick<ChatMessage, 'type' | 'isSkillContent' | 'isSuperseded' | 'content' | 'submittedContent' | 'attachedPrompt'>,
): boolean => {
  if (message.type !== 'user' || message.isSkillContent || message.isSuperseded) {
    return false;
  }

  return buildEditableMessageDraft(message) !== null;
};

export const findLatestEditableUserMessage = (
  messages: ChatMessage[],
  hasSelectedSession: boolean,
): ChatMessage | null => {
  if (!hasSelectedSession) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isShellEditableUserMessage(messages[index])) {
      return messages[index];
    }
  }

  return null;
};

const buildAttachmentReplayNote = (
  message: Pick<ChatMessage, 'attachments'>,
): string => {
  const attachmentPaths = Array.isArray(message.attachments)
    ? message.attachments
        .map((attachment) =>
          typeof attachment.path === 'string' && attachment.path.trim().length > 0
            ? attachment.path
            : null,
        )
        .filter((path): path is string => Boolean(path))
    : [];

  if (attachmentPaths.length === 0) {
    return '';
  }

  return `[Files available at the following paths]\n${attachmentPaths
    .map((path, index) => `${index + 1}. ${path}`)
    .join('\n')}`;
};

const backfillSubmittedContent = (message: ChatMessage): string | null => {
  if (typeof message.submittedContent === 'string') {
    return message.submittedContent;
  }

  if (message.type !== 'user') {
    return null;
  }

  const promptPrefix =
    message.attachedPrompt && typeof message.attachedPrompt.promptText === 'string'
      ? message.attachedPrompt.promptText
      : '';
  const visibleContent = typeof message.content === 'string' ? message.content : '';
  const attachmentNote = buildAttachmentReplayNote(message);
  const prefixedContent = promptPrefix
    ? visibleContent.trim()
      ? `${promptPrefix}\n\n${visibleContent}`
      : promptPrefix
    : visibleContent;

  if (prefixedContent && attachmentNote) {
    return `${prefixedContent}\n\n${attachmentNote}`;
  }

  return prefixedContent || attachmentNote || null;
};

export const hydrateStoredChatMessages = (messages: ChatMessage[]): ChatMessage[] => {
  let hasChanges = false;

  const hydratedMessages = messages.map((message) => {
    let nextMessage = message;

    const backfilledSubmittedContent = backfillSubmittedContent(message);
    if (backfilledSubmittedContent !== null && backfilledSubmittedContent !== message.submittedContent) {
      nextMessage = {
        ...nextMessage,
        submittedContent: backfilledSubmittedContent,
      };
      hasChanges = true;
    }

    if (!getChatMessageId(nextMessage)) {
      nextMessage = {
        ...nextMessage,
        messageId: createChatMessageId(),
      };
      hasChanges = true;
    }

    return nextMessage;
  });

  return hasChanges ? hydratedMessages : messages;
};

export const applyEditedMessageToHistory = (
  messages: ChatMessage[],
  nextMessage: ChatMessage,
  editedMessageId: string | null,
): ChatMessage[] => {
  if (!editedMessageId) {
    return [...messages, nextMessage];
  }

  const replacementMessageId = getChatMessageId(nextMessage);
  let foundEditedSource = false;

  const updatedMessages = messages.map((message) => {
    if (getChatMessageId(message) !== editedMessageId) {
      return message;
    }

    foundEditedSource = true;
    return {
      ...message,
      isSuperseded: true,
      supersededByMessageId: replacementMessageId ?? undefined,
    };
  });

  return foundEditedSource ? [...updatedMessages, nextMessage] : [...messages, nextMessage];
};
