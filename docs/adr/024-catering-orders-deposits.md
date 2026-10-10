# ADR 024: Template Katering, Pesanan, Uang Muka (DP), Quotation & Invoice

## Konteks
User (10 Oktober 2026) meminta template ketiga untuk usaha katering: acara, nasi box/kantor, dan langganan (ROADMAP Fase 10, Catatan Keputusan 74–85). Fitur F&B dan Retail ditahan selama fase ini. Riset pajak: jasa boga/katering **bukan objek PPN** (UU PPN Pasal 4A, kriteria PMK 70/2022), melainkan objek **PBJT makanan & minuman** (UU HKPD, tarif per daerah, maks. 10%). PBJT dicatat dengan mekanisme yang sama dengan PB1 (ADR 012). Pelanggan badan dapat memotong PPh 23 sebesar 2%.

Keputusan user yang relevan untuk 10A:
- Pendapatan diakui saat acara/pengiriman. DP adalah utang (Uang Muka Pelanggan) sampai saat itu. Ada daftar DP & sisa tagihan per klien.
- Kebijakan pembatalan dipilih per klien dan dapat diubah per pesanan.
- PBJT belum dipungut tetapi tersedia di pengaturan. PPh 23 dicantumkan di pengaturan, nonaktif dulu.
- Nomor quotation: prefix `QUO` atau `SPH`.
- Invoice DP hanya dokumen. Jurnal dibuat otomatis dari daftar tagihan saat DP dibayar, saat acara selesai, dan saat pelunasan dibayar.
- Setiap penerimaan/pengembalian memilih rekening kas/bank **setiap kali** (tanpa default dari pilihan terakhir).
- Baris jurnal boleh ditandai ke pesanan (kolom opsional, mengubah ADR 011).

## Keputusan
1. **Template `catering`** (`src/modules/catering/template.ts`), label "Katering", istilah persediaan "bahan baku". Pajak awal: label **PBJT**, tarif 0% (belum memungut). `SalesTaxLabel` bertambah `PBJT`.
   - **CoA:** Kas, Bank, Persediaan Bahan Baku (`inventory`), Piutang Usaha, PPh 23 Dibayar Dimuka, Peralatan Katering + Akumulasi Penyusutan, Utang Usaha, Utang PBJT (`sales_tax_payable`), **Uang Muka Pelanggan** (peran baru `customer_deposits`, liabilitas, arus kas operasi), Utang Bank, ekuitas standar, Pendapatan Katering, Pendapatan Ongkir & Sewa Alat, **Pendapatan Pembatalan**, Retur & Potongan Penjualan (`sales_returns`), HPP Bahan Baku (`cogs`), serta beban: gaji, tenaga lepas, sewa alat, transport & pengiriman, kemasan, sewa tempat, listrik/air/gas, penyusutan, bunga, lain-lain.
   - **PPh 23:** di tab Pajak tampil sebagai opsi nonaktif dengan keterangan. Pencatatannya dikerjakan di 10B.
2. **Pesanan (`catering_orders`).** Klien (kontak pelanggan, wajib), jenis (`event` acara / `box` nasi box & kantor / `subscription` langganan), tanggal acara, jam (opsional), lokasi, jumlah pax, baris (keterangan, qty, satuan, harga, akun pendapatan, sama dengan baris faktur), pajak, diskon, catatan, tanggal quotation, berlaku sampai, dan kebijakan pembatalan.
   - **Nomor:** `PREFIX/yyyy/mm/urut` (urut per tahun tanggal quotation), dengan prefix `QUO` atau `SPH` dari Profil Usaha. Nomor diberikan saat pesanan dibuat.
   - **Status:** `quotation` (Penawaran) → `confirmed` (Dikonfirmasi) → `completed` (Selesai), atau `cancelled` (Dibatalkan). "Kedaluwarsa" adalah tampilan untuk penawaran yang lewat masa berlaku. Status bayar diturunkan dari jurnal.
   - Penawaran & pesanan dikonfirmasi boleh diubah. Pesanan selesai/dibatalkan tidak dapat diubah. Hanya penawaran tanpa DP yang dapat dihapus (soft delete).
