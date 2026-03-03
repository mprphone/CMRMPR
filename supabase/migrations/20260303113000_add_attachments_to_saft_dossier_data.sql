alter table public.saft_dossier_data
  add column if not exists attachments jsonb not null default '[]'::jsonb;
