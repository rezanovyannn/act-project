-- Template Katering, pesanan, uang muka (DP), invoice DP (ADR 024, ROADMAP Fase 10A).

-- 1. Jenis template, label pajak PBJT, peran akun Uang Muka Pelanggan, sumber jurnal uang muka.
alter table public.workspaces drop constraint workspaces_template_type_check;
alter table public.workspaces add constraint workspaces_template_type_check
  check (template_type in ('fnb', 'retail', 'catering'));
alter table public.workspaces drop constraint workspaces_sales_tax_label_check;
alter table public.workspaces add constraint workspaces_sales_tax_label_check
  check (sales_tax_label in ('PB1', 'PPN', 'PBJT'));

alter table public.accounts drop constraint accounts_system_role_check;
alter table public.accounts add constraint accounts_system_role_check check (system_role in (
  'opening_balance_equity', 'retained_earnings', 'owner_capital', 'drawings',
  'inventory', 'cogs', 'accounts_receivable', 'accounts_payable',
  'sales_tax_payable', 'income_summary', 'input_vat', 'non_creditable_vat', 'sales_returns',
  'customer_deposits'));

alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check check (source in (
  'manual', 'revenue', 'expense', 'purchase', 'adjustment', 'opening_balance',
  'settlement', 'tax_payment', 'reversal', 'closing', 'return', 'deposit'));

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('workspace', 'account', 'period', 'journal', 'item', 'menu', 'recipe', 'portion_summary',
    'contact', 'invoice', 'catering_order', 'order_bill'));

-- 2. Kebijakan pembatalan (kontak & pesanan) dan prefix quotation.
create or replace function app.cancellation_policy_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select p is null or (
    jsonb_typeof(p) = 'object' and (
      (p ->> 'kind' in ('refund', 'forfeit_all'))
      or (p ->> 'kind' = 'forfeit_percent' and jsonb_typeof(p -> 'forfeitBps') = 'number'
          and (p ->> 'forfeitBps') ~ '^[0-9]{1,4}$' and (p ->> 'forfeitBps')::integer between 1 and 9999)));
$$;

alter table public.contacts add column cancellation_policy jsonb
  constraint contacts_cancellation_policy_check check (app.cancellation_policy_valid(cancellation_policy));

alter table public.workspace_profiles add column quotation_prefix text not null default 'QUO'
  constraint workspace_profiles_quotation_prefix_check check (quotation_prefix ~ '^[A-Z0-9-]{1,12}$');

-- 3. Pesanan katering (baris berupa jsonb seperti baris faktur tanpa barang).
create table public.catering_orders (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  number              text not null,
  number_year         integer not null,
  number_seq          integer not null,
  contact_id          uuid not null,
  service_type        text not null check (service_type in ('event', 'box', 'subscription')),
  event_date          date not null,
  event_time          text check (event_time is null or event_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  location            text,
  pax                 integer not null check (pax >= 1),
  quote_date          date not null,
  valid_until         date not null,
  apply_tax           boolean not null default false,
  discount_kind       text check (discount_kind in ('percent', 'amount')),
  discount_value      bigint check (discount_value is null or discount_value >= 0),
  notes               text,
  cancellation_policy jsonb not null default '{"kind": "refund", "forfeitBps": 0}'::jsonb,
  lines               jsonb not null default '[]'::jsonb,
  state               text not null default 'quotation' check (state in ('quotation', 'confirmed', 'completed', 'cancelled')),
  invoice_id          uuid references public.invoices (id),
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint catering_orders_id_workspace_key unique (id, workspace_id),
  constraint catering_orders_number_key unique (workspace_id, number),
  constraint catering_orders_contact_fkey foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id),
  constraint catering_orders_dates_check check (valid_until >= quote_date),
  constraint catering_orders_discount_check check ((discount_kind is null) = (discount_value is null)
    and (discount_kind is distinct from 'percent' or discount_value <= 10000)),
  constraint catering_orders_lines_check check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 200),
  constraint catering_orders_policy_check check (cancellation_policy is not null and app.cancellation_policy_valid(cancellation_policy)),
  constraint catering_orders_lifecycle_check check (
    (state = 'completed') = (invoice_id is not null)
    and (state = 'cancelled') = (cancelled_at is not null)
    and (deleted_at is null or state = 'quotation'))
);
create index catering_orders_workspace_idx on public.catering_orders (workspace_id, event_date);
create trigger catering_orders_touch before update on public.catering_orders
  for each row execute function app.touch_updated_at();
create trigger catering_orders_audit after insert or update or delete on public.catering_orders
  for each row execute function app.audit_row('catering_order');

-- 4. Invoice DP: dokumen tagihan uang muka, tanpa jurnal.
create table public.catering_order_bills (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  order_id     uuid not null,
  number       text not null,
  number_year  integer not null,
  number_seq   integer not null,
  bill_date    date not null,
  due_date     date not null,
  amount       bigint not null check (amount > 0),
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint catering_order_bills_order_fkey foreign key (order_id, workspace_id) references public.catering_orders (id, workspace_id),
  constraint catering_order_bills_number_key unique (workspace_id, number),
  constraint catering_order_bills_dates_check check (due_date >= bill_date)
);
create index catering_order_bills_order_idx on public.catering_order_bills (order_id);
create trigger catering_order_bills_audit after insert or update or delete on public.catering_order_bills
  for each row execute function app.audit_row('order_bill');

alter table public.catering_orders enable row level security;
alter table public.catering_order_bills enable row level security;
revoke all on public.catering_orders, public.catering_order_bills from anon, authenticated;
grant select on public.catering_orders, public.catering_order_bills to authenticated;
create policy catering_orders_select_own on public.catering_orders
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy catering_order_bills_select_own on public.catering_order_bills
  for select to authenticated using (app.owns_workspace(workspace_id));

-- 5. Baris jurnal bertag pesanan (mengubah ADR 011).
alter table public.journal_lines
  add column order_id uuid,
  add constraint journal_lines_order_fkey foreign key (order_id, workspace_id)
    references public.catering_orders (id, workspace_id);
create index journal_lines_order_idx on public.journal_lines (order_id) where order_id is not null;

-- Saldo Uang Muka Pelanggan sebuah pesanan dari semua jurnal posted (pembalik ikut menetralkan).
create or replace function app.order_deposit_balance(p_order_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.credit - l.debit), 0)
  from public.journal_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a on a.id = l.account_id
  where l.order_id = p_order_id and a.system_role = 'customer_deposits'
    and e.status = 'posted' and e.deleted_at is null;
$$;

