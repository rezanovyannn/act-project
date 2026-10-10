-- Katering langganan pascabayar: porsi harian, tagihan bulanan (ADR 024, ROADMAP Fase 10D).

create or replace function app.weekdays_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 7
     and not exists (select 1 from jsonb_array_elements(p) d where jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[1-7]$');
$$;

create table public.catering_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  contact_id         uuid not null,
  name               text not null check (btrim(name) <> ''),
  start_date         date not null,
  end_date           date,
  price_per_portion  bigint not null check (price_per_portion > 0),
  revenue_account_id uuid not null,
  default_portions   integer not null check (default_portions between 0 and 100000),
  weekdays           jsonb not null check (app.weekdays_valid(weekdays)),
  apply_tax          boolean not null default false,
  notes              text,
  day_overrides      jsonb not null default '{}'::jsonb check (jsonb_typeof(day_overrides) = 'object'),
  billed_months      jsonb not null default '{}'::jsonb check (jsonb_typeof(billed_months) = 'object'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint catering_subscriptions_dates_check check (end_date is null or end_date >= start_date),
  constraint catering_subscriptions_contact_fkey foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id),
  constraint catering_subscriptions_account_fkey foreign key (revenue_account_id, workspace_id) references public.accounts (id, workspace_id)
);
create index catering_subscriptions_workspace_idx on public.catering_subscriptions (workspace_id);
create trigger catering_subscriptions_touch before update on public.catering_subscriptions
  for each row execute function app.touch_updated_at();

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('workspace', 'account', 'period', 'journal', 'item', 'menu', 'recipe', 'portion_summary',
    'contact', 'invoice', 'catering_order', 'order_bill', 'catering_package', 'subscription'));
create trigger catering_subscriptions_audit after insert or update or delete on public.catering_subscriptions
  for each row execute function app.audit_row('subscription');

alter table public.catering_subscriptions enable row level security;
revoke all on public.catering_subscriptions from anon, authenticated;
grant select on public.catering_subscriptions to authenticated;
create policy catering_subscriptions_select_own on public.catering_subscriptions
  for select to authenticated using (app.owns_workspace(workspace_id));

