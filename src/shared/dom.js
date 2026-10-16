/**
 * X Mentari — pembantu DOM
 *
 * Menyediakan pembangun elemen yang aman (tidak pernah memakai innerHTML
 * untuk data), satu MutationObserver terpusat yang bisa dibagi banyak fitur,
 * pemantau navigasi SPA, dan katalog ikon SVG.
 */
(() => {
  if (globalThis.XMTDom) return;

  const { debounce, throttle } = globalThis.XMTUtil;

  /* ------------------------------------------------------------------ ikon */

  /**
   * Path SVG 24x24. Disimpan sebagai data, bukan markup, agar
   * pembuatannya lewat createElementNS dan tidak pernah lewat innerHTML.
   */
  const ICON_PATHS = {
    forum: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z',
    chat: 'M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
    sparkle: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
    quiz: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8.29 13.29a1 1 0 01-1.42 0L6.7 13.7a1 1 0 011.42-1.42l1.88 1.89 4.88-4.88a1 1 0 011.42 1.42l-5.59 5.58z',
    checklist:
      'M22 7l-1.41-1.41-6.34 6.34 1.41 1.41L22 7zm4.24-4.24L22.24 7l1.41 1.41L28 4.17 26.24 2.76zM.41 12.41L6 18l1.41-1.41L1.83 11 .41 12.41zM17.66 2.76L7.07 13.34 2.83 9.1 1.41 10.5l5.66 5.66L19.07 4.17l-1.41-1.41z',
    check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    checkCircle:
      'M12 2a10 10 0 100 20 10 10 0 000-20zm-1 15l-5-5 1.41-1.41L11 13.17l5.59-5.59L18 9l-7 8z',
    cancel:
      'M12 2a10 10 0 100 20 10 10 0 000-20zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    settings:
      'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.5.5 0 00.12-.61l-1.92-3.32a.5.5 0 00-.59-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84a.48.48 0 00-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.5.5 0 00-.59.22L2.74 8.87a.5.5 0 00.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.5.5 0 00-.12.61l1.92 3.32a.5.5 0 00.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96a.5.5 0 00.59-.22l1.92-3.32a.5.5 0 00-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z',
    key: 'M12.65 10A5.99 5.99 0 007 6a6 6 0 100 12 5.99 5.99 0 005.65-4H17v4h4v-4h2v-4H12.65zM7 14a2 2 0 110-4 2 2 0 010 4z',
    refresh:
      'M17.65 6.35A8 8 0 1019.73 14h-2.08A6 6 0 1112 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    copy: 'M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14c0 1.1.9 2 2 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z',
    insert: 'M12 3v10.55A4 4 0 1014 17V7h4V3h-6z',
    send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
    trash: 'M6 19c0 1.1.9 2 2 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    expand: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
    chevron: 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z',
    external: 'M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    info: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    warning: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    book: 'M18 2H6a2 2 0 00-2 2v16c0 1.1.9 2 2 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm0 18H6v-2h12v2zm0-4H6V4h12v12z',
    person: 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z',
    people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    todo: 'M22 5.18L10.59 16.6l-4.24-4.24-1.41 1.41 5.66 5.66L23.41 6.59 22 5.18zM12 20H2V4h14v2h2V4a2 2 0 00-2-2H2a2 2 0 00-2 2v16a2 2 0 002 2h10v-2z',
    trophy: 'M19 5h-2V3H7v2H5a2 2 0 00-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0011 15.9V19H7v2h10v-2h-4v-3.1a5.01 5.01 0 003.61-2.96C19.08 12.63 21 10.55 21 8V7a2 2 0 00-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z',
    bell: 'M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6v-5a6 6 0 00-4.5-5.8V4a1.5 1.5 0 00-3 0v1.2A6 6 0 006 11v5l-2 2v1h16v-1l-2-2z',
    video: 'M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z',
    article: 'M19 3H5a2 2 0 00-2 2v14c0 1.1.9 2 2 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
    slides: 'M21 3H3v2h18V3zm-2 4H5v10h14V7zm-8 8V9l5 3-5 3z',
    link: 'M3.9 12a3.1 3.1 0 013.1-3.1h4V7H7a5 5 0 000 10h4v-1.9H7A3.1 3.1 0 013.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 010 6.2h-4V17h4a5 5 0 000-10z',
    file: 'M14 2H6a2 2 0 00-2 2v16c0 1.1.9 2 2 2h12a2 2 0 002-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    doc: 'M6 2a2 2 0 00-2 2v16c0 1.1.9 2 2 2h12a2 2 0 002-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
    folder: 'M10 4H4a2 2 0 00-2 2v12c0 1.1.9 2 2 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z',
    calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14c0 1.1.9 2 2 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10z',
    history: 'M13 3a9 9 0 00-9 9H1l4 4 4-4H6a7 7 0 117 7 7 7 0 01-4.95-2.05L6.64 18.36A9 9 0 1013 3zm-1 5v5l4.25 2.52.75-1.23-3.5-2.08V8H12z',
    eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z',
    eyeOff:
      'M12 6.5a5 5 0 014.78 6.53l2.93 2.93A11.8 11.8 0 0023 12c-1.73-4.39-6-7.5-11-7.5-1.26 0-2.47.2-3.6.57l2.17 2.17c.45-.15.93-.24 1.43-.24zM2.71 3.16L1.29 4.58l2.48 2.48A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l3.04 3.04 1.41-1.41L2.71 3.16zM7.53 10.8A4.5 4.5 0 0012 16.5c.31 0 .61-.03.9-.09l-1.2-1.2A2.5 2.5 0 019.5 12l-1.97-1.2z',
    bolt: 'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66L13 3h1l-1 7h3.5c.49 0 .56.33.47.51L11 21z',
    stats: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z',
    shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    search: 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L21 19.5l-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z',
    grab: 'M18 4h-3.18A2.99 2.99 0 0012 2a3 3 0 00-2.82 2H6a2 2 0 00-2 2v14c0 1.1.9 2 2 2h5v-2H6V6h2v2h8V6h2v6h2V6a2 2 0 00-2-2zm-6 0a1 1 0 110 2 1 1 0 010-2zm7 12v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z',
    magic: 'M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7 7.5 5.6zm12 9.8L22 14l-1.4 2.5L22 19l-2.5-1.4L17 19l1.4-2.5L17 14l2.5 1.4zM22 2l-1.4 2.5L22 7l-2.5-1.4L17 7l1.4-2.5L17 2l2.5 1.4L22 2zm-8.1 9.1l2.8 2.8L6.8 23.8 4 21 13.9 11.1zm2.8-2.8a1 1 0 000-1.4l-1.4-1.4a1 1 0 00-1.4 0l-1.4 1.4 2.8 2.8 1.4-1.4z'
  };

  /** Membuat elemen <svg> dari nama ikon. */
  function icon(name, { size } = {}) {
    const path = ICON_PATHS[name] ?? ICON_PATHS.doc;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (size) {
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
    }
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', path);
    svg.appendChild(node);
    return svg;
  }

  /* ------------------------------------------------------- pembangun elemen */

  const SVG_KEYS = new Set(['svg', 'path']);

  /**
   * Membuat elemen dengan atribut dan anak.
   *
   * Teks selalu masuk lewat textContent. Tidak ada jalur innerHTML sama
   * sekali, sehingga data dari API atau model AI tidak bisa menjadi markup.
   *
   *   el('div', { class: 'xmt-card' }, [
   *     el('span', { text: course.name }),
   *     icon('forum')
   *   ])
   */
  function el(tag, props = {}, children = []) {
    const node = SVG_KEYS.has(tag)
      ? document.createElementNS('http://www.w3.org/2000/svg', tag)
      : document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;

      if (key === 'text') {
        node.textContent = String(value);
      } else if (key === 'class') {
        node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(node.style, value);
      } else if (key === 'dataset') {
        // Lewati nilai kosong; menyalinnya akan menghasilkan atribut
        // bernilai "undefined" yang tidak pernah cocok dengan selektor CSS.
        for (const [name, entry] of Object.entries(value)) {
          if (entry == null || entry === false) continue;
          node.dataset[name] = String(entry);
        }
      } else if (key === 'on' && typeof value === 'object') {
        for (const [event, handler] of Object.entries(value)) {
          node.addEventListener(event, handler);
        }
      } else if (key === 'icon') {
        node.appendChild(icon(value));
      } else if (key in node && typeof value !== 'object' && !key.startsWith('aria')) {
        // Properti langsung: value, checked, disabled, type, href, id, title.
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }

    append(node, children);
    return node;
  }

  /** Menambahkan anak, mengabaikan nilai kosong, merata array bersarang. */
  function append(parent, children) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child == null || child === false || child === '') continue;
      if (Array.isArray(child)) {
        append(parent, child);
      } else if (child instanceof Node) {
        parent.appendChild(child);
      } else {
        parent.appendChild(document.createTextNode(String(child)));
      }
    }
    return parent;
  }

  /** Mengganti seluruh isi elemen. */
  function replace(parent, children) {
    if (!parent) return parent;
    parent.replaceChildren();
    return append(parent, children);
  }

  /** Membuat fragment agar banyak node bisa disisipkan sekali jalan. */
  function fragment(children) {
    return append(document.createDocumentFragment(), children);
  }

  /* ------------------------------------------- observer DOM terpusat */

  /**
   * Satu MutationObserver dipakai bersama semua fitur. Ini mengganti
   * pola beberapa setInterval yang boros: callback dijalankan dengan
   * debounce setelah DOM berhenti berubah.
   */
  const watchers = new Set();
  let observer = null;
  let heartbeat = null;

  const runWatchers = debounce(() => {
    for (const watcher of watchers) {
      try {
        watcher();
      } catch (error) {
        console.warn('[XMT] pemantau DOM gagal', error);
      }
    }
  }, 120);

  function startObserver() {
    if (observer || !document.body) return;

    observer = new MutationObserver(runWatchers);
    observer.observe(document.body, { childList: true, subtree: true });

    // Jaring pengaman: MENTARI kadang mengganti node lewat jalur yang
    // tidak memicu observer pada frame yang sama. Interval lambat ini
    // jauh lebih murah daripada beberapa interval cepat.
    heartbeat = setInterval(runWatchers, 4000);
  }

  /**
   * Mendaftarkan callback yang dipanggil setiap kali DOM berubah.
   * Callback harus idempoten: ia akan dipanggil berkali-kali.
   */
  function onMutate(callback) {
    watchers.add(callback);
    startObserver();
    try {
      callback();
    } catch (error) {
      console.warn('[XMT] pemantau DOM gagal saat pemanggilan pertama', error);
    }
    return () => {
      watchers.delete(callback);
      if (watchers.size === 0) {
        observer?.disconnect();
        observer = null;
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };
  }

  /* ---------------------------------------------- pemantau rute SPA */

  const routeListeners = new Set();
  let lastHref = location.href;
  let routePatched = false;

  const notifyRoute = debounce(() => {
    if (location.href === lastHref) return;
    const previous = lastHref;
    lastHref = location.href;
    for (const listener of routeListeners) {
      try {
        listener(location.href, previous);
      } catch (error) {
        console.warn('[XMT] pemantau rute gagal', error);
      }
    }
  }, 80);

  function patchHistory() {
    if (routePatched) return;
    routePatched = true;

    // MENTARI dan MY UNPAM adalah SPA: URL berubah tanpa memuat ulang
    // halaman. Membungkus pushState/replaceState adalah satu-satunya cara
    // andal untuk mengetahuinya.
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function patched(...args) {
        const result = original.apply(this, args);
        notifyRoute();
        return result;
      };
    }

    window.addEventListener('popstate', notifyRoute);
    window.addEventListener('hashchange', notifyRoute);
  }

  /** Memanggil listener setiap kali URL berubah. */
  function onRoute(listener) {
    routeListeners.add(listener);
    patchHistory();
    return () => routeListeners.delete(listener);
  }

  /* ------------------------------------------------ pemasangan tombol */

  /**
   * Menjaga sebuah tombol tetap terpasang di toolbar MENTARI.
   *
   * `anchors` adalah daftar selektor yang dicoba berurutan. Tombol X Mentari
   * saling menjadi jangkar sehingga urutannya stabil dan tidak saling
   * memperebutkan posisi tombol tema.
   *
   * Mengembalikan fungsi pembatalan.
   */
  function mountHeaderButton({ id, anchors, build, fallback }) {
    return onMutate(() => {
      const existing = document.getElementById(id);
      if (existing?.isConnected) return;
      existing?.remove();

      for (const selector of anchors) {
        const anchor = document.querySelector(selector);
        if (!anchor?.parentNode) continue;
        anchor.parentNode.insertBefore(build(), anchor);
        return;
      }

      if (fallback) fallback(build());
    });
  }

  /** Menemukan tombol tema MENTARI, jangkar utama toolbar. */
  function findThemeButton() {
    const svg = document.querySelector(
      'svg[data-testid="DarkModeIcon"], svg[data-testid="LightModeIcon"], svg[data-testid="Brightness4Icon"], svg[data-testid="Brightness7Icon"]'
    );
    return svg?.closest('button') ?? null;
  }

  /* -------------------------------------------------------- interaksi */

  /** Menutup elemen saat klik di luar area atau tombol Escape. */
  function dismissOn(element, { ignore = [], onDismiss }) {
    const onPointerDown = (event) => {
      if (element.contains(event.target)) return;
      if (ignore.some((node) => node?.contains?.(event.target))) return;
      onDismiss();
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }

  /**
   * Mengisi nilai pada input yang dikendalikan React.
   *
   * React memantau setter properti `value`; menulis langsung ke `.value`
   * membuat state React tidak ikut berubah. Memanggil setter asli
   * prototipe lalu mengirim event input adalah cara yang bekerja.
   */
  function setReactValue(input, value) {
    if (!input) return false;

    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * Memilih radio atau checkbox pada komponen MUI.
   *
   * MUI membungkus input asli dan menyembunyikannya; klik pada input
   * sering diabaikan. Mengklik label pembungkus lebih dahulu adalah
   * cara yang diterima komponen.
   */
  function selectChoice(input) {
    if (!input || input.disabled) return false;

    const label =
      input.closest('label') ??
      input.closest('.MuiFormControlLabel-root') ??
      (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null);

    if (label) label.click();
    if (!input.checked) input.click();

    if (!input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return input.checked;
  }

  /** Menyalin teks ke papan klip, dengan cadangan bila API modern gagal. */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = el('textarea', {
        value: text,
        style: { position: 'fixed', top: '-1000px', opacity: '0' }
      });
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand?.('copy') ?? false;
      area.remove();
      return ok;
    }
  }

  /** Membaca nilai cookie berdasarkan nama. */
  function cookie(name) {
    const prefix = `${name}=`;
    for (const chunk of document.cookie ? document.cookie.split(';') : []) {
      const part = chunk.trim();
      if (part.startsWith(prefix)) {
        try {
          return decodeURIComponent(part.slice(prefix.length));
        } catch {
          return part.slice(prefix.length);
        }
      }
    }
    return '';
  }

  /** Menunggu selektor muncul, dengan batas waktu. */
  function waitFor(selector, { timeout = 8000 } = {}) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) {
        resolve(found);
        return;
      }

      const stop = onMutate(() => {
        const node = document.querySelector(selector);
        if (node) {
          stop();
          clearTimeout(timer);
          resolve(node);
        }
      });

      const timer = setTimeout(() => {
        stop();
        resolve(null);
      }, timeout);
    });
  }

  /* --------------------------------------- status progres live global */

  /**
   * Satu baris status kecil yang bisa dipakai proses lama mana pun untuk
   * melaporkan posisinya ("Cek: …", "Analisis: soal 3/12", …).
   *
   * Pola pakai: pasang sekali lewat mount(), tulis lewat report() berkali-
   * kali (di-throttle 120ms), tutup lewat done(). Tanpa request tambahan.
   */
  const live = {
    node: null,

    /** Membuat baris status di dalam `host`. Pindah bila host berganti. */
    mount(host, { hidden = true } = {}) {
      if (!host?.appendChild) return null;
      if (!this.node) {
        this.node = el('div', {
          class: 'xmt-text-xs xmt-text-muted',
          text: ''
        });
      }
      if (this.node.parentNode !== host) host.appendChild(this.node);
      this.node.style.display = hidden && !this.node.textContent ? 'none' : '';
      return this.node;
    },

    report(text, { instant = false } = {}) {
      this.node ??= null;
      if (!this.node) return;
      const message = String(text ?? '');
      if (instant) {
        throttledLiveReport.cancel?.();
        setLiveText(message);
        return;
      }
      throttledLiveReport(message);
    },

    /** Tulis langsung tanpa throttle; untuk pesan final seperti "selesai". */
    reportNow(text) {
      if (!this.node) return;
      setLiveText(String(text ?? ''));
    },

    done(text = '') {
      if (!this.node) return;
      setLiveText(String(text));
      if (!text && this.node) this.node.style.display = 'none';
    }
  };

  function setLiveText(text) {
    if (!live.node?.isConnected) return;
    live.node.textContent = text;
    live.node.style.display = '';
  }

  const throttledLiveReport = throttle(setLiveText, 120);

  globalThis.XMTDom = {
    el,
    append,
    replace,
    fragment,
    icon,
    ICON_PATHS,
    onMutate,
    onRoute,
    mountHeaderButton,
    findThemeButton,
    dismissOn,
    setReactValue,
    selectChoice,
    copyText,
    cookie,
    waitFor,
    live
  };
})();
