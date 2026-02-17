do $$
begin
  if to_regclass('public.work_safety_services') is not null then
    execute 'alter table public.work_safety_services add column if not exists profile_data jsonb not null default ''{}''::jsonb';
    execute 'alter table public.work_safety_services add column if not exists ai_obligations_summary text';
  end if;
end;
$$;
