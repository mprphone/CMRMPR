alter table public.clients
  add column if not exists saft_collect_enabled boolean not null default true;

create table if not exists public.saft_sync_queue (
  client_nif text primary key,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  requested_by text,
  updated_at timestamptz not null default now(),
  constraint saft_sync_queue_status_check check (status in ('pending', 'running', 'done', 'error'))
);

create index if not exists idx_saft_sync_queue_status
  on public.saft_sync_queue (status, requested_at desc);

create or replace function public.set_saft_sync_queue_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_saft_sync_queue_updated_at on public.saft_sync_queue;
create trigger trg_saft_sync_queue_updated_at
before update on public.saft_sync_queue
for each row
execute function public.set_saft_sync_queue_updated_at();

grant select, insert, update, delete on table public.saft_sync_queue to anon, authenticated, service_role;
