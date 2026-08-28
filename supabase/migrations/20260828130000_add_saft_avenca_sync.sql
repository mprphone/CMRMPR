-- Sincronização da avença (com IVA) para o SAFTonline, por região fiscal.

alter table public.clients
  add column if not exists vat_region text not null default 'continente';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass
      and conname = 'clients_vat_region_check'
  ) then
    alter table public.clients
      add constraint clients_vat_region_check
      check (vat_region in ('continente', 'madeira', 'acores'));
  end if;
end;
$$;

-- Semente a partir do MPR AEF (Sede Fiscal mais recente por NIF), 2026-08-28.
update public.clients set vat_region = 'madeira'
where regexp_replace(nif, '\D', '', 'g') in (
  '508794455', '513298550', '513815813', '515151319', '517051745', '517215110', '517779927'
);

create table if not exists public.saft_avenca_sync_runs (
  id uuid primary key default gen_random_uuid(),
  triggered_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total integer not null default 0,
  updated_count integer not null default 0,
  failed_count integer not null default 0,
  status text not null default 'running',
  details jsonb not null default '[]'::jsonb,
  error text
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.saft_avenca_sync_runs'::regclass
      and conname = 'saft_avenca_sync_runs_status_check'
  ) then
    alter table public.saft_avenca_sync_runs
      add constraint saft_avenca_sync_runs_status_check
      check (status in ('running', 'completed', 'failed'));
  end if;
end;
$$;

alter table public.saft_avenca_sync_runs enable row level security;
revoke all on table public.saft_avenca_sync_runs from anon;
grant select on table public.saft_avenca_sync_runs to authenticated;
grant all on table public.saft_avenca_sync_runs to service_role;

drop policy if exists saft_avenca_sync_runs_select on public.saft_avenca_sync_runs;
create policy saft_avenca_sync_runs_select on public.saft_avenca_sync_runs for select to authenticated
using (public.app_has_permission('billing', 'view'));
