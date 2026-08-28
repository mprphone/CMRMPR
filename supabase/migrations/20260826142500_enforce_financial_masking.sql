-- Impede a leitura/alteração direta de dados financeiros por utilizadores sem autorização.

create or replace function public.get_visible_clients()
returns setof public.clients
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (jsonb_populate_record(
    null::public.clients,
    to_jsonb(client) || case
      when public.app_can_view_financial() then '{}'::jsonb
      else jsonb_build_object(
        'monthly_fee', 0,
        'turnover', 0,
        'previous_year_profit', 0,
        'ai_analysis_cache', null
      )
    end
  )).*
  from public.clients client
  where public.app_has_permission('clients', 'view')
    and public.app_can_access_client(client.id, client.responsavel_interno_id, client.group_id);
$$;

create or replace function public.get_visible_client_by_id(p_client_id uuid)
returns setof public.clients
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select client.*
  from public.get_visible_clients() client
  where client.id = p_client_id;
$$;

create or replace function public.get_visible_staff()
returns setof public.staff
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (jsonb_populate_record(
    null::public.staff,
    to_jsonb(member) || case
      when public.app_can_view_financial() then '{}'::jsonb
      else jsonb_build_object(
        'base_salary', 0,
        'social_charges_percent', 0,
        'meal_allowance', 0,
        'other_monthly_costs', 0,
        'capacity_hours_per_month', 0,
        'hourly_cost', 0
      )
    end
  )).*
  from public.staff member
  where public.app_is_active()
    and (
      public.app_has_permission('team', 'view')
      or public.app_has_permission('clients', 'view')
      or public.app_has_permission('groups', 'view')
    );
$$;

create or replace function public.get_visible_staff_by_id(p_staff_id uuid)
returns setof public.staff
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member.*
  from public.get_visible_staff() member
  where member.id = p_staff_id;
$$;

-- Comissões/prémios de seguros seguem o mesmo mascaramento: sem
-- app_can_view_commissions(), commission_rate/premium_value/net_premium_value
-- e premium_amount nunca chegam ao cliente, nem por leitura direta da tabela
-- nem pela RPC.
create or replace function public.get_visible_insurance_policies()
returns setof public.insurance_policies
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (jsonb_populate_record(
    null::public.insurance_policies,
    to_jsonb(policy) || case
      when public.app_can_view_commissions() then '{}'::jsonb
      else jsonb_build_object(
        'premium_amount', null,
        'premium_value', 0,
        'net_premium_value', 0,
        'commission_rate', 0
      )
    end
  )).*
  from public.insurance_policies policy
  where public.app_has_permission('insurance', 'view')
    and public.app_can_access_insurance(policy.client_id, policy.internal_responsible);
$$;

create or replace function public.get_visible_insurance_policy_by_id(p_policy_id uuid)
returns setof public.insurance_policies
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select policy.*
  from public.get_visible_insurance_policies() policy
  where policy.id = p_policy_id;
$$;

create or replace function public.protect_insurance_commission_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or auth.role() <> 'authenticated' or public.app_can_view_commissions() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.premium_amount := old.premium_amount;
    new.premium_value := old.premium_value;
    new.net_premium_value := old.net_premium_value;
    new.commission_rate := old.commission_rate;
  else
    new.premium_amount := null;
    new.premium_value := 0;
    new.net_premium_value := 0;
    new.commission_rate := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_insurance_commission_columns on public.insurance_policies;
create trigger trg_protect_insurance_commission_columns
before insert or update on public.insurance_policies
for each row execute function public.protect_insurance_commission_columns();

create or replace function public.protect_financial_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or auth.role() <> 'authenticated' or public.app_can_view_financial() then
    return new;
  end if;

  if tg_table_name = 'clients' then
    if tg_op = 'UPDATE' then
      new.monthly_fee := old.monthly_fee;
      new.turnover := old.turnover;
      new.previous_year_profit := old.previous_year_profit;
      new.ai_analysis_cache := old.ai_analysis_cache;
    else
      new.monthly_fee := 0;
      new.turnover := 0;
      new.previous_year_profit := 0;
      new.ai_analysis_cache := null;
    end if;
  elsif tg_table_name = 'staff' then
    if tg_op = 'UPDATE' then
      new.base_salary := old.base_salary;
      new.social_charges_percent := old.social_charges_percent;
      new.meal_allowance := old.meal_allowance;
      new.other_monthly_costs := old.other_monthly_costs;
      new.capacity_hours_per_month := old.capacity_hours_per_month;
      new.hourly_cost := old.hourly_cost;
    else
      new.base_salary := 0;
      new.social_charges_percent := 0;
      new.meal_allowance := 0;
      new.other_monthly_costs := 0;
      new.capacity_hours_per_month := 0;
      new.hourly_cost := 0;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_client_financial_columns on public.clients;
