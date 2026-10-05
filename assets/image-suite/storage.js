(function (global) {
  const PREFIX = 'kyg.image-suite.';
  const DB_NAME = 'kyg_image_suite_db';
  const DB_VERSION = 1;
  const STORE = 'blobs';

  function lsKey(key) {
    return PREFIX + key;
  }

  function getSetting(key, fallback = null) {
    try {
      const raw = localStorage.getItem(lsKey(key));
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function setSetting(key, value) {
    localStorage.setItem(lsKey(key), JSON.stringify(value));
  }

  function removeSetting(key) {
    localStorage.removeItem(lsKey(key));
  }

  function clearSettings(toolPrefix) {
    const full = PREFIX + (toolPrefix || '');
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putBlob(id, blob, meta = {}) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, blob, meta, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getBlob(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteBlob(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAllBlobs() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  global.KygImageSuiteStorage = {
    PREFIX,
    getSetting,
    setSetting,
    removeSetting,
    clearSettings,
    putBlob,
    getBlob,
    deleteBlob,
    clearAllBlobs,
  };
})(window);
