#!/usr/bin/env node
/**
 * Pengujian untuk logika inti X Mentari.
 *
 * Modul shared ditulis sebagai skrip klasik yang menempel ke globalThis,
 * jadi bisa dievaluasi langsung di Node setelah menyediakan sedikit
 * tiruan API peramban yang dipakainya.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------ kerangka uji */

let passed = 0;
let failed = 0;
const failures = [];

/**
 * Menjalankan satu pengujian.
 *
 * Selalu ditunggu, termasuk untuk callback async — tanpa itu pengujian
 * asinkron akan melaporkan lulus sebelum assertion-nya benar-benar jalan,
 * dan kegagalannya muncul sebagai penolakan promise yang tidak tertangani.
 */
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
}

function equal(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(message ? `${message}: ${a} != ${b}` : `${a} != ${b}`);
  }
}

function ok(value, message) {
  if (!value) throw new Error(message ?? `nilai tidak benar: ${value}`);
}

function group(name) {
  console.log(`\n${name}`);
}

/* --------------------------------------------- lingkungan tiruan */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://mentari.unpam.ac.id/u-courses/TEST'
});

// Sediakan API peramban yang dipakai modul shared, lalu evaluasi modulnya
// dalam lingkup global yang sama.
for (const key of [
  'window',
  'document',
  'DOMParser',
  'Node',
  'Event',
  'MutationObserver',
  'CSS',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'getComputedStyle',
  'location',
  'history',
  'navigator',
  'localStorage',
  'sessionStorage'
]) {
  const value = dom.window[key];
  if (value !== undefined) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
}

globalThis.chrome = {
  runtime: { id: 'test-extension' },
  storage: {
    local: (() => {
      let data = {};
      return {
        async get(defaults) {
          const out = { ...defaults };
          for (const key of Object.keys(defaults ?? {})) {
            if (key in data) out[key] = data[key];
          }
          return out;
        },
        async set(patch) {
          data = { ...data, ...patch };
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
        }
      };
    })(),
    onChanged: { addListener() {} }
  }
};

// crypto.randomUUID dipakai providers.normalize untuk id penyedia baru.
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = { randomUUID: () => `id-${Math.random().toString(36).slice(2)}` };
}

async function load(relativePath) {
  const code = await readFile(join(ROOT, relativePath), 'utf8');
  // Modul shared adalah skrip klasik yang menempel ke globalThis, jadi
  // dievaluasi dalam lingkup global uji, bukan diimpor sebagai modul.
  new Function(code).call(globalThis);
}

await load('src/shared/constants.js');
await load('src/shared/storage.js');
await load('src/shared/util.js');
await load('src/shared/dom.js');
await load('src/shared/providers.js');

const C = globalThis.XMT_CONST;
const U = globalThis.XMTUtil;
const D = globalThis.XMTDom;
const S = globalThis.XMTStore;

/* ------------------------------------------------------------- uji */

group('constants');

await test('versi manifest dan konstanta sama', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  equal(C.VERSION, manifest.version, 'versi tidak sinkron');
});

await test('fitur sensitif mati secara bawaan', () => {
  for (const [name, meta] of Object.entries(C.FEATURE_META)) {
    if (!meta.sensitive) continue;
    equal(C.FEATURE_DEFAULTS[name], false, `${name} seharusnya mati secara bawaan`);
  }
});

await test('setiap fitur bawaan punya metadata', () => {
  for (const name of Object.keys(C.FEATURE_DEFAULTS)) {
    ok(C.FEATURE_META[name], `metadata untuk ${name} tidak ada`);
  }
});

await test('setiap preset punya jenis protokol yang dikenal', () => {
  const kinds = new Set(Object.values(C.PROVIDER_KIND));
  for (const preset of C.PRESETS) {
    ok(kinds.has(preset.kind), `preset ${preset.id} punya jenis tidak dikenal`);
  }
});

await test('setiap jenis protokol punya metadata', () => {
  for (const kind of Object.values(C.PROVIDER_KIND)) {
    ok(C.KIND_META[kind], `metadata untuk jenis ${kind} tidak ada`);
  }
});

group('parseAnswerLetter — hanya menerima pola eksplisit');

await test('mengenali "Jawaban: B"', () => {
  equal(U.parseAnswerLetter('Jawaban: B\nAlasan: karena begitu', 4), 'B');
});

await test('mengenali "Jawaban B" tanpa titik dua', () => {
  equal(U.parseAnswerLetter('Jawaban B', 4), 'B');
});

await test('mengenali "Jawaban: (C)"', () => {
  equal(U.parseAnswerLetter('Jawaban: (C)', 4), 'C');
});

