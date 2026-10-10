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
- **Pekerjaan (ADR 016):** Tab Pengaturan → Pajak: mode sederhana (PB1/PPN) atau PPN lengkap dengan DPP pecahan (awal 11/12 × 12%). PPN Keluaran pada penjualan, PPN Masukan pada beban & pembelian persediaan (dihitung, bisa dikoreksi), setoran per masa otomatis dari saldo (lebih bayar dikompensasikan). Ganti mode: berlaku ke depan saja atau jurnal transisi (saldo PPN Masukan dibebankan).
- **Kriteria Selesai (Stop & Review):** Transaksi PPN lengkap menghasilkan jurnal yang benar dan teruji unit test; laporan tetap memenuhi invarian 1D.

### Sub-fase 4C: Persediaan Perpetual per Barang
- **Pekerjaan (ADR 017):** Pengaturan → Persediaan: metode periodik/perpetual dan metode biaya rata-rata/FIFO. Daftar Barang & kartu stok; qty barang tersimpan di baris jurnal Persediaan. Form perpetual: pembelian, penjualan barang, pemakaian barang, stok opname per barang, retur penjualan/pembelian. Peralihan periodik → perpetual lewat stok opname awal per barang.
- **Kriteria Selesai (Stop & Review):** Saldo persediaan per barang sama dengan saldo akun persediaan di Buku Besar; HPP tercatat per penjualan dan teruji unit test.

---

## Fase 5: Deploy Production (ADR 018)
- **Pekerjaan:**
  - Pengaman konfigurasi production (tanpa kunci Supabase tidak jatuh ke data contoh) dan saklar penutup pendaftaran `NEXT_PUBLIC_ALLOW_SIGNUP`.
  - Repository GitHub privat → import ke Vercel (subdomain `vercel.app`).
  - Proyek Supabase production (Singapura), migrasi lewat `pnpm db:prod db push`.
  - Environment variable Vercel: URL & anon key production; Supabase Auth URL Configuration ke alamat production.
  - Akun pemilik dibuat, lalu pendaftaran ditutup (Supabase + `NEXT_PUBLIC_ALLOW_SIGNUP=false`).
- **Kriteria Selesai (Stop & Review):** Aplikasi production dapat diakses, pemilik bisa login dan data tersimpan di Supabase production, halaman Daftar tertutup, dan uji asap (buat workspace, posting jurnal, laporan) berhasil.

---

## Fase 6: Stok Opname Sisa Bahan, COGS & Variance (ADR 020)
Satu menu sidebar **Stok Opname & COGS** berisi dua tab. Untuk metode persediaan periodik; workspace perpetual tetap memakai stok opname per barang (ADR 017). Workspace periodik yang belum punya bahan aktif tetap memakai stok opname nilai rupiah.

### Sub-fase 6A: Stok Opname Sisa Bahan & Tabel COGS
- **Pekerjaan:**
  - Kategori/section bebas per bahan di Daftar Barang.
  - Pengaturan dasar nilai stok per workspace: harga beli terakhir atau rata-rata.
  - Pembelian bahan baku per bahan (qty & harga).
  - Stok opname = input qty **sisa** per bahan, dikelompokkan per section; nilai = qty × harga sesuai pengaturan; jurnal penyesuaian HPP otomatis.
  - Template & import/export CSV dan Excel (.xlsx, ExcelJS).
  - Tab COGS: Nama Bahan | Stok Awal | Pembelian | Stok Akhir | COGS (COGS = Stok Awal + Pembelian − Stok Akhir).
- **Kriteria Selesai (Stop & Review):** Total COGS tabel = HPP penyesuaian di jurnal; import/export bolak-balik tanpa kehilangan data; unit test perhitungan.

### Sub-fase 6B: Resep & Variance Theoretical vs Actual
- **Pekerjaan (ADR 021):** menu & resep berversi (bahan per N porsi, tanggal berlaku); porsi terjual dari rekap per periode (input/import) dan dari form penjualan per menu; analisa variance per bahan: theoretical (porsi × resep × harga) vs actual (COGS stok opname).
- **Kriteria Selesai (Stop & Review):** Variance per bahan & total terhitung benar dan teruji unit test.

---

