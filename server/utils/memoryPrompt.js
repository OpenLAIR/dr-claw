import { memoryDb, appSettingsDb } from '../database/db.js';

const MEMORY_ENABLED_KEY = 'memory_enabled';

/**
 * Builds a memory block string to inject into system prompts.
 * Returns empty string if memory is globally disabled or no enabled memories exist.
 * @param {number} userId - The authenticated user's ID
 * @returns {string} Formatted memory block or empty string
 */
export function buildMemoryBlock(userId) {
  if (!userId) return '';

  const globalEnabled = appSettingsDb.get(MEMORY_ENABLED_KEY);
  if (globalEnabled === 'false') return '';

  const memories = memoryDb.getEnabled(userId);
  if (!memories || memories.length === 0) return '';

  const lines = memories.map(m => `- ${m.content}`).join('\n');
  return `\n\n# User Memories\nThe following are things the user has asked you to remember. Incorporate them naturally into your responses where relevant:\n${lines}\n`;
}
