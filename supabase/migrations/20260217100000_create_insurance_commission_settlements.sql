create table if not exists public.insurance_commission_settlements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.insurance_policies(id) on delete cascade,
  due_date date not null,
  amount numeric(12,2) not null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint insurance_commission_settlements_amount_non_negative check (amount >= 0),
  constraint insurance_commission_settlements_unique unique (policy_id, due_date)
);

create index if not exists idx_insurance_commission_settlements_due_date
  on public.insurance_commission_settlements (due_date);

create index if not exists idx_insurance_commission_settlements_policy_id
  on public.insurance_commission_settlements (policy_id);