await test('mengabaikan huruf yang kebetulan berdiri sendiri di penjelasan', () => {
  // Pola lama mengambil \b([A-E])\b dan akan salah menangkap huruf di sini.
  equal(U.parseAnswerLetter('Opsi B dan C keduanya tampak masuk akal.', 4), null);
});

await test('menolak huruf di luar jangkauan opsi', () => {
  equal(U.parseAnswerLetter('Jawaban: E', 3), null, 'E tidak valid untuk 3 opsi');
});

await test('mengembalikan null untuk teks kosong', () => {
  equal(U.parseAnswerLetter('', 4), null);
});

group('parseExplanation');

await test('mengambil bagian setelah "Alasan:"', () => {
  const text = 'Jawaban: A\nKeyakinan: tinggi\nAlasan: karena definisinya begitu.';
  ok(U.parseExplanation(text).includes('karena definisinya begitu'));
});

await test('membuang baris jawaban bila tidak ada penanda alasan', () => {
  const result = U.parseExplanation('Jawaban: A sebab premisnya benar');
  ok(!result.startsWith('Jawaban'), `masih memuat baris jawaban: ${result}`);
});

group('htmlToText — tidak mengeksekusi apa pun');

await test('membuang tag script beserta isinya', () => {
  const text = U.htmlToText('<p>Aman</p><script>window.hacked = true;</script>');
  ok(!text.includes('hacked'), `isi script masih ada: ${text}`);
  equal(globalThis.hacked, undefined, 'script sempat dievaluasi');
});

await test('mengubah tabel menjadi baris berpemisah', () => {
  const text = U.htmlToText('<table><tr><td>a</td><td>b</td></tr></table>');
  ok(text.includes('a | b'), `tabel tidak terurai: ${text}`);
});

await test('mengganti gambar dengan penanda teks', () => {
  equal(U.htmlToText('<img alt="grafik">'), '[Gambar: grafik]');
});

await test('membuang seluruh tag HTML', () => {
  equal(U.htmlToText('<b>tebal</b>'), 'tebal');
});

group('stripMarkdown');

await test('membuang penanda tebal dan tagar', () => {
  equal(U.stripMarkdown('## Judul **tebal**'), 'Judul tebal');
});

group('percent dan rata-rata kehadiran');

await test('percent membulatkan dengan benar', () => {
  equal(U.percent(1, 3), 33);
  equal(U.percent(2, 3), 67);
});

await test('percent aman terhadap pembagi nol', () => {
  equal(U.percent(0, 0), 0);
});

await test('total kehadiran dihitung dari jumlah pertemuan, bukan rata-rata persen', () => {
  // Dua mata kuliah: 1/1 hadir dan 0/9 hadir.
  // Rata-rata persen keliru menghasilkan 50%; angka yang benar 10%.
  const courses = [
    { present: 1, total: 1 },
    { present: 0, total: 9 }
  ];

  const totalPresent = courses.reduce((sum, c) => sum + c.present, 0);
  const totalMeetings = courses.reduce((sum, c) => sum + c.total, 0);
  const correct = U.percent(totalPresent, totalMeetings);

  const naiveAverage = Math.round(
    courses.reduce((sum, c) => sum + U.percent(c.present, c.total), 0) / courses.length
  );

  equal(correct, 10, 'perhitungan gabungan salah');
  ok(naiveAverage !== correct, 'kedua metode seharusnya berbeda');
});

await test('attendanceTone memetakan ambang dengan benar', () => {
  equal(U.attendanceTone(95), 'success');
  equal(U.attendanceTone(80), 'accent');
  equal(U.attendanceTone(65), 'warning');
  equal(U.attendanceTone(40), 'danger');
});

group('mapLimit — konkurensi terbatas dan tahan kegagalan');

await test('menghormati batas konkurensi', async () => {
  let active = 0;
  let peak = 0;

  const worker = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return true;
  };

  await U.mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, worker);
  ok(peak <= 3, `puncak konkurensi ${peak} melebihi batas 3`);
});

await test('satu kegagalan tidak menggagalkan sisanya', async () => {
  const results = await U.mapLimit([1, 2, 3], 2, async (value) => {
    if (value === 2) throw new Error('gagal');
    return value;
  });

  equal(results.map((entry) => entry.ok), [true, false, true]);
  equal(U.values(results), [1, 3]);
});

await test('urutan hasil mengikuti urutan masukan', async () => {
  const results = await U.mapLimit([30, 10, 20], 3, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms / 10));
    return ms;
  });

  equal(U.values(results), [30, 10, 20]);
});

group('unwrapArray');

