# ADR 013: Repository Supabase Berjalan di Browser (Anon Key + RLS)

## Konteks
ROADMAP Fase 2 mewajibkan keputusan tempat repository Supabase berjalan dicatat sebelum implementasi. Dua opsi dipertimbangkan:
- **A.** Browser langsung ke Supabase memakai Anon Key + sesi user, dilindungi RLS.
- **B.** Server Actions Next.js di Vercel sebagai perantara.

Arsitektur Fase 1 (semua halaman client component, container DI di browser, port async) dirancang agar repository mock bisa ditukar tanpa mengubah UI. Aplikasi dipakai satu pengguna per workspace dan akan di-deploy ke Vercel. Keputusan user: **Opsi A** (28 September 2026).

## Keputusan
1. **Repository Supabase** (`src/repositories/supabase/`) berjalan di browser memakai `@supabase/supabase-js` dengan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` serta token sesi user. `src/lib/container.ts` memilih mock atau Supabase; komponen UI tidak berubah.
2. **Service role key tidak pernah dipakai aplikasi**, baik di browser maupun di Vercel (AGENTS.md).
3. **Database adalah penjaga terakhir.** Validasi di `src/core/` tetap berjalan untuk pengalaman pengguna, tetapi karena kode browser bisa dilewati, semua aturan akuntansi diulang di database:
   - Penulisan jurnal **hanya lewat RPC** (`post_journal`, `save_journal_draft`, `delete_journal_draft`). Hak `INSERT`/`UPDATE`/`DELETE` langsung pada `journal_entries` dan `journal_lines` dicabut dari role `authenticated`.
   - Operasi multi-tabel lain juga lewat RPC atomik: pembuatan workspace beserta seed CoA & periode, dan perubahan status periode (menerima alasan untuk audit log).
   - RPC memakai `SECURITY INVOKER` sehingga RLS tetap berlaku, dan memvalidasi: Debit = Kredit, baris valid, periode terbuka, akun aktif & satu workspace, aturan void/koreksi, pelunasan (ADR 012), satu saldo awal aktif.
   - Trigger menolak `UPDATE`/`DELETE` pada jurnal posted dan barisnya.
   - Trigger mengisi `audit_logs` untuk mutasi workspace, akun, periode, dan jurnal; `audit_logs` hanya bisa dibaca oleh user.
4. **RLS aktif di semua tabel.** `workspaces.owner_id = auth.uid()`; tabel lain hanya dapat diakses bila `workspace_id` milik user tersebut. Dibuktikan dengan test dua user (User B tidak bisa membaca/menulis data User A).
5. **Autentikasi:** Supabase Auth dengan **email + kata sandi** (keputusan user, 29 September 2026). Sesi disimpan di cookie via `@supabase/ssr`; middleware Next.js memperbarui sesi dan mengarahkan pengguna yang belum login ke halaman login.
6. **Deploy:** Vercel hanya menyajikan aplikasi; lalu lintas data langsung browser ↔ Supabase. Proyek Supabase memakai region **Singapura** (terdekat dari Indonesia). Environment variable di Vercel hanya URL dan Anon Key (aman bersifat publik karena dilindungi RLS).
7. **Pengembangan & test:** Docker tidak dapat berjalan di laptop pengembang (komponen virtualisasi Windows belum terpasang), sehingga Supabase lokal diganti **proyek Supabase online khusus dev** (keputusan user, 29 September 2026), terpisah dari proyek production:
   - Skema di `supabase/migrations/`, dikirim ke proyek dev dengan `supabase db push` (tidak membutuhkan Docker).
   - Contract test yang sama (`src/repositories/__tests__/`) dijalankan terhadap mock dan proyek dev. Setiap test memakai workspace/akun uji unik agar data antar-run tidak bertabrakan.
   - Test RLS dua user mendaftarkan akun uji lewat Anon Key (konfirmasi email dimatikan **hanya di proyek dev**); service role key tetap tidak dipakai.
   - Kredensial dev disimpan di `.env.local` (diabaikan git). Supabase lokal via Docker boleh ditambahkan kelak tanpa mengubah kode, karena migrasinya sama.
8. Bila kelak dibutuhkan fitur yang harus di server (mis. ekspor PDF/backup di Fase 3), ditambahkan route handler yang tetap memakai sesi user dan RLS, tanpa mengubah keputusan ini.

## Konsekuensi
### Positif:
- Perubahan dari Fase 1 minimal: cukup menukar repository di `container.ts`, sesuai kriteria "UI berjalan tanpa perubahan kode komponen".
- Lebih cepat (satu jalur browser → Supabase, tanpa cold start fungsi server) dan hemat kuota Vercel.
- Keamanan terpusat di database (RLS + RPC + trigger) sehingga aturan tetap berlaku untuk klien mana pun.

### Negatif:
- Aturan validasi dipelihara di dua tempat (TypeScript dan PL/pgSQL); contract test yang sama menjaga keduanya tetap sinkron.
- Kesalahan policy RLS berdampak langsung pada keamanan data; wajib ditutup test RLS dua user.
- Laporan dihitung di browser dari seluruh jurnal; untuk volume sangat besar perlu optimasi (catatan ROADMAP Fase 2).