create trigger trg_protect_client_financial_columns
before insert or update on public.clients
for each row execute function public.protect_financial_columns();

drop trigger if exists trg_protect_staff_financial_columns on public.staff;
create trigger trg_protect_staff_financial_columns
before insert or update on public.staff
for each row execute function public.protect_financial_columns();

revoke all on function public.get_visible_clients() from public, anon;
revoke all on function public.get_visible_client_by_id(uuid) from public, anon;
revoke all on function public.get_visible_staff() from public, anon;
revoke all on function public.get_visible_staff_by_id(uuid) from public, anon;
revoke all on function public.get_visible_insurance_policies() from public, anon;
revoke all on function public.get_visible_insurance_policy_by_id(uuid) from public, anon;
revoke all on function public.protect_financial_columns() from public;
revoke all on function public.protect_insurance_commission_columns() from public;
grant execute on function public.get_visible_clients() to authenticated, service_role;
grant execute on function public.get_visible_client_by_id(uuid) to authenticated, service_role;
grant execute on function public.get_visible_staff() to authenticated, service_role;
grant execute on function public.get_visible_staff_by_id(uuid) to authenticated, service_role;
grant execute on function public.get_visible_insurance_policies() to authenticated, service_role;
grant execute on function public.get_visible_insurance_policy_by_id(uuid) to authenticated, service_role;

revoke select on public.clients from authenticated;
grant select (
  id, name, email, phone, address, nif, sector, entity_type, responsible_staff,
  responsavel_interno_id, group_id, employee_count, establishments, banks,
  document_count, call_time_balance, travel_count, delivers_organized_docs,
  vat_refunds, has_ine_report, has_cost_centers, has_international_ops,
  has_management_reports, supplier_count, customer_count, communication_count,
  meeting_count, tasks, status, estado, regime_iva, tipo_contabilidade,
  contract_renewal_date, created_at, saft_collect_enabled, wampr_source_id,
  wampr_upstream_source_id, wampr_updated_at, wampr_synced_at
) on public.clients to authenticated;

revoke select on public.staff from authenticated;
grant select (
  id, name, email, phone, telefone, role, assigned_areas, created_at,
  wampr_source_id, wampr_updated_at, wampr_synced_at
) on public.staff to authenticated;

revoke select on public.insurance_policies from authenticated;
grant select (
  id, client_id, policy_holder, agent, mediator_partner, internal_responsible,
  policy_date, renewal_date, expiry_date, policy_number, company, branch,
  insurance_company, insurance_provider, payment_frequency, policy_type,
  commission_paid, status, communication_type, policy_tier, attachment_url,
  document_checklist, notes, has_receipt, created_at, updated_at
) on public.insurance_policies to authenticated;