await test('membuka berbagai pembungkus API', () => {
  equal(U.unwrapArray([1, 2]), [1, 2]);
  equal(U.unwrapArray({ data: [1] }), [1]);
  equal(U.unwrapArray({ topics: [1] }), [1]);
  equal(U.unwrapArray({ data: { data: [7] } }), [7]);
  equal(U.unwrapArray(null), []);
});

group('uniqueBy dan toLines');

await test('uniqueBy membuang duplikat', () => {
  equal(U.uniqueBy([{ id: 1 }, { id: 1 }, { id: 2 }], (x) => x.id).length, 2);
});

await test('toLines membuang bullet dan penomoran', () => {
  equal(U.toLines('1. satu\n- dua\n\n• tiga'), ['satu', 'dua', 'tiga']);
});

group('weightedIndex');

await test('selalu mengembalikan indeks yang valid', () => {
  for (let i = 0; i < 200; i += 1) {
    const index = U.weightedIndex([0, 0.65, 0.35]);
    ok(index >= 0 && index <= 2, `indeks di luar jangkauan: ${index}`);
  }
});

await test('tidak pernah memilih bobot nol', () => {
  for (let i = 0; i < 200; i += 1) {
    ok(U.weightedIndex([0, 1]) === 1, 'memilih entri berbobot nol');
  }
});

group('XMTDom.el — tidak ada jalur innerHTML');

await test('teks dimasukkan sebagai teks, bukan markup', () => {
  const node = D.el('div', { text: '<img src=x onerror=alert(1)>' });
  equal(node.children.length, 0, 'markup terurai menjadi elemen');
  ok(node.textContent.includes('<img'), 'teks tidak utuh');
});

await test('atribut dataset kosong tidak menghasilkan "undefined"', () => {
  const node = D.el('div', { dataset: { tone: undefined, size: 'sm' } });
  equal(node.dataset.tone, undefined);
  equal(node.dataset.size, 'sm');
});

await test('anak bernilai kosong diabaikan', () => {
  const node = D.el('div', {}, [null, false, '', D.el('span')]);
  equal(node.children.length, 1);
});

await test('array bersarang dirata', () => {
  const node = D.el('div', {}, [[D.el('span'), D.el('span')], D.el('span')]);
  equal(node.children.length, 3);
});

group('XMTStore — penyedia dan flag fitur');

await test('tidak ada penyedia pada keadaan awal', async () => {
  equal(await S.providers(), []);
  equal(await S.activeProvider(), null);
  equal(await S.hasProvider(), false);
});

await test('menambah penyedia dan menjadikannya aktif otomatis', async () => {
  await S.upsertProvider({
    id: 'p1',
    name: 'Gemini',
    kind: C.PROVIDER_KIND.GEMINI,
    baseUrl: 'https://example.com/v1',
    apiKey: 'AIza-contoh',
    model: 'gemini-2.0-flash',
    models: []
  });

  const active = await S.activeProvider();
  equal(active?.id, 'p1', 'penyedia pertama tidak otomatis aktif');
  equal(await S.hasProvider(), true);
});

await test('memperbarui penyedia yang sudah ada, bukan menduplikasi', async () => {
  await S.upsertProvider({ id: 'p1', name: 'Gemini X', kind: C.PROVIDER_KIND.GEMINI, baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'm', models: [] });
  const list = await S.providers();
  equal(list.length, 1, 'penyedia terduplikasi');
  equal(list[0].name, 'Gemini X');
});

await test('penyedia lokal dianggap siap tanpa kunci', async () => {
  await S.upsertProvider({
    id: 'local',
    name: 'Ollama',
    kind: C.PROVIDER_KIND.OPENAI,
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3.2',
    models: [],
    keyOptional: true
  });
  await S.setActiveProvider('local');
  equal(await S.hasProvider(), true, 'penyedia lokal seharusnya siap tanpa kunci');
});

await test('menghapus penyedia aktif memindahkan aktif ke yang tersisa', async () => {
  await S.removeProvider('local');
  const active = await S.activeProvider();
  equal(active?.id, 'p1', 'aktif tidak berpindah setelah penghapusan');
});

await test('flag fitur baru mendapat nilai bawaan', async () => {
  await S.set(C.KEYS.FEATURES, { forumTracker: false });
  const features = await S.features();
  equal(features.forumTracker, false, 'nilai tersimpan tidak dipakai');
  equal(features.presensi, C.FEATURE_DEFAULTS.presensi, 'fitur lain kehilangan bawaan');
});

await test('setFeature mengubah satu flag saja', async () => {
  await S.setFeature('quizHelper', true);
  const features = await S.features();
  equal(features.quizHelper, true);
  equal(features.forumTracker, false, 'flag lain ikut berubah');
});

