/**
 * A session that just finished running can be missing from the next project
 * list for a moment: the server indexes new sessions (notably Codex threads)
 * only after the turn completes. Dropping the selection in that window blanks
 * the chat, so keep it while the session is running or ended recently.
 */
export const RECENTLY_ACTIVE_GRACE_MS = 60_000;

/** Records Infinity while a session is active and the time it stopped afterwards. */
export function updateSessionActivity(
  activity: Map<string, number>,
  activeIds: Iterable<string>,
  now: number,
): void {
  const active = new Set(activeIds);
  for (const id of active) activity.set(id, Number.POSITIVE_INFINITY);
  for (const [id, at] of activity) {
    if (!active.has(id) && at === Number.POSITIVE_INFINITY) activity.set(id, now);
    else if (!active.has(id) && now - at > RECENTLY_ACTIVE_GRACE_MS) activity.delete(id);
  }
}

export function isRecentlyActiveSession(
  activity: Map<string, number>,
  sessionId: string | null | undefined,
  now: number,
): boolean {
  if (!sessionId) return false;
  const at = activity.get(sessionId);
  return at !== undefined && now - at <= RECENTLY_ACTIVE_GRACE_MS;
}
