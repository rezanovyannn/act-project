# ROADMAP.md

Aturan umum agen: Kerjakan sub-fase secara berurutan, **berhenti dan minta review user setelah menyelesaikan setiap sub-fase** sebelum melanjutkan ke sub-fase berikutnya. Keputusan produk yang sudah dijawab user tercatat di bagian **Catatan Keputusan** (akhir dokumen).

---

## Prasyarat
- Git terinstall; folder proyek sudah `git init` dengan commit awal dokumen. Setiap sub-fase diakhiri commit agar review bisa lewat diff.
- Node.js dan pnpm tersedia.

---

## Fase 1: Frontend-First dengan Data Mock
*Dilarang menyentuh Supabase atau membuat koneksi jaringan DB di Fase 1. Seluruh data disuplai melalui mock repository yang persisten via localStorage. Semua halaman yang mengakses repository adalah client component. Pengguna disimulasikan dengan satu `owner_id` tetap.*

### Sub-fase 1A: Domain Core, Interfaces, Mock Repositories & Tests
- **Pekerjaan:**
  - Inisialisasi proyek Next.js + TypeScript + Tailwind + shadcn/ui + Vitest (daftar dependency dikonfirmasi user lebih dulu).
  - Tipe domain di `src/core/` sesuai ADR 011 (workspace, account, period, journal entry, journal line, `source`, `system_role`).
  - Validasi akuntansi: Debit = Kredit, minimal 2 baris, tiap baris hanya debit atau kredit > 0, safe integer, akun aktif, periode terbuka, aturan void/koreksi (ADR 009).
  - Service inti di `src/core/`: `saveDraft`, `deleteDraft`, `postJournal`, `voidJournal`, `correctJournal` (ADR 008 & 009).
  - Interface repository di `src/core/ports/` (semua method Promise).
  - Mock repository di `src/repositories/mock/` dengan `localStorage` (key bernamespace + `schemaVersion`, plus fungsi reset ke data seed).
  - `src/lib/container.ts` sebagai titik DI.
  - Dataset F&B di `src/mocks/` mencakup **dua tahun buku** (2025 dan 2026): jurnal saldo awal, penjualan (dengan PB1 di 2026), beban, pembelian bahan baku, stok opname, setoran modal, prive, pembelian aset, transfer kas-bank, penjualan & pembelian kredit beserta pelunasan (sebagian dan penuh), setoran PB1, dan satu contoh void/koreksi.
  - Fixture `src/mocks/fnb/expected-reports.ts`: hasil Neraca Saldo, Laba Rugi, Neraca, Perubahan Modal, dan Arus Kas per tahun **yang dihitung manual** sebagai acuan test.
  - Unit test di `src/core/__tests__/`; contract test repository di `src/repositories/__tests__/` (dijalankan terhadap mock).
- **Kriteria Selesai (Stop & Review):** Seluruh unit test engine akuntansi dan contract test mock repository lulus 100%; dataset mock seimbang.

### Sub-fase 1B: Workspace Management, Shell Layout & Jurnal Umum
- **Pekerjaan:**
  - Inisialisasi shadcn/ui (dependency dikonfirmasi user lebih dulu) dan penerapan `docs/DESIGN_SYSTEM.md` (token warna, font Inter, radius, tabel angka).
  - Layout aplikasi dasar (UI bahasa Indonesia, format mata uang Rp 1.234.567, angka negatif dalam kurung, tanggal lokal).
  - Halaman Daftar & Pembuatan Workspace: pilihan `template_type` (F&B) dan **tanggal mulai pembukuan**. Saat dibuat, otomatis menyemai CoA sesuai template dan periode bulanan `open` dari bulan mulai pembukuan sampai Desember tahun tersebut.
  - Workspace Switcher di header/sidebar.
  - Halaman Dashboard ringkasan metrik keuangan (termasuk penanda "HPP belum disesuaikan" bila belum ada stok opname pada periode berjalan, lihat ADR 007).
  - Halaman Jurnal Umum: list jurnal (filter status/sumber/tanggal, penanda "Di-void"), detail transaksi (tautan ke jurnal asal/pembalik), form input jurnal multi-baris (draft/posted), fitur **Void** (jurnal pembalik) dan **Koreksi** (pembalik + draft baru).
- **Kriteria Selesai (Stop & Review):** User dapat berpindah workspace, membuat draft jurnal, mem-posting jurnal, serta melakukan void/koreksi dengan data mock tersimpan di localStorage dan bertahan setelah reload.

