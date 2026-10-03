-- Stok opname sisa bahan & COGS (ADR 020, ROADMAP Fase 6A).

-- 1. Section bahan & dasar nilai stok.
alter table public.items add column category text;
alter table public.workspaces add column stock_valuation text not null default 'average'
  check (stock_valuation in ('average', 'last'));

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
  insert into public.items (workspace_id, code, name, unit, revenue_account_id, category)
  values (p_workspace_id, btrim(p_item ->> 'code'), btrim(p_item ->> 'name'), btrim(p_item ->> 'unit'),
          app.to_uuid(p_item ->> 'revenueAccountId'), nullif(btrim(coalesce(p_item ->> 'category', '')), ''))
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
    category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch ->> 'category', '')), '')
                    else category end,
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
  v_valuation text := p_settings ->> 'stockValuation';
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
  if v_valuation is not null and v_valuation not in ('average', 'last') then
    perform app.raise_error('INVALID_STOCK_COUNT', 'Metode nilai stok tidak dikenal');
  end if;
  update public.workspaces set inventory_method = v_method, cost_method_history = v_history,
    stock_valuation = coalesce(v_valuation, stock_valuation)
  where id = p_id;
end
$$;

-- Audit: perubahan dasar nilai stok termasuk update_inventory_settings.
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

-- 2. Stok opname (header + baris per bahan).
create table public.stock_counts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  count_date       date not null,
  valuation        text not null check (valuation in ('average', 'last')),
  journal_entry_id uuid,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint stock_counts_id_workspace_key unique (id, workspace_id),
  constraint stock_counts_journal_fkey foreign key (journal_entry_id, workspace_id)
    references public.journal_entries (id, workspace_id)
);
create index stock_counts_workspace_idx on public.stock_counts (workspace_id, count_date);

create table public.stock_count_lines (
  id             uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null,
  workspace_id   uuid not null,
  item_id        uuid not null,
  quantity       bigint not null check (quantity >= 0),
  value          bigint not null check (value >= 0),
  constraint stock_count_lines_count_fkey foreign key (stock_count_id, workspace_id)
    references public.stock_counts (id, workspace_id) on delete cascade,
  constraint stock_count_lines_item_fkey foreign key (item_id, workspace_id)
    references public.items (id, workspace_id),
  constraint stock_count_lines_item_key unique (stock_count_id, item_id)
);

alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
revoke all on public.stock_counts, public.stock_count_lines from anon, authenticated;
grant select on public.stock_counts, public.stock_count_lines to authenticated;
create policy stock_counts_select_own on public.stock_counts
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy stock_count_lines_select_own on public.stock_count_lines
  for select to authenticated using (app.owns_workspace(workspace_id));

-- Aktif = belum dibatalkan dan jurnalnya (bila ada) belum di-void.
create or replace function app.stock_count_active(p_count public.stock_counts)
returns boolean
language sql
stable
as $$
  select p_count.deleted_at is null
     and (p_count.journal_entry_id is null or app.active_reversal(p_count.journal_entry_id) is null);
$$;

-- 3. Simpan stok opname + jurnal penyesuaian secara atomik.
create or replace function public.post_stock_count(p_count jsonb, p_journal jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_count ->> 'workspaceId');
  v_valuation text := p_count ->> 'valuation';
  v_lines jsonb := coalesce(p_count -> 'lines', '[]'::jsonb);
  v_date date;
  v_latest date;
  v_line jsonb;
  v_i integer := 0;
  v_item public.items;
  v_journal uuid;
  v_id uuid;