create or replace function public.save_subscription(p_workspace_id uuid, p_subscription jsonb, p_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s jsonb := p_subscription;
  v_old public.catering_subscriptions;
  v_id uuid := p_id;
begin
  perform app.require_owner(p_workspace_id);
  if not exists (select 1 from public.contacts c where c.id = app.to_uuid(s ->> 'contactId') and c.workspace_id = p_workspace_id and c.deleted_at is null) then
    perform app.raise_error('CONTACT_NOT_FOUND', 'Pilih klien dari daftar kontak');
  end if;
  if not exists (select 1 from public.accounts a where a.id = app.to_uuid(s ->> 'revenueAccountId') and a.workspace_id = p_workspace_id and a.account_type = 'revenue') then
    perform app.raise_error('INVALID_ACCOUNT', 'Pilih akun pendapatan');
  end if;
  if jsonb_typeof(s -> 'pricePerPortion') <> 'number' or (s ->> 'pricePerPortion') !~ '^[0-9]{1,15}$'
     or jsonb_typeof(s -> 'defaultPortions') <> 'number' or (s ->> 'defaultPortions') !~ '^[0-9]{1,6}$' then
    perform app.raise_error('INVALID_AMOUNT', 'Harga per porsi atau porsi per hari tidak valid');
  end if;
  if not app.weekdays_valid(s -> 'weekdays') then
    perform app.raise_error('INVALID_ORDER', 'Pilih minimal satu hari kirim');
  end if;
  begin
    perform (s ->> 'startDate')::date, (s ->> 'endDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal langganan tidak valid');
  end;
  if p_id is null then
    insert into public.catering_subscriptions (workspace_id, contact_id, name, start_date, end_date, price_per_portion, revenue_account_id,
      default_portions, weekdays, apply_tax, notes)
    values (p_workspace_id, app.to_uuid(s ->> 'contactId'), btrim(s ->> 'name'), (s ->> 'startDate')::date, (s ->> 'endDate')::date,
      (s ->> 'pricePerPortion')::bigint, app.to_uuid(s ->> 'revenueAccountId'), (s ->> 'defaultPortions')::integer, s -> 'weekdays',
      coalesce((s ->> 'applyTax')::boolean, false), nullif(btrim(coalesce(s ->> 'notes', '')), ''))
    returning id into v_id;
  else
    select * into v_old from public.catering_subscriptions where id = p_id and deleted_at is null for update;
    if not found or v_old.workspace_id <> p_workspace_id then
      perform app.raise_error('NOT_FOUND', 'Langganan tidak ditemukan');
    end if;
    update public.catering_subscriptions set contact_id = app.to_uuid(s ->> 'contactId'), name = btrim(s ->> 'name'),
      start_date = (s ->> 'startDate')::date, end_date = (s ->> 'endDate')::date, price_per_portion = (s ->> 'pricePerPortion')::bigint,
      revenue_account_id = app.to_uuid(s ->> 'revenueAccountId'), default_portions = (s ->> 'defaultPortions')::integer,
      weekdays = s -> 'weekdays', apply_tax = coalesce((s ->> 'applyTax')::boolean, false), notes = nullif(btrim(coalesce(s ->> 'notes', '')), '')
    where id = p_id;
  end if;
  return v_id;
exception
  when check_violation or not_null_violation then
    perform app.raise_error('INVALID_DATE', 'Nama, tanggal, harga, atau porsi langganan tidak valid');
end
$$;

create or replace function public.set_subscription_days(p_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.catering_subscriptions;
  v_overrides jsonb;
  v_key text;
  v_value jsonb;
begin
  select * into v_sub from public.catering_subscriptions where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Langganan tidak ditemukan');
  end if;
  perform app.require_owner(v_sub.workspace_id);
  if jsonb_typeof(p_changes) <> 'object' then
    perform app.raise_error('INVALID_QUANTITY', 'Perubahan porsi tidak valid');
  end if;
  v_overrides := v_sub.day_overrides;
  for v_key, v_value in select key, value from jsonb_each(p_changes) loop
    if v_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      perform app.raise_error('INVALID_DATE', 'Tanggal porsi tidak valid');
    end if;
    if jsonb_typeof(v_value) = 'null' then
      v_overrides := v_overrides - v_key;
    elsif jsonb_typeof(v_value) <> 'number' or (v_value #>> '{}') !~ '^[0-9]{1,6}$' then
      perform app.raise_error('INVALID_QUANTITY', 'Porsi harus bilangan bulat ≥ 0');
    else
      v_overrides := v_overrides || jsonb_build_object(v_key, (v_value #>> '{}')::integer);
    end if;
  end loop;
  update public.catering_subscriptions set day_overrides = v_overrides where id = p_id;
end
$$;

create or replace function public.delete_subscription(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.catering_subscriptions;
begin
  select * into v_sub from public.catering_subscriptions where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Langganan tidak ditemukan');
  end if;
  perform app.require_owner(v_sub.workspace_id);
  if v_sub.billed_months <> '{}'::jsonb then
    perform app.raise_error('ORDER_IN_USE', 'Langganan sudah pernah ditagih; isi tanggal berakhir saja, tidak bisa dihapus');
  end if;
  update public.catering_subscriptions set deleted_at = now() where id = p_id;
end
$$;

-- 1 klik: draft faktur penjualan bulan itu + catat bulan ditagih, atomik.
create or replace function public.create_subscription_invoice(p_id uuid, p_month text, p_invoice jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.catering_subscriptions;
  v_inv public.invoices;
  v_id uuid;
begin
  select * into v_sub from public.catering_subscriptions where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Langganan tidak ditemukan');
  end if;
  perform app.require_owner(v_sub.workspace_id);
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    perform app.raise_error('INVALID_DATE', 'Bulan tagihan tidak valid');
  end if;
  if app.to_uuid(p_invoice ->> 'workspaceId') is distinct from v_sub.workspace_id or p_invoice ->> 'kind' is distinct from 'sale'
     or app.to_uuid(p_invoice ->> 'contactId') is distinct from v_sub.contact_id then
    perform app.raise_error('INVALID_INVOICE', 'Faktur harus faktur penjualan untuk klien langganan ini');
  end if;
  select * into v_inv from public.invoices where id = app.to_uuid(v_sub.billed_months ->> p_month) and deleted_at is null;
  if found and (v_inv.status = 'draft' or app.active_reversal(v_inv.journal_entry_id) is null) then
    perform app.raise_error('INVALID_INVOICE', 'Bulan ini sudah punya tagihan langganan');
  end if;
  v_id := public.save_invoice_draft(p_invoice, null);
  update public.catering_subscriptions set billed_months = billed_months || jsonb_build_object(p_month, v_id) where id = p_id;
  return v_id;
end
$$;

-- Kontak dipakai langganan tidak dapat dihapus (sumber: 20261010090000_catering_orders.sql).
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
  if exists (select 1 from public.catering_subscriptions s where s.contact_id = p_id and s.deleted_at is null) then
    perform app.raise_error('CONTACT_IN_USE', 'Kontak sudah dipakai langganan; tidak bisa dihapus');
  end if;
  update public.contacts set deleted_at = now() where id = p_id;
end
$$;

-- Pulihkan backup: katering langganan (sumber: 20261012090000_catering_packages.sql).
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

    -- Katering langganan (setelah kontak, akun, faktur).
    insert into public.catering_subscriptions (id, workspace_id, contact_id, name, start_date, end_date, price_per_portion,
      revenue_account_id, default_portions, weekdays, apply_tax, notes, day_overrides, billed_months, created_at)
    select app.remap(s ->> 'id', v_ws), v_ws, app.remap(s ->> 'contactId', v_ws), s ->> 'name', (s ->> 'startDate')::date,
      (s ->> 'endDate')::date, (s ->> 'pricePerPortion')::bigint, app.remap(s ->> 'revenueAccountId', v_ws),
      (s ->> 'defaultPortions')::integer, coalesce(s -> 'weekdays', '[]'::jsonb), coalesce((s ->> 'applyTax')::boolean, false), s ->> 'notes',
      coalesce(s -> 'dayOverrides', '{}'::jsonb),
      coalesce((select jsonb_object_agg(b.key, app.remap(b.value #>> '{}', v_ws)) from jsonb_each(coalesce(s -> 'billedMonths', '{}'::jsonb)) b), '{}'::jsonb),
      coalesce((s ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'subscriptions', '[]'::jsonb)) s;

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

revoke all on function public.save_subscription(uuid, jsonb, uuid), public.set_subscription_days(uuid, jsonb),
  public.delete_subscription(uuid), public.create_subscription_invoice(uuid, text, jsonb) from public, anon;
grant execute on function public.save_subscription(uuid, jsonb, uuid), public.set_subscription_days(uuid, jsonb),
  public.delete_subscription(uuid), public.create_subscription_invoice(uuid, text, jsonb) to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
