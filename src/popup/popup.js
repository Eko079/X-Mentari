/**
 * X Mentari — popup ekstensi
 *
 * Membaca dan menulis pengaturan yang sama dengan content script, karena
 * keduanya memakai chrome.storage.local lewat XMTStore. Tombol aksi
 * memanggil fungsi yang diekspos content script pada tab aktif.
 */
(() => {
  const { KEYS, FEATURE_META, MSG, HOSTS, NAME, VERSION } = globalThis.XMT_CONST;
  const { timeAgo } = globalThis.XMTUtil;
  const store = globalThis.XMTStore;

  /* ------------------------------------------------- pembangun elemen */

  /** Versi ringkas dari pembangun elemen; popup tidak memuat XMTDom. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;

      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'dataset') {
        // Nilai kosong dilewati agar tidak menghasilkan atribut "undefined".
        for (const [name, entry] of Object.entries(value)) {
          if (entry == null || entry === false) continue;
          node.dataset[name] = String(entry);
        }
      } else if (key === 'on') {
        for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
      } else if (key in node && typeof value !== 'object' && !key.startsWith('aria')) {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }

    for (const child of Array.isArray(children) ? children : [children]) {
      if (child == null || child === false || child === '') continue;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }

    return node;
  }

  function replace(parent, children) {
    parent.replaceChildren();
    for (const child of Array.isArray(children) ? children : [children]) {
      if (child == null || child === false || child === '') continue;
      parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return parent;
  }

  function card({ title, children }) {
    return el('div', { class: 'xmt-card' }, [
      title && el('div', { class: 'xmt-card-head' }, [el('div', { class: 'xmt-card-title', text: title })]),
      ...(Array.isArray(children) ? children : [children])
    ]);
  }

  function row(label, value) {
    return el('div', { class: 'xmt-row' }, [
      el('span', { class: 'xmt-row-label', text: label }),
      value instanceof Node ? value : el('span', { class: 'xmt-row-value', text: String(value ?? '-') })
    ]);
  }

  function badge(text, tone) {
    return el('span', { class: 'xmt-badge', dataset: { tone }, text });
  }

  function notice({ tone = 'info', title, text }) {
    return el('div', { class: 'xmt-notice', dataset: { tone } }, [
      el('div', {}, [title && el('strong', { text: `${title} ` }), text && el('span', { text })])
    ]);
  }

  /* ---------------------------------------------------------- tab aktif */

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  }

  function tabPortal(tab) {
    try {
      const { hostname } = new URL(tab?.url ?? '');
      if (hostname === HOSTS.MENTARI) return 'mentari';
      if (hostname === HOSTS.MYUNPAM) return 'myunpam';
    } catch {
      // URL internal peramban tidak bisa diurai; anggap bukan portal kampus.
    }
    return null;
  }

  /**
   * Meminta content script membuka salah satu panelnya.
   *
   * Panel dibangun oleh content script yang berjalan di isolated world,
   * jadi popup tidak bisa memanggil fungsinya lewat penyuntikan skrip.
   * Pesan runtime yang dialamatkan ke tab adalah jalur yang tepat.
   */
  async function openPanelInTab(panelName) {
    const tab = await activeTab();
    if (!tab?.id) return false;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: MSG.OPEN_PANEL,
        panel: panelName
      });

      if (response?.ok) {
        window.close();
        return true;
      }

      showBanner(response?.error ?? 'Panel tidak tersedia di halaman ini.');
      return false;
    } catch {
      // Content script belum termuat, biasanya karena halaman perlu disegarkan
      // setelah ekstensi dipasang atau diperbarui.
      showBanner('Muat ulang halaman kampus lebih dulu, lalu coba lagi.');
      return false;
    }
  }

  let bannerTimer = null;

  function showBanner(text) {
    const foot = document.getElementById('pop-foot');
    if (!foot) return;

    foot.textContent = text;
    foot.style.color = 'var(--xmt-danger)';

    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      foot.textContent = `${NAME} v${VERSION}`;
      foot.style.color = '';
    }, 3600);
  }

  /* ---------------------------------------------------------- tab status */

  async function renderStatus(region) {
    const [providers, active, quota, courses, cachedAt, notifs, tab, todos] = await Promise.all([
      store.providers(),
      store.activeProvider(),
      store.get(KEYS.QUOTA),
      store.get(KEYS.COURSE_CACHE),
      store.get(KEYS.COURSE_CACHE_AT),
      store.get(KEYS.NOTIF_CACHE),
      activeTab(),
      store.get(KEYS.TODO_LIST)
    ]);

    const portal = tabPortal(tab);
    const courseCount = Array.isArray(courses) ? courses.length : 0;
    const ready = active && (Boolean(active.apiKey) || Boolean(active.keyOptional));

    // Hitung forum tertunggak dari cache, memakai aturan yang sama dengan
    // content script: forum yang post test-nya belum tuntas belum terbuka.
    let pending = 0;
    for (const course of Array.isArray(courses) ? courses : []) {
      for (const section of course?.data ?? []) {
        for (const item of section?.sub_section ?? []) {
          if (item?.kode_template !== 'FORUM_DISKUSI') continue;
          if (!item.id || item.completion === true) continue;
          if (String(item.warningAlert ?? '').toLowerCase().includes('sudah')) continue;

          const postTest = (section?.sub_section ?? []).find(
            (entry) => entry?.kode_template === 'POST_TEST'
          );
          if (postTest?.id && postTest.completion !== true) continue;

          pending += 1;
        }
      }
    }

    /* ---- kartu penyedia ---- */
    let providerCard;

    if (providers.length === 0) {
      providerCard = card({
        title: 'Penyedia AI',
        children: [
          notice({
            tone: 'warning',
            title: 'Belum ada penyedia AI.',
            text: 'Fitur AI belum bisa dipakai.'
          }),
          el('div', { style: { marginTop: '10px' } }, [
            el('button', {
              type: 'button',
              class: 'xmt-btn',
              dataset: { variant: 'primary', size: 'block' },
              text: 'Atur penyedia AI',
              on: { click: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }).then(() => window.close()) }
            })
          ])
        ]
      });
    } else {
      const providerSelect = el(
        'select',
        {
          class: 'xmt-select',
          'aria-label': 'Penyedia aktif',
          on: {
            change: async (event) => {
              await store.setActiveProvider(event.target.value);
              renderStatus(region);
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

      providerCard = card({
        title: 'Penyedia AI',
        children: [
          row('Aktif', ready ? badge(active.name, 'success') : badge('Belum siap', 'danger')),
          el('div', { class: 'xmt-field' }, [
            el('label', { class: 'xmt-label', text: 'Penyedia' }),
            providerSelect
          ]),
          (active?.models?.length ?? 0) > 0 &&
            el('div', { class: 'xmt-field' }, [
              el('label', { class: 'xmt-label', text: 'Model' }),
              el(
                'select',
                {
                  class: 'xmt-select',
                  'aria-label': 'Model',
                  on: {
                    change: async (event) => {
                      await store.upsertProvider({ ...active, model: event.target.value });
                    }
                  }
                },
                active.models.map((model) =>
                  el('option', { value: model, text: model, selected: model === active.model })
                )
              )
            ]),
          el('div', { style: { marginTop: '10px' } }, [
            el('button', {
              type: 'button',
              class: 'xmt-btn',
              dataset: { size: 'block' },
              text: 'Kelola penyedia',
              on: { click: () => chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }).then(() => window.close()) }
            })
          ])
        ]
      });
    }

    replace(region, [
      providerCard,

      quota &&
        card({
          title: 'Kuota terakhir',
          children: [
            quota.requestsRemaining != null &&
              row(
                'Sisa permintaan',
                quota.requestsLimit
                  ? `${quota.requestsRemaining} / ${quota.requestsLimit}`
                  : String(quota.requestsRemaining)
              ),
            quota.updatedAt && row('Diperbarui', timeAgo(quota.updatedAt))
          ]
        }),

      card({
        title: 'Data akademik',
        children: [
          row('Mata kuliah tersimpan', courseCount || '-'),
          row(
            'Forum belum dikerjakan',
            pending > 0 ? badge(`${pending} forum`, 'brand') : badge('Tidak ada', 'success')
          ),
          row('Balasan dosen terkumpul', Array.isArray(notifs) ? notifs.length : 0),
          row('Todo list', Array.isArray(todos) ? `${todos.filter((t) => !t.done).length} belum / ${todos.length} total` : '-'),
          row('Terakhir dimuat', cachedAt ? timeAgo(cachedAt) : 'Belum pernah')
        ]
      }),

      card({
        title: 'Buka panel',
        children: [
          portal === null
            ? notice({
                tone: 'info',
                text: 'Buka MENTARI atau MY UNPAM untuk memakai panel ekstensi.'
              })
            : el('div', { class: 'xmt-stack' }, [
                portal === 'mentari' &&
                  el('button', {
                    type: 'button',
                    class: 'xmt-btn',
                    dataset: { variant: 'primary', size: 'block' },
                    text: 'Forum Tracker',
                    on: { click: () => openPanelInTab('forum') }
                  }),
                portal === 'mentari' &&
                  el('button', {
                    type: 'button',
                    class: 'xmt-btn',
                    dataset: { size: 'block' },
                    text: 'Asisten AI',
                    on: { click: () => openPanelInTab('assistant') }
                  }),
                portal === 'mentari' &&
                  el('button', {
                    type: 'button',
                    class: 'xmt-btn',
                    dataset: { size: 'block' },
                    text: 'Pengaturan di halaman',
                    on: { click: () => openPanelInTab('settings') }
                  }),
                portal === 'mentari' &&
                  el('button', {
                    type: 'button',
                    class: 'xmt-btn',
                    dataset: { size: 'block' },
                    text: 'Panduan',
                    on: { click: () => openPanelInTab('guide') }
                  }),
                portal === 'myunpam' &&
                  el('button', {
                    type: 'button',
                    class: 'xmt-btn',
                    dataset: { variant: 'primary', size: 'block' },
                    text: 'Rekap Presensi',
                    on: { click: () => openPanelInTab('presensi') }
                  })
              ])
        ]
      })
    ]);
  }

  /* ----------------------------------------------------------- tab fitur */

  async function renderFeatures(region) {
    const features = await store.features();

    const switches = Object.entries(FEATURE_META).map(([name, meta]) =>
      el('label', { class: 'xmt-switch', style: { padding: '9px 0' } }, [
        el('div', { class: 'xmt-switch-text' }, [
          el('span', {}, [
            meta.label,
            meta.sensitive && el('span', { text: ' ' }),
            meta.sensitive && badge('Perlu izin', 'warning')
          ]),
          el('span', { class: 'xmt-switch-desc', text: meta.desc })
        ]),
        el('input', {
          type: 'checkbox',
          checked: Boolean(features[name]),
          'aria-label': meta.label,
          on: {
            change: async (event) => {
              await store.setFeature(name, event.target.checked);
            }
          }
        })
      ])
    );

    replace(region, [
      notice({ tone: 'info', text: 'Perubahan berlaku setelah halaman kampus dimuat ulang.' }),
      card({ children: switches })
    ]);
  }

  /* --------------------------------------------------------- tab tentang */

  function renderAbout(region) {
    replace(region, [
      card({
        title: NAME,
        children: [
          row('Versi', VERSION),
          row('Portal', 'MENTARI, MY UNPAM'),
          el('p', {
            class: 'xmt-hint',
            style: { marginTop: '10px' },
            text: 'Ekstensi berjalan sepenuhnya di perangkat Anda. Data akademik diminta langsung dari server kampus memakai sesi login Anda sendiri.'
          })
        ]
      }),

      card({
        title: 'Batasan yang disengaja',
        children: [
          el('ul', { class: 'xmt-hint', style: { margin: 0, paddingLeft: '18px', lineHeight: '1.7' } }, [
            el('li', { text: 'Tidak ada fitur yang menekan submit atau menyelesaikan ujian.' }),
            el('li', { text: 'Saran AI selalu ditampilkan lebih dulu untuk Anda tinjau.' }),
            el('li', { text: 'Fitur yang menyentuh formulir penilaian mati secara bawaan.' })
          ])
        ]
      }),

      notice({
        tone: 'warning',
        title: 'Tanggung jawab pengguna.',
        text: 'Periksa aturan akademik kampus sebelum memakai bantuan AI untuk tugas bernilai.'
      })
    ]);
  }

  /* ---------------------------------------------------------------- tab */

  const RENDERERS = {
    status: renderStatus,
    features: renderFeatures,
    about: renderAbout
  };

  const rendered = new Set();

  function showTab(name) {
    for (const button of document.querySelectorAll('.xmt-tab')) {
      button.setAttribute('aria-selected', button.dataset.tab === name ? 'true' : 'false');
    }

    for (const [key, region] of Object.entries({
      status: document.getElementById('panel-status'),
      features: document.getElementById('panel-features'),
      about: document.getElementById('panel-about')
    })) {
      region.hidden = key !== name;
    }

    const region = document.getElementById(`panel-${name}`);
    if (!rendered.has(name)) {
      rendered.add(name);
      RENDERERS[name](region);
    } else if (name === 'status') {
      // Status memuat data yang bisa berubah; segarkan setiap kali dibuka.
      RENDERERS.status(region);
    }
  }

  /* -------------------------------------------------------------- mulai */

  async function init() {
    document.getElementById('pop-version').textContent = `v${VERSION} — MENTARI & MY UNPAM`;
    document.getElementById('pop-foot').textContent = `${NAME} v${VERSION}`;

    for (const button of document.querySelectorAll('.xmt-tab')) {
      button.addEventListener('click', () => showTab(button.dataset.tab));
    }

    showTab('status');

    // Bangunkan service worker agar permintaan AI pertama tidak tertunda.
    chrome.runtime.sendMessage({ type: MSG.PING }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
