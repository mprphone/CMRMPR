-- Reforço de integridade e rastreabilidade para caixa e seguros.
-- Os meses >= 100 são intencionais: identificam prestações de acordos de dívida.

update public.cash_operations
set spent_description = 'Saída de caixa (registo histórico)'
where spent_amount > 0
  and btrim(spent_description) = '';

alter table public.cash_payments
  drop constraint if exists cash_payments_year_valid,
  drop constraint if exists cash_payments_month_valid,
  drop constraint if exists cash_payments_amount_positive,
  drop constraint if exists cash_payments_method_valid;

alter table public.cash_payments
  add constraint cash_payments_year_valid
    check (payment_year between 2000 and 3000),
  add constraint cash_payments_month_valid
    check (payment_month between 1 and 12 or payment_month between 100 and 9999),
  add constraint cash_payments_amount_positive
    check (amount_paid > 0),
  add constraint cash_payments_method_valid
    check (payment_method in ('Numerário', 'MB Way'));

alter table public.cash_operations
  drop constraint if exists cash_operations_amounts_valid,
  drop constraint if exists cash_operations_spent_description_valid,
  drop constraint if exists cash_operations_report_array;

alter table public.cash_operations
  add constraint cash_operations_amounts_valid
    check (deposited_amount >= 0 and spent_amount >= 0 and mbway_deposited_amount >= 0),
  add constraint cash_operations_spent_description_valid
    check (spent_amount = 0 or btrim(spent_description) <> ''),
  add constraint cash_operations_report_array
    check (jsonb_typeof(report_details) = 'array');

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.cash_session_expenses'::regclass
      and conname = 'cash_session_expenses_operation_fkey'
  ) then
    alter table public.cash_session_expenses
      add constraint cash_session_expenses_operation_fkey
      foreign key (cash_operation_id)
      references public.cash_operations(id)
      on delete restrict;
  end if;
end;
$migration$;

alter table public.insurance_policies
  drop constraint if exists insurance_policies_holder_valid,
  drop constraint if exists insurance_policies_policy_date_required,
  drop constraint if exists insurance_policies_policy_number_valid,
  drop constraint if exists insurance_policies_branch_valid,
  drop constraint if exists insurance_policies_frequency_valid,
  drop constraint if exists insurance_policies_amounts_valid,
  drop constraint if exists insurance_policies_commission_rate_valid,
  drop constraint if exists insurance_policies_status_valid,
  drop constraint if exists insurance_policies_renewal_valid,
  drop constraint if exists insurance_policies_checklist_object;

alter table public.insurance_policies
  add constraint insurance_policies_holder_valid
    check (client_id is not null or btrim(coalesce(policy_holder, '')) <> ''),
  add constraint insurance_policies_policy_date_required
    check (policy_date is not null),
  add constraint insurance_policies_policy_number_valid
    check (btrim(coalesce(policy_number, '')) <> ''),
  add constraint insurance_policies_branch_valid
    check (btrim(coalesce(branch, policy_type, '')) <> ''),
  add constraint insurance_policies_frequency_valid
    check (payment_frequency in ('Mensal', 'Trimestral', 'Semestral', 'Anual')),
  add constraint insurance_policies_amounts_valid
    check (
      premium_value >= 0
      and net_premium_value >= 0
      and (premium_amount is null or premium_amount >= 0)
    ),
  add constraint insurance_policies_commission_rate_valid
    check (commission_rate between 0 and 100),
  add constraint insurance_policies_status_valid
    check (status in ('Proposta', 'Aceite', 'Cancelada')),
  add constraint insurance_policies_renewal_valid
    check (renewal_date is null or policy_date is null or renewal_date >= policy_date),
  add constraint insurance_policies_checklist_object
    check (jsonb_typeof(document_checklist) = 'object');

create or replace function public.reject_closed_cash_record_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_table_name = 'cash_payments' and old.cash_operation_id is not null then
      raise exception 'Um pagamento incluído num fecho de caixa é imutável.' using errcode = '42501';
    end if;
    if tg_table_name = 'cash_session_expenses' and old.cash_operation_id is not null then
      raise exception 'Uma despesa incluída num fecho de caixa é imutável.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_closed_cash_payment_change on public.cash_payments;
create trigger trg_reject_closed_cash_payment_change
before update or delete on public.cash_payments
for each row execute function public.reject_closed_cash_record_change();

drop trigger if exists trg_reject_closed_cash_expense_change on public.cash_session_expenses;
create trigger trg_reject_closed_cash_expense_change
before update or delete on public.cash_session_expenses
for each row execute function public.reject_closed_cash_record_change();

create or replace function public.reject_cash_operation_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'authenticated' then
    raise exception 'Um fecho de caixa é imutável.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_cash_operation_change on public.cash_operations;
