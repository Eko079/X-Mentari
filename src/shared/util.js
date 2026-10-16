/**
 * X Mentari — utilitas murni
 *
 * Berisi fungsi tanpa efek samping: teks, waktu, angka, dan pengendali
 * konkurensi. Tidak menyentuh DOM maupun API ekstensi.
 */
(() => {
  if (globalThis.XMTUtil) return;

  /* ---------------------------------------------------------------- waktu */

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Menunda pemanggilan sampai tidak ada panggilan baru selama `wait` ms. */
  function debounce(fn, wait = 150) {
    let timer = null;
    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  }

  /** Membatasi frekuensi pemanggilan menjadi paling cepat sekali per `wait` ms. */
  function throttle(fn, wait = 200) {
    let last = 0;
    let timer = null;
    return (...args) => {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        clearTimeout(timer);
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn(...args);
        }, remaining);
      }
    };
  }

  /* ----------------------------------------------------------- konkurensi */

  /**
   * Menjalankan `worker` untuk setiap item dengan paling banyak `limit`
   * permintaan berjalan bersamaan. Urutan hasil mengikuti urutan masukan.
   * Kegagalan satu item tidak menggagalkan yang lain; hasilnya
   * { ok: true, value } atau { ok: false, error }.
   */
  async function mapLimit(items, limit, worker) {
    const list = Array.from(items);
    const results = new Array(list.length);
    let cursor = 0;

    const size = Math.max(1, Math.min(limit, list.length || 1));

    async function run() {
      while (cursor < list.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = { ok: true, value: await worker(list[index], index) };
        } catch (error) {
          results[index] = { ok: false, error };
        }
      }
    }

    await Promise.all(Array.from({ length: size }, run));
    return results;
  }

  /** Mengambil hanya nilai yang berhasil dari hasil mapLimit. */
  function values(settled) {
    return settled.filter((entry) => entry?.ok).map((entry) => entry.value);
  }

  /**
   * Mencoba ulang dengan jeda yang meningkat. Tidak mengulang bila error
   * ditandai `permanent` — misalnya kunci API tidak valid.
   */
  async function retry(fn, { attempts = 3, baseDelay = 700 } = {}) {
    let lastError;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn(i);
      } catch (error) {
        lastError = error;
        if (error?.permanent || i === attempts - 1) break;
        await sleep(baseDelay * 2 ** i);
      }
    }
    throw lastError;
  }

  /* ------------------------------------------------------------------ teks */

  /** Merapikan spasi dan mengecilkan huruf, untuk keperluan pencocokan. */
  function normalize(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncate(value, max = 160) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
  }

  /**
   * Mengubah HTML menjadi teks biasa yang terbaca.
   *
   * Memakai DOMParser, bukan innerHTML pada dokumen aktif, sehingga
   * skrip dan gambar di dalam HTML tidak pernah dieksekusi atau diminta.
   */
  function htmlToText(html) {
    if (!html) return '';

    const doc = new DOMParser().parseFromString(String(html), 'text/html');

    doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove());

    // Tabel diubah menjadi baris berpemisah pipa agar strukturnya terjaga.
    doc.querySelectorAll('table').forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th, td'))
          .map((cell) => cell.textContent.trim())
          .join(' | ')
      );
      table.replaceWith(doc.createTextNode(`\n${rows.join('\n')}\n`));
    });

    doc.querySelectorAll('img').forEach((img) => {
      const alt = img.getAttribute('alt');
      img.replaceWith(doc.createTextNode(alt ? `[Gambar: ${alt}]` : '[Gambar]'));
    });

    doc.querySelectorAll('br').forEach((br) => br.replaceWith(doc.createTextNode('\n')));

    doc.querySelectorAll('li').forEach((li) => {
      li.prepend(doc.createTextNode('\n- '));
    });

    doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, tr, pre').forEach((block) => {
      block.append(doc.createTextNode('\n'));
    });

    return (doc.body.textContent ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Membuang penanda markdown dari keluaran model. */
  function stripMarkdown(text) {
    return String(text ?? '')
      .replace(/```[\w]*\n?/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  }

  /**
   * Mengambil huruf jawaban dari respons model.
   * Hanya menerima pola eksplisit "Jawaban: X" agar tidak salah menangkap
   * huruf yang kebetulan berdiri sendiri di dalam penjelasan.
   */
  function parseAnswerLetter(text, optionCount = 5) {
    if (!text) return null;

    const maxLetter = String.fromCharCode(64 + Math.max(1, Math.min(optionCount, 26)));
    const range = `A-${maxLetter}`;

    const labelled = String(text).match(
      new RegExp(String.raw`(?:jawaban|answer)\s*[:\-–]?\s*\(?([${range}])\)?`, 'i')
    );
    if (labelled) return labelled[1].toUpperCase();

    // Pola cadangan: huruf tunggal di awal baris, misal "B." atau "(B)".
    const leading = String(text).match(new RegExp(String.raw`^\s*\(?([${range}])\)?[.):\s]`, 'im'));
    return leading ? leading[1].toUpperCase() : null;
  }

  /** Mengambil bagian alasan dari respons model. */
  function parseExplanation(text) {
    if (!text) return '';
    const match = String(text).match(/(?:alasan|explanation|karena)\s*[:\-–]?\s*([\s\S]*)$/i);
    const body = match ? match[1] : String(text).replace(/^.*?(?:jawaban|answer)\s*[:\-–]?\s*\(?[A-Z]\)?\s*/i, '');
    return stripMarkdown(body).trim();
  }

  /** Memisahkan teks menjadi daftar baris tidak kosong. */
  function toLines(text, max = Infinity) {
    return String(text ?? '')
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
      .slice(0, max);
  }

  /* ----------------------------------------------------------------- angka */

  function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  /** Warna semantik untuk persentase kehadiran. */
  function attendanceTone(value) {
    if (value >= 90) return 'success';
    if (value >= 75) return 'accent';
    if (value >= 60) return 'warning';
    return 'danger';
  }

  /* ---------------------------------------------------------------- tanggal */

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /** Waktu relatif singkat, misal "3 jam lalu". */
  function timeAgo(value) {
    if (!value) return '-';
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return String(value);

    const diff = Date.now() - then;
    if (diff < 0) return formatDate(value);

    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return 'baru saja';
    if (diff < hour) return `${Math.floor(diff / minute)} menit lalu`;
    if (diff < day) return `${Math.floor(diff / hour)} jam lalu`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} hari lalu`;
    return formatDate(value);
  }

  /* ------------------------------------------------------------------ lain */

  /** Membuang duplikat berdasarkan hasil `keyFn`. */
  function uniqueBy(items, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of items ?? []) {
      const key = keyFn(item);
      if (key == null || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  /** Membuka pembungkus array yang umum dipakai API kampus. */
  function unwrapArray(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ['data', 'result', 'rows', 'topics', 'replies', 'items']) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    if (Array.isArray(payload?.data?.data)) return payload.data.data;
    return [];
  }

  /** Memilih indeks dari daftar bobot probabilitas. */
  function weightedIndex(weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return 0;
    let roll = Math.random() * total;
    for (let i = 0; i < weights.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  globalThis.XMTUtil = {
    sleep,
    debounce,
    throttle,
    mapLimit,
    values,
    retry,
    normalize,
    truncate,
    htmlToText,
    stripMarkdown,
    parseAnswerLetter,
    parseExplanation,
    toLines,
    percent,
    clamp,
    attendanceTone,
    formatDate,
    formatDateTime,
    timeAgo,
    uniqueBy,
    unwrapArray,
    weightedIndex
  };
})();
