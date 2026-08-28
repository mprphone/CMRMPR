-- Keep the catalog replacement atomic without a session-scoped temporary
-- table. This is equivalent at runtime and lets plpgsql_check validate the
-- function completely.

create or replace function public.replace_app_tasks_if_version(
  p_tasks jsonb,
  p_expected_version timestamptz default null
)
returns table(conflict boolean, version timestamptz)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_current_version timestamptz;
  v_new_version timestamptz;
begin
  p_tasks := coalesce(p_tasks, '[]'::jsonb);
  if jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  lock table public.app_tasks in share row exclusive mode;
  select max(updated_at) into v_current_version from public.app_tasks;

  if p_expected_version is not null
     and v_current_version is distinct from p_expected_version then
    return query select true, v_current_version;
    return;
  end if;

  insert into public.app_tasks(
    id, name, area, type, default_time_minutes,
    default_frequency_per_year, multiplier_logic
  )
  select
    task.id, task.name, task.area, task.type, task.default_time_minutes,
    task.default_frequency_per_year, task.multiplier_logic
  from jsonb_to_recordset(p_tasks) as task(
    id text,
    name text,
    area text,
    type text,
    default_time_minutes integer,
    default_frequency_per_year integer,
    multiplier_logic text
  )
  on conflict (id) do update
    set name = excluded.name,
        area = excluded.area,
        type = excluded.type,
        default_time_minutes = excluded.default_time_minutes,
        default_frequency_per_year = excluded.default_frequency_per_year,
        multiplier_logic = excluded.multiplier_logic;

  delete from public.app_tasks existing
  where not exists (
    select 1
    from jsonb_to_recordset(p_tasks) as incoming(id text)
    where incoming.id = existing.id
  );

  select max(updated_at) into v_new_version from public.app_tasks;
  return query select false, v_new_version;
end;
$$;

revoke all on function public.replace_app_tasks_if_version(jsonb, timestamptz) from public, anon;
grant execute on function public.replace_app_tasks_if_version(jsonb, timestamptz) to authenticated, service_role;
