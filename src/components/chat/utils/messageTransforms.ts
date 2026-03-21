import type { ChatMessage } from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection } from './chatFormatting';

export interface DiffLine {
  type: 'added' | 'removed';
  content: string;
  lineNum: number;
}

export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];

type CursorBlob = {
  id?: string;
  sequence?: number;
  rowid?: number;
  content?: any;
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/**
 * Parse answers from AskUserQuestion tool_result content.
 * Format: 'User has answered your questions: "q1"="a1", "q2"="a2". You can now...'
 */
export const parseAskUserAnswers = (resultContent: string): Record<string, string> | null => {
  if (!resultContent || !resultContent.includes('User has answered your questions:')) {
    return null;
  }
  const answers: Record<string, string> = {};
  // Match "question"="answer" pairs
  const regex = /"([^"]+)"="([^"]+)"/g;
  let match;
  while ((match = regex.exec(resultContent)) !== null) {
    answers[match[1]] = match[2];
  }
  return Object.keys(answers).length > 0 ? answers : null;
};

/**
 * Merge parsed answers into a toolInput string (JSON) for AskUserQuestion.
 */
export const mergeAnswersIntoToolInput = (toolInput: string, answers: Record<string, string>): string => {
  try {
    const parsed = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput;
    return JSON.stringify({ ...parsed, answers }, null, 2);
  } catch {
    return toolInput;
  }
};

const normalizeToolInput = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const stripInternalContextPrefix = (value: string): string => {
  if (typeof value !== 'string') return '';
  let cleaned = value;
  
  // 1. Match full [Context: ...] prefixes at the start of the string, including multiple ones
  const fullPrefixPattern = /^\s*\[Context:[^\]]*\]\s*/i;
  while (fullPrefixPattern.test(cleaned)) {
    cleaned = cleaned.replace(fullPrefixPattern, '');
  }
  
  // 2. Match common truncated prefixes like "[Context: session-mode=..." or "[Context: Tre..."
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    return 'New Session';
  }

  return cleaned.trim();
};

const toAbsolutePath = (projectPath: string, filePath?: string) => {
  if (!filePath) {
    return filePath;
  }
  return filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
};

export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = (oldStr ?? '').split('\n');
  const newLines = (newStr ?? '').split('\n');

  // Use LCS alignment so insertions/deletions don't cascade into a full-file "changed" diff.
  const lcsTable: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lcsTable[oldIndex][newIndex] = lcsTable[oldIndex + 1][newIndex + 1] + 1;
      } else {
        lcsTable[oldIndex][newIndex] = Math.max(
          lcsTable[oldIndex + 1][newIndex],
          lcsTable[oldIndex][newIndex + 1],
        );
      }
    }
  }

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldLine === newLine) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (lcsTable[oldIndex + 1][newIndex] >= lcsTable[oldIndex][newIndex + 1]) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex += 1;
      continue;
    }

    diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    diffLines.push({ type: 'removed', content: oldLines[oldIndex], lineNum: oldIndex + 1 });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    diffLines.push({ type: 'added', content: newLines[newIndex], lineNum: newIndex + 1 });
    newIndex += 1;
  }

  return diffLines;
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const cache = new Map<string, DiffLine[]>();

  return (oldStr: string, newStr: string) => {
    const key = JSON.stringify([oldStr, newStr]);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const calculated = calculateDiff(oldStr, newStr);
    cache.set(key, calculated);
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }
    return calculated;
  };
};