create trigger trg_reject_cash_operation_change
before update or delete on public.cash_operations
for each row execute function public.reject_cash_operation_change();

-- Uma liquidação de comissão já paga (paid_at preenchido) é imutável, tal como
-- os pagamentos/despesas de caixa já fechados. Sem isto, qualquer utilizador
-- com permissão de edição de seguros podia sobrescrever silenciosamente o
-- valor/data de uma comissão já liquidada.
create or replace function public.reject_paid_commission_settlement_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'authenticated' and old.paid_at is not null then
    raise exception 'Uma liquidação de comissão já paga é imutável.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_paid_commission_settlement_change on public.insurance_commission_settlements;
create trigger trg_reject_paid_commission_settlement_change
before update or delete on public.insurance_commission_settlements
for each row execute function public.reject_paid_commission_settlement_change();

create table if not exists public.financial_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_role text,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  transaction_id bigint not null default txid_current()
);

create index if not exists idx_financial_audit_log_occurred_at
  on public.financial_audit_log (occurred_at desc);
create index if not exists idx_financial_audit_log_record
  on public.financial_audit_log (table_name, record_id, occurred_at desc);

alter table public.financial_audit_log enable row level security;
revoke all on table public.financial_audit_log from anon, authenticated;
grant select on table public.financial_audit_log to authenticated;

drop policy if exists "financial_audit_select" on public.financial_audit_log;
create policy "financial_audit_select"
on public.financial_audit_log for select to authenticated
using (
  case
    -- Pagamentos e acordos são de um cliente específico: exige âmbito de
    -- dados sobre esse cliente, não apenas a permissão genérica de caixa.
    when table_name in ('cash_payments', 'cash_payment_agreements') then
      public.app_has_permission('cashier', 'view')
      and public.app_can_access_client_id(
        nullif(coalesce(new_data->>'client_id', old_data->>'client_id'), '')::uuid
      )
    when table_name in ('cash_operations', 'cash_session_expenses') then
      public.app_has_permission('cashier', 'view')
    -- Comissões de seguros exigem também can_view_commissions e o âmbito da apólice/cliente.
    when table_name = 'insurance_policies' then
      public.app_has_permission('insurance', 'view')
      and public.app_can_view_commissions()
      and public.app_can_access_insurance(
        nullif(coalesce(new_data->>'client_id', old_data->>'client_id'), '')::uuid,
        coalesce(new_data->>'internal_responsible', old_data->>'internal_responsible')
      )
    when table_name = 'insurance_commission_settlements' then
      public.app_has_permission('insurance', 'view')
      and public.app_can_view_commissions()
      and public.app_can_access_insurance_policy_id(
        nullif(coalesce(new_data->>'policy_id', old_data->>'policy_id'), '')::uuid
      )
    else false
  end
);

create or replace function public.log_financial_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record_id uuid;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_record_id := new.id;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := new.id;
  else
    v_old := to_jsonb(old);
    v_record_id := old.id;
  end if;

  insert into public.financial_audit_log (
    actor_user_id, actor_role, table_name, record_id, action, old_data, new_data
  ) values (
    auth.uid(), auth.role(), tg_table_name, v_record_id, tg_op, v_old, v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $audit_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'cash_payments',
    'cash_payment_agreements',
    'cash_operations',
    'cash_session_expenses',
    'insurance_policies',
    'insurance_commission_settlements'
  ] loop
    execute format('drop trigger if exists trg_financial_audit on public.%I', v_table);
    execute format(
      'create trigger trg_financial_audit after insert or update or delete on public.%I for each row execute function public.log_financial_change()',
      v_table
    );
  end loop;
end;
$audit_triggers$;

