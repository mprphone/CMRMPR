-- Mantém documentos privados e expõe publicamente apenas ativos visuais não sensíveis.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-assets',
  'public-assets',
  true,
  5242880,
  array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set public = false
where id = 'attachments';

create or replace function public.app_storage_path_uuid(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_segment text := split_part(coalesce(p_name, ''), '/', 2);
begin
  if v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_segment::uuid;
end;
$$;

create or replace function public.app_can_access_sht_service_id(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.work_safety_services service
    where service.id = p_service_id
      and public.app_can_access_client_id(service.client_id)
  );
$$;

revoke all on function public.app_storage_path_uuid(text) from public;
revoke all on function public.app_can_access_sht_service_id(uuid) from public;
grant execute on function public.app_storage_path_uuid(text) to authenticated, service_role;
grant execute on function public.app_can_access_sht_service_id(uuid) to authenticated, service_role;

drop policy if exists "Authenticated users can manage attachments bucket" on storage.objects;
drop policy if exists "cmr_storage_select" on storage.objects;
drop policy if exists "cmr_storage_insert" on storage.objects;
drop policy if exists "cmr_storage_update" on storage.objects;
drop policy if exists "cmr_storage_delete" on storage.objects;

create policy "cmr_storage_select"
on storage.objects for select to authenticated
using (
  (bucket_id = 'public-assets' and public.app_is_active())
  or (
    bucket_id = 'attachments'
    and public.app_is_active()
    and case
      when name like 'policies/%' then
        public.app_has_permission('insurance', 'view')
        and public.app_can_access_insurance_policy_id(public.app_storage_path_uuid(name))
      when name like 'sht/%' then
        public.app_has_permission('sht', 'view')
        and public.app_can_access_sht_service_id(public.app_storage_path_uuid(name))
      when name like 'saft-dossier/%' then
        (public.app_has_permission('clients', 'view') or public.app_has_permission('irs_control', 'view'))
        and public.app_can_access_client_nif(split_part(name, '/', 2))
      else false
    end
  )
);

create policy "cmr_storage_insert"
on storage.objects for insert to authenticated
with check (
  (bucket_id = 'public-assets' and name = 'branding/app-logo' and public.app_has_permission('settings', 'edit'))
  or (bucket_id = 'attachments' and name like 'policies/%' and public.app_has_permission('insurance', 'create'))
  or (bucket_id = 'attachments' and name like 'sht/%' and public.app_has_permission('sht', 'create'))
);

create policy "cmr_storage_update"
on storage.objects for update to authenticated
using (
  (bucket_id = 'public-assets' and name = 'branding/app-logo' and public.app_has_permission('settings', 'edit'))
  or (
    bucket_id = 'attachments'
    and case
      when name like 'policies/%' then
        public.app_has_permission('insurance', 'edit')
        and public.app_can_access_insurance_policy_id(public.app_storage_path_uuid(name))
      when name like 'sht/%' then
        public.app_has_permission('sht', 'edit')
        and public.app_can_access_sht_service_id(public.app_storage_path_uuid(name))
      else false
    end
  )
)
with check (
  (bucket_id = 'public-assets' and name = 'branding/app-logo' and public.app_has_permission('settings', 'edit'))
  or (bucket_id = 'attachments' and name like 'policies/%' and public.app_has_permission('insurance', 'edit'))
  or (bucket_id = 'attachments' and name like 'sht/%' and public.app_has_permission('sht', 'edit'))
);

create policy "cmr_storage_delete"
on storage.objects for delete to authenticated
using (
  (bucket_id = 'public-assets' and name = 'branding/app-logo' and public.app_has_permission('settings', 'delete'))
  or (
    bucket_id = 'attachments'
    and case
      when name like 'policies/%' then
        public.app_has_permission('insurance', 'delete')
        and public.app_can_access_insurance_policy_id(public.app_storage_path_uuid(name))
      when name like 'sht/%' then
        public.app_has_permission('sht', 'delete')
        and public.app_can_access_sht_service_id(public.app_storage_path_uuid(name))
      else false
    end
  )
);
