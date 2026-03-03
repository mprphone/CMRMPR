create table if not exists public.saft_dossier_data (
  client_nif text primary key,
  client_name text not null default '',
  source_detail_url text,
  at_status text,
  at_collected_at timestamptz,
  ss_status text,
  ss_collected_at timestamptz,
  certidao_at_status text,
  certidao_ss_status text,
  certidao_permanente_status text,
  certidao_permanente_code text,
  raw_list jsonb not null default '{}'::jsonb,
  raw_detail jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saft_dossier_data_synced_at
  on public.saft_dossier_data (synced_at desc);

create or replace function public.set_saft_dossier_data_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_saft_dossier_data_updated_at on public.saft_dossier_data;
create trigger trg_saft_dossier_data_updated_at
before update on public.saft_dossier_data
for each row
execute function public.set_saft_dossier_data_updated_at();

grant select, insert, update on table public.saft_dossier_data to anon, authenticated, service_role;
