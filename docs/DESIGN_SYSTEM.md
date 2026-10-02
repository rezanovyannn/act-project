# Design System

Gaya visual **terinspirasi** sistem desain marketing Pinterest (referensi dari user): chrome krem hangat yang tenang, satu warna aksen merah untuk aksi utama, dan geometri radius yang konsisten. Diadaptasi untuk aplikasi akuntansi yang padat data. Aplikasi ini **tidak** memakai nama, logo, maupun font proprietary Pinterest.

Implementasi: token di `src/app/globals.css` (Tailwind v4 `@theme`) dan komponen shadcn/ui yang disesuaikan (Sub-fase 1B).

## Prinsip
1. **Data adalah produk.** Chrome (navigasi, kartu, latar) mundur ke belakang agar angka dan tabel menonjol.
2. **Satu aksen.** Merah primer hanya untuk aksi utama (mis. "Posting Jurnal", "Simpan"), indikator tab/menu aktif, dan logo aplikasi. Maksimal satu tombol merah per area pandang.
3. **Tiga radius saja:** 16px, 32px, pill. Tidak ada sudut tajam pada elemen interaktif.
4. **Tanpa bayangan pada kartu.** Satu-satunya bayangan ada di modal/dialog.
5. **Hierarki dari ukuran & ketebalan huruf**, bukan dari warna.

## Warna

| Token | Nilai | Penggunaan |
|---|---|---|
| `primary` | `#e60023` | Tombol aksi utama, indikator aktif |
| `primary-pressed` | `#cc001f` | Tombol utama saat ditekan |
| `canvas` | `#ffffff` | Latar konten utama, tabel, modal |
| `surface-soft` | `#fbfbf9` | Latar halaman |
| `surface-card` | `#f6f6f3` | Kartu, sidebar, header tabel, input pencarian |
| `secondary-bg` | `#e5e5e0` | Tombol sekunder |
| `secondary-pressed` | `#c8c8c1` | Tombol sekunder ditekan |
| `hairline` | `#dadad3` | Garis pemisah baris tabel, border input |
| `ink` | `#000000` | Judul, teks tombol, angka total |
| `body` | `#33332e` | Teks isi, angka di tabel |
| `mute` | `#62625b` | Metadata, label kolom, teks bantuan |
| `ash` | `#91918c` | Placeholder, teks nonaktif |
| `error` | `#9e0a0a` | Pesan validasi, konfirmasi destruktif |
| `success-deep` / `success-pale` | `#103c25` / `#c7f0da` | Badge "Posted", pesan sukses |
| `focus` | `#435ee5` | Cincin fokus 2px (aksesibilitas) |

### Aturan warna khusus akuntansi
- **Angka negatif ditulis dalam kurung**, mis. `(Rp 1.250.000)`, berwarna `body`/`ink`, **bukan merah**, agar tidak bentrok dengan warna aksi utama.
- Status jurnal memakai badge netral:
  - Draft: `surface-card` + `mute`.
  - Posted: `success-pale` + `success-deep`.
  - Di-void: `secondary-bg` + `mute`, dengan teks dicoret.
- Peringatan (mis. "HPP belum disesuaikan", periode dibuka kembali) memakai banner `surface-card` dengan ikon dan teks `ink`. Warna `error` hanya dipakai untuk kesalahan.

## Tipografi
- Font: **Inter** (lewat `next/font/google`, tanpa dependency baru), bobot 400/500/600/700. Fallback: `system-ui, Segoe UI, Roboto, Arial`.
- **Semua angka memakai `font-variant-numeric: tabular-nums`** agar kolom angka sejajar.

| Token | Ukuran / Bobot / Line-height | Penggunaan |
|---|---|---|
| `display` | 36px / 700 / 1.15, tracking −0.8px | Judul halaman besar (jarang) |
| `heading-xl` | 28px / 700 / 1.2, tracking −1.2px | Judul halaman |
| `heading-lg` | 22px / 600 / 1.25 | Judul bagian, judul modal |
| `heading-md` | 18px / 600 / 1.3 | Judul kartu, angka metrik dashboard |
| `body-md` | 16px / 400 / 1.4 | Teks isi, form |
| `body-strong` | 16px / 600 / 1.4 | Label form, link navigasi |
| `body-sm` | 14px / 400 / 1.4 | Isi tabel, teks bantuan |
| `body-sm-strong` | 14px / 700 / 1.4 | Header tabel, baris total |
| `caption` | 12px / 500 / 1.5 | Metadata, badge |
| `button` | 14px / 700 / 1 | Label tombol |

