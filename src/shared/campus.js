/**
 * X Mentari — akses API kampus
 *
 * Dua tanggung jawab:
 *   1. Menemukan token autentikasi yang dipakai aplikasi kampus.
 *   2. Membungkus endpoint MENTARI dan MY UNPAM yang dipakai fitur.
 *
 * Semua permintaan memakai kredensial dan token milik pengguna sendiri;
 * tidak ada data yang dikirim ke pihak ketiga.
 */
(() => {
  if (globalThis.XMTApi) return;

  const { API, LIMITS } = globalThis.XMT_CONST;
  const { unwrapArray, mapLimit, values } = globalThis.XMTUtil;
  const { cookie } = globalThis.XMTDom;

  /* --------------------------------------------------------- token */

  /** Petunjuk pada nama kunci penyimpanan yang mungkin memuat token. */
  const KEY_HINTS = ['token', 'auth', 'bearer', 'session', 'credential', 'access'];

  /** Petunjuk pada isi nilai: prefix JWT, pembungkus Quasar, prefix Bearer. */
  const VALUE_HINTS = ['eyj', 'bearer ', '__q_strn|'];

  /**
   * Membersihkan token dari pembungkus yang mungkin melekat.
   *
   * MY UNPAM memakai Quasar yang membungkus nilai dengan `__q_strn|`.
   * MENTARI kadang menyimpan token di dalam JSON bersarang.
   */
  function normalizeToken(raw, depth = 0) {
    if (!raw || depth > 3) return null;

    let token = String(raw).trim();
    if (!token) return null;

    if (token.includes('__q_strn|')) {
      token = token.split('__q_strn|').pop().trim();
    }

    if (/^bearer\s+/i.test(token)) {
      token = token.replace(/^bearer\s+/i, '').trim();
    }

    const looksJson =
      (token.startsWith('{') && token.endsWith('}')) ||
      (token.startsWith('[') && token.endsWith(']')) ||
      (token.startsWith('"') && token.endsWith('"'));

    if (looksJson) {
      try {
        const parsed = JSON.parse(token);
        if (typeof parsed === 'string') return normalizeToken(parsed, depth + 1);

        // MENTARI menyimpan token sebagai array [{ role, token }]. Ambil entri
        // pertama yang punya token; pemilihan indeks aktif ditangani terpisah
        // di readMentariAccess().
        if (Array.isArray(parsed)) {
          const entry = parsed.find((item) => item?.token || item?.accessToken || item?.access_token);
          const nestedArr = entry?.token ?? entry?.accessToken ?? entry?.access_token;
          if (nestedArr) return normalizeToken(nestedArr, depth + 1);
          return null;
        }

        const nested =
          parsed?.accessToken ??
          parsed?.access_token ??
          parsed?.token ??
          parsed?.data?.accessToken ??
          parsed?.data?.access_token ??
          parsed?.data?.token;

        if (nested) return normalizeToken(nested, depth + 1);
      } catch {
        // Bukan JSON valid; lanjut pakai nilai apa adanya.
      }
    }

    // JWT punya tiga segmen. Nilai lain diterima bila cukup panjang untuk
    // menjadi token, agar skema non-JWT tetap tertangkap.
    const isJwt = token.split('.').length >= 3;
    if (isJwt || token.length >= 24) return token;

    return null;
  }

  function collectFromStorage(storage) {
    const found = [];
    let keys;

    try {
      keys = Object.keys(storage);
    } catch {
      return found;
    }

    for (const key of keys) {
      let value = '';
      try {
        value = storage.getItem(key) ?? '';
      } catch {
        continue;
      }
      if (!value) continue;

      const lowerKey = key.toLowerCase();
      const lowerValue = value.toLowerCase();

      const keyMatch = KEY_HINTS.some((hint) => lowerKey.includes(hint));
      const valueMatch = VALUE_HINTS.some((hint) => lowerValue.includes(hint));
      if (!keyMatch && !valueMatch) continue;

      const token = normalizeToken(value);
      // Prioritaskan yang namanya jelas menyebut token, agar tidak
      // memilih nilai lain yang kebetulan panjang.
      if (token) found.push({ token, score: keyMatch ? 2 : 1 });
    }

    return found;
  }

  function collectFromCookies() {
    const found = [];
    for (const chunk of document.cookie ? document.cookie.split(';') : []) {
      const [rawKey, ...rest] = chunk.trim().split('=');
      const key = String(rawKey ?? '').toLowerCase();
      const value = rest.join('=');
      if (!value) continue;

      const keyMatch = KEY_HINTS.some((hint) => key.includes(hint));
      const valueMatch = VALUE_HINTS.some((hint) => value.toLowerCase().includes(hint));
      if (!keyMatch && !valueMatch) continue;

      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // Pakai nilai mentah bila tidak bisa didekode.
      }

      const token = normalizeToken(decoded);
      if (token) found.push({ token, score: keyMatch ? 2 : 1 });
    }
    return found;
  }

  let cachedToken = null;

  /**
   * Membaca token dengan skema resmi aplikasi MENTARI.
   *
   * Aplikasi menyimpan `localStorage["access"]` sebagai array
   * `[{ role, token }]` dan `localStorage["accessIndex"]` sebagai indeks akun
   * aktif. Header dibangun sebagai `Bearer access[accessIndex].token`.
   * Membaca persis seperti ini jauh lebih andal daripada memindai heuristik,
   * dan menghindari salah ambil (mengambil seluruh array sebagai token).
   */
  function readMentariAccess() {
    let raw;
    try {
      raw = localStorage.getItem('access');
    } catch {
      return null;
    }
    if (!raw) return null;

    let list;
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(list) || list.length === 0) return null;

    let index = 0;
    try {
      const rawIndex = localStorage.getItem('accessIndex');
      const parsedIndex = Number(rawIndex);
      if (Number.isInteger(parsedIndex) && parsedIndex >= 0 && parsedIndex < list.length) {
        index = parsedIndex;
      }
    } catch {
      // Pakai indeks 0 bila accessIndex tidak terbaca.
    }

    const token = list[index]?.token ?? list.find((item) => item?.token)?.token;
    return token ? normalizeToken(token) : null;
  }

  /**
   * Mencari token dari localStorage, sessionStorage, dan cookie.
   *
   * Pendekatan berlapis dipilih karena nama kunci berbeda antar portal dan
   * bisa berubah kapan saja; memindai dengan petunjuk lebih tahan
   * dibanding menebak beberapa nama tetap.
   */
  function resolveToken({ fresh = false } = {}) {
    if (cachedToken && !fresh) return cachedToken;

    // Skema resmi MENTARI didahulukan: hasilnya paling tepat dan menghindari
    // salah ambil dari pemindaian heuristik.
    const official = readMentariAccess();
    if (official) {
      cachedToken = official;
      return cachedToken;
    }

    const candidates = [
      ...collectFromStorage(localStorage),
      ...collectFromStorage(sessionStorage),
      ...collectFromCookies()
    ];

    if (candidates.length === 0) {
      cachedToken = null;
      return null;
    }

    // Skor petunjuk nama lebih dulu, lalu token terpanjang: JWT lengkap
    // hampir selalu lebih panjang daripada potongan yang tidak lengkap.
    candidates.sort((a, b) => b.score - a.score || b.token.length - a.token.length);
    cachedToken = candidates[0].token;
    return cachedToken;
  }

  function clearTokenCache() {
    cachedToken = null;
  }

  /* ----------------------------------------------------------- HTTP */

  class ApiError extends Error {
    constructor(message, { status = 0, url = '' } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.url = url;
      this.permanent = status === 401 || status === 403;
    }
  }

  function describeStatus(status) {
    if (status === 401 || status === 403) return 'Sesi login sudah berakhir. Muat ulang halaman dan login lagi.';
    if (status === 404) return 'Data tidak ditemukan di server kampus.';
    if (status === 419) return 'Token keamanan kedaluwarsa. Muat ulang halaman.';
    if (status === 429) return 'Terlalu banyak permintaan ke server kampus. Coba lagi sebentar.';
    if (status >= 500) return 'Server kampus sedang bermasalah.';
    return `Permintaan gagal (HTTP ${status}).`;
  }

  /**
   * GET JSON dengan header autentikasi.
   *
   * Header XSRF disertakan karena MY UNPAM memvalidasinya; tanpa itu
   * sebagian endpoint menolak permintaan dengan 419.
   */
  async function getJson(url, { token, signal } = {}) {
    const auth = token ?? resolveToken();
    if (!auth) throw new ApiError('Token login tidak ditemukan.', { url });

    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${auth}`
    };

    const xsrf = cookie('XSRF-TOKEN');
    if (xsrf) headers['x-xsrf-token'] = xsrf;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal
    });

    if (!response.ok) {
      // Token mungkin sudah diganti aplikasi; paksa pencarian ulang.
      if (response.status === 401 || response.status === 403) clearTokenCache();
      throw new ApiError(describeStatus(response.status), { status: response.status, url });
    }

    return response.json();
  }

  /**
   * PUT/POST JSON dengan header autentikasi yang sama seperti getJson.
   *
   * Dipakai oleh operasi yang mengubah data di server (memulai kuis,
   * mengirim jawaban, mengakhiri kuis). Karena ini menulis atas nama
   * pengguna, pemanggil bertanggung jawab memastikan pengguna sudah
   * menyetujuinya.
   */
  async function sendJson(url, body, { method = 'PUT', token, signal } = {}) {
    const auth = token ?? resolveToken();
    if (!auth) throw new ApiError('Token login tidak ditemukan.', { url });

    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${auth}`
    };

    const xsrf = cookie('XSRF-TOKEN');
    if (xsrf) headers['x-xsrf-token'] = xsrf;

    const response = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: body == null ? undefined : JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) clearTokenCache();
      throw new ApiError(describeStatus(response.status), { status: response.status, url });
    }

    // Sebagian endpoint membalas tanpa body; jangan paksa JSON.parse gagal.
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /* ------------------------------------------------------- MENTARI */

  const mentari = {
    /** Daftar ringkas mata kuliah yang diambil pengguna. */
    async courses({ signal } = {}) {
      const payload = await getJson(`${API.MENTARI_BASE}/user-course?page=1&limit=50`, { signal });
      return unwrapArray(payload);
    },

    /** Detail satu mata kuliah beserta section dan sub-section-nya. */
    async course(code, { signal } = {}) {
      return getJson(`${API.MENTARI_BASE}/user-course/${encodeURIComponent(code)}`, { signal });
    },

    /** Topik di dalam satu forum. */
    async forumTopics(forumId, { signal } = {}) {
      const payload = await getJson(`${API.MENTARI_BASE}/forum/topic/${encodeURIComponent(forumId)}`, {
        signal
      });
      const topics = Array.isArray(payload?.topics) ? payload.topics : unwrapArray(payload);
      return topics.filter(
        (topic) =>
          topic?.id_trx_course_sub_section == null ||
          String(topic.id_trx_course_sub_section) === String(forumId)
      );
    },

    /** Balasan pada satu topik beserta informasi pengirimnya. */
    async forumReplies(topicId, { signal } = {}) {
      const payload = await getJson(`${API.MENTARI_BASE}/forum/reply/${encodeURIComponent(topicId)}`, {
        signal
      });
      return Array.isArray(payload?.replies) ? payload.replies : unwrapArray(payload);
    },

    /** Profil mahasiswa yang login (NIM, nama, dll). */
    async studentProfile({ signal } = {}) {
      try {
        const payload = await getJson(`${API.MENTARI_BASE}/profile`, { signal });
        return payload?.data ?? payload ?? {};
      } catch {
        return {};
      }
    },

    /** Soal pada satu kuis atau ujian. */
    async quizQuestions(quizId, { signal } = {}) {
      const payload = await getJson(`${API.MENTARI_BASE}/quiz/soal/${encodeURIComponent(quizId)}`, {
        signal
      });
      return unwrapArray(payload);
    },

    /**
     * Memulai (atau mereset) sesi pengerjaan kuis.
     *
     * Server memberi setiap soal sebuah id sesi (id_trx_quiz_user_soal) yang
     * wajib disertakan saat mengirim jawaban. `reset: true` mengikuti perilaku
     * aplikasi kampus saat pengguna memulai ulang.
     */
    async quizStart(quizId, { reset = true, signal } = {}) {
      return sendJson(
        `${API.MENTARI_BASE}/quiz/start/${encodeURIComponent(quizId)}`,
        { id_trx_course_sub_section: quizId, reset },
        { method: 'PUT', signal }
      );
    },

    /**
     * Mengirim satu jawaban.
     *
     * `soalSessionId` adalah id sesi soal dari respons setelah kuis dimulai,
     * dan `answerId` adalah id_jawaban dari salah satu entri list_jawaban.
     */
    async quizAnswer({ soalSessionId, answerId, text = null, signal } = {}) {
      return sendJson(
        `${API.MENTARI_BASE}/quiz/jawab`,
        { id_trx_quiz_user_soal: soalSessionId, id_jawaban: answerId, jawaban: text },
        { method: 'PUT', signal }
      );
    },

    /** Mengakhiri sesi kuis (setara menekan "Selesai" di aplikasi). */
    async quizEnd(quizId, { signal } = {}) {
      return sendJson(
        `${API.MENTARI_BASE}/quiz/end`,
        { id_trx_course_sub_section: quizId },
        { method: 'PUT', signal }
      );
    },

    /**
     * Mengambil detail seluruh mata kuliah secara paralel terbatas.
     * Satu kegagalan tidak menggagalkan sisanya.
     */
    async allCourseDetails({ signal, onStep } = {}) {
      const summaries = await mentari.courses({ signal });
      const codes = summaries.map((item) => item?.kode_course).filter(Boolean);

      const settled = await mapLimit(codes, LIMITS.CONCURRENCY, async (code) => {
        try {
          onStep?.({ phase: 'course-start', code });
        } catch {
          // Callback progres tidak boleh menggagalkan pengambilan.
        }
        try {
          return await mentari.course(code, { signal });
        } finally {
          try {
            onStep?.({ phase: 'course-done', code });
          } catch {
            // Abaikan.
          }
        }
      });

      return values(settled).filter(Boolean);
    },

    async gradeBook(courseCode, { signal } = {}) {
      const payload = await getJson(
        `${API.MENTARI_BASE}/user-course/${encodeURIComponent(courseCode)}/grade-book`,
        { signal }
      );
      return unwrapArray(payload);
    },

    async quizParticipants(subSectionId, { signal } = {}) {
      const payload = await getJson(
        `${API.MENTARI_BASE}/quiz/peserta/${encodeURIComponent(subSectionId)}`,
        { signal }
      );
      return payload;
    },

    async kuesioner(courseCode, sectionCode, { signal } = {}) {
      return getJson(
        `${API.MENTARI_BASE}/kuesioner/${encodeURIComponent(courseCode)}/${encodeURIComponent(sectionCode)}`,
        { signal }
      );
    }
  };

  /* ------------------------------------------------------ MY UNPAM */

  const myunpam = {
    /** Jadwal kuliah semester berjalan. */
    async schedule({ signal } = {}) {
      const payload = await getJson(`${API.MYUNPAM_BASE}/presensi/mahasiswa/jadwal-kuliah`, {
        signal
      });
      return unwrapArray(payload);
    },

    /** Daftar pertemuan beserta status presensi untuk satu kelas. */
    async meetings(classId, courseId, { signal } = {}) {
      const path = `${API.MYUNPAM_BASE}/presensi/mahasiswa/jadwal-pertemuan/${encodeURIComponent(
        classId
      )}/${encodeURIComponent(courseId)}`;
      const payload = await getJson(path, { signal });
      return unwrapArray(payload);
    },

    /**
     * Rekap presensi lengkap: jadwal, lalu pertemuan tiap kelas secara
     * paralel terbatas.
     */
    async attendance({ signal, onStep } = {}) {
      const schedule = await myunpam.schedule({ signal });
      if (schedule.length === 0) return { student: {}, courses: [] };

      const first = schedule[0] ?? {};
      const student = {
        nim: first.nim,
        nama: first.nama_mahasiswa,
        semester: first.nama_semester_registrasi
      };

      // Satu mata kuliah bisa muncul beberapa kali (jadwal per pekan).
      const seen = new Set();
      const rows = [];
      for (const row of schedule) {
        const key = `${row?.id_kelas}::${row?.id_mata_kuliah}`;
        if (!row?.id_kelas || !row?.id_mata_kuliah || seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }

      const settled = await mapLimit(rows, LIMITS.CONCURRENCY, async (row) => {
        try {
          onStep?.({ phase: 'course-start', code: row.kode_mata_kuliah ?? row.nama_mata_kuliah });
        } catch {
          // Callback progres tidak boleh menggagalkan pengambilan.
        }
        try {
          return {
            nama: row.nama_mata_kuliah,
            kode: row.kode_mata_kuliah ?? '',
            sks: row.sks,
            kelas: row.nama_kelas ?? '',
            idKelas: row.id_kelas,
            idMatkul: row.id_mata_kuliah,
            pertemuan: await myunpam.meetings(row.id_kelas, row.id_mata_kuliah, { signal })
          };
        } finally {
          try {
            onStep?.({ phase: 'course-done', code: row.kode_mata_kuliah ?? row.nama_mata_kuliah });
          } catch {
            // Abaikan.
          }
        }
      });

      return { student, courses: values(settled) };
    }
  };

  globalThis.XMTApi = {
    resolveToken,
    clearTokenCache,
    normalizeToken,
    readMentariAccess,
    getJson,
    sendJson,
    ApiError,
    mentari,
    myunpam
  };
})();