create or replace function public.bulk_upsert_cash_payments(payments_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected integer;
  v_affected integer;
begin
  if not public.app_has_permission('cashier', 'edit') then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  if payments_data is null or jsonb_typeof(payments_data) <> 'array' then
    raise exception 'payments_data deve ser uma lista JSON.';
  end if;

  v_expected := jsonb_array_length(payments_data);
  if v_expected = 0 then return; end if;
  if v_expected > 1000 then
    raise exception 'São permitidos no máximo 1000 pagamentos por operação.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(payments_data) as payment(
      id uuid, client_id uuid, payment_year integer, payment_month integer,
      amount_paid numeric, paid_at timestamptz, payment_method text
    )
    where payment.client_id is null
       or payment.payment_year is null
       or payment.payment_year not between 2000 and 3000
       or payment.payment_month is null
       or not (payment.payment_month between 1 and 12 or payment.payment_month between 100 and 9999)
       or payment.amount_paid is null
       or payment.amount_paid <= 0
       or coalesce(nullif(payment.payment_method, ''), 'Numerário') not in ('Numerário', 'MB Way')
       or not public.app_can_access_client_id(payment.client_id)
  ) then
    raise exception 'Existe um pagamento inválido ou fora do âmbito desta conta.' using errcode = '22023';
  end if;

  if (
    select count(*)
    from (
      select payment.client_id, payment.payment_year, payment.payment_month
      from jsonb_to_recordset(payments_data) as payment(
        id uuid, client_id uuid, payment_year integer, payment_month integer,
        amount_paid numeric, paid_at timestamptz, payment_method text
      )
      group by payment.client_id, payment.payment_year, payment.payment_month
    ) unique_payments
  ) <> v_expected then
    raise exception 'A lista contém pagamentos repetidos.' using errcode = '22023';
  end if;

  insert into public.cash_payments (
    id, client_id, payment_year, payment_month, amount_paid, paid_at, payment_method
  )
  select
    coalesce(payment.id, gen_random_uuid()), payment.client_id, payment.payment_year,
    payment.payment_month, payment.amount_paid, coalesce(payment.paid_at, now()),
    coalesce(nullif(payment.payment_method, ''), 'Numerário')
  from jsonb_to_recordset(payments_data) as payment(
    id uuid, client_id uuid, payment_year integer, payment_month integer,
    amount_paid numeric, paid_at timestamptz, payment_method text
  )
  on conflict (client_id, payment_year, payment_month) do update
  set amount_paid = excluded.amount_paid,
      paid_at = excluded.paid_at,
      payment_method = excluded.payment_method
  where cash_payments.cash_operation_id is null;

  get diagnostics v_affected = row_count;
  if v_affected <> v_expected then
    raise exception 'Um ou mais pagamentos já pertencem a um fecho de caixa.' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.create_cash_operation(
  p_deposited_amount numeric,
  p_spent_amount numeric,
  p_spent_description text,
  p_report_details jsonb,
  p_payment_ids uuid[],
  p_mbway_deposited_amount numeric default 0,
  p_adjustment_amount numeric default 0
)
returns public.cash_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.cash_operations;
  v_expected integer;
  v_eligible integer;
  v_attached integer;
  v_cash_total numeric;
  v_mbway_total numeric;
  v_report_cash_total numeric;
  v_report_mbway_total numeric;
begin
  if not public.app_has_permission('cashier', 'create') then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  if coalesce(p_deposited_amount, 0) < 0
     or coalesce(p_spent_amount, 0) < 0
     or coalesce(p_mbway_deposited_amount, 0) < 0 then
    raise exception 'Os valores de depósito e saída não podem ser negativos.' using errcode = '22023';
  end if;
  if coalesce(p_spent_amount, 0) > 0 and btrim(coalesce(p_spent_description, '')) = '' then
    raise exception 'A descrição da saída de caixa é obrigatória.' using errcode = '22023';
  end if;
  if p_report_details is null or jsonb_typeof(p_report_details) <> 'array' then
    raise exception 'O detalhe do relatório deve ser uma lista JSON.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_report_details) detail
    where jsonb_typeof(detail) <> 'object'
       or jsonb_typeof(detail -> 'months') <> 'array'
       or coalesce(detail ->> 'method', '') not in ('Numerário', 'MB Way')
       or coalesce(detail ->> 'clientName', '') = ''
       or coalesce(detail ->> 'total', '') !~ '^[0-9]+([.][0-9]+)?$'
       or (detail ->> 'total')::numeric < 0
  ) then
    raise exception 'O detalhe do relatório de caixa é inválido.' using errcode = '22023';
  end if;

  v_expected := coalesce(cardinality(p_payment_ids), 0);
  if v_expected <> (
    select count(distinct payment_id)
    from unnest(coalesce(p_payment_ids, '{}'::uuid[])) payment_id
  ) then
    raise exception 'A lista contém pagamentos repetidos.' using errcode = '22023';
  end if;

  perform 1
  from public.cash_payments
  where id = any(coalesce(p_payment_ids, '{}'::uuid[]))
    and cash_operation_id is null
    and public.app_can_access_client_id(client_id)
  for update;

  select count(*),
         coalesce(sum(amount_paid) filter (where payment_method = 'Numerário'), 0),
         coalesce(sum(amount_paid) filter (where payment_method = 'MB Way'), 0)
  into v_eligible, v_cash_total, v_mbway_total
  from public.cash_payments
  where id = any(coalesce(p_payment_ids, '{}'::uuid[]))
    and cash_operation_id is null
    and public.app_can_access_client_id(client_id);

  if v_eligible <> v_expected then
    raise exception 'Um pagamento não existe, já foi fechado ou está fora do âmbito desta conta.' using errcode = '23514';
  end if;

  select
    coalesce(sum((detail ->> 'total')::numeric) filter (where detail ->> 'method' = 'Numerário'), 0),
    coalesce(sum((detail ->> 'total')::numeric) filter (where detail ->> 'method' = 'MB Way'), 0)
  into v_report_cash_total, v_report_mbway_total
  from jsonb_array_elements(p_report_details) detail;

  if abs(v_report_cash_total - v_cash_total) > 0.01
     or abs(v_report_mbway_total - v_mbway_total) > 0.01 then
    raise exception 'Os totais do relatório não correspondem aos pagamentos selecionados.' using errcode = '23514';
  end if;

  insert into public.cash_operations (
    deposited_amount, spent_amount, spent_description, report_details,
    mbway_deposited_amount, adjustment_amount
  ) values (
    coalesce(p_deposited_amount, 0), coalesce(p_spent_amount, 0),
    coalesce(p_spent_description, ''), p_report_details,
    coalesce(p_mbway_deposited_amount, 0), coalesce(p_adjustment_amount, 0)
  ) returning * into v_operation;

  update public.cash_payments
  set cash_operation_id = v_operation.id
  where id = any(coalesce(p_payment_ids, '{}'::uuid[]))
    and cash_operation_id is null
    and public.app_can_access_client_id(client_id);
  get diagnostics v_attached = row_count;

  if v_attached <> v_expected then
    raise exception 'Conflito ao associar os pagamentos ao fecho de caixa.' using errcode = '40001';
  end if;

  return v_operation;