## Bentuk & Jarak
- Radius: `md` 16px (tombol, input, kartu, tabel), `lg` 32px (modal, kartu ringkasan besar), `full` (chip, badge, avatar, pencarian).
- Unit dasar 8px. Skala: 4 · 8 · 12 · 16 · 24 · 32 · 64px. Jarak antarbagian besar 32px (aplikasi lebih padat daripada halaman marketing).

## Komponen
- **Tombol:** primer (merah), sekunder (`secondary-bg`), tersier (transparan). Tinggi 40px, padding 6px 14px, radius 16px.
- **Input:** latar `canvas`, border 1px `ash`, tinggi 44px, radius 16px. Fokus: border 2px `ink` + outline 4px `focus`. Input nominal rata kanan dengan prefix "Rp".
- **Chip filter:** default `surface-card`; aktif dibalik jadi `ink` dengan teks putih. Dipakai untuk filter status/sumber jurnal dan rentang periode.
- **Kartu metrik (dashboard):** `surface-card`, radius 16px, padding 24px, tanpa bayangan. Label `caption`/`mute`, angka `heading-md`.
- **Tabel:**
  - Latar `canvas` dalam wadah radius 16px; header `surface-card` dengan `body-sm-strong`.
  - Baris dipisah hairline, tanpa garis vertikal.
  - Kolom angka rata kanan dengan tabular-nums.
  - Baris total tebal dengan garis atas 2px `ink`.
- **Form jurnal multi-baris:** tabel yang bisa diedit (akun, keterangan, debit, kredit). Baris total selalu terlihat dengan indikator "Seimbang ✓" / "Selisih Rp …" sebelum tombol posting aktif.
- **Modal/dialog:** latar `canvas`, radius 32px, padding 32px, scrim 50%, bayangan lembut 16px.
- **Navigasi:**
  - Sidebar kiri berlatar `surface-card`, berisi workspace switcher di atas dan menu modul.
  - Item aktif ditandai garis/indikator merah dan teks `ink` tebal.
  - Header atas berlatar `canvas` dengan hairline bawah.

## Kerangka & Dashboard (redesign Oktober 2026)
Mengikuti mockup user (ROADMAP Catatan Keputusan 33–36). Bagian ini menggantikan aturan di atas bila bertentangan.

- **Sidebar:**
  - Urutan dari atas: logo, kartu workspace (avatar inisial), grup menu berlabel kapital kecil (*Menu utama*, *Persediaan*, *Sistem & pengaturan*), dan kartu pengguna di bawah (avatar inisial, email, peran "Pemilik", tombol keluar).
  - Item aktif berlatar `primary/10`, teks `primary` tebal, dan titik merah.
  - Badge angka merah hanya berisi data nyata, mis. jumlah tagihan belum lunas.
- **Top bar** (`canvas`, hairline bawah):
  - Pencarian global berbentuk pill (Ctrl/⌘+K) dan tombol **Jurnal baru** (satu-satunya tombol merah di kerangka).
  - Slot aksi halaman (`TOPBAR_SLOT_ID`), mis. pilih bulan & Ekspor di Dashboard.
  - Halaman tidak menduplikasi tombol Jurnal baru.
- **Footer:** hanya informasi yang benar (nama & versi aplikasi, basis akrual/SAK EMKM, lokasi data). Dilarang menampilkan klaim kepatuhan, status server, atau keamanan yang tidak diverifikasi.
- **Kartu KPI:**
  - Latar `canvas` + ring hairline, label `mute`, angka 24px tebal.
  - Chip rasio/pertumbuhan di kanan atas dan rincian dua baris di bawah garis.
  - Kartu laba bersih diberi aksen `primary/5`.
- **Grafik:**
  - Batang SVG/CSS tanpa dependency.
  - Kas masuk = `ink`, kas keluar = `primary`. Ini pengecualian aturan "satu aksen" dan hanya berlaku untuk grafik.
  - Wajib disertai tabel tersembunyi (`sr-only` pada pembungkus, bukan pada `<table>`) untuk pembaca layar.
- **Data, bukan karangan:** angka atau label tanpa sumber data (jumlah pesanan, jatuh tempo, patokan "batas aman", badge paket) tidak ditampilkan; gunakan metrik yang dihitung dari jurnal.

## Responsif
- Desktop (≥1024px): sidebar tetap + konten maksimal ~1280px.
- Tablet (768–1023px): sidebar menjadi drawer.
- Mobile (<768px): satu kolom. Tabel lebar bisa digulir horizontal di dalam wadahnya (halaman tidak ikut bergulir horizontal). Form jurnal ditampilkan per baris sebagai kartu.
- Target sentuh minimal 44×44px.

## Aksesibilitas
- Kontras teks memenuhi WCAG AA.
- Fokus keyboard selalu terlihat.
- Status tidak hanya dibedakan dengan warna (selalu ada teks/ikon).
