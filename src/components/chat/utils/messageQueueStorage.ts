import type { AttachedPrompt } from '../types/types';

export type QueueDraft = {
  input: string;
  files: File[];
  prompt: AttachedPrompt | null;
  stageKeys: string[];
  editingId: string | null;
  settings?: Record<string, string>;
};
export type SavedQueueItem = {
  id: string;
  text: string;
  files: string[];
  promptTitle?: string;
  hasPrompt?: boolean;
  draft: QueueDraft;
  uncertain?: boolean;
};
export type SavedQueue = { version: 1; items: SavedQueueItem[]; editing: { id: string; text: string } | null };
const databaseName = 'dr-claw-message-queues';
const storeName = 'queues';
let database: Promise<IDBDatabase> | null = null;
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Queue storage is unavailable'));
  }).catch(error => { database = null; throw error; });
  return database;
}
export async function readQueue(scope: string): Promise<SavedQueue | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(scope);
    request.onsuccess = () => {
      const saved = request.result as SavedQueue | undefined;
      if (!saved) return resolve(null);
      if (saved.version !== 1 || !Array.isArray(saved.items) || saved.items.some(item => !item.draft || !Array.isArray(item.draft.files) || item.draft.files.some(file => !(file instanceof File)))) {
        reject(new Error('Saved queue could not be read')); return;
      }
      resolve(saved);
    };
    request.onerror = () => reject(request.error);
  });
}
/** IDB structured clone stores the original File bytes, MIME type, name and modification time. */
export async function writeQueue(scope: string, saved: SavedQueue, removeScope?: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    if (saved.items.length) store.put(saved, scope); else store.delete(scope);
    if (removeScope && removeScope !== scope) store.delete(removeScope);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Queue storage interrupted'));
  });
}
