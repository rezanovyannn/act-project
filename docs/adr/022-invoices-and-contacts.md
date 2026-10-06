# ADR 022: Faktur Penjualan & Pembelian, Kontak, dan Profil Usaha

## Konteks
User (4 Oktober 2026) membutuhkan faktur penjualan dan faktur pembelian untuk **tukar faktur** dengan pelanggan/pemasok, berlaku untuk **semua template** (F&B, Retail, dan berikutnya). Keputusan user tercatat di ROADMAP Catatan Keputusan 53–60:
- faktur adalah **input transaksi**: draft bebas diubah, lalu *Terbitkan* memposting jurnal kredit;
- kebutuhan tukar faktur: **cetak faktur (PDF)**; status tukar faktur, tanda terima, dan daftar jatuh tempo tidak diminta;
- baris rincian **bebas** (keterangan, qty, satuan, harga, akun) dan **boleh memilih barang**;
- kop faktur memuat **alamat, telepon, email, NPWP, rekening bank, dan logo** (logo dikecilkan & disimpan di database);
- pelanggan/pemasok dari **daftar kontak**;
- nomor faktur penjualan **INV/2026/10/0001**, prefix dapat diubah;
- dikerjakan bertahap: **7A** penjualan, **7B** pembelian.

## Keputusan
1. **Profil usaha** (satu per workspace, Pengaturan → Profil Usaha): nama di faktur (default nama workspace), alamat, telepon, email, NPWP, info rekening (teks bebas multi-baris), catatan kaki faktur default, prefix nomor faktur penjualan (default `INV`), dan logo. Logo dikecilkan di browser (sisi terpanjang maks. 400 px) lalu disimpan sebagai data URL `image/png|jpeg|webp` maks. 200.000 karakter. Tanpa Supabase Storage.
2. **Kontak**: nama (unik per workspace, tanpa beda huruf besar/kecil), peran pelanggan dan/atau pemasok, alamat, telepon, email, NPWP, termin bayar default (0–365 hari), catatan. Kontak yang sudah dipakai faktur tidak bisa dihapus (`CONTACT_IN_USE`). Nama kontak menjadi `counterparty` jurnal sehingga tersambung ke Piutang & Utang (ADR 012).
3. **Faktur penjualan (7A)**:
   - Isi: kontak (pelanggan), tanggal faktur, jatuh tempo (default tanggal + termin kontak; tidak boleh sebelum tanggal faktur), referensi (mis. nomor PO pelanggan), catatan, kenakan pajak (PB1/PPN mengikuti Pengaturan Pajak, termasuk/belum termasuk), dan baris rincian.
   - Baris: keterangan, qty (bilangan bulat > 0), satuan, harga satuan (rupiah utuh), akun pendapatan, barang (opsional). Nominal baris = qty × harga dan wajib > 0.
   - **Draft** boleh diubah & dihapus (soft delete). **Terbitkan** (RPC atomik) memberi nomor, menyimpan salinan data kontak, dan memposting jurnal: Dr Piutang Usaha (total) / Cr akun pendapatan per baris / Cr Utang PB1/PPN (`buildSale`, `source = revenue`, `counterparty` = nama kontak, tanggal = tanggal faktur). Validasi periode, akun, dan keseimbangan sama dengan posting biasa.
   - Baris dengan barang: pada metode **perpetual** menambah Dr HPP / Cr Persediaan per barang (harga pokok berjalan, ADR 017) dan barang membawa qty sebagai rujukan retur; pada metode **periodik** barang hanya menjadi rujukan di baris pendapatan.
   - **Nomor**: `{prefix}/{tahun}/{bulan}/{urut 4 digit}`, urut berlanjut per tahun per workspace (tidak diulang tiap bulan), diberikan saat terbit; prefix mengikuti profil saat terbit.
   - Faktur terbit **tidak dapat diubah**. Pembatalan = void jurnalnya (jurnal pembalik di periode open); status *Dibatalkan* diturunkan dari jurnal pembalik, sehingga tidak bisa dibatalkan bila sudah ada pelunasan aktif (ADR 012). Koreksi = batalkan lalu *Salin ke draft baru*.
   - **Status pembayaran** diturunkan dari Piutang (ADR 012): Belum dibayar / Dibayar sebagian / Lunas; *Lewat jatuh tempo* bila sisa > 0 setelah tanggal jatuh tempo. Pelunasan memakai halaman Piutang & Utang.
   - **Cetak**: halaman faktur berbentuk kertas A4 (kop + logo + identitas usaha, data pelanggan, rincian, subtotal, pajak, total, terbilang, jatuh tempo, rekening, catatan, tempat tanda tangan); dicetak/disimpan PDF lewat print browser. Draft tercetak dengan tanda DRAFT.
