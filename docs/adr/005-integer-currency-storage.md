# ADR 005: Penyimpanan Nilai Uang sebagai Integer

## Konteks
Operasi floating point dalam komputasi biner sering kali menghasilkan kesalahan presisi pembulatan (misal: `0.1 + 0.2 = 0.30000000000000004`). Dalam sistem akuntansi formal, perbedaan 1 Rupiah sekalipun dapat menyebabkan jurnal tidak seimbang (*unbalanced entry*) dan laporan keuangan salah.

## Keputusan
1. Semua nilai moneter (debit, kredit, saldo, harga) disimpan sebagai **integer** / **bigint** (satuan Rupiah utuh tanpa desimal).
2. Tipe data `float`, `double`, atau `real` dilarang digunakan di seluruh skema database dan interface TypeScript.
3. Kolom `currency` disimpan pada level workspace dengan nilai default `'IDR'`, tanpa konversi multi-currency otomatis pada tahap ini.
4. Format representasi mata uang (seperti menambahkan titik/koma pemisah ribuan `Rp 100.000`) dilakukan secara murni di level UI/presentasi (*view formatter*).

## Konsekuensi
### Positif:
- Menghilangkan 100% potensi *floating-point error*.
- Validasi Debit = Kredit menjadi mutlak dan akurat secara matematika bilangan bulat.

### Negatif:
- Jika di masa mendatang dibutuhkan mata uang dengan nilai desimal (seperti USD sen), sistem harus mengalikan nilai dengan basis faktor desimal (misal disimpan dalam basis *cents*).
