/**
 * X Mentari — panduan penggunaan
 *
 * Panduan ringkas di dalam ekstensi, agar pengguna baru tahu urutan
 * penyiapan dan cara menangani galat yang umum tanpa perlu bertanya.
 */
(() => {
  if (window.__XMT_GUIDE__) return;
  window.__XMT_GUIDE__ = true;

  const { KEYS, NAME, VERSION } = globalThis.XMT_CONST;
  const { el, replace } = globalThis.XMTDom;
  const UI = globalThis.XMTUI;
  const store = globalThis.XMTStore;

  const SECTIONS = [
    {
      tag: 'Langkah 1',
      title: 'Pasang penyedia AI',
      body: 'Fitur AI memakai penyedia dan kunci milik Anda sendiri. Buka Pengaturan lalu Kelola penyedia, pilih layanan siap pakai (Gemini, OpenAI, OpenRouter, Groq, DeepSeek, Claude, dan lainnya) atau isi endpoint kustom sendiri.',
      points: [
        'Bisa menambahkan lebih dari satu penyedia dan berpindah kapan saja.',
        'Kunci disimpan di penyimpanan ekstensi, bukan di halaman kampus.',
        'Tekan Uji koneksi sebelum menyimpan; daftar model akan terisi otomatis.',
        'Model lokal seperti Ollama dan LM Studio didukung, tanpa perlu kunci.',
        'Tanpa penyedia, fitur non-AI seperti Forum Tracker dan Rekap Presensi tetap berjalan.'
      ]
    },
    {
      tag: 'Langkah 2',
      title: 'Pilih fitur yang Anda pakai',
      body: 'Buka Pengaturan lalu tab Fitur. Setiap fitur bisa dimatikan sendiri-sendiri. Fitur yang menyentuh formulir penilaian berstatus mati secara bawaan dan meminta konfirmasi saat diaktifkan.',
      points: ['Perubahan berlaku setelah halaman dimuat ulang.']
    },
    {
      tag: 'Forum',
      title: 'Pantau forum dan balasan dosen',
      body: 'Tombol forum di toolbar membuka daftar forum yang belum dikerjakan, lengkap dengan angka pada tombolnya. Tab Notifikasi mengumpulkan balasan dosen dari seluruh forum sehingga tidak perlu dibuka satu per satu.',
      points: [
        'Forum yang post test-nya belum tuntas tidak dihitung, karena MENTARI belum membukanya.',
        'Data disimpan sepuluh menit agar panel terbuka seketika; tekan Muat ulang untuk memaksa segar.'
      ]
    },
    {
      tag: 'AI',
      title: 'Asisten dan bantuan diskusi',
      body: 'Panel asisten mengingat percakapan, jadi pertanyaan lanjutan dipahami. Di halaman forum, tombol Susun draf membuat rancangan jawaban yang bisa Anda ringkas, perpanjang, atau sisipkan ke kolom jawaban.',
      points: [
        'Tombol ambil isi halaman memasukkan materi yang sedang dibuka sebagai konteks.',
        'Draf tidak pernah terkirim sendiri. Tombol kirim MENTARI tetap Anda tekan.'
      ]
    },
    {
      tag: 'Kuis',
      title: 'Analisis kuis sebagai bahan tinjauan',
      body: 'Fitur ini membaca soal dan menampilkan saran jawaban beserta tingkat keyakinan model dan alasannya. Saran dengan keyakinan rendah ditandai supaya Anda memeriksanya lebih dulu.',
      points: [
        'Tidak ada penekanan tombol mulai, konfirmasi, maupun submit.',
        'Menandai pilihan dilakukan per soal atas klik Anda, dan hanya bila soal ditemukan dengan yakin di halaman.',
        'Periksa aturan akademik kampus sebelum memakai bantuan AI untuk penilaian.'
      ]
    },
    {
      tag: 'Galat umum',
      title: 'Kuota habis atau model tidak tersedia',
      body: 'Pesan tentang kuota berarti jatah penyedia itu sudah terpakai. Buka Pengaturan, ganti model, atau pindah ke penyedia lain yang sudah Anda tambahkan.',
      points: [
        'Daftar model diambil langsung dari penyedia Anda, jadi hanya model yang benar-benar tersedia yang muncul.',
        'Sisa kuota yang terakhir dilaporkan penyedia ditampilkan di tab Umum.',
        'Menyiapkan beberapa penyedia sekaligus memudahkan berpindah saat satu kehabisan kuota.'
      ]
    },
    {
      tag: 'Galat umum',
      title: 'Sesi login berakhir',
      body: 'Bila panel melaporkan token tidak ditemukan atau sesi berakhir, muat ulang halaman lalu login lagi. Ekstensi memakai sesi Anda sendiri dan tidak menyimpan kata sandi apa pun.'
    }
  ];

  function render(region) {
    replace(region, [
      UI.parts.notice({
        tone: 'info',
        title: `${NAME} v${VERSION}.`,
        text: 'Semua pemrosesan berjalan di perangkat Anda. Data akademik diminta langsung dari server kampus memakai sesi login Anda.'
      }),

      ...SECTIONS.map((section) =>
        UI.parts.card({
          children: [
            UI.parts.badge(section.tag, 'brand'),
            el('h3', {
              text: section.title,
              style: {
                margin: '8px 0 6px',
                fontSize: 'var(--xmt-text-md)',
                fontWeight: '700',
                color: 'var(--xmt-accent)'
              }
            }),
            el('p', {
              class: 'xmt-text-sm xmt-text-muted',
              style: { margin: 0, lineHeight: '1.6' },
              text: section.body
            }),
            section.points &&
              el(
                'ul',
                {
                  class: 'xmt-text-xs xmt-text-muted',
                  style: { margin: '10px 0 0', paddingLeft: '18px', lineHeight: '1.7' }
                },
                section.points.map((point) => el('li', { text: point }))
              )
          ]
        })
      ),

      el('div', { class: 'xmt-cluster', style: { marginTop: '12px' } }, [
        el('button', {
          type: 'button',
          class: 'xmt-btn',
          dataset: { variant: 'primary' },
          text: 'Buka Pengaturan',
          on: { click: () => window.XMTSettings?.open('general') }
        }),
        el('button', {
          type: 'button',
          class: 'xmt-btn',
          text: 'Kelola penyedia AI',
          on: { click: () => globalThis.XMTAI.openOptions() }
        })
      ])
    ]);
  }

  function init() {
    const panel = UI.panel({
      id: 'xmt-guide-panel',
      title: 'Panduan',
      subtitle: NAME,
      iconName: 'book',
      anchor: 'header',
      tabs: [{ id: 'guide', label: 'Panduan', render }]
    });

    UI.headerButton({
      id: 'xmt-guide-btn',
      title: 'X Mentari — Panduan',
      iconName: 'book',
      onClick: () => panel.toggle('guide')
    });

    // Tampilkan panduan sekali pada pemakaian pertama, saat belum ada
    // penyedia AI, agar pengguna baru tahu harus mulai dari mana.
    (async () => {
      const [seen, ready] = await Promise.all([store.get(KEYS.GUIDE_SEEN), store.hasProvider()]);
      if (seen || ready) return;

      await store.set(KEYS.GUIDE_SEEN, true);
      setTimeout(() => panel.open('guide'), 1400);
    })();

    UI.registerOpener('guide', () => panel.open('guide'));

    window.XMTGuide = { open: () => panel.open('guide') };
  }

  init();
})();
