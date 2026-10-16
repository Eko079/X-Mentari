/**
 * X Mentari — service worker
 *
 * Satu-satunya tempat kunci API dibaca dan dipakai. Content script, popup,
 * dan halaman opsi mengirim pesan ke sini; kunci tidak pernah masuk ke
 * konteks halaman kampus, sehingga skrip halaman tidak bisa membacanya.
 *
 * Berjalan sebagai skrip klasik agar bisa memakai importScripts.
 */

importScripts(
  '../shared/constants.js',
  '../shared/storage.js',
  '../shared/providers.js'
);

const { KEYS, MSG, NAME, VERSION, LIMITS } = globalThis.XMT_CONST;
const store = globalThis.XMTStore;
const providers = globalThis.XMTProviders;

/* ------------------------------------------------------------ batas laju */

/** Membatasi permintaan AI agar kuota penyedia tidak habis mendadak. */
const rateLimiter = {
  timestamps: [],
  windowMs: 60_000,
  max: LIMITS.AI_PER_MINUTE,

  check() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((time) => now - time < this.windowMs);
    if (this.timestamps.length >= this.max) {
      const waitMs = this.windowMs - (now - this.timestamps[0]);
      return { ok: false, waitSeconds: Math.ceil(waitMs / 1000) };
    }
    this.timestamps.push(now);
    return { ok: true };
  }
};

/* ------------------------------------------------------------------ kuota */

/**
 * Menyimpan sisa kuota dari header respons agar bisa ditampilkan sebelum
 * pengguna kehabisan. Nama header berbeda antar penyedia, jadi beberapa
 * varian dicoba.
 */