-- Postgres exige privilégio SELECT sobre qualquer coluna referenciada no SET
-- de um "INSERT ... ON CONFLICT DO UPDATE" — mesmo só como "excluded.coluna"
-- — porque o UPDATE resultante pode, em geral, ler o valor antigo dessa
-- coluna. Como as colunas financeiras deixaram de ter SELECT direto para
-- "authenticated" (mascaramento acima), um upsert direto de clients/staff/
-- insurance_policies que toque nessas colunas passou a falhar com
-- "permission denied for table X", mesmo para administradores. Estas três
-- funções fazem o upsert com privilégio elevado (dono da função), repetindo
-- manualmente as mesmas verificações que as políticas RLS de insert/update
-- já aplicam — a leitura de volta continua sempre a passar pelas RPCs
-- get_visible_*_by_id (mascaradas), nunca pelo valor devolvido aqui.
create or replace function public.upsert_client(p_client jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.clients := jsonb_populate_record(null::public.clients, p_client);
  v_exists boolean;
  v_group_id uuid;
begin
  if v_row.id is null then
    raise exception 'id obrigatório';
  end if;
  if not public.app_mfa_satisfied() then
    raise exception 'Verificação de segurança (MFA) necessária' using errcode = '42501';
  end if;

  select exists(select 1 from public.clients where id = v_row.id), group_id
    into v_exists, v_group_id
  from public.clients where id = v_row.id;

  if v_exists then
    if not (public.app_has_permission('clients', 'edit') and public.app_can_access_client(v_row.id, v_row.responsavel_interno_id, v_group_id)) then
      raise exception 'Sem permissão para editar este cliente' using errcode = '42501';
    end if;
  else
    if not (public.app_has_permission('clients', 'create') and public.app_can_access_client(v_row.id, v_row.responsavel_interno_id, null)) then
      raise exception 'Sem permissão para criar este cliente' using errcode = '42501';
    end if;
  end if;

  insert into public.clients (
    id, name, nif, address, email, phone, entity_type, status, sector,
    responsavel_interno_id, monthly_fee, employee_count, establishments, banks,
    turnover, document_count, call_time_balance, travel_count, delivers_organized_docs,
    vat_refunds, has_ine_report, has_cost_centers, has_international_ops, has_management_reports,
    supplier_count, customer_count, communication_count, meeting_count, previous_year_profit,
    saft_collect_enabled, tasks, contract_renewal_date, ai_analysis_cache
  ) values (
    v_row.id, v_row.name, v_row.nif, v_row.address, v_row.email, v_row.phone, v_row.entity_type,
    v_row.status, v_row.sector, v_row.responsavel_interno_id, coalesce(v_row.monthly_fee, 0),
    coalesce(v_row.employee_count, 0), coalesce(v_row.establishments, 1), coalesce(v_row.banks, 1),
    coalesce(v_row.turnover, 0), coalesce(v_row.document_count, 0), coalesce(v_row.call_time_balance, 0),
    coalesce(v_row.travel_count, 0), coalesce(v_row.delivers_organized_docs, true), coalesce(v_row.vat_refunds, false),
    coalesce(v_row.has_ine_report, false), coalesce(v_row.has_cost_centers, false), coalesce(v_row.has_international_ops, false),
    coalesce(v_row.has_management_reports, false), coalesce(v_row.supplier_count, 0), coalesce(v_row.customer_count, 0),
    coalesce(v_row.communication_count, 0), coalesce(v_row.meeting_count, 0), coalesce(v_row.previous_year_profit, 0),
    coalesce(v_row.saft_collect_enabled, true), coalesce(v_row.tasks, '[]'::jsonb),
    v_row.contract_renewal_date, v_row.ai_analysis_cache
  )
  on conflict (id) do update set
    name = excluded.name, nif = excluded.nif, address = excluded.address, email = excluded.email,
    phone = excluded.phone, entity_type = excluded.entity_type, status = excluded.status, sector = excluded.sector,
    responsavel_interno_id = excluded.responsavel_interno_id, monthly_fee = excluded.monthly_fee,
    employee_count = excluded.employee_count, establishments = excluded.establishments, banks = excluded.banks,
    turnover = excluded.turnover, document_count = excluded.document_count, call_time_balance = excluded.call_time_balance,
    travel_count = excluded.travel_count, delivers_organized_docs = excluded.delivers_organized_docs,
    vat_refunds = excluded.vat_refunds, has_ine_report = excluded.has_ine_report,
    has_cost_centers = excluded.has_cost_centers, has_international_ops = excluded.has_international_ops,
    has_management_reports = excluded.has_management_reports, supplier_count = excluded.supplier_count,
    customer_count = excluded.customer_count, communication_count = excluded.communication_count,
    meeting_count = excluded.meeting_count, previous_year_profit = excluded.previous_year_profit,
    saft_collect_enabled = excluded.saft_collect_enabled, tasks = excluded.tasks,
    contract_renewal_date = excluded.contract_renewal_date, ai_analysis_cache = excluded.ai_analysis_cache;
end;
$$;

create or replace function public.upsert_staff_member(p_staff jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.staff := jsonb_populate_record(null::public.staff, p_staff);
  v_exists boolean;
begin
  if v_row.id is null then
    raise exception 'id obrigatório';
  end if;
  if not public.app_mfa_satisfied() then
    raise exception 'Verificação de segurança (MFA) necessária' using errcode = '42501';
  end if;

  select exists(select 1 from public.staff where id = v_row.id) into v_exists;

  if v_exists then
    if not public.app_has_permission('team', 'edit') then
      raise exception 'Sem permissão para editar este colaborador' using errcode = '42501';
    end if;
  else
    if not public.app_has_permission('team', 'create') then
      raise exception 'Sem permissão para criar este colaborador' using errcode = '42501';
    end if;
  end if;

  insert into public.staff (
    id, name, email, phone, role, base_salary, social_charges_percent,
    meal_allowance, other_monthly_costs, capacity_hours_per_month, hourly_cost, assigned_areas
  ) values (
    v_row.id, v_row.name, coalesce(v_row.email, ''), coalesce(v_row.phone, ''),
    coalesce(v_row.role, 'Colaborador'), coalesce(v_row.base_salary, 0),
    coalesce(v_row.social_charges_percent, 23.75), coalesce(v_row.meal_allowance, 0),
    coalesce(v_row.other_monthly_costs, 0), coalesce(v_row.capacity_hours_per_month, 160),
    coalesce(v_row.hourly_cost, 0), coalesce(v_row.assigned_areas, '[]'::jsonb)
  )
  on conflict (id) do update set
    name = excluded.name, email = excluded.email, phone = excluded.phone, role = excluded.role,
    base_salary = excluded.base_salary, social_charges_percent = excluded.social_charges_percent,
    meal_allowance = excluded.meal_allowance, other_monthly_costs = excluded.other_monthly_costs,
    capacity_hours_per_month = excluded.capacity_hours_per_month, hourly_cost = excluded.hourly_cost,
    assigned_areas = excluded.assigned_areas;
end;
$$;

create or replace function public.upsert_insurance_policy(p_policy jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.insurance_policies := jsonb_populate_record(null::public.insurance_policies, p_policy);
  v_exists boolean;
begin
  if v_row.id is null then
    raise exception 'id obrigatório';
  end if;
  if not public.app_mfa_satisfied() then
    raise exception 'Verificação de segurança (MFA) necessária' using errcode = '42501';
  end if;

  select exists(select 1 from public.insurance_policies where id = v_row.id) into v_exists;

  if v_exists then
    if not (public.app_has_permission('insurance', 'edit') and public.app_can_access_insurance(v_row.client_id, v_row.internal_responsible)) then
      raise exception 'Sem permissão para editar esta apólice' using errcode = '42501';
    end if;
  else
    if not (public.app_has_permission('insurance', 'create') and public.app_can_access_insurance(v_row.client_id, v_row.internal_responsible)) then
      raise exception 'Sem permissão para criar esta apólice' using errcode = '42501';
    end if;
  end if;

  insert into public.insurance_policies (
    id, client_id, policy_holder, agent, mediator_partner, internal_responsible,
    policy_date, renewal_date, policy_number, company, branch, insurance_provider,
    payment_frequency, policy_type, premium_value, net_premium_value, commission_rate,
    commission_paid, has_receipt, status, attachment_url, communication_type, notes,
    policy_tier, document_checklist
  ) values (
    v_row.id, v_row.client_id, v_row.policy_holder, v_row.agent, v_row.mediator_partner, v_row.internal_responsible,
    v_row.policy_date, v_row.renewal_date, v_row.policy_number, v_row.company, v_row.branch, v_row.insurance_provider,
    coalesce(v_row.payment_frequency, 'Anual'), coalesce(v_row.policy_type, ''), coalesce(v_row.premium_value, 0),
    coalesce(v_row.net_premium_value, 0), coalesce(v_row.commission_rate, 0),
    coalesce(v_row.commission_paid, false), coalesce(v_row.has_receipt, false), coalesce(v_row.status, 'Proposta'),
    v_row.attachment_url, v_row.communication_type, v_row.notes, v_row.policy_tier,
    coalesce(v_row.document_checklist, '{}'::jsonb)
  )
  on conflict (id) do update set
    client_id = excluded.client_id, policy_holder = excluded.policy_holder, agent = excluded.agent,
    mediator_partner = excluded.mediator_partner, internal_responsible = excluded.internal_responsible,
    policy_date = excluded.policy_date, renewal_date = excluded.renewal_date, policy_number = excluded.policy_number,
    company = excluded.company, branch = excluded.branch, insurance_provider = excluded.insurance_provider,
    payment_frequency = excluded.payment_frequency, policy_type = excluded.policy_type,
    premium_value = excluded.premium_value, net_premium_value = excluded.net_premium_value,
    commission_rate = excluded.commission_rate, commission_paid = excluded.commission_paid,
    has_receipt = excluded.has_receipt, status = excluded.status, attachment_url = excluded.attachment_url,
    communication_type = excluded.communication_type, notes = excluded.notes, policy_tier = excluded.policy_tier,
    document_checklist = excluded.document_checklist;
end;
$$;

revoke all on function public.upsert_client(jsonb) from public, anon;
revoke all on function public.upsert_staff_member(jsonb) from public, anon;
revoke all on function public.upsert_insurance_policy(jsonb) from public, anon;
grant execute on function public.upsert_client(jsonb) to authenticated, service_role;
grant execute on function public.upsert_staff_member(jsonb) to authenticated, service_role;
grant execute on function public.upsert_insurance_policy(jsonb) to authenticated, service_role;
