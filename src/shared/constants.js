/**
 * X Mentari — konstanta bersama
 *
 * Dimuat pertama di setiap konteks (content script, popup, halaman opsi,
 * service worker). Tidak melakukan apa pun selain mengekspor nilai; aman
 * dimuat berulang.
 */
(() => {
  if (globalThis.XMT_CONST) return;

  const HOSTS = {
    MENTARI: 'mentari.unpam.ac.id',
    MYUNPAM: 'my.unpam.ac.id'
  };

  const API = {
    MENTARI_BASE: `https://${HOSTS.MENTARI}/api`,
    MYUNPAM_BASE: `https://${HOSTS.MYUNPAM}/api`
  };

  /**
   * Kunci penyimpanan. Semuanya berada di chrome.storage.local, bukan
   * localStorage, agar popup dan content script membaca data yang sama.
   */
  const KEYS = {
    PROVIDERS: 'providers',
    ACTIVE_PROVIDER: 'activeProvider',
    THEME: 'theme',
    FEATURES: 'features',
    QUOTA: 'quota',
    CHAT_HISTORY: 'chatHistory',
    COURSE_CACHE: 'courseCache',
    COURSE_CACHE_AT: 'courseCacheAt',
    NOTIF_CACHE: 'notifCache',
    NOTIF_SEEN: 'notifSeen',
    GUIDE_SEEN: 'guideSeen',
    TODO_LIST: 'todoList',
    TODO_OVERRIDES: 'todoOverrides',
    LB_COLLAPSED: 'lbCollapsed',
    EXPORT_DATA: 'exportData',
    SCHEMA: 'schema',

    /* Kunci versi 1. Dibaca sekali saat migrasi, lalu tidak dipakai lagi. */
    LEGACY_API_KEY: 'apiKey',
    LEGACY_MODEL: 'model'
  };

  /** Versi skema penyimpanan saat ini. Dipakai untuk migrasi. */
  const SCHEMA_VERSION = 3;

  /**
   * Jenis protokol penyedia.
   *
   * Ketiganya mencakup hampir seluruh layanan yang ada: banyak penyedia
   * (OpenRouter, Groq, Together, DeepSeek, Mistral, Ollama, LM Studio)
   * meniru bentuk API OpenAI, sehingga satu adapter melayani semuanya.
   */
  const PROVIDER_KIND = {
    GEMINI: 'gemini',
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic'
  };

  const KIND_META = {
    [PROVIDER_KIND.GEMINI]: {
      label: 'Google Gemini',
      desc: 'Protokol generateContent milik Google.',
      keyHeader: 'x-goog-api-key',
      keyHint: 'Diawali AIza',
      pathHint: '/models/<model>:generateContent'
    },
    [PROVIDER_KIND.OPENAI]: {
      label: 'Kompatibel OpenAI',
      desc: 'Bentuk /chat/completions. Dipakai OpenAI, OpenRouter, Groq, DeepSeek, Ollama, dan lainnya.',
      keyHeader: 'Authorization: Bearer',
      keyHint: 'Umumnya diawali sk-',
      pathHint: '/chat/completions'
    },
    [PROVIDER_KIND.ANTHROPIC]: {
      label: 'Anthropic Claude',
      desc: 'Protokol /messages milik Anthropic.',
      keyHeader: 'x-api-key',
      keyHint: 'Diawali sk-ant-',
      pathHint: '/messages'
    }
  };

  /**
   * Preset untuk mempercepat penyiapan.
   *
   * `custom` sengaja disediakan supaya endpoint apa pun bisa dipakai,
   * termasuk server pribadi, gateway kampus, atau model lokal.
   */
  const PRESETS = [
    {
      id: 'gemini',
      name: 'Google Gemini',
      kind: PROVIDER_KIND.GEMINI,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash',
      models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'],
      keyUrl: 'https://aistudio.google.com/app/apikey',
      note: 'Ada jatah gratis harian. Cocok untuk pemakaian sehari-hari.'
    },
    {
      id: 'openai',
      name: 'OpenAI',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
      keyUrl: 'https://platform.openai.com/api-keys',
      note: 'Berbayar per pemakaian.'
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-2.0-flash-exp:free',
      models: [
        'google/gemini-2.0-flash-exp:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'deepseek/deepseek-chat',
        'anthropic/claude-3.5-sonnet'
      ],
      keyUrl: 'https://openrouter.ai/keys',
      note: 'Satu kunci untuk banyak model. Beberapa model bertanda :free.'
    },
    {
      id: 'groq',
      name: 'Groq',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
      keyUrl: 'https://console.groq.com/keys',
      note: 'Sangat cepat, ada jatah gratis.'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
      note: 'Murah, kemampuan penalaran baik.'
    },
    {
      id: 'mistral',
      name: 'Mistral',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'mistral-small-latest',
      models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
      keyUrl: 'https://console.mistral.ai/api-keys',
      note: 'Ada tingkat gratis.'
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      kind: PROVIDER_KIND.ANTHROPIC,
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-haiku-20241022',
      models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
      keyUrl: 'https://console.anthropic.com/settings/keys',
      note: 'Berbayar per pemakaian.'
    },
    {
      id: 'ollama',
      name: 'Ollama (lokal)',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      models: ['llama3.2', 'qwen2.5', 'gemma2'],
      keyUrl: 'https://ollama.com/download',
      note: 'Berjalan di komputer Anda. Kunci API tidak diperlukan.',
      keyOptional: true,
      local: true
    },
    {
      id: 'lmstudio',
      name: 'LM Studio (lokal)',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: 'http://localhost:1234/v1',
      model: 'local-model',
      models: [],
      keyUrl: 'https://lmstudio.ai',
      note: 'Berjalan di komputer Anda. Kunci API tidak diperlukan.',
      keyOptional: true,
      local: true
    },
    {
      id: 'custom',
      name: 'Endpoint kustom',
      kind: PROVIDER_KIND.OPENAI,
      baseUrl: '',
      model: '',
      models: [],
      note: 'Isi sendiri alamat dasar, model, dan header bila diperlukan.',
      custom: true
    }
  ];

  /**
   * Setiap fitur bisa dimatikan pengguna. Fitur yang mengisi jawaban atau
   * mengirim data atas nama pengguna sengaja berstatus mati secara bawaan.
   */
  const FEATURE_DEFAULTS = {
    forumTracker: true,
    lecturerNotif: true,
    chatbot: true,
    discussionHelper: true,
    quizHelper: false,
    quizAutoSubmit: false,
    presensi: true,
    surveyHelper: false,
    loginSkin: false,
    passwordHelper: false
  };

  const FEATURE_META = {
    forumTracker: {
      label: 'Forum Tracker',
      desc: 'Mendaftar forum diskusi yang belum dikerjakan.'
    },
    lecturerNotif: {
      label: 'Notifikasi Dosen',
      desc: 'Mengumpulkan balasan dosen dari seluruh forum.'
    },
    chatbot: {
      label: 'Asisten AI',
      desc: 'Panel percakapan dengan riwayat.'
    },
    discussionHelper: {
      label: 'Bantuan Diskusi',
      desc: 'Menyusun draf jawaban di halaman forum. Anda tetap yang mengirim.'
    },
    quizHelper: {
      label: 'Analisis Kuis',
      desc: 'Membaca soal dan menampilkan saran jawaban AI. Tidak pernah submit otomatis.',
      sensitive: true
    },
    quizAutoSubmit: {
      label: 'Kirim Jawaban Kuis Otomatis',
      desc: 'SANGAT BERISIKO. Mengirim jawaban saran AI langsung ke server tanpa Anda menekan tombol. Jawaban bisa salah dan dapat dianggap kecurangan. Aktifkan hanya bila Anda paham risikonya sepenuhnya.',
      sensitive: true
    },
    presensi: {
      label: 'Rekap Presensi',
      desc: 'Ringkasan kehadiran dari MY UNPAM.'
    },
    surveyHelper: {
      label: 'Bantuan Kuesioner',
      desc: 'Mengisi kuesioner dengan pola pilihan Anda. Submit tetap manual.',
      sensitive: true
    },
    loginSkin: {
      label: 'Tema Halaman Login',
      desc: 'Mengganti latar halaman login.'
    },
    passwordHelper: {
      label: 'Isi Sandi Otomatis',
      desc: 'Mengisi sandi dari pola bawaan kampus. Berisiko, aktifkan bila paham.',
      sensitive: true
    }
  };

  /** Nama pesan antara content script/popup/opsi dan service worker. */
  const MSG = {
    AI_GENERATE: 'ai:generate',
    AI_TEST_PROVIDER: 'ai:testProvider',
    AI_LIST_MODELS: 'ai:listModels',
    QUOTA_GET: 'quota:get',
    OPEN_PANEL: 'ui:openPanel',
    OPEN_OPTIONS: 'ui:openOptions',
    PING: 'sys:ping'
  };

  /** Kode template sub-bagian pada API MENTARI. */
  const TEMPLATE = {
    FORUM: 'FORUM_DISKUSI',
    PRE_TEST: 'PRE_TEST',
    POST_TEST: 'POST_TEST',
    QUIZ: 'QUIZ',
    EXAM: 'UJIAN',
    SURVEY: 'KUESIONER'
  };

  const LIMITS = {
    /** Permintaan HTTP serentak maksimum ke server kampus. */
    CONCURRENCY: 4,
    /** Umur cache daftar mata kuliah. */
    CACHE_TTL_MS: 10 * 60 * 1000,
    /** Jumlah pesan riwayat yang dikirim sebagai konteks percakapan. */
    CHAT_CONTEXT: 16,
    /** Jumlah pesan riwayat yang disimpan. */
    CHAT_KEEP: 80,
    /** Topik per forum yang dipindai saat mencari balasan dosen. */
    TOPICS_PER_FORUM: 6,
    /** Notifikasi yang ditampilkan. */
    NOTIF_MAX: 60,
    /** Pola pembukaan forum berdasarkan SKS (kelipatan 3: pertemuan 3,6,9,12). */
    FORUM_PATTERN_3SKS: [3, 6, 9, 12],
    /** Permintaan AI per menit dari ekstensi ini. */
    AI_PER_MINUTE: 30,
    /** Batas waktu satu permintaan AI. */
    AI_TIMEOUT_MS: 90_000
  };

  const GENERATION_DEFAULTS = {
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.95
  };

  globalThis.XMT_CONST = Object.freeze({
    NAME: 'X Mentari',
    VERSION: '2.2.0',
    HOSTS,
    API,
    KEYS,
    SCHEMA_VERSION,
    PROVIDER_KIND,
    KIND_META,
    PRESETS,
    FEATURE_DEFAULTS,
    FEATURE_META,
    MSG,
    TEMPLATE,
    LIMITS,
    GENERATION_DEFAULTS
  });
})();
