create or replace function public.bulk_upsert_clients_jsonb(clients_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if clients_data is null or jsonb_typeof(clients_data) <> 'array' then
    return;
  end if;

  with payload as (
    select
      nullif(trim(item->>'nif'), '') as nif,
      coalesce(nullif(trim(item->>'name'), ''), 'Sem Nome') as name,
      coalesce(item->>'email', '') as email,
      coalesce(item->>'phone', '') as phone,
      coalesce(item->>'address', '') as address,
      coalesce(nullif(item->>'entity_type', ''), 'SOCIEDADE') as entity_type,
      coalesce(nullif(item->>'sector', ''), 'Geral') as sector,
      coalesce(nullif(item->>'status', ''), 'Ativo') as status,
      case
        when coalesce(item->>'responsavel_interno_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (item->>'responsavel_interno_id')::uuid
        else null
      end as responsavel_interno_id,
      coalesce(nullif(item->>'responsavel_action', ''), 'keep') as responsavel_action
    from jsonb_array_elements(clients_data) as item
  ),
  dedup as (
    select distinct on (nif)
      nif,
      name,
      email,
      phone,
      address,
      entity_type,
      sector,
      status,
      responsavel_interno_id,
      responsavel_action
    from payload
    where nif is not null
    order by nif
  ),
  resolved as (
    select
      d.nif,
      d.name,
      d.email,
      d.phone,
      d.address,
      d.entity_type,
      d.sector,
      d.status,
      case
        when d.responsavel_action = 'set' then d.responsavel_interno_id
        when d.responsavel_action = 'clear' then null
        else c.responsavel_interno_id
      end as responsavel_interno_id
    from dedup d
    left join public.clients c on c.nif = d.nif
  )
  insert into public.clients (
    nif,
    name,
    email,
    phone,
    address,
    entity_type,
    sector,
    status,
    responsavel_interno_id
  )
  select
    nif,
    name,
    email,
    phone,
    address,
    entity_type,
    sector,
    status,
    responsavel_interno_id
  from resolved
  on conflict (nif) do update
  set
    name = excluded.name,
    email = excluded.email,
    phone = excluded.phone,
    address = excluded.address,
    entity_type = excluded.entity_type,
    sector = excluded.sector,
    status = excluded.status,
    responsavel_interno_id = excluded.responsavel_interno_id;
end;
$$;

grant execute on function public.bulk_upsert_clients_jsonb(jsonb) to anon, authenticated, service_role;
