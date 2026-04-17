import { normalizeLatexDelimiters } from '../../../utils/latexNormalizer';

export function decodeHtmlEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeInlineCodeFences(text: string) {
  if (!text || typeof text !== 'string') return text;
  try {
    return text.replace(/```\s*([^\n\r]+?)\s*```/g, '`$1`');
  } catch {
    return text;
  }
}

export function unescapeWithMathProtection(text: string) {
  if (!text || typeof text !== 'string') return text;

  // Rewrite \[..\] / \(..\) into $-delimited form before masking — the mask
  // below only covers $-delimiters, so without this the \\t → \t replacement
  // would corrupt \theta / \tau / \n-commands inside bracket-delimited math.
  let processedText = normalizeLatexDelimiters(text);

  const mathBlocks: string[] = [];
  const placeholderPrefix = '__MATH_BLOCK_';
  const placeholderSuffix = '__';

  processedText = processedText.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

  processedText = processedText.replace(
    new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => {
      return mathBlocks[parseInt(index, 10)];
    },
  );

  return processedText;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatFileTreeInContent(text: string): string {
  if (!text || typeof text !== 'string') return text;

  // Auto-wrap ASCII file trees in a `text` fence so monospace alignment is preserved.
  // Two guardrails prevent mis-wrapping non-tree content (Mermaid-ish diagrams, ASCII
  // pipelines, content already inside a fence):
  //   1. `insideFence` — skip detection while walking through a fenced block
  //   2. `hasStrongTreeSignal` — require at least one `├──` or `└──` line before
  //      committing the wrap; a lone `│` run is not enough evidence of a file tree.
  const lines = text.split('\n');
  const result: string[] = [];
  let isInTree = false;
  let treeLines: string[] = [];
  let hasStrongSignal = false;
  let insideFence = false;

  const isFenceToggleLine = (line: string) => /^\s*```/.test(line);

  const isStrongTreeLine = (line: string) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('├──') ||
      trimmed.startsWith('└──') ||
      (trimmed.includes('──') && (trimmed.includes('├') || trimmed.includes('└')))
    );
  };

  const isWeakTreeLine = (line: string) => {
    const trimmed = line.trim();
    return trimmed.startsWith('│');
  };

  const isTreeLine = (line: string) => isStrongTreeLine(line) || isWeakTreeLine(line);

  const isPossibleRootLine = (line: string) => {
    const trimmed = line.trim();
    return (
      trimmed.endsWith('/') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('/') ||
      (trimmed.length > 0 && !trimmed.includes(' ') && trimmed.includes('/'))
    );
  };

  const flushTreeLines = () => {
    if (!treeLines.length) return;
    if (hasStrongSignal) {
      result.push('```text\n' + treeLines.join('\n') + '\n```');
    } else {
      // Weak-only collection (e.g. lone `│` pipeline art) — emit unchanged so we
      // don't fence real diagrams into a text code block.
      result.push(...treeLines);
    }
    treeLines = [];
    hasStrongSignal = false;
    isInTree = false;
  };

  const pushTreeLine = (line: string) => {
    treeLines.push(line);
    if (!hasStrongSignal && isStrongTreeLine(line)) hasStrongSignal = true;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isFenceToggleLine(line)) {
      if (isInTree) flushTreeLines();
      insideFence = !insideFence;
      result.push(line);
      continue;
    }

    if (insideFence) {
      result.push(line);
      continue;
    }

    if (isTreeLine(line)) {
      if (!isInTree) {
        isInTree = true;
        if (result.length > 0 && isPossibleRootLine(result[result.length - 1])) {
          const rootLine = result.pop()!;
          pushTreeLine(rootLine);
        }
      }
      pushTreeLine(line);
    } else if (isInTree) {
      if (line.trim() === '' || line.trim() === '│') {
        pushTreeLine(line);
      } else {
        flushTreeLines();
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  if (isInTree) {
    flushTreeLines();
  }

  return result.join('\n');
}

export function formatUsageLimitText(text: string) {
  try {
    if (typeof text !== 'string') return text;

    // First apply file tree formatting
    let formattedText = formatFileTreeInContent(text);

    // Strip <thinking>...</thinking> blocks that appear inline in assistant messages
    formattedText = formattedText.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '');

    // Parse "Claude AI usage limit reached|<timestamp>" and show local reset time
    const localTimezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
    const USAGE_LIMIT_FALLBACK = 'AI usage limit reached. Please try again later.';
    formattedText = formattedText.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (_match, ts) => {
      try {
        const epoch = ts.length <= 10 ? Number(ts) * 1000 : Number(ts);
        const resetDate = new Date(epoch);
        if (Number.isNaN(resetDate.getTime())) return USAGE_LIMIT_FALLBACK;
        const time = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const totalMinutes = Math.abs(resetDate.getTimezoneOffset());
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const sign = resetDate.getTimezoneOffset() <= 0 ? '+' : '-';
        const offset = `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
        const date = resetDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
        return `AI usage limit reached. Your limit will reset at **${time} ${offset} (${localTimezone})** - ${date}`;
      } catch {
        return USAGE_LIMIT_FALLBACK;
      }
    });

    return formattedText;
  } catch {
    return text;
  }
}

// Re-export from shared module — single source of truth for both server and client
import { splitLegacyGeminiThoughtContent } from '../../../../shared/geminiThoughtParser.js';
export { splitLegacyGeminiThoughtContent };

export function buildAssistantMessages(
  content: string,
  timestamp: Date | string | number,
): Array<{ type: string; content: string; timestamp: Date | string | number; isThinking?: boolean }> {
  const legacySegments = splitLegacyGeminiThoughtContent(content);
  if (legacySegments) {
    return legacySegments.map((segment) => ({
      type: 'assistant',
      content: segment.content,
      timestamp,
      ...(segment.isThinking ? { isThinking: true } : {}),
    }));
  }
  return [{ type: 'assistant', content, timestamp }];
}

/**
 * Returns the display label for a given provider.
 * For OpenRouter, shows a prettified version of the selected model slug.
 */
export function getProviderDisplayName(provider: string): string {
  if (provider === 'cursor') return 'Cursor';
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'openrouter') {
    const slug = localStorage.getItem('openrouter-model') || '';
    if (slug) {
      const afterSlash = slug.includes('/') ? slug.split('/').pop()! : slug;
      return afterSlash
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return 'OpenRouter';
  }
  if (provider === 'local') {
    const model = localStorage.getItem('local-model') || '';
    if (model) {
      return model
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return 'Local GPU';
  }
  if (provider === 'nano') {
    return 'Nano Claude Code';
  }
  return 'Claude';
}
