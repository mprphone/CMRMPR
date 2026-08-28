-- A sincronização mensal de faturação só vivia em estado do componente
-- React — desaparecia sempre que se saía do ecrã, obrigando a sincronizar
-- outra vez a cada visita. Guarda o resultado de cada sincronização manual
-- por mês, para o ecrã carregar sempre o último resultado conhecido e só
-- mudar quando o utilizador sincronizar de novo (não precisa de
-- atualização periódica em fundo, ao contrário da dívida acumulada — isto
-- é granularidade mensal, não um saldo que muda ao minuto).
create table if not exists public.primavera_billing_snapshots (
  month text primary key,
  lines jsonb not null default '[]'::jsonb,
  documents integer not null default 0,
  source_database text,
  synced_at timestamptz not null default now(),
  synced_by uuid
);

alter table public.primavera_billing_snapshots enable row level security;
revoke all on table public.primavera_billing_snapshots from anon, authenticated;
grant all on table public.primavera_billing_snapshots to service_role;

create or replace function public.save_primavera_billing_snapshot(
  p_month text,
  p_lines jsonb,
  p_documents integer,
  p_source_database text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month text := nullif(trim(p_month), '');
begin
  if v_month is null or v_month !~ '^\d{4}-\d{2}$' then
    raise exception 'month inválido (esperado AAAA-MM)';
  end if;
  if not public.app_can_view_financial() then
    raise exception 'Sem permissão para gravar faturação' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines deve ser um array';
  end if;
  if jsonb_array_length(p_lines) > 20000 then
    raise exception 'p_lines excede o limite permitido';
  end if;

  insert into public.primavera_billing_snapshots (month, lines, documents, source_database, synced_at, synced_by)
  values (v_month, p_lines, coalesce(p_documents, 0), p_source_database, now(), auth.uid())
  on conflict (month) do update
  set lines = excluded.lines,
      documents = excluded.documents,
      source_database = excluded.source_database,
      synced_at = now(),
      synced_by = auth.uid();
end;
$$;

revoke all on function public.save_primavera_billing_snapshot(text, jsonb, integer, text) from public, anon;
grant execute on function public.save_primavera_billing_snapshot(text, jsonb, integer, text) to authenticated, service_role;

create or replace function public.get_primavera_billing_snapshot(p_month text)
returns public.primavera_billing_snapshots
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month text := nullif(trim(p_month), '');
  v_row public.primavera_billing_snapshots;
begin
  if v_month is null or not public.app_can_view_financial() then
    return null;
  end if;
  select * into v_row from public.primavera_billing_snapshots where month = v_month;
  return v_row;
end;
$$;

revoke all on function public.get_primavera_billing_snapshot(text) from public, anon;
grant execute on function public.get_primavera_billing_snapshot(text) to authenticated, service_role;