begin
  perform app.require_owner(v_ws);
  perform 1 from public.workspaces where id = v_ws for update;
  begin
    v_date := (p_count ->> 'countDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal stok opname tidak valid');
  end;
  if v_date is null then
    perform app.raise_error('INVALID_DATE', 'Tanggal stok opname wajib diisi');
  end if;
  if v_valuation is null or v_valuation not in ('average', 'last') then
    perform app.raise_error('INVALID_STOCK_COUNT', 'Metode nilai stok tidak dikenal');
  end if;
  select max(c.count_date) into v_latest from public.stock_counts c
  where c.workspace_id = v_ws and app.stock_count_active(c);
  if v_latest is not null and v_date <= v_latest then
    perform app.raise_error('INVALID_STOCK_COUNT', format('Tanggal stok opname harus setelah stok opname terakhir (%s)', v_latest));
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    perform app.raise_error('INVALID_STOCK_COUNT', 'Baris stok opname tidak valid');
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_i := v_i + 1;
    select * into v_item from public.items where id = app.to_uuid(v_line ->> 'itemId');
    if not found or v_item.workspace_id <> v_ws or v_item.deleted_at is not null then
      perform app.raise_error('ITEM_NOT_FOUND', 'Barang pada stok opname tidak ditemukan');
    end if;
    if jsonb_typeof(v_line -> 'quantity') <> 'number' or (v_line ->> 'quantity') !~ '^[0-9]{1,15}$'
       or jsonb_typeof(v_line -> 'value') <> 'number' or (v_line ->> 'value') !~ '^[0-9]{1,18}$' then
      perform app.raise_error('INVALID_QUANTITY', format('Baris %s: qty dan nilai harus bilangan bulat >= 0', v_i));
    end if;
  end loop;

  if p_journal is not null and jsonb_typeof(p_journal) = 'object' then
    if p_journal ->> 'source' <> 'adjustment' or app.to_uuid(p_journal ->> 'workspaceId') <> v_ws
       or (p_journal ->> 'entryDate')::date <> v_date then
      perform app.raise_error('INVALID_STOCK_COUNT', 'Jurnal stok opname harus penyesuaian bertanggal sama dengan stok opname');
    end if;
    v_journal := app.post_journal_core(p_journal, null, 'public');
  end if;

  insert into public.stock_counts (workspace_id, count_date, valuation, journal_entry_id)
  values (v_ws, v_date, v_valuation, v_journal)
  returning id into v_id;
  begin
    insert into public.stock_count_lines (stock_count_id, workspace_id, item_id, quantity, value)
    select v_id, v_ws, app.to_uuid(l ->> 'itemId'), (l ->> 'quantity')::bigint, (l ->> 'value')::bigint
    from jsonb_array_elements(v_lines) l;
  exception when unique_violation then
    perform app.raise_error('INVALID_STOCK_COUNT', 'Barang yang sama muncul dua kali');
  end;
  return v_id;
end
$$;

-- 4. Batalkan stok opname terakhir: jurnalnya dibalik, header ditandai dihapus.
create or replace function public.cancel_stock_count(p_id uuid, p_reversal_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
  v_latest uuid;
  v_original public.journal_entries;
begin
  select * into v_count from public.stock_counts where id = p_id for update;
  if not found or not app.stock_count_active(v_count) then
    perform app.raise_error('NOT_FOUND', 'Stok opname tidak ditemukan');
  end if;
  perform app.require_owner(v_count.workspace_id);
  select c.id into v_latest from public.stock_counts c
  where c.workspace_id = v_count.workspace_id and app.stock_count_active(c)
  order by c.count_date desc limit 1;
  if v_latest <> p_id then
    perform app.raise_error('INVALID_STOCK_COUNT', 'Hanya stok opname terakhir yang dapat dibatalkan');
  end if;
  if v_count.journal_entry_id is not null then
    select * into v_original from public.journal_entries where id = v_count.journal_entry_id;
    perform app.post_journal_core(jsonb_build_object(
      'workspaceId', v_original.workspace_id,
      'entryDate', p_reversal_date,
      'description', 'Pembatalan stok opname ' || v_count.count_date,
      'source', 'reversal',
      'reversalOf', v_original.id,
      'counterparty', v_original.counterparty,
      'lines', (select jsonb_agg(jsonb_build_object(
                  'accountId', l.account_id, 'description', l.description,
                  'debit', l.credit, 'credit', l.debit, 'itemId', l.item_id, 'quantity', l.quantity)
                order by l.line_no)
                from public.journal_lines l where l.journal_entry_id = v_original.id)
    ), null, 'public');
  end if;
  update public.stock_counts set deleted_at = now() where id = p_id;
end
$$;

revoke all on function public.post_stock_count(jsonb, jsonb), public.cancel_stock_count(uuid, date) from public, anon;
grant execute on function public.post_stock_count(jsonb, jsonb), public.cancel_stock_count(uuid, date) to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
