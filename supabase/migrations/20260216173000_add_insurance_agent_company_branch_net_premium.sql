do $migration$
begin
  if to_regclass('public.insurance_policies') is not null then
    execute 'alter table public.insurance_policies add column if not exists agent text';
    execute 'alter table public.insurance_policies add column if not exists renewal_date date';
    execute 'alter table public.insurance_policies add column if not exists company text';
    execute 'alter table public.insurance_policies add column if not exists branch text';
    execute 'alter table public.insurance_policies add column if not exists net_premium_value numeric not null default 0';

    execute '
      update public.insurance_policies
         set agent = coalesce(agent, ''MPR''),
             renewal_date = coalesce(renewal_date, policy_date),
             company = coalesce(company, insurance_provider),
             branch = coalesce(branch, policy_type),
             net_premium_value = coalesce(net_premium_value, premium_value, 0)
       where agent is null
          or renewal_date is null
          or company is null
          or branch is null
          or net_premium_value is null
    ';
  end if;
end;
$migration$;
