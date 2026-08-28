-- Controlo de acesso configurável no CMRMPR.
-- As regras são aplicadas na interface e, sobretudo, via RLS/RPC no PostgreSQL.

create or replace function public.app_default_module_permissions(p_role text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_all jsonb := '{"view":true,"create":true,"edit":true,"delete":true,"export":true}'::jsonb;
  v_none jsonb := '{"view":false,"create":false,"edit":false,"delete":false,"export":false}'::jsonb;
begin
  if p_role = 'admin' then
    return jsonb_build_object(
      'dashboard', v_all, 'clients', v_all, 'groups', v_all, 'insurance', v_all,
      'sht', v_all, 'cashier', v_all, 'irs_control', v_all, 'emails', v_all,
      'team', v_all, 'tasks', v_all, 'calculator', v_all, 'settings', v_all
    );
  elsif p_role = 'manager' then
    return jsonb_build_object(
      'dashboard', v_all, 'clients', v_all, 'groups', v_all, 'insurance', v_all,
      'sht', v_all, 'cashier', v_all, 'irs_control', v_all, 'emails', v_none,
      'team', v_all, 'tasks', v_all, 'calculator', v_all, 'settings', v_none
    );
  elsif p_role = 'insurance' then
    return jsonb_build_object(
      'dashboard', v_none, 'clients', v_none, 'groups', v_none, 'insurance', v_all,
      'sht', v_none, 'cashier', v_none, 'irs_control', v_none, 'emails', v_none,
      'team', v_none, 'tasks', v_none, 'calculator', v_none, 'settings', v_none
    );
  elsif p_role = 'custom' then
    return jsonb_build_object(
      'dashboard', v_none, 'clients', v_none, 'groups', v_none, 'insurance', v_none,
      'sht', v_none, 'cashier', v_none, 'irs_control', v_none, 'emails', v_none,
      'team', v_none, 'tasks', v_none, 'calculator', v_none, 'settings', v_none
    );
  end if;

  -- Mantém o comportamento anterior dos utilizadores normais.
  return jsonb_build_object(
    'dashboard', v_none, 'clients', v_all, 'groups', v_all, 'insurance', v_all,
    'sht', v_all, 'cashier', v_all, 'irs_control', v_all, 'emails', v_none,
    'team', v_none, 'tasks', v_all, 'calculator', v_none, 'settings', v_none
  );
end;
$$;

create table if not exists public.app_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  access_role text not null default 'user'
    check (access_role in ('admin', 'manager', 'user', 'insurance', 'custom')),
  active boolean not null default true,
  module_permissions jsonb not null default public.app_default_module_permissions('user'),
  data_scope text not null default 'all'
    check (data_scope in ('all', 'assigned', 'selected', 'insurance_own')),
  staff_id uuid references public.staff(id) on delete set null,
  allowed_client_ids uuid[] not null default '{}'::uuid[],
  allowed_group_ids uuid[] not null default '{}'::uuid[],
  insurance_agent text,
  can_view_financial boolean not null default false,
  can_view_commissions boolean not null default false,
  can_sync_wampr boolean not null default false,
  can_manage_users boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_app_user_access_staff_id on public.app_user_access(staff_id);

create table if not exists public.app_access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  before_profile jsonb,
  after_profile jsonb not null,
  changed_at timestamptz not null default now()
);

create or replace function public.set_app_user_access_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_app_user_access_updated_at on public.app_user_access;
create trigger trg_app_user_access_updated_at
before update on public.app_user_access
for each row execute function public.set_app_user_access_updated_at();

create or replace function public.app_is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.role() = 'service_role', false);
$$;

create or replace function public.app_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or exists (
      select 1 from public.app_user_access access
      where access.user_id = auth.uid() and access.active
    );
$$;

