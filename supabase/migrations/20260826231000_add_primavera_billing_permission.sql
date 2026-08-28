-- A faturação Primavera contém valores financeiros e fica desligada por defeito.
-- Administradores e gestores recebem acesso; os restantes perfis podem ser configurados no CMR.
update public.app_user_access
set module_permissions = jsonb_set(
  coalesce(module_permissions, '{}'::jsonb),
  '{billing}',
  case
    when access_role in ('admin', 'manager') then '{"view":true,"create":false,"edit":false,"delete":false,"export":true}'::jsonb
    else '{"view":false,"create":false,"edit":false,"delete":false,"export":false}'::jsonb
  end,
  true
), updated_at = now()
where not (coalesce(module_permissions, '{}'::jsonb) ? 'billing');

create or replace function public.app_default_module_permissions(p_role text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_all jsonb := '{"view":true,"create":true,"edit":true,"delete":true,"export":true}'::jsonb;
  v_read_financial jsonb := '{"view":true,"create":false,"edit":false,"delete":false,"export":true}'::jsonb;
  v_none jsonb := '{"view":false,"create":false,"edit":false,"delete":false,"export":false}'::jsonb;
begin
  if p_role = 'admin' then
    return jsonb_build_object(
      'dashboard', v_all, 'clients', v_all, 'billing', v_all, 'groups', v_all, 'insurance', v_all,
      'sht', v_all, 'cashier', v_all, 'irs_control', v_all, 'emails', v_all,
      'team', v_all, 'tasks', v_all, 'calculator', v_all, 'settings', v_all
    );
  elsif p_role = 'manager' then
    return jsonb_build_object(
      'dashboard', v_all, 'clients', v_all, 'billing', v_read_financial, 'groups', v_all, 'insurance', v_all,
      'sht', v_all, 'cashier', v_all, 'irs_control', v_all, 'emails', v_none,
      'team', v_all, 'tasks', v_all, 'calculator', v_all, 'settings', v_none
    );
  elsif p_role = 'insurance' then
    return jsonb_build_object(
      'dashboard', v_none, 'clients', v_none, 'billing', v_none, 'groups', v_none, 'insurance', v_all,
      'sht', v_none, 'cashier', v_none, 'irs_control', v_none, 'emails', v_none,
      'team', v_none, 'tasks', v_none, 'calculator', v_none, 'settings', v_none
    );
  elsif p_role = 'custom' then
    return jsonb_build_object(
      'dashboard', v_none, 'clients', v_none, 'billing', v_none, 'groups', v_none, 'insurance', v_none,
      'sht', v_none, 'cashier', v_none, 'irs_control', v_none, 'emails', v_none,
      'team', v_none, 'tasks', v_none, 'calculator', v_none, 'settings', v_none
    );
  end if;

  return jsonb_build_object(
    'dashboard', v_none, 'clients', v_all, 'billing', v_none, 'groups', v_all, 'insurance', v_all,
    'sht', v_all, 'cashier', v_all, 'irs_control', v_all, 'emails', v_none,
    'team', v_none, 'tasks', v_all, 'calculator', v_none, 'settings', v_none
  );
end;
$$;
