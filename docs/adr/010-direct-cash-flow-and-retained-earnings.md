# ADR 010: Metode Arus Kas Langsung, Laba Ditahan Pra-Tutup Buku, dan Perubahan Modal

## Konteks
Penyusunan Laporan Arus Kas dan Laporan Posisi Keuangan (Neraca) memerlukan ketepatan metode akuntansi, khususnya dalam mengklasifikasikan arus kas masuk/keluar secara langsung serta memperhitungkan sisa laba tahun berjalan dan akumulasi laba tahun-tahun sebelumnya sebelum proses tutup buku resmi dilakukan.

## Keputusan
1. **Metode Arus Kas Langsung (*Direct Method*):**
   - Akun kas/bank ditandai `is_cash = true`. **Semua akun** (termasuk pendapatan dan beban) memiliki `cash_flow_category`; akun pendapatan, HPP, dan beban umumnya `operating`.
   - Hanya jurnal posted yang memiliki minimal satu baris akun kas yang diproses.
   - Untuk setiap jurnal tersebut, **setiap baris akun non-kas** menyumbang arus kas sebesar `kredit - debit` baris itu, diklasifikasikan menurut `cash_flow_category` akun baris tersebut. Positif = kas masuk, negatif = kas keluar.
   - Karena jurnal selalu balance, jumlah sumbangan baris non-kas = perubahan kas bersih jurnal itu. Aturan ini berlaku juga untuk jurnal majemuk dan jurnal dengan lebih dari satu akun kas, tanpa alokasi proporsional.
   - **Transfer antar-kas** (jurnal yang seluruh barisnya akun kas) tidak menghasilkan aktivitas.
   - **Jurnal `opening_balance` bukan aktivitas**: mutasi kasnya menjadi bagian dari saldo kas awal.
   - Baris non-kas dengan kategori `none` pada jurnal yang menyentuh kas dianggap kesalahan konfigurasi dan ditampilkan sebagai peringatan di laporan (tetap dijumlahkan di baris "Tidak terklasifikasi" agar invarian terjaga).
   - Keterbatasan: jurnal yang mencampur transaksi kas dan non-kas akan menampilkan pos non-kas secara bruto. Form input cepat selalu menghasilkan jurnal terpisah per transaksi.
   - Invarian wajib: saldo kas awal + arus kas bersih = saldo akhir kas, dan sama persis dengan total saldo akun `is_cash` di Neraca.

2. **Akumulasi Laba Sebelum Tutup Buku (tahun buku = tahun kalender):**
   - **Laba Tahun Berjalan** = total saldo akun pendapatan, HPP, dan beban dari jurnal bertanggal 1 Januari tahun laporan sampai tanggal laporan.
   - **Laba Ditahan** = saldo akun `Laba Ditahan` + total saldo akun pendapatan, HPP, dan beban dari jurnal bertanggal sebelum 1 Januari tahun laporan.
   - Setelah tutup buku (Fase 3), jurnal penutup (`source = closing`) memindahkan saldo akun nominal ke `Laba Ditahan`, sehingga rumus di atas tetap menghasilkan angka yang sama.
   - Laporan Laba Rugi **mengecualikan jurnal `closing`** agar laba tahun yang sudah ditutup tidak menjadi nol.
   - Pengujian wajib memakai dataset minimal 2 tahun buku.

3. **Laporan Perubahan Modal:**
   - Saldo Awal Ekuitas + Setoran Modal + Laba Bersih - Prive = Saldo Akhir Ekuitas.
   - Setoran modal dan prive diidentifikasi lewat `system_role` akun (`owner_capital`, `drawings`); saldo awal ekuitas termasuk akun Ekuitas Saldo Awal.
   - Saldo Akhir Ekuitas wajib sama dengan total ekuitas di Neraca.

## Konsekuensi
### Positif:
- Memberikan visibilitas aliran kas aktual secara transparan kepada pengguna.
- Aturan klasifikasi arus kas deterministik dan selalu memenuhi invarian saldo kas.
- Memastikan laporan Neraca selalu balance (*Aset = Liabilitas + Ekuitas*) kapanpun laporan ditarik, terlepas dari apakah proses tutup buku akhir tahun sudah dijalankan atau belum.

### Negatif:
- Kompleksitas perhitungan di *core reporting engine* sedikit meningkat karena perlu menelusuri baris non-kas pada setiap jurnal kas.
- Kebenaran klasifikasi bergantung pada pengaturan `cash_flow_category` akun oleh pengguna.
