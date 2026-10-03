-- Menu, resep, rekap porsi & penjualan menu untuk variance (ADR 021, ROADMAP Fase 6B).

alter table public.audit_logs drop constraint audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check
  check (entity_type in ('workspace', 'account', 'period', 'journal', 'item', 'menu', 'recipe', 'portion_summary'));

-- 1. Menu.
create table public.menus (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  code               text not null check (btrim(code) <> ''),
  name               text not null check (btrim(name) <> ''),
  category           text,
  price              bigint not null default 0 check (price >= 0),
  revenue_account_id uuid,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint menus_id_workspace_key unique (id, workspace_id),
  constraint menus_revenue_account_fkey foreign key (revenue_account_id, workspace_id)
    references public.accounts (id, workspace_id)
);
create unique index menus_code_key on public.menus (workspace_id, code) where deleted_at is null;
create trigger menus_touch before update on public.menus
  for each row execute function app.touch_updated_at();
create trigger menus_audit after insert or update or delete on public.menus
  for each row execute function app.audit_row('menu');

-- 2. Resep berversi (tanggal berlaku) + bahan.
create table public.recipes (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  menu_id        uuid not null,
  effective_from date not null,
  yield_portions integer not null check (yield_portions between 1 and 1000000),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint recipes_id_workspace_key unique (id, workspace_id),
  constraint recipes_menu_fkey foreign key (menu_id, workspace_id) references public.menus (id, workspace_id)
);
create unique index recipes_menu_date_key on public.recipes (menu_id, effective_from) where deleted_at is null;
create trigger recipes_audit after insert or update or delete on public.recipes
  for each row execute function app.audit_row('recipe');

create table public.recipe_lines (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null,
  workspace_id uuid not null,
  line_no      integer not null,
  item_id      uuid not null,
  quantity     bigint not null check (quantity > 0),
  constraint recipe_lines_recipe_fkey foreign key (recipe_id, workspace_id)
    references public.recipes (id, workspace_id) on delete cascade,
  constraint recipe_lines_item_fkey foreign key (item_id, workspace_id) references public.items (id, workspace_id),
  constraint recipe_lines_item_key unique (recipe_id, item_id)
);
create index recipe_lines_item_idx on public.recipe_lines (item_id);

-- 3. Rekap porsi per rentang tanggal.
create table public.portion_summaries (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  date_from    date not null,
  date_to      date not null,
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint portion_summaries_range_check check (date_from <= date_to),
  constraint portion_summaries_id_workspace_key unique (id, workspace_id)
);
create trigger portion_summaries_audit after insert or update or delete on public.portion_summaries
  for each row execute function app.audit_row('portion_summary');

create table public.portion_summary_lines (
  id           uuid primary key default gen_random_uuid(),
  summary_id   uuid not null,
  workspace_id uuid not null,
  line_no      integer not null,
  menu_id      uuid not null,
  portions     bigint not null check (portions > 0),
  constraint portion_summary_lines_summary_fkey foreign key (summary_id, workspace_id)
    references public.portion_summaries (id, workspace_id) on delete cascade,
  constraint portion_summary_lines_menu_fkey foreign key (menu_id, workspace_id) references public.menus (id, workspace_id),
  constraint portion_summary_lines_menu_key unique (summary_id, menu_id)
);

-- 4. Rincian porsi penjualan menu (jurnalnya di journal_entries).
create table public.menu_sale_lines (
  id               uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null,
  workspace_id     uuid not null,
  line_no          integer not null,
  menu_id          uuid not null,
  portions         bigint not null check (portions > 0),
  amount           bigint not null check (amount > 0),
  constraint menu_sale_lines_journal_fkey foreign key (journal_entry_id, workspace_id)
    references public.journal_entries (id, workspace_id),
  constraint menu_sale_lines_menu_fkey foreign key (menu_id, workspace_id) references public.menus (id, workspace_id)
);
create index menu_sale_lines_journal_idx on public.menu_sale_lines (journal_entry_id);
create index menu_sale_lines_workspace_idx on public.menu_sale_lines (workspace_id);

alter table public.menus enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_lines enable row level security;
alter table public.portion_summaries enable row level security;
alter table public.portion_summary_lines enable row level security;
alter table public.menu_sale_lines enable row level security;
revoke all on public.menus, public.recipes, public.recipe_lines, public.portion_summaries,
  public.portion_summary_lines, public.menu_sale_lines from anon, authenticated;
grant select on public.menus, public.recipes, public.recipe_lines, public.portion_summaries,
  public.portion_summary_lines, public.menu_sale_lines to authenticated;