## Fase 7: Faktur Penjualan & Pembelian (ADR 022)
Faktur untuk tukar faktur di semua template. Faktur adalah input transaksi: draft → terbit (jurnal kredit), dicetak lewat print browser (PDF).

### Sub-fase 7A: Profil Usaha, Kontak & Faktur Penjualan
- **Pekerjaan:** Pengaturan → Profil Usaha (identitas, rekening, logo, prefix nomor); Daftar Kontak (pelanggan/pemasok, termin); faktur penjualan draft/terbit dengan baris bebas atau barang, pajak sesuai pengaturan, nomor INV/tahun/bulan/urut; status pembayaran dari Piutang; batalkan (void) & salin ke draft; cetak A4.
- **Kriteria Selesai (Stop & Review):** Jurnal faktur terbit benar (termasuk pajak & HPP perpetual), nomor berurutan & unik, status pembayaran mengikuti pelunasan, cetak rapi; teruji unit, contract (mock & Supabase), dan E2E.

### Sub-fase 7B: Faktur Pembelian
- **Pekerjaan:** faktur pembelian dengan nomor faktur pemasok, baris bebas/barang (pembelian per bahan/stok), pajak masukan, terbit = jurnal utang; status pembayaran dari Utang; cetak.
- **Kriteria Selesai (Stop & Review):** Jurnal & stok/COGS benar, teruji unit, contract, dan E2E.

---

## Fase 8: Pulihkan Backup, Diskon Faktur & Laporan per Menu

### Sub-fase 8A: Pulihkan dari Backup (ADR 023)
- **Pekerjaan:** validasi file backup JSON di browser; pulihkan ke workspace baru secara atomik dengan isi persis (nomor jurnal, status periode, tutup buku, faktur, stok opname, menu); riwayat audit lama ikut + catatan pemulihan.
- **Kriteria Selesai (Stop & Review):** laporan workspace pulihan identik dengan sumber; backup rusak ditolak tanpa menulis data; teruji unit, contract (mock & Supabase), dan E2E.

### Sub-fase 8B: Diskon di Faktur
- **Pekerjaan:** diskon per faktur (% atau Rp); pajak dihitung setelah diskon; penjualan → akun kontra Potongan Penjualan, pembelian → mengurangi harga pokok/beban.
- **Kriteria Selesai (Stop & Review):** jurnal & dokumen faktur benar, teruji unit, contract, dan E2E.

### Sub-fase 8C: Laporan per Menu
- **Pekerjaan:** tab laporan per menu di Laporan Keuangan: porsi, pendapatan, biaya bahan (resep × harga akhir periode), margin; urut paling laku/paling untung; ekspor CSV.
- **Kriteria Selesai (Stop & Review):** angka per menu teruji unit test dan E2E.

---

## Fase 9: Progressive Web App (PWA)
Aplikasi dapat dipasang (install) di desktop (Chrome/Edge) dan HP (Android; iPhone lewat Safari → "Tambahkan ke Layar Utama"), terbuka seperti aplikasi tersendiri tanpa bilah alamat.

### Sub-fase 9A: Installable App
- **Pekerjaan:** web app manifest (`src/app/manifest.ts`: nama, ikon 192/512 + maskable + ikon Apple, warna tema, `display: standalone`, start URL ke Workspace Saya); service worker manual `public/sw.js` (halaman selalu dari jaringan dengan cadangan `public/offline.html`, aset statis Next & ikon cache-first, data/Supabase tidak pernah di-cache; didaftarkan hanya di build production); banner "Anda sedang offline" di dalam aplikasi; layar offline memuat ulang otomatis begitu server terjangkau lagi; tombol "Pasang aplikasi" di sidebar workspace & Workspace Saya (prompt bawaan Android/desktop, petunjuk manual iPhone/iPad, tersembunyi bila sudah terpasang); header keamanan (`nosniff`, `X-Frame-Options`, `Referrer-Policy`) & header khusus `sw.js`; padding *safe area* HP.
- **Kriteria Selesai (Stop & Review):** lolos pemeriksaan installability Chrome (Lighthouse PWA), terpasang & terbuka standalone di desktop dan Android; iPhone diuji lewat Safari; data tetap dari Supabase (tidak ada data akuntansi yang disimpan offline).

