-- Tutup buku akhir tahun (ADR 014).

-- Akun sistem baru: Ikhtisar Laba Rugi.
alter table public.accounts drop constraint accounts_system_role_check;
alter table public.accounts add constraint accounts_system_role_check check (system_role in (
  'opening_balance_equity', 'retained_earnings', 'owner_capital', 'drawings',
  'raw_material_inventory', 'cogs', 'accounts_receivable', 'accounts_payable',
  'sales_tax_payable', 'income_summary'));

-- Inti posting (salinan persis post_journal sebelumnya + mode tutup buku).
-- p_mode: 'public' | 'closing' | 'closing_reversal'.
create or replace function app.post_journal_core(p_input jsonb, p_draft_id uuid, p_mode text)
returns uuid
language plpgsql
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
  -- Jurnal penutup hanya lewat close_fiscal_year; pembaliknya hanya lewat cancel (ADR 014).
  if p_mode = 'public' and v_source = 'closing' then
    perform app.raise_error('INVALID_CLOSING', 'Jurnal penutup dibuat lewat fitur Tutup Buku');
  end if;
  if p_mode = 'closing' and v_source <> 'closing' then
    perform app.raise_error('INVALID_CLOSING', 'Hanya jurnal penutup yang dapat diposting lewat tutup buku');
  end if;
  if p_mode = 'closing_reversal' and v_source <> 'reversal' then
    perform app.raise_error('INVALID_CLOSING', 'Pembatalan tutup buku harus berupa jurnal pembalik');
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
    if v_original.source = 'closing' and p_mode <> 'closing_reversal' then
      perform app.raise_error('INVALID_CLOSING', 'Jurnal penutup hanya dapat dibatalkan lewat fitur Batalkan tutup buku');
    end if;
    if p_mode = 'closing_reversal' and v_original.source <> 'closing' then
      perform app.raise_error('INVALID_CLOSING', 'Pembatalan tutup buku hanya membalik jurnal penutup');
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

create or replace function public.post_journal(p_input jsonb, p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.post_journal_core(p_input, p_draft_id, 'public');
end
$$;

-- Jurnal penutup aktif (belum dibatalkan) untuk tahun buku.
create or replace function app.active_closing_ids(p_workspace_id uuid, p_year integer)
returns setof uuid
language sql
stable
as $$
  select e.id from public.journal_entries e
  where e.workspace_id = p_workspace_id and e.source = 'closing' and e.status = 'posted'
    and e.deleted_at is null and e.entry_date = make_date(p_year, 12, 31)
    and app.active_reversal(e.id) is null
  order by e.created_at, e.id;
$$;

-- Posting jurnal penutup + validasi hasil + kunci periode, atomik.
create or replace function public.close_fiscal_year(p_workspace_id uuid, p_year integer, p_entries jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_ids uuid[] := '{}';
  v_account record;
  v_summary_balance bigint;
begin
  perform app.require_owner(p_workspace_id);
  perform 1 from public.workspaces where id = p_workspace_id for update;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    perform app.raise_error('INVALID_CLOSING', 'Tidak ada mutasi yang perlu ditutup');
  end if;
  if exists (select app.active_closing_ids(p_workspace_id, p_year)) then
    perform app.raise_error('DUPLICATE_CLOSING', format('Tahun buku %s sudah ditutup', p_year));
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if app.to_uuid(v_entry ->> 'workspaceId') <> p_workspace_id
       or v_entry ->> 'source' <> 'closing'
       or v_entry ->> 'entryDate' <> to_char(make_date(p_year, 12, 31), 'YYYY-MM-DD') then
      perform app.raise_error('INVALID_CLOSING',
        'Jurnal penutup harus bersumber closing dan bertanggal 31 Desember tahun buku');
    end if;
    v_ids := v_ids || app.post_journal_core(v_entry, null, 'closing');
  end loop;

  -- Hasil wajib lengkap: mutasi tahun itu pada akun nominal & Prive = 0.
  for v_account in
    select a.code, a.name, coalesce(sum(l.debit - l.credit), 0) as movement
    from public.accounts a
    join public.journal_lines l on l.account_id = a.id
    join public.journal_entries e on e.id = l.journal_entry_id
    where a.workspace_id = p_workspace_id
      and (a.account_type in ('revenue', 'cogs', 'expense') or a.system_role = 'drawings')
      and e.status = 'posted' and e.deleted_at is null
      and e.entry_date between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
    group by a.id, a.code, a.name
    having coalesce(sum(l.debit - l.credit), 0) <> 0
  loop
    perform app.raise_error('INVALID_CLOSING',
      format('Akun %s %s belum bersaldo nol setelah tutup buku %s', v_account.code, v_account.name, p_year));
  end loop;

  select coalesce(sum(l.debit - l.credit), 0) into v_summary_balance
  from public.journal_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a on a.id = l.account_id
  where a.workspace_id = p_workspace_id and a.system_role = 'income_summary'
    and e.status = 'posted' and e.deleted_at is null;
  if v_summary_balance <> 0 then
    perform app.raise_error('INVALID_CLOSING', 'Ikhtisar Laba Rugi belum bersaldo nol setelah tutup buku');
  end if;

  -- Kunci seluruh periode tahun buku (ADR 014), alasan tercatat di audit log.
  perform set_config('app.audit_reason', format('Tutup buku %s', p_year), true);
  update public.periods set status = 'closed'
  where workspace_id = p_workspace_id and extract(year from start_date) = p_year and status = 'open';
  perform set_config('app.audit_reason', '', true);

  return v_ids;
end
$$;

-- Membatalkan tutup buku: membalik seluruh jurnal penutup tahun itu, bertanggal 31 Desember.
create or replace function public.cancel_fiscal_year_closing(p_workspace_id uuid, p_year integer)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.journal_entries;
  v_ids uuid[] := '{}';
  v_input jsonb;
begin
  perform app.require_owner(p_workspace_id);
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not exists (select app.active_closing_ids(p_workspace_id, p_year)) then
    perform app.raise_error('CLOSING_NOT_FOUND', format('Belum ada tutup buku aktif untuk tahun %s', p_year));
  end if;

  for v_original in
    select e.* from public.journal_entries e
    where e.id in (select app.active_closing_ids(p_workspace_id, p_year))
    order by e.created_at desc, e.id desc
  loop
    v_input := jsonb_build_object(
      'workspaceId', p_workspace_id,
      'entryDate', to_char(make_date(p_year, 12, 31), 'YYYY-MM-DD'),
      'description', format('Pembatalan tutup buku %s: %s', p_year, v_original.description),
      'source', 'reversal',
      'counterparty', v_original.counterparty,
      'reversalOf', v_original.id,
      'lines', (
        select jsonb_agg(jsonb_build_object(
          'accountId', l.account_id, 'description', l.description,
          'debit', l.credit, 'credit', l.debit) order by l.line_no)
        from public.journal_lines l where l.journal_entry_id = v_original.id
      )
    );
    v_ids := v_ids || app.post_journal_core(v_input, null, 'closing_reversal');
  end loop;
  return v_ids;
end
$$;

revoke all on function
  public.post_journal(jsonb, uuid),
  public.close_fiscal_year(uuid, integer, jsonb),
  public.cancel_fiscal_year_closing(uuid, integer)
from public, anon;
grant execute on function
  public.post_journal(jsonb, uuid),
  public.close_fiscal_year(uuid, integer, jsonb),
  public.cancel_fiscal_year_closing(uuid, integer)
to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
