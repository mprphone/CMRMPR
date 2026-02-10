alter table if exists public.cash_payment_agreements
add column if not exists debt_amount numeric(12,2);

update public.cash_payment_agreements
set debt_amount = (monthly_amount * paid_until_month)
where debt_amount is null;

alter table public.cash_payment_agreements
alter column debt_amount set default 0;

alter table public.cash_payment_agreements
alter column debt_amount set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cash_payment_agreements_debt_amount_nonnegative'
  ) then
    alter table public.cash_payment_agreements
    add constraint cash_payment_agreements_debt_amount_nonnegative
    check (debt_amount >= 0);
  end if;
end $$;
