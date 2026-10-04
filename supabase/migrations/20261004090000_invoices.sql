-- Profil usaha, kontak & faktur (ADR 022, ROADMAP Fase 7A).

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('workspace', 'account', 'period', 'journal', 'item', 'menu', 'recipe', 'portion_summary', 'contact', 'invoice'));

-- Audit: faktur draft → terbit tercatat sebagai 'issue'.
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
  elsif v_entity = 'invoice' and v_old ->> 'status' = 'draft' and v_new ->> 'status' = 'issued' then
    v_action := 'issue';
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

-- 1. Profil usaha (kop faktur).
create table public.workspace_profiles (
  workspace_id   uuid primary key references public.workspaces (id) on delete cascade,
  display_name   text,
  address        text,
  phone          text,
  email          text,
  npwp           text,
  bank_info      text,
  invoice_notes  text,
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9-]{1,12}$'),
  logo_data_url  text check (logo_data_url is null or (length(logo_data_url) <= 200000
                   and logo_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$')),
  updated_at     timestamptz not null default now()
);
create trigger workspace_profiles_touch before update on public.workspace_profiles
  for each row execute function app.touch_updated_at();

-- 2. Kontak pelanggan/pemasok.
create table public.contacts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  name              text not null check (btrim(name) <> ''),
  is_customer       boolean not null default true,
  is_supplier       boolean not null default false,
  address           text,
  phone             text,
  email             text,
  npwp              text,
  payment_term_days integer not null default 0 check (payment_term_days between 0 and 365),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint contacts_role_check check (is_customer or is_supplier),
  constraint contacts_id_workspace_key unique (id, workspace_id)
);
create unique index contacts_name_key on public.contacts (workspace_id, lower(name)) where deleted_at is null;
create trigger contacts_touch before update on public.contacts
  for each row execute function app.touch_updated_at();
create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function app.audit_row('contact');

-- 3. Faktur + baris.
create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  kind             text not null check (kind in ('sale', 'purchase')),
  contact_id       uuid,
  invoice_date     date not null,
  due_date         date not null,
  reference        text,
  notes            text,
  apply_tax        boolean not null default false,
  status           text not null default 'draft' check (status in ('draft', 'issued')),
  number           text,
  number_year      integer,
  number_seq       integer,
  journal_entry_id uuid,
  contact_snapshot jsonb,
  issued_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint invoices_id_workspace_key unique (id, workspace_id),
  constraint invoices_contact_fkey foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id),
  constraint invoices_journal_fkey foreign key (journal_entry_id, workspace_id) references public.journal_entries (id, workspace_id),
  constraint invoices_state_check check (
    (status = 'draft' and number is null and journal_entry_id is null and issued_at is null)
    or (status = 'issued' and number is not null and journal_entry_id is not null and issued_at is not null
        and contact_snapshot is not null and deleted_at is null))
);
create unique index invoices_number_key on public.invoices (workspace_id, kind, number) where number is not null;
create index invoices_workspace_idx on public.invoices (workspace_id, kind, invoice_date);
create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function app.audit_row('invoice');

create table public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null,
  workspace_id uuid not null,
  line_no      integer not null,
  description  text not null default '',
  quantity     bigint not null check (quantity >= 0),
  unit         text,
  unit_price   bigint not null check (unit_price >= 0),
  account_id   uuid,
  item_id      uuid,
  constraint invoice_lines_invoice_fkey foreign key (invoice_id, workspace_id)
    references public.invoices (id, workspace_id) on delete cascade,
  constraint invoice_lines_account_fkey foreign key (account_id, workspace_id) references public.accounts (id, workspace_id),
  constraint invoice_lines_item_fkey foreign key (item_id, workspace_id) references public.items (id, workspace_id)
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

alter table public.workspace_profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
revoke all on public.workspace_profiles, public.contacts, public.invoices, public.invoice_lines from anon, authenticated;
grant select on public.workspace_profiles, public.contacts, public.invoices, public.invoice_lines to authenticated;
create policy workspace_profiles_select_own on public.workspace_profiles
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy contacts_select_own on public.contacts
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy invoices_select_own on public.invoices
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy invoice_lines_select_own on public.invoice_lines
  for select to authenticated using (app.owns_workspace(workspace_id));

-- 4. RPC profil.
create or replace function public.save_business_profile(p_workspace_id uuid, p_profile jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_workspace_id);
  insert into public.workspace_profiles as p (workspace_id, display_name, address, phone, email, npwp, bank_info,
    invoice_notes, invoice_prefix, logo_data_url)
  values (p_workspace_id, p_profile ->> 'displayName', p_profile ->> 'address', p_profile ->> 'phone', p_profile ->> 'email',
    p_profile ->> 'npwp', p_profile ->> 'bankInfo', p_profile ->> 'invoiceNotes', coalesce(p_profile ->> 'invoicePrefix', 'INV'),
    p_profile ->> 'logoDataUrl')
  on conflict (workspace_id) do update set
    display_name = excluded.display_name, address = excluded.address, phone = excluded.phone, email = excluded.email,
    npwp = excluded.npwp, bank_info = excluded.bank_info, invoice_notes = excluded.invoice_notes,
    invoice_prefix = excluded.invoice_prefix, logo_data_url = excluded.logo_data_url;
