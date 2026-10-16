#!/usr/bin/env node
/**
 * Uji asap: memuat setiap rantai content script dalam urutan yang
 * ditentukan manifest, di dalam DOM tiruan, dan memastikan tidak ada yang
 * melempar serta seluruh objek global yang diharapkan terdaftar.
 *
 * Menangkap kesalahan urutan dan ketergantungan yang tidak terlihat oleh
 * pemeriksaan statis.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));

let failed = 0;

/** Menyiapkan lingkungan sebuah tab beserta tiruan API ekstensi. */
function makeEnvironment(url) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <header>
         <div class="MuiStack-root">
           <button><svg data-testid="DarkModeIcon"></svg></button>
         </div>
       </header>
       <div class="MuiPaper-root">Konten uji</div>
     </body></html>`,
    {
      url,
      pretendToBeVisual: true,
      // Diperlukan agar skrip bisa dievaluasi di dalam lingkup jendela
      // tiruan, sebagaimana content script berjalan di tab sungguhan.
      runScripts: 'dangerously'
    }
  );

  const errors = [];
  dom.window.addEventListener('error', (event) => errors.push(event.error ?? event.message));
  dom.window.addEventListener('unhandledrejection', (event) => errors.push(event.reason));

  let stored = {};

  const chrome = {
    runtime: {
      id: 'smoke-test',
      getURL: (path) => `chrome-extension://smoke/${path}`,
      onMessage: { addListener() {} },
      sendMessage: async () => ({ ok: true, data: {} }),
      openOptionsPage() {}
    },
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        return true;
      }
    },
    storage: {
      local: {
        async get(defaults) {
          const out = { ...defaults };
          for (const key of Object.keys(defaults ?? {})) {
            if (key in stored) out[key] = stored[key];
          }
          return out;
        },
        async set(patch) {
          stored = { ...stored, ...patch };
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
        }
      },
      onChanged: { addListener() {} }
    }
  };

  // Content script berjalan dengan `window` sebagai objek globalnya, jadi
  // modul dievaluasi di dalam konteks jendela tiruan, bukan di globalThis
  // milik Node.
  dom.window.chrome = chrome;

  return { dom, errors, context: dom.getInternalVMContext() };
}

async function runChain(label, block) {
  const url = block.matches[0]
    .replace('*://', 'https://')
    .replace(/\*$/, '')
    .replace('/*', '/u-courses/TEST/forum/1/topics/2');

  const { dom, errors, context } = makeEnvironment(url);

  console.log(`\n${label}`);
  console.log(`  url   ${url}`);

  for (const path of block.js) {
    const code = await readFile(join(ROOT, path), 'utf8');

    try {
      runInContext(code, context, { filename: path });
      console.log(`  ok    ${path}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL  ${path}`);
      console.error(`        ${error.message}`);
      if (error.stack) {
        console.error(
          `        ${error.stack.split('\n').slice(1, 3).join('\n        ')}`
        );
      }
    }
  }

  // Beri kesempatan init() yang asinkron menyelesaikan pekerjaannya.
  await new Promise((resolve) => setTimeout(resolve, 120));

  if (errors.length > 0) {
    failed += errors.length;
    console.error(`  FAIL  ${errors.length} galat tak tertangani saat inisialisasi`);
    for (const error of errors) {
      console.error(`        ${error?.message ?? error}`);
    }
  }

  return dom;
}

/* ------------------------------------------------------------ rantai */

const [mentariBlock, myunpamBlock, loginBlock] = manifest.content_scripts;

const mentari = await runChain('MENTARI', mentariBlock);

for (const name of [
  'XMT_CONST',
  'XMTStore',
  'XMTUtil',
  'XMTDom',
  'XMTApi',
  'XMTAI',
  'XMTUI'
]) {
  if (mentari.window[name]) {
    console.log(`  ok    global ${name} terdaftar`);
  } else {
    failed += 1;
    console.error(`  FAIL  global ${name} tidak terdaftar`);
  }
}

// Fitur yang aktif secara bawaan harus mendaftarkan antarmukanya.
for (const name of ['XMTSettings', 'XMTGuide', 'XMTForum', 'XMTAssistant']) {
  if (mentari.window[name]) {
    console.log(`  ok    fitur ${name} terpasang`);
  } else {
    failed += 1;
    console.error(`  FAIL  fitur ${name} tidak terpasang`);
  }
}

// Fitur sensitif mati secara bawaan, jadi tidak boleh terpasang.
for (const name of ['XMTQuiz', 'XMTSurvey']) {
  if (mentari.window[name]) {
    failed += 1;
    console.error(`  FAIL  ${name} terpasang padahal fiturnya mati secara bawaan`);
  } else {
    console.log(`  ok    ${name} tidak terpasang (fitur mati secara bawaan)`);
  }
}

