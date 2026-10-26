/** Concatenate the text blocks from a Pi message content value. */
export function extractPiTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}
