-- Baseline necessário para reconstruir o projeto CMRMPR numa instalação Supabase vazia.
-- As migrações históricas seguintes acrescentam tabelas, RPCs e políticas mais recentes.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null default '',
  phone text not null default '',
  telefone text not null default '',
  role text not null default 'Colaborador',
  base_salary numeric not null default 0,
  social_charges_percent numeric not null default 23.75,
  meal_allowance numeric not null default 0,
  other_monthly_costs numeric not null default 0,
  capacity_hours_per_month numeric not null default 160,
  hourly_cost numeric not null default 0,
  assigned_areas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_staff_email_normalized
  on public.staff (lower(email)) where trim(email) <> '';

create table if not exists public.fee_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  client_ids jsonb not null default '[]'::jsonb,
  proposed_fees jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  nif text not null,
  sector text not null default 'Geral',
  entity_type text not null default 'SOCIEDADE',
  responsible_staff text,
  responsavel_interno_id uuid references public.staff(id) on delete set null,
  group_id uuid references public.fee_groups(id) on delete set null,
  monthly_fee numeric not null default 0,
  employee_count integer not null default 0,
  establishments integer not null default 1,
  banks integer not null default 1,
  turnover numeric not null default 0,
  document_count integer not null default 0,
  call_time_balance numeric not null default 0,
  travel_count integer not null default 0,
  delivers_organized_docs boolean not null default true,
  vat_refunds boolean not null default false,
  has_ine_report boolean not null default false,
  has_cost_centers boolean not null default false,
  has_international_ops boolean not null default false,
  has_management_reports boolean not null default false,
  supplier_count integer not null default 0,
  customer_count integer not null default 0,
  communication_count integer not null default 0,
  meeting_count integer not null default 0,
  previous_year_profit numeric not null default 0,
  tasks jsonb not null default '[]'::jsonb,
  status text not null default 'Ativo',
  estado text,
  regime_iva text,
  tipo_contabilidade text,
  contract_renewal_date date,
  ai_analysis_cache jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_clients_nif on public.clients(nif);
create index if not exists idx_clients_responsavel_interno on public.clients(responsavel_interno_id);

create table if not exists public.cash_operations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  deposited_amount numeric not null default 0,
  spent_amount numeric not null default 0,
  mbway_deposited_amount numeric not null default 0,
  adjustment_amount numeric not null default 0,
  spent_description text not null default '',
  report_details jsonb not null default '[]'::jsonb
);

create table if not exists public.cash_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  payment_year integer not null,
  payment_month integer not null,
  amount_paid numeric not null default 0,
  paid_at timestamptz not null default now(),
  payment_method text not null default 'Numerário',
  cash_operation_id uuid references public.cash_operations(id) on delete set null,
  unique (client_id, payment_year, payment_month)
);

create index if not exists idx_cash_payments_operation on public.cash_payments(cash_operation_id);