4. **Faktur pembelian (7B)** (ROADMAP Catatan Keputusan 61–62):
   - Isi sama dengan faktur penjualan, dengan kontak **pemasok** dan **nomor faktur pemasok wajib** (kolom referensi).
   - Baris: akun **persediaan/aset non-kas atau beban**; baris dengan barang selalu masuk akun Persediaan beserta qty, sehingga tercatat sebagai pembelian per bahan (COGS periodik, ADR 020) atau stok per barang (perpetual, ADR 017; ikut koreksi HPP bila menutup stok minus).
   - Pajak: hanya mode **PPN lengkap** yang memakai PPN Masukan (dihitung dari subtotal, dapat dikoreksi sesuai faktur pemasok, kolom `tax_override`); mode PB1 tanpa pajak masukan.
   - Terbit: nomor internal `{prefix pembelian}/{tahun}/{bulan}/{urut}` (default `PB`, urut per tahun, terpisah dari penjualan) + jurnal Dr akun baris [+ PPN Masukan] / Cr Utang Usaha (`source = purchase`, `counterparty` = pemasok). Status pembayaran dari Utang; pembatalan & salin ke draft sama dengan penjualan.
   - Cetak dua dokumen: **Tanda Terima Faktur** (kop usaha, pemasok, no. faktur pemasok, tanggal, jatuh tempo, jumlah, terbilang, tanda tangan yang menyerahkan & yang menerima) dan **salinan faktur** (rincian, pajak, total).
6. **Diskon faktur (Fase 8B, ROADMAP Catatan Keputusan 65–66):** satu diskon per faktur, persen (basis poin, maks. 100%) atau rupiah, harus lebih kecil dari subtotal. **Penjualan:** pendapatan per baris dicatat bruto, diskon didebit ke akun **Retur & Potongan Penjualan** (peran `sales_returns`, kode 4-1900, dibuat otomatis saat terbit bila belum ada); PB1/PPN dihitung dari harga setelah diskon. Pada harga termasuk pajak, pajak bruto dibagi proporsional ke baris dan selisih pajak bruto − neto mengurangi diskon, sehingga pendapatan & diskon sama-sama tanpa pajak. **Pembelian:** diskon dibagi proporsional ke baris (mengurangi harga pokok persediaan/beban, termasuk pembelian per bahan untuk COGS); PPN Masukan dari harga setelah diskon. Dokumen faktur menampilkan baris Diskon.
5. **Data & keamanan**: tabel `workspace_profiles`, `contacts`, `invoices`, `invoice_lines` ber-`workspace_id`, RLS hanya SELECT untuk pemilik, tulis lewat RPC SECURITY DEFINER. Audit: entitas `contact` dan `invoice`.

## Konsekuensi
### Positif:
- Satu input menghasilkan dokumen untuk tukar faktur sekaligus jurnal piutang/utang; pelunasan dan laporan tetap dari jurnal.
- Berlaku lintas template; kontak dipakai bersama penjualan dan pembelian.

### Negatif:
- Faktur terbit tidak dapat diedit; salah ketik harus dibatalkan lalu diterbitkan ulang (nomor lama tetap terpakai).
- Logo dibatasi ukuran kecil agar muat di database.
- Diskon per baris/faktur belum didukung.
