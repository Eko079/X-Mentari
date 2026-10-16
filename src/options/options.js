/**
 * X Mentari — halaman opsi: manajemen penyedia AI
 *
 * Tempat pengguna menambah, menyunting, menguji, dan menghapus penyedia.
 * Setiap penyedia punya jenis protokol, alamat dasar, kunci API, model, dan
 * header tambahan opsional. Endpoint kustom apa pun bisa dipakai.
 *
 * Izin akses ke origin penyedia kustom diminta di sini lewat
 * chrome.permissions.request, karena origin itu tidak tercantum di
 * host_permissions manifest.
 */
(() => {
  const { KEYS, PRESETS, KIND_META, PROVIDER_KIND, NAME, VERSION } = globalThis.XMT_CONST;
  const { el, replace, icon, onMutate } = globalThis.XMTDom;
  const { timeAgo } = globalThis.XMTUtil;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;
  const ai = globalThis.XMTAI;
  const P = globalThis.XMTProviders;

  const state = {
    providers: [],
    activeId: null,
    editingId: null,
    /** Salinan yang sedang disunting; belum tentu sama dengan yang tersimpan. */
    draft: null
  };

  const listEl = () => document.getElementById('opt-list');
  const editorEl = () => document.getElementById('opt-editor');

  /* --------------------------------------------------------- izin host */

  /**
   * Meminta izin akses ke origin penyedia bila belum ada.
   *
   * Harus dipicu langsung oleh gestur pengguna (klik), jadi dipanggil dari
   * handler tombol, bukan otomatis.
   */
  async function ensurePermission(baseUrl) {
    const pattern = P.originPattern(baseUrl);
    if (!pattern) return { ok: false, message: 'Alamat dasar tidak valid.' };

    try {
      const url = new URL(baseUrl);
      // Origin lokal tidak memerlukan host permission untuk fetch dari
      // service worker.
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return { ok: true };
      }

      const has = await chrome.permissions.contains({ origins: [pattern] });
      if (has) return { ok: true };

      const granted = await chrome.permissions.request({ origins: [pattern] });
      return granted
        ? { ok: true }
        : { ok: false, message: 'Izin ditolak. Penyedia ini tidak bisa dipakai tanpa izin akses.' };
    } catch (error) {
      return { ok: false, message: error?.message ?? 'Gagal meminta izin akses.' };
    }
  }

  /* --------------------------------------------------------- intro */

  function renderIntro() {
    replace(document.getElementById('opt-intro'), [
      UI.parts.notice({
        tone: 'info',
        title: 'Satu atau banyak penyedia AI.',
        text: 'Tambahkan Gemini, OpenAI, OpenRouter, Groq, DeepSeek, Claude, model lokal, atau endpoint kustom apa pun. Penyedia yang ditandai aktif dipakai oleh semua fitur AI. Kunci API disimpan di penyimpanan ekstensi dan tidak pernah masuk ke halaman kampus.'
      })
    ]);
  }

  /* --------------------------------------------------------- daftar */

  function renderList() {
    if (state.providers.length === 0) {
      replace(listEl(), [
        UI.parts.notice({
          tone: 'warning',
          text: 'Belum ada penyedia. Tekan Tambah penyedia untuk mulai.'
        })
      ]);
      return;
    }

    replace(
      listEl(),
      state.providers.map((provider) => {
        const kindLabel = KIND_META[provider.kind]?.label ?? provider.kind;
        const active = provider.id === state.activeId;

        return el(
          'button',
          {
            type: 'button',
            class: 'opt-provider',
            'aria-current': active ? 'true' : 'false',
            on: { click: () => edit(provider.id) }
          },
          [
            el('div', { class: 'xmt-item-icon', dataset: { tone: active ? 'brand' : undefined } }, [
              icon('sparkle')
            ]),
            el('div', { class: 'opt-provider-body' }, [
              el('div', { class: 'opt-provider-name' }, [
                provider.name,
                active && el('span', { text: ' ' }),
                active && UI.parts.badge('Aktif', 'success')
              ]),
              el('div', { class: 'opt-provider-meta', text: `${kindLabel} · ${provider.model || 'model belum diisi'}` })
            ]),
            el('span', { class: 'xmt-item-trail' }, [icon('chevron')])
          ]
        );
      })
    );
  }

  /* --------------------------------------------------------- editor */

  /** Menyiapkan draft dari preset lalu membuka editor untuk penyedia baru. */
  function addFromPreset(preset) {
    state.editingId = null;
    state.draft = P.normalize({
      id: crypto.randomUUID(),
      name: preset.name === 'Endpoint kustom' ? '' : preset.name,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      model: preset.model,
      models: preset.models ?? [],
      keyOptional: preset.keyOptional,
      local: preset.local
    });
    state.draft._preset = preset;
    renderEditor();
  }

  async function edit(id) {
    const provider = state.providers.find((entry) => entry.id === id);
    if (!provider) return;
    state.editingId = id;
    state.draft = P.normalize(provider);
    renderEditor();
    renderList();
  }

  function kindSelect() {
    return el(
      'select',
      { class: 'xmt-select', 'aria-label': 'Jenis protokol' },
      Object.entries(KIND_META).map(([kind, meta]) =>
        el('option', { value: kind, text: meta.label, selected: kind === state.draft.kind })
      )
    );
  }

  function renderEditor() {
    if (!state.draft) {
      replace(editorEl(), [
        el('div', { class: 'opt-editor-empty' }, [
          icon('sparkle', { size: 32 }),
          el('div', { class: 'xmt-empty-title', text: 'Pilih atau tambah penyedia' }),
          el('div', {
            class: 'xmt-empty-text',
            text: 'Pilih penyedia di kiri untuk menyuntingnya, atau tekan Tambah penyedia.'
          })
        ])
      ]);
      return;
    }

    const draft = state.draft;
    const meta = KIND_META[draft.kind] ?? {};
    const isNew = !state.editingId;

    const bind = (field) => ({
      input: (event) => {
        draft[field] = event.target.value;
      }
    });

    const nameInput = el('input', {
      class: 'xmt-input',
      value: draft.name,
      placeholder: 'Nama tampilan, misalnya "Gemini pribadi"',
      on: bind('name')
    });

    const kindEl = kindSelect();
    kindEl.addEventListener('change', (event) => {
      draft.kind = event.target.value;
      renderEditor();
    });

    const baseUrlInput = el('input', {
      class: 'xmt-input',
      value: draft.baseUrl,
      placeholder: 'https://…',
      spellcheck: false,
      on: bind('baseUrl')
    });

    const modelInput = el('input', {
      class: 'xmt-input',
      value: draft.model,
      placeholder: 'nama-model',
      spellcheck: false,
      on: bind('model')
    });

    // Bila preset menyertakan daftar model, tawarkan lewat datalist agar
    // mudah dipilih tetapi tetap bisa diketik bebas.
    const modelList = el('datalist', { id: 'opt-model-list' },
      (draft.models ?? []).map((model) => el('option', { value: model }))
    );
    modelInput.setAttribute('list', 'opt-model-list');

    const keyInput = el('input', {
      type: 'password',
      class: 'xmt-input',
      value: draft.apiKey,
      placeholder: draft.keyOptional ? 'Opsional untuk server lokal' : (meta.keyHint ?? 'Kunci API'),
      autocomplete: 'off',
      spellcheck: false,
      on: bind('apiKey')
    });

    const revealKey = el('button', {
      type: 'button',
      class: 'xmt-icon-btn',
      title: 'Tampilkan atau sembunyikan kunci',
      on: {
        click: () => {
          const hidden = keyInput.type === 'password';
          keyInput.type = hidden ? 'text' : 'password';
          replace(revealKey, [icon(hidden ? 'eyeOff' : 'eye')]);
        }
      }
    });
    revealKey.appendChild(icon('eye'));

    // Header tambahan ditulis sebagai teks "Nama: nilai" per baris.
    const headersText = Object.entries(draft.headers ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    const headersInput = el('textarea', {
      class: 'xmt-textarea',
      style: { minHeight: '64px' },
      placeholder: 'Opsional. Satu per baris, contoh:\nHTTP-Referer: https://situs-anda',
      value: headersText,
      spellcheck: false,
      on: {
        input: (event) => {
          draft.headers = parseHeaders(event.target.value);
        }
      }
    });

    const testResult = el('div', { class: 'opt-test-result' });

    const presetNote = draft._preset?.note;
    const keyUrl = draft._preset?.keyUrl;

    replace(editorEl(), [
      UI.parts.card({
        title: isNew ? 'Penyedia baru' : `Sunting: ${draft.name || 'Penyedia'}`,
        children: [
          presetNote && el('p', { class: 'xmt-hint', style: { marginTop: 0 }, text: presetNote }),

          el('div', { class: 'opt-form-grid', style: { marginTop: '12px' } }, [
            el('div', { class: 'xmt-field opt-span-2' }, [
              el('label', { class: 'xmt-label', text: 'Nama' }),
              nameInput
            ]),

            el('div', { class: 'xmt-field' }, [
              el('label', { class: 'xmt-label', text: 'Protokol' }),
              kindEl,
              el('div', { class: 'xmt-hint', text: meta.desc ?? '' })
            ]),

            el('div', { class: 'xmt-field' }, [
              el('label', { class: 'xmt-label', text: 'Model' }),
              modelInput,
              modelList
            ]),

            el('div', { class: 'xmt-field opt-span-2' }, [
              el('label', { class: 'xmt-label', text: 'Alamat dasar (base URL)' }),
              baseUrlInput,
              el('div', { class: 'xmt-hint', text: `Endpoint ${meta.pathHint ?? ''} akan ditambahkan otomatis.` })
            ]),

            el('div', { class: 'xmt-field opt-span-2' }, [
              el('label', { class: 'xmt-label' }, [
                'Kunci API',
                keyUrl &&
                  el('span', {}, [
                    ' — ',
                    el('a', {
                      href: keyUrl,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      text: 'ambil kunci',
                      style: { color: 'var(--xmt-brand)' }
                    })
                  ])
              ]),
              el('div', { class: 'xmt-input-group' }, [keyInput, revealKey]),
              el('div', {
                class: 'xmt-hint',
                text: `Header: ${meta.keyHeader ?? '-'}. Disimpan di penyimpanan ekstensi, tidak pernah dikirim ke halaman kampus.`
              })
            ]),

            el('div', { class: 'xmt-field opt-span-2' }, [
              el('label', { class: 'xmt-label', text: 'Header tambahan (opsional)' }),
              headersInput
            ])
          ]),

          el('div', { class: 'xmt-cluster', style: { marginTop: '16px' } }, [
            UI.parts.asyncButton({
              label: 'Uji koneksi',
              iconName: 'refresh',
              busyLabel: 'Menguji…',
              onClick: () => runTest(testResult)
            }),
            UI.parts.asyncButton({
              label: isNew ? 'Simpan penyedia' : 'Simpan perubahan',
              iconName: 'check',
              variant: 'primary',
              busyLabel: 'Menyimpan…',
              onClick: save
            }),
            !isNew &&
              draft.id !== state.activeId &&
              el('button', {
                type: 'button',
                class: 'xmt-btn',
                text: 'Jadikan aktif',
                on: { click: () => makeActive(draft.id) }
              }),
            !isNew &&
              el('button', {
                type: 'button',
                class: 'xmt-btn',
                dataset: { variant: 'danger' },
                text: 'Hapus',
                on: { click: () => remove(draft.id) }
              })
          ]),

          testResult
        ]
      })
    ]);
  }

  /** Mengurai teks header "Nama: nilai" per baris menjadi objek. */
  function parseHeaders(text) {
    const headers = {};
    for (const line of String(text ?? '').split('\n')) {
      const index = line.indexOf(':');
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key && value) headers[key] = value;
    }
    return headers;
  }

  /* --------------------------------------------------------- aksi */

  async function runTest(target) {
    const check = P.validate(state.draft);
    if (!check.valid) {
      replace(target, [UI.parts.notice({ tone: 'danger', text: check.message })]);
      return;
    }

    const permission = await ensurePermission(state.draft.baseUrl);
    if (!permission.ok) {
      replace(target, [UI.parts.notice({ tone: 'danger', text: permission.message })]);
      return;
    }

    replace(target, [
      el('div', { class: 'xmt-loading', style: { padding: '12px' } }, [
        el('div', { class: 'xmt-spinner', dataset: { size: 'sm' } }),
        el('span', { text: 'Menghubungi penyedia…' })
      ])
    ]);

    const result = await ai.testProvider(state.draft);

    if (result.ok) {
      // Isi daftar model dari hasil uji agar mudah dipilih.
      if (result.models?.length) {
        state.draft.models = result.models;
        if (!state.draft.model) state.draft.model = result.models[0];
      }
      replace(target, [
        UI.parts.notice({ tone: 'success', text: result.message }),
        result.models?.length > 0 &&
          el('p', {
            class: 'xmt-hint',
            style: { marginTop: '8px' },
            text: `Model tersedia: ${result.models.slice(0, 8).join(', ')}${result.models.length > 8 ? ', …' : ''}`
          })
      ]);
    } else {
      replace(target, [UI.parts.notice({ tone: 'danger', text: result.message })]);
    }
  }

  async function save() {
    const check = P.validate(state.draft);
    if (!check.valid) {
      UI.toast(check.message, 'error');
      return;
    }

    const permission = await ensurePermission(state.draft.baseUrl);
    if (!permission.ok) {
      UI.toast(permission.message, 'error');
      return;
    }

    // Buang penanda preset sebelum menyimpan.
    const provider = P.normalize(state.draft);
    await store.upsertProvider(provider);

    UI.toast('Penyedia tersimpan.', 'success');
    await refresh();
    edit(provider.id);
  }

  async function makeActive(id) {
    await store.setActiveProvider(id);
    UI.toast('Penyedia aktif diganti.', 'success');
    await refresh();
    edit(id);
  }

  async function remove(id) {
    const provider = state.providers.find((entry) => entry.id === id);
    const ok = await UI.confirm({
      title: 'Hapus penyedia?',
      message: `Hapus "${provider?.name ?? 'penyedia ini'}" beserta kuncinya?`,
      tone: 'danger',
      confirmLabel: 'Hapus'
    });
    if (!ok) return;

    await store.removeProvider(id);
    state.draft = null;
    state.editingId = null;
    UI.toast('Penyedia dihapus.', 'success');
    await refresh();
    renderEditor();
  }

  /* --------------------------------------------------------- muat */

  async function refresh() {
    state.providers = await store.providers();
    state.activeId = (await store.activeProvider())?.id ?? null;
    renderList();
  }

  /* --------------------------------------------------------- pilih preset */

  /**
   * Dialog pemilihan preset. Memakai jalur resolve kustom karena item
   * preset menutup dialog dengan membawa nilai, bukan lewat tombol aksi.
   */
  function pickPreset() {
    return new Promise((resolve) => {
      const overlay = UI.scope(
        el('div', { class: 'xmt-modal' }, [
          el('div', { class: 'xmt-modal-inner', style: { width: '480px' } }, [
            el('div', { class: 'xmt-panel-head' }, [
              el('div', { class: 'xmt-panel-head-row' }, [
                el('div', { class: 'xmt-panel-title' }, [icon('sparkle'), el('span', { text: 'Tambah penyedia' })]),
                el('button', {
                  type: 'button',
                  class: 'xmt-icon-btn',
                  'aria-label': 'Tutup',
                  on: { click: () => finish(null) }
                }, [icon('close')])
              ])
            ]),
            el('div', { class: 'xmt-modal-body' }, [
              el('p', { class: 'xmt-hint', style: { marginTop: 0 }, text: 'Pilih layanan siap pakai, atau Endpoint kustom untuk mengatur sendiri.' }),
              el(
                'div',
                { class: 'xmt-stack', style: { marginTop: '12px' } },
                PRESETS.map((preset) =>
                  el(
                    'button',
                    {
                      type: 'button',
                      class: 'xmt-item',
                      on: { click: () => finish(preset) }
                    },
                    [
                      el('div', { class: 'xmt-item-icon' }, [icon(preset.custom ? 'settings' : 'sparkle')]),
                      el('div', { class: 'xmt-item-body' }, [
                        el('span', { class: 'xmt-item-title', text: preset.name }),
                        el('div', { class: 'xmt-item-meta' }, [el('span', { text: preset.note ?? '' })])
                      ]),
                      el('span', { class: 'xmt-item-trail' }, [icon('chevron')])
                    ]
                  )
                )
              )
            ])
          ])
        ])
      );

      const onKey = (event) => {
        if (event.key === 'Escape') finish(null);
      };

      function finish(value) {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(value);
      }

      overlay.addEventListener('pointerdown', (event) => {
        if (event.target === overlay) finish(null);
      });
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(overlay);
    });
  }

  /* --------------------------------------------------------- init */

  async function init() {
    document.getElementById('opt-foot').textContent = `${NAME} v${VERSION}`;
    UI.syncTheme();
    onMutate(UI.syncTheme);

    renderIntro();
    await refresh();
    renderEditor();

    document.getElementById('opt-add').addEventListener('click', async () => {
      const preset = await pickPreset();
      if (preset) addFromPreset(preset);
    });

    // Tanpa penyedia sama sekali, langsung tawarkan penambahan.
    if (state.providers.length === 0) {
      const preset = await pickPreset();
      if (preset) addFromPreset(preset);
    }
  }

  // pickPreset menangani penambahan penyedia; tidak ada dialog lain.

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  void KEYS;
  void PROVIDER_KIND;
  void timeAgo;
})();
