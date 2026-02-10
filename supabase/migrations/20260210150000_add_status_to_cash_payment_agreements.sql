alter table if exists public.cash_payment_agreements
add column if not exists status text;

update public.cash_payment_agreements
set status = 'Ativo'
where status is null;

alter table public.cash_payment_agreements
alter column status set default 'Ativo';

alter table public.cash_payment_agreements
alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cash_payment_agreements_status_valid'
  ) then
    alter table public.cash_payment_agreements
    add constraint cash_payment_agreements_status_valid
    check (status in ('Ativo', 'Anulado', 'Concluido'));
  end if;
end $$;
