# ADR 019: Lupa Kata Sandi & "Ingat Perangkat Ini"

## Konteks
Halaman login didesain ulang mengikuti mockup user (2 Oktober 2026, ROADMAP Catatan Keputusan 37–40). Mockup memuat tautan "Lupa kata sandi?" dan kotak centang "Ingat perangkat ini". User memutuskan:
- Keduanya dibuat lengkap dengan fungsinya, bukan sekadar tampilan.
- Login Google belum dibuat (tetap email + kata sandi, ADR 013).

## Keputusan
1. **Lupa kata sandi** memakai Supabase Auth:
   - `/forgot-password` mengirim email berisi tautan ke `/reset-password` (`resetPasswordForEmail` dengan `redirectTo` = origin aplikasi + `/reset-password`).
   - Klien browser (alur PKCE @supabase/ssr) menukar kode di tautan menjadi sesi pemulihan.
   - `/reset-password` meminta kata sandi baru (minimal 8 karakter, diulang) lalu `updateUser({ password })`, kemudian masuk ke aplikasi.
   - Pesan setelah meminta tautan tidak mengungkap apakah email terdaftar.
   - Tautan harus dibuka **di browser yang sama** tempat permintaan dibuat (verifier PKCE disimpan di cookie browser itu). Bila tidak, halaman meminta tautan baru.
   - `/forgot-password` dan `/reset-password` adalah halaman publik; `/reset-password` tetap boleh dibuka saat sudah login (sesi pemulihan).
   - Redirect URL production (`https://<app>.vercel.app/**`) sudah mencakup `/reset-password` (ADR 018).
2. **"Ingat perangkat ini"** (default dicentang):
   - **Dicentang:** cookie sesi Supabase berumur panjang seperti sebelumnya (bawaan @supabase/ssr: 400 hari, diperbarui otomatis).
   - **Tidak dicentang:** cookie sesi ditulis tanpa `Max-Age`/`Expires` (cookie sesi browser) sehingga terhapus saat browser ditutup.
   - Pilihan disimpan di cookie penanda `act-remember=0` (juga cookie sesi) dan dihormati di dua tempat yang menulis cookie: klien browser (`getAll`/`setAll` kustom) dan proxy server (`applyRemember` saat memperbarui token).
   - Keluar menghapus penanda.
   - Logika murni di `src/lib/supabase/session-cookies.ts` beserta unit test.

## Konsekuensi
### Positif:
- Pemilik bisa memulihkan akses tanpa membuka dashboard Supabase.
- Pemakaian di komputer bersama aman dengan tidak mencentang "Ingat perangkat ini".

### Negatif:
- Email bawaan Supabase dibatasi jumlahnya per jam dan hanya untuk alamat yang diizinkan proyek. Untuk pemakaian luas perlu SMTP sendiri (Supabase → Authentication → Emails → SMTP).
- Fitur "lanjutkan sesi sebelumnya" pada sebagian browser dapat memulihkan cookie sesi, sehingga sesi tanpa centang bisa bertahan setelah browser dibuka ulang. Ini perilaku browser, di luar kendali aplikasi.