end;
$$;

create or replace function public.close_cash_register_atomic(
  p_deposited_amount numeric,
  p_spent_amount numeric,
  p_spent_description text,
  p_report_details jsonb,
  p_payment_ids uuid[],
  p_mbway_deposited_amount numeric default 0,
  p_adjustment_amount numeric default 0,
  p_session_expense_ids uuid[] default '{}'::uuid[]
)
returns public.cash_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.cash_operations;
  v_expected_expenses integer;
  v_eligible_expenses integer;
  v_attached_expenses integer;
  v_expenses_total numeric;
begin
  if not public.app_has_permission('cashier', 'create') then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;

  v_expected_expenses := coalesce(cardinality(p_session_expense_ids), 0);
  if v_expected_expenses <> (
    select count(distinct expense_id)
    from unnest(coalesce(p_session_expense_ids, '{}'::uuid[])) expense_id
  ) then
    raise exception 'A lista contém despesas repetidas.' using errcode = '22023';
  end if;

  perform 1
  from public.cash_session_expenses
  where id = any(coalesce(p_session_expense_ids, '{}'::uuid[]))
    and cash_operation_id is null
  for update;

  select count(*), coalesce(sum(amount), 0)
  into v_eligible_expenses, v_expenses_total
  from public.cash_session_expenses
  where id = any(coalesce(p_session_expense_ids, '{}'::uuid[]))
    and cash_operation_id is null;

  if v_eligible_expenses <> v_expected_expenses then
    raise exception 'Uma despesa não existe ou já foi incluída noutro fecho.' using errcode = '23514';
  end if;
  if abs(v_expenses_total - coalesce(p_spent_amount, 0)) > 0.01 then
    raise exception 'O total das despesas não corresponde à saída de caixa.' using errcode = '23514';
  end if;

  select * into v_operation
  from public.create_cash_operation(
    p_deposited_amount, p_spent_amount, p_spent_description, p_report_details,
    p_payment_ids, p_mbway_deposited_amount, p_adjustment_amount
  );

  update public.cash_session_expenses
  set cash_operation_id = v_operation.id
  where id = any(coalesce(p_session_expense_ids, '{}'::uuid[]))
    and cash_operation_id is null;
  get diagnostics v_attached_expenses = row_count;

  if v_attached_expenses <> v_expected_expenses then
    raise exception 'Conflito ao associar as despesas ao fecho de caixa.' using errcode = '40001';
  end if;

  return v_operation;
end;
$$;

revoke execute on function public.bulk_upsert_cash_payments(jsonb) from anon, public;
revoke execute on function public.create_cash_operation(numeric, numeric, text, jsonb, uuid[], numeric, numeric) from anon, public;
revoke execute on function public.close_cash_register_atomic(numeric, numeric, text, jsonb, uuid[], numeric, numeric, uuid[]) from anon, public;
grant execute on function public.bulk_upsert_cash_payments(jsonb) to authenticated, service_role;
grant execute on function public.create_cash_operation(numeric, numeric, text, jsonb, uuid[], numeric, numeric) to authenticated, service_role;
grant execute on function public.close_cash_register_atomic(numeric, numeric, text, jsonb, uuid[], numeric, numeric, uuid[]) to authenticated, service_role;
