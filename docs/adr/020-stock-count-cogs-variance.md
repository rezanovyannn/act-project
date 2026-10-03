# ADR 020: Stok Opname Sisa Bahan, Tabel COGS & Variance

## Konteks
Stok opname periodik lama (ADR 007) meminta satu nilai rupiah total persediaan fisik. User (pemilik usaha F&B, 3 Oktober 2026) ingin:
- menghitung **sisa** setiap bahan baku (qty) yang dikelompokkan per section;
- melihat COGS per bahan: Stok Awal + Pembelian − Stok Akhir;
- membandingkan COGS aktual dengan theoretical cost dari penjualan menu × resep.

Keputusan user tercatat di ROADMAP Catatan Keputusan 42–48.

## Keputusan
1. **Satu menu "Stok Opname & COGS"** (grup Persediaan) dengan tab *Stok Opname* dan *COGS* (6B menambah analisa variance). Berlaku untuk metode periodik. Workspace perpetual tetap memakai stok opname per barang (ADR 017). Workspace periodik yang belum punya bahan aktif tetap memakai stok opname nilai rupiah (ADR 007) dan form pembelian nominal; begitu ada bahan aktif, pembelian dicatat per bahan dan menu berganti ke Stok Opname & COGS.
2. **Section bahan:** kolom `category` (teks bebas, opsional) pada barang. Daftar opname dan tabel COGS dikelompokkan per section (urut abjad, tanpa section di akhir), lalu per kode barang.
3. **Pembelian per bahan:** form Pembelian Bahan Baku memakai baris bahan (qty & harga) di kedua metode. Baris jurnal Persediaan membawa `item_id` & `quantity` (ADR 017).
4. **Stok opname (stock count):**
   - Header (`count_date`, metode nilai, tautan jurnal) dan baris per bahan (qty sisa, harga satuan, nilai).
   - Disimpan atomik bersama jurnalnya (RPC `post_stock_count`).
   - Satu stok opname aktif per tanggal; stok opname yang jurnalnya di-void dianggap batal.
5. **Nilai stok akhir** per bahan = round(qty sisa × harga satuan), dengan harga satuan menurut pengaturan workspace `stock_valuation`:
   - `average` (default) = (nilai stok awal + nilai pembelian) ÷ (qty stok awal + qty pembelian) pada periode itu;
   - `last` = harga satuan pembelian terakhir s.d. tanggal opname.
   - Bila tidak ada pembelian maupun stok awal, harga satuan diambil dari harga terakhir yang diketahui (stok opname/pembelian sebelumnya); bila tetap tidak ada, nilai 0 dan diberi peringatan.
6. **Periode:** stok awal = stok opname aktif sebelumnya (qty & nilai per bahan; 0 bila belum ada). Pembelian = mutasi bersih baris Persediaan ber-barang setelah tanggal opname sebelumnya s.d. tanggal opname ini. Void dan retur pembelian ikut terhitung karena mutasinya bersih.
7. **COGS per bahan** = Stok Awal + Pembelian − Stok Akhir, dalam qty dan rupiah.
8. **Jurnal penyesuaian** (`source = adjustment`): selisih saldo buku akun Persediaan per tanggal opname dengan total nilai stok akhir. Saldo buku > nilai fisik: Dr HPP, Cr Persediaan; sebaliknya dibalik; sama: tanpa jurnal (stok opname tetap disimpan). Bila ada pembelian tanpa rincian bahan, total COGS tabel dapat berbeda dari jurnal; selisihnya ditampilkan.
9. **Import/export:** template berisi kode, nama, section, satuan, dan kolom qty sisa, dalam CSV (BOM UTF-8) dan Excel `.xlsx` (ExcelJS, dimuat saat dipakai). Import mencocokkan **kode barang**; baris tanpa qty diabaikan, kode tak dikenal dilaporkan.
10. **6B (variance):** menu & resep (qty bahan per porsi); porsi terjual dari rekap per periode dan dari form penjualan per menu. Theoretical cost = Σ porsi × qty resep × harga satuan periode itu. Variance = actual (COGS) − theoretical, per bahan dan total.

## Konsekuensi
### Positif:
- COGS dan HPP di Laba Rugi bersumber dari stok opname yang sama dan dapat direkonsiliasi per bahan.
- Pemilik dapat melihat bahan dengan pemakaian di atas resep (waste, porsi berlebih, pencurian).

### Negatif:
- Harga rata-rata periodik bergantung pada pembelian yang dirinci per bahan.
- Menambah tabel stok opname, kolom section, dan pengaturan nilai stok di database.
