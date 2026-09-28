# ADR 012: Pajak Restoran (PB1) dan Transaksi Kredit dengan Pelunasan

## Konteks
Keputusan user (28 September 2026): transaksi F&B mencatat **PB1** (pajak restoran, kini bagian dari PBJT), dan form transaksi mendukung **transaksi kredit beserta pelunasannya** (piutang pelanggan dan utang pemasok). Keduanya memengaruhi CoA, model jurnal, form input (Sub-fase 1C), dan laporan arus kas.

## Keputusan

### A. PB1
1. PB1 yang dipungut dari konsumen **bukan pendapatan**. Saat penjualan: Dr Kas/Bank/Piutang (total dibayar konsumen), Cr Pendapatan (dasar pengenaan), Cr `Utang PB1` (pajak).
2. Penyetoran PB1 ke pemerintah daerah: Dr `Utang PB1`, Cr Kas/Bank (`source = tax_payment`). Saldo `Utang PB1` = PB1 yang sudah dipungut tetapi belum disetor.
3. Tarif disimpan per workspace dalam **basis poin integer** (default 1000 = 10%), tidak pernah sebagai float. Tarif bisa diubah user karena tarif PBJT ditetapkan per daerah.
4. Mode harga per workspace: **harga belum termasuk PB1** (default, PB1 ditambahkan di atas harga menu) atau **harga sudah termasuk PB1**.
   - Belum termasuk: `pajak = round(dasar × tarif / 10000)`.
   - Sudah termasuk: `dasar = round(total × 10000 / (10000 + tarif))`, `pajak = total − dasar`.
   - Pembulatan ke Rupiah terdekat (setengah ke atas), per transaksi, memakai aritmetika integer.
5. PB1 tidak berlaku pada pembelian bahan baku (bukan pajak masukan seperti PPN).
6. Pada arus kas, `Utang PB1` berkategori `operating`: PB1 yang dipungut masuk ke penerimaan operasi, dan setorannya keluar dari operasi.

### B. Transaksi kredit dan pelunasan
1. Akun baru di template F&B: `Piutang Usaha` (aset) dan `Utang Usaha` (liabilitas), keduanya `operating`, ditandai `system_role` `accounts_receivable` / `accounts_payable`.
2. Penjualan kredit: Dr Piutang Usaha, Cr Pendapatan (+ Cr Utang PB1). Pembelian/beban kredit: Dr Persediaan/Beban, Cr Utang Usaha. Header jurnal menyimpan `counterparty` (nama pelanggan/pemasok, teks bebas).
3. Pelunasan dicatat sebagai jurnal `source = settlement` dengan `settlement_of` → id jurnal transaksi kredit asal:
   - Penerimaan piutang: Dr Kas/Bank, Cr Piutang Usaha.
   - Pembayaran utang: Dr Utang Usaha, Cr Kas/Bank.
4. Pelunasan boleh **sebagian** (cicilan) dan boleh lebih dari satu kali. Total pelunasan tidak boleh melebihi sisa tagihan.
   - Sisa tagihan = nominal baris Piutang/Utang pada jurnal asal − total pelunasan yang masih aktif.
   - Pelunasan yang sudah di-void tidak dihitung.
5. Target pelunasan harus jurnal posted, satu workspace, dan belum di-void.
6. Jurnal transaksi kredit **tidak boleh di-void/dikoreksi selama masih punya pelunasan aktif**. Pelunasannya harus di-void lebih dulu.
7. Sub-fase 1C menyediakan daftar piutang dan utang yang belum lunas (per pihak dan per transaksi).
8. Kartu piutang/utang per pelanggan sebagai entitas tersendiri (tabel pelanggan/pemasok) belum dibuat. `counterparty` masih teks bebas dan bisa ditingkatkan di fase berikutnya.

## Konsekuensi
### Positif:
- Laporan mencerminkan basis akrual: pendapatan diakui saat penjualan, bukan saat kas diterima.
- Kewajiban PB1 dan utang pemasok terlihat jelas di Neraca.
- Aritmetika integer menjaga tidak ada selisih pembulatan antara dasar, pajak, dan total.

### Negatif:
- Form penjualan dan pembelian menjadi lebih kompleks (pilihan tunai/kredit, pihak lawan, PB1).
- Void jurnal transaksi kredit membutuhkan langkah tambahan bila sudah ada pelunasan.
- `counterparty` teks bebas rawan beda penulisan nama; UI perlu menyarankan nama yang pernah dipakai.
