import type { ChatMessage } from '../types/types';

type PiToolUseEvent = {
  type: 'tool_use';
  toolName?: string;
  toolInput?: unknown;
  toolCallId?: string;
};

type PiToolResultEvent = {
  type: 'tool_result';
  output?: unknown;
  isError?: boolean;
  toolCallId?: string;
};

export type PiToolEvent = PiToolUseEvent | PiToolResultEvent;

export function applyPiToolEvent(
  messages: ChatMessage[],
  event: PiToolEvent,
  timestamp: Date = new Date(),
): ChatMessage[] {
  if (event.type === 'tool_use') {
    return [
      ...messages,
      {
        type: 'assistant',
        content: '',
        timestamp,
        isToolUse: true,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolId: event.toolCallId,
        toolResult: null,
      },
    ];
  }

  let toolIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.isToolUse && message.toolId === event.toolCallId) {
      toolIndex = index;
      break;
    }
  }
  if (toolIndex < 0) {
    return messages;
  }

  const updated = [...messages];
  updated[toolIndex] = {
    ...updated[toolIndex],
    toolResult: {
      content: event.output ?? '',
      isError: event.isError === true,
      timestamp,
    },
  };
  return updated;
}