-- Baris jurnal membawa tag pesanan (sumber: 20260930210000_perpetual_inventory.sql).
create or replace function app.insert_lines(p_entry_id uuid, p_workspace_id uuid, p_lines jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.journal_lines (journal_entry_id, workspace_id, account_id, line_no, description, debit, credit,
                                    item_id, quantity, order_id)
  select p_entry_id, p_workspace_id, app.to_uuid(l.value ->> 'accountId'), l.ordinality::integer,
         nullif(btrim(coalesce(l.value ->> 'description', '')), ''),
         app.amount(l.value -> 'debit', l.ordinality::integer),
         app.amount(l.value -> 'credit', l.ordinality::integer),
         app.to_uuid(l.value ->> 'itemId'),
         case when app.to_uuid(l.value ->> 'itemId') is null then null
              else app.amount(l.value -> 'quantity', l.ordinality::integer) end,
         app.to_uuid(l.value ->> 'orderId')
  from jsonb_array_elements(p_lines) with ordinality as l(value, ordinality);
exception when foreign_key_violation then
  perform app.raise_error('ACCOUNT_NOT_FOUND', 'Akun, barang, atau pesanan tidak ditemukan di workspace ini');
end
$$;

-- Posting: tag pesanan valid, jurnal uang muka, saldo DP per pesanan tidak negatif (sumber: 20260930210000_perpetual_inventory.sql).
create or replace function app.post_journal_core(p_input jsonb, p_draft_id uuid, p_mode text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_input ->> 'workspaceId');
  v_lines jsonb := coalesce(p_input -> 'lines', '[]'::jsonb);
  v_source text := p_input ->> 'source';
  v_description text := btrim(coalesce(p_input ->> 'description', ''));
  v_counterparty text := nullif(btrim(coalesce(p_input ->> 'counterparty', '')), '');
  v_reversal_of uuid := app.to_uuid(p_input ->> 'reversalOf');
  v_settlement_of uuid := app.to_uuid(p_input ->> 'settlementOf');
  v_correction_of uuid := app.to_uuid(p_input ->> 'correctionOf');
  v_return_of uuid := app.to_uuid(p_input ->> 'returnOf');
  v_item public.items;
  v_order public.catering_orders;
  v_order_id uuid;
  v_projected numeric;
  v_qty jsonb;
  v_date date;
  v_line jsonb;
  v_i integer := 0;
  v_debit bigint;
  v_credit bigint;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_account public.accounts;
  v_period public.periods;
  v_original public.journal_entries;
  v_existing public.journal_entries;
  v_draft public.journal_entries;
  v_seq integer;
  v_number text;
  v_id uuid;
begin
  perform app.require_owner(v_ws);
  -- Serialisasi per workspace: penomoran & aturan "hanya satu" aman dari balapan.
  perform 1 from public.workspaces where id = v_ws for update;

  begin
    v_date := (p_input ->> 'entryDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal tidak valid (format YYYY-MM-DD)');
  end;
  if v_date is null then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal wajib diisi');
  end if;
  if v_description = '' then
    perform app.raise_error('EMPTY_DESCRIPTION', 'Keterangan jurnal wajib diisi');
  end if;
  -- Jurnal penutup hanya lewat close_fiscal_year; pembaliknya hanya lewat cancel (ADR 014).
  if p_mode = 'public' and v_source = 'closing' then
    perform app.raise_error('INVALID_CLOSING', 'Jurnal penutup dibuat lewat fitur Tutup Buku');
  end if;
  if p_mode = 'closing' and v_source <> 'closing' then
    perform app.raise_error('INVALID_CLOSING', 'Hanya jurnal penutup yang dapat diposting lewat tutup buku');
  end if;
  if p_mode = 'closing_reversal' and v_source <> 'reversal' then
    perform app.raise_error('INVALID_CLOSING', 'Pembatalan tutup buku harus berupa jurnal pembalik');
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) < 2 then
    perform app.raise_error('TOO_FEW_LINES', 'Jurnal minimal terdiri dari 2 baris');
  end if;

  -- Double-entry: tiap baris tepat satu sisi > 0; akun ada, satu workspace, aktif.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_i := v_i + 1;
    v_debit := app.amount(v_line -> 'debit', v_i);
    v_credit := app.amount(v_line -> 'credit', v_i);
    if v_debit > 0 and v_credit > 0 then
      perform app.raise_error('LINE_BOTH_SIDES', format('Baris %s: isi debit ATAU kredit, tidak keduanya', v_i));
    end if;
    if v_debit = 0 and v_credit = 0 then
      perform app.raise_error('LINE_ZERO', format('Baris %s: nominal debit atau kredit harus lebih dari 0', v_i));
    end if;
    select * into v_account from public.accounts where id = app.to_uuid(v_line ->> 'accountId');
    if not found or v_account.deleted_at is not null then
      perform app.raise_error('ACCOUNT_NOT_FOUND', format('Baris %s: akun tidak ditemukan', v_i));
    end if;
    if v_account.workspace_id <> v_ws then
      perform app.raise_error('ACCOUNT_OTHER_WORKSPACE', format('Baris %s: akun bukan milik workspace ini', v_i));
    end if;
    if not v_account.is_active and v_source <> 'reversal' then
      perform app.raise_error('ACCOUNT_INACTIVE',
        format('Baris %s: akun %s %s sudah nonaktif', v_i, v_account.code, v_account.name));
    end if;
    -- Baris ber-barang (ADR 017): qty bulat >= 0 hanya bersama barang milik workspace, aktif.
    v_qty := v_line -> 'quantity';
    if nullif(btrim(coalesce(v_line ->> 'itemId', '')), '') is null then
      if v_qty is not null and jsonb_typeof(v_qty) <> 'null' then
        perform app.raise_error('INVALID_QUANTITY', format('Baris %s: kuantitas hanya untuk baris barang', v_i));
      end if;
    else
      if v_qty is null or jsonb_typeof(v_qty) <> 'number' or v_qty::text !~ '^[0-9]{1,15}$' then
        perform app.raise_error('INVALID_QUANTITY', format('Baris %s: kuantitas harus bilangan bulat tidak negatif', v_i));
      end if;
      select * into v_item from public.items where id = app.to_uuid(v_line ->> 'itemId');
      if not found or v_item.deleted_at is not null or v_item.workspace_id <> v_ws then
        perform app.raise_error('ITEM_NOT_FOUND', format('Baris %s: barang tidak ditemukan', v_i));
      end if;
      if not v_item.is_active and v_source <> 'reversal' then
        perform app.raise_error('ITEM_INACTIVE',
          format('Baris %s: barang %s %s sudah nonaktif', v_i, v_item.code, v_item.name));
      end if;
    end if;
    -- Tag pesanan katering (ADR 024).
    v_order_id := app.to_uuid(v_line ->> 'orderId');
    if v_order_id is not null then
      select * into v_order from public.catering_orders where id = v_order_id;
      if not found or v_order.deleted_at is not null or v_order.workspace_id <> v_ws then
        perform app.raise_error('ORDER_NOT_FOUND', format('Baris %s: pesanan tidak ditemukan', v_i));
      end if;
      if v_source = 'deposit' and v_order.state = 'cancelled' then
        perform app.raise_error('INVALID_DEPOSIT', 'Pesanan sudah dibatalkan');
      end if;
      if v_source = 'deposit' and v_order.state = 'completed' and v_account.system_role = 'customer_deposits' and v_credit > 0 then
        perform app.raise_error('INVALID_DEPOSIT', 'Pesanan sudah selesai; pembayaran dicatat sebagai pelunasan faktur');
      end if;
    end if;
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;

  -- Jurnal uang muka: satu pesanan, memakai akun Uang Muka Pelanggan.
  if v_source = 'deposit' and (
    exists (select 1 from jsonb_array_elements(v_lines) l where app.to_uuid(l ->> 'orderId') is null)
    or (select count(distinct app.to_uuid(l ->> 'orderId')) from jsonb_array_elements(v_lines) l) <> 1
    or not exists (select 1 from jsonb_array_elements(v_lines) l
                   join public.accounts a on a.id = app.to_uuid(l ->> 'accountId') where a.system_role = 'customer_deposits')) then
    perform app.raise_error('INVALID_DEPOSIT', 'Jurnal uang muka harus bertag satu pesanan dan memakai akun Uang Muka Pelanggan');
  end if;
  -- Saldo Uang Muka Pelanggan tiap pesanan tidak boleh negatif setelah jurnal ini.
  for v_order_id in
    select distinct app.to_uuid(l ->> 'orderId') from jsonb_array_elements(v_lines) l
    join public.accounts a on a.id = app.to_uuid(l ->> 'accountId')
    where a.system_role = 'customer_deposits' and app.to_uuid(l ->> 'orderId') is not null
  loop
    select app.order_deposit_balance(v_order_id) + coalesce(sum((l ->> 'credit')::numeric - (l ->> 'debit')::numeric), 0)
    into v_projected
    from jsonb_array_elements(v_lines) l
    join public.accounts a on a.id = app.to_uuid(l ->> 'accountId')
    where a.system_role = 'customer_deposits' and app.to_uuid(l ->> 'orderId') = v_order_id;
    if v_projected < 0 then
      perform app.raise_error('INVALID_DEPOSIT', 'Saldo DP pesanan tidak boleh negatif (DP mungkin sudah dipakai atau dikembalikan)');
    end if;
  end loop;
  if v_total_debit <> v_total_credit then
    perform app.raise_error('UNBALANCED', format('Total debit (%s) tidak sama dengan total kredit (%s)',
      app.rupiah(v_total_debit), app.rupiah(v_total_credit)));
  end if;

  -- Periode terbuka (ADR 006).
  select * into v_period from public.periods
  where workspace_id = v_ws and v_date between start_date and end_date;
  if not found then
    perform app.raise_error('PERIOD_NOT_FOUND', format('Belum ada periode akuntansi untuk tanggal %s', v_date));
  end if;
  if v_period.status <> 'open' then
    perform app.raise_error('PERIOD_CLOSED',
      format('Periode %s s.d. %s sudah dikunci', v_period.start_date, v_period.end_date));
  end if;

  -- Void/koreksi (ADR 009).
  if v_source = 'reversal' and v_reversal_of is null then
    perform app.raise_error('INVALID_REVERSAL', 'Jurnal pembalik harus merujuk jurnal asal');
  end if;
  if v_reversal_of is not null then
    if v_source <> 'reversal' then
      perform app.raise_error('INVALID_REVERSAL', 'Tautan jurnal pembalik hanya untuk sumber reversal');
    end if;
    select * into v_original from public.journal_entries where id = v_reversal_of for update;
    if not found or v_original.workspace_id <> v_ws or v_original.deleted_at is not null then
      perform app.raise_error('NOT_FOUND', 'Jurnal asal tidak ditemukan');
    end if;
    if v_original.status <> 'posted' then
      perform app.raise_error('NOT_POSTED', 'Hanya jurnal posted yang dapat di-void atau dikoreksi');
    end if;
    if v_original.source = 'closing' and p_mode <> 'closing_reversal' then
      perform app.raise_error('INVALID_CLOSING', 'Jurnal penutup hanya dapat dibatalkan lewat fitur Batalkan tutup buku');
    end if;
    if p_mode = 'closing_reversal' and v_original.source <> 'closing' then
      perform app.raise_error('INVALID_CLOSING', 'Pembatalan tutup buku hanya membalik jurnal penutup');
    end if;
    if v_original.source = 'reversal' then
      perform app.raise_error('INVALID_REVERSAL', 'Jurnal pembalik tidak dapat di-void atau dikoreksi; buat jurnal baru');
    end if;
    v_existing := app.active_reversal(v_original.id);
    if v_existing.id is not null then
      perform app.raise_error('ALREADY_REVERSED', format('Jurnal ini sudah dibalik oleh %s', v_existing.entry_number));
    end if;
    if exists (select app.active_return_ids(v_original.id)) then
      perform app.raise_error('HAS_RETURNS', 'Transaksi ini sudah memiliki retur; void returnya lebih dulu');
    end if;
    if exists (select app.active_settlement_ids(v_original.id)) then
      perform app.raise_error('HAS_SETTLEMENTS',
        'Transaksi ini sudah memiliki pelunasan; void pelunasannya lebih dulu');
    end if;
    if v_date < v_original.entry_date then
      perform app.raise_error('INVALID_REVERSAL', 'Tanggal jurnal pembalik tidak boleh sebelum tanggal jurnal asal');
    end if;
  end if;

  -- Retur barang (ADR 017).
  if v_return_of is not null then
    perform app.validate_return(v_ws, v_source, v_return_of, v_lines);
  elsif v_source = 'return' then
    perform app.raise_error('INVALID_RETURN', 'Jurnal retur harus merujuk transaksi asal');
  end if;

  -- Pelunasan (ADR 012).
  if v_source = 'settlement' or v_settlement_of is not null then
    perform app.validate_settlement(v_ws, v_source, v_settlement_of, v_lines);
  end if;

  -- Hanya satu saldo awal aktif.
  if v_source = 'opening_balance' and exists (
    select 1 from public.journal_entries e
    where e.workspace_id = v_ws and e.source = 'opening_balance' and e.status = 'posted'
      and e.deleted_at is null and app.active_reversal(e.id) is null
  ) then
    perform app.raise_error('DUPLICATE_OPENING_BALANCE', 'Saldo awal sudah diposting untuk workspace ini');
  end if;

  if p_draft_id is not null then
    select * into v_draft from public.journal_entries where id = p_draft_id for update;
    if not found or v_draft.workspace_id <> v_ws or v_draft.deleted_at is not null then
      perform app.raise_error('NOT_FOUND', 'Jurnal tidak ditemukan');
    end if;
    if v_draft.status <> 'draft' then
      perform app.raise_error('NOT_DRAFT', 'Jurnal posted bersifat immutable');
    end if;
  end if;

  -- Nomor urut per workspace per tahun buku.
  select coalesce(max(split_part(entry_number, '-', 3)::integer), 0) + 1 into v_seq
  from public.journal_entries
  where workspace_id = v_ws and entry_number like 'JU-' || extract(year from v_date)::integer || '-%';
  v_number := 'JU-' || extract(year from v_date)::integer || '-' || lpad(v_seq::text, 4, '0');

  perform set_config('app.posting', 'on', true);
  if p_draft_id is null then
    insert into public.journal_entries (workspace_id, entry_number, entry_date, description, status, source,
                                        counterparty, settlement_of, reversal_of, correction_of, return_of, posted_at)
    values (v_ws, v_number, v_date, v_description, 'posted', v_source,
            v_counterparty, v_settlement_of, v_reversal_of, v_correction_of, v_return_of, now())
    returning id into v_id;
  else
    delete from public.journal_lines where journal_entry_id = p_draft_id;
    update public.journal_entries set
      entry_number = v_number, entry_date = v_date, description = v_description, status = 'posted',
      source = v_source, counterparty = v_counterparty, settlement_of = v_settlement_of,
      reversal_of = v_reversal_of, correction_of = v_correction_of, return_of = v_return_of, posted_at = now()
    where id = p_draft_id;
    v_id := p_draft_id;
  end if;
  perform app.insert_lines(v_id, v_ws, v_lines);
  perform set_config('app.posting', '', true);
  return v_id;
