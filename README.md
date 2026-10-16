# X Mentari

Ekstensi browser Chrome (Manifest V3) untuk portal e-learning MENTARI dan MY UNPAM Universitas Pamulang.

Versi: **2.2.0**

---

## Fitur Utama

| Fitur | Portal | Status Bawaan | Deskripsi |
|---|---|---|---|
| **Forum Tracker** | MENTARI | Aktif | Pelacak forum diskusi yang belum diselesaikan per mata kuliah. |
| **Notifikasi Dosen** | MENTARI | Aktif | Ringkasan dan notifikasi balasan dosen di forum. |
| **Asisten AI** | MENTARI | Aktif | Panel percakapan interaktif dengan riwayat obrolan dan dukungan multi-penyedia. |
| **Bantuan Diskusi** | MENTARI | Aktif | Generator draf jawaban diskusi dengan rujukan materi forum. |
| **Analisis Kuis** | MENTARI | Nonaktif | Rekomendasi jawaban kuis berbasis AI beserta tingkat keyakinan (*confidence rate*). |
| **Pengerjaan Kuis Otomatis** | MENTARI | Nonaktif | Menjawab dan menyelesaikan kuis secara otomatis. Memerlukan konfirmasi risiko eksplisit dan pengaktifan manual di pengaturan. |
| **Rekap Presensi** | MY UNPAM | Aktif | Rekapitulasi persentase kehadiran per mata kuliah beserta indikator status. |
| **Bantuan Kuesioner** | Keduanya | Nonaktif | Bantuan penandaan pilihan evaluasi/kuesioner dosen secara terkontrol. |
| **Bantuan Sandi Login** | Keduanya | Nonaktif | Tombol bantuan pengisian kredensial login tanpa submit otomatis. |

> **Catatan Keamanan:** Fitur yang berinteraksi langsung dengan penilaian atau formulir akademik dinonaktifkan secara bawaan dan memerlukan persetujuan eksplisit sebelum digunakan.

---

## Dukungan Penyedia AI

X Mentari mendukung berbagai penyedia model bahasa besar (LLM). Konfigurasi dapat diganti kapan saja melalui menu opsi:

| Protokol | Layanan yang Didukung | Format Autentikasi |
|---|---|---|
| **Gemini** | Google Gemini API | `x-goog-api-key` |
| **OpenAI Compatible** | OpenAI, Groq, OpenRouter, DeepSeek, Mistral, Ollama, LM Studio, endpoint kustom | `Authorization: Bearer <key>` |
| **Anthropic** | Anthropic Claude API | `x-api-key` |

Penyedia lokal seperti **Ollama** atau **LM Studio** dapat digunakan tanpa kunci API.

---

## Prinsip Desain & Arsitektur

1. **Isolasi Kunci API:** Kunci API disimpan di `chrome.storage.local` dan hanya diakses oleh background service worker. Skrip halaman kampus tidak memiliki akses ke kunci API.
2. **Manipulasi DOM Aman:** Seluruh rendering elemen antarmuka menggunakan helper `XMTDom.el` dengan sanitasi teks melalui `textContent`, mencegah injeksi XSS.
3. **Transport Terpisah:** Modul penyedia (`providers.js`) bersifat murni (*pure function*) untuk pembuatan payload dan parsing respons, terpisah dari logika jaringan.
4. **Observer Terpusat:** Integrasi SPA memakai satu `MutationObserver` terpusat dengan mekanisme debounce untuk efisiensi resource browser.
5. **Konkurensi Terkontrol:** Pemanggilan API kampus dibatasi melalui `mapLimit` untuk mencegah pembebanan berlebih pada server kampus.

---

## Pemasangan

1. Buka `chrome://extensions/` di Google Chrome atau browser berbasis Chromium.
2. Aktifkan **Developer mode** di sudut kanan atas.
3. Klik **Load unpacked** dan pilih direktori repositori ini.
4. Buka halaman pengaturan ekstensi (**Options**) untuk mengatur penyedia dan kunci API AI Anda.

---

## Perintah Pengembangan

Ekstensi dilengkapi dengan pengujian otomatis dan linter:

```bash
# Menjalankan seluruh verifikasi (manifest check, linter, unit test, smoke test)
npm run verify

# Menjalankan unit test logika inti (61 tes)
npm test

# Menjalankan validasi manifest
npm run check:manifest

# Menjalankan linter
npm run lint

# Menjalankan smoke test (DOM simulation dengan JSDOM)
npm run smoke

# Membangun arsip rilis (.zip) ke direktori dist/
npm run zip
```
