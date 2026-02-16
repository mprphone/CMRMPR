do $migration$
begin
  if to_regclass('public.insurance_policies') is not null then
    execute 'alter table public.insurance_policies add column if not exists policy_holder text';

    execute '
      update public.insurance_policies ip
         set policy_holder = coalesce(ip.policy_holder, c.name)
        from public.clients c
       where ip.client_id = c.id
         and (ip.policy_holder is null or btrim(ip.policy_holder) = '''')
    ';
  end if;
end;
$migration$;
