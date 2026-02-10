create table if not exists public.cash_payment_agreements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  agreement_year integer not null check (agreement_year between 2000 and 3000),
  paid_until_month smallint not null check (paid_until_month between 1 and 12),
  monthly_amount numeric(12,2) not null check (monthly_amount > 0),
  notes text not null default '',
  called boolean not null default false,
  letter_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, agreement_year)
);

create index if not exists idx_cash_payment_agreements_client_year
  on public.cash_payment_agreements (client_id, agreement_year);

create or replace function public.set_cash_payment_agreements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cash_payment_agreements_updated_at on public.cash_payment_agreements;
create trigger trg_cash_payment_agreements_updated_at
before update on public.cash_payment_agreements
for each row
execute function public.set_cash_payment_agreements_updated_at();