export const convertCursorSessionMessages = (blobs: CursorBlob[], projectPath: string): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolUseMap: Record<string, ChatMessage> = {};

  for (let blobIdx = 0; blobIdx < blobs.length; blobIdx += 1) {
    const blob = blobs[blobIdx];
    const content = blob.content;
    let text = '';
    let role: ChatMessage['type'] = 'assistant';
    let reasoningText: string | null = null;

    try {
      if (content?.role && content?.content) {
        if (content.role === 'system') {
          continue;
        }

        if (content.role === 'tool') {
          const toolItems = asArray<any>(content.content);
          for (const item of toolItems) {
            if (item?.type !== 'tool-result') {
              continue;
            }

            const toolName = item.toolName === 'ApplyPatch' ? 'Edit' : item.toolName || 'Unknown Tool';
            const toolCallId = item.toolCallId || content.id;
            const result = item.result || '';

            if (toolCallId && toolUseMap[toolCallId]) {
              toolUseMap[toolCallId].toolResult = {
                content: result,
                isError: false,
              };
            } else {
              converted.push({
                type: 'assistant',
                content: '',
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
                isToolUse: true,
                toolName,
                toolId: toolCallId,
                toolInput: normalizeToolInput(null),
                toolResult: {
                  content: result,
                  isError: false,
                },
              });
            }
          }
          continue;
        }

        role = content.role === 'user' ? 'user' : 'assistant';

        if (Array.isArray(content.content)) {
          const textParts: string[] = [];

          for (const part of content.content) {
            if (part?.type === 'text' && part?.text) {
              textParts.push(decodeHtmlEntities(part.text));
              continue;
            }

            if (part?.type === 'reasoning' && part?.text) {
              reasoningText = decodeHtmlEntities(part.text);
              continue;
            }

            if (part?.type === 'tool-call' || part?.type === 'tool_use') {
              if (textParts.length > 0 || reasoningText) {
                converted.push({
                  type: role,
                  content: textParts.join('\n'),
                  reasoning: reasoningText ?? undefined,
                  timestamp: new Date(Date.now() + blobIdx * 1000),
                  blobId: blob.id,
                  sequence: blob.sequence,
                  rowid: blob.rowid,
                });
                textParts.length = 0;
                reasoningText = null;
              }

              const toolNameRaw = part.toolName || part.name || 'Unknown Tool';
              const toolName = toolNameRaw === 'ApplyPatch' ? 'Edit' : toolNameRaw;
              const toolId = part.toolCallId || part.id || `tool_${blobIdx}`;
              let toolInput = part.args || part.input;

              if (toolName === 'Edit' && part.args) {
                if (part.args.patch) {
                  const patchLines = String(part.args.patch).split('\n');
                  const oldLines: string[] = [];
                  const newLines: string[] = [];
                  let inPatch = false;

                  patchLines.forEach((line) => {
                    if (line.startsWith('@@')) {
                      inPatch = true;
                      return;
                    }
                    if (!inPatch) {
                      return;
                    }

                    if (line.startsWith('-')) {
                      oldLines.push(line.slice(1));
                    } else if (line.startsWith('+')) {
                      newLines.push(line.slice(1));
                    } else if (line.startsWith(' ')) {
                      oldLines.push(line.slice(1));
                      newLines.push(line.slice(1));
                    }
                  });

                  toolInput = {
                    file_path: toAbsolutePath(projectPath, part.args.file_path),
                    old_string: oldLines.join('\n') || part.args.patch,
                    new_string: newLines.join('\n') || part.args.patch,
                  };
                } else {
                  toolInput = part.args;
                }
              } else if (toolName === 'Read' && part.args) {
                const filePath = part.args.path || part.args.file_path;
                toolInput = {
                  file_path: toAbsolutePath(projectPath, filePath),
                };
              } else if (toolName === 'Write' && part.args) {
                const filePath = part.args.path || part.args.file_path;
                toolInput = {
                  file_path: toAbsolutePath(projectPath, filePath),
                  content: part.args.contents || part.args.content,
                };
              }

              const toolMessage: ChatMessage = {
                type: 'assistant',
                content: '',
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
                isToolUse: true,
                toolName,
                toolId,
                toolInput: normalizeToolInput(toolInput),
                toolResult: null,
              };
              converted.push(toolMessage);
              toolUseMap[toolId] = toolMessage;
              continue;
            }

            if (typeof part === 'string') {
              textParts.push(part);
            }
          }

          if (textParts.length > 0) {
            text = textParts.join('\n');
            if (reasoningText && !text) {
              converted.push({
                type: role,
                content: '',
                reasoning: reasoningText,
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
              });
              text = '';
            }
          } else {
            text = '';
          }
        } else if (typeof content.content === 'string') {
          text = content.content;
        }
      } else if (content?.message?.role && content?.message?.content) {
        if (content.message.role === 'system') {
          continue;
        }

        role = content.message.role === 'user' ? 'user' : 'assistant';
        if (Array.isArray(content.message.content)) {
          text = content.message.content
            .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
            .filter(Boolean)
            .join('\n');
        } else if (typeof content.message.content === 'string') {
          text = content.message.content;
        }
      }
    } catch (error) {
      console.log('Error parsing blob content:', error);
    }

    if (text && text.trim()) {
      const message: ChatMessage = {
        type: role,
        content: text,
        timestamp: new Date(Date.now() + blobIdx * 1000),
        blobId: blob.id,
        sequence: blob.sequence,
        rowid: blob.rowid,
      };
      if (reasoningText) {
        message.reasoning = reasoningText;
      }
      converted.push(message);
    }
  }

  converted.sort((messageA, messageB) => {
    if (messageA.sequence !== undefined && messageB.sequence !== undefined) {
      return Number(messageA.sequence) - Number(messageB.sequence);
    }
    if (messageA.rowid !== undefined && messageB.rowid !== undefined) {
      return Number(messageA.rowid) - Number(messageB.rowid);
    }
    return new Date(messageA.timestamp).getTime() - new Date(messageB.timestamp).getTime();
  });

  return converted;
};

