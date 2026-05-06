/**
 * Utility functions for formatting and cleaning session content on the frontend.
 */

/**
 * Strips internal [Context: ...] prefixes from message text.
 * Handles full prefixes [Context: ...] and common truncated ones like [Context: Tre...
 * @param value - The message text
 * @param returnDefaultOnEmpty - Whether to return 'New Session' if result is empty
 * @returns - Cleaned text or null/default if empty
 */
export const stripInternalContextPrefix = (value: string, returnDefaultOnEmpty = true): string | null => {
  if (typeof value !== 'string') return returnDefaultOnEmpty ? '' : null;
  let cleaned = value;
  let hasMatch = false;

  const internalCommandTagPattern = /<\/?(?:command-name|command-message|command-args|local-command-stdout)>/i;
  const skillContentPattern = /Base directory for this skill:\s*\S+/i;

  if (internalCommandTagPattern.test(cleaned) || skillContentPattern.test(cleaned)) {
    cleaned = cleaned
      .replace(/<command-name>[^<]*<\/command-name>/gi, '')
      .replace(/<command-message>[^<]*<\/command-message>/gi, '')
      .replace(/<command-args>[^<]*<\/command-args>/gi, '')
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
      .replace(/^[❯>]\s*Base directory for this skill:\s*\S+\s*/gim, '')
      .replace(/^Base directory for this skill:\s*\S+\s*/gim, '')
      .trim();
    hasMatch = true;
  }
  
  // 1. Match full [Context: ...] prefixes at the start of the string, including multiple ones
  const fullPrefixPattern = /^\s*\[Context:[^\]]*\]\s*/i;
  while (fullPrefixPattern.test(cleaned)) {
    cleaned = cleaned.replace(fullPrefixPattern, '');
    hasMatch = true;
  }
  
  // 2. Match common truncated prefixes like "[Context: session-mode=..." or "[Context: Tre..."
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  const result = cleaned.trim();
  if (!hasMatch && result) {
    return result;
  }

  if (!result && hasMatch) {
    if (!returnDefaultOnEmpty) return null;
    
    // Semantic fallbacks
    if (value.includes('session-mode=workspace_qa')) return 'Workspace Q&A';
    if (value.includes('session-mode=research')) return 'Research Session';
    
    return 'New Session';
  }

  return result || (returnDefaultOnEmpty ? 'New Session' : null);
};

type SessionTitleLike = {
  __provider?: string;
  title?: string;
  summary?: string;
  name?: string;
};

export const getSessionDisplayTitle = (session: SessionTitleLike | null | undefined): string => {
  if (!session) {
    return 'New Session';
  }

  let rawTitle = '';
  if (session.__provider === 'cursor') {
    rawTitle = session.name || session.summary || session.title || 'Untitled Session';
  } else if (session.__provider === 'codex') {
    rawTitle = session.summary || session.title || session.name || 'Codex Session';
  } else if (session.__provider === 'gemini') {
    rawTitle = session.summary || session.title || session.name || 'Gemini Session';
  } else if (session.__provider === 'copilot') {
    rawTitle = session.summary || session.title || session.name || 'GitHub Copilot Session';
  } else if (session.__provider === 'nano') {
    rawTitle = session.summary || session.title || session.name || 'Nano Claude Code Session';
  } else {
    rawTitle = session.summary || session.title || session.name || 'New Session';
  }

  return stripInternalContextPrefix(rawTitle) || 'New Session';
};
