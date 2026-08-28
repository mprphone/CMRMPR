-- Colaboradores que já não trabalham na equipa continuavam a aparecer em
-- todas as listas/gráficos (sem forma de os marcar como inativos, ao
-- contrário de clients, que já tem este campo). Segue a mesma convenção.
alter table public.staff
  add column if not exists status text not null default 'Ativo';

alter table public.staff
  drop constraint if exists staff_status_check;
alter table public.staff
  add constraint staff_status_check check (status in ('Ativo', 'Inativo'));

create or replace function public.upsert_staff_member(p_staff jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.staff := jsonb_populate_record(null::public.staff, p_staff);
  v_exists boolean;
begin
  if v_row.id is null then
    raise exception 'id obrigatório';
  end if;
  if not public.app_mfa_satisfied() then
    raise exception 'Verificação de segurança (MFA) necessária' using errcode = '42501';
  end if;

  select exists(select 1 from public.staff where id = v_row.id) into v_exists;

  if v_exists then
    if not public.app_has_permission('team', 'edit') then
      raise exception 'Sem permissão para editar este colaborador' using errcode = '42501';
    end if;
  else
    if not public.app_has_permission('team', 'create') then
      raise exception 'Sem permissão para criar este colaborador' using errcode = '42501';
    end if;
  end if;

  insert into public.staff (
    id, name, email, phone, role, base_salary, social_charges_percent,
    meal_allowance, other_monthly_costs, capacity_hours_per_month, hourly_cost, assigned_areas, status
  ) values (
    v_row.id, v_row.name, coalesce(v_row.email, ''), coalesce(v_row.phone, ''),
    coalesce(v_row.role, 'Colaborador'), coalesce(v_row.base_salary, 0),
    coalesce(v_row.social_charges_percent, 23.75), coalesce(v_row.meal_allowance, 0),
    coalesce(v_row.other_monthly_costs, 0), coalesce(v_row.capacity_hours_per_month, 160),
    coalesce(v_row.hourly_cost, 0), coalesce(v_row.assigned_areas, '[]'::jsonb),
    coalesce(v_row.status, 'Ativo')
  )
  on conflict (id) do update set
    name = excluded.name, email = excluded.email, phone = excluded.phone, role = excluded.role,
    base_salary = excluded.base_salary, social_charges_percent = excluded.social_charges_percent,
    meal_allowance = excluded.meal_allowance, other_monthly_costs = excluded.other_monthly_costs,
    capacity_hours_per_month = excluded.capacity_hours_per_month, hourly_cost = excluded.hourly_cost,
    assigned_areas = excluded.assigned_areas, status = excluded.status;
end;
$$;
