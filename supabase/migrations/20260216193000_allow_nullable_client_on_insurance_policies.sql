do $$
begin
  if to_regclass('public.insurance_policies') is not null and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'insurance_policies'
      and column_name = 'client_id'
  ) then
    execute 'alter table public.insurance_policies alter column client_id drop not null';
  end if;
end;
$$;