create or replace function public.bulk_upsert_cash_payments(payments_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if payments_data is null or jsonb_typeof(payments_data) <> 'array' then
    raise exception 'payments_data must be a JSON array';
  end if;

  insert into public.cash_payments (
    id, client_id, payment_year, payment_month, amount_paid, paid_at, payment_method
  )
  select
    coalesce(payment.id, gen_random_uuid()),
    payment.client_id,
    payment.payment_year,
    payment.payment_month,
    coalesce(payment.amount_paid, 0),
    coalesce(payment.paid_at, now()),
    coalesce(nullif(payment.payment_method, ''), 'Numerário')
  from jsonb_to_recordset(payments_data) as payment(
    id uuid,
    client_id uuid,
    payment_year integer,
    payment_month integer,
    amount_paid numeric,
    paid_at timestamptz,
    payment_method text
  )
  on conflict (client_id, payment_year, payment_month) do update
  set amount_paid = excluded.amount_paid,
      paid_at = excluded.paid_at,
      payment_method = excluded.payment_method;
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
set search_path = public
as $$
declare
  operation public.cash_operations;
begin
  insert into public.cash_operations (
    deposited_amount, spent_amount, spent_description, report_details,
    mbway_deposited_amount, adjustment_amount
  ) values (
    coalesce(p_deposited_amount, 0), coalesce(p_spent_amount, 0),
    coalesce(p_spent_description, ''), coalesce(p_report_details, '[]'::jsonb),
    coalesce(p_mbway_deposited_amount, 0), coalesce(p_adjustment_amount, 0)
  ) returning * into operation;

  update public.cash_payments
     set cash_operation_id = operation.id
   where id = any(coalesce(p_payment_ids, '{}'::uuid[]))
     and cash_operation_id is null;

  return operation;
end;
$$;

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_campaign_history (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  subject text not null,
  body text not null,
  recipient_count integer not null default 0,
  recipient_ids uuid[] not null default '{}'::uuid[],
  recipient_results jsonb not null default '[]'::jsonb,
  group_name text not null default '',
  status text not null default '',
  scheduled_at timestamptz,
  send_delay integer,
  template_id uuid references public.email_templates(id) on delete set null
);

create table if not exists public.email_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  client_group text not null,
  admin_email text not null,
  from_name text not null,
  from_email text not null,
  reply_to text,
  subject_hint text not null default '',
  ai_instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.email_automations(id) on delete cascade,
  run_month text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  successes integer not null default 0,
  failures integer not null default 0,
  details jsonb,
  error text
);

create table if not exists public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  policy_holder text,
  agent text,
  policy_date date,
  renewal_date date,
  expiry_date date,
  policy_number text,
  company text,
  branch text,
  insurance_company text,
  insurance_provider text,
  payment_frequency text not null default 'Anual',
  policy_type text not null default '',
  premium_amount numeric,
  premium_value numeric not null default 0,
  net_premium_value numeric not null default 0,
  commission_rate numeric not null default 0,
  commission_paid boolean not null default false,
  status text not null default 'Proposta',
  communication_type text,
  policy_tier text,
  attachment_url text,
  document_checklist jsonb not null default '{}'::jsonb,
  notes text,
  mediator_partner text,
  internal_responsible text,
  has_receipt boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_insurance_policies_client on public.insurance_policies(client_id);
create index if not exists idx_insurance_policies_number on public.insurance_policies(policy_number);

create table if not exists public.work_safety_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service_date date not null,
  renewal_term text not null,
  provider text not null,
  total_value numeric not null default 0,
  has_commission boolean not null default false,
  is_commission_paid boolean not null default false,
  proposal_status text not null default 'Não enviada',
  attachment_url text,
  document_checklist jsonb not null default '{}'::jsonb,
  profile_data jsonb not null default '{}'::jsonb,
  ai_obligations_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.turnover_brackets (
  id uuid primary key default gen_random_uuid(),
  min_turnover numeric not null,
  max_turnover numeric not null,
  min_percent numeric not null,
  max_percent numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.quote_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_name text not null,
  client_nif text not null,
  client_volume numeric not null default 0,
  employee_count integer not null default 0,
  document_count integer not null default 0,
  establishments integer not null default 0,
  banks integer not null default 0,
  items jsonb not null default '[]'::jsonb,
  target_margin numeric not null default 0,
  recommended_monthly_fee numeric not null default 0,
  total_annual_cost numeric not null default 0,
  total_annual_hours numeric not null default 0
);

create or replace function public.update_group_proposed_fees(
  group_id uuid,
  fees_payload jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.fee_groups
     set proposed_fees = coalesce(fees_payload, '{}'::jsonb)
   where id = group_id;
$$;

grant execute on function public.bulk_upsert_cash_payments(jsonb) to authenticated, service_role;
grant execute on function public.create_cash_operation(numeric, numeric, text, jsonb, uuid[], numeric, numeric)
  to authenticated, service_role;
grant execute on function public.update_group_proposed_fees(uuid, jsonb) to authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do update set public = excluded.public;
