# ADR 016: Mode PPN Lengkap (PPN Keluaran & PPN Masukan)

## Konteks
ADR 015 menambahkan label pajak penjualan PB1/PPN dengan mekanisme sederhana: pajak yang dipungut dicatat sebagai utang, tanpa PPN Masukan. Pengusaha Kena Pajak (PKP) perlu mengkreditkan PPN Masukan atas pembelian dan menyetor selisihnya. Keputusan user (30 September 2026) untuk ROADMAP Fase 4B:
- DPP diatur di Pengaturan, seperti pengaturan pajak lainnya.
- Lebih bayar dikompensasikan ke masa berikutnya.
- PPN Masukan dicatat pada semua pembelian & beban.
- Saat mode diganti, tersedia dua pilihan: berlaku ke depan saja, atau jurnal transisi otomatis.
- Setoran dihitung otomatis dari saldo per akhir masa dan bisa dikoreksi.
- Isi jurnal transisi: saldo PPN Masukan yang belum dikreditkan dibebankan.
- Nilai awal: DPP 11/12 × tarif 12%.
- Nominal PPN Masukan dihitung dari pengaturan, bisa dikoreksi sesuai faktur.

## Keputusan
1. **Mode pajak per workspace** (`sales_tax_mode`): `simple` (ADR 015, label PB1/PPN) atau `full_vat` (PPN lengkap, label selalu PPN). Berlaku untuk semua template dan dapat diubah kapan saja di **Pengaturan → Pajak**; perubahan hanya memengaruhi transaksi baru dan tercatat di audit log.
2. **DPP** disimpan sebagai pecahan integer `vat_dpp_numerator / vat_dpp_denominator` (1 ≤ pembilang ≤ penyebut). Hanya berlaku pada mode `full_vat`. Nilai awal saat mode PPN lengkap dipilih: **DPP 11/12, tarif 12%** (efektif 11%). Semua perhitungan integer (BigInt), pembulatan setengah ke atas sekali per transaksi (ADR 005 & 012):
   - harga belum termasuk PPN: PPN = round(harga × pembilang × tarif ÷ (penyebut × 10.000));
   - harga sudah termasuk PPN: harga dasar = round(total × penyebut × 10.000 ÷ (penyebut × 10.000 + pembilang × tarif)), PPN = total − harga dasar.
3. **Akun sistem baru** (dibuat otomatis saat mode `full_vat` pertama kali dipilih bila belum ada):
   - `PPN Masukan` (aset, arus kas operasi, `system_role = input_vat`);
   - `Beban PPN Masukan Tidak Dapat Dikreditkan` (beban, `system_role = non_creditable_vat`).
   PPN Keluaran memakai akun `sales_tax_payable` yang sudah ada (Utang PPN/PB1).
4. **Penjualan** (mode `full_vat`): Dr Kas/Piutang (total), Cr Pendapatan (harga dasar), Cr PPN Keluaran (PPN dengan DPP).
5. **PPN Masukan** pada form **Beban operasional** dan **Pembelian persediaan**: sakelar "Ada faktur PPN" per transaksi. Nominal dihitung dari harga sebelum PPN × DPP × tarif dan dapat dikoreksi sesuai faktur pemasok. Jurnal: Dr akun beban/persediaan (harga), Dr PPN Masukan (PPN), Cr Kas/Utang Usaha (total). Pembelian aset tetap dicatat lewat jurnal umum dengan baris PPN Masukan.
6. **Setoran PPN per masa** (bulan): form mengambil saldo PPN Keluaran dan PPN Masukan per akhir masa; tanggal setoran tidak boleh sebelum akhir masa.
   - PPN Masukan dikreditkan = min(saldo Masukan, PPN Keluaran).
   - Jurnal: Dr PPN Keluaran, Cr PPN Masukan (dikreditkan), Cr Kas/Bank (kurang bayar, bila ada).
   - Kedua nominal dapat dikoreksi; yang dikreditkan tidak boleh melebihi PPN Keluaran.
   - **Lebih bayar dikompensasikan:** sisa PPN Masukan tidak dijurnal dan tetap menjadi saldo untuk masa berikutnya.
7. **Pindah dari `full_vat` ke `simple`**, dua pilihan:
   - **Berlaku ke depan saja:** tanpa jurnal; saldo PPN Masukan tetap dan dapat dikreditkan lewat jurnal umum.
   - **Jurnal transisi:** saldo PPN Masukan per tanggal pilihan (harus di periode open) dibebankan: Dr Beban PPN Masukan Tidak Dapat Dikreditkan, Cr PPN Masukan (`source = adjustment`). Jurnal diposting sebelum pengaturan diubah.

   Pindah dari `simple` ke `full_vat` tidak memerlukan jurnal karena PPN Keluaran memakai akun utang pajak yang sama.

## Konsekuensi
### Positif:
- PKP dapat mencatat PPN sesuai mekanisme pajak masukan-keluaran tanpa mengubah engine jurnal; setoran tetap berupa jurnal biasa (`tax_payment`).
- DPP nilai lain dan tarif dapat menyesuaikan perubahan ketentuan tanpa rilis ulang.

### Negatif:
- Tidak ada modul faktur pajak/e-Faktur; nomor faktur dapat dicatat di keterangan.
- Pembelian aset tetap dengan PPN Masukan belum punya form khusus.
- Bila jurnal transisi berhasil tetapi penyimpanan pengaturan gagal (mis. koneksi putus), jurnal tetap ada dan pengaturan dapat disimpan ulang.
