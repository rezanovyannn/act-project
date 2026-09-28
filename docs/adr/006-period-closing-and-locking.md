# ADR 006: Tutup Buku dan Penguncian Periode (Period Closing & Locking)

## Konteks
Dalam akuntansi, catatan pada periode yang sudah ditutup atau dilaporkan tidak boleh diubah sembarangan guna menjaga integritas laporan historis dan mencegah manipulasi data masa lalu.

## Keputusan
1. Sistem menerapkan manajemen periode akuntansi bulanan per workspace (tabel `periods`: `workspace_id`, `start_date`, `end_date`, `status`).
2. Tahun buku = tahun kalender (Januari–Desember).
3. Saat workspace dibuat, periode di-seed berstatus `open` dari bulan tanggal mulai pembukuan sampai Desember tahun tersebut. Periode tahun berikutnya dibuat user lewat halaman Periode (12 periode sekaligus).
4. Periode dapat berstatus `open` (terbuka untuk transaksi) atau `closed` (dikunci).
5. Posting jurnal yang tanggalnya berada pada periode `closed`, **atau tidak berada di periode mana pun**, ditolak oleh validasi aplikasi dan database. Jurnal draft boleh bertanggal apa saja; validasi dilakukan saat posting.
6. Koreksi atas kesalahan pada periode tertutup wajib dilakukan melalui jurnal penyesuaian (*adjusting entry*) atau jurnal pembalik (*reversing entry*) pada periode yang sedang `open`.
7. Setiap perubahan status periode dicatat di audit log.
8. Periode `closed` **boleh dibuka kembali** (keputusan user, 28 September 2026). Pembukaan kembali wajib disertai alasan tertulis, dicatat di audit log (siapa, kapan, alasan), dan UI menampilkan peringatan bahwa laporan periode tersebut yang pernah diterbitkan dapat berubah.
9. Penguncian periode (bulanan) berbeda dengan tutup buku akhir tahun (jurnal penutup, Fase 3, ADR 010).

## Konsekuensi
### Positif:
- Menjamin konsistensi historis laporan keuangan dari waktu ke waktu.
- Mengikuti standar kepatuhan akuntansi (SAK EMKM).

### Negatif:
- Pengguna harus berhati-hati dalam menutup periode karena jika ada koreksi, prosesnya memerlukan jurnal khusus, bukan langsung mengedit data lama.
- Pengguna harus membuat periode tahun baru sebelum bisa memposting transaksi di tahun tersebut.
- Karena periode bisa dibuka kembali, penguncian bersifat kontrol proses (dengan jejak audit), bukan jaminan mutlak bahwa angka historis tidak berubah.
