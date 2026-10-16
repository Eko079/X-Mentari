#!/usr/bin/env node
/**
 * Mengemas ekstensi menjadi dist/x-mentari-<versi>.zip
 *
 * Arsip ditulis langsung dengan zlib, tanpa bergantung pada perintah `zip`
 * maupun paket pihak ketiga, sehingga pengemasan berjalan di mana saja
 * Node tersedia.
 *
 * Hanya berkas runtime yang disertakan: manifest.json dan src/.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------ penulis ZIP */

/** Mengubah tanggal menjadi format waktu dan tanggal MS-DOS. */
function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() / 2) & 0x1f);

  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);

  return { time, day };
}

/**
 * Menyusun arsip ZIP dari daftar entri { name, data }.
 *
 * Memakai metode deflate (8) dan header lokal tanpa data descriptor,
 * karena seluruh isi sudah diketahui sebelum ditulis.
 */
function buildZip(entries, date = new Date()) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // tanda header lokal
    local.writeUInt16LE(20, 4); // versi minimum
    local.writeUInt16LE(0x0800, 6); // bendera: nama berkas UTF-8
    local.writeUInt16LE(8, 8); // metode: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // panjang bidang tambahan

    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // tanda direktori pusat
    central.writeUInt16LE(20, 4); // versi pembuat
    central.writeUInt16LE(20, 6); // versi minimum
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // bidang tambahan
    central.writeUInt16LE(0, 32); // komentar
    central.writeUInt16LE(0, 34); // nomor cakram
    central.writeUInt16LE(0, 36); // atribut internal
    central.writeUInt32LE(0o644 << 16, 38); // atribut eksternal
    central.writeUInt32LE(offset, 42);

    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // tanda akhir direktori pusat
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

/* ----------------------------------------------------------- berkas */

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));

const files = [join(ROOT, 'manifest.json'), ...walk(join(ROOT, 'src'))];

const entries = await Promise.all(
  files.map(async (path) => ({
    // Arsip ZIP selalu memakai garis miring maju, apa pun sistem berkasnya.
    name: relative(ROOT, path).split(sep).join('/'),
    data: await readFile(path)
  }))
);

const outDir = join(ROOT, 'dist');
const outFile = join(outDir, `x-mentari-${manifest.version}.zip`);

await rm(outFile, { force: true });
await mkdir(outDir, { recursive: true });
await writeFile(outFile, buildZip(entries));

const total = entries.reduce((sum, entry) => sum + entry.data.length, 0);
const packed = statSync(outFile).size;

console.log(`Paket dibuat: ${outFile}`);
console.log(`${entries.length} berkas, ${(total / 1024).toFixed(0)} KB → ${(packed / 1024).toFixed(0)} KB`);
