-- Mode PPN lengkap: PPN Keluaran & Masukan, DPP pecahan (ADR 016, ROADMAP Fase 4B).

-- 1. Pengaturan pajak per workspace.
alter table public.workspaces
  add column sales_tax_mode text not null default 'simple'
    check (sales_tax_mode in ('simple', 'full_vat')),
  add column vat_dpp_numerator integer not null default 1,
  add column vat_dpp_denominator integer not null default 1,
  add constraint workspaces_vat_dpp_check
    check (vat_dpp_numerator >= 1 and vat_dpp_numerator <= vat_dpp_denominator and vat_dpp_denominator <= 1000),
  add constraint workspaces_full_vat_label_check
    check (sales_tax_mode = 'simple' or sales_tax_label = 'PPN');

-- 2. Akun sistem PPN Masukan & beban PPN Masukan tidak dapat dikreditkan.
alter table public.accounts drop constraint accounts_system_role_check;
alter table public.accounts add constraint accounts_system_role_check check (system_role in (
  'opening_balance_equity', 'retained_earnings', 'owner_capital', 'drawings',
  'inventory', 'cogs', 'accounts_receivable', 'accounts_payable',
  'sales_tax_payable', 'income_summary', 'input_vat', 'non_creditable_vat'));

-- 3. Audit: perubahan mode & DPP termasuk update_tax_settings.
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

-- 4. Workspace baru membawa mode & DPP dari template.
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
                                 sales_tax_label, sales_tax_rate_bps, sales_tax_inclusive,
                                 sales_tax_mode, vat_dpp_numerator, vat_dpp_denominator)
  values (auth.uid(), btrim(p_name), p_template_type, p_books_start_date,
          coalesce(p_sales_tax ->> 'label', 'PB1'),
          coalesce((p_sales_tax ->> 'rateBps')::integer, 1000),
          coalesce((p_sales_tax ->> 'inclusive')::boolean, false),
          coalesce(p_sales_tax ->> 'mode', 'simple'),
          coalesce((p_sales_tax ->> 'dppNumerator')::integer, 1),
          coalesce((p_sales_tax ->> 'dppDenominator')::integer, 1))
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

-- 5. Pengaturan pajak sebagai satu objek (mode, label, tarif, harga termasuk pajak, DPP).
drop function public.update_workspace_tax_settings(uuid, integer, boolean, text);
create or replace function public.update_workspace_tax_settings(p_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := p_settings ->> 'mode';
  v_label text := p_settings ->> 'label';
  v_rate integer := (p_settings ->> 'rateBps')::integer;
  v_num integer := (p_settings ->> 'dppNumerator')::integer;
  v_den integer := (p_settings ->> 'dppDenominator')::integer;
begin
  perform app.require_owner(p_id);
  if v_rate is null or v_rate < 0 or v_rate > 10000 then
    perform app.raise_error('INVALID_AMOUNT', 'Tarif pajak harus antara 0% dan 100%');
  end if;
  if v_label is null or v_label not in ('PB1', 'PPN') then
    perform app.raise_error('INVALID_TAX_LABEL', 'Jenis pajak penjualan harus PB1 atau PPN');
  end if;
  if v_mode is null or v_mode not in ('simple', 'full_vat') then
    perform app.raise_error('INVALID_TAX_LABEL', 'Mode pajak tidak dikenal');
  end if;
  if v_mode = 'full_vat' and v_label <> 'PPN' then
    perform app.raise_error('INVALID_TAX_LABEL', 'Mode PPN lengkap hanya untuk pajak berlabel PPN');
  end if;
  if v_num is null or v_den is null or v_num < 1 or v_num > v_den or v_den > 1000 then
    perform app.raise_error('INVALID_AMOUNT', 'DPP harus pecahan bulat 1–1000 dengan pembilang ≤ penyebut (mis. 11/12)');
  end if;
  update public.workspaces
  set sales_tax_mode = v_mode, sales_tax_label = v_label, sales_tax_rate_bps = v_rate,
      sales_tax_inclusive = coalesce((p_settings ->> 'inclusive')::boolean, false),
      vat_dpp_numerator = v_num, vat_dpp_denominator = v_den
  where id = p_id;
end
$$;

revoke all on function public.update_workspace_tax_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_workspace_tax_settings(uuid, jsonb) to authenticated;
