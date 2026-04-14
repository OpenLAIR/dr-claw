/**
 * Shared constants and helpers for the /btw ephemeral side-question feature.
 * Used by all provider-specific btw implementations (Claude, Gemini, Codex).
 */

export const BTW_SYSTEM_PROMPT = `You answer a short side question for someone in the middle of a coding session.

Rules:
- You have NO tools. Do not claim to read files, run commands, or fetch URLs unless that information already appears in the conversation context below.
- Use the "Conversation context" section plus general programming knowledge. If something is not in the context, say you do not see it there.
- Be concise.`;

export const MAX_QUESTION_CHARS = 2000;
export const MAX_TRANSCRIPT_CHARS = 150_000;

/**
 * Build the user-facing prompt block that combines transcript context with the side question.
 */
export function buildBtwUserMessage(question, transcript) {
  const safeTranscript =
    typeof transcript === 'string' && transcript.trim()
      ? transcript
      : '(No prior conversation in this session.)';
  return `## Conversation context\n\n${safeTranscript}\n\n---\n\n## Side question\n\n${question}`;
}
