/**
 * X Mentari — panel pengaturan di halaman
 *
 * Ringkasan cepat penyedia AI dan preferensi. Manajemen penyedia yang
 * lengkap (menambah endpoint, kunci, header) ada di halaman opsi; panel ini
 * cukup untuk memilih penyedia aktif dan mengecek status.
 *
 * Semua data lewat chrome.storage.local (XMTStore), bukan localStorage,
 * agar popup, halaman opsi, dan content script membaca sumber yang sama.
 */
(() => {
  if (window.__XMT_SETTINGS__) return;
  window.__XMT_SETTINGS__ = true;

  const { KEYS, KIND_META, FEATURE_META, NAME, VERSION } = globalThis.XMT_CONST;
  const { el, replace } = globalThis.XMTDom;
  const { timeAgo } = globalThis.XMTUtil;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;
  const ai = globalThis.XMTAI;

  /* ------------------------------------------------------------- render */

  async function renderGeneral(region) {
    const [providers, active, quota, theme] = await Promise.all([
      store.providers(),
      store.activeProvider(),
      store.get(KEYS.QUOTA),
      store.get(KEYS.THEME)
    ]);

    const openOptions = () => ai.openOptions();

    /* ---- kartu penyedia ---- */
    let providerCard;

    if (providers.length === 0) {
      providerCard = UI.parts.card({
        title: 'Penyedia AI',
        children: [
          UI.parts.notice({
            tone: 'warning',
            text: 'Belum ada penyedia AI. Fitur AI belum bisa dipakai.'
          }),
          el('div', { style: { marginTop: '12px' } }, [
            el('button', {
              type: 'button',
              class: 'xmt-btn',
              dataset: { variant: 'primary' },
              text: 'Atur penyedia AI',
              on: { click: openOptions }
            })
          ])
        ]
      });
    } else {
      const select = el(
        'select',
        {
          class: 'xmt-select',
          'aria-label': 'Penyedia aktif',
          on: {
            change: async (event) => {
              await store.setActiveProvider(event.target.value);
              UI.toast('Penyedia aktif diganti.', 'success');
              renderGeneral(region);
            }
          }
        },
        providers.map((provider) =>
          el('option', {
            value: provider.id,
            text: `${provider.name} · ${provider.model || 'model?'}`,
            selected: provider.id === active?.id
          })
        )
      );

      // Daftar model penyedia aktif, bila ada, agar bisa diganti cepat.
      const modelField =
        active && (active.models?.length ?? 0) > 0
          ? el('div', { class: 'xmt-field' }, [
              el('label', { class: 'xmt-label', text: 'Model' }),
              el(
                'select',
                {
                  class: 'xmt-select',
                  'aria-label': 'Model',
                  on: {
                    change: async (event) => {
                      const updated = { ...active, model: event.target.value };
                      await store.upsertProvider(updated);
                      UI.toast(`Model diganti ke ${event.target.value}.`, 'success');
                    }
                  }
                },
                active.models.map((model) =>
                  el('option', { value: model, text: model, selected: model === active.model })
                )
              )
            ])
          : null;

      providerCard = UI.parts.card({
        title: 'Penyedia AI',
        children: [
          UI.parts.row(
            'Aktif',
            active ? UI.parts.badge(KIND_META[active.kind]?.label ?? active.kind, 'brand') : '-'
          ),
          el('div', { class: 'xmt-field' }, [
            el('label', { class: 'xmt-label', text: 'Penyedia' }),
            select
          ]),
          modelField,
          el('div', { class: 'xmt-cluster', style: { marginTop: '12px' } }, [
            el('button', {
              type: 'button',
              class: 'xmt-btn',
              dataset: { variant: 'primary' },
              text: 'Kelola penyedia',
              on: { click: openOptions }
            }),
            UI.parts.asyncButton({
              label: 'Uji koneksi',
              iconName: 'refresh',
              busyLabel: 'Menguji…',
              onClick: async () => {
                if (!active) return;
                const result = await ai.testProvider(active);
                UI.toast(result.message, result.ok ? 'success' : 'error');
              }
            })
          ])
        ]
      });
    }

    /* ---- kartu kuota ---- */
    const quotaRows = [];
    if (quota) {
      if (quota.requestsRemaining != null) {
        quotaRows.push(
          UI.parts.row(
            'Sisa permintaan',
            quota.requestsLimit
              ? `${quota.requestsRemaining} / ${quota.requestsLimit}`
              : String(quota.requestsRemaining)
          )
        );
      }
      if (quota.tokensRemaining != null) {
        quotaRows.push(
          UI.parts.row(
            'Sisa token',
            quota.tokensLimit
              ? `${quota.tokensRemaining} / ${quota.tokensLimit}`
              : String(quota.tokensRemaining)
          )
        );
      }
      quotaRows.push(UI.parts.row('Diperbarui', timeAgo(quota.updatedAt)));
    }

    /* ---- tema ---- */
    const themeSelect = el(
      'select',
      {
        class: 'xmt-select',
        'aria-label': 'Tema antarmuka',
        on: {
          change: async (event) => {
            await store.set(KEYS.THEME, event.target.value);
            UI.syncTheme();
          }
        }
      },
      [
        { id: 'auto', label: 'Ikuti MENTARI' },
        { id: 'dark', label: 'Selalu gelap' },
        { id: 'light', label: 'Selalu terang' }
      ].map((entry) =>
        el('option', { value: entry.id, text: entry.label, selected: entry.id === (theme || 'auto') })
      )
    );

    replace(region, [
      providerCard,
      quotaRows.length > 0 && UI.parts.card({ title: 'Kuota terakhir dilaporkan', children: quotaRows }),
      UI.parts.card({
        title: 'Tampilan',
        children: [
          el('div', { class: 'xmt-field' }, [
            el('label', { class: 'xmt-label', text: 'Tema panel' }),
            themeSelect
          ])
        ]
      }),
      UI.parts.card({
        title: 'Data tersimpan',
        children: [
          el('p', {
            class: 'xmt-hint',
            text: 'Cache mata kuliah dan riwayat percakapan disimpan di perangkat Anda saja.'
          }),
          el('div', { class: 'xmt-cluster', style: { marginTop: '12px' } }, [
            UI.parts.asyncButton({
              label: 'Hapus cache',
              iconName: 'refresh',
              onClick: async () => {
                await store.reset([KEYS.COURSE_CACHE, KEYS.COURSE_CACHE_AT, KEYS.NOTIF_CACHE]);
                UI.toast('Cache dihapus.', 'success');
              }
            }),
            UI.parts.asyncButton({
              label: 'Hapus riwayat chat',
              iconName: 'trash',
              variant: 'danger',
              onClick: async () => {
                const ok = await UI.confirm({
                  title: 'Hapus riwayat percakapan?',
                  message: 'Seluruh riwayat percakapan dengan asisten AI akan dihapus.',
                  tone: 'danger',
                  confirmLabel: 'Hapus'
                });
                if (!ok) return;
                await store.reset(KEYS.CHAT_HISTORY);
                UI.toast('Riwayat percakapan dihapus.', 'success');
              }
            })
          ])
        ]
      })
    ]);
  }

  async function renderFeatures(region) {
    const features = await store.features();

    const rows = Object.entries(FEATURE_META).map(([name, meta]) => {
      const checkbox = el('input', {
        type: 'checkbox',
        checked: Boolean(features[name]),
        'aria-label': meta.label,
        on: {
          change: async (event) => {
            const enabled = event.target.checked;

            if (enabled && meta.sensitive) {
              const ok = await UI.confirm({
                title: `Aktifkan ${meta.label}?`,
                message: meta.desc,
                detail:
                  'Fitur ini menyiapkan masukan di halaman, tetapi tidak pernah mengirim atau menyelesaikan apa pun tanpa Anda menekan tombol kirim sendiri. Pastikan penggunaannya sesuai aturan akademik yang berlaku.',
                tone: 'warning',
                confirmLabel: 'Saya paham, aktifkan'
              });

              if (!ok) {
                event.target.checked = false;
                return;
              }
            }

            await store.setFeature(name, enabled);
            UI.toast(
              `${meta.label} ${enabled ? 'diaktifkan' : 'dimatikan'}. Muat ulang halaman untuk menerapkan.`,
              'success'
            );
          }
        }
      });

      return el('label', { class: 'xmt-switch', style: { padding: '9px 0' } }, [
        el('div', { class: 'xmt-switch-text' }, [
          el('span', {}, [
            meta.label,
            meta.sensitive && el('span', { text: ' ' }),
            meta.sensitive && UI.parts.badge('Perlu izin', 'warning')
          ]),
          el('span', { class: 'xmt-switch-desc', text: meta.desc })
        ]),
        checkbox
      ]);
    });

    replace(region, [
      UI.parts.notice({ tone: 'info', text: 'Perubahan berlaku setelah halaman dimuat ulang.' }),
      UI.parts.card({ children: rows })
    ]);
  }

  function renderAbout(region) {
    replace(region, [
      UI.parts.card({
        title: NAME,
        children: [
          UI.parts.row('Versi', VERSION),
          UI.parts.row('Portal', 'MENTARI dan MY UNPAM'),
          el('p', {
            class: 'xmt-hint',
            style: { marginTop: '12px' },
            text: 'Ekstensi ini berjalan sepenuhnya di perangkat Anda. Data akademik hanya diminta dari server kampus memakai sesi login Anda sendiri, dan dikirim ke penyedia AI yang Anda pilih hanya saat Anda memakai fitur AI.'
          })
        ]
      }),
      UI.parts.card({
        title: 'Batasan yang disengaja',
        children: [
          el('ul', { class: 'xmt-hint', style: { paddingLeft: '18px', lineHeight: '1.7' } }, [
            el('li', { text: 'Tidak ada fitur yang mengirim jawaban, menekan submit, atau menyelesaikan ujian otomatis.' }),
            el('li', { text: 'Saran AI selalu ditampilkan untuk ditinjau lebih dulu, lengkap dengan tingkat keyakinannya.' }),
            el('li', { text: 'Fitur yang menyentuh formulir penilaian harus diaktifkan sendiri dan meminta konfirmasi.' })
          ])
        ]
      }),
      UI.parts.notice({
        tone: 'warning',
        title: 'Tanggung jawab pengguna.',
        text: 'Anda yang bertanggung jawab atas isi yang Anda kirimkan. Periksa aturan akademik kampus sebelum memakai bantuan AI untuk tugas bernilai.'
      })
    ]);
  }

  /* -------------------------------------------------------------- pasang */

  function init() {
    const panel = UI.panel({
      id: 'xmt-settings-panel',
      title: 'Pengaturan',
      subtitle: NAME,
      iconName: 'settings',
      anchor: 'header',
      size: 'sm',
      tabs: [
        { id: 'general', label: 'Umum', render: renderGeneral },
        { id: 'features', label: 'Fitur', render: renderFeatures },
        { id: 'about', label: 'Tentang', render: renderAbout }
      ]
    });

    const button = UI.headerButton({
      id: 'xmt-settings-btn',
      title: `${NAME} — Pengaturan`,
      iconName: 'settings',
      onClick: () => {
        if (panel.isOpen) {
          panel.close();
          return;
        }
        panel.refreshTab('general');
        panel.open('general');
      }
    });

    // Penanda pada tombol bila belum ada penyedia AI yang siap.
    const updateBadge = async () => {
      const ready = await store.hasProvider();
      button.setBadge(ready ? 0 : 1);
    };

    updateBadge();
    store.watch(KEYS.PROVIDERS, updateBadge);
    store.watch(KEYS.ACTIVE_PROVIDER, updateBadge);

    UI.registerOpener('settings', () => panel.open('general'));

    window.XMTSettings = {
      open: (tab) => panel.open(tab),
      openProviders: () => ai.openOptions()
    };
  }

  init();
})();
