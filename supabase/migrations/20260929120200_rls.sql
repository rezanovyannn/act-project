-- Row Level Security (ADR 004 & 013).
-- Role `authenticated` hanya boleh MEMBACA data workspace miliknya.
-- Semua penulisan lewat fungsi RPC (SECURITY DEFINER + cek kepemilikan eksplisit).

alter table public.workspaces      enable row level security;
alter table public.accounts        enable row level security;
alter table public.periods         enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines   enable row level security;
alter table public.audit_logs      enable row level security;

revoke all on public.workspaces, public.accounts, public.periods,
              public.journal_entries, public.journal_lines, public.audit_logs
  from anon, authenticated;
grant select on public.workspaces, public.accounts, public.periods,
                public.journal_entries, public.journal_lines, public.audit_logs
  to authenticated;

create policy workspaces_select_own on public.workspaces
  for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null);

create policy accounts_select_own on public.accounts
  for select to authenticated using (app.owns_workspace(workspace_id));

create policy periods_select_own on public.periods
  for select to authenticated using (app.owns_workspace(workspace_id));

create policy journal_entries_select_own on public.journal_entries
  for select to authenticated using (app.owns_workspace(workspace_id));

create policy journal_lines_select_own on public.journal_lines
  for select to authenticated using (app.owns_workspace(workspace_id));

create policy audit_logs_select_own on public.audit_logs
  for select to authenticated using (app.owns_workspace(workspace_id));

-- Skema app tidak diekspos Data API; hanya fungsi yang dibutuhkan kebijakan RLS.
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.owns_workspace(uuid) to authenticated;
