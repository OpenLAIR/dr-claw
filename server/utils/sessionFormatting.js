/**
 * Utility functions for formatting and cleaning session content.
 */

/**
 * Strips internal [Context: ...] prefixes from message text.
 * Handles full prefixes [Context: ...] and common truncated ones like [Context: Tre...
 * @param {string} text - The message text
 * @returns {string} - Cleaned text
 */
export function stripInternalContextPrefix(text) {
  if (typeof text !== 'string') return '';
  let cleaned = text;
  
  // 1. Match full [Context: ...] prefixes at the start of the string, including multiple ones
  const fullPrefixPattern = /^\s*\[Context:[^\]]*\]\s*/i;
  while (fullPrefixPattern.test(cleaned)) {
    cleaned = cleaned.replace(fullPrefixPattern, '');
  }
  
  // 2. Match common truncated prefixes like "[Context: session-mode=..." or "[Context: Tre..."
  // This is specifically for database entries where the summary was truncated before the closing bracket
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    // If it's JUST a truncated context prefix, return a default name
    return 'New Session';
  }

  return cleaned.trim() || 'New Session';
}