### Keputusan (dijawab user, 8 Oktober 2026 — Catatan Keputusan 70–73)
1. **Offline:** layar "Anda sedang offline" + coba lagi; shell aplikasi tetap terbuka cepat, tidak ada data akuntansi yang disimpan/diinput offline.
2. **Nama & ikon:** "Pembukuan" dengan logo aplikasi saat ini (dibuat ukuran ikon yang dibutuhkan, termasuk ikon iPhone & maskable Android).
3. **Notifikasi push:** tidak di Fase 9; dikerjakan terpisah bersama pengingat pajak (Fase 11).
4. **Service worker:** ditulis manual tanpa library baru.

---

## Fase 10: Template Katering (ADR 024)
Template ketiga `catering` untuk usaha katering: acara (nikahan, syukuran), nasi box/kantor, dan langganan harian. F&B dan Retail ditahan dulu (tidak ada fitur baru) selama fase ini (user, 10 Oktober 2026). Engine jurnal, laporan, persediaan, faktur, kontak, pajak penjualan, PWA, dan backup dipakai ulang.

**Catatan pajak (riset):** jasa boga/katering bukan objek PPN (UU PPN Pasal 4A; kriteria PMK 70/2022). Yang berlaku adalah PBJT makanan & minuman (UU HKPD, tarif per daerah, maksimal 10%), sama mekanismenya dengan PB1 (ADR 012). Pelanggan badan dapat memotong PPh 23 sebesar 2% kecuali penyedia menyerahkan Suket PP 55/2022.

### Sub-fase 10A: Template, Pesanan, DP, Quotation & Invoice (selesai, menunggu review)
- **Terealisasi:** template `catering` (CoA dengan Uang Muka Pelanggan, Utang PBJT, Pendapatan Pembatalan; PBJT 0%); menu **Pesanan** dengan tab Pesanan, Kalender, Tagihan, dan Per Klien; penawaran bernomor QUO/SPH yang dapat dicetak; invoice DP `INV-DP/…`; terima DP/pelunasan/pengembalian dengan rekening dipilih setiap kali; selesaikan pesanan (faktur pelunasan + DP dipakai otomatis, atomik); batalkan pesanan sesuai kebijakan (kembali/hangus); kebijakan pembatalan default per kontak; opsi PPh 23 tampil nonaktif di Pengaturan → Pajak; tag pesanan di baris jurnal; backup & pulihkan menyertakan pesanan dan invoice DP.
- **Pekerjaan:**
  - **Template & CoA Katering:** Kas, Bank, Persediaan Bahan, Piutang Usaha, Uang Muka Pelanggan (utang), PPh 23 Dibayar Dimuka, Peralatan Katering + Akumulasi Penyusutan, Utang Usaha, Utang PBJT, Pendapatan Katering, Pendapatan Lain (ongkir/sewa alat), Pendapatan Pembatalan, HPP Bahan, Beban Tenaga Lepas, Beban Sewa Alat, Beban Transport/Pengiriman, Beban Kemasan, beban umum, Prive & ekuitas standar.
  - **Pengaturan pajak:** PBJT tersedia tetapi nonaktif (belum memungut; tarif dapat diisi kelak). PPh 23 dipotong pelanggan tersedia sebagai opsi pengaturan (nonaktif dulu).
  - **Pesanan/Acara:** pelanggan (kontak), jenis (acara / nasi box / langganan), tanggal & jam acara, lokasi, jumlah pax, baris menu/paket × harga, biaya tambahan, catatan. Status: Penawaran → Dikonfirmasi → Selesai → Lunas, atau Dibatalkan. Ada kalender pesanan.
  - **Quotation:** dokumen penawaran yang dapat dicetak/PDF dengan masa berlaku. Bila diterima, menjadi pesanan.
  - **Invoice ke klien:** tagihan DP dan tagihan pelunasan yang dapat dicetak, memakai profil usaha & faktur penjualan (ADR 022).
  - **DP & pengakuan pendapatan (akrual):** DP diterima → Kas pada Uang Muka Pelanggan. Pendapatan diakui saat acara/pengiriman (Uang Muka + Piutang pada Pendapatan [+ PBJT]). Pelunasan memakai mekanisme pelunasan yang sudah ada.
  - **Daftar DP & sisa tagihan per klien:** total pesanan, DP diterima, sisa yang belum dibayar, jatuh tempo, dan pesanan mendatang yang sudah ber-DP.
  - **Pembatalan:** kebijakan dipilih per klien (default di kontak) dan dapat diubah per pesanan: DP dikembalikan penuh, hangus sebagian (%), atau hangus seluruhnya. Bagian yang hangus diakui sebagai Pendapatan Pembatalan.
