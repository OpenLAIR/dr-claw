import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The secret that older releases silently fell back to when JWT_SECRET was
 * unset. It is public (it lives in git history and in GitHub issue #225), so
 * a token signed with it proves nothing. We refuse to run with it.
 */
export const LEGACY_DEFAULT_SECRET = 'claude-ui-dev-secret-change-in-production';

/** Secrets shorter than this are accepted but flagged at startup. */
export const MIN_RECOMMENDED_SECRET_LENGTH = 32;

/** Default file name for the auto-generated secret, next to the SQLite database. */
export const SECRET_FILE_NAME = 'jwt-secret';

/**
 * Mirror the DATABASE_PATH resolution in server/database/db.js so the
 * generated secret lives next to the database it protects. Kept separate from
 * db.js so this module can be loaded without opening the database.
 */
export function defaultSecretFilePath(env = process.env) {
  const dbPath = env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'auth.db');
  return path.join(path.dirname(dbPath), SECRET_FILE_NAME);
}

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Load the secret from `filePath`, creating it with a fresh random value when
 * it does not exist. The file is written with mode 0600 and the `wx` flag so a
 * concurrent first start cannot clobber a secret another process just wrote.
 */
export function loadOrCreateSecretFile(filePath, { log = console } = {}) {
  const readExisting = () => {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    if (!value) {
      throw new Error(
        `JWT secret file ${filePath} exists but is empty. `
        + 'Delete it to generate a new secret, or set JWT_SECRET explicitly.'
      );
    }
    return value;
  };

  if (fs.existsSync(filePath)) {
    return readExisting();
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const secret = generateSecret();
  try {
    fs.writeFileSync(filePath, `${secret}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') {
      // Another process won the race; use what it wrote.
      return readExisting();
    }
    throw error;
  }
  log.log(
    `[SECURITY] Generated a new JWT signing secret at ${filePath}. `
    + 'Keep this file private; deleting it will sign out every user.'
  );
  return secret;
}

/**
 * Resolve the JWT signing secret. Precedence:
 *   1. JWT_SECRET (non-empty)
 *   2. JWT_SECRET_FILE, a path to a file containing the secret (created if absent)
 *   3. an auto-generated secret persisted next to the database
 *
 * There is deliberately no static fallback and no NODE_ENV check: every
 * instance ends up with a secret that is either operator-supplied or unique to
 * that installation.
 */
export function resolveJwtSecret({ env = process.env, log = console } = {}) {
  const fromEnv = (env.JWT_SECRET || '').trim();
  let secret;
  let source;

  if (fromEnv) {
    secret = fromEnv;
    source = 'JWT_SECRET';
  } else {
    const filePath = (env.JWT_SECRET_FILE || '').trim() || defaultSecretFilePath(env);
    secret = loadOrCreateSecretFile(filePath, { log });
    source = filePath;
  }

  if (secret === LEGACY_DEFAULT_SECRET) {
    throw new Error(
      `Refusing to start: the JWT secret from ${source} is the publicly known development default. `
      + 'Generate a new one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (secret.length < MIN_RECOMMENDED_SECRET_LENGTH) {
    log.warn(
      `[SECURITY] The JWT secret from ${source} is only ${secret.length} characters long. `
      + `Use at least ${MIN_RECOMMENDED_SECRET_LENGTH} random characters.`
    );
  }

  return secret;
}