3. **Kebijakan pembatalan.** `refund` (DP dikembalikan penuh), `forfeit_percent` (hangus sebagian, persen basis poin dari DP yang diterima), atau `forfeit_all` (hangus seluruhnya). Kontak menyimpan default (opsional). Pesanan baru menyalin default kontak, atau "dikembalikan penuh" bila kontak belum punya default. Nilainya dapat diubah per pesanan.
4. **Tag pesanan di baris jurnal.** `journal_lines.order_id` (opsional, FK ke pesanan di workspace yang sama). Jurnal pembalik menyalin tag sehingga saldo per pesanan tetap benar. Tag dipakai untuk DP, pengakuan pendapatan, pelunasan, dan (10B) biaya per pesanan.
5. **Saldo DP per pesanan** = Σ (kredit − debit) baris akun `customer_deposits` bertag pesanan itu pada jurnal posted. Saldo ini **tidak boleh negatif**: database menolak jurnal yang membuatnya negatif, termasuk void DP yang sudah dipakai untuk pelunasan.
6. **Jurnal otomatis** (sumber jurnal baru `deposit` untuk uang muka):
   - **Terima DP** (pesanan dikonfirmasi): Dr Kas/Bank pilihan / Cr Uang Muka Pelanggan. Menerima DP pada penawaran otomatis mengonfirmasinya.
   - **Selesaikan pesanan** (tanggal default = tanggal acara): atomik (RPC `complete_catering_order`). Faktur penjualan terbit dari baris pesanan (nomor faktur biasa, referensi = nomor pesanan), dengan jurnal Dr Piutang / Cr Pendapatan [+ PBJT] [Dr Potongan bila diskon]. Lalu saldo DP dipakai melunasi faktur: jurnal pelunasan Dr Uang Muka Pelanggan / Cr Piutang sebesar min(saldo DP, total faktur). Bila DP melebihi total, sisanya tetap di Uang Muka Pelanggan dan dapat dikembalikan.
   - **Terima pelunasan** (pesanan selesai): pelunasan faktur biasa (ADR 012), Dr Kas/Bank pilihan / Cr Piutang.
   - **Kembalikan kelebihan DP:** Dr Uang Muka Pelanggan / Cr Kas/Bank pilihan.
   - **Batalkan pesanan:** atomik (RPC `cancel_catering_order`). Bila ada saldo DP: Dr Uang Muka Pelanggan (seluruh saldo) / Cr Kas/Bank pilihan (bagian dikembalikan) / Cr Pendapatan Pembatalan (bagian hangus, akun pendapatan pilihan user). Database memastikan saldo DP pesanan menjadi nol.
   - Semua jurnal di atas memakai validasi posting biasa (periode open, seimbang, akun aktif).
7. **Invoice DP (`catering_order_bills`).** Dokumen tagihan tanpa jurnal: tanggal, jatuh tempo, nominal (rupiah atau persen dari total pesanan), catatan. Nomor `PREFIX-DP/yyyy/mm/urut` (prefix faktur penjualan + `-DP`, urut per tahun) agar tidak bentrok dengan urutan faktur penjualan. Status bayar tiap invoice DP diturunkan dari DP yang diterima, dialokasikan berurutan (FIFO) ke invoice DP pesanan itu. Invoice DP dapat dihapus selama pesanan belum selesai/dibatalkan.
8. **Dokumen cetak (A4/PDF):** Quotation/Surat Penawaran Harga (kop profil usaha, detail acara, rincian, total, terbilang, kebijakan pembatalan, rekening), Invoice DP, dan faktur pelunasan (faktur penjualan ADR 022).
9. **Halaman Pesanan** (menu khusus template katering), dengan tab:
   - **Pesanan:** daftar dengan filter status.
   - **Kalender:** pesanan per tanggal acara.
   - **Tagihan:** invoice DP & faktur pelunasan dengan status belum dibayar/sebagian/lunas, plus aksi "Terima pembayaran".
   - **Per Klien:** total pesanan, DP diterima (= saldo Uang Muka Pelanggan), dan sisa tagihan (= Piutang) per klien.
10. **Backup & pulihkan** menyertakan pesanan dan invoice DP, termasuk tag pesanan di baris jurnal.