end
$$;

-- Audit: perubahan status pesanan katering (sumber: 20261005090000_restore_workspace.sql).
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text;
begin
  -- Saat pemulihan backup, riwayat lama disalin langsung (ADR 023).
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if v_entity = 'journal' then
      v_action := case
        when v_new ->> 'status' = 'draft' then 'create_draft'
        when v_new ->> 'reversal_of' is not null then 'reverse'
        else 'post'
      end;
    else
      v_action := 'create';
    end if;
  elsif tg_op = 'DELETE' then
    -- Hard delete hanya terjadi lewat cascade saat data user dihapus; aplikasi
    -- memakai soft delete (tercatat di atas). Workspace-nya ikut terhapus,
    -- sehingga tidak ada tempat mencatat log.
    return null;
  elsif v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then
    v_action := case when v_entity = 'journal' then 'delete_draft' else 'delete' end;
  elsif v_entity = 'journal' then
    v_action := case
      when v_old ->> 'status' = 'draft' and v_new ->> 'status' = 'posted' then
        case when v_new ->> 'reversal_of' is not null then 'reverse' else 'post' end
      else 'update_draft'
    end;
  elsif v_entity = 'invoice' and v_old ->> 'status' = 'draft' and v_new ->> 'status' = 'issued' then
    v_action := 'issue';
  elsif v_entity = 'catering_order' and v_old ->> 'state' <> v_new ->> 'state' then
    v_action := case v_new ->> 'state' when 'confirmed' then 'confirm' when 'completed' then 'complete'
                  when 'cancelled' then 'cancel' else 'update' end;
  elsif v_entity = 'period' and v_old ->> 'status' <> v_new ->> 'status' then
    v_action := case when v_new ->> 'status' = 'closed' then 'close' else 'reopen' end;
  elsif v_entity = 'workspace'
    and (v_old ->> 'sales_tax_rate_bps' <> v_new ->> 'sales_tax_rate_bps'
         or v_old ->> 'sales_tax_inclusive' <> v_new ->> 'sales_tax_inclusive'
         or v_old ->> 'sales_tax_label' <> v_new ->> 'sales_tax_label'
         or v_old ->> 'sales_tax_mode' <> v_new ->> 'sales_tax_mode'
         or v_old ->> 'vat_dpp_numerator' <> v_new ->> 'vat_dpp_numerator'
         or v_old ->> 'vat_dpp_denominator' <> v_new ->> 'vat_dpp_denominator') then
    v_action := 'update_tax_settings';
  elsif v_entity = 'workspace'
    and (v_old ->> 'inventory_method' <> v_new ->> 'inventory_method'
         or v_old -> 'cost_method_history' <> v_new -> 'cost_method_history'
         or v_old ->> 'stock_valuation' <> v_new ->> 'stock_valuation') then
    v_action := 'update_inventory_settings';
  else
    v_action := 'update';
  end if;

  insert into public.audit_logs (workspace_id, entity_type, entity_id, action, reason, before, after, actor_id)
  values (
    case when v_entity = 'workspace' then (v_row ->> 'id')::uuid else (v_row ->> 'workspace_id')::uuid end,
    v_entity,
    (v_row ->> 'id')::uuid,
    v_action,
    nullif(current_setting('app.audit_reason', true), ''),
    v_old,
    v_new,
    auth.uid()
  );
  return null;
