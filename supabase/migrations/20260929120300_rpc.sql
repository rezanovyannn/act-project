-- Fungsi RPC: satu-satunya jalur penulisan data (ADR 008 & 013).
-- SECURITY DEFINER + search_path kosong + cek kepemilikan eksplisit di setiap fungsi.
-- Aturan akuntansi di sini adalah cermin src/core/ (lapisan pertahanan terakhir).

-- ================================================================ pembantu

-- Nominal dari JSON: integer >= 0 (ADR 005).
create or replace function app.amount(p_value jsonb, p_line integer)
returns bigint
language plpgsql
immutable
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return 0;
  end if;
  if jsonb_typeof(p_value) <> 'number' or p_value::text !~ '^[0-9]{1,18}$' then
    perform app.raise_error('INVALID_AMOUNT',
      format('Baris %s: nominal harus bilangan bulat Rupiah tidak negatif', p_line));
  end if;
  return p_value::text::bigint;
end
$$;

create or replace function app.to_uuid(p_value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return nullif(btrim(coalesce(p_value, '')), '')::uuid;
exception when invalid_text_representation then
  return '00000000-0000-0000-0000-000000000000'::uuid;
end
$$;

-- Baris jurnal dari JSON input: validasi nominal (dipakai draft & posting).
create or replace function app.check_line_amounts(p_lines jsonb)
returns void
language plpgsql
as $$
declare
  v_line jsonb;
  v_i integer := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' then
    perform app.raise_error('TOO_FEW_LINES', 'Baris jurnal tidak valid');
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    if app.amount(v_line -> 'debit', v_i) > 0 and app.amount(v_line -> 'credit', v_i) > 0 then
      perform app.raise_error('LINE_BOTH_SIDES',
        format('Baris %s: isi debit ATAU kredit, tidak keduanya', v_i));
    end if;
  end loop;
end
$$;

create or replace function app.insert_lines(p_entry_id uuid, p_workspace_id uuid, p_lines jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.journal_lines (journal_entry_id, workspace_id, account_id, line_no, description, debit, credit)
  select p_entry_id, p_workspace_id, app.to_uuid(l.value ->> 'accountId'), l.ordinality::integer,
         nullif(btrim(coalesce(l.value ->> 'description', '')), ''),
         app.amount(l.value -> 'debit', l.ordinality::integer),
         app.amount(l.value -> 'credit', l.ordinality::integer)
  from jsonb_array_elements(p_lines) with ordinality as l(value, ordinality);
exception when foreign_key_violation then
  perform app.raise_error('ACCOUNT_NOT_FOUND', 'Akun tidak ditemukan di workspace ini');
end
$$;

-- Jurnal pembalik aktif atas p_entry_id, bila ada.
create or replace function app.active_reversal(p_entry_id uuid)
returns public.journal_entries
language sql
stable
as $$
  select * from public.journal_entries
  where reversal_of = p_entry_id and status = 'posted' and deleted_at is null
  limit 1;
$$;

-- Pengaruh baris terhadap tagihan: + menambah, − mengurangi (ADR 012).
create or replace function app.claim_effect(p_account_id uuid, p_debit bigint, p_credit bigint)
returns bigint
language sql
stable
as $$
  select case a.system_role
    when 'accounts_receivable' then p_debit - p_credit
    when 'accounts_payable' then p_credit - p_debit
    else 0 end
  from public.accounts a where a.id = p_account_id;
$$;

-- Pelunasan aktif (posted & belum di-void) atas transaksi kredit.
create or replace function app.active_settlement_ids(p_target_id uuid)
returns setof uuid
language sql
stable
as $$
  select s.id from public.journal_entries s
  where s.settlement_of = p_target_id and s.status = 'posted' and s.deleted_at is null
    and app.active_reversal(s.id) is null;
$$;

create or replace function app.validate_settlement(
  p_workspace_id uuid, p_source text, p_target_id uuid, p_lines jsonb)
returns void
language plpgsql
as $$
declare
  v_target public.journal_entries;
  v_claim bigint;
  v_settled bigint;
  v_payment bigint;
begin
  if p_source <> 'settlement' then
    perform app.raise_error('INVALID_SETTLEMENT', 'Jurnal pelunasan harus bersumber ''settlement''');
  end if;
  select * into v_target from public.journal_entries where id = p_target_id for update;
  if not found or v_target.workspace_id <> p_workspace_id or v_target.deleted_at is not null
     or v_target.status <> 'posted' then
    perform app.raise_error('INVALID_SETTLEMENT', 'Transaksi yang dilunasi tidak ditemukan');
  end if;
  if app.active_reversal(v_target.id) is not null then
    perform app.raise_error('INVALID_SETTLEMENT', 'Transaksi yang dilunasi sudah di-void');
  end if;

  select coalesce(sum(app.claim_effect(l.account_id, l.debit, l.credit)), 0) into v_claim
  from public.journal_lines l where l.journal_entry_id = v_target.id;
  if v_claim <= 0 then
    perform app.raise_error('INVALID_SETTLEMENT',
      'Transaksi yang dilunasi bukan transaksi kredit (tidak ada piutang/utang usaha)');
  end if;

  select coalesce(sum(-app.claim_effect(l.account_id, l.debit, l.credit)), 0) into v_settled
  from public.journal_lines l
  where l.journal_entry_id in (select app.active_settlement_ids(v_target.id));

  -- Pembayaran = pengurangan tagihan pada akun piutang/utang milik transaksi asal.
  select coalesce(sum(-app.claim_effect(app.to_uuid(l.value ->> 'accountId'),
                                        app.amount(l.value -> 'debit', 0),
                                        app.amount(l.value -> 'credit', 0))), 0)
  into v_payment
  from jsonb_array_elements(p_lines) l
  where app.to_uuid(l.value ->> 'accountId') in (
    select t.account_id from public.journal_lines t
    where t.journal_entry_id = v_target.id and app.claim_effect(t.account_id, t.debit, t.credit) <> 0
  );

  if v_payment <= 0 then
    perform app.raise_error('INVALID_SETTLEMENT',
      'Jurnal pelunasan harus mengurangi piutang/utang usaha transaksi asal');
  end if;
  if v_payment > v_claim - v_settled then
    perform app.raise_error('INVALID_SETTLEMENT',
      format('Pelunasan %s melebihi sisa tagihan %s', app.rupiah(v_payment), app.rupiah(v_claim - v_settled)));
  end if;
end
$$;

create or replace function app.insert_periods(p_workspace_id uuid, p_ranges jsonb)
returns uuid[]
language plpgsql
as $$
declare
  v_range jsonb;
  v_start date;
  v_end date;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  for v_range in select value from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) loop
    begin
      v_start := (v_range ->> 'startDate')::date;
      v_end := (v_range ->> 'endDate')::date;
    exception when others then
      perform app.raise_error('INVALID_DATE', 'Tanggal periode tidak valid');
    end;
    if v_start is null or v_end is null or v_start > v_end then
      perform app.raise_error('INVALID_DATE', 'Tanggal awal periode setelah tanggal akhir');
    end if;
    if exists (
      select 1 from public.periods p
      where p.workspace_id = p_workspace_id and p.start_date <= v_end and v_start <= p.end_date
    ) then
      perform app.raise_error('INVALID_DATE', format('Periode %s s.d. %s tumpang tindih', v_start, v_end));
    end if;
    insert into public.periods (workspace_id, start_date, end_date, status)
    values (p_workspace_id, v_start, v_end, 'open')
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end
$$;

-- ============================================================== workspace

create or replace function public.create_workspace(
  p_name text, p_template_type text, p_books_start_date date, p_accounts jsonb, p_periods jsonb)
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
  insert into public.workspaces (owner_id, name, template_type, books_start_date)
  values (auth.uid(), btrim(p_name), p_template_type, p_books_start_date)
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

create or replace function public.rename_workspace(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_id);
  if btrim(coalesce(p_name, '')) = '' then
    perform app.raise_error('EMPTY_NAME', 'Nama workspace wajib diisi');
  end if;
  update public.workspaces set name = btrim(p_name) where id = p_id;
end
$$;

create or replace function public.update_workspace_tax_settings(p_id uuid, p_rate_bps integer, p_inclusive boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_id);
  if p_rate_bps is null or p_rate_bps < 0 or p_rate_bps > 10000 then
    perform app.raise_error('INVALID_AMOUNT', 'Tarif PB1 harus antara 0% dan 100%');
  end if;
  update public.workspaces
  set sales_tax_rate_bps = p_rate_bps, sales_tax_inclusive = coalesce(p_inclusive, false)
  where id = p_id;
end
$$;

create or replace function public.delete_workspace(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_id);
  update public.workspaces set deleted_at = now() where id = p_id;
end
$$;

-- ================================================================ akun

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

create or replace function app.account_in_use(p_account_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.journal_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
    where l.account_id = p_account_id and e.deleted_at is null
  );
$$;

-- Aturan ADR 009: akun ber-jurnal/akun sistem tidak boleh diubah jenis,
-- saldo normal, atau status kas; akun sistem tidak boleh dinonaktifkan.
create or replace function public.update_account(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.accounts;
  v_type text;
  v_normal text;
  v_is_cash boolean;
  v_active boolean;
begin
  select * into v_old from public.accounts where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Akun tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);

  v_type := coalesce(p_patch ->> 'accountType', v_old.account_type);
  v_normal := coalesce(p_patch ->> 'normalBalance', v_old.normal_balance);
  v_is_cash := coalesce((p_patch ->> 'isCash')::boolean, v_old.is_cash);
  v_active := coalesce((p_patch ->> 'isActive')::boolean, v_old.is_active);

  if v_type <> v_old.account_type or v_normal <> v_old.normal_balance or v_is_cash <> v_old.is_cash then
    if v_old.system_role is not null then
      perform app.raise_error('SYSTEM_ACCOUNT', 'Jenis, saldo normal, dan status kas akun sistem tidak dapat diubah');
    end if;
    if app.account_in_use(p_id) then
      perform app.raise_error('ACCOUNT_IN_USE',
        'Akun sudah dipakai jurnal: jenis, saldo normal, dan status kas tidak dapat diubah');
    end if;
  end if;
  if not v_active and v_old.system_role is not null then
    perform app.raise_error('SYSTEM_ACCOUNT', format('%s adalah akun sistem dan tidak dapat dinonaktifkan', v_old.name));
  end if;

  update public.accounts set
    code = coalesce(btrim(p_patch ->> 'code'), code),
    name = coalesce(btrim(p_patch ->> 'name'), name),
    account_type = v_type,
    normal_balance = v_normal,
    cash_flow_category = coalesce(p_patch ->> 'cashFlowCategory', cash_flow_category),
    is_cash = v_is_cash,
    is_active = v_active
  where id = p_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_ACCOUNT_CODE', format('Kode akun %s sudah dipakai', p_patch ->> 'code'));
  when check_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun kas/bank harus berjenis aset dengan kategori arus kas none');
end
$$;

create or replace function public.delete_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.accounts;
begin
  select * into v_old from public.accounts where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Akun tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if v_old.system_role is not null then
    perform app.raise_error('SYSTEM_ACCOUNT', format('%s adalah akun sistem dan tidak dapat dihapus', v_old.name));
  end if;
  if app.account_in_use(p_id) then
    perform app.raise_error('ACCOUNT_INACTIVE', 'Akun sudah dipakai jurnal; nonaktifkan saja, tidak bisa dihapus');
  end if;
  update public.accounts set deleted_at = now() where id = p_id;
end
$$;

-- ============================================================== periode

create or replace function public.create_periods(p_workspace_id uuid, p_ranges jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_owner(p_workspace_id);
  return app.insert_periods(p_workspace_id, p_ranges);
end
$$;

-- Membuka kembali periode wajib alasan; alasan tercatat di audit log (ADR 006).
create or replace function public.set_period_status(p_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.periods;
begin
  select * into v_old from public.periods where id = p_id for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Periode tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if p_status not in ('open', 'closed') then
    perform app.raise_error('INVALID_DATE', 'Status periode tidak valid');
  end if;
  if v_old.status = 'closed' and p_status = 'open' and length(btrim(coalesce(p_reason, ''))) < 5 then
    perform app.raise_error('EMPTY_REASON', 'Alasan membuka kembali periode wajib diisi (minimal 5 karakter)');
  end if;
  perform set_config('app.audit_reason', coalesce(btrim(p_reason), ''), true);
  update public.periods set status = p_status where id = p_id;
  perform set_config('app.audit_reason', '', true);
end
$$;

-- =============================================================== jurnal

create or replace function public.save_journal_draft(p_input jsonb, p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_input ->> 'workspaceId');
  v_lines jsonb := coalesce(p_input -> 'lines', '[]'::jsonb);
  v_date date;
  v_draft public.journal_entries;
  v_id uuid;
begin
  perform app.require_owner(v_ws);
  perform app.check_line_amounts(v_lines);
  begin
    v_date := (p_input ->> 'entryDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal tidak valid (format YYYY-MM-DD)');
  end;
  if v_date is null then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal wajib diisi');
  end if;

  if p_draft_id is not null then
    select * into v_draft from public.journal_entries where id = p_draft_id for update;
    if not found or v_draft.workspace_id <> v_ws or v_draft.deleted_at is not null then
      perform app.raise_error('NOT_FOUND', 'Jurnal tidak ditemukan');
    end if;
    if v_draft.status <> 'draft' then
      perform app.raise_error('NOT_DRAFT', 'Jurnal posted bersifat immutable');
    end if;
    delete from public.journal_lines where journal_entry_id = p_draft_id;
    update public.journal_entries set
      entry_date = v_date,
      description = btrim(coalesce(p_input ->> 'description', '')),
      source = p_input ->> 'source',
      counterparty = nullif(btrim(coalesce(p_input ->> 'counterparty', '')), ''),
      settlement_of = app.to_uuid(p_input ->> 'settlementOf'),
      correction_of = app.to_uuid(p_input ->> 'correctionOf')
    where id = p_draft_id;
    v_id := p_draft_id;
  else
    insert into public.journal_entries (workspace_id, entry_date, description, status, source,
                                        counterparty, settlement_of, correction_of)
    values (v_ws, v_date, btrim(coalesce(p_input ->> 'description', '')), 'draft', p_input ->> 'source',
            nullif(btrim(coalesce(p_input ->> 'counterparty', '')), ''),
            app.to_uuid(p_input ->> 'settlementOf'), app.to_uuid(p_input ->> 'correctionOf'))
    returning id into v_id;
  end if;

  perform app.insert_lines(v_id, v_ws, v_lines);
  return v_id;
end
$$;

create or replace function public.delete_journal_draft(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.journal_entries;
begin
  select * into v_entry from public.journal_entries where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Jurnal tidak ditemukan');
  end if;
  perform app.require_owner(v_entry.workspace_id);
  if v_entry.status <> 'draft' then
    perform app.raise_error('NOT_DRAFT', 'Jurnal posted bersifat immutable');
  end if;
  update public.journal_entries set deleted_at = now() where id = p_id;
end
$$;

-- Posting atomik (ADR 008): validasi lengkap, penomoran JU-<tahun>-<urut>, simpan.
create or replace function public.post_journal(p_input jsonb, p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_input ->> 'workspaceId');
  v_lines jsonb := coalesce(p_input -> 'lines', '[]'::jsonb);
  v_source text := p_input ->> 'source';
  v_description text := btrim(coalesce(p_input ->> 'description', ''));
  v_counterparty text := nullif(btrim(coalesce(p_input ->> 'counterparty', '')), '');
  v_reversal_of uuid := app.to_uuid(p_input ->> 'reversalOf');
  v_settlement_of uuid := app.to_uuid(p_input ->> 'settlementOf');
  v_correction_of uuid := app.to_uuid(p_input ->> 'correctionOf');
  v_date date;
  v_line jsonb;
  v_i integer := 0;
  v_debit bigint;
  v_credit bigint;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_account public.accounts;
  v_period public.periods;
  v_original public.journal_entries;
  v_existing public.journal_entries;
  v_draft public.journal_entries;
  v_seq integer;
  v_number text;
  v_id uuid;
begin
  perform app.require_owner(v_ws);
  -- Serialisasi per workspace: penomoran & aturan "hanya satu" aman dari balapan.
  perform 1 from public.workspaces where id = v_ws for update;

  begin
    v_date := (p_input ->> 'entryDate')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal tidak valid (format YYYY-MM-DD)');
  end;
  if v_date is null then
    perform app.raise_error('INVALID_DATE', 'Tanggal jurnal wajib diisi');
  end if;
  if v_description = '' then
    perform app.raise_error('EMPTY_DESCRIPTION', 'Keterangan jurnal wajib diisi');
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) < 2 then
    perform app.raise_error('TOO_FEW_LINES', 'Jurnal minimal terdiri dari 2 baris');
  end if;

  -- Double-entry: tiap baris tepat satu sisi > 0; akun ada, satu workspace, aktif.
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_i := v_i + 1;
    v_debit := app.amount(v_line -> 'debit', v_i);
    v_credit := app.amount(v_line -> 'credit', v_i);
    if v_debit > 0 and v_credit > 0 then
      perform app.raise_error('LINE_BOTH_SIDES', format('Baris %s: isi debit ATAU kredit, tidak keduanya', v_i));
    end if;
    if v_debit = 0 and v_credit = 0 then
      perform app.raise_error('LINE_ZERO', format('Baris %s: nominal debit atau kredit harus lebih dari 0', v_i));
    end if;
    select * into v_account from public.accounts where id = app.to_uuid(v_line ->> 'accountId');
    if not found or v_account.deleted_at is not null then
      perform app.raise_error('ACCOUNT_NOT_FOUND', format('Baris %s: akun tidak ditemukan', v_i));
    end if;
    if v_account.workspace_id <> v_ws then
      perform app.raise_error('ACCOUNT_OTHER_WORKSPACE', format('Baris %s: akun bukan milik workspace ini', v_i));
    end if;
    if not v_account.is_active and v_source <> 'reversal' then
      perform app.raise_error('ACCOUNT_INACTIVE',
        format('Baris %s: akun %s %s sudah nonaktif', v_i, v_account.code, v_account.name));
    end if;
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;
  if v_total_debit <> v_total_credit then
    perform app.raise_error('UNBALANCED', format('Total debit (%s) tidak sama dengan total kredit (%s)',
      app.rupiah(v_total_debit), app.rupiah(v_total_credit)));
  end if;

  -- Periode terbuka (ADR 006).
  select * into v_period from public.periods
  where workspace_id = v_ws and v_date between start_date and end_date;
  if not found then
    perform app.raise_error('PERIOD_NOT_FOUND', format('Belum ada periode akuntansi untuk tanggal %s', v_date));
  end if;
  if v_period.status <> 'open' then
    perform app.raise_error('PERIOD_CLOSED',
      format('Periode %s s.d. %s sudah dikunci', v_period.start_date, v_period.end_date));
  end if;

  -- Void/koreksi (ADR 009).
  if v_source = 'reversal' and v_reversal_of is null then
    perform app.raise_error('INVALID_REVERSAL', 'Jurnal pembalik harus merujuk jurnal asal');
  end if;
  if v_reversal_of is not null then
    if v_source <> 'reversal' then
      perform app.raise_error('INVALID_REVERSAL', 'Tautan jurnal pembalik hanya untuk sumber reversal');
    end if;
    select * into v_original from public.journal_entries where id = v_reversal_of for update;
    if not found or v_original.workspace_id <> v_ws or v_original.deleted_at is not null then
      perform app.raise_error('NOT_FOUND', 'Jurnal asal tidak ditemukan');
    end if;
    if v_original.status <> 'posted' then
      perform app.raise_error('NOT_POSTED', 'Hanya jurnal posted yang dapat di-void atau dikoreksi');
    end if;
    if v_original.source = 'reversal' then
      perform app.raise_error('INVALID_REVERSAL', 'Jurnal pembalik tidak dapat di-void atau dikoreksi; buat jurnal baru');
    end if;
    v_existing := app.active_reversal(v_original.id);
    if v_existing.id is not null then
      perform app.raise_error('ALREADY_REVERSED', format('Jurnal ini sudah dibalik oleh %s', v_existing.entry_number));
    end if;
    if exists (select app.active_settlement_ids(v_original.id)) then
      perform app.raise_error('HAS_SETTLEMENTS',
        'Transaksi ini sudah memiliki pelunasan; void pelunasannya lebih dulu');
    end if;
    if v_date < v_original.entry_date then
      perform app.raise_error('INVALID_REVERSAL', 'Tanggal jurnal pembalik tidak boleh sebelum tanggal jurnal asal');
    end if;
  end if;

  -- Pelunasan (ADR 012).
  if v_source = 'settlement' or v_settlement_of is not null then
    perform app.validate_settlement(v_ws, v_source, v_settlement_of, v_lines);
  end if;

  -- Hanya satu saldo awal aktif.
  if v_source = 'opening_balance' and exists (
    select 1 from public.journal_entries e
    where e.workspace_id = v_ws and e.source = 'opening_balance' and e.status = 'posted'
      and e.deleted_at is null and app.active_reversal(e.id) is null
  ) then
    perform app.raise_error('DUPLICATE_OPENING_BALANCE', 'Saldo awal sudah diposting untuk workspace ini');
  end if;

  if p_draft_id is not null then
    select * into v_draft from public.journal_entries where id = p_draft_id for update;
    if not found or v_draft.workspace_id <> v_ws or v_draft.deleted_at is not null then
      perform app.raise_error('NOT_FOUND', 'Jurnal tidak ditemukan');
    end if;
    if v_draft.status <> 'draft' then
      perform app.raise_error('NOT_DRAFT', 'Jurnal posted bersifat immutable');
    end if;
  end if;

  -- Nomor urut per workspace per tahun buku.
  select coalesce(max(split_part(entry_number, '-', 3)::integer), 0) + 1 into v_seq
  from public.journal_entries
  where workspace_id = v_ws and entry_number like 'JU-' || extract(year from v_date)::integer || '-%';
  v_number := 'JU-' || extract(year from v_date)::integer || '-' || lpad(v_seq::text, 4, '0');

  perform set_config('app.posting', 'on', true);
  if p_draft_id is null then
    insert into public.journal_entries (workspace_id, entry_number, entry_date, description, status, source,
                                        counterparty, settlement_of, reversal_of, correction_of, posted_at)
    values (v_ws, v_number, v_date, v_description, 'posted', v_source,
            v_counterparty, v_settlement_of, v_reversal_of, v_correction_of, now())
    returning id into v_id;
  else
    delete from public.journal_lines where journal_entry_id = p_draft_id;
    update public.journal_entries set
      entry_number = v_number, entry_date = v_date, description = v_description, status = 'posted',
      source = v_source, counterparty = v_counterparty, settlement_of = v_settlement_of,
      reversal_of = v_reversal_of, correction_of = v_correction_of, posted_at = now()
    where id = p_draft_id;
    v_id := p_draft_id;
  end if;
  perform app.insert_lines(v_id, v_ws, v_lines);
  perform set_config('app.posting', '', true);
  return v_id;
end
$$;

-- ================================================================== hak akses

revoke all on function
  public.create_workspace(text, text, date, jsonb, jsonb),
  public.rename_workspace(uuid, text),
  public.update_workspace_tax_settings(uuid, integer, boolean),
  public.delete_workspace(uuid),
  public.create_account(uuid, jsonb),
  public.update_account(uuid, jsonb),
  public.delete_account(uuid),
  public.create_periods(uuid, jsonb),
  public.set_period_status(uuid, text, text),
  public.save_journal_draft(jsonb, uuid),
  public.delete_journal_draft(uuid),
  public.post_journal(jsonb, uuid)
from public, anon;

grant execute on function
  public.create_workspace(text, text, date, jsonb, jsonb),
  public.rename_workspace(uuid, text),
  public.update_workspace_tax_settings(uuid, integer, boolean),
  public.delete_workspace(uuid),
  public.create_account(uuid, jsonb),
  public.update_account(uuid, jsonb),
  public.delete_account(uuid),
  public.create_periods(uuid, jsonb),
  public.set_period_status(uuid, text, text),
  public.save_journal_draft(jsonb, uuid),
  public.delete_journal_draft(uuid),
  public.post_journal(jsonb, uuid)
to authenticated;

-- Fungsi pembantu di skema app tidak dapat dipanggil langsung oleh klien.
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
