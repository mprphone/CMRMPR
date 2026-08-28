alter policy "Authenticated users can manage app_config"
on public.app_config
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage app_tasks"
on public.app_tasks
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage cash_operations"
on public.cash_operations
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage cash_payment_agreements"
on public.cash_payment_agreements
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage cash_payments"
on public.cash_payments
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage cash_session_expenses"
on public.cash_session_expenses
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage clients"
on public.clients
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage email_automation_runs"
on public.email_automation_runs
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage email_automations"
on public.email_automations
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage email_campaign_history"
on public.email_campaign_history
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage email_templates"
on public.email_templates
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage fee_groups"
on public.fee_groups
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage insurance_commission_settlements"
on public.insurance_commission_settlements
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage insurance_policies"
on public.insurance_policies
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage quote_history"
on public.quote_history
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage saft_dossier_data"
on public.saft_dossier_data
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage saft_sync_queue"
on public.saft_sync_queue
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage staff"
on public.staff
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage turnover_brackets"
on public.turnover_brackets
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter policy "Authenticated users can manage work_safety_services"
on public.work_safety_services
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');

alter function public.set_app_config_updated_at() set search_path = public;
alter function public.set_app_tasks_updated_at() set search_path = public;
alter function public.set_saft_dossier_data_updated_at() set search_path = public;
alter function public.set_saft_sync_queue_updated_at() set search_path = public;

do $$
declare
  target record;
begin
  for target in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'update_group_proposed_fees',
        'bulk_upsert_clients',
        'bulk_upsert_cash_payments'
      )
  loop
    execute format('alter function %s set search_path = public', target.identity);
  end loop;
end;
$$;

alter function public.set_cash_payment_agreements_updated_at() set search_path = public;
alter function public.create_cash_operation(numeric, numeric, text, jsonb, uuid[], numeric, numeric) set search_path = public;