exception
  when check_violation then
    perform app.raise_error('INVALID_PROFILE', 'Prefix nomor faktur atau logo tidak valid');
end
$$;

-- 5. RPC kontak.
create or replace function app.contact_fields_valid(p_contact jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_contact -> 'paymentTermDays') = 'number'
     and (p_contact ->> 'paymentTermDays') ~ '^[0-9]{1,3}$'
     and jsonb_typeof(p_contact -> 'isCustomer') = 'boolean'
     and jsonb_typeof(p_contact -> 'isSupplier') = 'boolean';
$$;

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
  insert into public.contacts (workspace_id, name, is_customer, is_supplier, address, phone, email, npwp, payment_term_days, notes)
  values (p_workspace_id, btrim(p_contact ->> 'name'), (p_contact ->> 'isCustomer')::boolean, (p_contact ->> 'isSupplier')::boolean,
    p_contact ->> 'address', p_contact ->> 'phone', p_contact ->> 'email', p_contact ->> 'npwp',
    (p_contact ->> 'paymentTermDays')::integer, p_contact ->> 'notes')
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
    notes = p_contact ->> 'notes'
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
  update public.contacts set deleted_at = now() where id = p_id;
end
$$;

-- 6. RPC faktur: draft.
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
      apply_tax = coalesce((p_invoice ->> 'applyTax')::boolean, false)
    where id = v_id;
    delete from public.invoice_lines where invoice_id = v_id;
  else
    insert into public.invoices (workspace_id, kind, contact_id, invoice_date, due_date, reference, notes, apply_tax)
    values (v_ws, v_kind, v_contact, v_date, v_due, p_invoice ->> 'reference', p_invoice ->> 'notes',
      coalesce((p_invoice ->> 'applyTax')::boolean, false))
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

create or replace function public.delete_invoice_draft(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.invoices;
begin
  select * into v_old from public.invoices where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('INVOICE_NOT_FOUND', 'Faktur tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if v_old.status <> 'draft' then
    perform app.raise_error('INVALID_INVOICE', 'Hanya draft yang dapat dihapus; faktur terbit dibatalkan lewat void');
  end if;
  update public.invoices set deleted_at = now() where id = p_id;
end
$$;

-- 7. RPC terbit: nomor urut per tahun + jurnal + salinan kontak, atomik.
create or replace function public.issue_invoice(p_id uuid, p_journal jsonb, p_contact jsonb, p_prefix text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_year integer;
  v_seq integer;
  v_number text;
  v_journal uuid;
begin
  select * into v_inv from public.invoices where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('INVOICE_NOT_FOUND', 'Faktur tidak ditemukan');
  end if;
  perform app.require_owner(v_inv.workspace_id);
  perform 1 from public.workspaces where id = v_inv.workspace_id for update;
  if v_inv.status <> 'draft' then
    perform app.raise_error('INVALID_INVOICE', 'Faktur sudah terbit');
  end if;
  if v_inv.contact_id is null or not exists (select 1 from public.contacts c where c.id = v_inv.contact_id and c.deleted_at is null) then
    perform app.raise_error('CONTACT_NOT_FOUND', 'Pilih kontak faktur');
  end if;
  if p_prefix is null or p_prefix !~ '^[A-Z0-9-]{1,12}$' then
    perform app.raise_error('INVALID_PROFILE', 'Prefix nomor faktur tidak valid');
  end if;
  if app.to_uuid(p_journal ->> 'workspaceId') is distinct from v_inv.workspace_id
     or (p_journal ->> 'entryDate')::date is distinct from v_inv.invoice_date
     or p_journal ->> 'source' is distinct from (case v_inv.kind when 'sale' then 'revenue' else 'purchase' end) then
    perform app.raise_error('INVALID_INVOICE', 'Jurnal faktur harus bertanggal faktur dan bersumber sesuai jenis faktur');
  end if;
  v_year := extract(year from v_inv.invoice_date)::integer;
  select coalesce(max(number_seq), 0) + 1 into v_seq from public.invoices
  where workspace_id = v_inv.workspace_id and kind = v_inv.kind and number_year = v_year and number is not null;
  v_number := format('%s/%s/%s/%s', p_prefix, v_year, to_char(v_inv.invoice_date, 'MM'), lpad(v_seq::text, 4, '0'));
  v_journal := app.post_journal_core(
    jsonb_set(p_journal, '{description}', to_jsonb(replace(coalesce(p_journal ->> 'description', ''), '(nomor otomatis)', v_number))),
    null, 'public');
  update public.invoices set status = 'issued', number = v_number, number_year = v_year, number_seq = v_seq,
    journal_entry_id = v_journal, contact_snapshot = p_contact, issued_at = now()
  where id = p_id;
end
$$;

revoke all on function public.save_business_profile(uuid, jsonb), public.create_contact(uuid, jsonb),
  public.update_contact(uuid, jsonb), public.delete_contact(uuid), public.save_invoice_draft(jsonb, uuid),
  public.delete_invoice_draft(uuid), public.issue_invoice(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_business_profile(uuid, jsonb), public.create_contact(uuid, jsonb),
  public.update_contact(uuid, jsonb), public.delete_contact(uuid), public.save_invoice_draft(jsonb, uuid),
  public.delete_invoice_draft(uuid), public.issue_invoice(uuid, jsonb, jsonb, text) to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
