/* Pamięć aplikacji: posiłki w IndexedDB, ustawienia w localStorage. Wszystko zostaje na telefonie. */
(function () {
  'use strict';
  const TF = (window.TF = window.TF || {});

  const DB_NAME = 'tomfood';
  const STORE = 'meals';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('day', 'day');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        })
    );
  }

  const byTime = (a, b) => a.ts - b.ts;

  const db = {
    save: (meal) => run('readwrite', (s) => s.put(meal)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
    get: (id) => run('readonly', (s) => s.get(id)),
    byDay: (day) => run('readonly', (s) => s.index('day').getAll(IDBKeyRange.only(day))).then((r) => r.sort(byTime)),
    range: (from, to) =>
      run('readonly', (s) => s.index('day').getAll(IDBKeyRange.bound(from, to))).then((r) => r.sort(byTime)),
    count: () => run('readonly', (s) => s.count()),
  };

  /* ---------- Ustawienia ---------- */

  const SETTINGS_KEY = 'tomfood.settings';
  const DEFAULTS = {
    provider: 'gemini',
    geminiKey: '',
    openaiKey: '',
    geminiModel: '',
    openaiModel: '',
    geminiModels: [],
    openaiModels: [],
    pinHash: '',
    pinSalt: '',
  };

  const settings = {
    load() {
      let saved = {};
      try {
        saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
      } catch (e) {
        saved = {};
      }
      const s = { ...DEFAULTS, ...saved };
      s.geminiModel = s.geminiModel || TF.ai.DEFAULT_MODELS.gemini;
      s.openaiModel = s.openaiModel || TF.ai.DEFAULT_MODELS.openai;
      return s;
    },
    save(next) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        return true;
      } catch (e) {
        return false;
      }
    },
    /** Dostawca, klucz i model używane do analizy. */
    active() {
      const s = settings.load();
      const provider = s.provider === 'openai' ? 'openai' : 'gemini';
      return { provider, apiKey: s[provider + 'Key'], model: s[provider + 'Model'] };
    },
  };

  /*
   * PIN blokuje ekran ustawień, żeby klucze nie były widoczne dla kogoś, kto weźmie telefon do ręki.
   * To blokada interfejsu, nie szyfrowanie: klucze muszą leżeć na urządzeniu w postaci,
   * którą aplikacja potrafi odczytać bez pytania o PIN przy każdym zdjęciu.
   */
  function hashPin(pin, salt) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    let text = salt + ':' + pin;
    for (let round = 0; round < 500; round++) {
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      text = (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + salt;
    }
    return (h1 >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36);
  }

  const pin = {
    isSet: () => !!settings.load().pinHash,
    check(value) {
      const s = settings.load();
      return !!s.pinHash && hashPin(String(value), s.pinSalt) === s.pinHash;
    },
    make(value) {
      const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
      return { pinSalt: salt, pinHash: hashPin(String(value), salt) };
    },
  };

  TF.db = db;
  TF.settings = settings;
  TF.pin = pin;
})();
