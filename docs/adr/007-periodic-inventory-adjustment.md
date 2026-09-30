# ADR 007: Metode Persediaan Periodik dengan Penyesuaian Manual

> Sejak ADR 015 metode ini berlaku untuk semua template (Persediaan Bahan Baku F&B, Persediaan Barang Dagang Retail) lewat akun ber-`system_role` `inventory`.

## Konteks
Aplikasi awal ditujukan untuk bisnis F&B dengan kompleksitas operasional yang dinamis. Melacak persediaan secara *perpetual* (tiap transaksi) membutuhkan sistem *tracking* yang sangat detail (FIFO/LIFO/Average) yang berisiko tinggi terhadap bug jika salah diimplementasikan pada fase awal.

## Keputusan
1. Menggunakan **metode persediaan periodik** untuk pencatatan stok.
2. Pembelian bahan baku dicatat sebagai aset: Dr `Persediaan Bahan Baku`, Cr Kas/Bank (`source = purchase`).
3. Pada akhir periode, pengguna melakukan *stok opname* fisik secara manual dan memasukkan **nilai rupiah** persediaan fisik per tanggal opname.
4. Sistem menghitung saldo buku akun Persediaan Bahan Baku per tanggal opname (saldo awal + pembelian - penyesuaian sebelumnya), lalu:
   - Jika saldo buku > nilai fisik: Dr `HPP`, Cr `Persediaan Bahan Baku` sebesar selisih.
   - Jika saldo buku < nilai fisik: Dr `Persediaan Bahan Baku`, Cr `HPP` sebesar selisih.
   - Jika sama, tidak ada jurnal.
   Jurnal diposting dengan `source = adjustment`. Karena selalu dihitung dari saldo buku terkini, opname kedua dalam periode yang sama tetap menghasilkan angka yang benar.
5. Akun Persediaan dan HPP ditemukan lewat `system_role` (ADR 011), bukan kode akun yang di-hardcode.
6. Tracking stok detail (per item, FIFO/LIFO/Average) ditunda ke fase pengembangan selanjutnya.

## Konsekuensi
### Positif:
- Menyederhanakan logika backend secara signifikan.
- Membantu pengguna (pemilik bisnis) untuk tetap melakukan kontrol fisik terhadap stok mereka.
- Mengurangi kompleksitas validasi transaksi pada saat input jurnal pembelian.

### Negatif:
- Stok tidak terpantau secara *real-time* di sistem.
- HPP baru diakui saat stok opname; sebelum opname, laba periode berjalan terlihat lebih tinggi. Dashboard dan laporan wajib menampilkan penanda "HPP belum disesuaikan" untuk periode tanpa jurnal stok opname.
- Bergantung sepenuhnya pada kedisiplinan pengguna untuk melakukan stok opname di akhir periode.