async function recordQuota(headers, providerId) {
  const readInt = (...names) => {
    for (const name of names) {
      const value = headers.get(name);
      if (value == null) continue;
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  };

  const quota = {
    providerId,
    requestsRemaining: readInt('x-ratelimit-remaining-requests', 'x-ratelimit-remaining'),
    requestsLimit: readInt('x-ratelimit-limit-requests', 'x-ratelimit-limit'),
    tokensRemaining: readInt('x-ratelimit-remaining-tokens'),
    tokensLimit: readInt('x-ratelimit-limit-tokens'),
    updatedAt: Date.now()
  };

  const hasData = ['requestsRemaining', 'requestsLimit', 'tokensRemaining', 'tokensLimit'].some(
    (key) => quota[key] != null
  );

  if (hasData) await store.set(KEYS.QUOTA, quota);
}

/* -------------------------------------------------------------- izin host */

/**
 * Memastikan ekstensi punya izin memanggil origin penyedia.
 *
 * Endpoint kustom tidak tercantum di host_permissions manifest, jadi
 * izinnya diminta saat penyedia disimpan dan diperiksa di sini. Bila
 * belum diberikan, pesan galat mengarahkan pengguna untuk memberikannya
 * di halaman opsi.
 */
async function ensureHostPermission(baseUrl) {
  const pattern = providers.originPattern(baseUrl);
  if (!pattern) {
    throw permanent('Alamat dasar penyedia tidak valid.', 'bad-provider');
  }

  // Server lokal (localhost) tidak butuh host permission untuk difetch dari
  // service worker, tapi origin non-lokal butuh.
  try {
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (granted) return;
  } catch {
    // API permissions tidak tersedia; biarkan fetch yang menentukan.
    return;
  }

  const url = new URL(baseUrl);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  throw permanent(
    'Izin akses ke server penyedia belum diberikan. Buka Pengaturan Penyedia dan tekan Beri izin.',
    'no-host-permission'
  );
}

/* ------------------------------------------------------------------ galat */

function permanent(message, code) {
  return Object.assign(new Error(message), { code, permanent: true });
}

function transient(message, code) {
  return Object.assign(new Error(message), { code, permanent: false });
}

/** Menerjemahkan status HTTP menjadi pesan yang bisa ditindaklanjuti. */
function describeHttpError(status, body) {
  const detail =
    body?.error?.message ?? body?.error ?? body?.message ?? (typeof body === 'string' ? body : '');

  if (status === 400 && /api key not valid|invalid api key/i.test(detail)) {
    return permanent('Kunci API tidak valid. Perbaiki di Pengaturan Penyedia.', 'invalid-key');
  }
  if (status === 400) {
    return permanent(detail || 'Permintaan ditolak karena formatnya tidak sesuai.', 'bad-request');
  }
  if (status === 401) {
    return permanent('Kunci API ditolak (401). Periksa kunci di Pengaturan Penyedia.', 'unauthorized');
  }
  if (status === 403) {
    return permanent('Akses ditolak (403). Pastikan kunci dan model diizinkan untuk akun Anda.', 'forbidden');
  }
  if (status === 404) {
    return permanent('Model atau endpoint tidak ditemukan. Periksa alamat dasar dan nama model.', 'not-found');
  }
  if (status === 429) {
    return transient('Kuota penyedia habis atau terlalu banyak permintaan. Coba lagi nanti atau ganti penyedia.', 'rate-limit');
  }
  if (status >= 500) {
    return transient('Server penyedia sedang bermasalah. Coba lagi sebentar.', 'upstream');
  }
  return transient(detail || `Permintaan gagal (HTTP ${status}).`, 'unknown');
}

/** Menjelaskan alasan model berhenti tanpa menghasilkan teks. */
function describeFinishReason(reason) {
  return (
    {
      SAFETY: 'Jawaban diblokir oleh filter keamanan penyedia.',
      RECITATION: 'Jawaban diblokir karena terlalu mirip materi berhak cipta.',
      content_filter: 'Jawaban diblokir oleh filter konten penyedia.',
      MAX_TOKENS: 'Jawaban terpotong karena mencapai batas panjang.',
      length: 'Jawaban terpotong karena mencapai batas panjang.'
    }[reason] ?? null
  );
}

/* -------------------------------------------------------------- fetch inti */

/** Fetch JSON dengan batas waktu, dipakai adapter mana pun. */
async function fetchJson({ url, method, headers, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.AI_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw transient('Penyedia tidak merespons tepat waktu.', 'timeout');
    }
    // Kegagalan jaringan pada endpoint lokal biasanya berarti servernya mati.
    throw transient('Tidak bisa menghubungi penyedia. Periksa alamat dan koneksi.', 'network');
  } finally {
    clearTimeout(timer);
  }

  return response;
}

/* ------------------------------------------------------------ pemanggilan */

async function generate(request) {
  const provider = providers.normalize(await requireActiveProvider());
  const adapter = providers.adapterFor(provider);

  await ensureHostPermission(provider.baseUrl);

  const limit = rateLimiter.check();
  if (!limit.ok) {
    throw transient(`Terlalu banyak permintaan berurutan. Tunggu ${limit.waitSeconds} detik.`, 'local-rate-limit');
  }

  const spec = adapter.buildRequest(provider, request);
  const response = await fetchJson(spec);

  await recordQuota(response.headers, provider.id).catch(() => {});

  const body = await response.json().catch(() => null);

  if (!response.ok) throw describeHttpError(response.status, body);

  const parsed = adapter.parseResponse(body);

  if (parsed.blocked) {
    throw permanent(parsed.reason ?? 'Permintaan diblokir oleh filter penyedia.', 'blocked');
  }

  if (!parsed.text) {
    const reason = describeFinishReason(parsed.finishReason);
    throw transient(reason ?? 'Model tidak mengembalikan jawaban.', 'empty-response');
  }

  return {
    text: parsed.text,
    model: request.model || provider.model,
    provider: provider.name,
    finishReason: parsed.finishReason,
    truncated: Boolean(parsed.truncated)
  };
}

