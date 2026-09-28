# ADR 009: Semantik CRUD pada Jurnal dan Akun

## Konteks
Aplikasi membutuhkan aturan ketat mengenai modifikasi data yang sudah ada guna mencegah hilangnya jejak audit dan rusaknya keseimbangan neraca.

## Keputusan
1. **Jurnal Umum:**
   - Jurnal berstatus **Draft**: Bebas di-edit atau dihapus (soft delete). Tanggal bebas; validasi periode saat posting.
   - Jurnal berstatus **Posted**: Dilarang di-edit atau dihapus secara langsung (termasuk barisnya).
   - Perubahan pada jurnal `Posted` wajib dilakukan melalui:
     - **Void**: Membuat satu jurnal pembalik (*reversing entry*, `source = reversal`) yang menukar debit dan kredit setiap baris jurnal asal untuk menihilkan transaksi.
     - **Koreksi**: Membuat jurnal pembalik sekaligus men-generate jurnal `Draft` baru berisi salinan jurnal asal untuk diperbaiki pengguna. Draft tersebut menyimpan tautan `correction_of` ke jurnal asal.
   - Jurnal pembalik memakai tanggal di periode `open` (bukan tanggal jurnal asli) dan ditautkan ke jurnal asal lewat `reversal_of`.
   - Status "Di-void" **tidak disimpan** pada jurnal asal (jurnal asal tetap immutable); status diturunkan dari adanya jurnal pembalik yang merujuknya.
   - Satu jurnal hanya boleh dibalik satu kali (`reversal_of` unik). Jurnal pembalik tidak dapat di-void/dikoreksi; kesalahan berikutnya diperbaiki dengan jurnal baru.
   - Jurnal `opening_balance` dan `closing` dapat di-void dengan aturan yang sama.
2. **Chart of Accounts (CoA):**
   - Akun yang belum memiliki mutasi jurnal (posted maupun draft) boleh dihapus (soft delete).
   - Akun yang sudah pernah direferensikan oleh baris jurnal tidak boleh dihapus. Akun tersebut hanya dapat dinonaktifkan (`is_active = false`) agar tidak muncul di pilihan form input masa depan, namun tetap muncul di laporan historis.
   - Posting yang memakai akun nonaktif ditolak, kecuali jurnal pembalik (agar void tetap bisa dilakukan).
   - Akun dengan `system_role` (ADR 011) tidak boleh dihapus atau dinonaktifkan selama modul yang membutuhkannya aktif.
   - Akun yang sudah dipakai jurnal (dan akun sistem) tidak boleh diubah jenis akun, saldo normal, maupun status kas/bank-nya karena mengubah arti angka historis; kode, nama, dan kategori arus kas boleh diubah.
   - Akun kas/bank harus berjenis aset dan kategori arus kasnya `none`.
3. **Validasi Tanggal:**
   - Tanggal jurnal saat posting harus berada dalam rentang periode berstatus **Open** (ADR 006).

## Konsekuensi
### Positif:
- Keamanan audit terjaga; tidak ada angka di masa lalu yang berubah tanpa jejak transaksi pembalik.
- Integritas data laporan keuangan terjamin.

### Negatif:
- Alur kerja untuk memperbaiki kesalahan input pada jurnal `Posted` sedikit lebih panjang bagi pengguna (memerlukan proses void/koreksi).
- Status "Di-void" harus dihitung saat query (join ke jurnal pembalik).
