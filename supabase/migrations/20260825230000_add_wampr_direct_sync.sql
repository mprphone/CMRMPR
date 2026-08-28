alter table public.clients
  add column if not exists wampr_source_id text,
  add column if not exists wampr_upstream_source_id text,
  add column if not exists wampr_updated_at timestamptz,
  add column if not exists wampr_synced_at timestamptz;

alter table public.staff
  add column if not exists wampr_source_id text,
  add column if not exists wampr_updated_at timestamptz,
  add column if not exists wampr_synced_at timestamptz;

create unique index if not exists idx_clients_wampr_source_id
  on public.clients (wampr_source_id);

create unique index if not exists idx_staff_wampr_source_id
  on public.staff (wampr_source_id);

create table if not exists public.wampr_sync_runs (
  snapshot_id text primary key,
  generated_at timestamptz,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  clients_count integer not null default 0,
  staff_count integer not null default 0,
  status text not null default 'running',
  error text,
  constraint wampr_sync_runs_status_check check (status in ('running', 'success', 'error'))
);

alter table public.wampr_sync_runs enable row level security;
revoke all on table public.wampr_sync_runs from anon, authenticated;
grant all on table public.wampr_sync_runs to service_role;

-- Chamada como um pedido RPC separado, ANTES de sync_wampr_snapshot: o
-- PostgREST executa cada RPC na sua própria transação, pelo que este registo
-- 'running' fica realmente confirmado (committed) antes de a sincronização
-- em si começar. Sem isto, uma falha a meio de sync_wampr_snapshot desfazia
-- (rollback) também este registo inicial, e a corrida falhada desaparecia
-- por completo de wampr_sync_runs em vez de ficar marcada como 'error'.
create or replace function public.wampr_sync_begin(
  sync_snapshot_id text,
  snapshot_generated_at timestamptz default null,
  p_clients_count integer default 0,
  p_staff_count integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot_id text := nullif(trim(sync_snapshot_id), '');
begin
  if v_snapshot_id is null then
    raise exception 'snapshot_id obrigatório';
  end if;

  insert into public.wampr_sync_runs (
    snapshot_id, generated_at, received_at, clients_count, staff_count, status, error
  ) values (
    v_snapshot_id,
    snapshot_generated_at,
    now(),
    coalesce(p_clients_count, 0),
    coalesce(p_staff_count, 0),
    'running',
    null
  )
  on conflict (snapshot_id) do update
  set generated_at = excluded.generated_at,
      received_at = now(),
      clients_count = excluded.clients_count,
      staff_count = excluded.staff_count,
      status = 'running',
      error = null;
end;
$$;

revoke all on function public.wampr_sync_begin(text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.wampr_sync_begin(text, timestamptz, integer, integer) to service_role;

create or replace function public.sync_wampr_snapshot(
  clients_data jsonb,
  staff_data jsonb,
  sync_snapshot_id text,
  snapshot_generated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot_id text := nullif(trim(sync_snapshot_id), '');
  v_clients_count integer := 0;
  v_staff_count integer := 0;
begin
  if v_snapshot_id is null then
    raise exception 'snapshot_id obrigatório';
  end if;
  if clients_data is null or jsonb_typeof(clients_data) <> 'array' then
    raise exception 'clients_data deve ser um array';
  end if;
  if staff_data is null or jsonb_typeof(staff_data) <> 'array' then
    raise exception 'staff_data deve ser um array';
  end if;
  if jsonb_array_length(clients_data) > 5000 or jsonb_array_length(staff_data) > 1000 then
    raise exception 'snapshot excede o limite permitido';
  end if;

  -- Normalmente já existe (criado por wampr_sync_begin numa transação
  -- própria, já confirmada). Este insert é apenas uma rede de segurança para
  -- uma chamada direta sem wampr_sync_begin — nesse caso "on conflict do
  -- nothing" evita reiniciar contagens/estado se, por algum motivo, já
  -- existir um registo.
  insert into public.wampr_sync_runs (
    snapshot_id, generated_at, received_at, clients_count, staff_count, status, error
  ) values (
    v_snapshot_id,
    snapshot_generated_at,
    now(),
    jsonb_array_length(clients_data),
    jsonb_array_length(staff_data),
    'running',
    null
  )
  on conflict (snapshot_id) do nothing;

  with raw_payload as (
    select distinct on (nullif(trim(item->>'sourceId'), ''))
      (item->>'id')::uuid as id,
      nullif(trim(item->>'sourceId'), '') as source_id,
      -- Nomes/roles vazios ficam NULL aqui (em vez de já cair para um
      -- valor por omissão), para que o registo existente não seja
      -- substituído por um valor genérico quando o WAMPR envia um campo
      -- vazio (ver "payload" abaixo, que só recorre ao omissão para um
      -- colaborador novo sem correspondência prévia).
      nullif(trim(item->>'name'), '') as name,
      coalesce(trim(item->>'email'), '') as email,
      coalesce(trim(item->>'phone'), '') as phone,
      nullif(trim(item->>'role'), '') as role,
      case
        when coalesce(item->>'updatedAt', '') ~ '^\d{4}-\d{2}-\d{2}' then (item->>'updatedAt')::timestamptz
        else null
      end as updated_at
    from jsonb_array_elements(staff_data) as item
    where coalesce(item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and nullif(trim(item->>'sourceId'), '') is not null
    order by nullif(trim(item->>'sourceId'), ''), lower(trim(item->>'email'))
  ), targeted_payload as (
    select
      coalesce(
        (select existing.id from public.staff existing where existing.wampr_source_id = raw.source_id limit 1),
        (select existing.id from public.staff existing where raw.email <> '' and lower(trim(existing.email)) = lower(raw.email) order by existing.id limit 1),
        raw.id
      ) as id,
      raw.source_id,
      raw.name,
      raw.email,
      raw.phone,
      raw.role,
      raw.updated_at
    from raw_payload raw
  ), payload as (
    select distinct on (tp.id)
      tp.id,
      tp.source_id,
      coalesce(tp.name, existing.name, 'Sem Nome') as name,
      tp.email,
      tp.phone,
      coalesce(tp.role, existing.role, 'Colaborador') as role,
      tp.updated_at
    from targeted_payload tp
    left join public.staff existing on existing.id = tp.id
    order by tp.id, tp.source_id
  )
  insert into public.staff (
    id, wampr_source_id, name, email, phone, role, wampr_updated_at, wampr_synced_at
  )
  select id, source_id, name, email, phone, role, updated_at, now()
  from payload
  on conflict (id) do update
  set wampr_source_id = excluded.wampr_source_id,
      name = excluded.name,
      email = coalesce(nullif(excluded.email, ''), public.staff.email),
      phone = coalesce(nullif(excluded.phone, ''), public.staff.phone),
      role = excluded.role,
      wampr_updated_at = excluded.wampr_updated_at,
      wampr_synced_at = now();

  get diagnostics v_staff_count = row_count;

  with payload as (
    select distinct on (nullif(regexp_replace(item->>'nif', '[^0-9]', '', 'g'), ''))
      nullif(trim(item->>'sourceId'), '') as source_id,
      nullif(trim(item->>'upstreamSourceId'), '') as upstream_source_id,
      nullif(regexp_replace(item->>'nif', '[^0-9]', '', 'g'), '') as nif,
      -- Nome e tipo de entidade vazios ficam NULL aqui (ver "resolved"
      -- abaixo): um snapshot com estes campos em falta não deve substituir
      -- um valor válido já existente para o mesmo NIF.
      nullif(trim(item->>'name'), '') as name,
      coalesce(trim(item->>'email'), '') as email,
      coalesce(trim(item->>'phone'), '') as phone,
      coalesce(trim(item->>'address'), '') as address,
      nullif(trim(item->>'entityType'), '') as entity_type,
      nullif(trim(item->>'status'), '') as status,
      nullif(trim(item->>'responsibleSourceId'), '') as responsible_source_id,
      case
        when coalesce(item->>'updatedAt', '') ~ '^\d{4}-\d{2}-\d{2}' then (item->>'updatedAt')::timestamptz
        else null
      end as updated_at
    from jsonb_array_elements(clients_data) as item
    where nullif(trim(item->>'sourceId'), '') is not null
      and regexp_replace(coalesce(item->>'nif', ''), '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
    order by nullif(regexp_replace(item->>'nif', '[^0-9]', '', 'g'), ''), nullif(trim(item->>'sourceId'), '')
  ), resolved as (
    select
      p.nif,
      p.source_id,
      p.upstream_source_id,
      coalesce(p.name, c.name, 'Sem Nome') as name,
      p.email,
      p.phone,
      p.address,
      coalesce(p.entity_type, c.entity_type, 'SOCIEDADE') as entity_type,
      p.status,
      p.responsible_source_id,
      p.updated_at,
      s.id as responsible_staff_id,
      c.id as existing_client_id,
      c.status as existing_status
    from payload p
    left join public.staff s on s.wampr_source_id = p.responsible_source_id
    left join public.clients c on c.nif = p.nif
  )
  insert into public.clients (
    nif,
    wampr_source_id,
    wampr_upstream_source_id,
    name,
    email,
    phone,
    address,
    entity_type,
    status,
    responsavel_interno_id,
    wampr_updated_at,
    wampr_synced_at
  )
  select
    nif,
    source_id,
    upstream_source_id,
    name,
    email,
    phone,
    address,
    entity_type,
    coalesce(status, existing_status, 'Ativo'),
    responsible_staff_id,
    updated_at,
    now()
  from resolved
  on conflict (nif) do update
  set wampr_source_id = excluded.wampr_source_id,
      wampr_upstream_source_id = excluded.wampr_upstream_source_id,
      name = excluded.name,
      email = coalesce(nullif(excluded.email, ''), public.clients.email),
      phone = coalesce(nullif(excluded.phone, ''), public.clients.phone),
      address = coalesce(nullif(excluded.address, ''), public.clients.address),
      entity_type = excluded.entity_type,
      status = coalesce(excluded.status, public.clients.status),
      responsavel_interno_id = coalesce(excluded.responsavel_interno_id, public.clients.responsavel_interno_id),
      wampr_updated_at = excluded.wampr_updated_at,
      wampr_synced_at = now();

  get diagnostics v_clients_count = row_count;

  update public.wampr_sync_runs
  set completed_at = now(),
      clients_count = v_clients_count,
      staff_count = v_staff_count,
      status = 'success',
      error = null
  where snapshot_id = v_snapshot_id;

  return jsonb_build_object(
    'snapshotId', v_snapshot_id,
    'clients', v_clients_count,
    'staff', v_staff_count
  );
exception
  when others then
    update public.wampr_sync_runs
    set completed_at = now(), status = 'error', error = left(sqlerrm, 1000)
    where snapshot_id = v_snapshot_id;
    raise;
end;
$$;

revoke all on function public.sync_wampr_snapshot(jsonb, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_wampr_snapshot(jsonb, jsonb, text, timestamptz) to service_role;
