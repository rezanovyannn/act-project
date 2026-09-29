-- Fungsi pembantu, trigger integritas, dan audit log otomatis (ADR 009, 011, 013).

-- ------------------------------------------------------------------ helpers

-- Error domain: SQLSTATE P0001, message = kode ValidationCode, detail = pesan Indonesia.
-- Repository Supabase memetakan ini ke AccountingError.
create or replace function app.raise_error(p_code text, p_message text)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_message;
end
$$;

create or replace function app.owns_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_id = auth.uid() and w.deleted_at is null
  );
$$;

create or replace function app.require_owner(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.raise_error('NOT_AUTHENTICATED', 'Silakan login terlebih dahulu');
  end if;
  if p_workspace_id is null or not app.owns_workspace(p_workspace_id) then
    perform app.raise_error('NOT_FOUND', 'Workspace tidak ditemukan');
  end if;
end
$$;

-- Format Rp 1.234.567 untuk pesan error.
create or replace function app.rupiah(p_value numeric)
returns text
language sql
immutable
as $$
  select 'Rp ' || replace(to_char(p_value, 'FM999,999,999,999,999,990'), ',', '.');
$$;

-- --------------------------------------------------------------- updated_at
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger workspaces_touch before update on public.workspaces
  for each row execute function app.touch_updated_at();
create trigger accounts_touch before update on public.accounts
  for each row execute function app.touch_updated_at();
create trigger periods_touch before update on public.periods
  for each row execute function app.touch_updated_at();
create trigger journal_entries_touch before update on public.journal_entries
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------- guards

-- template_type dan pemilik workspace tidak dapat diubah (ADR 002).
create or replace function app.workspace_guard()
returns trigger
language plpgsql
as $$
begin
  if new.template_type <> old.template_type then
    perform app.raise_error('INVALID_TEMPLATE', 'Jenis template workspace tidak dapat diubah');
  end if;
  if new.owner_id <> old.owner_id then
    perform app.raise_error('NOT_FOUND', 'Pemilik workspace tidak dapat diubah');
  end if;
  return new;
end
$$;
create trigger workspaces_guard before update on public.workspaces
  for each row execute function app.workspace_guard();

-- Jurnal posted immutable: tidak boleh diubah maupun dihapus (ADR 009).
create or replace function app.journal_entry_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'posted' then
    perform app.raise_error('NOT_DRAFT', 'Jurnal posted bersifat immutable; gunakan Void atau Koreksi');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger journal_entries_guard before update or delete on public.journal_entries
  for each row execute function app.journal_entry_guard();

-- Baris jurnal posted tidak boleh ditambah/diubah/dihapus, kecuali saat
-- post_journal menyisipkan baris (penanda transaksi app.posting).
create or replace function app.journal_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select e.status into v_status
  from public.journal_entries e
  where e.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if v_status = 'posted'
     and not (tg_op = 'INSERT' and coalesce(current_setting('app.posting', true), '') = 'on') then
    perform app.raise_error('NOT_DRAFT', 'Baris jurnal posted bersifat immutable');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger journal_lines_guard before insert or update or delete on public.journal_lines
  for each row execute function app.journal_line_guard();

-- ---------------------------------------------------------------- audit log

-- Mencatat setiap mutasi dengan nama aksi yang sama seperti mock repository.
-- Alasan (mis. membuka kembali periode) diambil dari app.audit_reason.
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
         or v_old ->> 'sales_tax_inclusive' <> v_new ->> 'sales_tax_inclusive') then
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

create trigger workspaces_audit after insert or update or delete on public.workspaces
  for each row execute function app.audit_row('workspace');
create trigger accounts_audit after insert or update or delete on public.accounts
  for each row execute function app.audit_row('account');
create trigger periods_audit after insert or update or delete on public.periods
  for each row execute function app.audit_row('period');
create trigger journal_entries_audit after insert or update or delete on public.journal_entries
  for each row execute function app.audit_row('journal');
