-- Espelho local da dívida acumulada real do Primavera (Pendentes.ValorPendente
-- por NIF), alimentado por um sincronizador periódico no pri.mpr.pt em vez de
-- o CMR ir buscar os dados ao vivo a cada clique. Segue exatamente o mesmo
-- padrão já usado pela sincronização WAMPR -> CMR (ver
-- 20260825230000_add_wampr_direct_sync.sql: tabela de runs + begin/apply
-- security definer, grants só para service_role).

create table if not exists public.primavera_sync_runs (
  run_id text primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  balances_count integer not null default 0,
  status text not null default 'running',
  error text,
  constraint primavera_sync_runs_status_check check (status in ('running', 'success', 'error'))
);

alter table public.primavera_sync_runs enable row level security;
revoke all on table public.primavera_sync_runs from anon, authenticated;
grant all on table public.primavera_sync_runs to service_role;

create table if not exists public.primavera_pending_balances (
  nif text primary key,
  tipo_entidade text,
  modulo text,
  entidade text,
  total_pendente numeric not null default 0,
  num_documentos integer not null default 0,
  data_venc_mais_antiga date,
  synced_at timestamptz not null default now()
);

alter table public.primavera_pending_balances enable row level security;
revoke all on table public.primavera_pending_balances from anon, authenticated;
grant all on table public.primavera_pending_balances to service_role;

-- Chamado ANTES do ciclo ir buscar dados ao Primavera (pedido HTTP
-- separado, tal como wampr_sync_begin) — assim um ciclo "running" fica
-- realmente confirmado mesmo que a consulta ao Primavera falhe a seguir e
-- nunca chegue a sync_primavera_pending_balances.
create or replace function public.primavera_sync_begin(p_run_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id text := nullif(trim(p_run_id), '');
begin
  if v_run_id is null then
    raise exception 'run_id obrigatório';
  end if;

  insert into public.primavera_sync_runs (run_id, started_at, status, error)
  values (v_run_id, now(), 'running', null)
  on conflict (run_id) do update
  set started_at = now(), status = 'running', error = null;
end;
$$;

revoke all on function public.primavera_sync_begin(text) from public, anon, authenticated;
grant execute on function public.primavera_sync_begin(text) to service_role;

-- Usado quando a própria consulta ao Primavera falha (extensão desligada,
-- SQL Server inacessível) — sync_primavera_pending_balances nunca chega a
-- correr nesse caso, por isso precisa de uma forma explícita de marcar o
-- run como erro em vez de ficar "running" para sempre.
create or replace function public.primavera_sync_fail(p_run_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id text := nullif(trim(p_run_id), '');
begin
  if v_run_id is null then
    raise exception 'run_id obrigatório';
  end if;

  update public.primavera_sync_runs
  set completed_at = now(), status = 'error', error = left(coalesce(p_error, ''), 1000)
  where run_id = v_run_id;
end;
$$;

revoke all on function public.primavera_sync_fail(text, text) from public, anon, authenticated;
grant execute on function public.primavera_sync_fail(text, text) to service_role;

-- Substitui sempre o conteúdo completo do espelho pelo estado atual: cada
-- ciclo envia o saldo pendente *atual* (não um delta), por isso um NIF que
-- deixou de aparecer (dívida liquidada) tem de ser removido, não deixado
-- como um valor antigo esquecido.
create or replace function public.sync_primavera_pending_balances(
  p_run_id text,
  p_balances jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id text := nullif(trim(p_run_id), '');
  v_count integer := 0;
begin
  if v_run_id is null then
    raise exception 'run_id obrigatório';
  end if;
  if p_balances is null or jsonb_typeof(p_balances) <> 'array' then
    raise exception 'p_balances deve ser um array';
  end if;
  if jsonb_array_length(p_balances) > 5000 then
    raise exception 'p_balances excede o limite permitido';
  end if;

  insert into public.primavera_sync_runs (run_id, started_at, status, error)
  values (v_run_id, now(), 'running', null)
  on conflict (run_id) do nothing;

  with payload as (
    select
      regexp_replace(item->>'nif', '[^0-9]', '', 'g') as nif
    from jsonb_array_elements(p_balances) as item
    where regexp_replace(coalesce(item->>'nif', ''), '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
  )
  delete from public.primavera_pending_balances existing
  where not exists (select 1 from payload p where p.nif = existing.nif);

  insert into public.primavera_pending_balances (
    nif, tipo_entidade, modulo, entidade, total_pendente, num_documentos, data_venc_mais_antiga, synced_at
  )
  select
    regexp_replace(item->>'nif', '[^0-9]', '', 'g') as nif,
    nullif(trim(item->>'tipoEntidade'), '') as tipo_entidade,
    nullif(trim(item->>'modulo'), '') as modulo,
    nullif(trim(item->>'entidade'), '') as entidade,
    coalesce((item->>'totalPendente')::numeric, 0) as total_pendente,
    coalesce((item->>'numDocumentos')::integer, 0) as num_documentos,
    case
      when coalesce(item->>'dataVencMaisAntiga', '') ~ '^\d{4}-\d{2}-\d{2}' then (item->>'dataVencMaisAntiga')::date
      else null
    end as data_venc_mais_antiga,
    now()
  from jsonb_array_elements(p_balances) as item
  where regexp_replace(coalesce(item->>'nif', ''), '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
  on conflict (nif) do update
  set tipo_entidade = excluded.tipo_entidade,
      modulo = excluded.modulo,
      entidade = excluded.entidade,
      total_pendente = excluded.total_pendente,
      num_documentos = excluded.num_documentos,
      data_venc_mais_antiga = excluded.data_venc_mais_antiga,
      synced_at = now();

  get diagnostics v_count = row_count;

  update public.primavera_sync_runs
  set completed_at = now(),
      balances_count = jsonb_array_length(p_balances),
      status = 'success',
      error = null
  where run_id = v_run_id;

  return jsonb_build_object('runId', v_run_id, 'count', v_count);
exception
  when others then
    update public.primavera_sync_runs
    set completed_at = now(), status = 'error', error = left(sqlerrm, 1000)
    where run_id = v_run_id;
    raise;
end;
$$;

revoke all on function public.sync_primavera_pending_balances(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_primavera_pending_balances(text, jsonb) to service_role;

-- Leitura para o CMR: dado financeiro sensível, por isso a mesma regra de
-- visibilidade já usada para outros dados financeiros (app_can_view_financial).
create or replace function public.get_visible_primavera_pending_balances()
returns setof public.primavera_pending_balances
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or auth.role() <> 'authenticated' or not public.app_can_view_financial() then
    return;
  end if;
  return query select * from public.primavera_pending_balances order by total_pendente desc;
end;
$$;

revoke all on function public.get_visible_primavera_pending_balances() from public, anon;
grant execute on function public.get_visible_primavera_pending_balances() to authenticated, service_role;
