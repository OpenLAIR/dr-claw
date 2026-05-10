// remark-math only recognizes $-delimiters; rewrite \[..\] and \(..\) so KaTeX
// sees them. Fenced code blocks and inline code pass through untouched.

const PROTECTED_SEGMENTS = /```[\s\S]*?```|`[^`\n]*`/g;
const MATH_DELIMITERS = /\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)/g;

export function normalizeLatexDelimiters(input: string): string {
  if (input.length === 0) return input;
  if (!input.includes('\\[') && !input.includes('\\(')) return input;

  let output = '';
  let cursor = 0;

  for (const match of input.matchAll(PROTECTED_SEGMENTS)) {
    const start = match.index;
    output += rewriteMathDelimiters(input.slice(cursor, start));
    output += match[0];
    cursor = start + match[0].length;
  }
  output += rewriteMathDelimiters(input.slice(cursor));
  return output;
}

function rewriteMathDelimiters(segment: string): string {
  if (!segment) return segment;
  return segment.replace(MATH_DELIMITERS, (_, display, inline) =>
    display !== undefined ? `$$${display}$$` : `$${inline}$`,
  );
}
