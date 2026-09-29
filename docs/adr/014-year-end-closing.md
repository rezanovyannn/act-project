# ADR 014: Tutup Buku Akhir Tahun

## Konteks
ROADMAP Fase 3 meminta otomatisasi tutup buku: menutup akun nominal ke Ikhtisar Laba Rugi / Laba Ditahan. ADR 010 sudah menetapkan bahwa laporan tetap benar sebelum maupun sesudah tutup buku, dan Laba Rugi mengecualikan jurnal penutup. Keputusan user (29 September 2026): Prive ditutup ke Laba Ditahan, penutupan lewat akun Ikhtisar Laba Rugi, dan periode tahun tersebut dikunci otomatis.

## Keputusan
1. **Akun baru:** `Ikhtisar Laba Rugi` (ekuitas, saldo normal kredit, kategori arus kas `none`, `system_role = income_summary`). Ditambahkan ke template F&B; untuk workspace lama dibuat otomatis saat tutup buku pertama.
2. **Jurnal penutup** (`source = closing`), semuanya bertanggal **31 Desember** tahun buku, hanya atas **mutasi tahun tersebut**:
   1. Penutupan pendapatan: Dr setiap akun pendapatan, Cr Ikhtisar Laba Rugi.
   2. Penutupan HPP & beban: Dr Ikhtisar Laba Rugi, Cr setiap akun HPP & beban.
   3. Penutupan Ikhtisar Laba Rugi ke Laba Ditahan (laba: Dr Ikhtisar, Cr Laba Ditahan; rugi: sebaliknya).
   4. Penutupan Prive ke Laba Ditahan: Dr Laba Ditahan, Cr Prive.

   Akun bersaldo tidak normal ditutup ke arah sebaliknya; jurnal yang tidak punya mutasi dilewati.
3. **Atomik:** keempat jurnal diposting dan seluruh periode bulanan tahun itu dikunci dalam **satu transaksi** (RPC `close_fiscal_year`). Database menolak bila hasilnya tidak menolkan semua akun nominal & Prive tahun itu serta Ikhtisar Laba Rugi.
4. **Syarat:** periode Desember tahun itu harus `open`, dan belum ada tutup buku aktif untuk tahun tersebut (satu tutup buku aktif per tahun).
5. **Pembatalan hanya sebagai paket:** jurnal penutup tidak dapat di-void/dikoreksi satu per satu. Fitur **Batalkan tutup buku** membalik seluruh jurnal penutup tahun itu secara atomik, bertanggal 31 Desember tahun yang sama (Desember harus dibuka kembali dulu dengan alasan, ADR 006). Pembalik ini tidak boleh bertanggal di tahun berikutnya karena akan memindahkan laba lama ke Laba Rugi tahun baru.
6. **Laporan** (melengkapi ADR 010): Laba Rugi, ringkasan dashboard, serta setoran modal & prive di Perubahan Modal mengecualikan jurnal penutup **dan pembaliknya**. Neraca Saldo, Neraca, Buku Besar, dan Arus Kas tetap memakai semua jurnal posted.
7. **Koreksi tahun yang sudah ditutup** dilakukan lewat jurnal penyesuaian di periode terbuka (termasuk ke Laba Ditahan), bukan dengan membatalkan tutup buku, kecuali tutup buku dilakukan karena kesalahan.

## Konsekuensi
### Positif:
- Setelah tutup buku, akun pendapatan/HPP/beban/Prive mulai dari nol di tahun baru, Laba Ditahan memuat akumulasi laba bersih setelah prive, dan kelima invarian laporan tetap terpenuhi.
- Database menjamin tutup buku lengkap dan tidak dapat diubah sebagian.

### Negatif:
- Menambah satu akun sistem (Ikhtisar Laba Rugi) dan logika pengecualian jurnal penutup di laporan.
- Membatalkan tutup buku memerlukan langkah tambahan (membuka kembali Desember).