create or replace function public.app_has_permission(p_module text, p_action text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and (
        access.access_role = 'admin'
        or coalesce((access.module_permissions -> p_module ->> p_action)::boolean, false)
      )
      from public.app_user_access access
      where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and (access.access_role = 'admin' or access.can_manage_users)
      from public.app_user_access access where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_view_financial()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and (access.access_role = 'admin' or access.can_view_financial)
      from public.app_user_access access where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_view_commissions()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and (access.access_role = 'admin' or access.can_view_commissions)
      from public.app_user_access access where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_sync_wampr()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and (access.access_role = 'admin' or access.can_sync_wampr)
      from public.app_user_access access where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_access_client(
  p_client_id uuid,
  p_responsible_staff_id uuid,
  p_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and case
        when access.access_role = 'admin' or access.data_scope = 'all' then true
        when access.data_scope = 'assigned' then
          access.staff_id is not null and p_responsible_staff_id = access.staff_id
        when access.data_scope = 'selected' then
          p_client_id = any(access.allowed_client_ids)
          or (p_group_id is not null and p_group_id = any(access.allowed_group_ids))
        else false
      end
      from public.app_user_access access where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_access_client_id(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clients client
    where client.id = p_client_id
      and public.app_can_access_client(client.id, client.responsavel_interno_id, client.group_id)
  );
$$;

create or replace function public.app_can_access_client_nif(p_client_nif text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clients client
    where client.nif = p_client_nif
      and public.app_can_access_client(client.id, client.responsavel_interno_id, client.group_id)
  );
$$;

create or replace function public.app_can_access_group(p_group_id uuid, p_client_ids jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and case
        when access.access_role = 'admin' or access.data_scope = 'all' then true
        when access.data_scope = 'selected' then
          p_group_id = any(access.allowed_group_ids)
          or exists (
            select 1 from jsonb_array_elements_text(coalesce(p_client_ids, '[]'::jsonb)) item
            where item.value ~* '^[0-9a-f-]{36}$' and item.value::uuid = any(access.allowed_client_ids)
          )
        when access.data_scope = 'assigned' then exists (
          select 1
          from public.clients client
          where client.id::text in (
            select item.value from jsonb_array_elements_text(coalesce(p_client_ids, '[]'::jsonb)) item
          )
            and access.staff_id is not null
            and client.responsavel_interno_id = access.staff_id
        )
        else false
      end
      from public.app_user_access access where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_access_insurance(
  p_client_id uuid,
  p_internal_responsible text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select access.active and case
        when access.access_role = 'admin' or access.data_scope = 'all' then true
        when access.data_scope = 'insurance_own' then
          nullif(trim(access.insurance_agent), '') is not null
          and lower(trim(coalesce(p_internal_responsible, ''))) = lower(trim(access.insurance_agent))
        when p_client_id is not null then public.app_can_access_client_id(p_client_id)
        else false
      end
      from public.app_user_access access where access.user_id = auth.uid()
    ), false);
$$;

create or replace function public.app_can_access_insurance_policy_id(p_policy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.insurance_policies policy
    where policy.id = p_policy_id
      and public.app_can_access_insurance(policy.client_id, policy.internal_responsible)
  );
$$;

create or replace function public.get_my_access_profile()
returns table (
  user_id uuid,
  email text,
  display_name text,
  access_role text,
  active boolean,
  module_permissions jsonb,
  data_scope text,
  staff_id uuid,
  allowed_client_ids uuid[],
  allowed_group_ids uuid[],
  insurance_agent text,
  can_view_financial boolean,
  can_view_commissions boolean,
  can_sync_wampr boolean,
  can_manage_users boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select access.user_id, users.email::text, access.display_name, access.access_role,
    access.active, access.module_permissions, access.data_scope, access.staff_id,
    access.allowed_client_ids, access.allowed_group_ids, access.insurance_agent,
    access.can_view_financial, access.can_view_commissions, access.can_sync_wampr,
    access.can_manage_users
  from public.app_user_access access
  join auth.users users on users.id = access.user_id
  where access.user_id = auth.uid();
$$;

create or replace function public.admin_list_user_access()
returns table (
  user_id uuid,
  email text,
  display_name text,
  access_role text,
  active boolean,
  module_permissions jsonb,
  data_scope text,
  staff_id uuid,
  allowed_client_ids uuid[],
  allowed_group_ids uuid[],
  insurance_agent text,
  can_view_financial boolean,
  can_view_commissions boolean,
  can_sync_wampr boolean,
  can_manage_users boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.app_can_manage_users() then
    raise exception 'Permissão de gestão de utilizadores necessária' using errcode = '42501';
  end if;

  return query
  select access.user_id, users.email::text, access.display_name, access.access_role,
    access.active, access.module_permissions, access.data_scope, access.staff_id,
    access.allowed_client_ids, access.allowed_group_ids, access.insurance_agent,
    access.can_view_financial, access.can_view_commissions, access.can_sync_wampr,
    access.can_manage_users, access.updated_at
  from public.app_user_access access
  join auth.users users on users.id = access.user_id
  order by access.access_role = 'admin' desc, lower(users.email);
end;
$$;

create or replace function public.admin_update_user_access(
  p_user_id uuid,
  p_display_name text,
  p_access_role text,
  p_active boolean,
  p_module_permissions jsonb,
  p_data_scope text,
  p_staff_id uuid,
  p_allowed_client_ids uuid[],
  p_allowed_group_ids uuid[],
  p_insurance_agent text,
  p_can_view_financial boolean,
  p_can_view_commissions boolean,
  p_can_sync_wampr boolean,
  p_can_manage_users boolean
)
returns public.app_user_access
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_before public.app_user_access;
  v_after public.app_user_access;
begin
  if not public.app_can_manage_users() then
    raise exception 'Permissão de gestão de utilizadores necessária' using errcode = '42501';
  end if;
  if p_access_role not in ('admin', 'manager', 'user', 'insurance', 'custom') then
    raise exception 'Função de acesso inválida';
  end if;
  if p_data_scope not in ('all', 'assigned', 'selected', 'insurance_own') then
    raise exception 'Âmbito de dados inválido';
  end if;
  if jsonb_typeof(p_module_permissions) <> 'object' then
    raise exception 'Permissões de módulos inválidas';
  end if;

  select * into v_before from public.app_user_access where user_id = p_user_id for update;
  if not found then
    raise exception 'Utilizador não encontrado';
  end if;

  if v_before.active and v_before.access_role = 'admin'
     and (not coalesce(p_active, false) or p_access_role <> 'admin')
     and not exists (
       select 1 from public.app_user_access other
       where other.user_id <> p_user_id and other.active and other.access_role = 'admin'
     ) then
    raise exception 'Não é possível remover ou desativar o último administrador';
  end if;

  -- Ninguém pode elevar os seus próprios privilégios: um utilizador com
  -- can_manage_users (mas sem ser admin) não pode tornar-se admin nem
  -- conceder-se a si próprio qualquer flag sensível que ainda não tinha.
  -- Só outro administrador pode fazer essa alteração.
  if p_user_id = auth.uid() then
    if p_access_role = 'admin' and v_before.access_role <> 'admin' then
      raise exception 'Não pode atribuir a si próprio a função de administrador. Peça a outro administrador.' using errcode = '42501';
    end if;
    if coalesce(p_can_manage_users, false) and not coalesce(v_before.can_manage_users, false) then
      raise exception 'Não pode conceder a si próprio a gestão de utilizadores. Peça a outro administrador.' using errcode = '42501';
    end if;
    if coalesce(p_can_view_financial, false) and not coalesce(v_before.can_view_financial, false) then
      raise exception 'Não pode conceder a si próprio o acesso a dados financeiros. Peça a outro administrador.' using errcode = '42501';
    end if;
    if coalesce(p_can_view_commissions, false) and not coalesce(v_before.can_view_commissions, false) then
      raise exception 'Não pode conceder a si próprio o acesso a comissões. Peça a outro administrador.' using errcode = '42501';
    end if;
    if coalesce(p_can_sync_wampr, false) and not coalesce(v_before.can_sync_wampr, false) then
      raise exception 'Não pode conceder a si próprio a sincronização WAMPR. Peça a outro administrador.' using errcode = '42501';
    end if;
  end if;

  update public.app_user_access
  set display_name = coalesce(trim(p_display_name), ''),
      access_role = p_access_role,
      active = coalesce(p_active, false),
      module_permissions = p_module_permissions,
      data_scope = p_data_scope,
      staff_id = p_staff_id,
      allowed_client_ids = coalesce(p_allowed_client_ids, '{}'::uuid[]),
      allowed_group_ids = coalesce(p_allowed_group_ids, '{}'::uuid[]),
      insurance_agent = nullif(trim(p_insurance_agent), ''),
      can_view_financial = coalesce(p_can_view_financial, false),
      can_view_commissions = coalesce(p_can_view_commissions, false),
      can_sync_wampr = coalesce(p_can_sync_wampr, false),
      can_manage_users = coalesce(p_can_manage_users, false),
      updated_by = auth.uid()
  where user_id = p_user_id
  returning * into v_after;

  insert into public.app_access_audit(actor_id, target_user_id, before_profile, after_profile)
  values (auth.uid(), p_user_id, to_jsonb(v_before), to_jsonb(v_after));

  return v_after;
end;
$$;

create or replace function public.handle_new_auth_user_access()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_role text;
begin
  v_role := case
    when v_email = 'mpr@mpr.pt' then 'admin'
    when v_email = 'paula.ernestina@hotmail.com' then 'insurance'
    else 'user'
  end;

  insert into public.app_user_access (
    user_id, display_name, access_role, module_permissions, data_scope, staff_id,
    insurance_agent, can_view_financial, can_view_commissions, can_sync_wampr, can_manage_users
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1)),
    v_role,
    public.app_default_module_permissions(v_role),
    case when v_role = 'insurance' then 'insurance_own' else 'all' end,
    (select staff.id from public.staff staff where lower(trim(staff.email)) = v_email limit 1),
    case when v_role = 'insurance' then 'Paula' else null end,
    v_role in ('admin', 'manager'),
    v_role = 'admin',
    v_role in ('admin', 'manager'),
    v_role = 'admin'
  ) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_add_access on auth.users;
create trigger on_auth_user_created_add_access
after insert on auth.users
for each row execute function public.handle_new_auth_user_access();

insert into public.app_user_access (
  user_id, display_name, access_role, module_permissions, data_scope, staff_id,
  insurance_agent, can_view_financial, can_view_commissions, can_sync_wampr, can_manage_users
)
select users.id,
  coalesce(users.raw_user_meta_data->>'name', split_part(users.email, '@', 1)),
  case when lower(users.email) = 'mpr@mpr.pt' then 'admin'
       when lower(users.email) = 'paula.ernestina@hotmail.com' then 'insurance'
       else 'user' end,
  public.app_default_module_permissions(
    case when lower(users.email) = 'mpr@mpr.pt' then 'admin'
         when lower(users.email) = 'paula.ernestina@hotmail.com' then 'insurance'
         else 'user' end
  ),
  case when lower(users.email) = 'paula.ernestina@hotmail.com' then 'insurance_own' else 'all' end,
  (select staff.id from public.staff staff where lower(trim(staff.email)) = lower(trim(users.email)) limit 1),
  case when lower(users.email) = 'paula.ernestina@hotmail.com' then 'Paula' else null end,
  lower(users.email) = 'mpr@mpr.pt', lower(users.email) = 'mpr@mpr.pt',
  lower(users.email) = 'mpr@mpr.pt', lower(users.email) = 'mpr@mpr.pt'
from auth.users users
on conflict (user_id) do nothing;

-- Chaves privadas nunca devem estar numa configuração legível pelo navegador.
update public.app_config
set value = value - 'resendApiKey' - 'supabaseImportKey'
where key = 'global_settings';

alter table public.app_user_access enable row level security;
alter table public.app_access_audit enable row level security;

revoke all on public.app_user_access from anon, authenticated;
revoke all on public.app_access_audit from anon, authenticated;
grant select on public.app_user_access to authenticated;
grant select on public.app_access_audit to authenticated;

create policy "Users read own access profile"
on public.app_user_access for select to authenticated
using (user_id = auth.uid() or public.app_can_manage_users());

create policy "Access managers read audit log"
on public.app_access_audit for select to authenticated
using (public.app_can_manage_users());

-- Remove as políticas permissivas anteriores das tabelas da aplicação.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'app_config','app_tasks','cash_operations','cash_payment_agreements','cash_payments',
        'cash_session_expenses','clients','email_automation_runs','email_automations',
        'email_campaign_history','email_templates','fee_groups','insurance_commission_settlements',
        'insurance_policies','quote_history','saft_dossier_data','saft_sync_queue','staff',
        'turnover_brackets','work_safety_services'
      ])
  loop
    execute format('drop policy if exists %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  end loop;
end;
$$;

-- Clientes e tabelas dependentes respeitam também o âmbito de dados.
create policy "clients_select" on public.clients for select to authenticated
using (public.app_has_permission('clients','view') and public.app_can_access_client(id, responsavel_interno_id, group_id));
create policy "clients_insert" on public.clients for insert to authenticated
with check (public.app_has_permission('clients','create') and public.app_can_access_client(id, responsavel_interno_id, group_id));
create policy "clients_update" on public.clients for update to authenticated
using (public.app_has_permission('clients','edit') and public.app_can_access_client(id, responsavel_interno_id, group_id))
with check (public.app_has_permission('clients','edit') and public.app_can_access_client(id, responsavel_interno_id, group_id));
create policy "clients_delete" on public.clients for delete to authenticated
using (public.app_has_permission('clients','delete') and public.app_can_access_client(id, responsavel_interno_id, group_id));

create policy "groups_select" on public.fee_groups for select to authenticated
using (public.app_has_permission('groups','view') and public.app_can_access_group(id, client_ids));
create policy "groups_insert" on public.fee_groups for insert to authenticated
with check (public.app_has_permission('groups','create') and public.app_can_access_group(id, client_ids));
create policy "groups_update" on public.fee_groups for update to authenticated
using (public.app_has_permission('groups','edit') and public.app_can_access_group(id, client_ids))
with check (public.app_has_permission('groups','edit') and public.app_can_access_group(id, client_ids));
create policy "groups_delete" on public.fee_groups for delete to authenticated
using (public.app_has_permission('groups','delete') and public.app_can_access_group(id, client_ids));

create policy "staff_select" on public.staff for select to authenticated
using (public.app_is_active() and (
  public.app_has_permission('team','view') or public.app_has_permission('clients','view')
  or public.app_has_permission('groups','view')
));
create policy "staff_insert" on public.staff for insert to authenticated
with check (public.app_has_permission('team','create'));
create policy "staff_update" on public.staff for update to authenticated
using (public.app_has_permission('team','edit')) with check (public.app_has_permission('team','edit'));
create policy "staff_delete" on public.staff for delete to authenticated
using (public.app_has_permission('team','delete'));

create policy "insurance_select" on public.insurance_policies for select to authenticated
using (public.app_has_permission('insurance','view') and public.app_can_access_insurance(client_id, internal_responsible));
create policy "insurance_insert" on public.insurance_policies for insert to authenticated
with check (public.app_has_permission('insurance','create') and public.app_can_access_insurance(client_id, internal_responsible));
create policy "insurance_update" on public.insurance_policies for update to authenticated
using (public.app_has_permission('insurance','edit') and public.app_can_access_insurance(client_id, internal_responsible))
with check (public.app_has_permission('insurance','edit') and public.app_can_access_insurance(client_id, internal_responsible));
create policy "insurance_delete" on public.insurance_policies for delete to authenticated
using (public.app_has_permission('insurance','delete') and public.app_can_access_insurance(client_id, internal_responsible));

create policy "commission_select" on public.insurance_commission_settlements for select to authenticated
using (public.app_has_permission('insurance','view') and public.app_can_view_commissions() and public.app_can_access_insurance_policy_id(policy_id));
create policy "commission_insert" on public.insurance_commission_settlements for insert to authenticated
with check (public.app_has_permission('insurance','edit') and public.app_can_view_commissions() and public.app_can_access_insurance_policy_id(policy_id));
create policy "commission_update" on public.insurance_commission_settlements for update to authenticated
using (public.app_has_permission('insurance','edit') and public.app_can_view_commissions() and public.app_can_access_insurance_policy_id(policy_id))
with check (public.app_has_permission('insurance','edit') and public.app_can_view_commissions() and public.app_can_access_insurance_policy_id(policy_id));
create policy "commission_delete" on public.insurance_commission_settlements for delete to authenticated
using (public.app_has_permission('insurance','delete') and public.app_can_view_commissions() and public.app_can_access_insurance_policy_id(policy_id));

create policy "sht_select" on public.work_safety_services for select to authenticated
using (public.app_has_permission('sht','view') and public.app_can_access_client_id(client_id));
create policy "sht_insert" on public.work_safety_services for insert to authenticated
with check (public.app_has_permission('sht','create') and public.app_can_access_client_id(client_id));
create policy "sht_update" on public.work_safety_services for update to authenticated
using (public.app_has_permission('sht','edit') and public.app_can_access_client_id(client_id))
with check (public.app_has_permission('sht','edit') and public.app_can_access_client_id(client_id));
create policy "sht_delete" on public.work_safety_services for delete to authenticated
using (public.app_has_permission('sht','delete') and public.app_can_access_client_id(client_id));

create policy "cash_payments_select" on public.cash_payments for select to authenticated
using (public.app_has_permission('cashier','view') and public.app_can_access_client_id(client_id));
create policy "cash_payments_insert" on public.cash_payments for insert to authenticated
with check (public.app_has_permission('cashier','create') and public.app_can_access_client_id(client_id));
create policy "cash_payments_update" on public.cash_payments for update to authenticated
using (public.app_has_permission('cashier','edit') and public.app_can_access_client_id(client_id))
with check (public.app_has_permission('cashier','edit') and public.app_can_access_client_id(client_id));
create policy "cash_payments_delete" on public.cash_payments for delete to authenticated
using (public.app_has_permission('cashier','delete') and public.app_can_access_client_id(client_id));

create policy "cash_agreements_select" on public.cash_payment_agreements for select to authenticated
using (public.app_has_permission('cashier','view') and public.app_can_access_client_id(client_id));
create policy "cash_agreements_insert" on public.cash_payment_agreements for insert to authenticated
with check (public.app_has_permission('cashier','create') and public.app_can_access_client_id(client_id));
create policy "cash_agreements_update" on public.cash_payment_agreements for update to authenticated
using (public.app_has_permission('cashier','edit') and public.app_can_access_client_id(client_id))
with check (public.app_has_permission('cashier','edit') and public.app_can_access_client_id(client_id));
create policy "cash_agreements_delete" on public.cash_payment_agreements for delete to authenticated
using (public.app_has_permission('cashier','delete') and public.app_can_access_client_id(client_id));

create policy "saft_data_select" on public.saft_dossier_data for select to authenticated
using ((public.app_has_permission('clients','view') or public.app_has_permission('irs_control','view')) and public.app_can_access_client_nif(client_nif));
create policy "saft_data_insert" on public.saft_dossier_data for insert to authenticated
with check ((public.app_has_permission('clients','edit') or public.app_has_permission('irs_control','edit')) and public.app_can_access_client_nif(client_nif));
create policy "saft_data_update" on public.saft_dossier_data for update to authenticated
using ((public.app_has_permission('clients','edit') or public.app_has_permission('irs_control','edit')) and public.app_can_access_client_nif(client_nif))
with check ((public.app_has_permission('clients','edit') or public.app_has_permission('irs_control','edit')) and public.app_can_access_client_nif(client_nif));
create policy "saft_data_delete" on public.saft_dossier_data for delete to authenticated
using ((public.app_has_permission('clients','delete') or public.app_has_permission('irs_control','delete')) and public.app_can_access_client_nif(client_nif));

create policy "saft_queue_select" on public.saft_sync_queue for select to authenticated
using ((public.app_has_permission('clients','view') or public.app_has_permission('irs_control','view')) and public.app_can_access_client_nif(client_nif));
create policy "saft_queue_insert" on public.saft_sync_queue for insert to authenticated
with check ((public.app_has_permission('clients','edit') or public.app_has_permission('irs_control','edit')) and public.app_can_access_client_nif(client_nif));
create policy "saft_queue_update" on public.saft_sync_queue for update to authenticated
using ((public.app_has_permission('clients','edit') or public.app_has_permission('irs_control','edit')) and public.app_can_access_client_nif(client_nif))
with check ((public.app_has_permission('clients','edit') or public.app_has_permission('irs_control','edit')) and public.app_can_access_client_nif(client_nif));
create policy "saft_queue_delete" on public.saft_sync_queue for delete to authenticated
using ((public.app_has_permission('clients','delete') or public.app_has_permission('irs_control','delete')) and public.app_can_access_client_nif(client_nif));

-- Tabelas sem âmbito por cliente: o módulo e a ação são verificados diretamente.
do $$
declare
  item record;
  action_name text;
begin
  for item in
    select * from (values
      ('app_tasks','tasks'),
      ('cash_operations','cashier'),
      ('cash_session_expenses','cashier'),
      ('email_automation_runs','emails'),
      ('email_automations','emails'),
      ('email_campaign_history','emails'),
      ('email_templates','emails'),
      ('quote_history','calculator'),
      ('turnover_brackets','calculator')
    ) mapping(table_name, module_name)
  loop
    foreach action_name in array array['select','insert','update','delete'] loop
      execute format(
        'create policy %I on public.%I for %s to authenticated %s',
        item.table_name || '_' || action_name,
        item.table_name,
        action_name,
        case
          when action_name = 'select' then format('using (public.app_has_permission(%L,%L))', item.module_name, 'view')
          when action_name = 'insert' then format('with check (public.app_has_permission(%L,%L))', item.module_name, 'create')
          when action_name = 'update' then format('using (public.app_has_permission(%L,%L)) with check (public.app_has_permission(%L,%L))', item.module_name, 'edit', item.module_name, 'edit')
          else format('using (public.app_has_permission(%L,%L))', item.module_name, 'delete')
        end
      );
    end loop;
  end loop;
end;
$$;

-- Configuração global é legível por utilizadores ativos; apenas configurações/IRS podem escrevê-la.
create policy "app_config_select" on public.app_config for select to authenticated
using (public.app_is_active() and (
  key = 'global_settings'
  or (key in ('cashier_irs_control_v1','irs_manual_relations_v1') and public.app_has_permission('irs_control','view'))
  or public.app_has_permission('settings','view')
));
create policy "app_config_insert" on public.app_config for insert to authenticated
with check (
  (key = 'global_settings' and public.app_has_permission('settings','edit'))
  or (key in ('cashier_irs_control_v1','irs_manual_relations_v1') and public.app_has_permission('irs_control','edit'))
);
create policy "app_config_update" on public.app_config for update to authenticated
using (
  (key = 'global_settings' and public.app_has_permission('settings','edit'))
  or (key in ('cashier_irs_control_v1','irs_manual_relations_v1') and public.app_has_permission('irs_control','edit'))
)
with check (
  (key = 'global_settings' and public.app_has_permission('settings','edit'))
  or (key in ('cashier_irs_control_v1','irs_manual_relations_v1') and public.app_has_permission('irs_control','edit'))
);
create policy "app_config_delete" on public.app_config for delete to authenticated
using (public.app_has_permission('settings','delete'));

-- Protege RPCs SECURITY DEFINER que, de outra forma, contornariam RLS.
create or replace function public.bulk_upsert_cash_payments(payments_data jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.app_has_permission('cashier','edit') then raise exception 'Permissão negada' using errcode='42501'; end if;
  if payments_data is null or jsonb_typeof(payments_data) <> 'array' then raise exception 'payments_data must be a JSON array'; end if;
  insert into public.cash_payments (id, client_id, payment_year, payment_month, amount_paid, paid_at, payment_method)
  select coalesce(payment.id, gen_random_uuid()), payment.client_id, payment.payment_year, payment.payment_month,
    coalesce(payment.amount_paid, 0), coalesce(payment.paid_at, now()), coalesce(nullif(payment.payment_method, ''), 'Numerário')
  from jsonb_to_recordset(payments_data) as payment(id uuid, client_id uuid, payment_year integer, payment_month integer, amount_paid numeric, paid_at timestamptz, payment_method text)
  where public.app_can_access_client_id(payment.client_id)
  on conflict (client_id, payment_year, payment_month) do update
  set amount_paid=excluded.amount_paid, paid_at=excluded.paid_at, payment_method=excluded.payment_method;
end; $$;

create or replace function public.create_cash_operation(p_deposited_amount numeric, p_spent_amount numeric, p_spent_description text, p_report_details jsonb, p_payment_ids uuid[], p_mbway_deposited_amount numeric default 0, p_adjustment_amount numeric default 0)
returns public.cash_operations language plpgsql security definer set search_path = public, pg_temp as $$
declare operation public.cash_operations;
begin
  if not public.app_has_permission('cashier','create') then raise exception 'Permissão negada' using errcode='42501'; end if;
  insert into public.cash_operations(deposited_amount,spent_amount,spent_description,report_details,mbway_deposited_amount,adjustment_amount)
  values(coalesce(p_deposited_amount,0),coalesce(p_spent_amount,0),coalesce(p_spent_description,''),coalesce(p_report_details,'[]'::jsonb),coalesce(p_mbway_deposited_amount,0),coalesce(p_adjustment_amount,0)) returning * into operation;
  update public.cash_payments set cash_operation_id=operation.id
  where id=any(coalesce(p_payment_ids,'{}'::uuid[])) and cash_operation_id is null
    and public.app_can_access_client_id(client_id);
  return operation;
end; $$;

create or replace function public.close_cash_register_atomic(p_deposited_amount numeric, p_spent_amount numeric, p_spent_description text, p_report_details jsonb, p_payment_ids uuid[], p_mbway_deposited_amount numeric default 0, p_adjustment_amount numeric default 0, p_session_expense_ids uuid[] default '{}'::uuid[])
returns public.cash_operations language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation public.cash_operations;
begin
  if not public.app_has_permission('cashier','create') then raise exception 'Permissão negada' using errcode='42501'; end if;
  select * into v_operation from public.create_cash_operation(p_deposited_amount,p_spent_amount,p_spent_description,p_report_details,p_payment_ids,p_mbway_deposited_amount,p_adjustment_amount);
  if coalesce(array_length(p_session_expense_ids,1),0)>0 then
    update public.cash_session_expenses set cash_operation_id=v_operation.id where id=any(p_session_expense_ids) and cash_operation_id is null;
  end if;
  return v_operation;
end; $$;

create or replace function public.update_group_proposed_fees(group_id uuid, fees_payload jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.app_has_permission('groups','edit') then raise exception 'Permissão negada' using errcode='42501'; end if;
  update public.fee_groups set proposed_fees=coalesce(fees_payload,'{}'::jsonb)
  where id=group_id and public.app_can_access_group(id,client_ids);
end; $$;

-- As funções maiores mantêm o corpo histórico, mas são bloqueadas para quem não tem a ação necessária.
create or replace function public.save_global_settings_if_match(p_value jsonb, p_expected_updated_at timestamptz default null)
returns table(conflict boolean, value jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_current_value jsonb; v_current_updated_at timestamptz;
begin
  if not public.app_has_permission('settings','edit') then raise exception 'Permissão negada' using errcode='42501'; end if;
  select ac.value,ac.updated_at into v_current_value,v_current_updated_at from public.app_config ac where ac.key='global_settings' for update;
  if not found then
    insert into public.app_config(key,value) values('global_settings',p_value)
    returning app_config.value,app_config.updated_at into v_current_value,v_current_updated_at;
    return query select false,v_current_value,v_current_updated_at; return;
  end if;
  if p_expected_updated_at is not null and v_current_updated_at is distinct from p_expected_updated_at then
    return query select true,v_current_value,v_current_updated_at; return;
  end if;
  update public.app_config set value=p_value where key='global_settings'
  returning app_config.value,app_config.updated_at into v_current_value,v_current_updated_at;
  return query select false,v_current_value,v_current_updated_at;
end; $$;

-- Restringe as funções legadas de importação: a sincronização normal usa apenas service_role.
revoke execute on function public.sync_imported_staff_and_clients_atomic(jsonb,jsonb) from public, anon, authenticated;
alter function public.bulk_upsert_clients_jsonb(jsonb) security invoker;
alter function public.replace_app_tasks_if_version(jsonb,timestamptz) security invoker;
revoke execute on function public.bulk_upsert_clients_jsonb(jsonb) from public, anon;
revoke execute on function public.replace_app_tasks_if_version(jsonb,timestamptz) from public, anon;

-- Mantém permissões dos RPCs usados pela aplicação; cada corpo/linha é validado por RLS ou helper.
grant execute on function public.app_has_permission(text,text) to authenticated, service_role;
grant execute on function public.app_can_view_financial() to authenticated, service_role;
grant execute on function public.app_can_view_commissions() to authenticated, service_role;
grant execute on function public.app_can_sync_wampr() to authenticated, service_role;
grant execute on function public.get_my_access_profile() to authenticated;
grant execute on function public.admin_list_user_access() to authenticated;
grant execute on function public.admin_update_user_access(uuid,text,text,boolean,jsonb,text,uuid,uuid[],uuid[],text,boolean,boolean,boolean,boolean) to authenticated;

revoke all on function public.app_default_module_permissions(text) from public;
revoke all on function public.app_is_service_role() from public;
revoke all on function public.app_is_active() from public;
revoke all on function public.app_can_manage_users() from public;
revoke all on function public.app_can_access_client(uuid,uuid,uuid) from public;
revoke all on function public.app_can_access_client_id(uuid) from public;
revoke all on function public.app_can_access_client_nif(text) from public;
revoke all on function public.app_can_access_group(uuid,jsonb) from public;
revoke all on function public.app_can_access_insurance(uuid,text) from public;
revoke all on function public.app_can_access_insurance_policy_id(uuid) from public;
revoke all on function public.handle_new_auth_user_access() from public;
revoke all on function public.get_my_access_profile() from public, anon;
revoke all on function public.admin_list_user_access() from public, anon;
revoke all on function public.admin_update_user_access(uuid,text,text,boolean,jsonb,text,uuid,uuid[],uuid[],text,boolean,boolean,boolean,boolean) from public, anon;

grant execute on function public.app_is_active() to authenticated, service_role;
grant execute on function public.app_can_manage_users() to authenticated, service_role;
grant execute on function public.app_can_access_client(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function public.app_can_access_client_id(uuid) to authenticated, service_role;
grant execute on function public.app_can_access_client_nif(text) to authenticated, service_role;
grant execute on function public.app_can_access_group(uuid,jsonb) to authenticated, service_role;
grant execute on function public.app_can_access_insurance(uuid,text) to authenticated, service_role;
grant execute on function public.app_can_access_insurance_policy_id(uuid) to authenticated, service_role;
grant execute on function public.get_my_access_profile() to authenticated;
grant execute on function public.admin_list_user_access() to authenticated;
grant execute on function public.admin_update_user_access(uuid,text,text,boolean,jsonb,text,uuid,uuid[],uuid[],text,boolean,boolean,boolean,boolean) to authenticated;