group('XMTProviders — adapter membentuk permintaan');

const PR = globalThis.XMTProviders;

await test('validate menolak konfigurasi tak lengkap', () => {
  equal(PR.validate({ name: '', baseUrl: '', model: '' }).valid, false);
  equal(PR.validate({ name: 'A', baseUrl: 'bukan-url', model: 'm', apiKey: 'k' }).valid, false);
  equal(
    PR.validate({ name: 'A', baseUrl: 'https://x/v1', model: 'm', apiKey: 'k', kind: C.PROVIDER_KIND.OPENAI }).valid,
    true
  );
});

await test('validate mengizinkan penyedia lokal tanpa kunci', () => {
  const result = PR.validate({
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    apiKey: '',
    kind: C.PROVIDER_KIND.OPENAI,
    keyOptional: true
  });
  equal(result.valid, true);
});

await test('adapter Gemini menaruh kunci di header, bukan URL', () => {
  const provider = PR.normalize({
    kind: C.PROVIDER_KIND.GEMINI,
    baseUrl: 'https://gen.example.com/v1beta',
    apiKey: 'AIza-rahasia',
    model: 'gemini-2.0-flash'
  });
  const spec = PR.adapterFor(provider).buildRequest(provider, { prompt: 'halo' });

  ok(!spec.url.includes('AIza-rahasia'), 'kunci bocor ke URL');
  equal(spec.headers['x-goog-api-key'], 'AIza-rahasia');
  ok(spec.url.endsWith(':generateContent'), 'endpoint Gemini salah');
});

await test('adapter OpenAI memakai Authorization Bearer dan /chat/completions', () => {
  const provider = PR.normalize({
    kind: C.PROVIDER_KIND.OPENAI,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-xyz',
    model: 'gpt-4o-mini'
  });
  const spec = PR.adapterFor(provider).buildRequest(provider, {
    prompt: 'halo',
    system: 'jadilah ringkas'
  });

  equal(spec.headers.authorization, 'Bearer sk-xyz');
  ok(spec.url.endsWith('/chat/completions'));
  equal(spec.body.messages[0].role, 'system');
  equal(spec.body.messages.at(-1).content, 'halo');
});

await test('adapter OpenAI tanpa kunci tidak mengirim Authorization (lokal)', () => {
  const provider = PR.normalize({
    kind: C.PROVIDER_KIND.OPENAI,
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3.2',
    keyOptional: true
  });
  const spec = PR.adapterFor(provider).buildRequest(provider, { prompt: 'halo' });
  equal(spec.headers.authorization, undefined);
});

await test('adapter Anthropic memakai x-api-key dan header versi', () => {
  const provider = PR.normalize({
    kind: C.PROVIDER_KIND.ANTHROPIC,
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-xyz',
    model: 'claude-3-5-haiku'
  });
  const spec = PR.adapterFor(provider).buildRequest(provider, { prompt: 'halo' });

  equal(spec.headers['x-api-key'], 'sk-ant-xyz');
  ok(spec.headers['anthropic-version'], 'header versi hilang');
  ok(spec.url.endsWith('/messages'));
});

await test('header tambahan ikut disertakan', () => {
  const provider = PR.normalize({
    kind: C.PROVIDER_KIND.OPENAI,
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: 'sk-or',
    model: 'x',
    headers: { 'HTTP-Referer': 'https://situs' }
  });
  const spec = PR.adapterFor(provider).buildRequest(provider, { prompt: 'p' });
  equal(spec.headers['HTTP-Referer'], 'https://situs');
});

await test('parseResponse membaca teks dari tiap protokol', () => {
  equal(
    PR.KINDS[C.PROVIDER_KIND.GEMINI].parseResponse({
      candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }]
    }).text,
    'ab'
  );
  equal(
    PR.KINDS[C.PROVIDER_KIND.OPENAI].parseResponse({ choices: [{ message: { content: 'halo' } }] }).text,
    'halo'
  );
  equal(
    PR.KINDS[C.PROVIDER_KIND.ANTHROPIC].parseResponse({ content: [{ type: 'text', text: 'hai' }] }).text,
    'hai'
  );
});

