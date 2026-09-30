-- Persediaan perpetual per barang (ADR 017, ROADMAP Fase 4C).

-- 1. Master barang.
create table public.items (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  code               text not null check (btrim(code) <> ''),
  name               text not null check (btrim(name) <> ''),
  unit               text not null check (btrim(unit) <> ''),
  revenue_account_id uuid,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint items_id_workspace_key unique (id, workspace_id),
  constraint items_revenue_account_fkey foreign key (revenue_account_id, workspace_id)
    references public.accounts (id, workspace_id)
);
create unique index items_code_key on public.items (workspace_id, code) where deleted_at is null;
create trigger items_touch before update on public.items
  for each row execute function app.touch_updated_at();

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('workspace', 'account', 'period', 'journal', 'item'));
create trigger items_audit after insert or update or delete on public.items
  for each row execute function app.audit_row('item');

alter table public.items enable row level security;
revoke all on public.items from anon, authenticated;
grant select on public.items to authenticated;
create policy items_select_own on public.items
  for select to authenticated using (app.owns_workspace(workspace_id));

-- 2. Baris jurnal membawa barang & qty; retur merujuk transaksi asal.
alter table public.journal_lines
  add column item_id uuid,
  add column quantity bigint,
  add constraint journal_lines_quantity_check check (quantity is null or quantity >= 0),
  add constraint journal_lines_item_quantity_check check ((item_id is null) = (quantity is null)),
  add constraint journal_lines_item_fkey foreign key (item_id, workspace_id)
    references public.items (id, workspace_id);
create index journal_lines_item_idx on public.journal_lines (item_id) where item_id is not null;

alter table public.journal_entries
  add column return_of uuid,
  add constraint journal_entries_return_fkey foreign key (return_of, workspace_id)
    references public.journal_entries (id, workspace_id);
create index journal_entries_return_idx on public.journal_entries (return_of) where return_of is not null;
alter table public.journal_entries drop constraint journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check check (source in (
  'manual', 'revenue', 'expense', 'purchase', 'adjustment', 'opening_balance',
  'settlement', 'tax_payment', 'reversal', 'closing', 'return'));

-- 3. Metode persediaan & riwayat metode biaya per workspace.
alter table public.workspaces
  add column inventory_method text not null default 'periodic'
    check (inventory_method in ('periodic', 'perpetual')),
  add column cost_method_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cost_method_history) = 'array');

-- 4. Peran akun Retur & Potongan Penjualan; akun 4-1900 template Retail memakainya.
alter table public.accounts drop constraint accounts_system_role_check;
alter table public.accounts add constraint accounts_system_role_check check (system_role in (
  'opening_balance_equity', 'retained_earnings', 'owner_capital', 'drawings',
  'inventory', 'cogs', 'accounts_receivable', 'accounts_payable',
  'sales_tax_payable', 'income_summary', 'input_vat', 'non_creditable_vat', 'sales_returns'));
select set_config('app.audit_reason', 'Migrasi ADR 017: akun retur penjualan menjadi akun sistem', false);
update public.accounts a set system_role = 'sales_returns'
where a.code = '4-1900' and a.name = 'Retur & Potongan Penjualan' and a.system_role is null and a.deleted_at is null
  and exists (select 1 from public.workspaces w where w.id = a.workspace_id and w.template_type = 'retail')
  and not exists (select 1 from public.accounts b where b.workspace_id = a.workspace_id and b.system_role = 'sales_returns');
select set_config('app.audit_reason', '', false);

-- 5. Audit: perubahan metode persediaan.
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
         or v_old -> 'cost_method_history' <> v_new -> 'cost_method_history') then
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

