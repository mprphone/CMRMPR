do $migration$
begin
  if to_regclass('public.insurance_policies') is not null then
    execute 'alter table public.insurance_policies add column if not exists document_checklist jsonb not null default ''{}''::jsonb';
  end if;

  if to_regclass('public.work_safety_services') is not null then
    execute 'alter table public.work_safety_services add column if not exists document_checklist jsonb not null default ''{}''::jsonb';
  end if;
end;
$migration$;
