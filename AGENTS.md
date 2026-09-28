# AGENTS.md

## Peran & Konteks Proyek
Web app akuntansi pribadi multi-workspace untuk freelance (fokus: F&B) berbasis akrual (SAK EMKM). Pengguna tunggal (single user) per workspace, mata uang IDR.

## Tech Stack & Arsitektur
- **Frontend & Deploy:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, Vercel.
- **Database & Auth:** Supabase (PostgreSQL, RLS berbasis `workspace_id` + `owner_id`).
- **Arsitektur Modular (Hexagonal/Ports & Adapters):**
  - `src/core/`: Domain, validasi, dan service inti (jurnal, periode, laporan) murni TypeScript. Dilarang import React/Supabase/Next.
  - `src/core/ports/`: Interface repository (kontrak data); **semua method wajib asynchronous (Promise)**.
  - `src/repositories/{mock,supabase}/`: Implementasi adapter repository.
  - `src/modules/<nama>/`: Modul fitur (komponen UI, service modul, tipe spesifik). Boleh import dari `src/core/`, `src/components/ui`, dan `src/lib/utils`. Dilarang import antar-modul dan dilarang import `src/lib/container.ts`.
  - `src/app/`: Routing & halaman (composition root). Hanya `src/app/` yang boleh import `src/lib/container.ts`; service diteruskan ke komponen modul lewat props.
  - `src/lib/container.ts`: Satu-satunya titik konfigurasi Dependency Injection (memilih mock atau Supabase).
  - `src/mocks/`: Data simulasi F&B dua tahun (termasuk akun Prive), seimbang, disertai fixture hasil laporan yang dihitung manual.
  - `supabase/migrations/`: Skrip skema DB, RLS, constraint, trigger, Postgres RPC.
- Model data jurnal & akun: lihat `docs/adr/011-journal-and-account-data-model.md`. PB1 & transaksi kredit: `docs/adr/012-pb1-and-credit-transactions.md`.
- Desain UI: ikuti `docs/DESIGN_SYSTEM.md`.

## Prinsip Akuntansi Inti
1. **Double-Entry & Single Source of Truth:** Semua transaksi (termasuk dari modul, saldo awal, penyesuaian, pembalik, penutup) wajib menghasilkan jurnal Debit/Kredit.
2. **Keseimbangan Debit = Kredit:** Wajib balance, divalidasi di `core/` dan database constraint/RPC. Minimal 2 baris; tiap baris hanya debit ATAU kredit, nilainya > 0.
3. **Atomic Journal Posting:** `postJournal(entry)` memvalidasi, memberi nomor, dan menyimpan header & lines dalam 1 transaksi atomik.
4. **Mata Uang & Angka:** `number` integer di TS (`Number.isSafeInteger`), `bigint` di DB (Rupiah utuh). **Dilarang float/double**.
5. **Laporan Dinamis:** Dihitung langsung dari jurnal posted dan akun, bukan tabel agregat tersimpan.
6. **Kategori Arus Kas:** **Semua akun** memiliki `cash_flow_category` (`operating`/`investing`/`financing`/`none`). Akun kas/bank ditandai `is_cash = true`. Aturan klasifikasi di ADR 010.
7. **Multi-Workspace & Template:** Semua tabel bisnis memiliki `workspace_id`. Kolom `currency` hanya di tabel `workspaces` (default `IDR`). `template_type` bersifat *immutable*.
8. **Tahun Buku & Penutupan:** Tahun buku = tahun kalender (Jan–Des). Penyesuaian (mis. stok opname) dan tutup buku dilakukan lewat jurnal (`source` = `adjustment`/`closing`), bukan dengan mengubah data lama.
9. **PB1 & Kredit:** PB1 yang dipungut dicatat sebagai utang (bukan pendapatan); tarif integer basis poin. Transaksi kredit memakai Piutang/Utang Usaha; pelunasan (`settlement_of`) boleh sebagian, tidak boleh melebihi sisa tagihan.
10. **Integritas & Audit:** Audit log untuk setiap mutasi jurnal, akun, dan periode. *Soft delete* (`deleted_at`) hanya untuk jurnal draft, akun tanpa mutasi, dan workspace. Service role key dilarang dipakai di client.

## Semantik CRUD & Periode
- **Jurnal Draft:** Boleh diedit dan dihapus. Tanggal draft bebas; validasi periode dilakukan saat posting.
- **Jurnal Posted:** Dilarang edit/hapus. **Immutable**. Hanya boleh **Void** (jurnal pembalik) atau **Koreksi** (jurnal pembalik + draft baru salinan jurnal asal). Jurnal pembalik (void/koreksi) memakai tanggal di periode open, bukan tanggal jurnal asli, dan ditautkan ke jurnal asal lewat `reversal_of`.
- **Status Void:** Tidak disimpan di jurnal asal; diturunkan dari adanya jurnal pembalik. Satu jurnal hanya boleh dibalik sekali; jurnal pembalik tidak dapat di-void. Jurnal kredit yang masih punya pelunasan aktif tidak dapat di-void.
- **Akun (CoA):** Akun yang sudah memiliki baris jurnal tidak boleh dihapus, hanya bisa dinonaktifkan (`is_active = false`). Akun nonaktif ditolak saat posting, kecuali oleh jurnal pembalik. CoA F&B menyertakan akun Prive (ekuitas). CoA awal di-seed dari template dan boleh diedit user setelahnya.
- **Validasi Periode:** Tanggal jurnal saat posting harus berada pada periode berstatus `open`. Periode `closed` atau tanggal tanpa periode ditolak. Periode `closed` boleh dibuka kembali dengan alasan yang tercatat di audit log.

## Konvensi Penamaan & UI
- **Bahasa Dokumen:** Bahasa Indonesia.
- **Kode/Variabel/Tabel:** Bahasa Inggris. Database menggunakan `snake_case`. TypeScript menggunakan `camelCase` (fungsi/variabel) dan `PascalCase` (tipe/komponen).
- **UI & Format:** UI berbahasa Indonesia, format angka mata uang `Rp 1.234.567` dan tanggal lokal (`id-ID`).
- **Fase 1:** Seluruh halaman/komponen yang mengakses repository adalah client component (localStorage hanya tersedia di browser).

## Aturan Agen & Workflow
1. Ikuti `docs/ROADMAP.md` berurutan dan **berhenti minta review** setelah tiap sub-fase.
2. **Fase 1 dilarang menyentuh Supabase** (murni UI dan mock data via interface).
3. **Wajib unit test** dengan Vitest untuk setiap perubahan logika akuntansi (`src/core/__tests__/`). Contract test repository di `src/repositories/__tests__/` dijalankan terhadap mock dan (Fase 2) Supabase.
4. Dilarang install dependency atau mengubah arsitektur tanpa konfirmasi user. Jangan mengarang aturan akuntansi; tanyakan bila ragu. Jangan commit `.env`.
5. Keputusan produk yang belum tercatat di ROADMAP/ADR harus ditanyakan ke user dulu, lalu dicatat (ADR atau Catatan Keputusan di ROADMAP).
6. Jangan pernah melaporkan hasil perintah/test yang tidak benar-benar dijalankan. Jika tidak bisa menjalankan terminal, katakan terus terang.

## Perintah
- `pnpm dev` : Menjalankan server development
- `pnpm test`: Menjalankan unit test dengan Vitest
- `pnpm lint`: Menjalankan linter ESLint
- `pnpm build`: Build aplikasi Next.js

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
