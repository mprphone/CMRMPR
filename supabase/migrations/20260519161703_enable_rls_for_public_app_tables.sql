alter table public.app_config enable row level security;
alter table public.app_tasks enable row level security;
alter table public.cash_operations enable row level security;
alter table public.cash_payment_agreements enable row level security;
alter table public.cash_payments enable row level security;
alter table public.cash_session_expenses enable row level security;
alter table public.clients enable row level security;
alter table public.email_automation_runs enable row level security;
alter table public.email_automations enable row level security;
alter table public.email_campaign_history enable row level security;
alter table public.email_templates enable row level security;
alter table public.fee_groups enable row level security;
alter table public.insurance_commission_settlements enable row level security;
alter table public.insurance_policies enable row level security;
alter table public.quote_history enable row level security;
alter table public.saft_dossier_data enable row level security;
alter table public.saft_sync_queue enable row level security;
alter table public.staff enable row level security;
alter table public.turnover_brackets enable row level security;
alter table public.work_safety_services enable row level security;

drop policy if exists "Enable all access for insurance policies" on public.insurance_policies;
drop policy if exists "Enable all access for work safety services" on public.work_safety_services;

revoke all on table public.app_config from anon;
revoke all on table public.app_tasks from anon;
revoke all on table public.cash_operations from anon;
revoke all on table public.cash_payment_agreements from anon;
revoke all on table public.cash_payments from anon;
revoke all on table public.cash_session_expenses from anon;
revoke all on table public.clients from anon;
revoke all on table public.email_automation_runs from anon;
revoke all on table public.email_automations from anon;
revoke all on table public.email_campaign_history from anon;
revoke all on table public.email_templates from anon;
revoke all on table public.fee_groups from anon;
revoke all on table public.insurance_commission_settlements from anon;
revoke all on table public.insurance_policies from anon;
revoke all on table public.quote_history from anon;
revoke all on table public.saft_dossier_data from anon;
revoke all on table public.saft_sync_queue from anon;
revoke all on table public.staff from anon;
revoke all on table public.turnover_brackets from anon;
revoke all on table public.work_safety_services from anon;

grant select, insert, update, delete on table public.app_config to authenticated;
grant select, insert, update, delete on table public.app_tasks to authenticated;
grant select, insert, update, delete on table public.cash_operations to authenticated;
grant select, insert, update, delete on table public.cash_payment_agreements to authenticated;
grant select, insert, update, delete on table public.cash_payments to authenticated;
grant select, insert, update, delete on table public.cash_session_expenses to authenticated;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.email_automation_runs to authenticated;
grant select, insert, update, delete on table public.email_automations to authenticated;
grant select, insert, update, delete on table public.email_campaign_history to authenticated;
grant select, insert, update, delete on table public.email_templates to authenticated;
grant select, insert, update, delete on table public.fee_groups to authenticated;
grant select, insert, update, delete on table public.insurance_commission_settlements to authenticated;
grant select, insert, update, delete on table public.insurance_policies to authenticated;
grant select, insert, update, delete on table public.quote_history to authenticated;
grant select, insert, update, delete on table public.saft_dossier_data to authenticated;
grant select, insert, update, delete on table public.saft_sync_queue to authenticated;
grant select, insert, update, delete on table public.staff to authenticated;
grant select, insert, update, delete on table public.turnover_brackets to authenticated;
grant select, insert, update, delete on table public.work_safety_services to authenticated;

create policy "Authenticated users can manage app_config"
on public.app_config for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage app_tasks"
on public.app_tasks for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage cash_operations"
on public.cash_operations for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage cash_payment_agreements"
on public.cash_payment_agreements for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage cash_payments"
on public.cash_payments for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage cash_session_expenses"
on public.cash_session_expenses for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage clients"
on public.clients for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage email_automation_runs"
on public.email_automation_runs for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage email_automations"
on public.email_automations for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage email_campaign_history"
on public.email_campaign_history for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage email_templates"
on public.email_templates for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage fee_groups"
on public.fee_groups for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage insurance_commission_settlements"
on public.insurance_commission_settlements for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage insurance_policies"
on public.insurance_policies for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage quote_history"
on public.quote_history for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage saft_dossier_data"
on public.saft_dossier_data for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage saft_sync_queue"
on public.saft_sync_queue for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage staff"
on public.staff for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage turnover_brackets"
on public.turnover_brackets for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can manage work_safety_services"
on public.work_safety_services for all
to authenticated
using (true)
with check (true);
