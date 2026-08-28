-- Quando um utilizador ativa MFA, todos os acessos ao CMR passam a exigir AAL2.

create or replace function public.app_mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select public.app_is_service_role()
    or (
      auth.uid() is not null
      and (
        not exists (
          select 1
          from auth.mfa_factors factor
          where factor.user_id = auth.uid()
            and factor.status = 'verified'
        )
        or coalesce(
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal') = 'aal2',
          false
        )
      )
    );
$$;

revoke all on function public.app_mfa_satisfied() from public;
grant execute on function public.app_mfa_satisfied() to authenticated, service_role;

create or replace function public.app_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or (
      public.app_mfa_satisfied()
      and exists (
        select 1 from public.app_user_access access
        where access.user_id = auth.uid() and access.active
      )
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
    or (
      public.app_mfa_satisfied()
      and coalesce((
        select access.active and (
          access.access_role = 'admin'
          or coalesce((access.module_permissions -> p_module ->> p_action)::boolean, false)
        )
        from public.app_user_access access
        where access.user_id = auth.uid()
      ), false)
    );
$$;

create or replace function public.app_can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or (
      public.app_mfa_satisfied()
      and coalesce((
        select access.active and (access.access_role = 'admin' or access.can_manage_users)
        from public.app_user_access access where access.user_id = auth.uid()
      ), false)
    );
$$;

create or replace function public.app_can_view_financial()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or (
      public.app_mfa_satisfied()
      and coalesce((
        select access.active and (access.access_role = 'admin' or access.can_view_financial)
        from public.app_user_access access where access.user_id = auth.uid()
      ), false)
    );
$$;

create or replace function public.app_can_view_commissions()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or (
      public.app_mfa_satisfied()
      and coalesce((
        select access.active and (access.access_role = 'admin' or access.can_view_commissions)
        from public.app_user_access access where access.user_id = auth.uid()
      ), false)
    );
$$;

create or replace function public.app_can_sync_wampr()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or (
      public.app_mfa_satisfied()
      and coalesce((
        select access.active and (access.access_role = 'admin' or access.can_sync_wampr)
        from public.app_user_access access where access.user_id = auth.uid()
      ), false)
    );
$$;

-- Políticas restritivas somam-se às políticas funcionais já existentes.
-- Assim, nem uma política permissiva esquecida consegue contornar MFA.
do $mfa_policies$
declare
  v_table record;
begin
  for v_table in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists "mfa_verified_access" on public.%I', v_table.relname);
    execute format(
      'create policy "mfa_verified_access" on public.%I as restrictive for all to authenticated using (public.app_mfa_satisfied()) with check (public.app_mfa_satisfied())',
      v_table.relname
    );
  end loop;
end;
$mfa_policies$;

