-- Aplica marcações e remoções de pagamentos na mesma transação SQL.

create or replace function public.apply_cash_payment_changes(
  payments_data jsonb default '[]'::jsonb,
  delete_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delete_expected integer := coalesce(cardinality(delete_ids), 0);
  v_deleted integer;
begin
  if not public.app_has_permission('cashier', 'edit') then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  if payments_data is null or jsonb_typeof(payments_data) <> 'array' then
    raise exception 'payments_data deve ser uma lista JSON.' using errcode = '22023';
  end if;
  if v_delete_expected > 1000 then
    raise exception 'São permitidas no máximo 1000 remoções por operação.' using errcode = '22023';
  end if;
  if v_delete_expected <> (
    select count(distinct payment_id)
    from unnest(coalesce(delete_ids, '{}'::uuid[])) payment_id
  ) then
    raise exception 'A lista contém remoções repetidas.' using errcode = '22023';
  end if;

  perform 1
  from public.cash_payments
  where id = any(coalesce(delete_ids, '{}'::uuid[]))
    and cash_operation_id is null
    and public.app_can_access_client_id(client_id)
  for update;

  delete from public.cash_payments
  where id = any(coalesce(delete_ids, '{}'::uuid[]))
    and cash_operation_id is null
    and public.app_can_access_client_id(client_id);
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_delete_expected then
    raise exception 'Um pagamento a remover não existe, já foi fechado ou está fora do âmbito desta conta.' using errcode = '23514';
  end if;

  perform public.bulk_upsert_cash_payments(payments_data);
end;
$$;

revoke execute on function public.apply_cash_payment_changes(jsonb, uuid[]) from anon, public;
grant execute on function public.apply_cash_payment_changes(jsonb, uuid[]) to authenticated, service_role;

