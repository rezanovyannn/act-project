# ADR 017: Persediaan Perpetual per Barang

## Konteks
ADR 007/015 memakai metode periodik: stok hanya diketahui dalam rupiah dan HPP diakui saat stok opname. ROADMAP Fase 4C menambahkan metode **perpetual per barang**. Keputusan user (30 September 2026):
- Metode persediaan (periodik/perpetual) dan metode biaya (rata-rata tertimbang bergerak/FIFO) dipilih di Pengaturan per workspace, untuk semua template, dan dapat diubah kapan saja.
- Kuantitas berupa bilangan bulat satuan dasar.
- Stok minus diizinkan dengan peringatan; selisih harga dikoreksi otomatis saat pembelian berikutnya.
- Retur penjualan & pembelian dicatat dengan nilai pokok transaksi asal; retur atas transaksi kredit boleh mengurangi tagihan atau dikembalikan tunai.
- Pendapatan memakai akun default per barang.
- Form Pemakaian Barang terjurnal otomatis (Dr HPP, Cr Persediaan).
- Transaksi bertanggal mundur tidak menghitung ulang HPP jurnal yang sudah diposting.
- Peralihan periodik → perpetual lewat stok opname awal per barang; peralihan lainnya tanpa jurnal.

## Keputusan
1. **Master barang** (`items`): kode unik per workspace, nama, satuan dasar, akun pendapatan default (jenis pendapatan), status aktif. Barang yang sudah dipakai jurnal tidak dapat dihapus, hanya dinonaktifkan (sama dengan akun, ADR 009). Mutasi barang tercatat di audit log (entitas `item`).
2. **Jurnal tetap satu-satunya sumber kebenaran.** Baris jurnal boleh membawa `item_id` dan `quantity` (bilangan bulat ≥ 0).
   - Mutasi stok = baris pada akun ber-`system_role = inventory` yang membawa barang: debit = masuk, kredit = keluar, nilai = nominal baris.
   - Baris pendapatan/retur juga boleh membawa barang & qty sebagai rujukan harga jual untuk retur.
   - Baris ber-qty 0 adalah koreksi nilai saja.
   - Void/koreksi membalik baris beserta barang & qty-nya, sehingga stok ikut kembali.
3. **Metode biaya** per workspace dengan riwayat `{metode, berlaku mulai tanggal}`. HPP dihitung di `src/core/stock.ts` dengan memutar ulang mutasi posted per tanggal, lalu waktu posting:
   - **Rata-rata tertimbang bergerak:** HPP keluar = round(nilai × qty keluar ÷ qty tersedia).
   - **FIFO:** lapisan harga pembelian dikonsumsi berurutan.
   - Saat metode berganti, stok per barang menjadi satu lapisan/harga awal metode baru, tanpa jurnal.
   - Nilai jurnal posted tidak dihitung ulang: transaksi bertanggal mundur tidak mengubah HPP transaksi sesudahnya (selisih terserap di stok opname) dan aplikasi memberi peringatan.
4. **Stok minus diizinkan dengan peringatan.** Barang keluar melebihi stok dinilai dengan harga pokok terakhir yang diketahui; barang tanpa harga pokok sama sekali harus dicatat pembelian/stok awalnya dulu (nominal baris jurnal wajib > 0). Pembelian yang menutup stok minus ikut membukukan **koreksi HPP** dalam jurnal yang sama: Dr/Cr HPP, Cr/Dr Persediaan (qty 0) sebesar selisih harga beli sebenarnya dengan harga pokok sementara.
5. **Transaksi perpetual** (semua otomatis membentuk jurnal):
   - **Pembelian barang:** Dr Persediaan per barang (qty, harga), [koreksi stok minus], [Dr PPN Masukan], Cr Kas/Utang.
   - **Penjualan barang:** Dr Kas/Piutang, Cr akun pendapatan default barang (qty), [Cr utang pajak]; Dr HPP, Cr Persediaan per barang (harga pokok).
   - **Pemakaian barang:** Dr HPP (atau akun beban yang dipilih), Cr Persediaan per barang.
   - **Stok opname per barang:** selisih qty fisik dinilai dengan harga pokok berjalan dan dibukukan ke HPP.
6. **Retur** (`return_of` merujuk transaksi asal; qty retur kumulatif ≤ qty asal):
   - **Retur penjualan:** Dr Retur & Potongan Penjualan (akun ber-`system_role = sales_returns`, dibuat otomatis bila belum ada) sebesar harga jual asal proporsional; Dr utang pajak proporsional; Cr Kas atau Cr Piutang. Juga Dr Persediaan, Cr HPP sebesar HPP asal proporsional.
   - **Retur pembelian:** Cr Persediaan sebesar harga beli asal proporsional; Cr PPN Masukan proporsional; Dr Kas atau Dr Utang.
   - Retur yang mengurangi tagihan dicatat sebagai pelunasan (`settlement_of`, ADR 012) dan tidak boleh melebihi sisa tagihan; retur tunai bersumber `return`.
   - Retur terakhir sebuah barang mengambil sisa nominal agar tidak ada selisih pembulatan.
   - Transaksi yang punya retur aktif tidak dapat di-void (`HAS_RETURNS`).
7. **Peralihan metode:**
   - **Periodik → perpetual:** stok opname awal per barang (qty & nilai) pada tanggal peralihan. Satu jurnal `adjustment` menolkan saldo Persediaan tanpa barang dan saldo barang yang dihitung ulang, membukukan nilai baru per barang, dan menjurnal selisihnya ke HPP.
   - **Perpetual → periodik:** tanpa jurnal; stok per barang dibekukan, saldo akun Persediaan tetap, stok opname periodik berlanjut.
   - **Rata-rata ↔ FIFO:** tanpa jurnal, berlaku mulai tanggal pilihan.
   - Semua perubahan tercatat di audit log.
8. Pada mode perpetual, penanda "HPP belum disesuaikan" (ADR 007) tidak ditampilkan karena HPP diakui per transaksi.

## Konsekuensi
### Positif:
- Stok per barang, kartu stok, dan HPP per transaksi tersedia tanpa tabel mutasi terpisah; saldo per barang selalu dapat direkonsiliasi dengan akun Persediaan di Buku Besar.
- Void, koreksi, tutup buku, dan laporan tetap bekerja tanpa perubahan engine.

### Negatif:
- Perhitungan HPP dilakukan aplikasi (core), bukan database; database menjaga keseimbangan jurnal, qty ≥ 0, kepemilikan barang, dan batas qty retur.
- Barang bernilai pokok Rp 0 tidak dapat dicatat keluar/masuk (nominal baris wajib > 0).
- Belum ada resep/BOM untuk F&B; pemakaian bahan dicatat lewat form Pemakaian Barang.
