# ADR 021: Menu, Resep Berversi & Variance Theoretical vs Actual

## Konteks
ADR 020 (Fase 6A) menghasilkan COGS aktual per bahan dari stok opname sisa bahan. Fase 6B membandingkannya dengan **theoretical cost**: bahan yang seharusnya terpakai menurut porsi menu terjual × resep. User (3 Oktober 2026) memutuskan:
- porsi terjual bersumber dari **rekap per periode** (input/import) **dan** dari **form penjualan per menu** (ROADMAP Catatan Keputusan 48);
- form penjualan per menu **sekaligus membuat jurnal penjualan** (pendapatan + PB1, tunai/kredit);
- bila suatu tanggal dicakup rekap, **rekap menggantikan** penjualan menu tanggal itu (tidak dijumlahkan);
- harga bahan theoretical **sama dengan harga stok opname** periode itu (rata-rata/terakhir sesuai Pengaturan);
- resep punya **riwayat per tanggal berlaku**; periode lama tetap memakai resep lama.

Keputusan tercatat di ROADMAP Catatan Keputusan 49–52.

## Keputusan
1. **Menu** (khusus template F&B): kode unik per workspace, nama, kategori bebas, harga jual default per porsi (integer rupiah, mengikuti pengaturan PB1 termasuk/belum), akun pendapatan, aktif/nonaktif. Menu yang sudah punya penjualan aktif atau rekap aktif tidak bisa dihapus (`MENU_IN_USE`), hanya dinonaktifkan; menu nonaktif ditolak di penjualan menu (`MENU_INACTIVE`).
2. **Resep berversi:** setiap versi = tanggal berlaku, "resep untuk N porsi" (bilangan bulat 1–1.000.000), dan daftar bahan dengan qty **bilangan bulat satuan dasar** untuk N porsi (sehingga ½ butir telur ditulis 1 butir untuk 2 porsi). Qty per porsi = qty ÷ N, tidak disimpan sebagai pecahan. Versi yang berlaku pada tanggal D = tanggal berlaku terbesar ≤ D. Menyimpan versi dengan tanggal berlaku yang sama mengganti versi lama (soft delete, tercatat audit). Bahan yang dipakai resep aktif tidak bisa dihapus (`ITEM_IN_USE`).
3. **Penjualan menu:** jurnal dibentuk dengan `buildSale` (Dr Kas/Bank/Piutang, Cr akun pendapatan menu per baris "Nama × porsi", Cr Utang PB1/PPN), `source = revenue`. Rincian porsi (`menu_sale_lines`: menu, porsi, nominal) disimpan **atomik** bersama jurnal lewat RPC `post_menu_sale`; validasi periode/akun/keseimbangan sama dengan posting biasa. Status aktif diturunkan dari jurnal: penjualan yang jurnalnya di-void tidak dihitung. Koreksi = void lalu input ulang.
4. **Rekap porsi:** rentang tanggal [dari, sampai] + porsi per menu (> 0; baris 0 dibuang) + catatan. Rentang rekap aktif **tidak boleh bertumpuk** (`INVALID_PORTION_SUMMARY`). Template CSV/Excel: Kode Menu | Nama Menu | Kategori | Porsi, dicocokkan lewat kode menu.
5. **Porsi per periode stok opname** (setelah stok opname aktif sebelumnya s.d. tanggal stok opname):
   - rekap dihitung bila **tanggal akhirnya** ada di periode; versi resep dipilih pada tanggal akhir rekap; bila tanggal awalnya sebelum stok opname sebelumnya, seluruh porsinya tetap dihitung di periode ini dengan peringatan;
   - penjualan menu dihitung bila tanggalnya di periode **dan tidak dicakup rekap mana pun**; versi resep dipilih pada tanggal penjualan.
6. **Theoretical per bahan** = Σ porsi × qty resep ÷ N, dijumlahkan sebagai **pecahan eksak** (BigInt), lalu dinilai sekali: nilai = pembulatan setengah-menjauhi-nol dari (qty pecahan × dasar nilai ÷ dasar qty), dengan dasar harga **sama dengan baris stok opname** (ADR 020: rata-rata periode atau beli terakhir). Bahan resep yang tidak ada di stok opname dinilai Rp 0 dengan peringatan. Porsi menu tanpa resep berlaku tidak masuk theoretical dan dilaporkan.
7. **Actual** = COGS per bahan dari stok opname (Stok Awal + Pembelian − Stok Akhir, ADR 020). **Variance = Actual − Theoretical** (qty & rupiah, serta % terhadap theoretical). Positif = pemakaian melebihi resep (boros, susut, rusak, porsi berlebih, penjualan belum tercatat); negatif = pemakaian di bawah resep.
8. **Tampilan:** menu sidebar *Menu & Resep* (tab Menu & Resep dan Rekap Porsi; biaya bahan/porsi & food cost hari ini sebagai estimasi), tab *Penjualan menu* di Input Transaksi, dan tab *Variance* di Stok Opname & COGS (per bahan per section, ringkasan, dan theoretical cost per menu).
9. **Data & keamanan:** tabel `menus`, `recipes`, `recipe_lines`, `portion_summaries`, `portion_summary_lines`, `menu_sale_lines` ber-`workspace_id`, RLS hanya SELECT untuk pemilik; semua tulis lewat RPC SECURITY DEFINER (`create_menu`, `update_menu`, `delete_menu`, `save_recipe`, `delete_recipe`, `create_portion_summary`, `delete_portion_summary`, `post_menu_sale`). Audit: entitas `menu`, `recipe`, `portion_summary`. Backup JSON menyertakan stok opname, menu, resep, rekap, dan penjualan menu.

## Konsekuensi
### Positif:
- Variance menunjukkan bahan mana yang boros/susut beserta nilainya, dengan harga yang konsisten dengan COGS.
- Perubahan resep tidak mengubah analisa periode lama; perhitungan tanpa float.
- Satu kali input penjualan menu menghasilkan jurnal sekaligus porsi; rekap POS bisa dipakai tanpa porsi ganda.

### Negatif:
- Penjualan lewat tab *Penjualan* biasa (nominal per akun) tidak membawa porsi; porsinya perlu rekap.
- Rekap yang melintasi tanggal stok opname dihitung utuh di satu periode (dengan peringatan).
- Biaya per menu pada tabel menu dibulatkan per bahan, sehingga jumlahnya bisa berbeda beberapa rupiah dari total theoretical per bahan.