export const convertSessionMessages = (rawMessages: any[]): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolResults = new Map<
    string,
    { content: unknown; isError: boolean; timestamp: Date; toolUseResult: unknown; subagentTools?: unknown[] }
  >();

  // Normalized helper to handle both Claude (nested) and Gemini (flat) formats
  const getRole = (msg: any) => msg.role || msg.message?.role;
  const getContent = (msg: any) => msg.content || msg.message?.content;
  const findSubagentContainer = (parentToolUseId: string) => {
    for (let index = converted.length - 1; index >= 0; index -= 1) {
      const candidate = converted[index];
      if (!candidate.isSubagentContainer) continue;
      if (candidate.toolId === parentToolUseId || candidate.toolCallId === parentToolUseId) {
        return candidate;
      }
    }
    return null;
  };

  rawMessages.forEach((message) => {
    const role = getRole(message);
    const content = getContent(message);

    if (role === 'user' && Array.isArray(content)) {
      content.forEach((part: any) => {
        if (part.type !== 'tool_result') {
          return;
        }
        toolResults.set(part.tool_use_id, {
          content: part.content,
          isError: Boolean(part.is_error),
          timestamp: new Date(message.timestamp || Date.now()),
          toolUseResult: message.toolUseResult || null,
          subagentTools: message.subagentTools,
        });
      });
    }
  });

  rawMessages.forEach((message) => {
    const role = getRole(message);
    let content = getContent(message);

    if (role === 'user' && content) {
      let text = '';
      if (Array.isArray(content)) {
        const textParts: string[] = [];
        content.forEach((part: any) => {
          if (part.type === 'text') {
            textParts.push(decodeHtmlEntities(part.text));
          }
        });
        text = textParts.join('\n');
      } else if (typeof content === 'string') {
        text = decodeHtmlEntities(content);
      } else {
        text = decodeHtmlEntities(String(content));
      }
      text = stripInternalContextPrefix(text);

      // Check if this user message also contains tool_result parts
      const hasToolResults = Array.isArray(content) &&
        content.some((part: any) => part.type === 'tool_result');

      const shouldSkip =
        !text ||
        text.startsWith('<system-reminder>') ||
        text.startsWith('Caveat:') ||
        text.startsWith('This session is being continued from a previous') ||
        text.startsWith('[Request interrupted');

      if (shouldSkip) {
        return;
      }

      // Detect skill/command content
      const isSkillRelated =
        text.startsWith('<command-name>') ||
        text.startsWith('<command-message>') ||
        text.startsWith('<command-args>') ||
        text.startsWith('<local-command-stdout>') ||
        text.includes('Base directory for this skill:') ||
        (hasToolResults && !text.startsWith('<system-reminder>'));

      // Parse <task-notification> blocks
      const taskNotifRegex = /<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g;
      const taskNotifMatch = taskNotifRegex.exec(text);
      if (taskNotifMatch) {
        const status = taskNotifMatch[1]?.trim() || 'completed';
        const summary = taskNotifMatch[2]?.trim() || 'Background task finished';
        converted.push({
          type: 'assistant',
          content: summary,
          timestamp: message.timestamp || new Date().toISOString(),
          isTaskNotification: true,
          taskStatus: status,
        });
      } else if (isSkillRelated) {
        const last = converted[converted.length - 1];
        if (last?.type === 'user' && String(last.content || '') === unescapeWithMathProtection(text)) {
          return;
        }
        converted.push({
          type: 'user',
          content: unescapeWithMathProtection(text),
          timestamp: message.timestamp || new Date().toISOString(),
          isSkillContent: true,
        });
      } else {
        const last = converted[converted.length - 1];
        if (last?.type === 'user' && String(last.content || '') === unescapeWithMathProtection(text)) {
          return;
        }
        converted.push({
          type: 'user',
          content: unescapeWithMathProtection(text),
          timestamp: message.timestamp || new Date().toISOString(),
        });
      }
      return;
    }

    if (message.type === 'thinking' && content) {
      converted.push({
        type: 'assistant',
        content: unescapeWithMathProtection(typeof content === 'string' ? content : JSON.stringify(content)),
        timestamp: message.timestamp || new Date().toISOString(),
        isThinking: true,
      });
      return;
    }

    if (message.type === 'tool_use' && message.toolName) {
      const parentToolUseId = message.parentToolUseId || message.parent_tool_use_id;
      const toolCallId = message.toolCallId || message.toolId;
      if (parentToolUseId) {
        const parent = findSubagentContainer(String(parentToolUseId));
        if (parent) {
          const existingChildren = parent.subagentState?.childTools || [];
          parent.subagentState = {
            childTools: [
              ...existingChildren,
              {
                toolId: String(toolCallId || `tool_${existingChildren.length + 1}`),
                toolName: message.toolName,
                toolInput: normalizeToolInput(message.toolInput),
                toolResult: null,
                timestamp: new Date(message.timestamp || Date.now()),
              },
            ],
            currentToolIndex: existingChildren.length,
            isComplete: false,
          };
          return;
        }
      }

      converted.push({
        type: 'assistant',
        content: '',
        timestamp: message.timestamp || new Date().toISOString(),
        isToolUse: true,
        toolName: message.toolName,
        toolInput: normalizeToolInput(message.toolInput),
        toolId: toolCallId,
        toolCallId: toolCallId,
      });
      return;
    }

    if (message.type === 'tool_result') {
      const parentToolUseId = message.parentToolUseId || message.parent_tool_use_id;
      if (parentToolUseId && message.toolCallId) {
        const parent = findSubagentContainer(String(parentToolUseId));
        if (parent?.subagentState?.childTools) {
          const updatedChildren = parent.subagentState.childTools.map((child) => {
            if (child.toolId !== message.toolCallId) return child;
            return {
              ...child,
              toolResult: {
                content: message.output || '',
                isError: false,
              },
            };
          });
          parent.subagentState = {
            ...parent.subagentState,
            childTools: updatedChildren,
            currentToolIndex: Math.max(parent.subagentState.currentToolIndex, updatedChildren.length - 1),
            isComplete: updatedChildren.every((child) => Boolean(child.toolResult)),
          };
          return;
        }
      }

      for (let index = converted.length - 1; index >= 0; index -= 1) {
        const convertedMessage = converted[index];
        if (!convertedMessage.isToolUse || convertedMessage.toolResult) {
          continue;
        }
        if (!message.toolCallId || convertedMessage.toolCallId === message.toolCallId) {
          convertedMessage.toolResult = {
            content: message.output || '',
            isError: false,
          };
          if (convertedMessage.toolName === 'AskUserQuestion' && message.output) {
            const parsedAnswers = parseAskUserAnswers(String(message.output));
            if (parsedAnswers) {
              convertedMessage.toolInput = mergeAnswersIntoToolInput(
                convertedMessage.toolInput as string,
                parsedAnswers,
              );
            }
          }
          break;
        }
      }
      return;
    }

    if (role === 'assistant' && content) {
      if (Array.isArray(content)) {
        content.forEach((part: any) => {
          if (part.type === 'thinking' || part.type === 'reasoning') {
            const thinkingText = part.thinking || part.reasoning || part.text || '';
            if (thinkingText.trim()) {
              converted.push({
                type: 'assistant',
                content: unescapeWithMathProtection(thinkingText),
                timestamp: message.timestamp || new Date().toISOString(),
                isThinking: true,
              });
            }
            return;
          }

          if (part.type === 'text') {
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            converted.push({
              type: 'assistant',
              content: text,
              timestamp: message.timestamp || new Date().toISOString(),
            });
            return;
          }

          if (part.type === 'tool_use') {
            const toolResult = toolResults.get(part.id);
            const isSubagentContainer = part.name === 'Task';

            const childTools: import('../types/types').SubagentChildTool[] = [];
            if (isSubagentContainer && toolResult?.subagentTools && Array.isArray(toolResult.subagentTools)) {
              for (const tool of toolResult.subagentTools as any[]) {
                childTools.push({
                  toolId: tool.toolId,
                  toolName: tool.toolName,
                  toolInput: tool.toolInput,
                  toolResult: tool.toolResult || null,
                  timestamp: new Date(tool.timestamp || Date.now()),
                });
              }
            }

            let finalToolInput = normalizeToolInput(part.input);
            if (part.name === 'AskUserQuestion' && toolResult) {
              const resultStr = typeof toolResult.content === 'string'
                ? toolResult.content
                : JSON.stringify(toolResult.content);
              const parsedAnswers = parseAskUserAnswers(resultStr);
              if (parsedAnswers) {
                finalToolInput = mergeAnswersIntoToolInput(finalToolInput, parsedAnswers);
              }
            }

            converted.push({
              type: 'assistant',
              content: '',
              timestamp: message.timestamp || new Date().toISOString(),
              isToolUse: true,
              toolName: part.name,
              toolInput: finalToolInput,
              toolId: part.id,
              toolResult: toolResult
                ? {
                    content:
                      typeof toolResult.content === 'string'
                        ? toolResult.content
                        : JSON.stringify(toolResult.content),
                    isError: toolResult.isError,
                    toolUseResult: toolResult.toolUseResult,
                  }
                : null,
              toolError: toolResult?.isError || false,
              toolResultTimestamp: toolResult?.timestamp || new Date(),
              isSubagentContainer,
              subagentState: isSubagentContainer
                ? {
                    childTools,
                    currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                    isComplete: Boolean(toolResult),
                  }
                : undefined,
            });
          }
        });
        return;
      }

      if (typeof content === 'string') {
        converted.push({
          type: 'assistant',
          content: unescapeWithMathProtection(content),
          timestamp: message.timestamp || new Date().toISOString(),
        });
      }
    }
  });

  return converted;
};
