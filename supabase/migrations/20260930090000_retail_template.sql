-- Template Retail & modularitas persediaan/pajak (ADR 015, ROADMAP Fase 4A).

-- 1. Jenis template baru.
alter table public.workspaces drop constraint workspaces_template_type_check;
alter table public.workspaces add constraint workspaces_template_type_check
  check (template_type in ('fnb', 'retail'));

-- 2. Nama pajak penjualan per workspace (mekanisme sama, label berbeda).
alter table public.workspaces add column sales_tax_label text not null default 'PB1'
  check (sales_tax_label in ('PB1', 'PPN'));

-- 3. Peran akun persediaan menjadi umum: raw_material_inventory -> inventory.
--    Perubahan tercatat di audit log (pelaku kosong = sistem) beserta alasannya.
alter table public.accounts drop constraint accounts_system_role_check;
select set_config('app.audit_reason', 'Migrasi ADR 015: peran persediaan menjadi umum (inventory)', false);
update public.accounts set system_role = 'inventory' where system_role = 'raw_material_inventory';
select set_config('app.audit_reason', '', false);
alter table public.accounts add constraint accounts_system_role_check check (system_role in (
  'opening_balance_equity', 'retained_earnings', 'owner_capital', 'drawings',
  'inventory', 'cogs', 'accounts_receivable', 'accounts_payable',
  'sales_tax_payable', 'income_summary'));

-- 4. Audit: perubahan nama pajak juga termasuk update_tax_settings.
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
         or v_old ->> 'sales_tax_label' <> v_new ->> 'sales_tax_label') then
    v_action := 'update_tax_settings';
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

-- 5. RPC workspace dengan pengaturan pajak awal dari template.
drop function public.create_workspace(text, text, date, jsonb, jsonb);
create or replace function public.create_workspace(
  p_name text, p_template_type text, p_books_start_date date, p_accounts jsonb, p_periods jsonb,
  p_sales_tax jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    perform app.raise_error('NOT_AUTHENTICATED', 'Silakan login terlebih dahulu');
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    perform app.raise_error('EMPTY_NAME', 'Nama workspace wajib diisi');
  end if;
  insert into public.workspaces (owner_id, name, template_type, books_start_date,
                                 sales_tax_label, sales_tax_rate_bps, sales_tax_inclusive)
  values (auth.uid(), btrim(p_name), p_template_type, p_books_start_date,
          coalesce(p_sales_tax ->> 'label', 'PB1'),
          coalesce((p_sales_tax ->> 'rateBps')::integer, 1000),
          coalesce((p_sales_tax ->> 'inclusive')::boolean, false))
  returning id into v_id;

  insert into public.accounts (workspace_id, code, name, account_type, normal_balance,
                               cash_flow_category, is_cash, system_role)
  select v_id, a ->> 'code', a ->> 'name', a ->> 'accountType', a ->> 'normalBalance',
         a ->> 'cashFlowCategory', coalesce((a ->> 'isCash')::boolean, false), a ->> 'systemRole'
  from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) a;

  perform app.insert_periods(v_id, p_periods);
  return v_id;
end
$$;

drop function public.update_workspace_tax_settings(uuid, integer, boolean);
create or replace function public.update_workspace_tax_settings(
  p_id uuid, p_rate_bps integer, p_inclusive boolean, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_id);
  if p_rate_bps is null or p_rate_bps < 0 or p_rate_bps > 10000 then
    perform app.raise_error('INVALID_AMOUNT', 'Tarif pajak harus antara 0% dan 100%');
  end if;
  if p_label is null or p_label not in ('PB1', 'PPN') then
    perform app.raise_error('INVALID_TAX_LABEL', 'Jenis pajak penjualan harus PB1 atau PPN');
  end if;
  update public.workspaces
  set sales_tax_rate_bps = p_rate_bps, sales_tax_inclusive = coalesce(p_inclusive, false),
      sales_tax_label = p_label
  where id = p_id;
end
$$;

-- 6. Akun dari template (Pengaturan): peran sistem ganda ditolak dengan pesan yang tepat.
create or replace function public.create_account(p_workspace_id uuid, p_account jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_owner(p_workspace_id);
  if p_account ->> 'systemRole' is not null and exists (
    select 1 from public.accounts
    where workspace_id = p_workspace_id and deleted_at is null and system_role = p_account ->> 'systemRole'
  ) then
    perform app.raise_error('SYSTEM_ACCOUNT', 'Peran sistem akun ini sudah dipakai akun lain');
  end if;
  insert into public.accounts (workspace_id, code, name, account_type, normal_balance,
                               cash_flow_category, is_cash, system_role)
  values (p_workspace_id, btrim(p_account ->> 'code'), btrim(p_account ->> 'name'),
          p_account ->> 'accountType', p_account ->> 'normalBalance', p_account ->> 'cashFlowCategory',
          coalesce((p_account ->> 'isCash')::boolean, false), p_account ->> 'systemRole')
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_ACCOUNT_CODE', format('Kode akun %s sudah dipakai', p_account ->> 'code'));
  when check_violation or not_null_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Data akun tidak valid');
end
$$;

revoke all on function
  public.create_workspace(text, text, date, jsonb, jsonb, jsonb),
  public.update_workspace_tax_settings(uuid, integer, boolean, text)
from public, anon;

grant execute on function
  public.create_workspace(text, text, date, jsonb, jsonb, jsonb),
  public.update_workspace_tax_settings(uuid, integer, boolean, text)
to authenticated;