- **Kriteria Selesai (Stop & Review):** jurnal DP, pengakuan pendapatan, pelunasan, dan pembatalan benar serta seimbang; daftar DP & sisa tagihan cocok dengan Neraca (Uang Muka Pelanggan, Piutang); quotation & invoice tercetak rapi; teruji unit, contract (mock & Supabase), dan E2E.

### Sub-fase 10B: Biaya & Laba per Pesanan (selesai, menunggu review)
- **Terealisasi:** tombol **Catat biaya** di halaman pesanan (bahan baku langsung ke HPP Bahan Baku; tenaga lepas, sewa alat, transport, kemasan, lain-lain ke akun bebannya; dibayar dari rekening pilihan atau kredit ke pemasok); pilihan **Pesanan (opsional)** di Input Transaksi → Beban operasional; estimasi biaya per kategori di form pesanan; panel **Biaya & laba kotor** (estimasi vs realisasi, margin, per pax) dan tab **Laba** di halaman Pesanan; mode biaya rinci / bahan baku saja di Pengaturan → Persediaan; **PPh 23 dipotong pelanggan** (aktif/nonaktif + tarif, default 2%) di Pengaturan → Pajak, dipakai saat terima pelunasan (Kas + PPh 23 Dibayar Dimuka / Piutang).
- **Pekerjaan:** biaya ditandai ke pesanan. Mode biaya dapat dipilih di pengaturan: **detail** (bahan, tenaga lepas, sewa alat, transport, kemasan, lain-lain) atau **bahan baku saja**. Laporan laba kotor per pesanan & per pax, estimasi (saat penawaran) vs realisasi. Pencatatan PPh 23 dipotong pelanggan saat pelunasan bila opsi pengaturan diaktifkan.
- **Kriteria Selesai (Stop & Review):** angka laba per pesanan teruji unit & E2E dan totalnya cocok dengan Laba Rugi.

### Sub-fase 10C: Paket Menu per Pax & Daftar Belanja (selesai, menunggu review)
- **Terealisasi:** halaman **Paket Menu** khusus katering (kode, nama, isi paket, harga per pax, akun pendapatan, resep bahan untuk N pax, biaya bahan & margin per pax); **harga perkiraan** bahan di Daftar Barang (Rp per jumlah satuan); harga bahan = pembelian terakhir lewat Pembelian Bahan Baku, bila belum ada harga perkiraan; baris pesanan bisa memilih paket (keterangan, qty = pax, harga per pax terisi); estimasi bahan baku otomatis dari resep × pax (bisa diubah, ada tautan kembali ke hitungan resep); tab **Belanja** di halaman Pesanan: kebutuhan bahan gabungan pesanan dikonfirmasi per rentang tanggal acara, dibulatkan ke atas, perkiraan biaya, rincian per pesanan, cetak, CSV, Excel.
- **Pekerjaan:** paket menu dengan resep per pax (memakai ulang Menu & Resep, ADR 021); daftar belanja bahan per tanggal dari pesanan yang dikonfirmasi (beberapa pesanan dalam satu hari digabung); estimasi biaya bahan di quotation.
- **Kriteria Selesai (Stop & Review):** kebutuhan bahan = resep × pax teruji unit; daftar belanja dapat dicetak/diekspor.

### Sub-fase 10D: Katering Langganan & Sewa Alat
- **Pekerjaan:** kontrak langganan bulanan (porsi harian, harga per porsi), dengan draft invoice otomatis akhir bulan; sewa/peminjaman alat ke klien beserta deposit jaminan (utang sampai dikembalikan).
- **Kriteria Selesai (Stop & Review):** tagihan langganan & jurnal jaminan benar; teruji unit dan E2E.

