/**
 * X Mentari — kerangka UI untuk content script
 *
 * Menyediakan komponen yang dipakai bersama seluruh fitur: toast, rak
 * tombol apung, panel, tab, dan dialog. Semuanya dibangun lewat XMTDom.el
 * sehingga tidak ada jalur innerHTML untuk data.
 *
 * Semua elemen memakai kelas .xmt-scope agar variabel tema hanya berlaku
 * di dalam antarmuka ekstensi dan tidak pernah mengubah tampilan MENTARI.
 */
(() => {
  if (globalThis.XMTUI) return;

  const { NAME, VERSION } = globalThis.XMT_CONST;
  const { el, replace, icon, onMutate, dismissOn } = globalThis.XMTDom;
  const { debounce } = globalThis.XMTUtil;
  const store = globalThis.XMTStore;

  /* ------------------------------------------------------------- tema */

  /**
   * MENTARI memakai MUI dan tidak menandai temanya dengan atribut yang
   * stabil. Menilai kecerahan latar body adalah pendekatan yang tetap
   * bekerja meski nama kelas MUI berubah antar rilis.
   */
  function detectTheme() {
    const probe = document.querySelector('.MuiPaper-root') ?? document.body;
    const background = getComputedStyle(probe).backgroundColor;
    const match = /rgba?\(([^)]+)\)/.exec(background);

    if (!match) return 'dark';

    const [r, g, b, a = '1'] = match[1].split(',').map((value) => Number.parseFloat(value));
    // Latar transparan berarti kita tidak sedang melihat permukaan asli.
    if (Number.parseFloat(a) < 0.3) return 'dark';

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? 'light' : 'dark';
  }

  let currentTheme = 'dark';
  const scopes = new Set();

  function applyTheme(theme) {
    currentTheme = theme;
    for (const node of scopes) {
      if (!node.isConnected) {
        scopes.delete(node);
        continue;
      }
      node.classList.toggle('xmt-theme-light', theme === 'light');
    }
  }

  /** Mendaftarkan elemen agar mengikuti tema, dan memberinya kelas scope. */
  function scope(node) {
    node.classList.add('xmt-scope');
    node.classList.toggle('xmt-theme-light', currentTheme === 'light');
    scopes.add(node);
    return node;
  }

  const syncTheme = debounce(async () => {
    const preference = await store.get(globalThis.XMT_CONST.KEYS.THEME);
    const theme = preference === 'auto' || !preference ? detectTheme() : preference;
    if (theme !== currentTheme) applyTheme(theme);
  }, 200);

  /* ------------------------------------------------------------ toast */

  let toastRack = null;

  function ensureToastRack() {
    if (toastRack?.isConnected) return toastRack;
    toastRack = scope(el('div', { class: 'xmt-toast-rack', role: 'status', 'aria-live': 'polite' }));
    document.body.appendChild(toastRack);
    return toastRack;
  }

  /**
   * Menampilkan pesan singkat.
   * @param {string} message
   * @param {'info'|'success'|'error'|'warning'} tone
   */
  function toast(message, tone = 'info', { duration = 2800 } = {}) {
    const rack = ensureToastRack();
    const node = el('div', { class: 'xmt-toast', dataset: { tone }, text: message });
    rack.appendChild(node);

    setTimeout(() => {
      node.dataset.leaving = 'true';
      setTimeout(() => node.remove(), 220);
    }, duration);

    return node;
  }

  /* --------------------------------------------- tombol toolbar MENTARI */

  /**
   * Urutan tombol X Mentari di toolbar MENTARI.
   *
   * Setiap tombol memakai tombol berikutnya dalam daftar sebagai jangkar,
   * dan tombol tema MENTARI sebagai jangkar terakhir. Rantai ini membuat
   * posisi tombol tetap sama dan tidak saling memperebutkan slot yang
   * sama seperti bila semuanya menarget tombol tema secara langsung.
   */
  const TOOLBAR_ORDER = ['xmt-forum-btn', 'xmt-ai-btn', 'xmt-guide-btn', 'xmt-settings-btn'];

  /**
   * Memasang tombol ikon di toolbar MENTARI dan menjaganya tetap ada.
   *
   * MENTARI adalah SPA yang mengganti isi toolbar saat berpindah halaman,
   * jadi pemasangan harus diperiksa ulang setiap kali DOM berubah.
   *
   * @returns {{ button: HTMLElement, setBadge: (n: number) => void, destroy: () => void }}
   */
  function headerButton({ id, title, iconName, onClick }) {
    let button = null;
    let badge = 0;

    const build = () => {
      button = el('button', {
        id,
        type: 'button',
        class: 'xmt-scope xmt-header-btn',
        title,
        'aria-label': title,
        dataset: { badge: String(badge) },
        on: {
          click: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          }
        }
      });
      button.appendChild(icon(iconName));
      scope(button);
      return button;
    };

    // Jangkar: tombol X Mentari yang berada setelahnya, lalu tombol tema.
    const position = TOOLBAR_ORDER.indexOf(id);
    const laterButtons = position === -1 ? [] : TOOLBAR_ORDER.slice(position + 1);

    const stop = onMutate(() => {
      const existing = document.getElementById(id);
      if (existing?.isConnected) {
        button = existing;
        return;
      }

      for (const laterId of laterButtons) {
        const anchor = document.getElementById(laterId);
        if (anchor?.parentNode) {
          anchor.parentNode.insertBefore(build(), anchor);
          return;
        }
      }

      const themeButton = globalThis.XMTDom.findThemeButton();
      if (themeButton?.parentNode) {
        themeButton.parentNode.insertBefore(build(), themeButton);
        return;
      }

      // Toolbar belum tersedia: jangan pasang apa pun. Pemantau DOM akan
      // mencoba lagi begitu MENTARI selesai merender kerangkanya.
    });

    return {
      get button() {
        return button;
      },
      setBadge(count) {
        badge = Number(count) || 0;
        const node = document.getElementById(id);
        if (node) node.dataset.badge = String(badge);
      },
      destroy() {
        stop();
        document.getElementById(id)?.remove();
      }
    };
  }

  /* ------------------------------------------------- rak tombol apung */

  const racks = new Map();

  /**
   * Rak tombol apung bersama.
   *
   * Semua FAB masuk ke rak yang sama dan ditata dengan flexbox, sehingga
   * tombol dari fitur berbeda tidak pernah saling menumpuk seperti bila
   * masing-masing memakai posisi tetap sendiri.
   */
  function fabRack(side = 'right') {
    const existing = racks.get(side);
    if (existing?.isConnected) return existing;

    const rack = scope(el('div', { class: 'xmt-fab-rack', dataset: { side } }));
    document.body.appendChild(rack);
    racks.set(side, rack);
    return rack;
  }

  /**
   * Membuat tombol apung dan menjaganya tetap terpasang.
   *
   * @returns {{ button: HTMLElement, destroy: () => void }}
   */
  function fab({ id, title, iconName, label, side = 'right', variant, order = 0, onClick }) {
    const button = el('button', {
      id,
      type: 'button',
      class: 'xmt-fab',
      title,
      'aria-label': title,
      dataset: { variant, order: String(order) },
      on: { click: onClick }
    });

    if (label) button.appendChild(el('span', { class: 'xmt-fab-label', text: label }));
    else button.appendChild(icon(iconName ?? 'sparkle'));

    // Rak bisa dibuang saat MENTARI mengganti isi body; pasang ulang bila hilang.
    const stop = onMutate(() => {
      const rack = fabRack(side);
      if (button.parentElement === rack) return;

      rack.appendChild(button);

      // Urutkan agar posisi tombol tidak berubah-ubah antar navigasi.
      const sorted = Array.from(rack.children).sort(
        (a, b) => Number(a.dataset.order ?? 0) - Number(b.dataset.order ?? 0)
      );
      for (const child of sorted) rack.appendChild(child);
    });

    return {
      button,
      destroy() {
        stop();
        button.remove();
      }
    };
  }

  /* ------------------------------------------------------------ panel */

  const openPanels = new Set();

  /**
   * Panel yang bisa dibuka-tutup.
   *
   * @param {object} options
   * @param {string} options.id
   * @param {string} options.title
   * @param {string} [options.subtitle]
   * @param {string} [options.iconName]
   * @param {'header'|'fab-right'|'fab-left'} [options.anchor]
   * @param {'sm'|'md'|'lg'} [options.size]
   * @param {Array}  [options.tabs]        [{ id, label, render }]
   * @param {Array}  [options.headActions] Elemen tambahan di kepala panel.
   * @param {Array}  [options.footActions] Elemen tambahan di kaki panel.
   * @param {Function} [options.onOpen]
   */
  function panel({
    id,
    title,
    subtitle,
    iconName = 'sparkle',
    anchor = 'header',
    size = 'md',
    tabs = [],
    headActions = [],
    footActions = [],
    onOpen
  }) {
    const body = el('div', { class: 'xmt-panel-body' });

    const closeButton = el('button', {
      type: 'button',
      class: 'xmt-icon-btn',
      title: 'Tutup',
      'aria-label': 'Tutup panel',
      on: { click: () => api.close() }
    });
    closeButton.appendChild(icon('close'));

    const head = el('div', { class: 'xmt-panel-head' }, [
      el('div', { class: 'xmt-panel-head-row' }, [
        el('div', { class: 'xmt-panel-title' }, [
          icon(iconName),
          el('span', {}, [
            title,
            subtitle && el('span', { class: 'xmt-panel-subtitle', text: ` ${subtitle}` })
          ])
        ]),
        el('div', { class: 'xmt-panel-actions' }, [...headActions, closeButton])
      ])
    ]);

    const root = scope(
      el(
        'div',
        {
          id,
          class: 'xmt-panel',
          dataset: { anchor, size },
          role: 'dialog',
          'aria-modal': 'false',
          'aria-label': title
        },
        [head]
      )
    );

    /* Tab, bila ada lebih dari satu */
    const panelsById = new Map();
    let activeTabId = tabs[0]?.id ?? null;

    if (tabs.length > 1) {
      const tabList = el('div', { class: 'xmt-tabs', role: 'tablist' });

      for (const tab of tabs) {
        const button = el('button', {
          type: 'button',
          class: 'xmt-tab',
          role: 'tab',
          id: `${id}-tab-${tab.id}`,
          'aria-controls': `${id}-panel-${tab.id}`,
          'aria-selected': tab.id === activeTabId ? 'true' : 'false',
          text: tab.label,
          dataset: { tab: tab.id },
          on: { click: () => api.showTab(tab.id) }
        });
        tabList.appendChild(button);
      }

      head.appendChild(tabList);

      for (const tab of tabs) {
        const region = el('div', {
          class: 'xmt-tabpanel',
          role: 'tabpanel',
          id: `${id}-panel-${tab.id}`,
          'aria-labelledby': `${id}-tab-${tab.id}`,
          hidden: tab.id !== activeTabId
        });
        panelsById.set(tab.id, region);
        body.appendChild(region);
      }
    } else if (tabs.length === 1) {
      const region = el('div', { class: 'xmt-tabpanel' });
      panelsById.set(tabs[0].id, region);
      body.appendChild(region);
    }

    root.appendChild(body);

    root.appendChild(
      el('div', { class: 'xmt-panel-foot' }, [
        el('span', { text: `${NAME} v${VERSION}` }),
        el('div', { class: 'xmt-cluster' }, footActions)
      ])
    );

    // Klik di dalam panel tidak boleh menutupnya lewat penangan global.
    root.addEventListener('pointerdown', (event) => event.stopPropagation());

    let releaseDismiss = null;
    const rendered = new Set();

    const api = {
      root,
      body,

      /** Wilayah isi untuk satu tab. */
      region(tabId) {
        return panelsById.get(tabId ?? activeTabId) ?? body;
      },

      get isOpen() {
        return root.classList.contains('xmt-open');
      },

      showTab(tabId) {
        if (!panelsById.has(tabId)) return;
        activeTabId = tabId;

        for (const [key, region] of panelsById) {
          region.hidden = key !== tabId;
        }

        for (const button of root.querySelectorAll('.xmt-tab')) {
          button.setAttribute('aria-selected', button.dataset.tab === tabId ? 'true' : 'false');
        }

        const tab = tabs.find((entry) => entry.id === tabId);
        // Render tab hanya saat pertama kali dibuka, agar panel terbuka cepat.
        if (tab?.render && !rendered.has(tabId)) {
          rendered.add(tabId);
          tab.render(panelsById.get(tabId), api);
        }
      },

      /** Memaksa render ulang satu tab. */
      refreshTab(tabId = activeTabId) {
        rendered.delete(tabId);
        api.showTab(tabId);
      },

      open(tabId) {
        if (!root.isConnected) document.body.appendChild(root);

        // Hanya satu panel terbuka sekaligus agar tidak saling menutupi.
        for (const other of openPanels) {
          if (other !== api) other.close();
        }

        root.classList.add('xmt-open');
        openPanels.add(api);
        syncTheme();

        api.showTab(tabId ?? activeTabId);
        onOpen?.(api);

        releaseDismiss?.();
        releaseDismiss = dismissOn(root, {
          // Tombol pemicu milik ekstensi dikecualikan. Tanpa ini, pointerdown
          // pada tombol akan menutup panel sebelum penangan klik berjalan,
          // sehingga tombol tidak pernah bisa dipakai untuk menutup.
          ignore: Array.from(document.querySelectorAll('.xmt-header-btn, .xmt-fab')),
          onDismiss: () => api.close()
        });
      },

      close() {
        root.classList.remove('xmt-open');
        openPanels.delete(api);
        releaseDismiss?.();
        releaseDismiss = null;
      },

      toggle(tabId) {
        if (api.isOpen) api.close();
        else api.open(tabId);
      },

      /** Menampilkan status memuat pada tab tertentu. */
      loading(message = 'Memuat data…', tabId) {
        replace(api.region(tabId), [
          el('div', { class: 'xmt-loading' }, [
            el('div', { class: 'xmt-spinner' }),
            el('span', { text: message })
          ])
        ]);
      },

      /** Menampilkan keadaan kosong. */
      empty({ title: emptyTitle, text, action } = {}, tabId) {
        replace(api.region(tabId), [
          el('div', { class: 'xmt-empty' }, [
            el('div', { class: 'xmt-empty-title', text: emptyTitle ?? 'Belum ada data' }),
            text && el('div', { class: 'xmt-empty-text', text }),
            action
          ])
        ]);
      },

      /** Menampilkan pesan galat beserta tombol coba lagi. */
      error(message, onRetry, tabId) {
        replace(api.region(tabId), [
          el('div', { class: 'xmt-notice', dataset: { tone: 'danger' } }, [
            icon('warning'),
            el('div', { text: message })
          ]),
          onRetry &&
            el('button', {
              type: 'button',
              class: 'xmt-btn',
              dataset: { variant: 'primary' },
              text: 'Coba lagi',
              on: { click: onRetry }
            })
        ]);
      },

      destroy() {
        api.close();
        root.remove();
      }
    };

    return api;
  }

  /* --------------------------------------------------------- dialog */

  /**
   * Dialog modal. Mengembalikan Promise yang selesai dengan nilai yang
   * diberikan tombol, atau null bila dibatalkan.
   */
  function dialog({ title, iconName = 'info', body: buildBody, actions = [], width }) {
    return new Promise((resolve) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        release();
        overlay.remove();
        resolve(value);
      };

      const inner = el('div', {
        class: 'xmt-modal-inner',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        style: width ? { width } : undefined
      });

      const closeButton = el('button', {
        type: 'button',
        class: 'xmt-icon-btn',
        title: 'Tutup',
        'aria-label': 'Tutup dialog',
        on: { click: () => finish(null) }
      });
      closeButton.appendChild(icon('close'));

      inner.appendChild(
        el('div', { class: 'xmt-panel-head' }, [
          el('div', { class: 'xmt-panel-head-row' }, [
            el('div', { class: 'xmt-panel-title' }, [icon(iconName), el('span', { text: title })]),
            closeButton
          ])
        ])
      );

      const content = el('div', { class: 'xmt-modal-body' });
      inner.appendChild(content);

      const footer = el('div', { class: 'xmt-modal-foot' });

      for (const action of actions) {
        footer.appendChild(
          el('button', {
            type: 'button',
            class: 'xmt-btn',
            dataset: { variant: action.variant },
            text: action.label,
            on: {
              click: async () => {
                if (action.onClick) {
                  const result = await action.onClick({ content, close: finish });
                  if (result === false) return;
                  finish(result ?? action.value ?? true);
                  return;
                }
                finish(action.value ?? true);
              }
            }
          })
        );
      }

      if (actions.length > 0) inner.appendChild(footer);

      const overlay = scope(
        el('div', {
          class: 'xmt-modal',
          on: {
            pointerdown: (event) => {
              if (event.target === overlay) finish(null);
            }
          }
        }, [inner])
      );

      buildBody?.(content, { close: finish });

      document.body.appendChild(overlay);

      const release = dismissOn(inner, { onDismiss: () => finish(null) });

      // Fokus tombol utama agar dialog bisa dioperasikan dari papan tuli.
      inner.querySelector('.xmt-btn[data-variant="primary"], .xmt-btn')?.focus();
    });
  }

  /** Dialog konfirmasi. Mengembalikan true bila pengguna menyetujui. */
  async function confirm({
    title,
    message,
    detail,
    tone = 'warning',
    confirmLabel = 'Lanjutkan',
    cancelLabel = 'Batal'
  }) {
    const result = await dialog({
      title,
      iconName: tone === 'danger' ? 'warning' : 'info',
      body: (content) => {
        replace(content, [
          el('div', { class: 'xmt-notice', dataset: { tone } }, [
            icon(tone === 'danger' ? 'warning' : 'info'),
            el('div', { text: message })
          ]),
          detail && el('p', { class: 'xmt-hint', text: detail, style: { marginTop: '12px' } })
        ]);
      },
      actions: [
        { label: cancelLabel, variant: 'ghost', value: false },
        { label: confirmLabel, variant: tone === 'danger' ? 'danger' : 'primary', value: true }
      ]
    });

    return result === true;
  }

  /* ------------------------------------------------- komponen bantu */

  const parts = {
    /** Baris label-nilai. */
    row(label, value, { tone } = {}) {
      return el('div', { class: 'xmt-row' }, [
        el('span', { class: 'xmt-row-label', text: label }),
        value instanceof Node
          ? value
          : el('span', {
              class: 'xmt-row-value',
              style: tone ? { color: `var(--xmt-${tone})` } : undefined,
              text: String(value ?? '-')
            })
      ]);
    },

    /** Kartu berjudul. */
    card({ title, action, children }) {
      return el('div', { class: 'xmt-card' }, [
        title &&
          el('div', { class: 'xmt-card-head' }, [
            el('div', { class: 'xmt-card-title', text: title }),
            action
          ]),
        children
      ]);
    },

    /** Lencana kecil berwarna. */
    badge(text, tone) {
      return el('span', { class: 'xmt-badge', dataset: { tone }, text });
    },

    /** Baris daftar yang bisa berupa tautan atau tombol. */
    item({ iconName = 'doc', tone, title, meta = [], href, onClick, trailIcon = 'chevron' }) {
      const children = [
        el('div', { class: 'xmt-item-icon', dataset: { tone } }, [icon(iconName)]),
        el('div', { class: 'xmt-item-body' }, [
          el('span', { class: 'xmt-item-title', text: title }),
          meta.length > 0 &&
            el(
              'div',
              { class: 'xmt-item-meta' },
              meta.filter(Boolean).map((entry) =>
                entry instanceof Node ? entry : el('span', { text: String(entry) })
              )
            )
        ]),
        el('span', { class: 'xmt-item-trail' }, [icon(trailIcon)])
      ];

      if (href) {
        return el(
          'a',
          { class: 'xmt-item', href, target: '_blank', rel: 'noopener noreferrer' },
          children
        );
      }

      return el('button', { type: 'button', class: 'xmt-item', on: { click: onClick } }, children);
    },

    /** Bagian yang bisa dilipat. */
    collapse({ title, children, open = false, badge }) {
      const region = el('div', { class: 'xmt-collapse-body', hidden: !open }, children);

      const head = el('button', {
        type: 'button',
        class: 'xmt-collapse-head',
        'aria-expanded': open ? 'true' : 'false',
        on: {
          click: () => {
            const next = region.hidden;
            region.hidden = !next;
            head.setAttribute('aria-expanded', next ? 'true' : 'false');
          }
        }
      });

      head.appendChild(el('span', { text: title }));
      head.appendChild(el('span', { class: 'xmt-cluster' }, [badge, icon('expand')]));

      return el('div', { class: 'xmt-card' }, [head, region]);
    },

    /** Kartu statistik. */
    stat({ label, value, highlight }) {
      return el('div', { class: 'xmt-stat', dataset: { highlight: highlight ? 'true' : undefined } }, [
        el('div', { class: 'xmt-stat-label', text: label }),
        el('div', { class: 'xmt-stat-value', text: String(value ?? '-') })
      ]);
    },

    /** Kotak pesan berwarna. */
    notice({ tone = 'info', title, text, children }) {
      return el('div', { class: 'xmt-notice', dataset: { tone } }, [
        icon(tone === 'danger' || tone === 'warning' ? 'warning' : 'info'),
        el('div', {}, [
          title && el('strong', { text: `${title} ` }),
          text && el('span', { text }),
          children
        ])
      ]);
    },

    /** Bilah progres. Mengembalikan elemen beserta pengatur nilainya. */
    progress() {
      const bar = el('div', { class: 'xmt-progress-bar' });
      const root = el(
        'div',
        {
          class: 'xmt-progress',
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100'
        },
        [bar]
      );

      return {
        root,
        set(value) {
          const safe = globalThis.XMTUtil.clamp(value, 0, 100);
          bar.style.width = `${safe}%`;
          root.setAttribute('aria-valuenow', String(safe));
        }
      };
    },

    /** Tombol yang menampilkan status sibuk saat menjalankan aksi async. */
    asyncButton({ label, iconName, variant, size, busyLabel = 'Memproses…', onClick }) {
      const build = (text, spinning) => {
        button.replaceChildren();
        if (spinning) button.appendChild(el('div', { class: 'xmt-spinner', dataset: { size: 'sm' } }));
        else if (iconName) button.appendChild(icon(iconName));
        button.appendChild(el('span', { text }));
      };

      const button = el('button', {
        type: 'button',
        class: 'xmt-btn',
        dataset: { variant, size },
        on: {
          click: async () => {
            if (button.disabled) return;
            button.disabled = true;
            build(busyLabel, true);
            try {
              await onClick();
            } catch (error) {
              toast(error?.message ?? 'Terjadi kesalahan.', 'error');
            } finally {
              button.disabled = false;
              build(label, false);
            }
          }
        }
      });

      build(label, false);
      return button;
    },

    /** Tombol salin ke papan klip. */
    copyButton(getText, { label = 'Salin', size = 'sm' } = {}) {
      return parts.asyncButton({
        label,
        iconName: 'copy',
        size,
        busyLabel: 'Menyalin…',
        onClick: async () => {
          const ok = await globalThis.XMTDom.copyText(getText());
          toast(ok ? 'Tersalin ke papan klip.' : 'Gagal menyalin.', ok ? 'success' : 'error');
        }
      });
    }
  };

  /* ---------------------------------------------- pembuka panel dari popup */

  /**
   * Registri panel yang bisa dibuka dari popup ekstensi.
   *
   * Popup tidak bisa memanggil fungsi content script secara langsung, dan
   * menyuntikkan skrip ke main world juga tidak akan menemukannya karena
   * content script berjalan di isolated world. Jalur yang benar adalah
   * pesan runtime, jadi setiap fitur mendaftarkan pembukanya di sini.
   */
  const openers = new Map();

  function registerOpener(name, open) {
    openers.set(name, open);
  }

  if (chrome.runtime?.id) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== globalThis.XMT_CONST.MSG.OPEN_PANEL) return false;

      const open = openers.get(message.panel);
      if (!open) {
        sendResponse({ ok: false, error: `Panel ${message.panel} tidak tersedia di halaman ini.` });
        return false;
      }

      try {
        open();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message ?? 'Gagal membuka panel.' });
      }

      return false;
    });
  }

  /* ------------------------------------------------------ inisialisasi */

  function init() {
    syncTheme();
    onMutate(syncTheme);
    store.watch(globalThis.XMT_CONST.KEYS.THEME, syncTheme);
    checkSensitiveFeatures();
  }

  async function checkSensitiveFeatures() {
    const features = await store.features();
    const seen = await store.get(globalThis.XMT_CONST.KEYS.GUIDE_SEEN);
    if (!seen) return;

    const sensitiveOff = [];
    const META = globalThis.XMT_CONST.FEATURE_META;
    const candidates = ['quizHelper', 'quizAutoSubmit', 'surveyHelper'];
    for (const name of candidates) {
      if (!features[name] && META[name]) {
        sensitiveOff.push(META[name].label);
      }
    }

    if (sensitiveOff.length === 0) return;

    const dismissKey = `__xmt_feature_remind_${new Date().toDateString()}`;
    if (sessionStorage.getItem(dismissKey)) return;
    sessionStorage.setItem(dismissKey, '1');

    setTimeout(() => {
      const node = toast(
        `Fitur berikut belum aktif: ${sensitiveOff.join(', ')}. Aktifkan di Pengaturan > Fitur untuk mempermudah Anda.`,
        'info',
        { duration: 6000 }
      );
      if (node) {
        node.style.cursor = 'pointer';
        node.addEventListener('click', () => {
          node.remove();
          const opener = openers.get('settings');
          if (opener) opener();
        });
      }
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  globalThis.XMTUI = {
    scope,
    toast,
    headerButton,
    fab,
    fabRack,
    panel,
    dialog,
    confirm,
    parts,
    registerOpener,
    get theme() {
      return currentTheme;
    },
    syncTheme
  };
})();
