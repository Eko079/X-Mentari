#!/usr/bin/env node
/**
 * Memverifikasi manifest.json:
 * - JSON valid
 * - semua path file yang dirujuk benar-benar ada
 * - tidak ada file di src/ yang terlupa didaftarkan (peringatan saja)
 */
import { readFile, access } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let warnings = 0;

function fail(message) {
  failures += 1;
  console.error(`  FAIL  ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`  WARN  ${message}`);
}

async function exists(relativePath) {
  try {
    await access(join(ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(relative(ROOT, full).split(sep).join('/'));
    }
  }
  return out;
}

const manifestRaw = await readFile(join(ROOT, 'manifest.json'), 'utf8');

let manifest;
try {
  manifest = JSON.parse(manifestRaw);
  console.log('  OK    manifest.json adalah JSON valid');
} catch (error) {
  console.error(`  FAIL  manifest.json bukan JSON valid: ${error.message}`);
  process.exit(1);
}

const referenced = new Set();

function collect(path) {
  if (typeof path === 'string' && path.startsWith('src/')) {
    referenced.add(path);
  }
}

collect(manifest.background?.service_worker);
collect(manifest.options_ui?.page);

for (const size of Object.values(manifest.icons ?? {})) collect(size);
for (const size of Object.values(manifest.action?.default_icon ?? {})) collect(size);
collect(manifest.action?.default_popup);

for (const block of manifest.content_scripts ?? []) {
  for (const path of block.js ?? []) collect(path);
  for (const path of block.css ?? []) collect(path);
}

for (const block of manifest.web_accessible_resources ?? []) {
  for (const path of block.resources ?? []) collect(path);
}

console.log(`\nMemeriksa ${referenced.size} path yang dirujuk manifest:`);
for (const path of [...referenced].sort()) {
  if (await exists(path)) {
    console.log(`  OK    ${path}`);
  } else {
    fail(`${path} dirujuk manifest tapi tidak ada di disk`);
  }
}

const onDisk = walk(join(ROOT, 'src')).filter((path) => /\.(js|css)$/.test(path));
const extraAssets = new Set([
  'src/popup/popup.js',
  'src/popup/popup.css',
  'src/options/options.js',
  'src/options/options.css'
]);

console.log('\nMemeriksa file yatim (ada di disk tapi tidak dirujuk):');
let orphans = 0;
for (const path of onDisk) {
  if (referenced.has(path) || extraAssets.has(path)) continue;
  orphans += 1;
  warn(`${path} tidak dirujuk manifest maupun halaman`);
}
if (orphans === 0) console.log('  OK    tidak ada file yatim');

const csp = manifest.content_security_policy?.extension_pages ?? '';
if (csp && !csp.includes("script-src 'self'")) {
  fail("content_security_policy.extension_pages harus memuat script-src 'self'");
} else if (csp) {
  console.log('\n  OK    CSP extension_pages membatasi script ke self');
}

// Halaman opsi dan popup memuat skrip bersama; pastikan referensinya ada.
console.log('\nMemeriksa halaman ekstensi:');
for (const page of ['src/popup/popup.html', 'src/options/options.html']) {
  if (await exists(page)) console.log(`  OK    ${page}`);
  else fail(`${page} tidak ada`);
}

console.log(`\n${failures} error, ${warnings} peringatan`);
process.exit(failures > 0 ? 1 : 0);
