# ADR 018: Deploy Production (Vercel + Supabase)

## Konteks
Fase 1–4 selesai dan diuji terhadap mock serta proyek Supabase dev. ADR 013 menetapkan arsitektur deploy: Vercel hanya menyajikan aplikasi, data mengalir langsung browser ↔ Supabase (RLS), dan proyek production terpisah dari dev. Keputusan user (30 September 2026):
- Deploy lewat repository GitHub privat yang di-import ke Vercel.
- Pendaftaran akun ditutup setelah akun pemilik dibuat.
- Alamat awal memakai subdomain `vercel.app`.
- Tahap ini dicatat sebagai ROADMAP Fase 5.

## Keputusan
1. **Sumber kode:** repository GitHub **privat**. Vercel meng-import repository tersebut; setiap push ke `main` men-deploy production, branch lain menjadi preview.
2. **Proyek Supabase production** terpisah dari dev, region Singapura. Skema dibuat dengan migrasi yang sama (`supabase/migrations/`) lewat `pnpm db:prod db push` dari laptop, memakai `SUPABASE_PROD_DB_URL` di `.env.local` (tidak pernah disimpan di Vercel atau git).
3. **Environment variable Vercel:** hanya `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` proyek production, plus `NEXT_PUBLIC_ALLOW_SIGNUP=false` setelah akun pemilik dibuat. Service role key tidak pernah dipakai (AGENTS.md).
4. **Pengaman konfigurasi:** build production tanpa URL & anon key Supabase menampilkan halaman "Konfigurasi belum lengkap", tidak diam-diam memakai data contoh di browser. Data contoh di production hanya bila `NEXT_PUBLIC_DATA_SOURCE=mock` diisi dengan sengaja.
5. **Pendaftaran ditutup** dua lapis:
   - Supabase Auth "Allow new users to sign up" dimatikan setelah akun pemilik dibuat (penegakan sebenarnya).
   - `NEXT_PUBLIC_ALLOW_SIGNUP=false` menyembunyikan halaman & tautan Daftar.
6. **Supabase Auth URL Configuration:** Site URL dan Redirect URLs diisi alamat `vercel.app` production.
7. **Proyek dev tetap** untuk pengembangan & `pnpm test:supabase`; data uji tidak pernah menyentuh production.

## Konsekuensi
### Positif:
- Deploy otomatis dan dapat ditelusuri dari riwayat git; preview per branch sebelum masuk production.
- Kesalahan konfigurasi terlihat jelas, bukan kehilangan data diam-diam.

### Negatif:
- Migrasi production dijalankan manual dari laptop (bukan otomatis saat deploy), sehingga urutan "migrasi dulu, lalu push kode" harus dijaga saat ada perubahan skema.
- Menambah pengguna baru kelak memerlukan membuka kembali pendaftaran sementara (atau undangan dari dashboard Supabase).
