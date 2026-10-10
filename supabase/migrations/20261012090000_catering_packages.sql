-- Paket menu katering, harga perkiraan bahan, baris pesanan ber-paket (ADR 024, ROADMAP Fase 10C).

-- 1. Harga perkiraan bahan: Rp estimated_price per estimated_per satuan dasar.
alter table public.items
  add column estimated_price bigint constraint items_estimated_price_check check (estimated_price is null or estimated_price >= 0),
  add column estimated_per bigint not null default 1 constraint items_estimated_per_check check (estimated_per >= 1);

-- 2. Paket menu katering (resep bahan untuk yield_pax pax, jsonb seperti baris pesanan).
create table public.catering_packages (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  code               text not null check (code ~ '^[A-Z0-9-]{1,20}$'),
  name               text not null check (btrim(name) <> ''),
  description        text,
  price_per_pax      bigint not null check (price_per_pax >= 0),
  revenue_account_id uuid,
  yield_pax          integer not null check (yield_pax between 1 and 100000),
  lines              jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 100),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint catering_packages_id_workspace_key unique (id, workspace_id),
  constraint catering_packages_revenue_account_fkey foreign key (revenue_account_id, workspace_id)
    references public.accounts (id, workspace_id)
);
create unique index catering_packages_code_key on public.catering_packages (workspace_id, code) where deleted_at is null;
create trigger catering_packages_touch before update on public.catering_packages
  for each row execute function app.touch_updated_at();

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('workspace', 'account', 'period', 'journal', 'item', 'menu', 'recipe', 'portion_summary',
    'contact', 'invoice', 'catering_order', 'order_bill', 'catering_package'));
create trigger catering_packages_audit after insert or update or delete on public.catering_packages
  for each row execute function app.audit_row('catering_package');

alter table public.catering_packages enable row level security;
revoke all on public.catering_packages from anon, authenticated;
grant select on public.catering_packages to authenticated;
create policy catering_packages_select_own on public.catering_packages
  for select to authenticated using (app.owns_workspace(workspace_id));

