/**
 * X Mentari — halaman login
 *
 * Dua fitur opsional yang keduanya mati secara bawaan:
 *   loginSkin       — mengganti latar halaman login.
 *   passwordHelper  — mengisi kolom sandi dari pola bawaan kampus.
 *
 * Berkas ini sengaja tidak bergantung pada kerangka UI. Halaman login
 * dimuat pada document_start dan belum punya kerangka MUI, jadi kode di
 * sini harus ringan dan berdiri sendiri.
 */
(() => {
  if (window.__XMT_LOGIN__) return;
  window.__XMT_LOGIN__ = true;

  const store = globalThis.XMTStore;
  const { debounce } = globalThis.XMTUtil;

  /**
   * Pola sandi bawaan yang dipakai kampus saat akun dibuat.
   *
   * Ini hanya membantu mengisi kolom; tidak menebak, memverifikasi, atau
   * menyimpan sandi apa pun. Bila Anda sudah mengganti sandi, pola ini
   * tidak berlaku dan fiturnya tidak berguna.
   */
  const PASSWORD_SUFFIX = 'unpam#';

  const SELECTORS = {
    username: [
      'input[name="username"]',
      'input[autocomplete="username"]',
      'input[aria-label*="sername" i]',
      'input[placeholder*="sername" i]',
      'input[type="text"]'
    ],
    password: [
      'input[name="password"]',
      'input[autocomplete="current-password"]',
      'input[type="password"]'
    ]
  };

  function findFirst(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  /* ------------------------------------------------------------ tema login */

  function applySkin() {
    // Aset latar belakang kustom dinonaktifkan sementara karena berkas tidak disertakan.
  }

  /* -------------------------------------------------------- bantuan sandi */

  const BUTTON_ID = 'xmt-fill-password';

  /**
   * Menyediakan tombol untuk mengisi sandi, bukan mengisinya otomatis.
   *
   * Mengisi kolom sandi pada setiap ketikan berarti kolom itu terisi tanpa
   * pengguna memintanya, termasuk ketika ia hendak mengetik sandi lain.
   * Tombol membuat setiap pengisian menjadi tindakan yang disengaja.
   */
  function mountPasswordButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const username = findFirst(SELECTORS.username);
    const password = findFirst(SELECTORS.password);
    if (!username || !password) return;

    const host = password.closest('.MuiFormControl-root') ?? password.parentElement;
    if (!host) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Isi sandi pola kampus';
    button.title = 'Mengisi kolom sandi dengan NIM diikuti pola bawaan kampus';

    Object.assign(button.style, {
      display: 'block',
      marginTop: '6px',
      padding: '5px 10px',
      border: '1px solid rgba(240,135,45,.4)',
      borderRadius: '999px',
      background: 'rgba(240,135,45,.12)',
      color: '#f0872d',
      font: '600 11px system-ui, sans-serif',
      cursor: 'pointer'
    });

    button.addEventListener('click', (event) => {
      event.preventDefault();

      const id = username.value.trim();

      if (!id) {
        button.textContent = 'Isi username dulu';
        setTimeout(() => {
          button.textContent = 'Isi sandi pola kampus';
        }, 1600);
        username.focus();
        return;
      }

      // React memantau setter properti value; menulis langsung tidak
      // memperbarui state formulir.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      const value = id + PASSWORD_SUFFIX;

      if (setter) setter.call(password, value);
      else password.value = value;

      password.dispatchEvent(new Event('input', { bubbles: true }));
      password.dispatchEvent(new Event('change', { bubbles: true }));

      button.textContent = 'Sandi terisi';
      setTimeout(() => {
        button.textContent = 'Isi sandi pola kampus';
      }, 1600);
    });

    host.appendChild(button);
  }

  /* ---------------------------------------------------------------- pasang */

  async function init() {
    const [skin, helper] = await Promise.all([
      store.enabled('loginSkin'),
      store.enabled('passwordHelper')
    ]);

    if (!skin && !helper) return;

    const run = debounce(() => {
      if (skin) applySkin();
      if (helper) mountPasswordButton();
    }, 150);

    const start = () => {
      run();
      // Halaman login MENTARI merender formulirnya setelah skrip ini jalan.
      new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  init();
})();
