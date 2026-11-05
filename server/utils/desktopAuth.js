import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Desktop auto-login.
 *
 * The Electron shell (electron/main.mjs) generates a random secret on every
 * launch, passes it to this server as DR_CLAW_DESKTOP_TOKEN, and hands it to
 * its own renderer over IPC. The renderer presents it once, in the
 * X-Dr-Claw-Desktop-Token header, to POST /api/auth/desktop-session and gets
 * an ordinary JWT back. Every other route keeps using JWTs, so web/npx mode is
 * unchanged and a request without a JWT or the secret is still rejected.
 */

export const DESKTOP_TOKEN_HEADER = 'x-dr-claw-desktop-token';
export const DESKTOP_LOCAL_USERNAME = 'local';

/** Shorter values are ignored so a blank or placeholder env var never unlocks anything. */
export const MIN_DESKTOP_TOKEN_LENGTH = 32;

/**
 * The desktop secret, or null when desktop auto-login is off. It is only
 * honoured when the server was started by the desktop shell (DR_CLAW_DESKTOP=1).
 */
export function readDesktopToken(env = process.env) {
  if (env.DR_CLAW_DESKTOP !== '1') {
    return null;
  }
  const token = typeof env.DR_CLAW_DESKTOP_TOKEN === 'string' ? env.DR_CLAW_DESKTOP_TOKEN.trim() : '';
  return token.length >= MIN_DESKTOP_TOKEN_LENGTH ? token : null;
}

/**
 * Constant-time comparison. Both sides are hashed first so their lengths are
 * equal and the comparison time does not reveal the secret's length.
 */
export function desktopTokenMatches(expected, presented) {
  if (!expected || typeof presented !== 'string' || presented.length === 0) {
    return false;
  }
  const a = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const b = crypto.createHash('sha256').update(presented, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * The account the desktop app signs in as:
 * 1. the active user who logged in most recently (users who never logged in
 *    sort last; ties go to the lowest id, i.e. the oldest account);
 * 2. otherwise a new account named "local" (or "local-<random>" if that name
 *    is taken by a deactivated user). Its password is random and never shown,
 *    so the account cannot be used to log in from the web UI.
 */
export function resolveDesktopUser(userDb) {
  const existing = userDb.getMostRecentUser();
  if (existing) {
    return existing;
  }

  const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  const candidates = [DESKTOP_LOCAL_USERNAME, `${DESKTOP_LOCAL_USERNAME}-${crypto.randomBytes(3).toString('hex')}`];
  let lastError = null;
  for (const username of candidates) {
    try {
      const created = userDb.createUser(username, passwordHash, null);
      return userDb.getUserById(created.id) || created;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
        throw error;
      }
    }
  }
  throw lastError;
}
