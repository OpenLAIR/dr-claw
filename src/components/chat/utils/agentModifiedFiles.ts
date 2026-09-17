/**
 * Extract the set of files an agent turn modified via Edit/Write/ApplyPatch
 * tool calls.  Used by the "Revert agent changes" button so the backend only
 * touches files this specific interaction created or edited.
 *
 * `message.toolInput` is often a JSON string (see messageTransforms.ts
 * normalizeToolInput) rather than an object, and patch tools may carry
 * multi-file `file_paths` / `paths` arrays — the extractor handles both.
 */

import type { ChatMessage } from '../types/types';
import type { AgentTurnItem } from './groupAgentTurns';

const FILE_MODIFYING_TOOLS = new Set([
  'Edit',
  'Write',
  'ApplyPatch',
  'MultiEdit',
  'write_file',
  'replace',
  // Codex normalizes patch-apply events into a synthetic 'FileChanges' tool
  // whose toolInput is a newline-separated string of "kind: path" lines
  // (see server/utils/codexSessionMessages.js toFileChangesToolInput).
  'FileChanges',
]);

interface ToolResultLike {
  isError?: boolean;
  content?: unknown;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

function parseJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function addPath(raw: unknown, seen: Set<string>, out: string[]): void {
  if (typeof raw !== 'string') return;
  const trimmed = raw.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  out.push(trimmed);
}

/** Parse Codex's newline-delimited "kind: path" FileChanges payload. */
function parseFileChangesString(raw: string, seen: Set<string>, out: string[]): void {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep === -1) continue;
    addPath(trimmed.slice(sep + 1).trim(), seen, out);
  }
}

function collectPathsFromValue(value: unknown, seen: Set<string>, out: string[]): void {
  if (value === null || value === undefined) return;

  // Handle Codex's raw "kind: path\nkind: path" string shape.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Try JSON first; fall back to kind:path line parsing.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = parseJson(trimmed);
      if (parsed) collectPathsFromValue(parsed, seen, out);
      return;
    }
    parseFileChangesString(trimmed, seen, out);
    return;
  }

  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;

  const scalarKeys = ['file_path', 'path', 'filePath', 'absolutePath', 'relativePath'];
  for (const key of scalarKeys) {
    addPath(record[key], seen, out);
  }

  const arrayKeys = ['file_paths', 'paths'];
  for (const key of arrayKeys) {
    const list = record[key];
    if (Array.isArray(list)) {
      for (const v of list) addPath(v, seen, out);
    }
  }

  // `changes` / `FileChanges` / `fileChanges` can be either:
  //   - an array of { file_path: ... } entries (Claude-style)
  //   - an object map { "src/a.ts": {type: "update"}, "src/b.ts": {...} }
  //     (Codex patch-apply payload — keys are the paths)
  const changeKeys = ['changes', 'FileChanges', 'fileChanges'];
  for (const key of changeKeys) {
    const sub = record[key];
    if (Array.isArray(sub)) {
      for (const entry of sub) {
        if (entry && typeof entry === 'object') {
          collectPathsFromValue(entry, seen, out);
        } else if (typeof entry === 'string') {
          addPath(entry, seen, out);
        }
      }
    } else if (sub && typeof sub === 'object') {
      for (const pathKey of Object.keys(sub)) {
        addPath(pathKey, seen, out);
      }
    }
  }
}

function isToolCallReverted(result?: ToolResultLike | null): boolean {
  if (!result) return true; // no result yet = not committed, skip
  if (result.isError) return true;
  return false;
}

/**
 * Return the deduplicated list of file paths a turn modified, in the order
 * they first appear.  Tool calls that errored out or have no result are
 * skipped — they never actually changed the filesystem.
 */
export function getAgentModifiedFiles(turn: AgentTurnItem): string[] {
  const seen = new Set<string>();
  const files: string[] = [];

  const collect = (
    toolName: string | undefined,
    toolInput: unknown,
    toolResult?: ToolResultLike | null,
  ) => {
    if (!toolName || !FILE_MODIFYING_TOOLS.has(toolName)) return;
    if (isToolCallReverted(toolResult)) return;

    collectPathsFromValue(toolInput, seen, files);

    // Some patch flows only populate file paths in the result payload.
    if (toolResult) {
      collectPathsFromValue(toolResult.content, seen, files);
      collectPathsFromValue(toolResult.toolUseResult, seen, files);
    }
  };

  for (const message of turn.allMessages) {
    if (message.isToolUse) {
      collect(message.toolName, message.toolInput, message.toolResult);
    }
    if (message.isSubagentContainer && message.subagentState?.childTools) {
      for (const child of message.subagentState.childTools) {
        collect(child.toolName, child.toolInput, child.toolResult);
      }
    }
  }

  return files;
}