### Sub-fase 1C: Buku Besar, Transaksi Pendapatan/Beban & Modul F&B
- **Pekerjaan:**
  - Halaman Buku Besar (General Ledger): filter per akun dan rentang tanggal dengan saldo awal, mutasi, dan saldo berjalan.
  - Pengaturan PB1 per workspace: tarif (basis poin, default 10%) dan mode harga termasuk/belum termasuk PB1 (ADR 012).
  - Halaman Input Cepat: Form Revenue (penjualan tunai/kredit, dengan PB1 otomatis) & Expense (operasional tunai/kredit) yang otomatis men-generate jurnal terkait (`source` = `revenue`/`expense`), termasuk nama pelanggan/pemasok untuk transaksi kredit.
  - Pelunasan: form penerimaan piutang dan pembayaran utang (sebagian atau penuh, `source = settlement`), form setoran PB1 (`source = tax_payment`), serta daftar piutang/utang yang belum lunas per pihak dan per transaksi (ADR 012).
  - Modul F&B (`src/modules/fnb/`): Form Pembelian Bahan Baku tunai/kredit (Dr Persediaan Bahan Baku, `source` = `purchase`) dan Form Stok Opname (menghitung selisih saldo buku vs nilai fisik ke HPP dua arah, `source` = `adjustment`, ADR 007).
- **Kriteria Selesai (Stop & Review):** Seluruh form input transaksi bisnis menghasilkan mutasi jurnal yang tepat dan tercermin di Buku Besar; perhitungan PB1 dan sisa piutang/utang teruji unit test; pelunasan melebihi sisa tagihan ditolak.

### Sub-fase 1D: Laporan Keuangan Formal
- **Pekerjaan:**
  - Mesin kalkulasi laporan dinamis di `src/core/` (hanya jurnal posted).
  - Halaman Neraca Saldo (Trial Balance) per tanggal.
  - Halaman Laporan Laba Rugi (Pendapatan - HPP - Beban = Laba Bersih).
  - Halaman Laporan Posisi Keuangan / Neraca (Aset = Liabilitas + Ekuitas; ekuitas memuat Laba Tahun Berjalan DAN akumulasi laba tahun-tahun sebelumnya yang belum ditutup, ADR 010).
  - Halaman Laporan Perubahan Modal / Ekuitas (Saldo Awal Ekuitas + Setoran Modal + Laba Bersih - Prive = Saldo Akhir).
  - Halaman Laporan Arus Kas metode langsung sesuai aturan ADR 010 (klasifikasi berdasarkan `cash_flow_category` akun non-kas dalam jurnal yang menyentuh kas; jurnal saldo awal dan transfer antar-kas bukan aktivitas).
  - Test menggunakan dataset dua tahun dan dibandingkan dengan fixture `expected-reports.ts`.
- **Kriteria Selesai (Stop & Review):** Invarian akuntansi terpenuhi pada laporan mock untuk kedua tahun:
  1. Total Debit = Total Kredit pada Neraca Saldo.
  2. Aset = Liabilitas + Ekuitas pada Neraca.
  3. Laba Bersih di Laba Rugi sinkron dengan Perubahan Modal & Ekuitas.
  4. Saldo kas awal + arus kas bersih = saldo akhir kas di Laporan Arus Kas, dan sama persis dengan saldo akun kas (`is_cash`) di Neraca.
  5. Seluruh angka sama dengan fixture yang dihitung manual.

### Sub-fase 1E: Pengaturan Akun, Periode & Saldo Awal
- **Pekerjaan:**
  - Halaman Chart of Accounts (CoA): tambah/edit akun (termasuk `cash_flow_category`, `is_cash`, `normal_balance`), hapus akun tanpa mutasi (soft delete), penonaktifan akun (`is_active = false`) bagi yang memiliki mutasi.
  - Halaman Periode Akuntansi: kunci periode, buka kembali periode `closed` (wajib alasan, tercatat di audit log mock, dengan peringatan), dan tambah periode untuk tahun buku berikutnya (12 periode bulanan). ADR 006.
  - Halaman Saldo Awal: form input saldo awal per akun neraca yang mengenerate satu jurnal pembukaan atomik (`source = opening_balance`) bertanggal awal pembukuan, dengan selisih ke akun Ekuitas Saldo Awal. Hanya satu jurnal saldo awal posted per workspace (perubahan lewat void lalu buat ulang).
