import { describe, expect, it } from 'vitest';

import type { AttachedPrompt, ChatMessage } from '../../types/types';
import {
  applyEditedMessageToHistory,
  buildReplayMessageDraft,
  findLatestEditableUserMessage,
  hydrateStoredChatMessages,
} from '../chatMessages';

const attachedPrompt: AttachedPrompt = {
  scenarioId: 'draft-review',
  scenarioIcon: 'P',
  scenarioTitle: 'Review a draft',
  promptText: 'Please review the attached draft before responding.',
};

describe('buildReplayMessageDraft', () => {
  it('round-trips submittedContent without duplicating attached prompt metadata', () => {
    const message: ChatMessage = {
      type: 'user',
      content: 'Summarize this draft.',
      submittedContent: `${attachedPrompt.promptText}\n\nSummarize this draft.`,
      attachedPrompt,
      timestamp: 0,
    };

    expect(buildReplayMessageDraft(message)).toEqual({
      content: `${attachedPrompt.promptText}\n\nSummarize this draft.`,
      attachedPrompt: null,
    });
  });
});

describe('hydrateStoredChatMessages', () => {
  it('backfills submittedContent and message ids for older stored user messages', () => {
    const hydrated = hydrateStoredChatMessages([
      {
        type: 'user',
        content: 'Continue from the saved draft.',
        attachedPrompt,
        attachments: [
          {
            name: 'draft.md',
            kind: 'file',
            path: '.dr-claw/chat-attachments/draft.md',
          },
        ],
        timestamp: 0,
      },
      {
        type: 'assistant',
        content: 'Ready when you are.',
        timestamp: 1,
      },
    ] as ChatMessage[]);

    expect(hydrated[0].submittedContent).toBe(
      'Please review the attached draft before responding.\n\nContinue from the saved draft.\n\n[Files available at the following paths]\n1. .dr-claw/chat-attachments/draft.md',
    );
    expect(hydrated[0].messageId).toBeTruthy();
    expect(hydrated[1].messageId).toBeTruthy();
  });
});

describe('applyEditedMessageToHistory', () => {
  it('marks the original user message as superseded and appends the edited version', () => {
    const originalMessage: ChatMessage = {
      type: 'user',
      messageId: 'message-original',
      content: 'Initial question',
      submittedContent: 'Initial question',
      timestamp: 0,
    };
    const editedMessage: ChatMessage = {
      type: 'user',
      messageId: 'message-edited',
      content: 'Updated question',
      submittedContent: 'Updated question',
      editedFromMessageId: 'message-original',
      timestamp: 1,
    };

    const updatedMessages = applyEditedMessageToHistory(
      [originalMessage],
      editedMessage,
      'message-original',
    );

    expect(updatedMessages).toHaveLength(2);
    expect(updatedMessages[0]).toMatchObject({
      messageId: 'message-original',
      isSuperseded: true,
      supersededByMessageId: 'message-edited',
    });
    expect(updatedMessages[1]).toEqual(editedMessage);
  });
});

describe('findLatestEditableUserMessage', () => {
  it('returns the latest non-superseded user message for shell history handoff', () => {
    const latestEditable = findLatestEditableUserMessage(
      [
        {
          type: 'user',
          messageId: 'message-1',
          content: 'Original question',
          submittedContent: 'Original question',
          timestamp: 0,
          isSuperseded: true,
        },
        {
          type: 'assistant',
          content: 'Answer',
          timestamp: 1,
        },
        {
          type: 'user',
          messageId: 'message-2',
          content: 'Edited question',
          submittedContent: 'Edited question',
          timestamp: 2,
        },
      ] as ChatMessage[],
      true,
    );

    expect(latestEditable?.messageId).toBe('message-2');
  });

  it('returns null when there is no selected session to continue in shell', () => {
    const latestEditable = findLatestEditableUserMessage(
      [
        {
          type: 'user',
          messageId: 'message-1',
          content: 'Question',
          submittedContent: 'Question',
          timestamp: 0,
        },
      ] as ChatMessage[],
      false,
    );

    expect(latestEditable).toBeNull();
  });
});
