create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_tasks (
  id text primary key,
  name text not null,
  area text not null,
  type text not null,
  default_time_minutes integer not null default 0,
  default_frequency_per_year integer not null default 1,
  multiplier_logic text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_tasks_default_time_nonnegative check (default_time_minutes >= 0),
  constraint app_tasks_default_frequency_nonnegative check (default_frequency_per_year >= 0)
);

create index if not exists idx_app_tasks_area on public.app_tasks(area);

create or replace function public.set_app_config_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_config_updated_at on public.app_config;
create trigger trg_app_config_updated_at
before update on public.app_config
for each row
execute function public.set_app_config_updated_at();

create or replace function public.set_app_tasks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_app_tasks_updated_at on public.app_tasks;
create trigger trg_app_tasks_updated_at
before update on public.app_tasks
for each row
execute function public.set_app_tasks_updated_at();
