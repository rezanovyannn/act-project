-- Skema inti (ADR 011). Nominal uang: bigint Rupiah utuh (ADR 005).
-- Semua tabel bisnis memiliki workspace_id; currency hanya di workspaces.

create schema if not exists app;

-- ---------------------------------------------------------------- workspaces
create table public.workspaces (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users (id) on delete cascade,
  name                text not null check (btrim(name) <> ''),
  template_type       text not null check (template_type in ('fnb')),
  currency            text not null default 'IDR' check (currency = 'IDR'),
  books_start_date    date not null,
  sales_tax_rate_bps  integer not null default 1000 check (sales_tax_rate_bps between 0 and 10000),
  sales_tax_inclusive boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index workspaces_owner_idx on public.workspaces (owner_id) where deleted_at is null;

-- ------------------------------------------------------------------ accounts
create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  code               text not null check (btrim(code) <> ''),
  name               text not null check (btrim(name) <> ''),
  account_type       text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense')),
  normal_balance     text not null check (normal_balance in ('debit', 'credit')),
  cash_flow_category text not null check (cash_flow_category in ('operating', 'investing', 'financing', 'none')),
  is_cash            boolean not null default false,
  system_role        text check (system_role in (
                       'opening_balance_equity', 'retained_earnings', 'owner_capital', 'drawings',
                       'raw_material_inventory', 'cogs', 'accounts_receivable', 'accounts_payable',
                       'sales_tax_payable')),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- Akun kas/bank harus aset dan bukan aktivitas arus kas (ADR 009 & 010).
  constraint accounts_cash_is_asset check (not is_cash or (account_type = 'asset' and cash_flow_category = 'none')),
  -- Untuk foreign key komposit: baris jurnal hanya boleh memakai akun satu workspace.
  constraint accounts_id_workspace_key unique (id, workspace_id)
);
create unique index accounts_code_key on public.accounts (workspace_id, code) where deleted_at is null;
create unique index accounts_system_role_key on public.accounts (workspace_id, system_role)
  where system_role is not null and deleted_at is null;

-- ------------------------------------------------------------------- periods
create table public.periods (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  status       text not null default 'open' check (status in ('open', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint periods_range_check check (start_date <= end_date)
);
create index periods_workspace_idx on public.periods (workspace_id, start_date);

-- ----------------------------------------------------------- journal_entries
create table public.journal_entries (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  entry_number  text,
  entry_date    date not null,
  description   text not null default '',
  status        text not null check (status in ('draft', 'posted')),
  source        text not null check (source in (
                  'manual', 'revenue', 'expense', 'purchase', 'adjustment', 'opening_balance',
                  'settlement', 'tax_payment', 'reversal', 'closing')),
  counterparty  text,
  settlement_of uuid references public.journal_entries (id),
  reversal_of   uuid references public.journal_entries (id),
  correction_of uuid references public.journal_entries (id),
  posted_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint journal_entries_id_workspace_key unique (id, workspace_id),
  -- Draft: tanpa nomor. Posted: bernomor, tidak pernah dihapus (ADR 008 & 009).
  constraint journal_entries_lifecycle_check check (
    (status = 'draft' and entry_number is null and posted_at is null)
    or (status = 'posted' and entry_number is not null and posted_at is not null and deleted_at is null)
  ),
  constraint journal_entries_reversal_source_check check (reversal_of is null or source = 'reversal')
);
create unique index journal_entries_number_key on public.journal_entries (workspace_id, entry_number)
  where entry_number is not null;
-- Satu jurnal hanya boleh dibalik sekali.
create unique index journal_entries_reversal_key on public.journal_entries (reversal_of)
  where reversal_of is not null and deleted_at is null;
create index journal_entries_workspace_date_idx on public.journal_entries (workspace_id, entry_date, created_at);
create index journal_entries_settlement_idx on public.journal_entries (settlement_of) where settlement_of is not null;

-- ------------------------------------------------------------- journal_lines
create table public.journal_lines (
  id               uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null,
  workspace_id     uuid not null,
  -- Boleh kosong hanya pada draft; posting mewajibkan akun (divalidasi post_journal).
  account_id       uuid,
  line_no          integer not null check (line_no > 0),
  description      text,
  debit            bigint not null default 0 check (debit >= 0),
  credit           bigint not null default 0 check (credit >= 0),
  constraint journal_lines_one_side_check check (not (debit > 0 and credit > 0)),
  constraint journal_lines_entry_line_key unique (journal_entry_id, line_no),
  constraint journal_lines_entry_fkey foreign key (journal_entry_id, workspace_id)
    references public.journal_entries (id, workspace_id) on delete cascade,
  constraint journal_lines_account_fkey foreign key (account_id, workspace_id)
    references public.accounts (id, workspace_id)
);
create index journal_lines_workspace_account_idx on public.journal_lines (workspace_id, account_id);

-- ---------------------------------------------------------------- audit_logs
create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_type  text not null check (entity_type in ('workspace', 'account', 'period', 'journal')),
  entity_id    uuid not null,
  action       text not null,
  reason       text,
  before       jsonb,
  after        jsonb,
  actor_id     uuid,
  created_at   timestamptz not null default clock_timestamp()
);
create index audit_logs_workspace_idx on public.audit_logs (workspace_id, seq desc);
