/**
 * X Mentari — adapter penyedia AI
 *
 * Setiap penyedia menerjemahkan permintaan generik menjadi bentuk HTTP
 * spesifik protokolnya, lalu menerjemahkan balasannya kembali. Ini murni
 * fungsi bentukan: tidak melakukan fetch, tidak menyentuh penyimpanan,
 * sehingga bisa diuji tanpa jaringan.
 *
 * Service worker yang memanggil `buildRequest`, melakukan fetch, lalu
 * memanggil `parseResponse`. Tiga protokol didukung — Gemini,
 * kompatibel-OpenAI, dan Anthropic — yang bersama-sama mencakup hampir
 * semua layanan yang ada.
 */
(() => {
  if (globalThis.XMTProviders) return;

  const { PROVIDER_KIND, GENERATION_DEFAULTS } = globalThis.XMT_CONST;

  /** Menyambung alamat dasar dengan path tanpa garis miring ganda. */
  function joinUrl(base, path) {
    return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
  }

  /**
   * Menyusun pesan bergaya peran (system/user/model) dari permintaan
   * generik. Dipakai adapter OpenAI dan Anthropic.
   */
  function roleMessages({ system, history, prompt }) {
    const messages = [];
    for (const entry of history ?? []) {
      const text = String(entry?.text ?? '').trim();
      if (!text) continue;
      messages.push({ role: entry.role === 'model' ? 'assistant' : 'user', text });
    }
    messages.push({ role: 'user', text: prompt });
    return { system, messages };
  }

  /* --------------------------------------------------------------- Gemini */

  const gemini = {
    kind: PROVIDER_KIND.GEMINI,

    buildRequest(provider, request) {
      const model = request.model || provider.model;
      const url = `${joinUrl(provider.baseUrl, `models/${encodeURIComponent(model)}`)}:generateContent`;

      const contents = [];

      // Model Gemini lama tidak selalu menerima systemInstruction, jadi
      // instruksi sistem dikirim sebagai putaran pertama percakapan.
      if (request.system) {
        contents.push({ role: 'user', parts: [{ text: `INSTRUKSI SISTEM: ${request.system}` }] });
        contents.push({ role: 'model', parts: [{ text: 'Dimengerti.' }] });
      }

      for (const entry of request.history ?? []) {
        const text = String(entry?.text ?? '').trim();
        if (!text) continue;
        contents.push({ role: entry.role === 'model' ? 'model' : 'user', parts: [{ text }] });
      }

      contents.push({ role: 'user', parts: [{ text: request.prompt }] });

      return {
        url,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Kunci di header, bukan query string, agar tidak masuk log akses.
          'x-goog-api-key': provider.apiKey,
          ...provider.headers
        },
        body: {
          contents,
          generationConfig: {
            temperature: request.temperature ?? GENERATION_DEFAULTS.temperature,
            maxOutputTokens: request.maxTokens ?? GENERATION_DEFAULTS.maxTokens,
            topP: request.topP ?? GENERATION_DEFAULTS.topP
          }
        }
      };
    },

    parseResponse(body) {
      const block = body?.promptFeedback?.blockReason;
      if (block) {
        return { blocked: true, reason: 'Permintaan diblokir oleh filter keamanan Google.' };
      }

      const candidate = body?.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .map((part) => part?.text ?? '')
        .join('')
        .trim();

      return {
        text,
        finishReason: candidate?.finishReason ?? null,
        truncated: candidate?.finishReason === 'MAX_TOKENS'
      };
    },

    modelsRequest(provider) {
      return {
        url: joinUrl(provider.baseUrl, 'models'),
        method: 'GET',
        headers: { 'x-goog-api-key': provider.apiKey, ...provider.headers }
      };
    },

    parseModels(body) {
      return (body?.models ?? [])
        .filter((model) => (model?.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((model) => String(model.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    }
  };

  /* ------------------------------------------------- kompatibel OpenAI */

  const openai = {
    kind: PROVIDER_KIND.OPENAI,

    buildRequest(provider, request) {
      const { system, messages } = roleMessages(request);
      const payload = [];

      if (system) payload.push({ role: 'system', content: system });
      for (const message of messages) {
        payload.push({ role: message.role, content: message.text });
      }

      return {
        url: joinUrl(provider.baseUrl, 'chat/completions'),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Kunci opsional untuk server lokal seperti Ollama.
          ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
          ...provider.headers
        },
        body: {
          model: request.model || provider.model,
          messages: payload,
          temperature: request.temperature ?? GENERATION_DEFAULTS.temperature,
          max_tokens: request.maxTokens ?? GENERATION_DEFAULTS.maxTokens,
          top_p: request.topP ?? GENERATION_DEFAULTS.topP,
          stream: false
        }
      };
    },

    parseResponse(body) {
      const choice = body?.choices?.[0];
      const message = choice?.message;

      // Sebagian model penalaran menaruh jawaban di reasoning_content.
      const text = String(message?.content ?? message?.reasoning_content ?? '').trim();

      return {
        text,
        finishReason: choice?.finish_reason ?? null,
        truncated: choice?.finish_reason === 'length'
      };
    },

    modelsRequest(provider) {
      return {
        url: joinUrl(provider.baseUrl, 'models'),
        method: 'GET',
        headers: {
          ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
          ...provider.headers
        }
      };
    },

    parseModels(body) {
      const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
      return list.map((model) => String(model?.id ?? model?.name ?? '')).filter(Boolean);
    }
  };

  /* ------------------------------------------------------------ Anthropic */

  const anthropic = {
    kind: PROVIDER_KIND.ANTHROPIC,

    buildRequest(provider, request) {
      const { system, messages } = roleMessages(request);

      return {
        url: joinUrl(provider.baseUrl, 'messages'),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
          // Diperlukan agar Anthropic mengizinkan pemanggilan dari peramban.
          'anthropic-dangerous-direct-browser-access': 'true',
          ...provider.headers
        },
        body: {
          model: request.model || provider.model,
          system: system || undefined,
          messages: messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.text
          })),
          temperature: request.temperature ?? GENERATION_DEFAULTS.temperature,
          max_tokens: request.maxTokens ?? GENERATION_DEFAULTS.maxTokens
        }
      };
    },

    parseResponse(body) {
      const text = (body?.content ?? [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      return {
        text,
        finishReason: body?.stop_reason ?? null,
        truncated: body?.stop_reason === 'max_tokens'
      };
    },

    modelsRequest(provider) {
      return {
        url: joinUrl(provider.baseUrl, 'models'),
        method: 'GET',
        headers: {
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...provider.headers
        }
      };
    },

    parseModels(body) {
      const list = Array.isArray(body?.data) ? body.data : [];
      return list.map((model) => String(model?.id ?? '')).filter(Boolean);
    }
  };

  const ADAPTERS = {
    [PROVIDER_KIND.GEMINI]: gemini,
    [PROVIDER_KIND.OPENAI]: openai,
    [PROVIDER_KIND.ANTHROPIC]: anthropic
  };

  function adapterFor(provider) {
    const adapter = ADAPTERS[provider?.kind];
    if (!adapter) throw new Error(`Jenis penyedia tidak dikenal: ${provider?.kind}`);
    return adapter;
  }

  /**
   * Menormalkan penyedia menjadi bentuk baku dengan nilai bawaan yang aman.
   * Dipakai sebelum dipakai adapter maupun disimpan.
   */
  function normalize(provider = {}) {
    return {
      id: provider.id ?? crypto.randomUUID(),
      name: (provider.name ?? '').trim() || 'Penyedia',
      kind: provider.kind ?? PROVIDER_KIND.OPENAI,
      baseUrl: (provider.baseUrl ?? '').trim().replace(/\/+$/, ''),
      apiKey: provider.apiKey ?? '',
      model: (provider.model ?? '').trim(),
      models: Array.isArray(provider.models) ? provider.models : [],
      // Header tambahan opsional, misalnya untuk gateway yang butuh
      // header khusus. Selalu berupa objek datar string→string.
      headers:
        provider.headers && typeof provider.headers === 'object' ? { ...provider.headers } : {},
      keyOptional: Boolean(provider.keyOptional),
      local: Boolean(provider.local)
    };
  }

  /**
   * Memeriksa kelengkapan konfigurasi penyedia sebelum dipakai.
   * Mengembalikan { valid, message }.
   */
  function validate(provider) {
    const p = normalize(provider);

    if (!p.name) return { valid: false, message: 'Nama penyedia belum diisi.' };

    if (!/^https?:\/\/.+/i.test(p.baseUrl)) {
      return { valid: false, message: 'Alamat dasar harus berupa URL http atau https.' };
    }

    if (!p.model) return { valid: false, message: 'Model belum diisi.' };

    if (!p.apiKey && !p.keyOptional) {
      return { valid: false, message: 'Kunci API belum diisi.' };
    }

    if (!ADAPTERS[p.kind]) {
      return { valid: false, message: 'Jenis protokol tidak dikenal.' };
    }

    return { valid: true, message: 'Konfigurasi lengkap.' };
  }

  /** Pola HTTP dari alamat dasar, dipakai untuk permintaan izin host. */
  function originPattern(baseUrl) {
    try {
      const url = new URL(baseUrl);
      return `${url.protocol}//${url.host}/*`;
    } catch {
      return null;
    }
  }

  globalThis.XMTProviders = {
    adapterFor,
    normalize,
    validate,
    originPattern,
    joinUrl,
    KINDS: ADAPTERS
  };
})();