create policy menus_select_own on public.menus
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy recipes_select_own on public.recipes
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy recipe_lines_select_own on public.recipe_lines
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy portion_summaries_select_own on public.portion_summaries
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy portion_summary_lines_select_own on public.portion_summary_lines
  for select to authenticated using (app.owns_workspace(workspace_id));
create policy menu_sale_lines_select_own on public.menu_sale_lines
  for select to authenticated using (app.owns_workspace(workspace_id));

-- Bilangan bulat positif dari jsonb (bukan teks/desimal); null bila tidak valid.
create or replace function app.positive_int(p_value jsonb)
returns bigint
language sql
immutable
as $$
  select case when jsonb_typeof(p_value) = 'number' and (p_value #>> '{}') ~ '^[0-9]{1,15}$' and (p_value #>> '{}')::bigint > 0
              then (p_value #>> '{}')::bigint end;
$$;

-- 5. RPC menu.
create or replace function public.create_menu(p_workspace_id uuid, p_menu jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_owner(p_workspace_id);
  if jsonb_typeof(p_menu -> 'price') <> 'number' or (p_menu ->> 'price') !~ '^[0-9]{1,15}$' then
    perform app.raise_error('INVALID_AMOUNT', 'Harga jual harus bilangan bulat ≥ 0');
  end if;
  insert into public.menus (workspace_id, code, name, category, price, revenue_account_id)
  values (p_workspace_id, btrim(p_menu ->> 'code'), btrim(p_menu ->> 'name'),
          nullif(btrim(coalesce(p_menu ->> 'category', '')), ''), (p_menu ->> 'price')::bigint,
          app.to_uuid(p_menu ->> 'revenueAccountId'))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_MENU_CODE', format('Kode menu %s sudah dipakai', p_menu ->> 'code'));
  when foreign_key_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun pendapatan menu tidak ditemukan di workspace ini');
  when check_violation or not_null_violation then
    perform app.raise_error('EMPTY_NAME', 'Kode dan nama menu wajib diisi');
end
$$;

create or replace function public.update_menu(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.menus;
begin
  select * into v_old from public.menus where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('MENU_NOT_FOUND', 'Menu tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if p_patch ? 'price' and (jsonb_typeof(p_patch -> 'price') <> 'number' or (p_patch ->> 'price') !~ '^[0-9]{1,15}$') then
    perform app.raise_error('INVALID_AMOUNT', 'Harga jual harus bilangan bulat ≥ 0');
  end if;
  update public.menus set
    code = coalesce(btrim(p_patch ->> 'code'), code),
    name = coalesce(btrim(p_patch ->> 'name'), name),
    category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch ->> 'category', '')), '') else category end,
    price = case when p_patch ? 'price' then (p_patch ->> 'price')::bigint else price end,
    revenue_account_id = case when p_patch ? 'revenueAccountId' then app.to_uuid(p_patch ->> 'revenueAccountId')
                              else revenue_account_id end,
    is_active = coalesce((p_patch ->> 'isActive')::boolean, is_active)
  where id = p_id;
exception
  when unique_violation then
    perform app.raise_error('DUPLICATE_MENU_CODE', format('Kode menu %s sudah dipakai', p_patch ->> 'code'));
  when foreign_key_violation then
    perform app.raise_error('INVALID_ACCOUNT', 'Akun pendapatan menu tidak ditemukan di workspace ini');
  when check_violation then
    perform app.raise_error('EMPTY_NAME', 'Kode dan nama menu wajib diisi');
end
$$;

create or replace function public.delete_menu(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.menus;
begin
  select * into v_old from public.menus where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('MENU_NOT_FOUND', 'Menu tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if exists (
    select 1 from public.menu_sale_lines l join public.journal_entries e on e.id = l.journal_entry_id
    where l.menu_id = p_id and e.deleted_at is null and app.active_reversal(e.id) is null
  ) or exists (
    select 1 from public.portion_summary_lines l join public.portion_summaries s on s.id = l.summary_id
    where l.menu_id = p_id and s.deleted_at is null
  ) then
    perform app.raise_error('MENU_IN_USE', 'Menu sudah punya penjualan/rekap porsi; nonaktifkan saja, tidak bisa dihapus');
  end if;
  update public.recipes set deleted_at = now() where menu_id = p_id and deleted_at is null;
  update public.menus set deleted_at = now() where id = p_id;
end
$$;

-- 6. Resep: versi baru menggantikan versi aktif dengan tanggal berlaku sama.
create or replace function public.save_recipe(p_recipe jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_recipe ->> 'workspaceId');
  v_menu public.menus;
  v_date date;
  v_yield bigint := app.positive_int(p_recipe -> 'yieldPortions');
  v_lines jsonb := coalesce(p_recipe -> 'lines', '[]'::jsonb);
  v_line jsonb;
  v_id uuid;
begin
  perform app.require_owner(v_ws);
  select * into v_menu from public.menus where id = app.to_uuid(p_recipe ->> 'menuId') and deleted_at is null for update;
  if not found or v_menu.workspace_id <> v_ws then
    perform app.raise_error('MENU_NOT_FOUND', 'Menu tidak ditemukan');
  end if;
  begin
    v_date := (p_recipe ->> 'effectiveFrom')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal berlaku resep tidak valid');
  end;
  if v_date is null then
    perform app.raise_error('INVALID_DATE', 'Tanggal berlaku resep wajib diisi');
  end if;
  if v_yield is null or v_yield > 1000000 then
    perform app.raise_error('INVALID_RECIPE', 'Jumlah porsi resep harus bilangan bulat 1–1.000.000');
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    perform app.raise_error('INVALID_RECIPE', 'Resep minimal berisi satu bahan');
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    if not exists (select 1 from public.items i where i.id = app.to_uuid(v_line ->> 'itemId') and i.workspace_id = v_ws and i.deleted_at is null) then
      perform app.raise_error('ITEM_NOT_FOUND', 'Bahan pada resep tidak ditemukan');
    end if;
    if app.positive_int(v_line -> 'quantity') is null then
      perform app.raise_error('INVALID_QUANTITY', 'Qty bahan resep harus bilangan bulat > 0');
    end if;
  end loop;

  update public.recipes set deleted_at = now()
  where menu_id = v_menu.id and effective_from = v_date and deleted_at is null;
  insert into public.recipes (workspace_id, menu_id, effective_from, yield_portions)
  values (v_ws, v_menu.id, v_date, v_yield)
  returning id into v_id;
  begin
    insert into public.recipe_lines (recipe_id, workspace_id, line_no, item_id, quantity)
    select v_id, v_ws, l.n, app.to_uuid(l.v ->> 'itemId'), (l.v ->> 'quantity')::bigint
    from jsonb_array_elements(v_lines) with ordinality l(v, n);
  exception when unique_violation then
    perform app.raise_error('INVALID_RECIPE', 'Bahan yang sama muncul dua kali di resep');
  end;
  return v_id;
end
$$;

create or replace function public.delete_recipe(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.recipes;
begin
  select * into v_old from public.recipes where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Resep tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  update public.recipes set deleted_at = now() where id = p_id;
end
$$;

-- 7. Rekap porsi (rentang tidak boleh bertumpuk; dikunci per workspace).
create or replace function public.create_portion_summary(p_summary jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_summary ->> 'workspaceId');
  v_from date;
  v_to date;
  v_lines jsonb := coalesce(p_summary -> 'lines', '[]'::jsonb);
  v_line jsonb;
  v_overlap public.portion_summaries;
  v_id uuid;
begin
  perform app.require_owner(v_ws);
  perform 1 from public.workspaces where id = v_ws for update;
  begin
    v_from := (p_summary ->> 'dateFrom')::date;
    v_to := (p_summary ->> 'dateTo')::date;
  exception when others then
    perform app.raise_error('INVALID_DATE', 'Tanggal rekap tidak valid');
  end;
  if v_from is null or v_to is null or v_from > v_to then
    perform app.raise_error('INVALID_DATE', 'Rentang tanggal rekap tidak valid');
  end if;
  select * into v_overlap from public.portion_summaries
  where workspace_id = v_ws and deleted_at is null and date_from <= v_to and v_from <= date_to
  limit 1;
  if found then
    perform app.raise_error('INVALID_PORTION_SUMMARY', format('Rentang bertumpuk dengan rekap %s s.d. %s', v_overlap.date_from, v_overlap.date_to));
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    perform app.raise_error('INVALID_PORTION_SUMMARY', 'Isi porsi minimal satu menu');
  end if;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    if not exists (select 1 from public.menus m where m.id = app.to_uuid(v_line ->> 'menuId') and m.workspace_id = v_ws and m.deleted_at is null) then
      perform app.raise_error('MENU_NOT_FOUND', 'Menu pada rekap tidak ditemukan');
    end if;
    if app.positive_int(v_line -> 'portions') is null then
      perform app.raise_error('INVALID_QUANTITY', 'Porsi harus bilangan bulat > 0');
    end if;
  end loop;
  insert into public.portion_summaries (workspace_id, date_from, date_to, note)
  values (v_ws, v_from, v_to, nullif(btrim(coalesce(p_summary ->> 'note', '')), ''))
  returning id into v_id;
  begin
    insert into public.portion_summary_lines (summary_id, workspace_id, line_no, menu_id, portions)
    select v_id, v_ws, l.n, app.to_uuid(l.v ->> 'menuId'), (l.v ->> 'portions')::bigint
    from jsonb_array_elements(v_lines) with ordinality l(v, n);
  exception when unique_violation then
    perform app.raise_error('INVALID_PORTION_SUMMARY', 'Menu yang sama muncul dua kali di rekap');
  end;
  return v_id;
end
$$;

create or replace function public.delete_portion_summary(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.portion_summaries;
begin
  select * into v_old from public.portion_summaries where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('NOT_FOUND', 'Rekap porsi tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  update public.portion_summaries set deleted_at = now() where id = p_id;
end
$$;

-- 8. Penjualan menu: jurnal penjualan + rincian porsi, atomik.
create or replace function public.post_menu_sale(p_journal jsonb, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := app.to_uuid(p_journal ->> 'workspaceId');
  v_line jsonb;
  v_menu public.menus;
  v_journal uuid;
begin
  perform app.require_owner(v_ws);
  if p_journal ->> 'source' is distinct from 'revenue' then
    perform app.raise_error('INVALID_ACCOUNT', 'Jurnal penjualan menu harus bersumber penjualan');
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform app.raise_error('LINE_ZERO', 'Isi minimal satu menu');
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_menu from public.menus where id = app.to_uuid(v_line ->> 'menuId') and deleted_at is null;
    if not found or v_menu.workspace_id <> v_ws then
      perform app.raise_error('MENU_NOT_FOUND', 'Menu tidak ditemukan');
    end if;
    if not v_menu.is_active then
      perform app.raise_error('MENU_INACTIVE', format('%s nonaktif', v_menu.name));
    end if;
    if app.positive_int(v_line -> 'portions') is null or app.positive_int(v_line -> 'amount') is null then
      perform app.raise_error('INVALID_QUANTITY', format('%s: porsi dan nominal harus bilangan bulat > 0', v_menu.name));
    end if;
  end loop;
  v_journal := app.post_journal_core(p_journal, null, 'public');
  insert into public.menu_sale_lines (journal_entry_id, workspace_id, line_no, menu_id, portions, amount)
  select v_journal, v_ws, l.n, app.to_uuid(l.v ->> 'menuId'), (l.v ->> 'portions')::bigint, (l.v ->> 'amount')::bigint
  from jsonb_array_elements(p_lines) with ordinality l(v, n);
  return v_journal;
end
$$;

-- 9. Bahan yang dipakai resep tidak bisa dihapus.
create or replace function public.delete_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.items;
begin
  select * into v_old from public.items where id = p_id and deleted_at is null for update;
  if not found then
    perform app.raise_error('ITEM_NOT_FOUND', 'Barang tidak ditemukan');
  end if;
  perform app.require_owner(v_old.workspace_id);
  if exists (
    select 1 from public.journal_lines l join public.journal_entries e on e.id = l.journal_entry_id
    where l.item_id = p_id and e.deleted_at is null
  ) then
    perform app.raise_error('ITEM_IN_USE', 'Barang sudah dipakai jurnal; nonaktifkan saja, tidak bisa dihapus');
  end if;
  if exists (
    select 1 from public.recipe_lines l join public.recipes r on r.id = l.recipe_id
    where l.item_id = p_id and r.deleted_at is null
  ) then
    perform app.raise_error('ITEM_IN_USE', 'Bahan dipakai resep menu; hapus dari resep dulu atau nonaktifkan saja');
  end if;
  update public.items set deleted_at = now() where id = p_id;
end
$$;

revoke all on function public.create_menu(uuid, jsonb), public.update_menu(uuid, jsonb), public.delete_menu(uuid),
  public.save_recipe(jsonb), public.delete_recipe(uuid), public.create_portion_summary(jsonb),
  public.delete_portion_summary(uuid), public.post_menu_sale(jsonb, jsonb) from public, anon;
grant execute on function public.create_menu(uuid, jsonb), public.update_menu(uuid, jsonb), public.delete_menu(uuid),
  public.save_recipe(jsonb), public.delete_recipe(uuid), public.create_portion_summary(jsonb),
  public.delete_portion_summary(uuid), public.post_menu_sale(jsonb, jsonb) to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