create or replace function public.save_catering_package(p_workspace_id uuid, p_package jsonb, p_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_item uuid;
  v_old public.catering_packages;
  v_id uuid := p_id;
begin
  perform app.require_owner(p_workspace_id);
  if jsonb_typeof(p_package -> 'lines') <> 'array' then
    perform app.raise_error('INVALID_RECIPE', 'Resep paket tidak valid');
  end if;
  for v_line in select value from jsonb_array_elements(p_package -> 'lines') loop
    v_item := app.to_uuid(v_line ->> 'itemId');
    if v_item is null or not exists (select 1 from public.items i where i.id = v_item and i.workspace_id = p_workspace_id and i.deleted_at is null) then
      perform app.raise_error('ITEM_NOT_FOUND', 'Bahan resep tidak ditemukan');
    end if;
    if jsonb_typeof(v_line -> 'quantity') <> 'number' or (v_line ->> 'quantity') !~ '^[0-9]{1,15}$' or (v_line ->> 'quantity')::bigint <= 0 then
      perform app.raise_error('INVALID_QUANTITY', 'Qty bahan resep harus bilangan bulat > 0');
    end if;
    if v_lines @> jsonb_build_array(jsonb_build_object('itemId', v_item)) then
      perform app.raise_error('INVALID_RECIPE', 'Bahan resep tercantum dua kali');
    end if;
    v_lines := v_lines || jsonb_build_object('itemId', v_item, 'quantity', (v_line ->> 'quantity')::bigint);
  end loop;
  if jsonb_typeof(p_package -> 'pricePerPax') <> 'number' or (p_package ->> 'pricePerPax') !~ '^[0-9]{1,15}$'
     or jsonb_typeof(p_package -> 'yieldPax') <> 'number' or (p_package ->> 'yieldPax') !~ '^[0-9]{1,6}$' then
    perform app.raise_error('INVALID_RECIPE', 'Harga per pax atau jumlah pax resep tidak valid');
  end if;
  if app.to_uuid(p_package ->> 'revenueAccountId') is not null and not exists (
    select 1 from public.accounts a where a.id = app.to_uuid(p_package ->> 'revenueAccountId')
      and a.workspace_id = p_workspace_id and a.account_type = 'revenue') then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun pendapatan paket tidak ditemukan');
  end if;
  if p_id is null then
    insert into public.catering_packages (workspace_id, code, name, description, price_per_pax, revenue_account_id, yield_pax, lines)
    values (p_workspace_id, upper(btrim(p_package ->> 'code')), btrim(p_package ->> 'name'), nullif(btrim(coalesce(p_package ->> 'description', '')), ''),
      (p_package ->> 'pricePerPax')::bigint, app.to_uuid(p_package ->> 'revenueAccountId'), (p_package ->> 'yieldPax')::integer, v_lines)
    returning id into v_id;
  else
    select * into v_old from public.catering_packages where id = p_id and deleted_at is null for update;
    if not found or v_old.workspace_id <> p_workspace_id then
      perform app.raise_error('MENU_NOT_FOUND', 'Paket tidak ditemukan');
    end if;
    update public.catering_packages set code = upper(btrim(p_package ->> 'code')), name = btrim(p_package ->> 'name'),
      description = nullif(btrim(coalesce(p_package ->> 'description', '')), ''), price_per_pax = (p_package ->> 'pricePerPax')::bigint,
      revenue_account_id = app.to_uuid(p_package ->> 'revenueAccountId'), yield_pax = (p_package ->> 'yieldPax')::integer, lines = v_lines
    where id = p_id;
  end if;
  return v_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_MENU_CODE', format('Kode paket %s sudah dipakai', p_package ->> 'code'));
  when check_violation or not_null_violation then
    perform app.raise_error('INVALID_RECIPE', 'Kode, nama, harga, atau resep paket tidak valid');
end
$$;

create or replace function public.set_catering_package_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.catering_packages;
begin
  select * into v_old from public.catering_packages where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('MENU_NOT_FOUND', 'Paket tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  update public.catering_packages set is_active = coalesce(p_active, is_active) where id = p_id;
end
$$;

create or replace function public.delete_catering_package(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.catering_packages;
begin
  select * into v_old from public.catering_packages where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('MENU_NOT_FOUND', 'Paket tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if exists (select 1 from public.catering_orders o, jsonb_array_elements(o.lines) l
             where o.deleted_at is null and app.to_uuid(l ->> 'packageId') = p_id) then
    perform app.raise_error('ORDER_IN_USE', 'Paket sudah dipakai pesanan; nonaktifkan saja, tidak bisa dihapus');
  end if;
  update public.catering_packages set deleted_at = now() where id = p_id;
end
$$;

-- Barang: harga perkiraan (sumber: 20261003090000_stock_count.sql, 20261003090000_stock_count.sql).
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
  insert into public.items (workspace_id, code, name, unit, revenue_account_id, category, estimated_price, estimated_per)
  values (p_workspace_id, btrim(p_item ->> 'code'), btrim(p_item ->> 'name'), btrim(p_item ->> 'unit'),
          app.to_uuid(p_item ->> 'revenueAccountId'), nullif(btrim(coalesce(p_item ->> 'category', '')), ''),
          (p_item ->> 'estimatedPrice')::bigint, coalesce((p_item ->> 'estimatedPer')::bigint, 1))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_ITEM_CODE', format('Kode barang %s sudah dipakai', p_item ->> 'code'));
  when foreign_key_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun pendapatan default tidak ditemukan di workspace ini');
  when check_violation or not_null_violation or invalid_text_representation then
    perform app.raise_error('EMPTY_NAME', 'Kode, nama, satuan, dan harga perkiraan barang harus valid');
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
    estimated_price = case when p_patch ? 'estimatedPrice' then (p_patch ->> 'estimatedPrice')::bigint else estimated_price end,
    estimated_per = case when p_patch ? 'estimatedPer' then coalesce((p_patch ->> 'estimatedPer')::bigint, 1) else estimated_per end,
    is_active = coalesce((p_patch ->> 'isActive')::boolean, is_active)
  where id = p_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_ITEM_CODE', format('Kode barang %s sudah dipakai', p_patch ->> 'code'));
  when foreign_key_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun pendapatan default tidak ditemukan di workspace ini');
  when check_violation or invalid_text_representation then
    perform app.raise_error('EMPTY_NAME', 'Kode, nama, satuan, dan harga perkiraan barang harus valid');
end
$$;

-- Bahan resep paket tidak dapat dihapus (sumber: 20261003150000_menu_recipe_variance.sql).
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
  if exists (
    select 1 from public.recipe_lines l join public.recipes r on r.id = l.recipe_id
    where l.item_id = p_id and r.deleted_at is null
  ) then
    perform app.raise_error('ITEM_IN_USE', 'Bahan dipakai resep menu; hapus dari resep dulu atau nonaktifkan saja');
  end if;
  if exists (
    select 1 from public.catering_packages p, jsonb_array_elements(p.lines) l
    where p.deleted_at is null and app.to_uuid(l ->> 'itemId') = p_id
  ) then
    perform app.raise_error('ITEM_IN_USE', 'Bahan dipakai resep paket katering; hapus dari paket dulu atau nonaktifkan saja');
  end if;
  update public.items set deleted_at = now() where id = p_id;
end
$$;

-- Baris pesanan boleh merujuk paket di workspace yang sama (sumber: 20261010090000_catering_orders.sql).
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
  v_package uuid;
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
    v_package := app.to_uuid(v_line ->> 'packageId');
    if v_package is not null and not exists (select 1 from public.catering_packages p where p.id = v_package and p.workspace_id = p_ws and p.deleted_at is null) then
      perform app.raise_error('MENU_NOT_FOUND', format('Baris %s: paket tidak ditemukan', v_i));
    end if;
    v_out := v_out || jsonb_build_object(
      'description', btrim(coalesce(v_line ->> 'description', '')),
      'quantity', (v_line ->> 'quantity')::bigint,
      'unit', nullif(btrim(coalesce(v_line ->> 'unit', '')), ''),
      'unitPrice', (v_line ->> 'unitPrice')::bigint,
      'accountId', coalesce(v_account::text, ''),
      'itemId', null,
      'packageId', v_package);
  end loop;
  return v_out;
end
$$;

-- Pulihkan backup: harga perkiraan, paket, rujukan paket di baris pesanan (sumber: 20261011090000_catering_costs_pph23.sql).
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
      cost_method_history, stock_valuation, catering_cost_mode, pph23_enabled, pph23_rate_bps)
    values (v_ws, v_owner, btrim(p_name), w ->> 'templateType', 'IDR', (w ->> 'booksStartDate')::date,
      (w ->> 'salesTaxRateBps')::integer, (w ->> 'salesTaxInclusive')::boolean, coalesce(w ->> 'salesTaxLabel', 'PB1'),
      coalesce(w ->> 'salesTaxMode', 'simple'), coalesce((w ->> 'vatDppNumerator')::integer, 1),
      coalesce((w ->> 'vatDppDenominator')::integer, 1), coalesce(w ->> 'inventoryMethod', 'periodic'),
      coalesce(w -> 'costMethodHistory', '[]'::jsonb), coalesce(w ->> 'stockValuation', 'average'),
      coalesce(w -> 'cateringSettings' ->> 'costMode', 'detail'), coalesce((w -> 'cateringSettings' ->> 'pph23Enabled')::boolean, false),
      coalesce((w -> 'cateringSettings' ->> 'pph23RateBps')::integer, 200));

    insert into public.accounts (id, workspace_id, code, name, account_type, normal_balance, cash_flow_category, is_cash,
      system_role, is_active, created_at)
    select app.remap(a ->> 'id', v_ws), v_ws, a ->> 'code', a ->> 'name', a ->> 'accountType', a ->> 'normalBalance',
      a ->> 'cashFlowCategory', (a ->> 'isCash')::boolean, a ->> 'systemRole', coalesce((a ->> 'isActive')::boolean, true),
      coalesce((a ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'accounts', '[]'::jsonb)) a;

    insert into public.periods (id, workspace_id, start_date, end_date, status)
    select app.remap(p ->> 'id', v_ws), v_ws, (p ->> 'startDate')::date, (p ->> 'endDate')::date, p ->> 'status'
    from jsonb_array_elements(coalesce(p_backup -> 'periods', '[]'::jsonb)) p;

    insert into public.items (id, workspace_id, code, name, unit, revenue_account_id, category, estimated_price, estimated_per, is_active, created_at)
    select app.remap(i ->> 'id', v_ws), v_ws, i ->> 'code', i ->> 'name', i ->> 'unit', app.remap(i ->> 'revenueAccountId', v_ws),
      i ->> 'category', (i ->> 'estimatedPrice')::bigint, coalesce((i ->> 'estimatedPer')::bigint, 1),
      coalesce((i ->> 'isActive')::boolean, true), coalesce((i ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'items', '[]'::jsonb)) i;

    -- Paket menu katering (bahan resep dipetakan ke ID baru), sebelum pesanan.
    insert into public.catering_packages (id, workspace_id, code, name, description, price_per_pax, revenue_account_id, yield_pax,
      lines, is_active, created_at)
    select app.remap(p ->> 'id', v_ws), v_ws, p ->> 'code', p ->> 'name', p ->> 'description', (p ->> 'pricePerPax')::bigint,
      app.remap(p ->> 'revenueAccountId', v_ws), (p ->> 'yieldPax')::integer,
      coalesce((select jsonb_agg(jsonb_build_object('itemId', app.remap(l ->> 'itemId', v_ws), 'quantity', (l ->> 'quantity')::bigint) order by n)
                from jsonb_array_elements(p -> 'lines') with ordinality x(l, n)), '[]'::jsonb),
      coalesce((p ->> 'isActive')::boolean, true), coalesce((p ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'cateringPackages', '[]'::jsonb)) p;

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
      cost_estimates, state, cancelled_at, cancel_reason, created_at)
    select app.remap(o ->> 'id', v_ws), v_ws, o ->> 'number',
      (regexp_match(o ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[1]::integer,
      (regexp_match(o ->> 'number', '/([0-9]{4})/[0-9]{2}/([0-9]+)$'))[2]::integer,
      app.remap(o ->> 'contactId', v_ws), o ->> 'serviceType', (o ->> 'eventDate')::date, o ->> 'eventTime', o ->> 'location',
      (o ->> 'pax')::integer, (o ->> 'quoteDate')::date, (o ->> 'validUntil')::date, coalesce((o ->> 'applyTax')::boolean, false),
      o -> 'discount' ->> 'kind', (o -> 'discount' ->> 'value')::bigint, o ->> 'notes', o -> 'cancellationPolicy',
      coalesce((select jsonb_agg(l || jsonb_build_object('accountId', coalesce(app.remap(nullif(l ->> 'accountId', ''), v_ws)::text, ''),
                                                         'packageId', app.remap(l ->> 'packageId', v_ws))
                                 order by n)
                from jsonb_array_elements(o -> 'lines') with ordinality x(l, n)), '[]'::jsonb),
      app.cost_estimates(coalesce(o -> 'costEstimates', '{}'::jsonb)),
      -- Selesai dipasang setelah faktur dipulihkan (constraint status ↔ faktur).
      case when o ->> 'state' = 'completed' then 'confirmed' else o ->> 'state' end,
      (o ->> 'cancelledAt')::timestamptz, o ->> 'cancelReason', coalesce((o ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'cateringOrders', '[]'::jsonb)) o;

    -- Jurnal berurutan: jurnal asal sebelum pembalik/pelunasan/retur.
    for v_journal in
      select j from jsonb_array_elements(coalesce(p_backup -> 'journals', '[]'::jsonb)) j
      -- Satu transaksi (mis. faktur pesanan + pemakaian DP) memakai waktu sama: nomor jurnal menentukan urutan.
      order by coalesce(j ->> 'postedAt', j ->> 'createdAt'), j ->> 'entryNumber' nulls last, j ->> 'createdAt'
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

revoke all on function public.save_catering_package(uuid, jsonb, uuid), public.set_catering_package_active(uuid, boolean),
  public.delete_catering_package(uuid) from public, anon;
grant execute on function public.save_catering_package(uuid, jsonb, uuid), public.set_catering_package_active(uuid, boolean),
  public.delete_catering_package(uuid) to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