- **Kriteria Selesai (Stop & Review):** Saldo awal berhasil diposting, akun ber-jurnal tidak dapat dihapus (hanya nonaktif), periode terkunci menolak posting jurnal baru, dan pembukaan kembali periode tercatat beserta alasannya.

---

## Fase 2: Autentikasi, Integrasi Supabase & Persistence Layer
*Keputusan arsitektur Supabase dicatat di ADR sebelum implementasi.*
- **Pekerjaan:**
  - ~~ADR: repository Supabase berjalan di browser dengan Anon Key + RLS aktif, atau via Server Actions.~~ Diputuskan: browser + Anon Key + RLS, penulisan jurnal hanya lewat RPC (ADR 013).
  - Autentikasi Supabase Auth dengan **email + kata sandi**: halaman daftar/login/logout, proteksi route, `owner_id` diambil dari user yang login.
  - Skema PostgreSQL di `supabase/migrations/` mencakup tabel `workspaces`, `accounts`, `periods`, `journal_entries`, `journal_lines`, `audit_logs`, kolom `deleted_at`, dan constraint dari ADR 011 sejak awal.
  - Index minimal: `journal_entries (workspace_id, entry_date)`, `journal_lines (workspace_id, account_id)`, `journal_entries (reversal_of)` unik.
  - Trigger Database untuk menolak UPDATE/DELETE pada jurnal berstatus posted beserta barisnya.
  - RPC `post_journal`: validasi Debit = Kredit, periode terbuka, akun aktif, penomoran, dalam satu transaksi.
  - Trigger Database otomatis pengisi `audit_logs` (viewer UI di Fase 3).
  - RLS Policies berbasis `workspace_id` dan `owner_id`.
  - Implementasi `src/repositories/supabase/` yang mengimplementasikan port interface.
  - Contract test **yang sama** (`src/repositories/__tests__/`) dijalankan terhadap mock dan **proyek Supabase dev** (online, terpisah dari production), ditambah test RLS dua user (User B tidak bisa membaca/menulis data User A).
- **Kriteria Selesai (Stop & Review):** UI berjalan tanpa perubahan kode komponen setelah repository ditukar ke Supabase (proyek dev); contract test lulus di kedua implementasi; terverifikasi aman dengan RLS.
- **Catatan optimasi (bukan pekerjaan fase ini):** Jika laporan melambat pada volume besar, evaluasi index tambahan atau fungsi agregasi di database. Tidak menggunakan tabel agregat tersimpan.

---

## Fase 3: Tutup Buku, Ekspor & Hardening
- **Pekerjaan:**
  - UI dan logika Tutup Buku Akhir Tahun (ADR 014): jurnal penutup lewat Ikhtisar Laba Rugi ke Laba Ditahan, Prive ke Laba Ditahan, kunci periode otomatis, batalkan tutup buku sebagai paket. Laporan Laba Rugi mengecualikan jurnal penutup dan pembaliknya.
  - Ekspor/Cetak Laporan Keuangan ke format PDF/Print-friendly view. Tombol "Cetak / Simpan PDF" (laporan aktif) dan "Cetak semua laporan" (lima laporan, masing-masing halaman baru, A4) memakai dialog cetak browser.
  - Backup data workspace (ekspor JSON/CSV): JSON lengkap (`act-project/workspace-backup` versi 1: workspace, akun, periode, jurnal + baris, audit log, ringkasan jumlah) dan CSV satu baris per baris jurnal (BOM UTF-8, nominal integer). Logika di `src/core/backup.ts`; menu Pengaturan → Backup.
  - Audit log UI viewer untuk melacak riwayat mutasi jurnal, akun, dan periode (menu Riwayat Audit, filter jenis data; snapshot DB snake_case dan mock camelCase dinormalkan di `src/core/audit.ts`).
- **Kriteria Selesai (Stop & Review):** Laporan dapat diekspor rapi, tutup buku menghasilkan jurnal penutup yang valid (laporan tetap memenuhi kelima invarian 1D), dan sistem stabil.

---

## Fase 4 (Opsional): Validasi Modularitas Multi-Template
Dipecah menjadi tiga sub-fase (ADR 015); stop & review setelah tiap sub-fase.

