/**
 * Utility functions for formatting and cleaning session content.
 */

/**
 * Strips internal [Context: ...] prefixes from message text.
 * Handles full prefixes [Context: ...] and common truncated ones like [Context: Tre...
 * @param {string} text - The message text
 * @param {boolean} returnDefaultOnEmpty - Whether to return 'New Session' if result is empty
 * @returns {string|null} - Cleaned text or null/default if empty
 */
export function stripInternalContextPrefix(text, returnDefaultOnEmpty = true) {
  if (typeof text !== 'string') return returnDefaultOnEmpty ? '' : null;
  
  let cleaned = text;
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
  // This is specifically for database entries where the summary was truncated before the closing bracket
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    // If it's JUST a truncated context prefix and we have no other content, return default or null
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  const result = cleaned.trim();
  
  // If we didn't find any context prefix and we have text, return it as is
  if (!hasMatch && result) {
    return result;
  }

  // If it's empty after cleaning, but we had a match (it was pure context)
  if (!result && hasMatch) {
    if (!returnDefaultOnEmpty) return null;
    
    // Fallback: If it's a new session and we ONLY have context, 
    // try to find some semantic info in the context itself or return a better default
    if (text.includes('session-mode=workspace_qa')) return 'Workspace Q&A';
    if (text.includes('session-mode=research')) return 'Research Session';
    
    return 'New Session';
  }
  
  return result || (returnDefaultOnEmpty ? 'New Session' : null);
}
