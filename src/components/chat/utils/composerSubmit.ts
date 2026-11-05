/** `/btw` asks a side question without joining the conversation, so it runs even while a turn is in progress. */
export function isSideQuestionCommand(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === '/btw' || trimmed.startsWith('/btw ');
}