### Sub-fase 4A: Template Retail & Modularitas
- **Pekerjaan:**
  - Menambahkan template kedua: `retail` (CoA barang dagang termasuk Retur & Potongan Penjualan, Beban Angkut Pembelian, Beban Kemasan).
  - Memastikan registrasi template baru tidak mengubah core engine accounting: persediaan periodik (ADR 007) dipindah ke `src/core/inventory.ts` dengan peran akun umum `inventory`; UI persediaan menjadi modul `inventory` yang istilahnya mengikuti template.
  - Label pajak penjualan per workspace (PB1/PPN) dengan pengaturan awal dari template.
  - Pengaturan → Daftar Akun: "Tambah dari template" untuk akun template yang belum ada/pernah dihapus.
- **Kriteria Selesai (Stop & Review):** Workspace Retail berhasil dibuat dengan modul dan CoA yang terisolasi dari F&B.

### Sub-fase 4B: Mode PPN Lengkap
- **Pekerjaan:** Pilihan mode pajak di Pengaturan (generik PB1/PPN atau PPN lengkap): PPN Keluaran pada penjualan, PPN Masukan pada pembelian, setoran = selisihnya. Berlaku untuk semua template, dapat diubah kapan saja. Aturan akuntansi rinci (tarif/DPP, lebih bayar, transisi mode) ditanyakan ke user sebelum dikerjakan lalu dicatat di ADR.
- **Kriteria Selesai (Stop & Review):** Transaksi PPN lengkap menghasilkan jurnal yang benar dan teruji unit test; laporan tetap memenuhi invarian 1D.

### Sub-fase 4C: Persediaan Perpetual per Barang
- **Pekerjaan:** Pilihan metode persediaan di Pengaturan (periodik atau perpetual): daftar barang, mutasi stok yang terikat jurnal, HPP per penjualan. Berlaku untuk semua template, dapat diubah kapan saja. Aturan akuntansi rinci (metode biaya, satuan, stok negatif, retur, stok opname, transisi metode) ditanyakan ke user sebelum dikerjakan lalu dicatat di ADR.
- **Kriteria Selesai (Stop & Review):** Saldo persediaan per barang sama dengan saldo akun persediaan di Buku Besar; HPP tercatat per penjualan dan teruji unit test.

---

## Catatan Keputusan (dijawab user, 28 September 2026)
| # | Pertanyaan | Keputusan | Rujukan |
|---|---|---|---|
| 1 | Pajak pada transaksi F&B | PB1 dicatat (utang PB1, bukan pendapatan) | ADR 012 |
| 2 | Transaksi kredit | Didukung beserta pelunasan (sebagian/penuh) | ADR 012 |
| 3 | Membuka kembali periode `closed` | Boleh, wajib alasan + audit log | ADR 006 |
| 4 | Referensi desain gaya Pinterest | Dipakai sebagai inspirasi design system | docs/DESIGN_SYSTEM.md |
| 5 | Tempat repository Supabase berjalan | Browser + Anon Key + RLS; Supabase region Singapura | ADR 013 |
| 6 | Lingkungan test Supabase (Docker tidak bisa berjalan di laptop) | Proyek Supabase online khusus dev menggantikan Supabase lokal; Supabase lokal via Docker boleh ditambahkan kelak | ADR 013 |
| 7 | Metode login | Email + kata sandi (Supabase Auth) | ADR 013 |
| 8 | Prive saat tutup buku | Ditutup ke Laba Ditahan | ADR 014 |
| 9 | Cara penutupan akun nominal | Lewat akun Ikhtisar Laba Rugi | ADR 014 |
| 10 | Periode setelah tutup buku | Seluruh periode tahun itu dikunci otomatis | ADR 014 |
| 11 | Ekspor laporan PDF | Tampilan cetak + fitur cetak/simpan PDF browser (tanpa dependency) | ROADMAP Fase 3 |
| 12 | Urutan Fase 4 | Dipecah 4A (Retail & modularitas) → 4B (PPN lengkap) → 4C (persediaan perpetual) | ADR 015 |
| 13 | Metode persediaan & mode pajak | Dipilih di Pengaturan per workspace, untuk semua template, dapat diubah kapan saja | ADR 015 |
| 14 | Pajak penjualan Retail | Label generik PB1/PPN (4A, default Retail PPN 0%) dan mode PPN lengkap (4B) | ADR 015 |
| 15 | Akun tambahan CoA Retail | Retur & Potongan Penjualan, Beban Angkut Pembelian, Beban Kemasan; akun template dapat ditambahkan dari Pengaturan | ADR 015 |
| 16 | Tata letak kode persediaan | Logika umum di `src/core/inventory.ts`, UI modul `inventory` | ADR 015 |