-- 6. Baris jurnal disimpan beserta barang & qty.
create or replace function app.insert_lines(p_entry_id uuid, p_workspace_id uuid, p_lines jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.journal_lines (journal_entry_id, workspace_id, account_id, line_no, description, debit, credit,
                                    item_id, quantity)
  select p_entry_id, p_workspace_id, app.to_uuid(l.value ->> 'accountId'), l.ordinality::integer,
         nullif(btrim(coalesce(l.value ->> 'description', '')), ''),
         app.amount(l.value -> 'debit', l.ordinality::integer),
         app.amount(l.value -> 'credit', l.ordinality::integer),
         app.to_uuid(l.value ->> 'itemId'),
         case when app.to_uuid(l.value ->> 'itemId') is null then null
              else app.amount(l.value -> 'quantity', l.ordinality::integer) end
  from jsonb_array_elements(p_lines) with ordinality as l(value, ordinality);
exception when foreign_key_violation then
  perform app.raise_error('ACCOUNT_NOT_FOUND', 'Akun atau barang tidak ditemukan di workspace ini');
end
$$;

-- 7. Retur aktif & validasinya (cermin src/core/returns.ts).
create or replace function app.active_return_ids(p_target_id uuid)
returns setof uuid
language sql
stable
as $$
  select r.id from public.journal_entries r
  where r.return_of = p_target_id and r.status = 'posted' and r.deleted_at is null
    and app.active_reversal(r.id) is null;
$$;

create or replace function app.validate_return(p_workspace_id uuid, p_source text, p_target_id uuid, p_lines jsonb)
returns void
language plpgsql
as $$
declare
  v_target public.journal_entries;
  v_item uuid;
  v_requested bigint;
  v_original bigint;
  v_returned bigint;
begin
  if p_source not in ('return', 'settlement') then
    perform app.raise_error('INVALID_RETURN', 'Jurnal retur harus bersumber ''return'' atau ''settlement''');
  end if;
  select * into v_target from public.journal_entries where id = p_target_id for update;
  if not found or v_target.workspace_id <> p_workspace_id or v_target.deleted_at is not null
     or v_target.status <> 'posted' then
    perform app.raise_error('INVALID_RETURN', 'Transaksi yang diretur tidak ditemukan');
  end if;
  if app.active_reversal(v_target.id) is not null then
    perform app.raise_error('INVALID_RETURN', 'Transaksi yang diretur sudah di-void');
  end if;
  if v_target.source not in ('revenue', 'purchase') then
    perform app.raise_error('INVALID_RETURN', 'Transaksi asal bukan penjualan/pembelian barang');
  end if;

  for v_item, v_requested in
    select app.to_uuid(l.value ->> 'itemId'), sum((l.value ->> 'quantity')::bigint)
    from jsonb_array_elements(p_lines) l
    join public.accounts a on a.id = app.to_uuid(l.value ->> 'accountId') and a.system_role = 'inventory'
    where app.to_uuid(l.value ->> 'itemId') is not null
    group by 1
  loop
    select coalesce(sum(t.quantity), 0) into v_original
    from public.journal_lines t join public.accounts a on a.id = t.account_id and a.system_role = 'inventory'
    where t.journal_entry_id = v_target.id and t.item_id = v_item;
    if v_original = 0 then
      perform app.raise_error('INVALID_RETURN', 'Barang tidak ada pada transaksi asal');
    end if;
    select coalesce(sum(r.quantity), 0) into v_returned
    from public.journal_lines r join public.accounts a on a.id = r.account_id and a.system_role = 'inventory'
    where r.item_id = v_item and r.journal_entry_id in (select app.active_return_ids(v_target.id));
    if v_requested + v_returned > v_original then
      perform app.raise_error('INVALID_RETURN',
        format('Qty retur melebihi sisa yang dapat diretur (%s)', v_original - v_returned));
    end if;
  end loop;
end
$$;

-- 8. Posting & draft membawa retur dan barang.
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
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
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

create or replace function public.save_journal_draft(p_input jsonb, p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_input ->> 'workspaceId');
  v_lines jsonb := coalesce(p_input -> 'lines', '[]'::jsonb);
  v_date date;
  v_draft public.journal_entries;
  v_id uuid;
begin
  perform app.require_owner(v_ws);
  perform app.check_line_amounts(v_lines);
  begin
    v_date := (p_input ->> 'entryDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal tidak valid (format YYYY-MM-DD)');
  end;
  if v_date is null then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal wajib diisi');
  end if;

  if p_draft_id is not null then
    select * into v_draft from public.journal_entries where id = p_draft_id for update;
    if not found or v_draft.workspace_id <> v_ws or v_draft.deleted_at is not null then
      perform app.raise_error('NOT_FOUND', 'Jurnal tidak ditemukan');
    end if;
    if v_draft.status <> 'draft' then
      perform app.raise_error('NOT_DRAFT', 'Jurnal posted bersifat immutable');
    end if;
    delete from public.journal_lines where journal_entry_id = p_draft_id;
    update public.journal_entries set
      entry_date = v_date,
      description = btrim(coalesce(p_input ->> 'description', '')),
      source = p_input ->> 'source',
      counterparty = nullif(btrim(coalesce(p_input ->> 'counterparty', '')), ''),
      settlement_of = app.to_uuid(p_input ->> 'settlementOf'),
      correction_of = app.to_uuid(p_input ->> 'correctionOf'),
      return_of = app.to_uuid(p_input ->> 'returnOf')
    where id = p_draft_id;
    v_id := p_draft_id;
  else
    insert into public.journal_entries (workspace_id, entry_date, description, status, source,
                                        counterparty, settlement_of, correction_of, return_of)
    values (v_ws, v_date, btrim(coalesce(p_input ->> 'description', '')), 'draft', p_input ->> 'source',
            nullif(btrim(coalesce(p_input ->> 'counterparty', '')), ''),
            app.to_uuid(p_input ->> 'settlementOf'), app.to_uuid(p_input ->> 'correctionOf'),
            app.to_uuid(p_input ->> 'returnOf'))
    returning id into v_id;
  end if;

  perform app.insert_lines(v_id, v_ws, v_lines);
  return v_id;
end
$$;

-- 9. RPC master barang.
create or replace function public.create_item(p_workspace_id uuid, p_item jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_owner(p_workspace_id);
  insert into public.items (workspace_id, code, name, unit, revenue_account_id)
  values (p_workspace_id, btrim(p_item ->> 'code'), btrim(p_item ->> 'name'), btrim(p_item ->> 'unit'),
          app.to_uuid(p_item ->> 'revenueAccountId'))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_ITEM_CODE', format('Kode barang %s sudah dipakai', p_item ->> 'code'));
  when foreign_key_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun pendapatan default tidak ditemukan di workspace ini');
  when check_violation or not_null_violation then
    perform app.raise_error('EMPTY_NAME', 'Kode, nama, dan satuan barang wajib diisi');
end
$$;

create or replace function public.update_item(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.items;
begin
  select * into v_old from public.items where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('ITEM_NOT_FOUND', 'Barang tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  update public.items set
    code = coalesce(btrim(p_patch ->> 'code'), code),
    name = coalesce(btrim(p_patch ->> 'name'), name),
    unit = coalesce(btrim(p_patch ->> 'unit'), unit),
    revenue_account_id = case when p_patch ? 'revenueAccountId' then app.to_uuid(p_patch ->> 'revenueAccountId')
                              else revenue_account_id end,
    is_active = coalesce((p_patch ->> 'isActive')::boolean, is_active)
  where id = p_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_ITEM_CODE', format('Kode barang %s sudah dipakai', p_patch ->> 'code'));
  when foreign_key_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun pendapatan default tidak ditemukan di workspace ini');
  when check_violation then
    perform app.raise_error('EMPTY_NAME', 'Kode, nama, dan satuan barang wajib diisi');
end
$$;

create or replace function public.delete_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.items;
begin
  select * into v_old from public.items where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('ITEM_NOT_FOUND', 'Barang tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if exists (
    select 1 from public.journal_lines l join public.journal_entries e on e.id = l.journal_entry_id
    where l.item_id = p_id and e.deleted_at is null
  ) then
    perform app.raise_error('ITEM_IN_USE', 'Barang sudah dipakai jurnal; nonaktifkan saja, tidak bisa dihapus');
  end if;
  update public.items set deleted_at = now() where id = p_id;
end
$$;

-- 10. Pengaturan persediaan: metode & riwayat metode biaya.
create or replace function public.update_workspace_inventory_settings(p_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method text := p_settings ->> 'inventoryMethod';
  v_history jsonb := coalesce(p_settings -> 'costMethodHistory', '[]'::jsonb);
  v_entry jsonb;
  v_prev date;
  v_from date;
begin
  perform app.require_owner(p_id);
  if v_method is null or v_method not in ('periodic', 'perpetual') then
    perform app.raise_error('INVALID_ACCOUNT', 'Metode persediaan tidak dikenal');
  end if;
  if jsonb_typeof(v_history) <> 'array' then
    perform app.raise_error('INVALID_DATE', 'Riwayat metode biaya tidak valid');
  end if;
  for v_entry in select value from jsonb_array_elements(v_history) loop
    if coalesce(v_entry ->> 'method', '') not in ('average', 'fifo') then
      perform app.raise_error('INVALID_ACCOUNT', 'Metode biaya harus average atau fifo');
    end if;
    begin
      v_from := (v_entry ->> 'from')::date;
    exception when others then
      perform app.raise_error('INVALID_DATE', 'Tanggal berlaku metode biaya tidak valid');
    end;
    if v_from is null or (v_prev is not null and v_from < v_prev) then
      perform app.raise_error('INVALID_DATE', 'Riwayat metode biaya harus terurut tanggal');
    end if;
    v_prev := v_from;
  end loop;
  update public.workspaces set inventory_method = v_method, cost_method_history = v_history where id = p_id;
end
$$;

revoke all on function
  public.create_item(uuid, jsonb),
  public.update_item(uuid, jsonb),
  public.delete_item(uuid),
  public.update_workspace_inventory_settings(uuid, jsonb)
from public, anon;
grant execute on function
  public.create_item(uuid, jsonb),
  public.update_item(uuid, jsonb),
  public.delete_item(uuid),
  public.update_workspace_inventory_settings(uuid, jsonb)
to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
