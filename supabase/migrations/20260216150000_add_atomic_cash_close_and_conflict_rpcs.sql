do $migration$
begin
  execute $close_cash_sql$
create or replace function public.close_cash_register_atomic(
  p_deposited_amount numeric,
  p_spent_amount numeric,
  p_spent_description text,
  p_report_details jsonb,
  p_payment_ids uuid[],
  p_mbway_deposited_amount numeric default 0,
  p_adjustment_amount numeric default 0,
  p_session_expense_ids uuid[] default '{}'::uuid[]
)
returns public.cash_operations
language plpgsql
security definer
set search_path = public
as $close_cash$
declare
  v_operation public.cash_operations;
begin
  select *
    into v_operation
  from public.create_cash_operation(
    p_deposited_amount,
    p_spent_amount,
    p_spent_description,
    p_report_details,
    p_payment_ids,
    p_mbway_deposited_amount,
    p_adjustment_amount
  );

  if coalesce(array_length(p_session_expense_ids, 1), 0) > 0 then
    update public.cash_session_expenses
       set cash_operation_id = v_operation.id
     where id = any(p_session_expense_ids)
       and cash_operation_id is null;
  end if;

  return v_operation;
end;
$close_cash$;
$close_cash_sql$;

  execute $save_settings_sql$
create or replace function public.save_global_settings_if_match(
  p_value jsonb,
  p_expected_updated_at timestamptz default null
)
returns table (
  conflict boolean,
  value jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $save_settings$
declare
  v_current_value jsonb;
  v_current_updated_at timestamptz;
begin
  select ac.value, ac.updated_at
    into v_current_value, v_current_updated_at
  from public.app_config ac
  where ac.key = 'global_settings'
  for update;

  if not found then
    insert into public.app_config(key, value)
    values ('global_settings', p_value)
    returning app_config.value, app_config.updated_at
      into v_current_value, v_current_updated_at;

    return query
    select false, v_current_value, v_current_updated_at;
    return;
  end if;

  if p_expected_updated_at is not null
     and v_current_updated_at is distinct from p_expected_updated_at then
    return query
    select true, v_current_value, v_current_updated_at;
    return;
  end if;

  update public.app_config
     set value = p_value
   where key = 'global_settings'
   returning app_config.value, app_config.updated_at
     into v_current_value, v_current_updated_at;

  return query
  select false, v_current_value, v_current_updated_at;
end;
$save_settings$;
$save_settings_sql$;

  execute $replace_tasks_sql$
create or replace function public.replace_app_tasks_if_version(
  p_tasks jsonb,
  p_expected_version timestamptz default null
)
returns table (
  conflict boolean,
  version timestamptz
)
language plpgsql
security definer
set search_path = public
as $replace_tasks$
declare
  v_current_version timestamptz;
  v_new_version timestamptz;
begin
  if p_tasks is null then
    p_tasks := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'p_tasks must be a JSON array';
  end if;

  lock table public.app_tasks in share row exclusive mode;

  select max(updated_at)
    into v_current_version
  from public.app_tasks;

  if p_expected_version is not null
     and v_current_version is distinct from p_expected_version then
    return query
    select true, v_current_version;
    return;
  end if;

  create temporary table _incoming_tasks (
    id text primary key,
    name text not null,
    area text not null,
    type text not null,
    default_time_minutes integer not null,
    default_frequency_per_year integer not null,
    multiplier_logic text null
  ) on commit drop;

  insert into _incoming_tasks(
    id,
    name,
    area,
    type,
    default_time_minutes,
    default_frequency_per_year,
    multiplier_logic
  )
  select
    task.id,
    task.name,
    task.area,
    task.type,
    task.default_time_minutes,
    task.default_frequency_per_year,
    task.multiplier_logic
  from jsonb_to_recordset(p_tasks) as task(
    id text,
    name text,
    area text,
    type text,
    default_time_minutes integer,
    default_frequency_per_year integer,
    multiplier_logic text
  );

  insert into public.app_tasks(
    id,
    name,
    area,
    type,
    default_time_minutes,
    default_frequency_per_year,
    multiplier_logic
  )
  select
    incoming.id,
    incoming.name,
    incoming.area,
    incoming.type,
    incoming.default_time_minutes,
    incoming.default_frequency_per_year,
    incoming.multiplier_logic
  from _incoming_tasks incoming
  on conflict (id) do update
    set name = excluded.name,
        area = excluded.area,
        type = excluded.type,
        default_time_minutes = excluded.default_time_minutes,
        default_frequency_per_year = excluded.default_frequency_per_year,
        multiplier_logic = excluded.multiplier_logic;

  delete from public.app_tasks
   where id not in (select id from _incoming_tasks);

  select max(updated_at)
    into v_new_version
  from public.app_tasks;

  return query
  select false, v_new_version;
end;
$replace_tasks$;
$replace_tasks_sql$;

  execute $grant_close_cash$
grant execute on function public.close_cash_register_atomic(
  numeric,
  numeric,
  text,
  jsonb,
  uuid[],
  numeric,
  numeric,
  uuid[]
) to anon, authenticated, service_role;
$grant_close_cash$;

  execute $grant_settings$
grant execute on function public.save_global_settings_if_match(
  jsonb,
  timestamptz
) to anon, authenticated, service_role;
$grant_settings$;

  execute $grant_tasks$
grant execute on function public.replace_app_tasks_if_version(
  jsonb,
  timestamptz
) to anon, authenticated, service_role;
$grant_tasks$;
end;
$migration$;
