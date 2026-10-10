-- Pulihkan backup: jurnal dengan waktu posting sama diurutkan menurut nomor jurnal (ADR 023 & 024).
-- Faktur pesanan dan jurnal pemakaian DP diposting dalam satu transaksi sehingga waktunya sama.

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

revoke all on function public.restore_workspace(jsonb, text) from public, anon;
grant execute on function public.restore_workspace(jsonb, text) to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