## Keputusan Fase 10B (dijawab user, 11 Oktober 2026 — Catatan Keputusan 86–89)
11. **Bahan baku pesanan langsung HPP.** Belanja bahan untuk pesanan didebit ke akun HPP Bahan Baku (peran `cogs`) dan bertag pesanan, bukan ke Persediaan. Sisa bahan di akhir periode dikoreksi lewat stok opname (ADR 020): saldo Persediaan disesuaikan ke nilai fisik dengan lawan HPP. Halaman Pembelian Bahan Baku tetap untuk stok umum (ke Persediaan).
12. **Mencatat biaya pesanan.** (a) Tombol **Catat biaya** di halaman pesanan (pesanan dikonfirmasi, selesai, atau dibatalkan), dengan kategori bahan baku, tenaga lepas, sewa alat, transport & pengiriman, kemasan, atau lain-lain; dibayar dari rekening kas/bank pilihan atau kredit ke pemasok (Utang Usaha). (b) Pilihan **Pesanan (opsional)** di Input Transaksi → Beban operasional; akun HPP ikut ditawarkan di workspace katering. Hanya baris biaya yang bertag pesanan.
13. **Kategori biaya** diturunkan dari akun: akun HPP = bahan baku; akun beban berkode template 6-1100 tenaga lepas, 6-1200 sewa alat, 6-1300 transport & pengiriman, 6-1400 kemasan; beban lain = lain-lain.
14. **Mode biaya** per workspace (`catering_cost_mode`): `detail` (semua kategori) atau `materials` (bahan baku saja). Pada mode bahan baku saja, form & laporan hanya memakai kategori bahan baku; dapat diubah kapan saja.
15. **Estimasi biaya** per kategori disimpan di pesanan (`cost_estimates`, rupiah bulat ≥ 0) dan dibandingkan dengan realisasi.
16. **Laba kotor per pesanan** = pendapatan bertag pesanan (akun pendapatan: setelah diskon, tanpa pajak, termasuk DP hangus) − biaya bertag pesanan sesuai mode; ditampilkan dengan margin dan laba per pax di halaman pesanan dan tab **Laba**. Dihitung dari jurnal posted (pembalik ikut menetralkan); bila semua pendapatan & biaya ditandai, totalnya sama dengan laba kotor di Laba Rugi.
17. **PPh 23 dipotong pelanggan.** Pengaturan workspace `pph23_enabled` + `pph23_rate_bps` (default 200 = 2%) di Pengaturan → Pajak. Bila aktif, dialog terima pelunasan pesanan selesai menyediakan potongan PPh 23 dengan nilai default tarif × (total faktur − pajak penjualan), maksimal sisa tagihan, dan dapat diubah sesuai bukti potong. Jurnal: Dr Kas/Bank (diterima) + Dr PPh 23 Dibayar Dimuka (peran baru `pph23_prepaid`) / Cr Piutang. PPh 23 tidak berlaku untuk DP.

## Keputusan Fase 10C (dijawab user, 11 Oktober 2026 — Catatan Keputusan 90–93)
18. **Paket menu katering** (`catering_packages`), terpisah dari Menu & Resep F&B: kode unik, nama, isi paket (tampil di quotation), harga per pax, akun pendapatan (opsional), dan resep bahan berupa qty bulat satuan dasar untuk `yield_pax` pax. Paket yang dipakai pesanan tidak dapat dihapus (dinonaktifkan saja); bahan yang dipakai resep paket tidak dapat dihapus. Resep tidak berversi: estimasi & daftar belanja memakai resep paket saat ini.
19. **Harga perkiraan bahan** di Daftar Barang (`items.estimated_price` per `estimated_per` satuan dasar, mis. Rp 15.000 per 1.000 gram). Harga bahan untuk estimasi = pembelian terakhir lewat Persediaan (Pembelian Bahan Baku) s.d. tanggal; bila belum ada, harga perkiraan; bila keduanya tidak ada, bahan ditandai "belum ada harga".
20. **Baris pesanan ber-paket** (`packageId` di baris pesanan): memilih paket mengisi keterangan (nama + isi), qty = jumlah pax, satuan pax, harga per pax, akun pendapatan paket. Estimasi bahan baku pesanan otomatis = Σ resep × pax × harga (pecahan eksak, dibulatkan ke rupiah) sampai user mengetik angka sendiri.
21. **Daftar belanja** dari pesanan berstatus dikonfirmasi dengan tanggal acara dalam rentang: kebutuhan tiap bahan digabung lintas pesanan (pecahan eksak), jumlah dibeli dibulatkan ke atas ke satuan dasar, perkiraan biaya, rincian per pesanan; dapat dicetak dan diekspor CSV/Excel. Baris pesanan tanpa paket tidak dihitung dan disebutkan jumlahnya.

## Konsekuensi
### Positif:
- Pendapatan katering berbasis akrual tanpa jurnal manual. DP dan sisa tagihan selalu cocok dengan Neraca (Uang Muka Pelanggan & Piutang Usaha).
- Faktur, pelunasan, laporan, tutup buku, dan backup dipakai ulang. Tag pesanan menyiapkan laporan laba per pesanan (10B).

### Negatif:
- Model data jurnal bertambah satu kolom, dan RPC posting memeriksa saldo DP per pesanan.
- Urutan nomor invoice DP terpisah dari faktur penjualan (`INV-DP/…` vs `INV/…`).
- Pesanan yang sudah selesai tidak dapat dibatalkan dari halaman Pesanan. Koreksinya lewat faktur (void pelunasan lalu faktur).
