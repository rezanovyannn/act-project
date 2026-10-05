# ADR 023: Pulihkan Workspace dari Backup JSON

## Konteks
Backup JSON (ROADMAP Fase 3, diperluas di ADR 020–022) selama ini hanya bisa diunduh. User (5 Oktober 2026) meminta fitur memulihkan backup dan memutuskan (ROADMAP Catatan Keputusan 63–64):
- backup dipulihkan sebagai **workspace baru**; workspace lain tidak pernah ditimpa;
- isi dipertahankan **persis**: nomor & tanggal jurnal, jurnal posted/draft/void, status periode (terkunci/terbuka), tutup buku, faktur, stok opname, menu/resep, kontak, profil usaha.

## Keputusan
1. **Tempat:** tombol *Pulihkan backup* di halaman Workspace Saya. File JSON dibaca dan divalidasi di browser lebih dulu (ringkasan isi + daftar masalah), lalu user memberi nama workspace baru (default `"{nama} (pulihan {tanggal})"`).
2. **Validasi (core, sebelum dikirim):** format `act-project/workspace-backup` versi 1; bagian yang lebih baru (stok opname, menu, resep, rekap, penjualan menu, profil, kontak, faktur) boleh tidak ada (dianggap kosong) agar backup lama tetap bisa dipulihkan; template dikenal; setiap jurnal posted bernomor, minimal 2 baris, tiap baris tepat satu sisi > 0 (bilangan bulat), **debit = kredit**; semua rujukan (akun, barang, jurnal asal pelunasan/pembalik/koreksi/retur, menu, bahan resep, kontak, jurnal faktur & stok opname) menunjuk data di backup yang sama. Masalah apa pun → ditolak (`INVALID_BACKUP`) tanpa menulis apa pun.
3. **Penulisan (RPC `restore_workspace`, atomik):** pemilik = user yang login; ID baru diturunkan deterministik dari ID lama + ID workspace baru (`md5(baru || lama)::uuid`) sehingga semua relasi tetap utuh tanpa tabel pemetaan. Jurnal disisipkan berurutan menurut waktu posting/pembuatan (jurnal asal sebelum pembalik/pelunasan) dengan penanda posting yang sama seperti `post_journal`; keseimbangan diperiksa ulang di database. Bila satu langkah gagal, seluruh pemulihan dibatalkan.
4. **Audit:** trigger audit dinonaktifkan selama pemulihan (penanda transaksi `app.restoring`) agar tidak muncul ribuan catatan "dibuat". Riwayat audit dari backup disalin apa adanya (waktu, aksi, alasan, snapshot) dengan `entity_id` dipetakan ke ID baru, lalu ditambah satu catatan **`restore`** pada workspace berisi tanggal ekspor backup.
5. **Tidak ikut dipulihkan:** data yang sudah dihapus (soft delete) memang tidak ada di backup; pemilik lama (`owner_id`) diganti pemilik sekarang.

## Konsekuensi
### Positif:
- Backup benar-benar dapat dipakai untuk pemulihan maupun pindah akun, tanpa risiko menimpa data.
- Laporan workspace pulihan identik dengan saat backup dibuat.

### Negatif:
- Snapshot `before/after` di riwayat audit lama masih memuat ID lama (hanya informasi historis).
- Backup sangat besar dikirim dalam satu permintaan; dibatasi ukuran unggah browser/server.
