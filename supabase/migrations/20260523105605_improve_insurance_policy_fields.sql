do $migration$
begin
  if to_regclass('public.insurance_policies') is not null then
    execute 'alter table public.insurance_policies add column if not exists mediator_partner text';
    execute 'alter table public.insurance_policies add column if not exists internal_responsible text';
    execute 'alter table public.insurance_policies add column if not exists has_receipt boolean not null default false';
    execute 'alter table public.insurance_policies add column if not exists created_at timestamptz not null default now()';
    execute 'alter table public.insurance_policies add column if not exists updated_at timestamptz not null default now()';

    execute $sql$
      update public.insurance_policies
         set mediator_partner = coalesce(
               mediator_partner,
               case
                 when company in ('Finiconde', 'Nepseguros', 'Neoseguros') then
                   case when company = 'Nepseguros' then 'Neoseguros' else company end
                 when agent in ('Finiconde', 'Nepseguros', 'Neoseguros') then
                   case when agent = 'Nepseguros' then 'Neoseguros' else agent end
                 else 'Finiconde'
               end
             ),
             internal_responsible = coalesce(
               internal_responsible,
               case when agent in ('MPR', 'Paula') then agent else 'MPR' end
             ),
             agent = coalesce(
               case when agent in ('MPR', 'Paula') then agent else null end,
               internal_responsible,
               'MPR'
             ),
             company = case
               when company in ('Finiconde', 'Nepseguros', 'Neoseguros') then null
               else company
             end,
             insurance_provider = case
               when insurance_provider in ('Finiconde', 'Nepseguros', 'Neoseguros') then null
               else insurance_provider
             end
       where mediator_partner is null
          or internal_responsible is null
          or agent not in ('MPR', 'Paula')
          or company in ('Finiconde', 'Nepseguros', 'Neoseguros')
          or insurance_provider in ('Finiconde', 'Nepseguros', 'Neoseguros')
    $sql$;

    execute $sql$
      update public.insurance_policies
         set status = 'Proposta'
       where status is null
          or status not in ('Proposta', 'Aceite', 'Cancelada')
    $sql$;
  end if;
end;
$migration$;

do $migration$
begin
  if to_regclass('public.insurance_policies') is not null then
    execute $sql$
      create or replace function public.set_insurance_policies_updated_at()
      returns trigger
      language plpgsql
      set search_path = public
      as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$
    $sql$;

    execute 'drop trigger if exists trg_insurance_policies_updated_at on public.insurance_policies';
    execute $sql$
      create trigger trg_insurance_policies_updated_at
      before update on public.insurance_policies
      for each row
      execute function public.set_insurance_policies_updated_at()
    $sql$;
  end if;
end;
$migration$;
