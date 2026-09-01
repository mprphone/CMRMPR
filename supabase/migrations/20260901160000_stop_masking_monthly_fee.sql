-- A avença (monthly_fee) não é dado financeiro sensível como volume de
-- negócios/lucro: é o valor operacional que quem gere a caixa, faturação ou
-- grupos de avenças precisa de ver para fazer o trabalho, mesmo sem a
-- permissão can_view_financial. Deixa de ser mascarada.

create or replace function public.get_visible_clients()
returns setof public.clients
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_access public.app_user_access;
  v_can_view_financial boolean;
begin
  if public.app_is_service_role() then
    return query select client.* from public.clients client;
    return;
  end if;

  select access.* into v_access
  from public.app_user_access access
  where access.user_id = auth.uid();

  if not found
     or not v_access.active
     or not public.app_mfa_satisfied()
     or not (
       v_access.access_role = 'admin'
       or coalesce((v_access.module_permissions -> 'clients' ->> 'view')::boolean, false)
     ) then
    return;
  end if;

  v_can_view_financial := v_access.access_role = 'admin' or v_access.can_view_financial;

  if v_can_view_financial then
    return query
    select client.*
    from public.clients client
    where case
      when v_access.access_role = 'admin' or v_access.data_scope = 'all' then true
      when v_access.data_scope = 'assigned' then
        v_access.staff_id is not null
        and client.responsavel_interno_id = v_access.staff_id
      when v_access.data_scope = 'selected' then
        client.id = any(v_access.allowed_client_ids)
        or (client.group_id is not null and client.group_id = any(v_access.allowed_group_ids))
      else false
    end;
    return;
  end if;

  return query
  select (jsonb_populate_record(
    null::public.clients,
    to_jsonb(client) || jsonb_build_object(
      'turnover', 0,
      'previous_year_profit', 0,
      'ai_analysis_cache', null
    )
  )).*
  from public.clients client
  where case
    when v_access.access_role = 'admin' or v_access.data_scope = 'all' then true
    when v_access.data_scope = 'assigned' then
      v_access.staff_id is not null
      and client.responsavel_interno_id = v_access.staff_id
    when v_access.data_scope = 'selected' then
      client.id = any(v_access.allowed_client_ids)
      or (client.group_id is not null and client.group_id = any(v_access.allowed_group_ids))
    else false
  end;
end;
$$;
