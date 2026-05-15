create or replace function public.sync_imported_staff_and_clients_atomic(
  staff_data jsonb,
  clients_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if staff_data is not null and jsonb_typeof(staff_data) = 'array' then
    insert into public.staff (
      id,
      name,
      email,
      phone,
      role
    )
    select
      (item->>'id')::uuid,
      coalesce(nullif(item->>'name', ''), 'Sem Nome'),
      coalesce(item->>'email', ''),
      coalesce(item->>'phone', ''),
      coalesce(nullif(item->>'role', ''), 'Colaborador')
    from jsonb_array_elements(staff_data) as item
    where coalesce(item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    on conflict (id) do update
    set
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      role = excluded.role;
  end if;

  perform public.bulk_upsert_clients_jsonb(clients_data);
end;
$$;

grant execute on function public.sync_imported_staff_and_clients_atomic(jsonb, jsonb)
to anon, authenticated, service_role;
