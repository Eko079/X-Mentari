/**
 * X Mentari — bantuan diskusi forum
 *
 * Menyisipkan tombol di samping tombol kirim pada halaman topik forum.
 * Tombol menyusun draf jawaban atau usulan pertanyaan, lalu menampilkannya
 * di bawah pos yang bersangkutan agar bisa ditinjau, disunting, atau
 * disisipkan ke kolom jawaban.
 *
 * Tidak ada tahap yang mengirim balasan. Pengguna tetap yang menekan kirim.
 */
(() => {
  if (window.__XMT_DISCUSSION__) return;
  window.__XMT_DISCUSSION__ = true;

  const { el, replace, icon, onMutate, setReactValue } = globalThis.XMTDom;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;
  const ai = globalThis.XMTAI;

  const SELECTORS = {
    /** Tombol kirim balasan MENTARI berwarna hijau. */
    sendButton: '.MuiButton-containedSuccess',
    post: '.MuiPaper-root, [role="article"]',
    content: ['.ck-content', '.MuiCardContent-root', '[class*="content"]'],
    interactive: 'button, a, input, select, textarea'
  };

  const REVISE_MODES = [
    { mode: 'shorten', label: 'Ringkas' },
    { mode: 'expand', label: 'Perpanjang' },
    { mode: 'paragraph', label: 'Satu paragraf' },
    { mode: 'numbered', label: 'Bernomor' },
    { mode: 'simpler', label: 'Sederhanakan' },
    { mode: 'formal', label: 'Formalkan' }
  ];

  /* ------------------------------------------------------ ekstraksi materi */

  /**
   * Mengambil teks materi dari sebuah pos.
   *
   * Elemen yang memuat kontrol interaktif dilewati karena hampir selalu
   * merupakan pembungkus antarmuka, bukan isi diskusi.
   */
  function extractContent(container) {
    for (const selector of SELECTORS.content) {
      for (const node of container.querySelectorAll(selector)) {
        if (node.closest('.xmt-scope')) continue;
        if (node.querySelector(SELECTORS.interactive)) continue;

        const text = (node.textContent ?? '').trim();
        if (text.length > 50) return text;
      }
    }

    // Cadangan: seluruh teks pos, dikurangi antarmuka ekstensi.
    const clone = container.cloneNode(true);
    clone.querySelectorAll('.xmt-scope').forEach((node) => node.remove());
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  /** Menandai pos yang tampaknya berasal dari dosen. */
  function looksLikeLecturer(container) {
    const heads = container.querySelectorAll(
      'strong, b, [class*="author"], [class*="name"], .MuiTypography-subtitle2'
    );

    for (const node of heads) {
      const text = (node.textContent ?? '').trim();
      if (!text || text.length > 80) continue;
      if (/\b(dosen|lecturer|pengajar|prof\.?|dr\.?|s\.kom|m\.kom|m\.pd|s\.pd)\b/i.test(text)) {
        return true;
      }
    }

    return false;
  }

  /** Menemukan kolom jawaban yang berpasangan dengan sebuah tombol kirim. */
  function findReplyInput(sendButton) {
    const form = sendButton.closest('form') ?? sendButton.closest('.MuiPaper-root') ?? document;

    return (
      form.querySelector('.MuiInputBase-inputMultiline:not([readonly]):not([disabled])') ??
      form.querySelector('.ck-editor__editable[contenteditable="true"]') ??
      document.querySelector('.MuiInputBase-inputMultiline:not([readonly]):not([disabled])')
    );
  }

  function insertIntoReply(sendButton, text) {
    const input = findReplyInput(sendButton);

    if (!input) {
      UI.toast('Kolom jawaban tidak ditemukan.', 'error');
      return;
    }

    if (input.isContentEditable) {
      input.focus();
      document.execCommand('insertText', false, text);
    } else {
      setReactValue(input, text);
      input.focus();
    }

    UI.toast('Draf disisipkan. Periksa dulu sebelum mengirim.', 'success');
  }

  /* ------------------------------------------------------------ kotak hasil */

  /** Wadah hasil di bawah pos; satu per pos, dipakai ulang. */
  function ensureResultBox(post) {
    let box = post.querySelector(':scope > .xmt-inline-answer');
    if (box) return box;

    box = UI.scope(el('div', { class: 'xmt-inline-answer' }));
    post.appendChild(box);
    return box;
  }

  function renderDraft(box, sendButton, text, { title = 'Draf jawaban' } = {}) {
    let current = text;

    const textNode = el('div', { class: 'xmt-inline-answer-text', text: current });

    const tools = el('div', { class: 'xmt-inline-answer-tools' }, [
      UI.parts.copyButton(() => current),
      el(
        'button',
        {
          type: 'button',
          class: 'xmt-btn',
          dataset: { variant: 'accent', size: 'sm' },
          on: { click: () => insertIntoReply(sendButton, current) }
        },
        [icon('insert'), el('span', { text: 'Sisipkan ke kolom' })]
      ),
      ...REVISE_MODES.map((entry) =>
        UI.parts.asyncButton({
          label: entry.label,
          size: 'sm',
          busyLabel: '…',
          onClick: async () => {
            const revised = await ai.revise(entry.mode, current);
            current = revised;
            textNode.textContent = revised;
          }
        })
      )
    ]);

    replace(box, [
      el('div', { class: 'xmt-inline-answer-head' }, [
        el('span', { text: title }),
        el('button', {
          type: 'button',
          class: 'xmt-icon-btn',
          title: 'Tutup',
          'aria-label': 'Tutup draf',
          on: { click: () => box.remove() }
        })
      ]),
      textNode,
      UI.parts.notice({
        tone: 'warning',
        text: 'Ini draf yang dihasilkan AI. Periksa isinya dan sesuaikan dengan pemahaman Anda sebelum mengirim.'
      }),
      tools
    ]);

    box.querySelector('.xmt-icon-btn')?.appendChild(icon('close'));
  }

  function renderQuestions(box, sendButton, questions) {
    replace(box, [
      el('div', { class: 'xmt-inline-answer-head' }, [
        el('span', { text: 'Usulan pertanyaan' }),
        el('button', {
          type: 'button',
          class: 'xmt-icon-btn',
          title: 'Tutup',
          'aria-label': 'Tutup usulan',
          on: { click: () => box.remove() }
        })
      ]),
      el(
        'div',
        { class: 'xmt-stack' },
        questions.map((question) =>
          el('div', { class: 'xmt-card' }, [
            el('div', { class: 'xmt-inline-answer-text', text: question }),
            el('div', { class: 'xmt-inline-answer-tools' }, [
              UI.parts.copyButton(() => question),
              el(
                'button',
                {
                  type: 'button',
                  class: 'xmt-btn',
                  dataset: { variant: 'accent', size: 'sm' },
                  on: { click: () => insertIntoReply(sendButton, question) }
                },
                [icon('insert'), el('span', { text: 'Sisipkan' })]
              )
            ])
          ])
        )
      )
    ]);

    box.querySelector('.xmt-icon-btn')?.appendChild(icon('close'));
  }

  function renderError(box, message) {
    replace(box, [
      el('div', { class: 'xmt-inline-answer-head' }, [el('span', { text: 'Gagal' })]),
      UI.parts.notice({ tone: 'danger', text: message })
    ]);
  }

  /* -------------------------------------------------------- penyisipan tombol */

  /** Membangun satu tombol aksi bergaya MENTARI. */
  function actionButton({ label, iconName, variant, onRun }) {
    const button = el('button', {
      type: 'button',
      class: 'xmt-scope xmt-btn xmt-discussion-action',
      dataset: { variant, size: 'sm' },
      style: { marginRight: '8px' }
    });

    const paint = (text, busy) => {
      button.replaceChildren();
      if (busy) button.appendChild(el('div', { class: 'xmt-spinner', dataset: { size: 'sm' } }));
      else button.appendChild(icon(iconName));
      button.appendChild(el('span', { text }));
    };

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;

      button.disabled = true;
      paint('Memproses…', true);

      try {
        await onRun();
      } finally {
        button.disabled = false;
        paint(label, false);
      }
    });

    paint(label, false);
    UI.scope(button);
    return button;
  }

  /**
   * Menyisipkan tombol bantuan di samping setiap tombol kirim.
   *
   * Dipanggil ulang setiap kali DOM berubah, jadi harus idempoten:
   * kehadiran tombol diperiksa lebih dulu.
   */
  function injectButtons() {
    for (const sendButton of document.querySelectorAll(SELECTORS.sendButton)) {
      const host = sendButton.parentElement;
      if (!host || host.querySelector('.xmt-discussion-action')) continue;

      const post = sendButton.closest(SELECTORS.post);
      if (!post) continue;

      const draftButton = actionButton({
        label: 'Susun draf',
        iconName: 'magic',
        variant: 'accent',
        onRun: async () => {
          const box = ensureResultBox(post);
          const content = extractContent(post);

          if (content.length < 30) {
            renderError(box, 'Materi diskusi terlalu pendek untuk dianalisis.');
            return;
          }

          try {
            const draft = await ai.draftDiscussion(content);
            renderDraft(box, sendButton, draft);
          } catch (error) {
            renderError(box, error.message);
          }
        }
      });

      host.insertBefore(draftButton, sendButton);

      // Usulan pertanyaan hanya relevan pada pos dosen; pada pos sesama
      // mahasiswa yang dibutuhkan biasanya tanggapan, bukan pertanyaan baru.
      if (looksLikeLecturer(post)) {
        const questionButton = actionButton({
          label: 'Usulkan pertanyaan',
          iconName: 'info',
          onRun: async () => {
            const box = ensureResultBox(post);
            const content = extractContent(post);

            try {
              const questions = await ai.suggestQuestions(content);
              if (questions.length === 0) {
                renderError(box, 'Model tidak menghasilkan usulan pertanyaan.');
                return;
              }
              renderQuestions(box, sendButton, questions);
            } catch (error) {
              renderError(box, error.message);
            }
          }
        });

        host.insertBefore(questionButton, draftButton);
      }
    }
  }

  /* ---------------------------------------------------------------- pasang */

  async function init() {
    if (!(await store.enabled('discussionHelper'))) return;

    if (!(await store.hasProvider())) {
      // Tanpa penyedia AI tombol hanya akan menghasilkan galat, jadi lebih
      // baik tidak menampilkannya sampai penyedia diatur.
      const stop = store.watch(globalThis.XMT_CONST.KEYS.PROVIDERS, async () => {
        if (await store.hasProvider()) {
          stop();
          onMutate(injectButtons);
        }
      });
      return;
    }

    onMutate(injectButtons);

    window.XMTDiscussion = { injectButtons, extractContent };
  }

  init();
})();
