# ADR 011: Model Data Jurnal dan Akun

## Konteks
Engine akuntansi, mock repository, laporan, dan skema database Fase 2 harus memakai bentuk data yang sama. Tanpa model data yang disepakati sejak Sub-fase 1A, aturan seperti void, penomoran, klasifikasi arus kas, dan pencarian akun sistem (Persediaan, HPP, Prive) akan diimplementasikan secara tidak konsisten.

## Keputusan
Nama kolom ditulis `snake_case` (DB); di TypeScript memakai padanan `camelCase`. Semua tabel memiliki `id`, `workspace_id` (kecuali `workspaces`), `created_at`, `updated_at`.

1. **`workspaces`**: `owner_id`, `name`, `template_type` (immutable), `currency` (default `IDR`), `books_start_date`, `sales_tax_rate_bps` (integer basis poin, default 1000 = 10%), `sales_tax_inclusive` (boolean, default false), `deleted_at`. Kolom pajak dipakai mulai Sub-fase 1C (ADR 012).

2. **`accounts`**:
   - `code` (unik per workspace), `name`.
   - `account_type`: `asset` | `liability` | `equity` | `revenue` | `cogs` | `expense`.
   - `normal_balance`: `debit` | `credit` (disimpan eksplisit agar akun kontra seperti Prive dan Akumulasi Penyusutan didukung).
   - `cash_flow_category`: `operating` | `investing` | `financing` | `none` (wajib untuk semua akun).
   - `is_cash`: boolean (akun kas/bank).
   - `system_role` (nullable, unik per workspace): penanda akun yang dicari oleh sistem, mis. `opening_balance_equity`, `retained_earnings`, `owner_capital`, `drawings`, `raw_material_inventory`, `cogs`, `accounts_receivable`, `accounts_payable`, `sales_tax_payable`.
   - `is_active`, `deleted_at`.

3. **`periods`**: `start_date`, `end_date`, `status` (`open` | `closed`). Tidak boleh tumpang tindih dalam satu workspace (ADR 006).

4. **`journal_entries`** (header):
   - `entry_number` (nullable; diisi saat posting, unik per workspace), `entry_date`, `description`.
   - `status`: `draft` | `posted`.
   - `source`: `manual` | `revenue` | `expense` | `purchase` | `adjustment` | `opening_balance` | `settlement` | `tax_payment` | `reversal` | `closing`.
   - `counterparty` (nullable): nama pelanggan/pemasok untuk transaksi kredit dan pelunasan (ADR 012).
   - `settlement_of` (nullable): jurnal transaksi kredit yang dilunasi oleh jurnal ini (ADR 012).
   - `reversal_of` (nullable, unik): jurnal asal yang dibalik.
   - `correction_of` (nullable): jurnal asal yang dikoreksi (untuk draft hasil koreksi).
   - `posted_at`, `deleted_at` (hanya untuk draft).

5. **`journal_lines`**:
   - `journal_entry_id`, `account_id`, `line_no`, `description` (opsional).
   - `debit` dan `credit` (integer/bigint, >= 0) dengan aturan **tepat satu** bernilai > 0.
   - Jurnal minimal 2 baris; total `debit` = total `credit`.

6. **`audit_logs`** (Fase 2): `entity_type`, `entity_id`, `action`, `before`, `after`, `actor_id`, `created_at`. Di Fase 1 cukup disimulasikan di mock bila diperlukan.

7. Template (`src/modules/<template>/`) menyediakan seed CoA lengkap dengan `account_type`, `normal_balance`, `cash_flow_category`, `is_cash`, dan `system_role`. Template F&B menyertakan Piutang Usaha, Utang Usaha, dan Utang PB1 (ADR 012).

## Konsekuensi
### Positif:
- Satu bentuk data untuk core, mock, dan Supabase; contract test bisa memverifikasi keduanya.
- Modul tidak bergantung pada kode akun yang di-hardcode (memakai `system_role`), sehingga user bebas mengubah kode/nama akun.
- Void, koreksi, penomoran, dan arus kas memiliki dasar data yang eksplisit.

### Negatif:
- Model harus diputuskan di awal; perubahan setelah Fase 2 memerlukan migrasi skema.
- Kolom `debit`/`credit` terpisah membutuhkan constraint tambahan (tepat satu > 0) dibanding satu kolom bertanda.
