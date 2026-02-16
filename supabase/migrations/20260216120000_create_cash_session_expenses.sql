create table if not exists public.cash_session_expenses (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,2) not null,
  description text not null,
  cash_operation_id uuid null,
  created_at timestamptz not null default now(),
  constraint cash_session_expenses_amount_positive check (amount > 0),
  constraint cash_session_expenses_description_not_blank check (char_length(trim(description)) > 0)
);

create index if not exists idx_cash_session_expenses_open
  on public.cash_session_expenses (cash_operation_id, created_at);
