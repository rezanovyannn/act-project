# ADR 004: Pemilihan Supabase & RLS Berbasis Workspace ID untuk Single User

## Konteks
Aplikasi membutuhkan database relasional yang kuat (PostgreSQL) untuk integritas transaksi akuntansi, sistem autentikasi pengguna, dan kontrol isolasi data per workspace, namun tetap simpel dan efisien untuk penggunaan pribadi (*single-user* per workspace).

## Keputusan
1. Menggunakan **Supabase** (PostgreSQL) sebagai penyedia database dan autentikasi.
2. Setiap workspace diasosiasikan dengan satu pengguna pemilik melalui kolom `owner_id` (merujuk ke `auth.users.id`).
3. Mengaktifkan **Row Level Security (RLS)** pada seluruh tabel transaksi dan akun:
   - Kebijakan RLS memvalidasi bahwa `workspace_id` dari baris yang diakses dimiliki oleh `auth.uid()`.
4. Tidak menggunakan sistem role kompleks (RBAC) pada fase ini karena model penggunaan adalah single-user.
5. Kredensial rahasia (*service role key*) dilarang keras terekspos ke sisi client; seluruh akses client hanya menggunakan Supabase Anon Key dengan proteksi RLS aktif.

## Konsekuensi
### Positif:
- Arsitektur keamanan data antar-workspace dan antar-user sangat kuat langsung di level database.
- Struktur model data tetap sederhana tanpa tabel pivot hak akses/role yang rumit.

### Negatif:
- Setiap query data wajib menyertakan konteks `workspace_id` agar filter dan RLS dapat bekerja secara optimal.
