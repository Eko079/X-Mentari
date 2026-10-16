/**
 * X Mentari — analisis kuis
 *
 * Membaca soal dari API MENTARI, meminta analisis AI untuk setiap soal, dan
 * menyajikan hasilnya sebagai bahan tinjauan: huruf jawaban, tingkat
 * keyakinan model, dan alasannya.
 *
 * Batasan yang disengaja:
 *   - Tidak ada polling. Data diambil saat pengguna meminta.
 *   - Tidak pernah menekan tombol mulai, konfirmasi, maupun submit.
 *   - Menandai pilihan pada formulir hanya terjadi per soal, atas klik
 *     pengguna, dan hanya setelah soal dicocokkan dengan yakin.
 */
(() => {
  if (window.__XMT_QUIZ__) return;
  window.__XMT_QUIZ__ = true;

  const { el, replace, icon, selectChoice, onMutate } = globalThis.XMTDom;
  const { htmlToText, normalize, percent, truncate, mapLimit } = globalThis.XMTUtil;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;
  const api = globalThis.XMTApi;

  /** Berapa banyak soal dianalisis bersamaan. Rendah agar kuota tidak jebol. */
  const ANALYSIS_CONCURRENCY = 2;

  const state = {
    quizId: null,
    questions: [],
    loading: false,
    error: null,
    autoSubmit: false
  };

  let panel;
  let progress;

  /* --------------------------------------------------------------- sumber */

  function readQuizId() {
    // ID kuis MENTARI berupa UUID (mis. a127cb72-007a-...), bukan angka.
    // Segmen setelah /quiz/ atau /exam/ ditangkap apa adanya, lalu bagian
    // seperti ?page= atau /page yang menempel dibuang.
    const match = /\/(?:exam|quiz)\/([^/?#]+)/i.exec(location.pathname + location.search);
    return match?.[1] ?? null;
  }

  /** Mengubah satu entri API menjadi bentuk yang dipakai antarmuka. */
  function toQuestion(raw, index) {
    const text = [htmlToText(raw?.judul ?? ''), htmlToText(raw?.deskripsi ?? '')]
      .filter(Boolean)
      .join('\n\n');

    // Pertahankan id opsi mentah sejajar dengan teksnya. Pengiriman jawaban
    // ke server memakai id_jawaban ini, bukan indeks atau huruf.
    const rawOptions = (raw?.list_jawaban ?? []).filter(
      (entry) => htmlToText(entry?.jawaban ?? entry?.teks ?? '') !== ''
    );
    const options = rawOptions.map((entry) => htmlToText(entry?.jawaban ?? entry?.teks ?? ''));
    const optionIds = rawOptions.map((entry) => entry?.id ?? null);

    return {
      id: raw?.id ?? `idx-${index}`,
      number: index + 1,
      text,
      options,
      optionIds,
      letter: null,
      confidence: null,
      explanation: '',
      submitted: false,
      status: options.length === 0 ? 'no-options' : 'pending'
    };
  }

  /* ------------------------------------------------------------- analisis */

  async function analyse(onProgress) {
    const targets = state.questions.filter((question) => question.status === 'pending');
    let done = 0;

    await mapLimit(targets, ANALYSIS_CONCURRENCY, async (question) => {
      question.status = 'working';
      onProgress?.(question);

      try {
        const result = await globalThis.XMTAI.answerQuestion(question.text, question.options);
        question.letter = result.letter;
        question.confidence = result.confidence;
        question.explanation = result.explanation;
        question.status = result.letter ? 'done' : 'unclear';
      } catch (error) {
        question.status = 'error';
        question.explanation = error.message;
      } finally {
        done += 1;
        progress?.set(percent(done, targets.length));
        onProgress?.(question);
      }
    });
  }

  /* ---------------------------------------------------- pemetaan ke halaman */

  /**
   * Menemukan blok DOM yang memuat satu soal.
   *
   * MUI menyarangkan Paper di dalam Paper, sehingga pencocokan naif akan
   * mengenai pembungkus terluar yang memuat radio dari banyak soal, dan
   * jawaban berakhir di soal yang salah. Blok terkecil yang cocok dipilih,
   * dan hanya diterima bila jumlah pilihannya sama dengan jumlah opsi soal.
   */
  function findQuestionBlock(question) {
    const needle = normalize(question.text).slice(0, 60);
    if (needle.length < 20) return null;

    const candidates = Array.from(
      document.querySelectorAll('.MuiPaper-root, .MuiCard-root, [class*="question"], form > div')
    ).filter((node) => !node.closest('.xmt-scope'));

    const matches = candidates.filter((node) => {
      if (!normalize(node.textContent ?? '').includes(needle)) return false;
      const inputs = node.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      return inputs.length === question.options.length;
    });

    if (matches.length === 0) return null;

    // Blok terkecil adalah yang paling dekat dengan soal itu sendiri.
    matches.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
    return matches[0];
  }

  /**
   * Menandai pilihan untuk satu soal di formulir.
   *
   * Mengembalikan alasan kegagalan agar pengguna tahu apa yang terjadi,
   * bukan menandai pilihan sembarangan sebagai cadangan.
   */
  function markChoice(question) {
    if (!question.letter) return { ok: false, reason: 'Belum ada saran jawaban untuk soal ini.' };

    const block = findQuestionBlock(question);
    if (!block) {
      return {
        ok: false,
        reason: 'Soal ini tidak ditemukan di halaman. Pastikan soal sedang tampil, lalu coba lagi.'
      };
    }

    const index = question.letter.charCodeAt(0) - 65;
    const inputs = Array.from(block.querySelectorAll('input[type="radio"], input[type="checkbox"]'));

    if (index < 0 || index >= inputs.length) {
      return { ok: false, reason: 'Huruf jawaban tidak sesuai dengan pilihan yang tersedia.' };
    }

    return selectChoice(inputs[index])
      ? { ok: true }
      : { ok: false, reason: 'Pilihan tidak bisa ditandai. Mungkin soal sudah terkunci.' };
  }

  /* --------------------------------------------------------------- render */

  const CONFIDENCE_TONE = { tinggi: 'success', sedang: 'warning', rendah: 'danger' };

  function renderQuestion(question) {
    const header = el('div', { class: 'xmt-card-head' }, [
      el('div', { class: 'xmt-card-title', text: `Soal ${question.number}` }),
      el('div', { class: 'xmt-cluster' }, [
        question.confidence &&
          UI.parts.badge(
            `Keyakinan ${question.confidence}`,
            CONFIDENCE_TONE[question.confidence] ?? 'warning'
          ),
        question.letter
          ? UI.parts.badge(`Saran: ${question.letter}`, 'accent')
          : question.status === 'working'
            ? UI.parts.badge('Menganalisis…', 'brand')
            : question.status === 'error'
              ? UI.parts.badge('Gagal', 'danger')
              : question.status === 'no-options'
                ? UI.parts.badge('Tanpa pilihan', 'warning')
                : UI.parts.badge('Belum dianalisis')
      ])
    ]);

    const optionList = el(
      'div',
      { class: 'xmt-stack', style: { marginTop: '8px' } },
      question.options.map((option, index) => {
        const letter = String.fromCharCode(65 + index);
        const suggested = letter === question.letter;

        return el(
          'div',
          {
            class: 'xmt-text-sm',
            style: {
              padding: '6px 10px',
              borderRadius: 'var(--xmt-radius-sm)',
              background: suggested ? 'var(--xmt-accent-soft)' : 'transparent',
              border: suggested ? '1px solid var(--xmt-accent-border)' : '1px solid transparent',
              color: suggested ? 'var(--xmt-text)' : 'var(--xmt-text-muted)'
            }
          },
          [
            el('strong', { text: `${letter}. ` }),
            el('span', { text: option }),
            suggested && el('span', { text: '  ← saran AI', style: { color: 'var(--xmt-accent)' } })
          ]
        );
      })
    );

    const tools = el('div', { class: 'xmt-cluster', style: { marginTop: '12px' } }, [
      question.letter &&
        el(
          'button',
          {
            type: 'button',
            class: 'xmt-btn',
            dataset: { size: 'sm' },
            title: 'Tandai pilihan ini pada formulir. Anda tetap yang mengirim jawaban.',
            on: {
              click: () => {
                const result = markChoice(question);
                UI.toast(
                  result.ok ? `Soal ${question.number}: pilihan ${question.letter} ditandai.` : result.reason,
                  result.ok ? 'success' : 'error'
                );
              }
            }
          },
          [icon('check'), el('span', { text: 'Tandai di formulir' })]
        ),
      UI.parts.copyButton(
        () =>
          [
            `Soal ${question.number}: ${question.text}`,
            ...question.options.map(
              (option, index) => `${String.fromCharCode(65 + index)}. ${option}`
            ),
            `Saran AI: ${question.letter ?? '-'}`,
            question.explanation && `Alasan: ${question.explanation}`
          ]
            .filter(Boolean)
            .join('\n'),
        { label: 'Salin soal' }
      )
    ]);

    return el('div', { class: 'xmt-card', dataset: { questionId: String(question.id) } }, [
      header,
      el('p', {
        class: 'xmt-text-sm xmt-text-muted',
        style: { margin: '4px 0 0', whiteSpace: 'pre-wrap', lineHeight: '1.55' },
        text: truncate(question.text, 400)
      }),
      question.options.length > 0 && optionList,
      question.explanation &&
        el('p', {
          class: 'xmt-text-xs',
          style: {
            margin: '10px 0 0',
            padding: '8px 10px',
            borderRadius: 'var(--xmt-radius-sm)',
            background: 'var(--xmt-surface)',
            lineHeight: '1.55',
            color: question.status === 'error' ? 'var(--xmt-danger)' : 'var(--xmt-text-muted)'
          },
          text: question.explanation
        }),
      tools
    ]);
  }

  function renderSummary() {
    const answered = state.questions.filter((question) => question.letter).length;
    const lowConfidence = state.questions.filter((question) => question.confidence === 'rendah').length;

    return UI.parts.card({
      title: 'Ringkasan',
      children: [
        UI.parts.row('Soal terbaca', state.questions.length),
        UI.parts.row('Punya saran jawaban', `${answered} (${percent(answered, state.questions.length)}%)`),
        lowConfidence > 0 &&
          UI.parts.row(
            'Keyakinan rendah',
            UI.parts.badge(`${lowConfidence} soal perlu diperiksa`, 'danger')
          )
      ]
    });
  }

  function renderList(region) {
    if (state.loading) {
      panel.loading('Mengambil soal dari server…', 'quiz');
      return;
    }

    if (state.error) {
      panel.error(state.error, () => reload(), 'quiz');
      return;
    }

    if (state.questions.length === 0) {
      panel.empty(
        {
          title: 'Belum ada soal',
          text: 'Tekan Ambil soal untuk memuat daftar soal dari server MENTARI.',
          action: UI.parts.asyncButton({
            label: 'Ambil soal',
            iconName: 'refresh',
            variant: 'primary',
            onClick: reload
          })
        },
        'quiz'
      );
      return;
    }

    progress = UI.parts.progress();

    replace(region, [
      UI.parts.notice({
        tone: state.autoSubmit ? 'danger' : 'warning',
        title: state.autoSubmit
          ? 'Kirim otomatis AKTIF — jawaban dapat dikirim tanpa Anda menekan submit.'
          : 'Bahan tinjauan, bukan jawaban final.',
        text: state.autoSubmit
          ? 'Saran AI bisa salah dan pengiriman otomatis berisiko dianggap kecurangan. Periksa setiap soal sebelum mengirim. Risiko sepenuhnya pada Anda.'
          : 'Saran di bawah dihasilkan AI dan bisa salah. Periksa setiap soal sendiri. Ekstensi ini tidak akan pernah mengirim jawaban untuk Anda.'
      }),
      renderSummary(),
      el('div', { style: { margin: '12px 0' } }, [progress.root]),
      el('div', { class: 'xmt-cluster', style: { marginBottom: '12px' } }, [
        UI.parts.asyncButton({
          label: 'Analisis semua soal',
          iconName: 'sparkle',
          variant: 'primary',
          busyLabel: 'Menganalisis…',
          onClick: () => runAnalysis(region)
        }),
        UI.parts.copyButton(
          () =>
            state.questions
              .map((question) =>
                [
                  `Soal ${question.number}: ${question.text}`,
                  ...question.options.map(
                    (option, index) => `${String.fromCharCode(65 + index)}. ${option}`
                  ),
                  `Saran AI: ${question.letter ?? '-'}${
                    question.confidence ? ` (keyakinan ${question.confidence})` : ''
                  }`,
                  question.explanation && `Alasan: ${question.explanation}`,
                  '—'
                ]
                  .filter(Boolean)
                  .join('\n')
              )
              .join('\n'),
          { label: 'Salin semua', size: undefined }
        ),
        // Kirim otomatis hanya tampil bila pengguna sudah menyalakannya.
        state.autoSubmit &&
          UI.parts.asyncButton({
            label: 'Kirim jawaban ke server',
            iconName: 'send',
            variant: 'danger',
            busyLabel: 'Mengirim…',
            onClick: () => submitAnswers(region)
          }),
        state.autoSubmit &&
          UI.parts.asyncButton({
            label: 'Akhiri kuis',
            iconName: 'checkCircle',
            variant: 'ghost',
            busyLabel: 'Mengakhiri…',
            onClick: endQuiz
          })
      ]),
      el('div', { class: 'xmt-stack', id: 'xmt-quiz-list' }, state.questions.map(renderQuestion))
    ]);
  }

  /** Mengganti satu kartu soal di tempat, tanpa merender ulang seluruh daftar. */
  function refreshQuestionCard(question) {
    const list = document.getElementById('xmt-quiz-list');
    const existing = list?.querySelector(`[data-question-id="${CSS.escape(String(question.id))}"]`);
    if (existing) existing.replaceWith(renderQuestion(question));
  }

  async function runAnalysis(region) {
    if (!(await store.hasProvider())) {
      UI.toast('Atur penyedia AI dulu di Pengaturan.', 'error');
      globalThis.XMTAI.openOptions();
      return;
    }

    const pending = state.questions.filter((question) => question.status === 'pending');
    const live = globalThis.XMTDom.live;
    live.mount(region.querySelector('.xmt-cluster')?.parentElement ?? region, { hidden: false });
    live.report(`Analisis: mulai 0/${pending.length} soal…`, { instant: true });
    await analyse((question) => {
      refreshQuestionCard(question);
      const left = state.questions.filter((entry) => entry.status === 'pending').length;
      live.report(`Analisis: ${pending.length - left}/${pending.length} soal…`);
    });
    live.done('Analisis: selesai.');
    // Render ulang penuh agar ringkasan dan progres ikut diperbarui.
    renderList(region);
  }

  /* -------------------------------------------------- pengiriman jawaban */

  /** Soal yang siap dikirim: punya saran huruf, belum terkirim, ada id opsi. */
  function readyToSubmit() {
    return state.questions.filter(
      (question) => question.letter && !question.submitted && question.optionIds?.length
    );
  }

  /**
   * Inti pengiriman jawaban ke server, dipakai oleh tombol panel maupun alur
   * satu-klik. Tidak menampilkan konfirmasi sendiri; pemanggil bertanggung
   * jawab memastikan pengguna sudah setuju.
   */
  async function pushAnswers(questions, onProgress) {
    let sent = 0;
    let failed = 0;

    for (const question of questions) {
      const index = question.letter.charCodeAt(0) - 65;
      const answerId = question.optionIds[index];

      if (!answerId) {
        failed += 1;
        question.explanation =
          `${question.explanation}\n[Gagal kirim: huruf jawaban tidak cocok dengan pilihan.]`.trim();
      } else {
        try {
          await api.mentari.quizAnswer({ soalSessionId: question.id, answerId });
          question.submitted = true;
          sent += 1;
        } catch (error) {
          failed += 1;
          question.explanation = `${question.explanation}\n[Gagal kirim: ${error.message}]`.trim();
        }
      }
      refreshQuestionCard(question);
      onProgress?.(sent + failed, questions.length);
    }

    return { sent, failed };
  }

  /**
   * Mengirim jawaban saran AI langsung ke server MENTARI.
   *
   * Ini melewati langkah "pengguna menekan submit" yang biasanya menjadi
   * pengaman. Karena itu ia hanya berjalan bila fitur quizAutoSubmit
   * dinyalakan pengguna DAN pengguna menyetujui dialog konfirmasi di sini.
   * Setiap soal dikirm memakai id sesi soal (question.id) dan id_jawaban
   * yang dipetakan dari huruf saran ke optionIds.
   */
  async function submitAnswers(region) {
    if (!(await store.enabled('quizAutoSubmit'))) {
      UI.toast('Fitur kirim otomatis mati. Nyalakan di Pengaturan bila Anda paham risikonya.', 'error');
      globalThis.XMTAI.openOptions();
      return;
    }

    const ready = readyToSubmit();

    if (ready.length === 0) {
      UI.toast('Belum ada soal dengan saran jawaban untuk dikirim. Analisis dulu.', 'error');
      return;
    }

    const agreed = await UI.confirm({
      title: 'Kirim jawaban ke server?',
      tone: 'danger',
      message: `Ekstensi akan mengirim ${ready.length} jawaban saran AI langsung ke MENTARI tanpa Anda menekan submit.`,
      detail:
        'Jawaban AI bisa salah, dan pengiriman otomatis dapat dianggap sebagai kecurangan akademik. Risiko sepenuhnya menjadi tanggung jawab Anda. Pastikan kuis sudah dimulai.',
      confirmLabel: `Ya, kirim ${ready.length} jawaban`
    });
    if (!agreed) return;

    const live = globalThis.XMTDom.live;
    live.mount(region, { hidden: false });
    const { sent, failed } = await pushAnswers(ready, (done, total) => {
      progress?.set(percent(done, total));
      live.report(`Kirim: ${done}/${total} jawaban…`);
    });
    live.done(failed === 0 ? 'Kirim: selesai.' : `Kirim: ${sent} terkirim, ${failed} gagal.`);

    UI.toast(
      failed === 0
        ? `${sent} jawaban terkirim. Periksa di halaman, lalu akhiri kuis sendiri.`
        : `${sent} terkirim, ${failed} gagal. Periksa soal yang bertanda gagal.`,
      failed === 0 ? 'success' : 'warning'
    );
    renderList(region);
  }

  /** Mengakhiri sesi kuis di server (setara menekan "Selesai"). */
  async function endQuiz() {
    if (!state.quizId) return;

    const agreed = await UI.confirm({
      title: 'Akhiri kuis sekarang?',
      tone: 'danger',
      message: 'Kuis akan diakhiri di server dan tidak bisa diubah lagi.',
      detail: 'Pastikan semua jawaban sudah benar sebelum melanjutkan.',
      confirmLabel: 'Ya, akhiri kuis'
    });
    if (!agreed) return;

    try {
      await api.mentari.quizEnd(state.quizId);
      UI.toast('Kuis diakhiri.', 'success');
    } catch (error) {
      UI.toast(`Gagal mengakhiri kuis: ${error.message}`, 'error');
    }
  }

  /* --------------------------------------------------- alur satu-klik */

  /** Status yang sedang berlangsung, agar tombol tidak dipicu ganda. */
  let autoRunning = false;

  /**
   * Kerjakan seluruh kuis dalam satu klik: mulai sesi, ambil soal, analisis
   * AI, kirim semua jawaban, lalu akhiri kuis. Hanya satu konfirmasi di awal.
   *
   * Ini adalah operasi paling berisiko di ekstensi: ia menyelesaikan kuis
   * atas nama pengguna tanpa peninjauan per soal. Karena itu tetap dijaga
   * flag quizAutoSubmit dan satu dialog konfirmasi yang tegas.
   */
  async function runFullAuto(button) {
    if (autoRunning) return;

    if (!(await store.enabled('quizAutoSubmit'))) {
      UI.toast('Nyalakan "Kirim Jawaban Kuis Otomatis" di Pengaturan dulu.', 'error');
      globalThis.XMTAI.openOptions();
      return;
    }
    if (!(await store.hasProvider())) {
      UI.toast('Atur penyedia AI dulu di Pengaturan.', 'error');
      globalThis.XMTAI.openOptions();
      return;
    }

    const quizId = readQuizId();
    if (!quizId) {
      UI.toast('ID kuis tidak ada di alamat halaman ini.', 'error');
      return;
    }

    const agreed = await UI.confirm({
      title: 'Kerjakan & kirim seluruh kuis otomatis?',
      tone: 'danger',
      message:
        'Ekstensi akan memulai kuis, menjawab semua soal dengan AI, mengirim jawaban, lalu mengakhiri kuis — tanpa Anda meninjau tiap soal.',
      detail:
        'Jawaban AI BISA SALAH dan tindakan ini dapat dianggap kecurangan akademik. Nilai yang dihasilkan final. Risiko sepenuhnya menjadi tanggung jawab Anda.',
      confirmLabel: 'Ya, kerjakan semuanya'
    });
    if (!agreed) return;

    autoRunning = true;
    const setLabel = button ? paintAutoButton(button) : () => {};

    try {
      state.quizId = quizId;
      state.autoSubmit = true;

      // 1) Mulai/reset sesi agar server memberi id sesi tiap soal.
      setLabel('Memulai kuis…', true);
      try {
        await api.mentari.quizStart(quizId);
      } catch (error) {
        // Sesi mungkin sudah berjalan; lanjutkan dan biarkan pengambilan soal
        // yang memutuskan apakah benar-benar gagal.
        console.warn('[XMT] quizStart gagal, lanjut:', error.message);
      }

      // 2) Ambil soal.
      setLabel('Mengambil soal…', true);
      const raw = await api.mentari.quizQuestions(quizId);
      state.questions = raw.map(toQuestion);

      if (state.questions.length === 0) {
        UI.toast('Server belum mengembalikan soal. Coba mulai kuis manual dulu.', 'error');
        return;
      }

      // 3) Analisis semua soal dengan AI.
      setLabel('Menganalisis…', true);
      await analyse();

      // 4) Kirim semua jawaban yang punya saran.
      const ready = readyToSubmit();
      if (ready.length === 0) {
        UI.toast('AI tidak menghasilkan jawaban yang bisa dikirim.', 'error');
        return;
      }
      setLabel(`Mengirim 0/${ready.length}…`, true);
      const { sent, failed } = await pushAnswers(ready, (done, total) =>
        setLabel(`Mengirim ${done}/${total}…`, true)
      );

      // 5) Akhiri kuis bila semua jawaban terkirim.
      if (failed === 0) {
        setLabel('Mengakhiri…', true);
        try {
          await api.mentari.quizEnd(quizId);
        } catch (error) {
          console.warn('[XMT] quizEnd gagal:', error.message);
        }
        UI.toast(`Selesai. ${sent} jawaban terkirim dan kuis diakhiri.`, 'success');
      } else {
        UI.toast(
          `${sent} terkirim, ${failed} gagal. Kuis TIDAK diakhiri — periksa dulu di halaman.`,
          'warning'
        );
      }

      // Segarkan panel bila terbuka agar hasil terlihat.
      if (panel?.isOpen) renderList(panel.region('quiz'));
    } catch (error) {
      UI.toast(`Gagal: ${error.message}`, 'error');
    } finally {
      autoRunning = false;
      setLabel(AUTO_LABEL, false);
    }
  }

  /* ------------------------------------------------------------- pemuatan */

  async function reload() {
    state.quizId = readQuizId();
    state.autoSubmit = await store.enabled('quizAutoSubmit');

    if (!state.quizId) {
      state.error = 'ID kuis tidak ada di alamat halaman ini.';
      panel.refreshTab('quiz');
      return;
    }

    state.loading = true;
    state.error = null;
    panel.refreshTab('quiz');

    try {
      const raw = await api.mentari.quizQuestions(state.quizId);

      // Bangun ulang dari nol setiap kali dimuat. Menyimpan daftar soal yang
      // sudah diproses lalu melewatinya membuat panel tampak kosong saat
      // dibuka kedua kali.
      state.questions = raw.map(toQuestion);

      if (state.questions.length === 0) {
        state.error = 'Server belum mengembalikan soal. Mulai kuis dulu, lalu coba lagi.';
      }
    } catch (error) {
      state.error = error.message;
    } finally {
      state.loading = false;
      panel.refreshTab('quiz');
    }
  }

  /* ------------------------------------------------- papan skor kuis */

  /**
   * Papan skor yang disuntik langsung di halaman kuis (pre-test maupun
   * post-test), tepat di atas blok "Detail Pengerjaan Quiz" milik MENTARI.
   *
   * Datanya dari endpoint peserta kuis: setiap mahasiswa beserta nilai
   * (grade) dan waktu penyelesaiannya. Urutan: nilai tertinggi dulu, lalu
   * yang paling cepat. Baris milik sendiri ditandai "(Saya)" dengan
   * mencocokkan id kuis milik pengguna yang sedang login.
   */
  let lbLoadingFor = null;

  /** Menemukan wadah blok "Detail Pengerjaan Quiz" sebagai jangkar sisipan. */
  function findQuizDetailAnchor() {
    const heads = Array.from(document.querySelectorAll('h6'));
    const head = heads.find(
      (node) => !node.closest('.xmt-scope') && /detail\s*pengerjaan\s*quiz/i.test(node.textContent ?? '')
    );
    if (!head) return null;
    return head.closest('div') ?? head.parentElement;
  }

  function formatSeconds(total) {
    const s = Math.max(0, Math.round(Number(total) || 0));
    if (s < 60) return `${s} Detik`;
    const m = Math.floor(s / 60);
    const rest = s % 60;
    if (rest === 0) return `${m} Menit`;
    return `${m} Menit ${rest} Detik`;
  }

  /** Waktu pengerjaan satu peserta dalam detik, atau null bila tak diketahui. */
  function quizElapsedSeconds(entry) {
    const direct = Number(entry?.end_in_second);
    if (Number.isFinite(direct) && direct >= 0) return direct;

    const start = entry?.start_at ? new Date(entry.start_at).getTime() : NaN;
    const end = entry?.end_at ? new Date(entry.end_at).getTime() : NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return Math.round((end - start) / 1000);
    }
    return null;
  }

  /** Rute kuis/ujian tempat papan skor boleh tampil. */
  function isQuizRoute() {
    return /\/(?:exam|quiz)\//i.test(location.pathname);
  }

  /**
   * Penjaga papan skor saat DOM berubah. Navigasi SPA tidak me-reload
   * halaman, jadi di luar rute kuis box yang tersisa dicabut; di rute kuis
   * box dipasang bila belum ada.
   */
  function syncLeaderboard() {
    if (!isQuizRoute()) {
      document.querySelector('.xmt-quiz-leaderboard')?.remove();
      lbLoadingFor = null;
      return;
    }
    injectLeaderboard();
  }

  /** Kunci penyimpanan status lipatan leaderboard. */
  const LB_COLLAPSED_KEY = globalThis.XMT_CONST.KEYS.LB_COLLAPSED;

  /**
   * Kepala lipat Leaderboard: ikon piala + judul + subjudul ringkasan,
   * badge hitungan, dan panah. Klik/Enter/Spasi memanggil `onFlip`.
   * Gayanya murni kelas `xmt-*` milik ekstensi (lihat components.css).
   */
  function buildLbToggle({ sub, count, collapsed, onFlip }) {
    return el('div', {
      class: 'xmt-lb-toggle',
      role: 'button',
      tabindex: '0',
      title: 'Tampilkan/sembunyikan leaderboard',
      'aria-expanded': collapsed ? 'false' : 'true',
      on: {
        click: onFlip,
        keydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onFlip();
          }
        }
      }
    }, [
      el('div', { class: 'xmt-item-icon', dataset: { tone: 'brand' } }, [icon('trophy')]),
      el('div', { class: 'xmt-lb-text' }, [
        el('div', { class: 'xmt-lb-title', text: 'Leaderboard' }),
        sub
      ]),
      count,
      el('div', { class: 'xmt-lb-chevron' }, [icon('chevron')])
    ]);
  }

  /**
   * Menyuntik kartu papan skor di atas detail pengerjaan. Idempoten:
   * bila kartu sudah ada atau jangkar belum tampil, tidak berbuat apa-apa.
   */
  async function injectLeaderboard() {
    if (!isQuizRoute()) return;
    if (document.querySelector('.xmt-quiz-leaderboard')) return;

    const anchor = findQuizDetailAnchor();
    if (!anchor?.parentNode) return;

    const quizId = readQuizId();
    if (!quizId) return;
    if (lbLoadingFor === quizId) return;
    lbLoadingFor = quizId;

    let lbCollapsed = false;
    try {
      lbCollapsed = (await store.get(LB_COLLAPSED_KEY)) === true;
    } catch {
      // Penyimpanan boleh gagal; anggap terbuka seperti biasa.
      lbCollapsed = false;
    }

    const box = UI.scope(
      el('div', { class: 'xmt-card xmt-quiz-leaderboard', style: { marginBottom: '12px' } })
    );

    const lbSub = el('div', { class: 'xmt-lb-sub', text: 'Mengambil data peserta…' });
    const lbCount = UI.parts.badge('…', 'accent');
    const lbBody = el('div', { class: 'xmt-lb-body' }, [
      el('div', { class: 'xmt-card-head' }, [
        el('div', { class: 'xmt-card-title', text: 'Papan Skor Quiz' }),
        el('div', { class: 'xmt-spinner', dataset: { size: 'sm' } })
      ]),
      el('p', { class: 'xmt-hint', text: 'Mengambil data peserta…' })
    ]);

    const paintLbCollapsed = () => {
      box.dataset.collapsed = lbCollapsed ? 'true' : 'false';
      lbToggle.setAttribute('aria-expanded', lbCollapsed ? 'false' : 'true');
    };

    const flipLb = async () => {
      lbCollapsed = !lbCollapsed;
      paintLbCollapsed();
      try {
        await store.set(LB_COLLAPSED_KEY, lbCollapsed);
      } catch {
        // Status lipatan tetap berlaku untuk sesi ini.
      }
    };

    const lbToggle = buildLbToggle({ sub: lbSub, count: lbCount, collapsed: lbCollapsed, onFlip: flipLb });

    box.append(lbToggle, lbBody);
    paintLbCollapsed();
    anchor.parentNode.insertBefore(box, anchor);

    try {
      const payload = await api.mentari.quizParticipants(quizId);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const done = rows.filter((row) => row?.quiz);
      const myQuizId = payload?.quiz?.id ?? null;

      done.sort((a, b) => {
        const gap = Number(b.quiz?.grade ?? -1) - Number(a.quiz?.grade ?? -1);
        if (gap !== 0) return gap;
        const ta = quizElapsedSeconds(a.quiz);
        const tb = quizElapsedSeconds(b.quiz);
        if (ta == null) return 1;
        if (tb == null) return -1;
        return ta - tb;
      });

      const grades = done.map((row) => Number(row.quiz?.grade ?? 0));
      const avg = grades.length > 0 ? grades.reduce((sum, grade) => sum + grade, 0) / grades.length : 0;
      const top = grades.length > 0 ? Math.max(...grades) : 0;
      const myRank = myQuizId ? done.findIndex((row) => row?.quiz?.id === myQuizId) + 1 : 0;

      const title = payload?.judul ?? 'Quiz';
      const section = payload?.kode_section ? String(payload.kode_section).replace(/_/g, ' ') : '';

      const list = done.slice(0, 20).map((row, index) => {
        const rank = index + 1;
        const isMe = Boolean(myQuizId) && row?.quiz?.id === myQuizId;
        const elapsed = quizElapsedSeconds(row.quiz);

        return el(
          'div',
          {
            class: 'xmt-item',
            style: isMe
              ? { border: '1px solid var(--xmt-accent-border)', borderRadius: 'var(--xmt-radius-sm)' }
              : undefined
          },
          [
            el('div', { class: 'xmt-item-icon', dataset: { tone: rank === 1 ? 'brand' : rank <= 3 ? 'accent' : undefined } }, [
              icon(rank <= 3 ? 'trophy' : 'person')
            ]),
            el('div', { class: 'xmt-item-body' }, [
              el('span', {
                class: 'xmt-item-title',
                text: `#${rank} ${row.nama_mahasiswa ?? row.nim ?? 'Peserta'}${isMe ? ' (Saya)' : ''}`
              }),
              el(
                'div',
                { class: 'xmt-item-meta' },
                [
                  row.nim && el('span', { text: `NIM: ${row.nim}` }),
                  elapsed != null && el('span', { text: formatSeconds(elapsed) })
                ].filter(Boolean)
              )
            ]),
            UI.parts.badge(`Nilai ${row.quiz?.grade ?? '-'}`, rank === 1 ? 'brand' : 'accent')
          ]
        );
      });

      if (myRank > 20) {
        const me = done[myRank - 1];
        const elapsed = quizElapsedSeconds(me.quiz);
        list.push(
          el('div', { class: 'xmt-item', style: { border: '1px solid var(--xmt-accent-border)', borderRadius: 'var(--xmt-radius-sm)' } }, [
            el('div', { class: 'xmt-item-icon' }, [icon('person')]),
            el('div', { class: 'xmt-item-body' }, [
              el('span', { class: 'xmt-item-title', text: `#${myRank} ${me.nama_mahasiswa ?? me.nim ?? 'Peserta'} (Saya)` }),
              el(
                'div',
                { class: 'xmt-item-meta' },
                [
                  me.nim && el('span', { text: `NIM: ${me.nim}` }),
                  elapsed != null && el('span', { text: formatSeconds(elapsed) })
                ].filter(Boolean)
              )
            ]),
            UI.parts.badge(`Nilai ${me.quiz?.grade ?? '-'}`)
          ])
        );
      }

      lbSub.textContent = [
        title,
        `Rata-rata ${avg.toFixed(1)}`,
        `Tertinggi ${top}`,
        myRank > 0 ? `Saya #${myRank}` : null
      ].filter(Boolean).join(' · ');
      lbCount.textContent = `${done.length}/${rows.length} sudah`;
      lbCount.dataset.tone = done.length > 0 ? 'success' : 'warning';

      const cardChildren = [
        el('div', { class: 'xmt-card-head' }, [
          el('div', { class: 'xmt-card-title', text: `Papan Skor — ${title}` }),
          el('div', { class: 'xmt-cluster' }, [
            section && UI.parts.badge(section, 'accent'),
            UI.parts.badge(
              `${done.length}/${rows.length} sudah`,
              done.length > 0 ? 'success' : 'warning'
            )
          ])
        ]),
        el('div', { class: 'xmt-cluster', style: { margin: '8px 0' } }, [
          UI.parts.stat({ label: 'Rata-rata', value: avg.toFixed(1) }),
          UI.parts.stat({ label: 'Tertinggi', value: top }),
          myRank > 0 && UI.parts.stat({ label: 'Peringkat saya', value: `#${myRank}`, highlight: true })
        ]),
        ...list
      ];

      if (done.length === 0) {
        cardChildren.push(el('p', { class: 'xmt-hint', text: 'Belum ada peserta yang mengerjakan kuis ini.' }));
      }

      cardChildren.push(
        el('div', { style: { marginTop: '12px' } }, [
          UI.parts.asyncButton({
            label: 'Muat ulang skor',
            iconName: 'refresh',
            size: 'sm',
            busyLabel: 'Memuat…',
            onClick: async () => {
              lbLoadingFor = null;
              box.remove();
              await injectLeaderboard();
            }
          })
        ])
      );

      lbBody.replaceChildren(...cardChildren);
    } catch (error) {
      lbSub.textContent = 'Tidak bisa memuat skor.';
      lbCount.textContent = 'gagal';
      lbCount.dataset.tone = 'danger';
      lbBody.replaceChildren(
        el('div', { class: 'xmt-card-head' }, [
          el('div', { class: 'xmt-card-title', text: 'Papan Skor Quiz' })
        ]),
        UI.parts.notice({
          tone: 'warning',
          text: `Tidak bisa memuat skor: ${error?.message ?? error}`
        })
      );
    } finally {
      lbLoadingFor = null;
    }
  }

  /* ---------------------------------------------------------------- pasang */

  const AUTO_LABEL = 'Kerjakan Otomatis (AI)';

  /**
   * Mengganti isi tombol satu-klik saat proses berjalan. Mengembalikan
   * fungsi setLabel(text, busy) yang aman dipanggil berkali-kali.
   */
  function paintAutoButton(button) {
    return (text, busy) => {
      button.replaceChildren();
      if (busy) {
        button.appendChild(el('div', { class: 'xmt-spinner', dataset: { size: 'sm' } }));
      } else {
        button.appendChild(icon('sparkle'));
      }
      button.appendChild(el('span', { text }));
      button.disabled = Boolean(busy);
    };
  }

  /**
   * True bila halaman menunjukkan kuis sudah dikerjakan: chip
   * "Sudah Mengerjakan Quiz" atau nilai Grade sudah terisi angka. Bila blok
   * detail belum tampil (ragu-ragu), kembalikan false agar tombol AI tetap
   * tampil — yang belum mengerjakan harus selalu melihat tombolnya.
   */
  function isQuizDoneByDom() {
    const anchor = findQuizDetailAnchor();
    if (!anchor) return false;
    if (/sudah\s*mengerjakan\s*quiz/i.test(anchor.textContent ?? '')) return true;
    const gradeCaption = Array.from(anchor.querySelectorAll('span')).find(
      (node) => /^\s*grade\s*$/i.test(node.textContent ?? '')
    );
    const gradeValue = gradeCaption?.closest('div')?.querySelector('p')?.textContent?.trim() ?? '';
    return /\d/.test(gradeValue);
  }

  /**
   * Menjaga tombol "Kerjakan Otomatis": cabut bila kuis sudah dikerjakan
   * (atau sudah di luar rute kuis, melawan sisa SPA), pasang kembali bila
   * belum. Dipanggil ulang tiap DOM berubah, jadi harus idempoten.
   */
  function syncAutoButton() {
    if (!isQuizRoute() || isQuizDoneByDom()) {
      document.querySelector('.xmt-quiz-auto')?.remove();
      return;
    }
    injectAutoButton();
  }

  /**
   * Menyisipkan tombol "Kerjakan Otomatis" di samping tombol "Kerjakan Quiz"
   * milik MENTARI. Dipanggil ulang tiap DOM berubah, jadi harus idempoten.
   *
   * Tombol MENTARI dikenali dari teksnya ("Kerjakan Quiz") agar tidak
   * bergantung pada nama kelas MUI yang berubah-ubah antar-build.
   * Penyaringan sudah/belum dikerjakan ada di syncAutoButton.
   */
  function injectAutoButton() {
    const native = Array.from(
      document.querySelectorAll('button.MuiButton-root, button')
    ).find((btn) => {
      if (btn.closest('.xmt-scope')) return false;
      return /kerjakan\s*quiz/i.test(btn.textContent ?? '');
    });

    if (!native) return;

    const host = native.parentElement;
    if (!host || host.querySelector('.xmt-quiz-auto')) return;

    const button = el('button', {
      type: 'button',
      class: 'xmt-scope xmt-btn xmt-quiz-auto',
      dataset: { variant: 'danger', size: 'sm' },
      title: 'Kerjakan seluruh kuis dengan AI lalu kirim otomatis (berisiko).',
      style: { marginLeft: '8px' },
      on: {
        click: (event) => {
          event.preventDefault();
          event.stopPropagation();
          runFullAuto(button);
        }
      }
    });
    button.appendChild(icon('sparkle'));
    button.appendChild(el('span', { text: AUTO_LABEL }));
    UI.scope(button);

    native.insertAdjacentElement('afterend', button);
  }

  async function init() {
    if (!/\/(?:exam|quiz)\//i.test(location.pathname)) return;

    // Papan skor tampil di halaman kuis selama Forum Tracker aktif, tanpa
    // bergantung pada fitur Analisis Kuis.
    if (await store.enabled('forumTracker')) {
      onMutate(syncLeaderboard);
    }

    if (!(await store.enabled('quizHelper'))) return;

    panel = UI.panel({
      id: 'xmt-quiz-panel',
      title: 'Analisis Kuis',
      subtitle: 'bahan tinjauan',
      iconName: 'quiz',
      anchor: 'fab-right',
      tabs: [{ id: 'quiz', label: 'Soal', render: renderList }],
      headActions: [
        UI.parts.asyncButton({
          label: 'Ambil soal',
          iconName: 'refresh',
          size: 'sm',
          busyLabel: 'Memuat…',
          onClick: reload
        })
      ]
    });

    // Id tombol mengikuti pola `<id panel>-toggle`; tombol apung otomatis
    // dikecualikan dari penangan klik-di-luar milik panel.
    UI.fab({
      id: 'xmt-quiz-panel-toggle',
      title: 'X Mentari — Analisis Kuis',
      label: 'Q',
      variant: 'accent',
      order: 1,
      onClick: () => {
        panel.toggle('quiz');
        if (panel.isOpen && state.questions.length === 0 && !state.loading) reload();
      }
    });

    // Sisipkan tombol satu-klik hanya bila kirim otomatis diaktifkan, dan
    // jaga tetap terpasang saat MENTARI merender ulang toolbarnya.
    if (await store.enabled('quizAutoSubmit')) {
      onMutate(syncAutoButton);
    }

    window.XMTQuiz = {
      reload,
      analyse: () => runAnalysis(panel.region('quiz')),
      auto: () => runFullAuto()
    };
  }

  init();
})();
