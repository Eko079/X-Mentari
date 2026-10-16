/**
 * X Mentari — lapisan penyimpanan
 *
 * Seluruh pengaturan disimpan di chrome.storage.local sehingga popup,
 * content script, halaman opsi, dan service worker membaca sumber yang
 * sama. Ini berbeda dari localStorage yang terpisah per origin.
 *
 * Kunci API tiap penyedia disimpan di sini, bukan di localStorage domain
 * kampus, agar tidak terbaca oleh skrip halaman.
 */
(() => {
  if (globalThis.XMTStore) return;

  const {
    KEYS,
    FEATURE_DEFAULTS,
    SCHEMA_VERSION,
    PRESETS
  } = globalThis.XMT_CONST;

  const DEFAULTS = {
    [KEYS.PROVIDERS]: [],
    [KEYS.ACTIVE_PROVIDER]: null,
    [KEYS.THEME]: 'auto',
    [KEYS.FEATURES]: { ...FEATURE_DEFAULTS },
    [KEYS.QUOTA]: null,
    [KEYS.CHAT_HISTORY]: [],
    [KEYS.COURSE_CACHE]: [],
    [KEYS.COURSE_CACHE_AT]: 0,
    [KEYS.NOTIF_CACHE]: [],
    [KEYS.NOTIF_SEEN]: 0,
    [KEYS.GUIDE_SEEN]: false,
    [KEYS.TODO_LIST]: [],
    [KEYS.TODO_OVERRIDES]: {},
    [KEYS.LB_COLLAPSED]: false,
    [KEYS.EXPORT_DATA]: null,
    [KEYS.SCHEMA]: 0
  };

  const area = chrome.storage?.local ?? null;

  let cache = null;
  let loading = null;
  let migrated = false;

  function isExtensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  /**
   * Memindahkan data versi 1 ke bentuk penyedia versi 2.
   *
   * Versi 1 hanya punya satu kunci Gemini di `apiKey` dan satu `model`.
   * Keduanya diubah menjadi satu penyedia Gemini yang otomatis aktif,
   * sehingga pengguna lama tidak kehilangan pengaturannya.
   */
  function migrate(data) {
    if ((data[KEYS.SCHEMA] ?? 0) >= SCHEMA_VERSION) return { data, changed: false };

    const patch = {};

    const legacyKey = data[KEYS.LEGACY_API_KEY];
    const providers = Array.isArray(data[KEYS.PROVIDERS]) ? [...data[KEYS.PROVIDERS]] : [];

    if (legacyKey && providers.length === 0) {
      const preset = PRESETS.find((entry) => entry.id === 'gemini');
      const provider = {
        id: 'gemini-legacy',
        name: preset.name,
        kind: preset.kind,
        baseUrl: preset.baseUrl,
        apiKey: legacyKey,
        model: data[KEYS.LEGACY_MODEL] || preset.model,
        models: preset.models,
        headers: {},
        keyOptional: false,
        local: false
      };
      providers.push(provider);
      patch[KEYS.ACTIVE_PROVIDER] = provider.id;
    }

    patch[KEYS.PROVIDERS] = providers;

    const exportData = data[KEYS.EXPORT_DATA];
    if (exportData && typeof exportData === 'object') {
      if (Array.isArray(exportData.chatHistory) && (!Array.isArray(data[KEYS.CHAT_HISTORY]) || data[KEYS.CHAT_HISTORY].length === 0)) {
        patch[KEYS.CHAT_HISTORY] = exportData.chatHistory;
      }
      if (Array.isArray(exportData.providers) && exportData.providers.length > 0 && providers.length === 0) {
        patch[KEYS.PROVIDERS] = exportData.providers;
        if (exportData.activeProvider) patch[KEYS.ACTIVE_PROVIDER] = exportData.activeProvider;
      }
    }

    patch[KEYS.SCHEMA] = SCHEMA_VERSION;

    const merged = { ...data, ...patch };
    return { data: merged, changed: true, patch };
  }

  async function loadAll() {
    if (cache) return cache;
    if (loading) return loading;

    if (!area || !isExtensionAlive()) {
      cache = { ...DEFAULTS };
      return cache;
    }

    // Sertakan kunci warisan agar bisa dibaca saat migrasi.
    const request = { ...DEFAULTS, [KEYS.LEGACY_API_KEY]: '', [KEYS.LEGACY_MODEL]: '' };

    loading = chrome.storage.local
      .get(request)
      .then(async (raw) => {
        const { data, changed, patch } = migrate(raw);

        cache = {
          ...DEFAULTS,
          ...data,
          [KEYS.FEATURES]: { ...FEATURE_DEFAULTS, ...(data[KEYS.FEATURES] ?? {}) }
        };

        // Tulis hasil migrasi sekali dan bersihkan kunci warisan.
        if (changed && !migrated) {
          migrated = true;
          await chrome.storage.local.set(patch);
          await chrome.storage.local.remove([KEYS.LEGACY_API_KEY, KEYS.LEGACY_MODEL]);
        }

        return cache;
      })
      .catch(() => {
        cache = { ...DEFAULTS };
        return cache;
      })
      .finally(() => {
        loading = null;
      });

    return loading;
  }

  const listeners = new Set();

  if (area && isExtensionAlive()) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      const patch = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        patch[key] = newValue;
        if (cache) cache[key] = newValue;
      }

      for (const listener of listeners) {
        try {
          listener(patch);
        } catch (error) {
          console.warn('[XMT] listener penyimpanan gagal', error);
        }
      }
    });
  }

  const store = {
    async all() {
      return { ...(await loadAll()) };
    },

    async get(key) {
      const data = await loadAll();
      return data[key];
    },

    async set(key, value) {
      const data = await loadAll();
      data[key] = value;
      if (!area || !isExtensionAlive()) return;
      await chrome.storage.local.set({ [key]: value });
    },

    async merge(patch) {
      const data = await loadAll();
      Object.assign(data, patch);
      if (!area || !isExtensionAlive()) return;
      await chrome.storage.local.set(patch);
    },

    async reset(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const patch = {};
      for (const key of list) patch[key] = DEFAULTS[key];
      await store.merge(patch);
    },

    /* ------------------------------------------------------ penyedia */

    /** Semua penyedia yang dikonfigurasi. */
    async providers() {
      const list = await store.get(KEYS.PROVIDERS);
      return Array.isArray(list) ? list : [];
    },

    /** Penyedia yang sedang aktif, atau null bila belum ada. */
    async activeProvider() {
      const [providers, activeId] = await Promise.all([
        store.providers(),
        store.get(KEYS.ACTIVE_PROVIDER)
      ]);
      if (providers.length === 0) return null;
      return providers.find((entry) => entry.id === activeId) ?? providers[0];
    },

    async setActiveProvider(id) {
      await store.set(KEYS.ACTIVE_PROVIDER, id);
    },

    /** Menyimpan penyedia baru atau memperbarui yang sudah ada. */
    async upsertProvider(provider) {
      const providers = await store.providers();
      const index = providers.findIndex((entry) => entry.id === provider.id);

      if (index === -1) providers.push(provider);
      else providers[index] = provider;

      const patch = { [KEYS.PROVIDERS]: providers };

      // Penyedia pertama otomatis menjadi aktif.
      const activeId = await store.get(KEYS.ACTIVE_PROVIDER);
      if (!activeId) patch[KEYS.ACTIVE_PROVIDER] = provider.id;

      await store.merge(patch);
      return provider;
    },

    async removeProvider(id) {
      const providers = (await store.providers()).filter((entry) => entry.id !== id);
      const patch = { [KEYS.PROVIDERS]: providers };

      const activeId = await store.get(KEYS.ACTIVE_PROVIDER);
      if (activeId === id) {
        patch[KEYS.ACTIVE_PROVIDER] = providers[0]?.id ?? null;
      }

      await store.merge(patch);
    },

    async hasProvider() {
      const provider = await store.activeProvider();
      if (!provider) return false;
      // Server lokal boleh tanpa kunci.
      return Boolean(provider.apiKey) || Boolean(provider.keyOptional);
    },

    /* -------------------------------------------------------- fitur */

    async features() {
      return { ...FEATURE_DEFAULTS, ...((await store.get(KEYS.FEATURES)) ?? {}) };
    },

    async enabled(name) {
      const features = await store.features();
      return Boolean(features[name]);
    },

    async setFeature(name, value) {
      const features = await store.features();
      features[name] = Boolean(value);
      await store.set(KEYS.FEATURES, features);
    },

    /* ----------------------------------------------------- langganan */

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    watch(key, listener) {
      return store.subscribe((patch) => {
        if (key in patch) listener(patch[key]);
      });
    },

    async exportPersistent() {
      const [providers, activeId, chatHistory] = await Promise.all([
        store.providers(),
        store.get(KEYS.ACTIVE_PROVIDER),
        store.get(KEYS.CHAT_HISTORY)
      ]);
      const exportData = {
        providers,
        activeProvider: activeId,
        chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
        exportedAt: Date.now()
      };
      await store.set(KEYS.EXPORT_DATA, exportData);
      return exportData;
    },

    DEFAULTS
  };

  globalThis.XMTStore = store;

  const autoExportKeys = new Set([KEYS.PROVIDERS, KEYS.ACTIVE_PROVIDER, KEYS.CHAT_HISTORY]);
  let exportTimer = null;
  store.subscribe((patch) => {
    const shouldExport = Object.keys(patch).some((key) => autoExportKeys.has(key));
    if (!shouldExport) return;
    clearTimeout(exportTimer);
    exportTimer = setTimeout(() => store.exportPersistent().catch(() => {}), 5000);
  });
})();
