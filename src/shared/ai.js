/**
 * X Mentari — klien AI
 *
 * Content script, popup, dan halaman opsi tidak pernah memanggil penyedia
 * secara langsung dan tidak pernah memegang kunci API. Semua permintaan
 * diteruskan ke service worker, yang memilih adapter sesuai penyedia aktif
 * dan melakukan panggilan HTTP.
 *
 * Konsekuensinya: skrip milik halaman kampus tidak bisa membaca kunci API
 * pengguna, karena kunci itu tidak pernah ada di konteks halaman.
 */
(() => {
  if (globalThis.XMTAI) return;

  const { MSG, LIMITS } = globalThis.XMT_CONST;

  /* ---------------------------------------------------------- prompt */

  const STYLE_RULES = [
    'Tulis dalam bahasa Indonesia yang wajar dan mudah dibaca.',
    'Keluarkan teks biasa saja: tanpa tanda bintang, tanpa tagar, tanpa huruf tebal atau miring.',
    'Jangan awali jawaban dengan kalimat pembuka seperti "Berikut jawabannya" atau "Tentu".',
    'Jika pertanyaannya bernomor, jawab dengan penomoran yang sama.',
    'Jika materinya pemrograman, sertakan contoh kode singkat.'
  ].join(' ');

  const PROMPTS = {
    assistant: () =>
      [
        'Kamu asisten akademik untuk mahasiswa Universitas Pamulang.',
        'Jawab langsung ke inti, akurat, dan tidak berputar.',
        STYLE_RULES,
        'Bila kamu tidak yakin pada suatu fakta, katakan terus terang alih-alih menebak.'
      ].join(' '),

    discussion: (content) =>
      [
        'Baca materi diskusi berikut, lalu susun satu jawaban yang utuh dan sesuai konteks.',
        STYLE_RULES,
        '',
        '--- MATERI DISKUSI ---',
        content,
        '--- AKHIR MATERI ---',
        '',
        'Jawaban:'
      ].join('\n'),

    questions: (content) =>
      [
        'Baca materi diskusi berikut, lalu usulkan tiga pertanyaan yang relevan dan layak diajukan.',
        'Setiap pertanyaan berdiri sendiri, satu per baris, tanpa penomoran maupun bullet.',
        'Jangan memulai pertanyaan dengan kata penghubung seperti "selain itu" atau "dan".',
        '',
        '--- MATERI DISKUSI ---',
        content,
        '--- AKHIR MATERI ---',
        '',
        'Pertanyaan:'
      ].join('\n'),

    revise: (mode, text) => {
      const instruction =
        {
          shorten: 'Ringkas teks berikut menjadi lebih padat tanpa kehilangan inti.',
          expand: 'Perluas teks berikut dengan penjelasan dan contoh tambahan yang relevan.',
          paragraph: 'Ubah teks berikut menjadi satu paragraf yang mengalir.',
          numbered: 'Ubah teks berikut menjadi daftar bernomor.',
          simpler: 'Tulis ulang teks berikut dengan bahasa yang lebih sederhana.',
          formal: 'Tulis ulang teks berikut dengan bahasa yang lebih formal dan akademis.'
        }[mode] ?? 'Perbaiki teks berikut.';

      return [instruction, STYLE_RULES, '', text].join('\n');
    },

    quiz: (question, options) => {
      const choices = options
        .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
        .join('\n');

      return [
        'Analisis soal pilihan ganda berikut dan tentukan opsi yang paling tepat.',
        'Balas tepat dalam tiga baris dengan format ini:',
        'Jawaban: <huruf>',
        'Keyakinan: <tinggi|sedang|rendah>',
        'Alasan: <satu sampai dua kalimat>',
        '',
        `SOAL:\n${question}`,
        '',
        `PILIHAN:\n${choices}`
      ].join('\n');
    },

    summarize: (content) =>
      ['Rangkum materi berikut menjadi poin-poin inti.', STYLE_RULES, '', content, '', 'Ringkasan:'].join(
        '\n'
      )
  };

  /* -------------------------------------------------- lapisan pesan */

  class AIError extends Error {
    constructor(message, { code = 'unknown', permanent = false } = {}) {
      super(message);
      this.name = 'AIError';
      this.code = code;
      this.permanent = permanent;
    }
  }

  async function send(type, payload = {}) {
    let response;

    try {
      response = await chrome.runtime.sendMessage({ type, ...payload });
    } catch (error) {
      const message = String(error?.message ?? '');
      if (message.includes('Extension context invalidated')) {
        throw new AIError('Ekstensi baru dimuat ulang. Segarkan halaman ini.', {
          code: 'context',
          permanent: true
        });
      }
      throw new AIError('Tidak bisa menghubungi bagian belakang ekstensi.', { code: 'transport' });
    }

    if (!response) throw new AIError('Tidak ada balasan dari ekstensi.', { code: 'empty' });

    if (!response.ok) {
      throw new AIError(response.error ?? 'Permintaan AI gagal.', {
        code: response.code ?? 'unknown',
        permanent: Boolean(response.permanent)
      });
    }

    return response.data;
  }

  /* ------------------------------------------------------------ API */

  const ai = {
    PROMPTS,
    AIError,

    async generate({ prompt, system, history = [], model, maxTokens, temperature } = {}) {
      if (!prompt?.trim()) throw new AIError('Prompt kosong.', { code: 'empty-prompt' });

      return send(MSG.AI_GENERATE, {
        prompt,
        system,
        history: history.slice(-LIMITS.CHAT_CONTEXT),
        model,
        maxTokens,
        temperature
      });
    },

    /** Menguji konfigurasi penyedia (belum tentu tersimpan). */
    async testProvider(provider) {
      return send(MSG.AI_TEST_PROVIDER, { provider });
    },

    /** Model yang tersedia untuk penyedia aktif. */
    async listModels() {
      return send(MSG.AI_LIST_MODELS);
    },

    async quota() {
      return send(MSG.QUOTA_GET);
    },

    /** Meminta service worker membuka halaman opsi. */
    async openOptions() {
      return send(MSG.OPEN_OPTIONS);
    },

    async answerQuestion(question, options) {
      const { text } = await ai.generate({
        prompt: PROMPTS.quiz(question, options),
        maxTokens: 320,
        temperature: 0.1
      });

      const { parseAnswerLetter, parseExplanation } = globalThis.XMTUtil;
      const confidence = /keyakinan\s*[:\-–]?\s*(tinggi|sedang|rendah)/i.exec(text)?.[1]?.toLowerCase();

      return {
        letter: parseAnswerLetter(text, options.length),
        confidence: confidence ?? 'sedang',
        explanation: parseExplanation(text),
        raw: text
      };
    },

    async draftDiscussion(content) {
      const { text } = await ai.generate({
        prompt: PROMPTS.discussion(content),
        maxTokens: 2048,
        temperature: 0.7
      });
      return globalThis.XMTUtil.stripMarkdown(text);
    },

    async suggestQuestions(content) {
      const { text } = await ai.generate({
        prompt: PROMPTS.questions(content),
        maxTokens: 640,
        temperature: 0.85
      });
      return globalThis.XMTUtil.toLines(globalThis.XMTUtil.stripMarkdown(text), 5);
    },

    async revise(mode, text) {
      const result = await ai.generate({
        prompt: PROMPTS.revise(mode, text),
        maxTokens: 2048,
        temperature: 0.6
      });
      return globalThis.XMTUtil.stripMarkdown(result.text);
    }
  };

  globalThis.XMTAI = ai;
})();
