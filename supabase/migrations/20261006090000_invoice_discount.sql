-- Diskon faktur (ROADMAP Fase 8B): persen (basis poin) atau rupiah per faktur.

alter table public.invoices
  add column discount_kind text check (discount_kind in ('percent', 'amount')),
  add column discount_value bigint check (discount_value is null or discount_value >= 0),
  add constraint invoices_discount_check check ((discount_kind is null) = (discount_value is null)
    and (discount_kind is distinct from 'percent' or discount_value <= 10000));

create or replace function public.save_invoice_draft(p_invoice jsonb, p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_invoice ->> 'workspaceId');
  v_kind text := p_invoice ->> 'kind';
  v_contact uuid := app.to_uuid(p_invoice ->> 'contactId');
  v_lines jsonb := coalesce(p_invoice -> 'lines', '[]'::jsonb);
  v_line jsonb;
  v_old public.invoices;
  v_date date;
  v_due date;
  v_id uuid := p_id;
begin
  perform app.require_owner(v_ws);
  if v_kind is null or v_kind not in ('sale', 'purchase') then
    perform app.raise_error('INVALID_INVOICE', 'Jenis faktur tidak dikenal');
  end if;
  begin
    v_date := (p_invoice ->> 'invoiceDate')::date;
    v_due := (p_invoice ->> 'dueDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal faktur/jatuh tempo tidak valid');
  end;
  if v_date is null or v_due is null then
    perform app.raise_error('INVALID_DATE', 'Tanggal faktur/jatuh tempo wajib diisi');
  end if;
  if v_contact is not null and not exists (select 1 from public.contacts c where c.id = v_contact and c.workspace_id = v_ws and c.deleted_at is null) then
    perform app.raise_error('CONTACT_NOT_FOUND', 'Kontak tidak ditemukan');
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) > 200 then
    perform app.raise_error('INVALID_INVOICE', 'Baris faktur tidak valid (maks. 200)');
  end if;
  if p_invoice -> 'taxOverride' is not null and jsonb_typeof(p_invoice -> 'taxOverride') <> 'null'
     and (jsonb_typeof(p_invoice -> 'taxOverride') <> 'number' or (p_invoice ->> 'taxOverride') !~ '^[0-9]{1,15}$') then
    perform app.raise_error('INVALID_AMOUNT', 'PPN Masukan harus bilangan bulat ≥ 0');
  end if;
  if jsonb_typeof(p_invoice -> 'discount') = 'object' and (
       (p_invoice -> 'discount' ->> 'kind') is null or (p_invoice -> 'discount' ->> 'kind') not in ('percent', 'amount')
       or jsonb_typeof(p_invoice -> 'discount' -> 'value') <> 'number' or (p_invoice -> 'discount' ->> 'value') !~ '^[0-9]{1,15}$'
       or ((p_invoice -> 'discount' ->> 'kind') = 'percent' and (p_invoice -> 'discount' ->> 'value')::bigint > 10000)) then
    perform app.raise_error('INVALID_AMOUNT', 'Diskon faktur tidak valid');
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(v_line -> 'quantity') <> 'number' or (v_line ->> 'quantity') !~ '^[0-9]{1,15}$'
       or jsonb_typeof(v_line -> 'unitPrice') <> 'number' or (v_line ->> 'unitPrice') !~ '^[0-9]{1,15}$' then
      perform app.raise_error('INVALID_QUANTITY', 'Qty dan harga harus bilangan bulat ≥ 0');
    end if;
  end loop;

  if v_id is not null then
    select * into v_old from public.invoices where id = v_id and deleted_at is null for update;
    if not found or v_old.workspace_id <> v_ws then
      perform app.raise_error('INVOICE_NOT_FOUND', 'Faktur tidak ditemukan');
    end if;
    if v_old.status <> 'draft' then
      perform app.raise_error('INVALID_INVOICE', 'Faktur terbit tidak dapat diubah');
    end if;
    if v_old.kind <> v_kind then
      perform app.raise_error('INVALID_INVOICE', 'Jenis faktur tidak dapat diubah');
    end if;
    update public.invoices set contact_id = v_contact, invoice_date = v_date, due_date = v_due,
      reference = p_invoice ->> 'reference', notes = p_invoice ->> 'notes',
      apply_tax = coalesce((p_invoice ->> 'applyTax')::boolean, false),
      tax_override = (p_invoice ->> 'taxOverride')::bigint,
      discount_kind = p_invoice -> 'discount' ->> 'kind',
      discount_value = (p_invoice -> 'discount' ->> 'value')::bigint
    where id = v_id;
    delete from public.invoice_lines where invoice_id = v_id;
  else
    insert into public.invoices (workspace_id, kind, contact_id, invoice_date, due_date, reference, notes, apply_tax, tax_override, discount_kind, discount_value)
    values (v_ws, v_kind, v_contact, v_date, v_due, p_invoice ->> 'reference', p_invoice ->> 'notes',
      coalesce((p_invoice ->> 'applyTax')::boolean, false), (p_invoice ->> 'taxOverride')::bigint,
      p_invoice -> 'discount' ->> 'kind', (p_invoice -> 'discount' ->> 'value')::bigint)
    returning id into v_id;
  end if;
  begin
    insert into public.invoice_lines (invoice_id, workspace_id, line_no, description, quantity, unit, unit_price, account_id, item_id)
    select v_id, v_ws, l.n, coalesce(l.v ->> 'description', ''), (l.v ->> 'quantity')::bigint, l.v ->> 'unit',
      (l.v ->> 'unitPrice')::bigint, app.to_uuid(nullif(l.v ->> 'accountId', '')), app.to_uuid(nullif(l.v ->> 'itemId', ''))
    from jsonb_array_elements(v_lines) with ordinality l(v, n);
  exception when foreign_key_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun atau barang pada baris faktur tidak ditemukan di workspace ini');
  end;
  return v_id;
end
$$;

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
        item_id, quantity)
      select app.remap(coalesce(l.v ->> 'id', v_id::text || l.n::text), v_ws), v_id, v_ws, app.remap(l.v ->> 'accountId', v_ws),
        coalesce((l.v ->> 'lineNo')::integer, l.n), l.v ->> 'description', (l.v ->> 'debit')::bigint, (l.v ->> 'credit')::bigint,
        app.remap(l.v ->> 'itemId', v_ws), (l.v ->> 'quantity')::bigint
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
        invoice_prefix, purchase_prefix, logo_data_url)
      select v_ws, p ->> 'displayName', p ->> 'address', p ->> 'phone', p ->> 'email', p ->> 'npwp', p ->> 'bankInfo',
        p ->> 'invoiceNotes', coalesce(p ->> 'invoicePrefix', 'INV'), coalesce(p ->> 'purchasePrefix', 'PB'), p ->> 'logoDataUrl'
      from (select p_backup -> 'profile' as p) x;
    end if;

    insert into public.contacts (id, workspace_id, name, is_customer, is_supplier, address, phone, email, npwp, payment_term_days,
      notes, created_at)
    select app.remap(c ->> 'id', v_ws), v_ws, c ->> 'name', (c ->> 'isCustomer')::boolean, (c ->> 'isSupplier')::boolean,
      c ->> 'address', c ->> 'phone', c ->> 'email', c ->> 'npwp', (c ->> 'paymentTermDays')::integer, c ->> 'notes',
      coalesce((c ->> 'createdAt')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_backup -> 'contacts', '[]'::jsonb)) c;

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

revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
