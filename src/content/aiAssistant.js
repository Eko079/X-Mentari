/**
 * X Mentari — panel asisten AI
 *
 * Percakapan dengan riwayat: setiap permintaan menyertakan beberapa putaran
 * terakhir sebagai konteks sehingga pertanyaan lanjutan dipahami. Riwayat
 * disimpan di penyimpanan ekstensi dan dipulihkan saat panel dibuka.
 *
 * Kunci API tidak pernah menyentuh berkas ini; permintaan diteruskan ke
 * service worker lewat XMTAI.
 */
(() => {
  if (window.__XMT_ASSISTANT__) return;
  window.__XMT_ASSISTANT__ = true;

  const { KEYS, LIMITS } = globalThis.XMT_CONST;
  const { el, replace, icon, setReactValue } = globalThis.XMTDom;
  const { uniqueBy } = globalThis.XMTUtil;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;
  const ai = globalThis.XMTAI;

  /** Gaya jawaban yang bisa dipilih; dikirim sebagai instruksi tambahan. */
  const STYLE_CHIPS = [
    { id: 'ringkas', label: 'Ringkas', hint: 'Jawab sesingkat mungkin, langsung ke inti.' },
    { id: 'lengkap', label: 'Lengkap', hint: 'Berikan penjelasan menyeluruh beserta contoh.' },
    { id: 'poin', label: 'Poin', hint: 'Susun jawaban sebagai daftar poin.' },
    { id: 'santai', label: 'Santai', hint: 'Gunakan bahasa non-formal yang tetap sopan.' },
    { id: 'akademis', label: 'Akademis', hint: 'Gunakan ragam bahasa akademis yang formal.' }
  ];

  const state = {
    history: [],
    busy: false,
    styles: new Set()
  };

  let panel;
  let historyRegion;
  let composerInput;
  let sendButton;

  /* --------------------------------------------------- pengambilan konteks */

  /**
   * Mengumpulkan teks yang tampak seperti materi utama halaman.
   *
   * Berguna saat pengguna ingin bertanya tentang soal atau diskusi yang
   * sedang dibuka tanpa menyalinnya sendiri.
   */
  function grabPageContext() {
    const selectors = [
      '.ck-content',
      '[class*="question"]',
      '.MuiCardContent-root',
      '.MuiPaper-root .MuiTypography-body1',
      'article'
    ];

    const found = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        // Lewati elemen antarmuka ekstensi sendiri.
        if (node.closest('.xmt-scope')) continue;

        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text.length < 40) continue;
        found.push(text);
      }
    }

    const unique = uniqueBy(found, (text) => text.slice(0, 80).toLowerCase());

    // Buang teks yang sudah terkandung di dalam potongan lain, karena
    // struktur MUI bersarang membuat teks yang sama terambil berulang.
    const distinct = unique.filter(
      (text, index) => !unique.some((other, otherIndex) => otherIndex !== index && other.includes(text))
    );

    return distinct.slice(0, 6).join('\n\n');
  }

  /* -------------------------------------------------------------- riwayat */

  async function loadHistory() {
    const saved = await store.get(KEYS.CHAT_HISTORY);
    state.history = Array.isArray(saved) ? saved : [];
  }

  async function saveHistory() {
    // Batasi ukuran agar penyimpanan ekstensi tidak tumbuh tanpa batas.
    state.history = state.history.slice(-LIMITS.CHAT_KEEP);
    await store.set(KEYS.CHAT_HISTORY, state.history);
  }

  /* --------------------------------------------------------------- render */

  /** Menyisipkan teks ke kolom jawaban MENTARI yang sedang terbuka. */
  function insertIntoPage(text) {
    const target =
      document.querySelector(
        '.MuiInputBase-inputMultiline:not([readonly]):not([disabled])'
      ) ?? document.querySelector('.ck-editor__editable[contenteditable="true"]');

    if (!target) {
      UI.toast('Kolom jawaban tidak ditemukan di halaman ini.', 'error');
      return;
    }

    if (target.isContentEditable) {
      target.focus();
      // CKEditor mengabaikan penulisan langsung ke textContent, jadi
      // penyisipan dilakukan lewat perintah editing bawaan peramban.
      document.execCommand('insertText', false, text);
    } else {
      setReactValue(target, text);
      target.focus();
    }

    UI.toast('Teks disisipkan ke kolom jawaban.', 'success');
  }

  function bubbleTools(text) {
    return el('div', { class: 'xmt-bubble-tools' }, [
      UI.parts.copyButton(() => text),
      el(
        'button',
        {
          type: 'button',
          class: 'xmt-btn',
          dataset: { size: 'sm' },
          title: 'Sisipkan ke kolom jawaban MENTARI',
          on: { click: () => insertIntoPage(text) }
        },
        [icon('insert'), el('span', { text: 'Sisipkan' })]
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'xmt-btn',
          dataset: { size: 'sm' },
          title: 'Minta versi yang lebih ringkas',
          on: { click: () => reviseLast('shorten') }
        },
        [icon('magic'), el('span', { text: 'Ringkas' })]
      )
    ]);
  }

  function renderBubble(entry) {
    const from = entry.role === 'user' ? 'user' : entry.role === 'error' ? 'error' : 'ai';

    const bubble = el('div', { class: 'xmt-bubble', dataset: { from } }, [
      el('span', { text: entry.text })
    ]);

    if (from === 'ai') bubble.appendChild(bubbleTools(entry.text));

    return bubble;
  }

  function scrollToEnd() {
    historyRegion.scrollTop = historyRegion.scrollHeight;
  }

  function renderHistory() {
    if (state.history.length === 0) {
      replace(historyRegion, [
        el('div', { class: 'xmt-empty' }, [
          el('div', { class: 'xmt-empty-title', text: 'Mulai percakapan' }),
          el('div', {
            class: 'xmt-empty-text',
            text: 'Tanyakan materi kuliah, minta penjelasan konsep, atau ambil isi halaman ini sebagai konteks dengan tombol di kepala panel.'
          })
        ])
      ]);
      return;
    }

    replace(historyRegion, state.history.map(renderBubble));
    scrollToEnd();
  }

  function showTyping() {
    const node = el('div', { class: 'xmt-typing' }, [
      el('span'),
      el('span'),
      el('span')
    ]);
    historyRegion.appendChild(node);
    scrollToEnd();
    return node;
  }

  /* ---------------------------------------------------------- pengiriman */

  function styleInstruction() {
    if (state.styles.size === 0) return '';
    const hints = STYLE_CHIPS.filter((chip) => state.styles.has(chip.id)).map((chip) => chip.hint);
    return `\n\nInstruksi gaya: ${hints.join(' ')}`;
  }

  function setBusy(busy) {
    state.busy = busy;
    sendButton.disabled = busy;
    composerInput.disabled = busy;
  }

  async function ask(text) {
    if (state.busy) return;

    const question = text.trim();
    if (!question) return;

    // Bila ini pesan pertama, ganti keadaan kosong dengan daftar percakapan.
    if (state.history.length === 0) replace(historyRegion, []);

    state.history.push({ role: 'user', text: question });
    historyRegion.appendChild(renderBubble({ role: 'user', text: question }));
    scrollToEnd();
    await saveHistory();

    setBusy(true);
    const typing = showTyping();

    try {
      const { text: answer, truncated } = await ai.generate({
        prompt: question + styleInstruction(),
        system: ai.PROMPTS.assistant(),
        // Kirim riwayat tanpa pesan terakhir; pesan itu sudah menjadi prompt.
        history: state.history.slice(0, -1).map((entry) => ({
          role: entry.role === 'user' ? 'user' : 'model',
          text: entry.text
        }))
      });

      typing.remove();

      const cleaned = globalThis.XMTUtil.stripMarkdown(answer);
      state.history.push({ role: 'model', text: cleaned });
      historyRegion.appendChild(renderBubble({ role: 'model', text: cleaned }));

      if (truncated) {
        UI.toast('Jawaban terpotong karena mencapai batas panjang.', 'warning');
      }

      await saveHistory();
    } catch (error) {
      typing.remove();
      historyRegion.appendChild(renderBubble({ role: 'error', text: error.message }));

      // Arahkan langsung ke tempat masalahnya bisa diperbaiki.
      if (['no-provider', 'no-key', 'invalid-key', 'unauthorized', 'no-host-permission'].includes(error.code)) {
        historyRegion.appendChild(
          el('div', { class: 'xmt-cluster', style: { alignSelf: 'flex-start' } }, [
            el('button', {
              type: 'button',
              class: 'xmt-btn',
              dataset: { variant: 'primary', size: 'sm' },
              text: 'Atur penyedia AI',
              on: { click: () => globalThis.XMTAI.openOptions() }
            })
          ])
        );
      }
    } finally {
      setBusy(false);
      scrollToEnd();
      composerInput.focus();
    }
  }

  /** Meminta model menyunting ulang jawaban terakhirnya. */
  async function reviseLast(mode) {
    const last = [...state.history].reverse().find((entry) => entry.role === 'model');
    if (!last) return;
    if (state.busy) return;

    setBusy(true);
    const typing = showTyping();

    try {
      const revised = await ai.revise(mode, last.text);
      typing.remove();
      state.history.push({ role: 'model', text: revised });
      historyRegion.appendChild(renderBubble({ role: 'model', text: revised }));
      await saveHistory();
    } catch (error) {
      typing.remove();
      historyRegion.appendChild(renderBubble({ role: 'error', text: error.message }));
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }

  /* ------------------------------------------------------------ komposer */

  function buildComposer() {
    composerInput = el('textarea', {
      class: 'xmt-textarea',
      rows: 1,
      placeholder: 'Tanyakan apa saja… (Enter kirim, Shift+Enter baris baru)',
      'aria-label': 'Pertanyaan untuk asisten AI',
      on: {
        input: (event) => {
          // Tinggi mengikuti isi, sampai batas yang ditetapkan CSS.
          event.target.style.height = 'auto';
          event.target.style.height = `${event.target.scrollHeight}px`;
        },
        keydown: (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            const text = composerInput.value;
            composerInput.value = '';
            composerInput.style.height = 'auto';
            ask(text);
          }
        }
      }
    });

    sendButton = el(
      'button',
      {
        type: 'button',
        class: 'xmt-btn',
        dataset: { variant: 'primary' },
        title: 'Kirim',
        'aria-label': 'Kirim pertanyaan',
        on: {
          click: () => {
            const text = composerInput.value;
            composerInput.value = '';
            composerInput.style.height = 'auto';
            ask(text);
          }
        }
      },
      [icon('send')]
    );

    return el('div', { class: 'xmt-composer' }, [composerInput, sendButton]);
  }

  function buildChipBar() {
    return el(
      'div',
      { class: 'xmt-chipbar' },
      STYLE_CHIPS.map((chip) =>
        el('button', {
          type: 'button',
          class: 'xmt-chip',
          'aria-pressed': 'false',
          text: chip.label,
          title: chip.hint,
          on: {
            click: (event) => {
              const active = state.styles.has(chip.id);
              if (active) state.styles.delete(chip.id);
              else state.styles.add(chip.id);
              event.currentTarget.setAttribute('aria-pressed', active ? 'false' : 'true');
            }
          }
        })
      )
    );
  }

  /* -------------------------------------------------------------- pasang */

  async function init() {
    if (!(await store.enabled('chatbot'))) return;

    await loadHistory();

    panel = UI.panel({
      id: 'xmt-ai-panel',
      title: 'Asisten AI',
      subtitle: 'Gemini',
      iconName: 'sparkle',
      anchor: 'header',
      tabs: [
        {
          id: 'chat',
          label: 'Percakapan',
          render: (region) => {
            historyRegion = el('div', { class: 'xmt-chat' });
            replace(region, [historyRegion]);
            renderHistory();
          }
        }
      ],
      headActions: [
        el(
          'button',
          {
            type: 'button',
            class: 'xmt-icon-btn',
            title: 'Ambil isi halaman sebagai konteks',
            'aria-label': 'Ambil isi halaman sebagai konteks',
            on: {
              click: () => {
                const context = grabPageContext();
                if (!context) {
                  UI.toast('Tidak ada materi yang bisa diambil dari halaman ini.', 'error');
                  return;
                }
                composerInput.value = `Berdasarkan materi berikut, jelaskan dan bantu jawab:\n\n${context}\n\n`;
                composerInput.dispatchEvent(new Event('input', { bubbles: true }));
                composerInput.focus();
                UI.toast(`Materi halaman diambil (${context.length} karakter).`, 'success');
              }
            }
          },
          [icon('grab')]
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'xmt-icon-btn',
            title: 'Hapus riwayat percakapan',
            'aria-label': 'Hapus riwayat percakapan',
            on: {
              click: async () => {
                if (state.history.length === 0) return;
                const ok = await UI.confirm({
                  title: 'Hapus riwayat percakapan?',
                  message: 'Seluruh pesan dalam percakapan ini akan dihapus.',
                  tone: 'danger',
                  confirmLabel: 'Hapus'
                });
                if (!ok) return;
                state.history = [];
                await saveHistory();
                renderHistory();
              }
            }
          },
          [icon('trash')]
        )
      ]
    });

    // Bilah gaya dan komposer berada di luar area gulir agar selalu terlihat.
    panel.root.appendChild(buildChipBar());
    panel.root.appendChild(buildComposer());
    // Kaki panel dipindahkan ke bawah komposer supaya urutannya tetap benar.
    panel.root.appendChild(panel.root.querySelector('.xmt-panel-foot'));

    UI.headerButton({
      id: 'xmt-ai-btn',
      title: 'X Mentari — Asisten AI',
      iconName: 'sparkle',
      onClick: () => {
        panel.toggle('chat');
        if (panel.isOpen) setTimeout(() => composerInput?.focus(), 60);
      }
    });

    UI.registerOpener('assistant', () => panel.open('chat'));

    window.XMTAssistant = {
      open: () => panel.open('chat'),
      ask,
      grabPageContext
    };
  }

  init();
})();
