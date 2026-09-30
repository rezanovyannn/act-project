# ADR 015: Template Retail dan Modularitas Template

## Konteks
ROADMAP Fase 4 memvalidasi modularitas multi-template (ADR 002) dengan menambah template kedua, `retail`. Sebelumnya beberapa hal khas F&B tertanam di bagian bersama: peran akun `raw_material_inventory` (Persediaan Bahan Baku), istilah "PB1" di form penjualan/setoran/dashboard, dan logika persediaan periodik di modul `fnb`.

Keputusan user (29–30 September 2026):
- Fase 4 dipecah: **4A** template Retail + persediaan periodik umum + label pajak; **4B** mode PPN lengkap (Keluaran & Masukan); **4C** persediaan perpetual per barang.
- Metode persediaan dan mode pajak kelak dipilih di Pengaturan per workspace, berlaku untuk **semua template**, dan boleh diubah **kapan saja** (aturan transisinya ditetapkan di 4B/4C).
- CoA Retail menyertakan Retur & Potongan Penjualan, Beban Angkut Pembelian, dan Beban Kemasan; akun template juga bisa ditambahkan dari Pengaturan.
- Logika persediaan yang sama untuk semua template dipindahkan ke `src/core`.

## Keputusan (Fase 4A)
1. **Template kedua `retail`** (`src/modules/retail/template.ts`), label "Retail (Toko)". Didaftarkan di `src/lib/container.ts` bersama F&B; `template_type` di database menerima `fnb` dan `retail`.
2. **Metadata template** (`WorkspaceTemplate`): selain CoA, template menentukan istilah persediaan (`inventoryNoun`: "bahan baku" / "barang dagang") dan pengaturan pajak awal (`salesTaxDefaults`). Engine akuntansi tidak berubah.
3. **Peran persediaan umum:** `system_role` `raw_material_inventory` diganti `inventory` (migrasi mengubah data lama dan tercatat di audit log sebagai perubahan oleh sistem). Metode persediaan periodik ADR 007 berlaku untuk semua template lewat `src/core/inventory.ts`; UI-nya modul `src/modules/inventory` (route `/inventory/purchases` dan `/inventory/stock-opname`).
4. **Label pajak penjualan per workspace:** kolom `sales_tax_label` (`PB1` | `PPN`), mekanisme sama dengan ADR 012 (pajak dipungut dicatat sebagai utang, bukan pendapatan). Default F&B: PB1 10%; default Retail: PPN 0% (non-PKP). Label, tarif, dan mode harga dapat diubah di dialog pengaturan pajak dan berlaku untuk transaksi baru. PPN Masukan belum dicatat terpisah (4B).
5. **CoA Retail:** Kas, Bank, Persediaan Barang Dagang (`inventory`), Piutang Usaha, Peralatan Toko, Akumulasi Penyusutan, Utang Usaha, Utang PPN (`sales_tax_payable`), Utang Bank, akun ekuitas standar (Modal, Prive, Laba Ditahan, Ikhtisar Laba Rugi, Ekuitas Saldo Awal), Penjualan Barang Dagang, **Retur & Potongan Penjualan** (pendapatan kontra, saldo normal debit), HPP Barang Dagang, dan beban umum termasuk **Beban Angkut Pembelian** dan **Beban Kemasan** (beban operasional).
6. **Akun dari template:** Pengaturan → Daftar Akun → "Tambah dari template" menampilkan akun template yang kodenya belum dipakai dan, untuk akun sistem, perannya belum dimiliki akun lain (termasuk yang pernah dihapus), lalu membuatnya beserta perannya.
7. **Satu peran sistem per akun aktif:** penambahan akun dengan peran yang sudah dipakai ditolak (`SYSTEM_ACCOUNT`), dan akun sistem tidak dapat dihapus, baik di mock maupun database.

## Konsekuensi
### Positif:
- Template baru cukup mendaftarkan CoA dan metadata; laporan, tutup buku, jurnal, dan persediaan periodik dipakai ulang tanpa perubahan engine.
- Workspace F&B dan Retail terisolasi: CoA, istilah, dan pajak awal masing-masing.

### Negatif:
- Label pajak hanya mengubah nama; PPN untuk PKP yang mengkreditkan PPN Masukan baru didukung di 4B.
- Beban Angkut Pembelian dicatat sebagai beban operasional, bukan bagian nilai persediaan/HPP; bila ingin masuk HPP, user dapat mengubah jenis akun selama belum dipakai jurnal.
