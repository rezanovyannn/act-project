# ADR 001: Double-Entry Bookkeeping sebagai Fondasi Utama

## Konteks
Aplikasi ini ditujukan untuk kebutuhan akuntansi formal yang akurat. Pendekatan pencatatan keuangan sederhana (*single-entry*) sering kali menimbulkan ketidakseimbangan data, kesulitan penelusuran audit, dan ketidaksesuaian dengan standar akuntansi seperti SAK EMKM.

## Keputusan
Kami memutuskan untuk menggunakan sistem **Double-Entry Bookkeeping** secara mutlak.
- Setiap transaksi bisnis wajib menghasilkan *Journal Entry* yang terdiri dari minimal dua baris (*Journal Lines*): Debit dan Kredit.
- Total Debit harus selalu sama dengan Total Kredit.
- Tidak ada catatan transaksi yang berdiri sendiri di luar jurnal. Jurnal adalah *Single Source of Truth*.
- Operasi posting jurnal diproses secara atomik via `postJournal(entry)` di layer repository/database.

## Konsekuensi
### Positif:
- Integritas data keuangan terjamin sesuai standar akuntansi formal (SAK EMKM).
- Penyusunan Laporan Keuangan (Laba Rugi, Neraca, Arus Kas) dapat dilakukan secara dinamis dan konsisten dari data jurnal.
- Jejak audit (*audit trail*) menjadi sangat jelas.

### Negatif:
- Kompleksitas pengkodean di backend/core bertambah (perlu validasi ketat ganda di TypeScript dan Database RPC/Constraint).
- Pengalaman pengguna (UX) untuk form input harus dirancang dengan baik agar pengguna non-akuntan tetap merasa mudah (misal: otomatisasi pembuatan baris debit/kredit di balik layar form pembelanjaan/penjualan).
