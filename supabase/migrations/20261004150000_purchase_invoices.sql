-- Faktur pembelian (ADR 022, ROADMAP Fase 7B): prefix nomor internal & koreksi PPN Masukan.

alter table public.workspace_profiles
  add column purchase_prefix text not null default 'PB' check (purchase_prefix ~ '^[A-Z0-9-]{1,12}$');
alter table public.invoices
  add column tax_override bigint check (tax_override is null or tax_override >= 0);

create or replace function public.save_business_profile(p_workspace_id uuid, p_profile jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_workspace_id);
  insert into public.workspace_profiles as p (workspace_id, display_name, address, phone, email, npwp, bank_info,
    invoice_notes, invoice_prefix, purchase_prefix, logo_data_url)
  values (p_workspace_id, p_profile ->> 'displayName', p_profile ->> 'address', p_profile ->> 'phone', p_profile ->> 'email',
    p_profile ->> 'npwp', p_profile ->> 'bankInfo', p_profile ->> 'invoiceNotes', coalesce(p_profile ->> 'invoicePrefix', 'INV'),
    coalesce(p_profile ->> 'purchasePrefix', 'PB'),
    p_profile ->> 'logoDataUrl')
  on conflict (workspace_id) do update set
    display_name = excluded.display_name, address = excluded.address, phone = excluded.phone, email = excluded.email,
    npwp = excluded.npwp, bank_info = excluded.bank_info, invoice_notes = excluded.invoice_notes,
    invoice_prefix = excluded.invoice_prefix, purchase_prefix = excluded.purchase_prefix,
    logo_data_url = excluded.logo_data_url;
exception
  when check_violation then
    perform app.raise_error('INVALID_PROFILE', 'Prefix nomor faktur atau logo tidak valid');
end
$$;

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
      tax_override = (p_invoice ->> 'taxOverride')::bigint
    where id = v_id;
    delete from public.invoice_lines where invoice_id = v_id;
  else
    insert into public.invoices (workspace_id, kind, contact_id, invoice_date, due_date, reference, notes, apply_tax, tax_override)
    values (v_ws, v_kind, v_contact, v_date, v_due, p_invoice ->> 'reference', p_invoice ->> 'notes',
      coalesce((p_invoice ->> 'applyTax')::boolean, false), (p_invoice ->> 'taxOverride')::bigint)
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

revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
