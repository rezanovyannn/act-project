# ADR 002: Multi-Workspace dan Immutable Template Type

## Konteks
Aplikasi akan digunakan untuk mengelola beberapa jenis proyek bisnis (dimulai dari F&B, dan ke depannya retail, manufaktur, dll.). Setiap jenis bisnis memiliki Chart of Accounts (CoA) standar dan kebutuhan modul yang berbeda.

## Keputusan
1. Semua tabel data bisnis (jurnal, akun, transaksi modul) wajib memiliki kolom `workspace_id`.
2. Setiap workspace memiliki atribut `template_type` (contoh: `fnb`, `retail`, `general`).
3. Atribut `template_type` bersifat **immutable** (tidak dapat diubah) setelah workspace dibuat.
4. Nilai `template_type` menentukan modul aktif dan meng-seed daftar Chart of Accounts (CoA) awal.
5. Pengguna bebas menambah, mengubah, atau merujuk akun dalam CoA awal tersebut setelah workspace dibuat.

## Konsekuensi
### Positif:
- Arsitektur sangat fleksibel untuk mendukung berbagai jenis industri tanpa perlu mengubah skema database utama.
- Menjaga integritas data: mencegah kerusakan struktur CoA jika template diubah secara tiba-tiba di tengah jalan.

### Negatif:
- Pengguna tidak bisa "mengubah jenis bisnis" workspace yang sudah berjalan; mereka harus membuat workspace baru jika ingin menggunakan jenis template lain.