end
$$;

-- Pajak: label PBJT (sumber: 20260930150000_full_vat_mode.sql).
create or replace function public.update_workspace_tax_settings(p_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := p_settings ->> 'mode';
  v_label text := p_settings ->> 'label';
  v_rate integer := (p_settings ->> 'rateBps')::integer;
  v_num integer := (p_settings ->> 'dppNumerator')::integer;
  v_den integer := (p_settings ->> 'dppDenominator')::integer;
begin
  perform app.require_owner(p_id);
  if v_rate is null or v_rate < 0 or v_rate > 10000 then
    perform app.raise_error('INVALID_AMOUNT', 'Tarif pajak harus antara 0% dan 100%');
  end if;
  if v_label is null or v_label not in ('PB1', 'PPN', 'PBJT') then
    perform app.raise_error('INVALID_TAX_LABEL', 'Jenis pajak penjualan harus PB1, PPN, atau PBJT');
  end if;
  if v_mode is null or v_mode not in ('simple', 'full_vat') then
    perform app.raise_error('INVALID_TAX_LABEL', 'Mode pajak tidak dikenal');
  end if;
  if v_mode = 'full_vat' and v_label <> 'PPN' then
    perform app.raise_error('INVALID_TAX_LABEL', 'Mode PPN lengkap hanya untuk pajak berlabel PPN');
  end if;
  if v_num is null or v_den is null or v_num < 1 or v_num > v_den or v_den > 1000 then
    perform app.raise_error('INVALID_AMOUNT', 'DPP harus pecahan bulat 1–1000 dengan pembilang ≤ penyebut (mis. 11/12)');
  end if;
  update public.workspaces
  set sales_tax_mode = v_mode, sales_tax_label = v_label, sales_tax_rate_bps = v_rate,
      sales_tax_inclusive = coalesce((p_settings ->> 'inclusive')::boolean, false),
      vat_dpp_numerator = v_num, vat_dpp_denominator = v_den
  where id = p_id;
end
$$;

-- Profil usaha: prefix quotation (sumber: 20261004150000_purchase_invoices.sql).
create or replace function public.save_business_profile(p_workspace_id uuid, p_profile jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_workspace_id);
  insert into public.workspace_profiles as p (workspace_id, display_name, address, phone, email, npwp, bank_info,
    invoice_notes, invoice_prefix, purchase_prefix, quotation_prefix, logo_data_url)
  values (p_workspace_id, p_profile ->> 'displayName', p_profile ->> 'address', p_profile ->> 'phone', p_profile ->> 'email',
    p_profile ->> 'npwp', p_profile ->> 'bankInfo', p_profile ->> 'invoiceNotes', coalesce(p_profile ->> 'invoicePrefix', 'INV'),
    coalesce(p_profile ->> 'purchasePrefix', 'PB'), coalesce(p_profile ->> 'quotationPrefix', 'QUO'),
    p_profile ->> 'logoDataUrl')
  on conflict (workspace_id) do update set
    display_name = excluded.display_name, address = excluded.address, phone = excluded.phone, email = excluded.email,
    npwp = excluded.npwp, bank_info = excluded.bank_info, invoice_notes = excluded.invoice_notes,
    invoice_prefix = excluded.invoice_prefix, purchase_prefix = excluded.purchase_prefix,
    quotation_prefix = excluded.quotation_prefix,
    logo_data_url = excluded.logo_data_url;
exception
  when check_violation then
    perform app.raise_error('INVALID_PROFILE', 'Prefix nomor faktur atau logo tidak valid');
end
$$;

-- Kontak: kebijakan pembatalan default (sumber: 20261004090000_invoices.sql).
create or replace function public.create_contact(p_workspace_id uuid, p_contact jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_owner(p_workspace_id);
  if not app.contact_fields_valid(p_contact) then
    perform app.raise_error('INVALID_INVOICE', 'Data kontak tidak valid');
  end if;
  insert into public.contacts (workspace_id, name, is_customer, is_supplier, address, phone, email, npwp, payment_term_days, notes,
    cancellation_policy)
  values (p_workspace_id, btrim(p_contact ->> 'name'), (p_contact ->> 'isCustomer')::boolean, (p_contact ->> 'isSupplier')::boolean,
    p_contact ->> 'address', p_contact ->> 'phone', p_contact ->> 'email', p_contact ->> 'npwp',
    (p_contact ->> 'paymentTermDays')::integer, p_contact ->> 'notes', case when jsonb_typeof(p_contact -> 'cancellationPolicy') = 'object' then p_contact -> 'cancellationPolicy' end)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_CONTACT', format('Kontak %s sudah ada', p_contact ->> 'name'));
  when check_violation or not_null_violation then
    perform app.raise_error('INVALID_INVOICE', 'Nama, peran, dan termin kontak tidak valid');
end
$$;

create or replace function public.update_contact(p_id uuid, p_contact jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.contacts;
begin
  select * into v_old from public.contacts where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('CONTACT_NOT_FOUND', 'Kontak tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if not app.contact_fields_valid(p_contact) then
    perform app.raise_error('INVALID_INVOICE', 'Data kontak tidak valid');
  end if;
  update public.contacts set
    name = btrim(p_contact ->> 'name'), is_customer = (p_contact ->> 'isCustomer')::boolean,
    is_supplier = (p_contact ->> 'isSupplier')::boolean, address = p_contact ->> 'address', phone = p_contact ->> 'phone',
    email = p_contact ->> 'email', npwp = p_contact ->> 'npwp', payment_term_days = (p_contact ->> 'paymentTermDays')::integer,
    notes = p_contact ->> 'notes', cancellation_policy = case when jsonb_typeof(p_contact -> 'cancellationPolicy') = 'object' then p_contact -> 'cancellationPolicy' end
  where id = p_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_CONTACT', format('Kontak %s sudah ada', p_contact ->> 'name'));
  when check_violation or not_null_violation then
    perform app.raise_error('INVALID_INVOICE', 'Nama, peran, dan termin kontak tidak valid');
end
$$;

create or replace function public.delete_contact(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.contacts;
begin
  select * into v_old from public.contacts where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('CONTACT_NOT_FOUND', 'Kontak tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if exists (select 1 from public.invoices i where i.contact_id = p_id and i.deleted_at is null) then
    perform app.raise_error('CONTACT_IN_USE', 'Kontak sudah dipakai faktur; tidak bisa dihapus');
  end if;
  if exists (select 1 from public.catering_orders o where o.contact_id = p_id and o.deleted_at is null) then
    perform app.raise_error('CONTACT_IN_USE', 'Kontak sudah dipakai pesanan; tidak bisa dihapus');
  end if;
  update public.contacts set deleted_at = now() where id = p_id;
end
$$;

-- Pulihkan backup: pesanan katering, invoice DP, tag pesanan (sumber: 20261006090000_invoice_discount.sql).
create or replace function public.restore_workspace(p_backup jsonb, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_ws uuid := gen_random_uuid();
  w jsonb := p_backup -> 'workspace';
  v_journal jsonb;
  v_id uuid;
  v_count integer;
  v_debit numeric;
  v_credit numeric;
  v_ok boolean;
  v_row public.workspaces;
begin
  if v_owner is null then
    perform app.raise_error('NOT_FOUND', 'Harus masuk untuk memulihkan backup');
  end if;
  if p_backup ->> 'format' is distinct from 'act-project/workspace-backup' or p_backup ->> 'version' is distinct from '1'
     or jsonb_typeof(w) <> 'object' then
    perform app.raise_error('INVALID_BACKUP', 'Bukan file backup aplikasi ini');
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    perform app.raise_error('EMPTY_NAME', 'Nama workspace wajib diisi');
  end if;

  begin
    perform set_config('app.restoring', 'on', true);
    perform set_config('app.posting', 'on', true);

    insert into public.workspaces (id, owner_id, name, template_type, currency, books_start_date, sales_tax_rate_bps,
      sales_tax_inclusive, sales_tax_label, sales_tax_mode, vat_dpp_numerator, vat_dpp_denominator, inventory_method,
      cost_method_history, stock_valuation)
    values (v_ws, v_owner, btrim(p_name), w ->> 'templateType', 'IDR', (w ->> 'booksStartDate')::date,
      (w ->> 'salesTaxRateBps')::integer, (w ->> 'salesTaxInclusive')::boolean, coalesce(w ->> 'salesTaxLabel', 'PB1'),
      coalesce(w ->> 'salesTaxMode', 'simple'), coalesce((w ->> 'vatDppNumerator')::integer, 1),
      coalesce((w ->> 'vatDppDenominator')::integer, 1), coalesce(w ->> 'inventoryMethod', 'periodic'),
      coalesce(w -> 'costMethodHistory', '[]'::jsonb), coalesce(w ->> 'stockValuation', 'average'));

    insert into public.accounts (id, workspace_id, code, name, account_type, normal_balance, cash_flow_category, is_cash,
      system_role, is_active, created_at)
    select app.remap(a ->> 'id', v_ws), v_ws, a ->> 'code', a ->> 'name', a ->> 'accountType', a ->> 'normalBalance',
      a ->> 'cashFlowCategory', (a ->> 'isCash')::boolean, a ->> 'systemRole', coalesce((a ->> 'isActive')::boolean, true),
      coalesce((a ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'accounts', '[]'::jsonb)) a;

    insert into public.periods (id, workspace_id, start_date, end_date, status)
    select app.remap(p ->> 'id', v_ws), v_ws, (p ->> 'startDate')::date, (p ->> 'endDate')::date, p ->> 'status'
    from jsonb_array_elements(coalesce(p_backup -> 'periods', '[]'::jsonb)) p;

    insert into public.items (id, workspace_id, code, name, unit, revenue_account_id, category, is_active, created_at)
    select app.remap(i ->> 'id', v_ws), v_ws, i ->> 'code', i ->> 'name', i ->> 'unit', app.remap(i ->> 'revenueAccountId', v_ws),
      i ->> 'category', coalesce((i ->> 'isActive')::boolean, true), coalesce((i ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'items', '[]'::jsonb)) i;

    -- Kontak & pesanan sebelum jurnal (baris jurnal merujuk pesanan); faktur pesanan dipasang setelah faktur.
    insert into public.contacts (id, workspace_id, name, is_customer, is_supplier, address, phone, email, npwp, payment_term_days,
      notes, cancellation_policy, created_at)
    select app.remap(c ->> 'id', v_ws), v_ws, c ->> 'name', (c ->> 'isCustomer')::boolean, (c ->> 'isSupplier')::boolean,
      c ->> 'address', c ->> 'phone', c ->> 'email', c ->> 'npwp', (c ->> 'paymentTermDays')::integer, c ->> 'notes',
      case when jsonb_typeof(c -> 'cancellationPolicy') = 'object' then c -> 'cancellationPolicy' end,
      coalesce((c ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'contacts', '[]'::jsonb)) c;

    insert into public.catering_orders (id, workspace_id, number, number_year, number_seq, contact_id, service_type, event_date,
      event_time, location, pax, quote_date, valid_until, apply_tax, discount_kind, discount_value, notes, cancellation_policy, lines,
      state, cancelled_at, cancel_reason, created_at)
    select app.remap(o ->> 'id', v_ws), v_ws, o ->> 'number',
      (regexp_match(o ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[1]::integer,
      (regexp_match(o ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[2]::integer,
      app.remap(o ->> 'contactId', v_ws), o ->> 'serviceType', (o ->> 'eventDate')::date, o ->> 'eventTime', o ->> 'location',
      (o ->> 'pax')::integer, (o ->> 'quoteDate')::date, (o ->> 'validUntil')::date, coalesce((o ->> 'applyTax')::boolean, false),
      o -> 'discount' ->> 'kind', (o -> 'discount' ->> 'value')::bigint, o ->> 'notes', o -> 'cancellationPolicy',
      coalesce((select jsonb_agg(l || jsonb_build_object('accountId', coalesce(app.remap(nullif(l ->> 'accountId', ''), v_ws)::text, ''))
                                 order by n)
                from jsonb_array_elements(o -> 'lines') with ordinality x(l, n)), '[]'::jsonb),
      -- Selesai dipasang setelah faktur dipulihkan (constraint status ↔ faktur).
      case when o ->> 'state' = 'completed' then 'confirmed' else o ->> 'state' end,
      (o ->> 'cancelledAt')::timestamptz, o ->> 'cancelReason', coalesce((o ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'cateringOrders', '[]'::jsonb)) o;

    -- Jurnal berurutan: jurnal asal sebelum pembalik/pelunasan/retur.
    for v_journal in
      select j from jsonb_array_elements(coalesce(p_backup -> 'journals', '[]'::jsonb)) j
      order by coalesce(j ->> 'postedAt', j ->> 'createdAt'), j ->> 'createdAt'
    loop
      if v_journal ->> 'status' = 'posted' then
        select count(*), coalesce(sum((l ->> 'debit')::numeric), 0), coalesce(sum((l ->> 'credit')::numeric), 0),
          coalesce(bool_and(nullif(l ->> 'accountId', '') is not null
            and (((l ->> 'debit')::numeric > 0) <> ((l ->> 'credit')::numeric > 0))), false)
        into v_count, v_debit, v_credit, v_ok
        from jsonb_array_elements(v_journal -> 'lines') l;
        if v_count < 2 or v_debit <> v_credit or not v_ok then
          perform app.raise_error('INVALID_BACKUP',
            format('Jurnal %s di backup tidak seimbang atau barisnya tidak valid', v_journal ->> 'entryNumber'));
        end if;
      end if;
      v_id := app.remap(v_journal ->> 'id', v_ws);
      insert into public.journal_entries (id, workspace_id, entry_number, entry_date, description, status, source,
        counterparty, settlement_of, reversal_of, correction_of, return_of, posted_at, created_at)
      values (v_id, v_ws, v_journal ->> 'entryNumber', (v_journal ->> 'entryDate')::date, coalesce(v_journal ->> 'description', ''),
        v_journal ->> 'status', v_journal ->> 'source', v_journal ->> 'counterparty',
        app.remap(v_journal ->> 'settlementOf', v_ws), app.remap(v_journal ->> 'reversalOf', v_ws),
        app.remap(v_journal ->> 'correctionOf', v_ws), app.remap(v_journal ->> 'returnOf', v_ws),
        (v_journal ->> 'postedAt')::timestamptz, coalesce((v_journal ->> 'createdAt')::timestamptz, now()));
      insert into public.journal_lines (id, journal_entry_id, workspace_id, account_id, line_no, description, debit, credit,
        item_id, quantity, order_id)
      select app.remap(coalesce(l.v ->> 'id', v_id::text || l.n::text), v_ws), v_id, v_ws, app.remap(l.v ->> 'accountId', v_ws),
        coalesce((l.v ->> 'lineNo')::integer, l.n), l.v ->> 'description', (l.v ->> 'debit')::bigint, (l.v ->> 'credit')::bigint,
        app.remap(l.v ->> 'itemId', v_ws), (l.v ->> 'quantity')::bigint, app.remap(l.v ->> 'orderId', v_ws)
      from jsonb_array_elements(v_journal -> 'lines') with ordinality l(v, n);
    end loop;

    insert into public.stock_counts (id, workspace_id, count_date, valuation, journal_entry_id, created_at)
    select app.remap(c ->> 'id', v_ws), v_ws, (c ->> 'countDate')::date, c ->> 'valuation', app.remap(c ->> 'journalEntryId', v_ws),
      coalesce((c ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'stockCounts', '[]'::jsonb)) c;
    insert into public.stock_count_lines (stock_count_id, workspace_id, item_id, quantity, value)
    select app.remap(c ->> 'id', v_ws), v_ws, app.remap(l ->> 'itemId', v_ws), (l ->> 'quantity')::bigint, (l ->> 'value')::bigint
    from jsonb_array_elements(coalesce(p_backup -> 'stockCounts', '[]'::jsonb)) c, jsonb_array_elements(c -> 'lines') l;

    insert into public.menus (id, workspace_id, code, name, category, price, revenue_account_id, is_active, created_at)
    select app.remap(m ->> 'id', v_ws), v_ws, m ->> 'code', m ->> 'name', m ->> 'category', (m ->> 'price')::bigint,
      app.remap(m ->> 'revenueAccountId', v_ws), coalesce((m ->> 'isActive')::boolean, true), coalesce((m ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'menus', '[]'::jsonb)) m;

    insert into public.recipes (id, workspace_id, menu_id, effective_from, yield_portions, created_at)
    select app.remap(r ->> 'id', v_ws), v_ws, app.remap(r ->> 'menuId', v_ws), (r ->> 'effectiveFrom')::date,
      (r ->> 'yieldPortions')::integer, coalesce((r ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'recipes', '[]'::jsonb)) r;
    insert into public.recipe_lines (recipe_id, workspace_id, line_no, item_id, quantity)
    select app.remap(r ->> 'id', v_ws), v_ws, l.n, app.remap(l.v ->> 'itemId', v_ws), (l.v ->> 'quantity')::bigint
    from jsonb_array_elements(coalesce(p_backup -> 'recipes', '[]'::jsonb)) r, jsonb_array_elements(r -> 'lines') with ordinality l(v, n);

    insert into public.portion_summaries (id, workspace_id, date_from, date_to, note, created_at)
    select app.remap(s ->> 'id', v_ws), v_ws, (s ->> 'dateFrom')::date, (s ->> 'dateTo')::date, s ->> 'note',
      coalesce((s ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'portionSummaries', '[]'::jsonb)) s;
    insert into public.portion_summary_lines (summary_id, workspace_id, line_no, menu_id, portions)
    select app.remap(s ->> 'id', v_ws), v_ws, l.n, app.remap(l.v ->> 'menuId', v_ws), (l.v ->> 'portions')::bigint
    from jsonb_array_elements(coalesce(p_backup -> 'portionSummaries', '[]'::jsonb)) s, jsonb_array_elements(s -> 'lines') with ordinality l(v, n);

    insert into public.menu_sale_lines (journal_entry_id, workspace_id, line_no, menu_id, portions, amount)
    select app.remap(s ->> 'journalEntryId', v_ws), v_ws, l.n, app.remap(l.v ->> 'menuId', v_ws), (l.v ->> 'portions')::bigint,
      (l.v ->> 'amount')::bigint
    from jsonb_array_elements(coalesce(p_backup -> 'menuSales', '[]'::jsonb)) s, jsonb_array_elements(s -> 'lines') with ordinality l(v, n);

    if jsonb_typeof(p_backup -> 'profile') = 'object' then
      insert into public.workspace_profiles (workspace_id, display_name, address, phone, email, npwp, bank_info, invoice_notes,
        invoice_prefix, purchase_prefix, quotation_prefix, logo_data_url)
      select v_ws, p ->> 'displayName', p ->> 'address', p ->> 'phone', p ->> 'email', p ->> 'npwp', p ->> 'bankInfo',
        p ->> 'invoiceNotes', coalesce(p ->> 'invoicePrefix', 'INV'), coalesce(p ->> 'purchasePrefix', 'PB'),
        coalesce(p ->> 'quotationPrefix', 'QUO'), p ->> 'logoDataUrl'
      from (select p_backup -> 'profile' as p) x;
    end if;


    insert into public.invoices (id, workspace_id, kind, contact_id, invoice_date, due_date, reference, notes, apply_tax,
      tax_override, discount_kind, discount_value, status, number, number_year, number_seq, journal_entry_id, contact_snapshot,
      issued_at, created_at)
    select app.remap(i ->> 'id', v_ws), v_ws, i ->> 'kind', app.remap(i ->> 'contactId', v_ws), (i ->> 'invoiceDate')::date,
      (i ->> 'dueDate')::date, i ->> 'reference', i ->> 'notes', coalesce((i ->> 'applyTax')::boolean, false),
      (i ->> 'taxOverride')::bigint, i -> 'discount' ->> 'kind', (i -> 'discount' ->> 'value')::bigint, i ->> 'status', i ->> 'number',
      (regexp_match(i ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[1]::integer,
      (regexp_match(i ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[2]::integer,
      app.remap(i ->> 'journalEntryId', v_ws), case when jsonb_typeof(i -> 'contactSnapshot') = 'object' then i -> 'contactSnapshot' end,
      (i ->> 'issuedAt')::timestamptz, coalesce((i ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'invoices', '[]'::jsonb)) i;
    insert into public.invoice_lines (invoice_id, workspace_id, line_no, description, quantity, unit, unit_price, account_id, item_id)
    select app.remap(i ->> 'id', v_ws), v_ws, l.n, coalesce(l.v ->> 'description', ''), (l.v ->> 'quantity')::bigint, l.v ->> 'unit',
      (l.v ->> 'unitPrice')::bigint, app.remap(l.v ->> 'accountId', v_ws), app.remap(l.v ->> 'itemId', v_ws)
    from jsonb_array_elements(coalesce(p_backup -> 'invoices', '[]'::jsonb)) i, jsonb_array_elements(i -> 'lines') with ordinality l(v, n);

    update public.catering_orders o set state = 'completed', invoice_id = app.remap(x ->> 'invoiceId', v_ws)
    from jsonb_array_elements(coalesce(p_backup -> 'cateringOrders', '[]'::jsonb)) x
    where o.id = app.remap(x ->> 'id', v_ws) and x ->> 'state' = 'completed';

    insert into public.catering_order_bills (id, workspace_id, order_id, number, number_year, number_seq, bill_date, due_date,
      amount, note, created_at)
    select app.remap(b ->> 'id', v_ws), v_ws, app.remap(b ->> 'orderId', v_ws), b ->> 'number',
      (regexp_match(b ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[1]::integer,
      (regexp_match(b ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[2]::integer,
      (b ->> 'billDate')::date, (b ->> 'dueDate')::date, (b ->> 'amount')::bigint, b ->> 'note',
      coalesce((b ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'orderBills', '[]'::jsonb)) b;

    -- Riwayat audit lama disalin; entity_id dipetakan ke ID baru.
    insert into public.audit_logs (workspace_id, entity_type, entity_id, action, reason, before, after, actor_id, created_at)
    select v_ws, a ->> 'entityType',
      case when a ->> 'entityType' = 'workspace' then v_ws else app.remap(a ->> 'entityId', v_ws) end,
      a ->> 'action', a ->> 'reason', a -> 'before', a -> 'after', app.to_uuid(a ->> 'actorId'),
      coalesce((a ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'auditLogs', '[]'::jsonb)) a
    order by a ->> 'createdAt';

    perform set_config('app.restoring', '', true);
    perform set_config('app.posting', '', true);
  exception
    when others then
      if sqlstate = 'P0001' then
        raise;
      end if;
      perform app.raise_error('INVALID_BACKUP', format('Backup tidak dapat dipulihkan: %s', sqlerrm));
  end;

  select * into v_row from public.workspaces where id = v_ws;
  insert into public.audit_logs (workspace_id, entity_type, entity_id, action, reason, before, after, actor_id)
  values (v_ws, 'workspace', v_ws, 'restore',
    format('Dipulihkan dari backup "%s" (%s)', w ->> 'name', p_backup ->> 'exportedAt'), null, to_jsonb(v_row), v_owner);
  return v_ws;
end
$$;

-- 6. RPC pesanan.
create or replace function app.order_lines(p_ws uuid, p_lines jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_line jsonb;
  v_i integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_account uuid;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    perform app.raise_error('INVALID_ORDER', 'Baris pesanan tidak valid (maks. 200)');
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_line -> 'quantity') <> 'number' or (v_line ->> 'quantity') !~ '^[0-9]{1,15}$'
       or jsonb_typeof(v_line -> 'unitPrice') <> 'number' or (v_line ->> 'unitPrice') !~ '^[0-9]{1,15}$' then
      perform app.raise_error('INVALID_QUANTITY', format('Baris %s: qty dan harga harus bilangan bulat ≥ 0', v_i));
    end if;
    v_account := app.to_uuid(v_line ->> 'accountId');
    if v_account is not null and not exists (select 1 from public.accounts a where a.id = v_account and a.workspace_id = p_ws) then
      perform app.raise_error('INVALID_ACCOUNT', format('Baris %s: akun tidak ditemukan di workspace ini', v_i));
    end if;
    v_out := v_out || jsonb_build_object(
      'description', btrim(coalesce(v_line ->> 'description', '')),
      'quantity', (v_line ->> 'quantity')::bigint,
      'unit', nullif(btrim(coalesce(v_line ->> 'unit', '')), ''),
      'unitPrice', (v_line ->> 'unitPrice')::bigint,
      'accountId', coalesce(v_account::text, ''),
      'itemId', null);
  end loop;
  return v_out;
end
$$;

create or replace function public.save_catering_order(p_order jsonb, p_prefix text, p_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_order ->> 'workspaceId');
  v_old public.catering_orders;
  v_quote date;
  v_event date;
  v_valid date;
  v_lines jsonb;
  v_policy jsonb := coalesce(p_order -> 'cancellationPolicy', '{"kind": "refund", "forfeitBps": 0}'::jsonb);
  v_discount jsonb := p_order -> 'discount';
  v_pax jsonb := p_order -> 'pax';
  v_year integer;
  v_seq integer;
  v_id uuid := p_id;
begin
  perform app.require_owner(v_ws);
  begin
    v_quote := (p_order ->> 'quoteDate')::date;
    v_event := (p_order ->> 'eventDate')::date;
    v_valid := (p_order ->> 'validUntil')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal pesanan tidak valid');
  end;
  if v_quote is null or v_event is null or v_valid is null or v_valid < v_quote then
    perform app.raise_error('INVALID_DATE', 'Tanggal pesanan tidak valid');
  end if;
  if not exists (select 1 from public.contacts c where c.id = app.to_uuid(p_order ->> 'contactId')
                 and c.workspace_id = v_ws and c.deleted_at is null) then
    perform app.raise_error('CONTACT_NOT_FOUND', 'Pilih klien dari daftar kontak');
  end if;
  if v_pax is null or jsonb_typeof(v_pax) <> 'number' or (v_pax #>> '{}') !~ '^[0-9]{1,7}$' or (v_pax #>> '{}')::integer < 1 then
    perform app.raise_error('INVALID_ORDER', 'Jumlah pax harus bilangan bulat ≥ 1');
  end if;
  if not app.cancellation_policy_valid(v_policy) then
    perform app.raise_error('INVALID_ORDER', 'Kebijakan pembatalan tidak valid');
  end if;
  if jsonb_typeof(v_discount) = 'object' and (v_discount ->> 'kind' not in ('percent', 'amount')
     or jsonb_typeof(v_discount -> 'value') <> 'number' or (v_discount ->> 'value') !~ '^[0-9]{1,15}$') then
    perform app.raise_error('INVALID_AMOUNT', 'Diskon pesanan tidak valid');
  end if;
  if jsonb_typeof(v_discount) is distinct from 'object' or (v_discount ->> 'value')::bigint = 0 then
    v_discount := null;
  end if;
  v_lines := app.order_lines(v_ws, coalesce(p_order -> 'lines', '[]'::jsonb));

  if p_id is null then
    if p_prefix is null or p_prefix !~ '^[A-Z0-9-]{1,12}$' then
      perform app.raise_error('INVALID_PROFILE', 'Prefix nomor quotation tidak valid');
    end if;
    perform 1 from public.workspaces where id = v_ws for update;
    v_year := extract(year from v_quote)::integer;
    select coalesce(max(number_seq), 0) + 1 into v_seq from public.catering_orders
    where workspace_id = v_ws and number_year = v_year;
    insert into public.catering_orders (workspace_id, number, number_year, number_seq, contact_id, service_type, event_date,
      event_time, location, pax, quote_date, valid_until, apply_tax, discount_kind, discount_value, notes, cancellation_policy, lines)
    values (v_ws, format('%s/%s/%s/%s', p_prefix, v_year, to_char(v_quote, 'MM'), lpad(v_seq::text, 4, '0')), v_year, v_seq,
      app.to_uuid(p_order ->> 'contactId'), p_order ->> 'serviceType', v_event,
      nullif(btrim(coalesce(p_order ->> 'eventTime', '')), ''), nullif(btrim(coalesce(p_order ->> 'location', '')), ''),
      (v_pax #>> '{}')::integer, v_quote, v_valid, coalesce((p_order ->> 'applyTax')::boolean, false),
      v_discount ->> 'kind', (v_discount ->> 'value')::bigint, nullif(btrim(coalesce(p_order ->> 'notes', '')), ''),
      case when v_policy ->> 'kind' = 'forfeit_percent' then v_policy else jsonb_build_object('kind', v_policy ->> 'kind', 'forfeitBps', 0) end,
      v_lines)
    returning id into v_id;
  else
    select * into v_old from public.catering_orders where id = p_id and deleted_at is null for update;
    if not found or v_old.workspace_id <> v_ws then
      perform app.raise_error('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan');
    end if;
    if v_old.state in ('completed', 'cancelled') then
      perform app.raise_error('INVALID_ORDER', 'Pesanan selesai/dibatalkan tidak dapat diubah');
    end if;
    update public.catering_orders set
      contact_id = app.to_uuid(p_order ->> 'contactId'), service_type = p_order ->> 'serviceType', event_date = v_event,
      event_time = nullif(btrim(coalesce(p_order ->> 'eventTime', '')), ''),
      location = nullif(btrim(coalesce(p_order ->> 'location', '')), ''), pax = (v_pax #>> '{}')::integer,
      quote_date = v_quote, valid_until = v_valid, apply_tax = coalesce((p_order ->> 'applyTax')::boolean, false),
      discount_kind = v_discount ->> 'kind', discount_value = (v_discount ->> 'value')::bigint,
      notes = nullif(btrim(coalesce(p_order ->> 'notes', '')), ''),
      cancellation_policy = case when v_policy ->> 'kind' = 'forfeit_percent' then v_policy
                                 else jsonb_build_object('kind', v_policy ->> 'kind', 'forfeitBps', 0) end,
      lines = v_lines
    where id = p_id;
  end if;
  return v_id;
exception
  when check_violation or not_null_violation or invalid_text_representation then
    perform app.raise_error('INVALID_ORDER', 'Data pesanan tidak valid');
end
$$;

create or replace function public.confirm_catering_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.catering_orders;
begin
  select * into v_order from public.catering_orders where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan');
  end if;
  perform app.require_owner(v_order.workspace_id);
  if v_order.state <> 'quotation' then
    perform app.raise_error('INVALID_ORDER', 'Hanya penawaran yang dapat dikonfirmasi');
  end if;
  if jsonb_array_length(v_order.lines) = 0 or exists (
    select 1 from jsonb_array_elements(v_order.lines) l
    left join public.accounts a on a.id = app.to_uuid(l ->> 'accountId')
    where btrim(coalesce(l ->> 'description', '')) = '' or (l ->> 'quantity')::bigint <= 0 or (l ->> 'unitPrice')::bigint <= 0
       or a.id is null or a.account_type <> 'revenue') then
    perform app.raise_error('INVALID_ORDER', 'Lengkapi baris pesanan (keterangan, qty, harga, akun pendapatan)');
  end if;
  update public.catering_orders set state = 'confirmed' where id = p_id;
end
$$;

create or replace function public.delete_catering_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.catering_orders;
begin
  select * into v_order from public.catering_orders where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan');
  end if;
  perform app.require_owner(v_order.workspace_id);
  if v_order.state <> 'quotation' then
    perform app.raise_error('ORDER_IN_USE', 'Hanya penawaran yang dapat dihapus; pesanan lain dibatalkan');
  end if;
  if exists (select 1 from public.catering_order_bills b where b.order_id = p_id and b.deleted_at is null)
     or exists (select 1 from public.journal_lines l join public.journal_entries e on e.id = l.journal_entry_id
                where l.order_id = p_id and e.deleted_at is null) then
    perform app.raise_error('ORDER_IN_USE', 'Penawaran sudah punya invoice DP atau jurnal; tidak bisa dihapus');
  end if;
  update public.catering_orders set deleted_at = now() where id = p_id;
end
$$;

create or replace function public.create_order_bill(p_bill jsonb, p_prefix text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.catering_orders;
  v_date date;
  v_due date;
  v_year integer;
  v_seq integer;
  v_id uuid;
begin
  select * into v_order from public.catering_orders where id = app.to_uuid(p_bill ->> 'orderId') and deleted_at is null for update;
  if not found or v_order.workspace_id is distinct from app.to_uuid(p_bill ->> 'workspaceId') then
    perform app.raise_error('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan');
  end if;
  perform app.require_owner(v_order.workspace_id);
  if v_order.state in ('completed', 'cancelled') then
    perform app.raise_error('INVALID_ORDER', 'Invoice DP hanya untuk pesanan yang belum selesai/dibatalkan');
  end if;
  begin
    v_date := (p_bill ->> 'billDate')::date;
    v_due := (p_bill ->> 'dueDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal invoice DP tidak valid');
  end;
  if v_date is null or v_due is null or v_due < v_date then
    perform app.raise_error('INVALID_DATE', 'Tanggal invoice DP tidak valid');
  end if;
  if jsonb_typeof(p_bill -> 'amount') <> 'number' or (p_bill ->> 'amount') !~ '^[0-9]{1,15}$' or (p_bill ->> 'amount')::bigint <= 0 then
    perform app.raise_error('INVALID_AMOUNT', 'Nominal DP harus lebih dari 0');
  end if;
  if p_prefix is null or p_prefix !~ '^[A-Z0-9-]{1,16}$' then
    perform app.raise_error('INVALID_PROFILE', 'Prefix nomor invoice DP tidak valid');
  end if;
  perform 1 from public.workspaces where id = v_order.workspace_id for update;
  v_year := extract(year from v_date)::integer;
  select coalesce(max(number_seq), 0) + 1 into v_seq from public.catering_order_bills
  where workspace_id = v_order.workspace_id and number_year = v_year;
  insert into public.catering_order_bills (workspace_id, order_id, number, number_year, number_seq, bill_date, due_date, amount, note)
  values (v_order.workspace_id, v_order.id, format('%s/%s/%s/%s', p_prefix, v_year, to_char(v_date, 'MM'), lpad(v_seq::text, 4, '0')),
    v_year, v_seq, v_date, v_due, (p_bill ->> 'amount')::bigint, nullif(btrim(coalesce(p_bill ->> 'note', '')), ''))
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.delete_order_bill(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.catering_order_bills;
  v_state text;
begin
  select * into v_bill from public.catering_order_bills where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Invoice DP tidak ditemukan');
  end if;
  perform app.require_owner(v_bill.workspace_id);
  select state into v_state from public.catering_orders where id = v_bill.order_id;
  if v_state in ('completed', 'cancelled') then
    perform app.raise_error('INVALID_ORDER', 'Invoice DP pesanan selesai/dibatalkan tidak dapat dihapus');
  end if;
  update public.catering_order_bills set deleted_at = now() where id = p_id;
end
$$;

-- Selesai: faktur penjualan terbit + saldo DP melunasi faktur, atomik.
create or replace function public.complete_catering_order(p_id uuid, p_invoice jsonb, p_journal jsonb, p_contact jsonb, p_prefix text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.catering_orders;
  v_invoice public.invoices;
  v_invoice_id uuid;
  v_claim numeric;
  v_apply numeric;
  v_deposits uuid;
  v_receivable uuid;
begin
  select * into v_order from public.catering_orders where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan');
  end if;
  perform app.require_owner(v_order.workspace_id);
  if v_order.state <> 'confirmed' then
    perform app.raise_error('INVALID_ORDER', 'Hanya pesanan dikonfirmasi yang dapat diselesaikan');
  end if;
  if app.to_uuid(p_invoice ->> 'workspaceId') is distinct from v_order.workspace_id or p_invoice ->> 'kind' is distinct from 'sale'
     or app.to_uuid(p_invoice ->> 'contactId') is distinct from v_order.contact_id then
    perform app.raise_error('INVALID_ORDER', 'Faktur harus faktur penjualan untuk klien pesanan ini');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_journal -> 'lines', '[]'::jsonb)) l
             where app.to_uuid(l ->> 'orderId') is distinct from p_id) then
    perform app.raise_error('INVALID_ORDER', 'Semua baris jurnal faktur harus bertag pesanan ini');
  end if;
  v_invoice_id := public.save_invoice_draft(p_invoice, null);
  perform public.issue_invoice(v_invoice_id, p_journal, p_contact, p_prefix);
  select * into v_invoice from public.invoices where id = v_invoice_id;

  select id into v_deposits from public.accounts
  where workspace_id = v_order.workspace_id and system_role = 'customer_deposits' and deleted_at is null limit 1;
  select id into v_receivable from public.accounts
  where workspace_id = v_order.workspace_id and system_role = 'accounts_receivable' and deleted_at is null limit 1;
  select coalesce(sum(l.debit - l.credit), 0) into v_claim from public.journal_lines l
  where l.journal_entry_id = v_invoice.journal_entry_id and l.account_id = v_receivable;
  v_apply := least(app.order_deposit_balance(p_id), v_claim);
  if v_apply > 0 then
    perform app.post_journal_core(jsonb_build_object(
      'workspaceId', v_order.workspace_id,
      'entryDate', v_invoice.invoice_date,
      'description', format('DP dipakai untuk faktur pesanan %s · %s', v_order.number, p_contact ->> 'name'),
      'source', 'settlement',
      'counterparty', p_contact ->> 'name',
      'settlementOf', v_invoice.journal_entry_id,
      'lines', jsonb_build_array(
        jsonb_build_object('accountId', v_deposits, 'description', 'Pemakaian uang muka', 'debit', v_apply, 'credit', 0, 'orderId', p_id),
        jsonb_build_object('accountId', v_receivable, 'debit', 0, 'credit', v_apply, 'orderId', p_id))),
      null, 'public');
  end if;
  update public.catering_orders set state = 'completed', invoice_id = v_invoice_id where id = p_id;
end
$$;

-- Batal: jurnal pembatalan (bila ada saldo DP) harus menolkan saldo DP, atomik.
create or replace function public.cancel_catering_order(p_id uuid, p_journal jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.catering_orders;
begin
  select * into v_order from public.catering_orders where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan');
  end if;
  perform app.require_owner(v_order.workspace_id);
  if v_order.state in ('completed', 'cancelled') then
    perform app.raise_error('INVALID_ORDER', 'Pesanan selesai/dibatalkan tidak dapat dibatalkan lagi');
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    perform app.raise_error('EMPTY_REASON', 'Alasan pembatalan wajib diisi');
  end if;
  perform set_config('app.audit_reason', btrim(p_reason), true);
  if jsonb_typeof(p_journal) = 'object' then
    if p_journal ->> 'source' is distinct from 'deposit' or app.to_uuid(p_journal ->> 'workspaceId') is distinct from v_order.workspace_id then
      perform app.raise_error('INVALID_DEPOSIT', 'Jurnal pembatalan harus jurnal uang muka pesanan ini');
    end if;
    perform app.post_journal_core(p_journal, null, 'public');
  end if;
  if app.order_deposit_balance(p_id) <> 0 then
    perform app.raise_error('INVALID_DEPOSIT', 'Saldo DP pesanan harus dikembalikan/dihanguskan seluruhnya saat pembatalan');
  end if;
  update public.catering_orders set state = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_id;
  perform set_config('app.audit_reason', '', true);
end
$$;

revoke all on function public.save_catering_order(jsonb, text, uuid), public.confirm_catering_order(uuid),
  public.delete_catering_order(uuid), public.create_order_bill(jsonb, text), public.delete_order_bill(uuid),
  public.complete_catering_order(uuid, jsonb, jsonb, jsonb, text), public.cancel_catering_order(uuid, jsonb, text)
  from public, anon;
grant execute on function public.save_catering_order(jsonb, text, uuid), public.confirm_catering_order(uuid),
  public.delete_catering_order(uuid), public.create_order_bill(jsonb, text), public.delete_order_bill(uuid),
  public.complete_catering_order(uuid, jsonb, jsonb, jsonb, text), public.cancel_catering_order(uuid, jsonb, text)
  to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
