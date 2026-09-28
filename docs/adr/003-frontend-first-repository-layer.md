# ADR 003: Frontend-First dengan Repository Layer Pattern

## Konteks
Kebutuhan utama awal adalah memvalidasi alur kerja pengguna (UX/UI), bentuk formulir akuntansi, dan visualisasi laporan keuangan secara cepat tanpa terhambat oleh setup database dan migrasi backend yang berulang.

## Keputusan
1. Mengadopsi pendekatan **Frontend-First** menggunakan data tiruan (*mock data*) yang realistis (fokus awal: skenario bisnis F&B).
2. Memisahkan akses data menggunakan **Repository Pattern** (Ports & Adapters). Interface (`IWorkspaceRepository`, `IAccountRepository`, `IPeriodRepository`, `IJournalRepository`) berada di `src/core/ports/` dan seluruh method-nya asynchronous (Promise).
3. Service inti (jurnal, periode, laporan) berada di `src/core/` dan menerima repository lewat constructor. Service modul (mis. F&B) berada di `src/modules/<nama>/` dan hanya memakai service/port dari `src/core/`.
4. `src/lib/container.ts` adalah satu-satunya tempat yang merakit service dengan implementasi repository (mock atau Supabase).
5. `src/app/` adalah *composition root*: hanya lapisan ini yang boleh import `container.ts`. Komponen modul menerima service lewat props, sehingga modul tidak bergantung pada pilihan implementasi.
6. Implementasi awal `src/repositories/mock/` menyimpan data di `localStorage` (key bernamespace dan `schemaVersion`) agar data bertahan setelah reload. Implementasi ini nantinya digantikan oleh `src/repositories/supabase/` tanpa mengubah kode UI/Module.
7. Satu set **contract test** di `src/repositories/__tests__/` mendefinisikan perilaku wajib repository dan dijalankan terhadap setiap implementasi.

## Konsekuensi
### Positif:
- Siklus iterasi frontend dan feedback desain menjadi sangat cepat.
- Logika akuntansi dan kalkulasi laporan dapat diuji lebih awal secara terisolasi.
- Transisi ke Supabase menjadi terstruktur dan aman (*plug-and-play*), dibuktikan oleh contract test yang sama.

### Negatif:
- Perlu mendefinisikan interface repository secara matang dan presisi di awal.
- Perlu membuat data mock yang realistis dan konsisten secara akuntansi di `src/mocks/`, beserta hasil laporan yang dihitung manual.
- Meneruskan service lewat props menambah sedikit boilerplate di halaman `src/app/`.