// Tombol toolbar harus tersisip pada jangkar tombol tema.
const toolbarButtons = mentari.window.document.querySelectorAll('.xmt-header-btn');
if (toolbarButtons.length > 0) {
  console.log(`  ok    ${toolbarButtons.length} tombol toolbar tersisip`);

  const ids = Array.from(toolbarButtons).map((node) => node.id);
  const stack = mentari.window.document.querySelector('.MuiStack-root');
  const inStack = Array.from(toolbarButtons).every((node) => stack.contains(node));

  if (inStack) console.log(`  ok    tombol berada di dalam toolbar: ${ids.join(', ')}`);
  else {
    failed += 1;
    console.error('  FAIL  tombol tidak tersisip di dalam toolbar');
  }
} else {
  failed += 1;
  console.error('  FAIL  tidak ada tombol toolbar yang tersisip');
}

const myunpam = await runChain('MY UNPAM', myunpamBlock);

if (myunpam.window.XMTPresensi) {
  console.log('  ok    fitur XMTPresensi terpasang');
} else {
  failed += 1;
  console.error('  FAIL  fitur XMTPresensi tidak terpasang');
}

const fabs = myunpam.window.document.querySelectorAll('.xmt-fab');
if (fabs.length > 0) console.log(`  ok    ${fabs.length} tombol apung terpasang`);
else {
  failed += 1;
  console.error('  FAIL  tombol apung presensi tidak terpasang');
}

await runChain('Halaman login', loginBlock);

/* -------------------------------------------------- halaman opsi */

// Halaman opsi tidak terdaftar di content_scripts; ia memuat skrip lewat
// tag <script> di HTML-nya. Uji rantai itu di sini agar ketergantungan pada
// XMTUI (yang berasal dari content/base.js) tidak putus tanpa ketahuan.
{
  const dom = new JSDOM(
    `<!doctype html><html><body class="xmt-scope">
       <div id="opt-intro"></div>
       <div id="opt-list"></div>
       <div id="opt-editor"></div>
       <button id="opt-add"></button>
       <div id="opt-foot"></div>
     </body></html>`,
    { url: 'chrome-extension://smoke/src/options/options.html', pretendToBeVisual: true, runScripts: 'dangerously' }
  );

  const errors = [];
  dom.window.addEventListener('error', (event) => errors.push(event.error ?? event.message));
  dom.window.addEventListener('unhandledrejection', (event) => errors.push(event.reason));

  let stored = {};
  dom.window.chrome = {
    runtime: {
      id: 'smoke-test',
      getURL: (path) => path,
      onMessage: { addListener() {} },
      sendMessage: async () => ({ ok: true, data: {} }),
      openOptionsPage() {}
    },
    permissions: { async contains() { return true; }, async request() { return true; } },
    storage: {
      local: {
        async get(defaults) {
          const out = { ...defaults };
          for (const key of Object.keys(defaults ?? {})) if (key in stored) out[key] = stored[key];
          return out;
        },
        async set(patch) { stored = { ...stored, ...patch }; },
        async remove(keys) { for (const key of [].concat(keys)) delete stored[key]; }
      },
      onChanged: { addListener() {} }
    }
  };

  const context = dom.getInternalVMContext();

  console.log('\nHalaman opsi');

  const optionScripts = [
    'src/shared/constants.js',
    'src/shared/storage.js',
    'src/shared/util.js',
    'src/shared/dom.js',
    'src/shared/providers.js',
    'src/shared/ai.js',
    'src/content/base.js',
    'src/options/options.js'
  ];

  for (const path of optionScripts) {
    try {
      runInContext(await readFile(join(ROOT, path), 'utf8'), context, { filename: path });
      console.log(`  ok    ${path}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL  ${path}: ${error.message}`);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 150));

  if (dom.window.XMTUI) console.log('  ok    XMTUI tersedia di halaman opsi');
  else {
    failed += 1;
    console.error('  FAIL  XMTUI tidak tersedia — tombol tidak akan berfungsi');
  }

  // Klik tombol Tambah penyedia harus membuka dialog preset.
  dom.window.document.getElementById('opt-add').click();
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (dom.window.document.querySelector('.xmt-modal')) {
    console.log('  ok    tombol Tambah penyedia membuka dialog');
  } else {
    failed += 1;
    console.error('  FAIL  tombol Tambah penyedia tidak membuka dialog');
  }

  if (errors.length > 0) {
    failed += errors.length;
    console.error(`  FAIL  ${errors.length} galat saat memuat halaman opsi`);
    for (const error of errors) console.error(`        ${error?.message ?? error}`);
  }
}

/* --------------------------------------------------------- ringkasan */

console.log(`\n${failed === 0 ? 'Uji asap lulus.' : `${failed} masalah ditemukan.`}`);
process.exit(failed > 0 ? 1 : 0);
