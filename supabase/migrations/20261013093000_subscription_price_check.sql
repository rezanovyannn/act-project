-- Simpan langganan: harga per porsi 0 ditolak sebagai INVALID_AMOUNT (bukan pesan tanggal) (ADR 024, Fase 10D).

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
  if (s ->> 'pricePerPortion')::bigint <= 0 then
    perform app.raise_error('INVALID_AMOUNT', 'Harga per porsi harus lebih dari 0');
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

revoke all on function public.save_subscription(uuid, jsonb, uuid) from public, anon;
grant execute on function public.save_subscription(uuid, jsonb, uuid) to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
