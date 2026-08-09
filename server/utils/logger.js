/**
 * Hot-path logging control.
 *
 * Agent streams emit hundreds to thousands of events per turn, and several call
 * sites logged one line per event. That is wasteful everywhere, and on Windows
 * it is a hazard: Node writes to a Windows console TTY synchronously, so every
 * line blocks the event loop until the console drains it. A console left in
 * QuickEdit selection mode — one stray click in the PowerShell window — stops
 * draining entirely, and the pending write then blocks indefinitely. The
 * reported symptom matches: output stops while the UI keeps counting elapsed
 * time, and the PowerShell window itself looks frozen.
 *
 * Per-event logging is therefore opt-in. Enable it with DRCLAW_DEBUG=1 (or
 * DRCLAW_DEBUG=codex,claude to scope it) when diagnosing a provider.
 */

const rawFlag = (process.env.DRCLAW_DEBUG || process.env.VIBELAB_DEBUG || '').trim();

const enabledAll = rawFlag === '1' || rawFlag.toLowerCase() === 'true' || rawFlag === '*';
const enabledScopes = new Set(
  enabledAll
    ? []
    : rawFlag
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
);

/**
 * @param {string} [scope] Provider/subsystem name, e.g. 'codex'.
 * @returns {boolean}
 */
export function isVerboseLogging(scope) {
  if (enabledAll) return true;
  if (!scope) return enabledScopes.size > 0;
  return enabledScopes.has(String(scope).toLowerCase());
}

/**
 * Log only when verbose logging is enabled for `scope`.
 *
 * Callers on a hot path should still guard with isVerboseLogging() when building
 * the message is itself costly (substring, JSON.stringify, ...), since arguments
 * are evaluated before the call.
 */
export function debugLog(scope, ...args) {
  if (isVerboseLogging(scope)) {
    console.log(...args);
  }
}

export default { isVerboseLogging, debugLog };