async function requireActiveProvider() {
  const provider = await store.activeProvider();
  if (!provider) {
    throw permanent('Belum ada penyedia AI. Tambahkan satu di Pengaturan Penyedia.', 'no-provider');
  }
  if (!provider.apiKey && !provider.keyOptional) {
    throw permanent(`Kunci API untuk ${provider.name} belum diisi.`, 'no-key');
  }
  return provider;
}

/* -------------------------------------------------- uji dan daftar model */

/**
 * Menguji sebuah konfigurasi penyedia dengan meminta daftar modelnya.
 * Menerima penyedia lengkap dari pemanggil (belum tentu tersimpan), agar
 * pengguna bisa menguji sebelum menyimpan.
 */
async function testProvider(rawProvider) {
  const provider = providers.normalize(rawProvider);

  const check = providers.validate(provider);
  if (!check.valid) return { ok: false, message: check.message };

  await ensureHostPermission(provider.baseUrl).catch((error) => {
    throw error;
  });

  const adapter = providers.adapterFor(provider);
  const spec = adapter.modelsRequest(provider);

  let response;
  try {
    response = await fetchJson(spec);
  } catch (error) {
    return { ok: false, message: error.message };
  }

  if (response.ok) {
    const body = await response.json().catch(() => null);
    const models = adapter.parseModels(body);
    return {
      ok: true,
      message: models.length ? `Terhubung. ${models.length} model tersedia.` : 'Terhubung.',
      models
    };
  }

  // Beberapa server lokal tidak punya endpoint /models tetapi tetap bisa
  // menghasilkan teks; anggap dapat dipakai bila endpoint model tidak ada.
  if (response.status === 404 && provider.local) {
    return { ok: true, message: 'Server lokal terhubung (tanpa daftar model).', models: [] };
  }

  const body = await response.json().catch(() => null);
  return { ok: false, message: describeHttpError(response.status, body).message };
}

/** Mengambil daftar model untuk penyedia aktif. */
async function listModels() {
  const provider = providers.normalize(await store.activeProvider());
  if (!provider?.baseUrl) return { models: [] };

  const adapter = providers.adapterFor(provider);

  try {
    await ensureHostPermission(provider.baseUrl);
    const response = await fetchJson(adapter.modelsRequest(provider));
    if (!response.ok) return { models: provider.models ?? [] };

    const body = await response.json();
    const remote = adapter.parseModels(body);
    return { models: remote.length ? remote : provider.models ?? [] };
  } catch {
    return { models: provider.models ?? [] };
  }
}

/* ------------------------------------------------------------- perutean */

const handlers = {
  [MSG.AI_GENERATE]: (message) => generate(message),
  [MSG.AI_TEST_PROVIDER]: (message) => testProvider(message.provider),
  [MSG.AI_LIST_MODELS]: () => listModels(),
  [MSG.QUOTA_GET]: () => store.get(KEYS.QUOTA),
  [MSG.OPEN_OPTIONS]: () => {
    chrome.runtime.openOptionsPage();
    return { opened: true };
  },
  [MSG.PING]: () => ({ name: NAME, version: VERSION, ready: true })
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];

  if (!handler) {
    sendResponse({ ok: false, error: `Jenis pesan tidak dikenal: ${message?.type}` });
    return false;
  }

  Promise.resolve()
    .then(() => handler(message))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.warn('[XMT] penanganan pesan gagal', message?.type, error);
      sendResponse({
        ok: false,
        error: error?.message ?? 'Terjadi kesalahan yang tidak terduga.',
        code: error?.code ?? 'unknown',
        permanent: Boolean(error?.permanent)
      });
    });

  return true;
});

/* -------------------------------------------------------------- siklus hidup */

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Memicu pemuatan dan migrasi skema sekali saat pemasangan/pembaruan.
  await store.all();
  console.log(`[XMT] ${NAME} v${VERSION} ${reason === 'install' ? 'terpasang' : 'diperbarui'}`);
});