### Keputusan (dijawab user, 10 Oktober 2026 — Catatan Keputusan 74–81)
1. **Jenis katering:** semuanya (acara, nasi box/kantor, langganan).
2. **Pendapatan:** diakui saat acara/pengiriman; DP sebagai utang (Uang Muka Pelanggan) sampai saat itu; disertai daftar DP & sisa pembayaran klien.
3. **Pembatalan:** opsi dipilih per klien karena bisa berbeda-beda.
4. **PPh 23:** dicantumkan dulu sebagai pengaturan untuk ke depannya.
5. **Biaya per pesanan:** boleh detail, dengan opsi hanya bahan baku.
6. **PBJT:** belum memungut; tetap tersedia di pengaturan.
7. **Urutan:** 10A → 10B → 10C → 10D.
8. **Dokumen:** Quotation dan Invoice ke klien.

### Keputusan lanjutan (dijawab user, 10 Oktober 2026 — Catatan Keputusan 82–85)
1. **Nomor quotation:** tersedia dua pilihan prefix di Profil Usaha, `QUO` (Quotation) atau `SPH` (Surat Penawaran Harga), dengan pola `PREFIX/2026/10/0001`.
2. **Invoice & jurnal otomatis:** user tidak membuat jurnal manual. Semua tagihan pesanan tampil di satu **daftar tagihan** (status: belum dibayar, sebagian, lunas), dan aksi di daftar itu membuat jurnal otomatis:
   - invoice DP diterbitkan → dokumen tagihan saja (tanpa jurnal);
   - DP dibayar → Kas/Bank pada Uang Muka Pelanggan;
   - acara selesai / invoice pelunasan diterbitkan → Uang Muka + Piutang pada Pendapatan;
   - pelunasan dibayar → Kas/Bank pada Piutang.

   Setiap penerimaan (DP maupun pelunasan) dan pengembalian DP memilih **akun kas/bank tujuan** (semua akun aktif `is_cash`, mis. Kas, Bank BCA, Bank Mandiri). Rekening **dipilih setiap kali** (tidak ada default otomatis dari pilihan terakhir), karena rekening yang dipakai bisa berubah-ubah.
3. **Penandaan biaya ke pesanan (10B):** kolom opsional pada baris jurnal (mis. `order_id`) disetujui; dicatat di ADR baru (mengubah ADR 011).

## Fase 11 (Rencana): Pajak UMKM
- **PPh Final 0,5% (PP 55/2022):** omzet bruto per bulan dari jurnal pendapatan, PPh terutang 0,5%, pengingat setor (tanggal 15 bulan berikutnya), pemantauan batas omzet bebas pajak Rp 500 juta/tahun untuk WP orang pribadi, dan jurnal pembayaran PPh Final.
- **Rekap setoran PB1 bulanan:** pajak dipungut vs disetor per periode, siap untuk pelaporan ke Bapenda.
- **Perlu keputusan:** WP orang pribadi atau badan (batas Rp 500 juta hanya untuk orang pribadi), PPh Final dicatat sebagai beban atau prive, masa berlaku tarif (batas tahun pemakaian PP 55/2022).

## Fase 12 (Rencana): Operasional Harian di HP
- **Foto nota/bukti transaksi** dilampirkan ke jurnal, faktur, dan pembelian (kamera HP lewat PWA). Butuh penyimpanan file (Supabase Storage) dan kebijakan akses per pemilik.
- **Transaksi berulang:** templat sewa, gaji, langganan; dibuat otomatis sebagai draft setiap periode untuk ditinjau lalu diposting.
- **Perlu keputusan:** batas ukuran/jenis file, kompresi foto, transaksi berulang dibuat saat aplikasi dibuka atau terjadwal di server.

## Fase 13 (Rencana): Keamanan & Data
- **Verifikasi 2 langkah (2FA, TOTP)** dengan aplikasi autentikator (Supabase MFA), kode pemulihan.
- **Backup otomatis terjadwal** (mis. mingguan) ke email atau Google Drive, memakai format backup yang sudah bisa dipulihkan (ADR 023).
- **Ganti kata sandi dari Pengaturan** dan riwayat login.
- **Perlu keputusan:** tujuan backup otomatis, frekuensi, 2FA wajib atau opsional.

