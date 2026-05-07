/**
 * IndexedDB-backed blob store for uploaded screenshot files. Survives reload —
 * Zustand persist keeps the screenshot metadata (positions, headlines) in
 * localStorage, but blob-URLs (URL.createObjectURL) don't, so we re-hydrate them
 * from IDB on app boot.
 */

const DB_NAME = 'aso-studio';
const STORE = 'screenshots';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveScreenshotBlob(id: string, blob: Blob, filename: string): Promise<void> {
  await tx<IDBValidKey>('readwrite', (s) => s.put({ blob, filename, savedAt: Date.now() }, id));
}

export async function loadScreenshotBlob(id: string): Promise<{ blob: Blob; filename: string } | null> {
  const rec = await tx<{ blob: Blob; filename: string } | undefined>('readonly', (s) => s.get(id));
  return rec ?? null;
}

export async function deleteScreenshotBlob(id: string): Promise<void> {
  await tx<undefined>('readwrite', (s) => s.delete(id));
}

export async function listScreenshotBlobIds(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  return keys.map((k) => String(k));
}
