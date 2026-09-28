# ADR 008: Atomic Journal Posting via Database RPC

## Konteks
Aplikasi akuntansi menuntut integritas data yang tinggi, terutama pada operasi posting jurnal yang melibatkan penulisan header dan baris (line items) secara bersamaan. Jika terjadi kegagalan sebagian (misal: header berhasil tapi baris gagal), data akan korup dan tidak balance.

## Keputusan
1. Repository tidak memisahkan operasi header dan baris; jurnal selalu disimpan sebagai satu kesatuan (header + lines).
2. Operasi pada port `IJournalRepository`:
   - `saveDraft(entry)`: membuat atau mengganti draft (header + lines) secara atomik. Tanpa nomor jurnal dan tanpa validasi periode.
   - `deleteDraft(id)`: soft delete draft.
   - `postJournal(entry)`: menerima jurnal baru atau draft yang ada (lewat `id`), lalu dalam **satu transaksi**: memvalidasi, memberi nomor jurnal, mengubah status menjadi `posted`, dan menyimpan header & lines.
3. Di database, `postJournal` diimplementasikan sebagai **Postgres RPC** (`post_journal`) yang membungkus seluruh operasi dalam satu *database transaction*.
4. Validasi di dalam RPC (lapisan pertahanan terakhir, selain validasi di `src/core/`): Debit = Kredit, minimal 2 baris, tiap baris hanya debit atau kredit > 0, periode terbuka, akun aktif (kecuali jurnal pembalik), dan akun milik workspace yang sama.
5. Nomor jurnal diberikan hanya saat posting, berurutan per workspace per tahun buku (format tampilan diputuskan di 1B, mis. `JU-2026-0001`). Draft tidak memiliki nomor.
6. Implementasi mock meniru perilaku yang sama (validasi dilakukan sebelum menulis ke `localStorage`, sehingga tidak ada penulisan parsial).

## Konsekuensi
### Positif:
- Menjamin database tidak pernah dalam kondisi *unbalanced* atau *partial write*.
- Meningkatkan performa dengan mengurangi *round-trip* komunikasi client-server untuk operasi multi-tabel.
- Nomor jurnal posted tidak bolong akibat draft yang dihapus.

### Negatif:
- Membutuhkan penulisan skrip PL/pgSQL atau fungsi SQL di migrasi database, yang sedikit lebih kompleks dibanding operasi `INSERT` standar.
- Validasi harus dijaga sinkron antara `src/core/` dan RPC; contract test yang sama mengawal keduanya.