await test('parseModels menyaring model tiap protokol', () => {
  equal(
    PR.KINDS[C.PROVIDER_KIND.OPENAI].parseModels({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
    ['gpt-4o', 'gpt-4o-mini']
  );
  equal(
    PR.KINDS[C.PROVIDER_KIND.GEMINI].parseModels({
      models: [
        { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }
      ]
    }),
    ['gemini-2.0-flash']
  );
});

await test('originPattern menghasilkan pola izin host', () => {
  equal(PR.originPattern('https://api.example.com/v1'), 'https://api.example.com/*');
  equal(PR.originPattern('http://localhost:11434/v1'), 'http://localhost:11434/*');
  equal(PR.originPattern('bukan-url'), null);
});

group('migrasi skema v1 → v2');

await test('kunci Gemini lama menjadi penyedia aktif', async () => {
  // Simulasi penyimpanan versi 1: apiKey + model, tanpa penyedia.
  const legacyStore = (() => {
    let data = { apiKey: 'AIza-lama', model: 'gemini-1.5-flash' };
    return {
      async get(defaults) {
        const out = { ...defaults };
        for (const key of Object.keys(defaults ?? {})) if (key in data) out[key] = data[key];
        return out;
      },
      async set(patch) {
        data = { ...data, ...patch };
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      },
      _data: () => data
    };
  })();

  const savedLocal = globalThis.chrome.storage.local;
  globalThis.chrome.storage.local = legacyStore;

  // Muat ulang modul storage agar cache-nya kosong dan migrasi berjalan.
  delete globalThis.XMTStore;
  await load('src/shared/storage.js');
  const migratedStore = globalThis.XMTStore;

  const providers = await migratedStore.providers();
  equal(providers.length, 1, 'kunci lama tidak dimigrasi menjadi penyedia');
  equal(providers[0].apiKey, 'AIza-lama');
  equal(providers[0].model, 'gemini-1.5-flash');
  equal((await migratedStore.activeProvider())?.id, providers[0].id);
  equal(legacyStore._data().apiKey, undefined, 'kunci lama tidak dibersihkan');

  // Pulihkan store dan storage untuk blok tes berikutnya.
  globalThis.chrome.storage.local = savedLocal;
  delete globalThis.XMTStore;
  await load('src/shared/storage.js');
});

group('normalizeToken — membersihkan pembungkus');

await load('src/shared/campus.js');
const A = globalThis.XMTApi;

await test('membuang pembungkus Quasar', () => {
  const jwt = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  equal(A.normalizeToken(`__q_strn|${jwt}`), jwt);
});

await test('membuang prefix Bearer', () => {
  const jwt = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  equal(A.normalizeToken(`Bearer ${jwt}`), jwt);
});

await test('mengambil token dari JSON bersarang', () => {
  const jwt = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  equal(A.normalizeToken(JSON.stringify({ data: { accessToken: jwt } })), jwt);
});

await test('menolak nilai yang terlalu pendek', () => {
  equal(A.normalizeToken('abc'), null);
});

await test('menerima token non-JWT yang cukup panjang', () => {
  const opaque = 'x'.repeat(40);
  equal(A.normalizeToken(opaque), opaque);
});

await test('mengambil token dari array [{ role, token }] MENTARI', () => {
  const jwt = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  const access = JSON.stringify([{ role: 'MAHASISWA', token: jwt }]);
  equal(A.normalizeToken(access), jwt);
});

group('readMentariAccess — token dari localStorage access/accessIndex');

await test('mengambil token entri sesuai accessIndex', () => {
  const jwtA = `${'a'.repeat(20)}.${'a'.repeat(20)}.${'a'.repeat(20)}`;
  const jwtB = `${'b'.repeat(20)}.${'b'.repeat(20)}.${'b'.repeat(20)}`;
  localStorage.setItem('access', JSON.stringify([{ token: jwtA }, { token: jwtB }]));
  localStorage.setItem('accessIndex', '1');
  equal(A.readMentariAccess(), jwtB);
});

await test('jatuh ke indeks 0 bila accessIndex tidak ada', () => {
  const jwt = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
  localStorage.setItem('access', JSON.stringify([{ token: jwt }]));
  localStorage.removeItem('accessIndex');
  equal(A.readMentariAccess(), jwt);
});

await test('mengembalikan null bila access kosong atau bukan array', () => {
  localStorage.removeItem('access');
  localStorage.removeItem('accessIndex');
  equal(A.readMentariAccess(), null);
  localStorage.setItem('access', JSON.stringify({ token: 'x' }));
  equal(A.readMentariAccess(), null);
  localStorage.removeItem('access');
});

/* ---------------------------------------------------------- ringkasan */

console.log(`\n${passed} lulus, ${failed} gagal`);

if (failed > 0) {
  console.error('\nRingkasan kegagalan:');
  for (const { name, error } of failures) {
    console.error(`  ${name}\n    ${error.stack?.split('\n')[0] ?? error.message}`);
  }
  process.exit(1);
}