## Fase 14 (Rencana): Laporan Lanjutan
- **Perbandingan periode** (bulan ini vs bulan lalu / tahun lalu) di Laba Rugi dan Dashboard.
- **Laporan umur piutang/utang (aging)** 0–30, 31–60, 61–90, > 90 hari.
- **Ekspor Excel** untuk semua laporan keuangan.

## Backlog Ide (belum dijadwalkan)
- Status tukar faktur & daftar jatuh tempo; kirim faktur lewat tautan/WhatsApp.
- Rekonsiliasi bank (impor mutasi CSV); pencatatan susut/waste bahan.
- Anggaran vs realisasi; tren harga bahan & penjualan per menu.
- Impor laporan POS (Moka, Majoo, ESB) ke Rekap Porsi; penjualan GoFood/GrabFood (bruto, komisi, dana cair).
- Multi-outlet (transfer bahan antar workspace, laporan gabungan).
- Multi-pengguna/staf dengan peran terbatas (perubahan arsitektur besar, butuh ADR & RLS baru).
- CI (tes otomatis di GitHub setiap push), optimasi performa data besar, mode gelap.

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
| 17 | DPP PPN | Diatur di Pengaturan (pecahan), awal 11/12 × tarif 12% | ADR 016 |
| 18 | Lebih bayar PPN | Dikompensasikan ke masa berikutnya | ADR 016 |
| 19 | Cakupan PPN Masukan | Semua pembelian & beban; nominal dihitung, bisa dikoreksi sesuai faktur | ADR 016 |
| 20 | Ganti mode pajak | Pilihan di Pengaturan: berlaku ke depan saja, atau jurnal transisi yang membebankan saldo PPN Masukan | ADR 016 |
| 21 | Setoran PPN | Otomatis dari saldo per akhir masa, bisa dikoreksi | ADR 016 |
| 22 | Metode biaya perpetual | Rata-rata tertimbang bergerak dan FIFO, dipilih di Pengaturan | ADR 017 |
| 23 | Satuan barang | Bilangan bulat satuan dasar | ADR 017 |
| 24 | Stok minus | Diizinkan dengan peringatan; selisih harga dikoreksi otomatis saat pembelian berikutnya | ADR 017 |
| 25 | Peralihan metode persediaan | Periodik → perpetual lewat stok opname awal per barang (selisih ke HPP); peralihan lain tanpa jurnal | ADR 017 |
| 26 | Retur | Retur penjualan & pembelian dengan nilai pokok asal; transaksi kredit: kurangi tagihan atau tunai | ADR 017 |
| 27 | Pendapatan penjualan barang | Akun pendapatan default per barang | ADR 017 |
| 28 | Pemakaian bahan F&B | Form Pemakaian Barang terjurnal otomatis (resep/BOM ditunda) | ADR 017 |
| 29 | Transaksi barang bertanggal mundur | HPP jurnal posted tidak dihitung ulang; peringatan saat posting | ADR 017 |
| 30 | Cara deploy | GitHub privat + import Vercel | ADR 018 |
| 31 | Pendaftaran production | Ditutup setelah akun pemilik dibuat | ADR 018 |
| 32 | Alamat production | Subdomain vercel.app (domain sendiri menyusul bila perlu) | ADR 018 |
| 33 | Redesign dashboard (2 Okt 2026) | Mengikuti mockup user: dashboard + kerangka aplikasi (sidebar, top bar, footer) | docs/DESIGN_SYSTEM.md |
| 34 | Elemen mockup tanpa sumber data | Diganti data nyata (jumlah transaksi penjualan, tagihan belum lunas); patokan & klaim (jatuh tempo, "batas aman", badge paket, klaim kepatuhan/keamanan di footer) tidak ditampilkan | docs/DESIGN_SYSTEM.md |
| 35 | Pencarian & ekspor | Pencarian global ⌘K (jurnal, akun, barang, halaman) dengan cmdk yang sudah ada; Ekspor = cetak/simpan PDF dashboard | docs/DESIGN_SYSTEM.md |
| 36 | Grafik dashboard | Batang SVG/CSS sendiri, tanpa dependency baru | docs/DESIGN_SYSTEM.md |
| 37 | Redesign halaman login (2 Okt 2026) | Kartu login mockup user (bagian web); tanpa tombol aplikasi mobile, badge SSL, dan tautan footer fiktif | docs/DESIGN_SYSTEM.md |
| 38 | Login Google | Tidak dulu; tetap email + kata sandi (Catatan Keputusan 7) | ADR 013 |
| 39 | Lupa kata sandi | Dibuat: tautan reset lewat email Supabase + halaman atur kata sandi baru | ADR 019 |
| 40 | "Ingat perangkat ini" | Dibuat: tidak dicentang = sesi berakhir saat browser ditutup | ADR 019 |
| 41 | Redesign "Workspace Saya" (2 Okt 2026) | Kartu per workspace dengan data nyata (pendapatan & jurnal bulan berjalan, status, saldo awal, metode persediaan), cari & filter template; tanpa avatar tim, notifikasi, banner konsultan, dan klaim footer | docs/DESIGN_SYSTEM.md |
| 42 | Stok opname F&B (3 Okt 2026) | Input sisa bahan (qty) per bahan, dikelompokkan per section; satu menu "Stok Opname & COGS" | ADR 020 |
| 43 | Nilai stok akhir | Pilihan per workspace di Pengaturan: harga beli terakhir atau rata-rata | ADR 020 |
| 44 | Section bahan baku | Kategori bebas per bahan di Daftar Barang | ADR 020 |
| 45 | Template import/export | CSV dan Excel .xlsx (dependency ExcelJS disetujui user) | ADR 020 |
| 46 | Pembelian bahan baku | Per bahan (qty & harga) | ADR 020 |
| 47 | Jurnal stok opname | Penyesuaian HPP otomatis = saldo buku Persediaan − nilai stok akhir | ADR 020 |
| 48 | Porsi terjual (theoretical cost) | Keduanya: rekap per periode (input/import) dan form penjualan per menu | ADR 020 |
| 49 | Form penjualan per menu | Sekaligus membuat jurnal penjualan (pendapatan + PB1, tunai/kredit) dan mencatat porsi | ADR 021 |
| 50 | Rekap & penjualan menu pada tanggal yang sama | Rekap menggantikan penjualan menu pada tanggal yang dicakupnya | ADR 021 |
| 51 | Harga bahan theoretical cost | Sama dengan dasar harga stok opname periode itu | ADR 021 |
| 52 | Perubahan resep | Riwayat per tanggal berlaku; periode lama memakai resep lama | ADR 021 |
| 53 | Faktur & jurnal | Faktur = input transaksi: draft, lalu terbit memposting jurnal kredit | ADR 022 |
| 54 | Kebutuhan tukar faktur | Cetak faktur (PDF); tanpa status tukar faktur/tanda terima/daftar jatuh tempo | ADR 022 |
| 55 | Rincian faktur | Baris bebas (keterangan, qty, satuan, harga, akun) + boleh pilih barang | ADR 022 |
| 56 | Identitas di faktur | Alamat, telepon, email, NPWP, rekening bank, logo | ADR 022 |
| 57 | Penyimpanan logo | Dikecilkan di browser, disimpan di database (tanpa Storage) | ADR 022 |
| 58 | Pelanggan & pemasok | Daftar kontak | ADR 022 |
| 59 | Nomor faktur penjualan | INV/2026/10/0001, urut per tahun, prefix dapat diubah | ADR 022 |
| 60 | Tahapan | 7A penjualan, lalu 7B pembelian | ADR 022 |
| 61 | Nomor faktur pembelian | Nomor internal PB/2026/10/0001 (prefix dapat diubah) + nomor faktur pemasok | ADR 022 |
| 62 | Cetak faktur pembelian | Keduanya: Tanda Terima Faktur dan salinan rincian faktur | ADR 022 |
| 63 | Tujuan pulihkan backup | Workspace baru; workspace lain tidak ditimpa | ADR 023 |
| 64 | Isi yang dipulihkan | Persis: nomor & tanggal jurnal, posted/void, periode terkunci, tutup buku; audit lama ikut + catatan pemulihan | ADR 023 |
| 65 | Bentuk diskon faktur | Per faktur saja (% atau Rp) | Fase 8B |
| 66 | Jurnal diskon | Penjualan: akun kontra Potongan Penjualan; pembelian: mengurangi harga pokok/beban; pajak dari harga setelah diskon | Fase 8B |
| 67 | Pendapatan porsi rekap (laporan menu) | Porsi × harga jual menu (estimasi, ditandai) | Fase 8C |
| 68 | Biaya bahan laporan menu | Resep berlaku pada tanggal jual × harga bahan pada akhir periode laporan | Fase 8C |
| 69 | Lokasi laporan menu | Tab di Laporan Keuangan | Fase 8C |
| 70 | PWA saat offline | Layar "Anda offline" + coba lagi; tanpa data/input offline | Fase 9 |
| 71 | Nama & ikon PWA | "Pembukuan" + logo aplikasi saat ini | Fase 9 |
| 72 | Notifikasi push | Fase terpisah bersama pengingat pajak (Fase 11) | Fase 9 |
| 73 | Service worker | Manual, tanpa library baru | Fase 9 |
| 74 | Jenis katering | Acara, nasi box/kantor, dan langganan | Fase 10 |
| 75 | Pengakuan pendapatan katering | Saat acara/pengiriman; DP = Uang Muka Pelanggan (utang); ada daftar DP & sisa tagihan klien | Fase 10A |
| 76 | Pembatalan pesanan | Kebijakan dipilih per klien (DP kembali penuh / hangus sebagian / hangus seluruhnya), dapat diubah per pesanan | Fase 10A |
| 77 | PPh 23 dipotong pelanggan | Opsi di pengaturan (nonaktif dulu), dipakai ke depannya | Fase 10A–10B |
| 78 | Biaya per pesanan | Detail, dengan opsi hanya bahan baku | Fase 10B |
| 79 | PBJT katering | Belum memungut; tersedia di pengaturan | Fase 10A |
| 80 | Urutan katering | 10A → 10B → 10C → 10D; F&B & Retail ditahan | Fase 10 |
| 81 | Dokumen klien katering | Quotation & Invoice dapat dicetak | Fase 10A |
| 82 | Nomor quotation | Dua pilihan prefix: QUO atau SPH (PREFIX/yyyy/mm/0001) | Fase 10A |
| 83 | Invoice DP & jurnal | Invoice DP = dokumen saja; jurnal otomatis dari daftar tagihan saat DP dibayar, acara selesai/invoice pelunasan, dan pelunasan dibayar | Fase 10A |
| 84 | Tag pesanan di jurnal | Kolom opsional di baris jurnal untuk laba per pesanan (ADR baru) | Fase 10B |
| 85 | Rekening penerimaan | Setiap penerimaan/pengembalian DP & pelunasan memilih akun kas/bank tujuan setiap kali, tanpa default dari pilihan terakhir | Fase 10A |
| 86 | Bahan baku pesanan katering | Langsung ke HPP Bahan Baku saat dibeli; sisa bahan dikoreksi lewat stok opname | Fase 10B |
| 87 | Penandaan biaya ke pesanan | Dari halaman pesanan (Catat biaya) dan dari Input Transaksi → Beban operasional; Pembelian Bahan Baku tetap untuk stok umum (ke Persediaan) | Fase 10B |
| 88 | Estimasi biaya pesanan | Diisi manual per kategori di form pesanan (10C: estimasi bahan dari resep) | Fase 10B |
| 89 | PPh 23 dipotong pelanggan | Fitur di Pengaturan → Pajak (aktif/nonaktif + tarif, default 2%); nilai default tarif × tagihan tanpa PBJT, dapat diubah sesuai bukti potong | Fase 10B |
| 90 | Paket menu katering | Daftar paket khusus katering (bukan Menu & Resep F&B): harga per pax + resep bahan untuk N pax | Fase 10C |
| 91 | Harga bahan untuk estimasi | Pembelian terakhir (Pembelian Bahan Baku); bila belum ada, harga perkiraan di Daftar Barang | Fase 10C |
| 92 | Estimasi bahan di pesanan | Otomatis dari resep × pax, tetap bisa diubah | Fase 10C |
| 93 | Daftar belanja | Per rentang tanggal acara, gabungan pesanan dikonfirmasi; cetak & ekspor CSV/Excel | Fase 10C |
