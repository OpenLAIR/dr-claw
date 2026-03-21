import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Local copy of prefix stripping since this is a standalone script
function stripInternalContextPrefix(text) {
  if (typeof text !== 'string') return '';
  let cleaned = text;
  
  // 1. Match full [Context: ...] prefixes at the start of the string, including multiple ones
  const fullPrefixPattern = /^\s*\[Context:[^\]]*\]\s*/i;
  while (fullPrefixPattern.test(cleaned)) {
    cleaned = cleaned.replace(fullPrefixPattern, '');
  }
  
  // 2. Match common truncated prefixes like "[Context: session-mode=..." or "[Context: Tre..."
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    return 'New Session';
  }

  return cleaned.trim() || 'New Session';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'database', 'auth.db');

console.log('Opening database at:', DB_PATH);
const db = new Database(DB_PATH);

try {
  const sessions = db.prepare('SELECT id, display_name FROM session_metadata').all();
  console.log(`Found ${sessions.length} sessions in database.`);

  let updatedCount = 0;
  const updateStmt = db.prepare('UPDATE session_metadata SET display_name = ? WHERE id = ?');

  const cleanup = db.transaction(() => {
    for (const session of sessions) {
      const cleanedName = stripInternalContextPrefix(session.display_name);
      if (cleanedName !== session.display_name) {
        console.log(`Cleaning session ${session.id}: "${session.display_name}" -> "${cleanedName}"`);
        updateStmt.run(cleanedName, session.id);
        updatedCount++;
      }
    }
  });

  cleanup();
  console.log(`Cleanup complete. Updated ${updatedCount} sessions.`);
} catch (error) {
  console.error('Error cleaning up database:', error.message);
} finally {
  db.close();
}
