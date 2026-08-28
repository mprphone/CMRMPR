-- Pipeline de email persistente: campanhas, outbox, supressoes, auditoria e controlo.

alter table public.clients
  add column if not exists email_marketing_status text not null default 'unknown',
  add column if not exists email_marketing_consent_at timestamptz,
  add column if not exists email_marketing_consent_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass
      and conname = 'clients_email_marketing_status_check'
  ) then
    alter table public.clients
      add constraint clients_email_marketing_status_check
      check (email_marketing_status in ('unknown', 'consented', 'legitimate_interest', 'opted_out'));
  end if;
end;
$$;

alter table public.email_templates
  add column if not exists preheader text not null default '',
  add column if not exists category text not null default 'Geral',
  add column if not exists approval_status text not null default 'draft',
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_templates'::regclass
      and conname = 'email_templates_approval_status_check'
  ) then
    alter table public.email_templates
      add constraint email_templates_approval_status_check
      check (approval_status in ('draft', 'approved', 'archived'));
  end if;
end;
$$;

alter table public.email_automations
  add column if not exists trigger_type text not null default 'monthly_documents',
  add column if not exists schedule_day integer not null default 1,
  add column if not exists schedule_hour integer not null default 9,
  add column if not exists requires_approval boolean not null default true,
  add column if not exists campaign_type text not null default 'service',
  add column if not exists last_run_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_automations'::regclass
      and conname = 'email_automations_schedule_day_check'
  ) then
    alter table public.email_automations
      add constraint email_automations_schedule_day_check check (schedule_day between 1 and 28);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_automations'::regclass
      and conname = 'email_automations_schedule_hour_check'
  ) then
    alter table public.email_automations
      add constraint email_automations_schedule_hour_check check (schedule_hour between 0 and 23);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_automations'::regclass
      and conname = 'email_automations_campaign_type_check'
  ) then
    alter table public.email_automations
      add constraint email_automations_campaign_type_check check (campaign_type in ('service', 'marketing'));
  end if;
end;
$$;

-- Algumas instalacoes antigas criaram recipient_ids como text[]. Normalizamos para uuid[].
do $$
declare
  v_udt text;
begin
  select udt_name into v_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'email_campaign_history'
    and column_name = 'recipient_ids';

  if v_udt = '_text' then
    alter table public.email_campaign_history
      alter column recipient_ids drop default;
    alter table public.email_campaign_history
      alter column recipient_ids type uuid[]
      using recipient_ids::uuid[];
    alter table public.email_campaign_history
      alter column recipient_ids set default '{}'::uuid[];
  end if;
end;
$$;

alter table public.email_campaign_history
  add column if not exists delivery_status text not null default 'completed',
  add column if not exists campaign_type text not null default 'service',
  add column if not exists preheader text not null default '',
  add column if not exists signature_html text not null default '',
  add column if not exists from_name text not null default '',
  add column if not exists from_email text not null default '',
  add column if not exists reply_to text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists eligible_count integer not null default 0,
  add column if not exists excluded_count integer not null default 0,
  add column if not exists success_count integer not null default 0,
  add column if not exists failure_count integer not null default 0,
  add column if not exists bounce_count integer not null default 0,
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_campaign_history'::regclass
      and conname = 'email_campaign_delivery_status_check'
  ) then
    alter table public.email_campaign_history
      add constraint email_campaign_delivery_status_check
      check (delivery_status in ('draft', 'scheduled', 'queued', 'processing', 'completed', 'partial', 'failed', 'cancelled'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_campaign_history'::regclass
      and conname = 'email_campaign_type_check'
  ) then
    alter table public.email_campaign_history
      add constraint email_campaign_type_check
      check (campaign_type in ('service', 'marketing'));
  end if;
end;
$$;

create unique index if not exists idx_email_campaign_idempotency
  on public.email_campaign_history(created_by, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_email_campaign_delivery_due
  on public.email_campaign_history(delivery_status, scheduled_at);
create index if not exists idx_email_campaign_created_by
  on public.email_campaign_history(created_by, sent_at desc);

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null,
  reason text not null,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_suppressions'::regclass
      and conname = 'email_suppressions_reason_check'
  ) then
    alter table public.email_suppressions
      add constraint email_suppressions_reason_check
      check (reason in ('unsubscribe', 'hard_bounce', 'complaint', 'invalid', 'manual'));
  end if;
end;
$$;

create unique index if not exists idx_email_suppressions_active_email
  on public.email_suppressions(email_normalized)
  where lifted_at is null;
create index if not exists idx_email_suppressions_created_at
  on public.email_suppressions(created_at desc);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaign_history(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  recipient_name text not null default '',
  email text not null,
  email_normalized text not null,
  rendered_subject text not null,
  rendered_html text not null,
  status text not null default 'pending',
  exclusion_reason text,
  attempts integer not null default 0,
  max_attempts integer not null default 4,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  provider_message_id text,
  last_error text,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_campaign_recipients'::regclass
      and conname = 'email_campaign_recipients_status_check'
  ) then
    alter table public.email_campaign_recipients
      add constraint email_campaign_recipients_status_check
      check (status in ('pending', 'sending', 'retry', 'accepted', 'delivered', 'bounced', 'complained', 'failed', 'cancelled', 'suppressed', 'skipped'));
  end if;
end;
$$;

create unique index if not exists idx_email_recipient_campaign_email
  on public.email_campaign_recipients(campaign_id, email_normalized);
create unique index if not exists idx_email_recipient_unsubscribe_token
  on public.email_campaign_recipients(unsubscribe_token);
create index if not exists idx_email_recipient_due
  on public.email_campaign_recipients(status, next_attempt_at)
  where status in ('pending', 'retry');
create index if not exists idx_email_recipient_campaign_status
  on public.email_campaign_recipients(campaign_id, status);
create index if not exists idx_email_recipient_provider_message
  on public.email_campaign_recipients(provider_message_id)
  where provider_message_id is not null;

create table if not exists public.email_delivery_events (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.email_campaign_recipients(id) on delete cascade,
  campaign_id uuid not null references public.email_campaign_history(id) on delete cascade,
  event_type text not null,
  provider_message_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_email_delivery_events_recipient
  on public.email_delivery_events(recipient_id, occurred_at desc);

create or replace function public.set_email_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_email_templates_updated_at on public.email_templates;
create trigger trg_email_templates_updated_at
before update on public.email_templates
for each row execute function public.set_email_updated_at();

drop trigger if exists trg_email_campaigns_updated_at on public.email_campaign_history;
create trigger trg_email_campaigns_updated_at
before update on public.email_campaign_history
for each row execute function public.set_email_updated_at();

drop trigger if exists trg_email_recipients_updated_at on public.email_campaign_recipients;
create trigger trg_email_recipients_updated_at
before update on public.email_campaign_recipients
for each row execute function public.set_email_updated_at();

create or replace function public.app_can_access_email_campaign(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.app_is_service_role()
    or coalesce((
      select public.app_has_permission('emails', 'view')
        and (
          campaign.created_by = auth.uid()
          or exists (
            select 1 from public.app_user_access access
            where access.user_id = auth.uid()
              and access.active
              and (access.access_role = 'admin' or access.data_scope = 'all')
          )
        )
      from public.email_campaign_history campaign
      where campaign.id = p_campaign_id
    ), false);
$$;

alter table public.email_campaign_recipients enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_delivery_events enable row level security;

revoke all on table public.email_campaign_recipients, public.email_suppressions, public.email_delivery_events from anon;
grant select on table public.email_campaign_recipients, public.email_suppressions, public.email_delivery_events to authenticated;
grant insert, update, delete on table public.email_suppressions to authenticated;
grant all on table public.email_campaign_recipients, public.email_suppressions, public.email_delivery_events to service_role;
grant usage, select on sequence public.email_delivery_events_id_seq to service_role;

drop policy if exists email_campaign_history_select on public.email_campaign_history;
drop policy if exists email_campaign_history_insert on public.email_campaign_history;
drop policy if exists email_campaign_history_update on public.email_campaign_history;
drop policy if exists email_campaign_history_delete on public.email_campaign_history;

create policy email_campaign_history_select on public.email_campaign_history for select to authenticated
using (public.app_can_access_email_campaign(id));
create policy email_campaign_history_insert on public.email_campaign_history for insert to authenticated
with check (public.app_has_permission('emails', 'create') and created_by = auth.uid());
create policy email_campaign_history_update on public.email_campaign_history for update to authenticated
using (public.app_has_permission('emails', 'edit') and public.app_can_access_email_campaign(id))
with check (public.app_has_permission('emails', 'edit') and public.app_can_access_email_campaign(id));
create policy email_campaign_history_delete on public.email_campaign_history for delete to authenticated
using (public.app_has_permission('emails', 'delete') and public.app_can_access_email_campaign(id));

create policy email_recipients_select on public.email_campaign_recipients for select to authenticated
using (
  public.app_can_access_email_campaign(campaign_id)
  and (client_id is null or public.app_can_access_client_id(client_id))
);

create policy email_delivery_events_select on public.email_delivery_events for select to authenticated
using (public.app_can_access_email_campaign(campaign_id));

create policy email_suppressions_select on public.email_suppressions for select to authenticated
using (public.app_has_permission('emails', 'view'));
create policy email_suppressions_insert on public.email_suppressions for insert to authenticated
with check (public.app_has_permission('emails', 'create') and created_by = auth.uid());
create policy email_suppressions_update on public.email_suppressions for update to authenticated
using (public.app_has_permission('emails', 'edit'))
with check (public.app_has_permission('emails', 'edit'));
create policy email_suppressions_delete on public.email_suppressions for delete to authenticated
using (public.app_has_permission('emails', 'delete'));

create or replace function public.create_email_campaign(
  p_subject text,
  p_body text,
  p_group_name text,
  p_campaign_type text,
  p_preheader text,
  p_signature_html text,
  p_from_name text,
  p_from_email text,
  p_reply_to text,
  p_scheduled_at timestamptz,
  p_template_id uuid,
  p_idempotency_key text,
  p_requires_approval boolean,
  p_recipients jsonb
)
returns public.email_campaign_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.email_campaign_history;
  v_recipient jsonb;
  v_client public.clients;
  v_status text;
  v_reason text;
  v_total integer := 0;
  v_eligible integer := 0;
  v_excluded integer := 0;
  v_scheduled_at timestamptz := coalesce(p_scheduled_at, now());
begin
  if not public.app_has_permission('emails', 'create') then
    raise exception 'Sem permissao para criar campanhas.' using errcode = '42501';
  end if;
  if nullif(trim(p_subject), '') is null or nullif(trim(p_body), '') is null then
    raise exception 'O assunto e o corpo sao obrigatorios.';
  end if;
  if p_campaign_type not in ('service', 'marketing') then
    raise exception 'Tipo de campanha invalido.';
  end if;
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then
    raise exception 'Selecione pelo menos um destinatario.';
  end if;
  if jsonb_array_length(p_recipients) > 2000 then
    raise exception 'Uma campanha nao pode exceder 2000 destinatarios.';
  end if;

  if nullif(trim(p_idempotency_key), '') is not null then
    select * into v_campaign
    from public.email_campaign_history
    where created_by = auth.uid() and idempotency_key = trim(p_idempotency_key);
    if found then return v_campaign; end if;
  end if;

  insert into public.email_campaign_history (
    subject, body, recipient_count, recipient_ids, group_name, status, scheduled_at,
    template_id, delivery_status, campaign_type, preheader, signature_html,
    from_name, from_email, reply_to, created_by, idempotency_key
  ) values (
    trim(p_subject), p_body, jsonb_array_length(p_recipients),
    array(select (item ->> 'client_id')::uuid from jsonb_array_elements(p_recipients) item),
    coalesce(p_group_name, ''),
    case when p_requires_approval then 'Rascunho' when v_scheduled_at > now() then 'Agendada' else 'Na fila' end,
    v_scheduled_at, p_template_id,
    case when p_requires_approval then 'draft' when v_scheduled_at > now() then 'scheduled' else 'queued' end,
    p_campaign_type, coalesce(p_preheader, ''), coalesce(p_signature_html, ''),
    trim(p_from_name), lower(trim(p_from_email)), nullif(lower(trim(p_reply_to)), ''),
    auth.uid(), nullif(trim(p_idempotency_key), '')
  ) returning * into v_campaign;

  for v_recipient in select value from jsonb_array_elements(p_recipients)
  loop
    v_total := v_total + 1;
    select * into v_client from public.clients where id = (v_recipient ->> 'client_id')::uuid;
    if not found or not public.app_can_access_client_id(v_client.id) then
      raise exception 'Destinatario fora do ambito autorizado.' using errcode = '42501';
    end if;
    if lower(trim(v_client.email)) <> lower(trim(v_recipient ->> 'email')) then
      raise exception 'O email do cliente % foi alterado. Atualize os destinatarios.', v_client.name;
    end if;

    v_status := 'pending';
    v_reason := null;
    if v_client.status in ('Inativo', 'Cancelado') then
      v_status := 'skipped';
      v_reason := 'Cliente inativo ou cancelado';
    elsif trim(v_client.email) !~* '^[A-Z0-9._%+''-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
      v_status := 'skipped';
      v_reason := 'Email invalido';
    elsif exists (
      select 1 from public.email_suppressions suppression
      where suppression.email_normalized = lower(trim(v_client.email)) and suppression.lifted_at is null
    ) then
      v_status := 'suppressed';
      v_reason := 'Endereco na lista de supressoes';
    elsif v_client.email_marketing_status = 'opted_out' then
      v_status := 'suppressed';
      v_reason := 'Cliente exerceu oposicao';
    elsif p_campaign_type = 'marketing'
      and v_client.email_marketing_status not in ('consented', 'legitimate_interest') then
      v_status := 'suppressed';
      v_reason := 'Sem consentimento/base registada para marketing';
    end if;

    if v_status = 'pending' then v_eligible := v_eligible + 1; else v_excluded := v_excluded + 1; end if;

    insert into public.email_campaign_recipients (
      campaign_id, client_id, recipient_name, email, email_normalized,
      rendered_subject, rendered_html, status, exclusion_reason, next_attempt_at, metadata
    ) values (
      v_campaign.id, v_client.id, coalesce(v_recipient ->> 'name', v_client.name), v_client.email,
      lower(trim(v_client.email)), v_recipient ->> 'subject', v_recipient ->> 'html',
      v_status, v_reason, v_scheduled_at,
      coalesce(v_recipient -> 'metadata', '{}'::jsonb)
    ) on conflict (campaign_id, email_normalized) do nothing;
  end loop;

  update public.email_campaign_history
  set recipient_count = v_total,
      eligible_count = v_eligible,
      excluded_count = v_excluded,
      delivery_status = case when v_eligible = 0 then 'failed' else delivery_status end,
      status = case when v_eligible = 0 then 'Falhou (nenhum destinatario elegivel)' else status end,
      last_error = case when v_eligible = 0 then 'Nenhum destinatario elegivel.' else null end
  where id = v_campaign.id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.claim_email_deliveries(
  p_limit integer default 25,
  p_campaign_id uuid default null
)
returns table (
  id uuid,
  campaign_id uuid,
  recipient_name text,
  email text,
  rendered_subject text,
  rendered_html text,
  attempts integer,
  max_attempts integer,
  unsubscribe_token uuid,
  from_name text,
  from_email text,
  reply_to text,
  preheader text,
  campaign_type text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.app_is_service_role() then
    raise exception 'Service role obrigatoria.' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select recipient.id
    from public.email_campaign_recipients recipient
    join public.email_campaign_history campaign on campaign.id = recipient.campaign_id
    where recipient.status in ('pending', 'retry')
      and recipient.next_attempt_at <= now()
      and recipient.attempts < recipient.max_attempts
      and campaign.delivery_status in ('queued', 'processing', 'scheduled')
      and coalesce(campaign.scheduled_at, now()) <= now()
      and (p_campaign_id is null or campaign.id = p_campaign_id)
      and not exists (
        select 1 from public.email_suppressions suppression
        where suppression.email_normalized = recipient.email_normalized and suppression.lifted_at is null
      )
    order by recipient.next_attempt_at, recipient.created_at
    for update of recipient skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ), claimed as (
    update public.email_campaign_recipients recipient
    set status = 'sending', attempts = recipient.attempts + 1, locked_at = now()
    from candidates
    where recipient.id = candidates.id
    returning recipient.*
  )
  select claimed.id, claimed.campaign_id, claimed.recipient_name, claimed.email,
    claimed.rendered_subject, claimed.rendered_html, claimed.attempts, claimed.max_attempts,
    claimed.unsubscribe_token, campaign.from_name, campaign.from_email, campaign.reply_to,
    campaign.preheader, campaign.campaign_type
  from claimed
  join public.email_campaign_history campaign on campaign.id = claimed.campaign_id;

  update public.email_campaign_history campaign
  set delivery_status = 'processing', status = 'A enviar', started_at = coalesce(started_at, now())
  where campaign.id in (
    select distinct recipient.campaign_id
    from public.email_campaign_recipients recipient
    where recipient.status = 'sending' and recipient.locked_at >= now() - interval '1 minute'
  );
end;
$$;

create or replace function public.refresh_email_campaign(p_campaign_id uuid)
returns public.email_campaign_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.email_campaign_history;
  v_pending integer;
  v_success integer;
  v_failure integer;
  v_bounce integer;
begin
  if not public.app_is_service_role() then
    raise exception 'Service role obrigatoria.' using errcode = '42501';
  end if;

  select
    count(*) filter (where status in ('pending', 'retry', 'sending')),
    count(*) filter (where status in ('accepted', 'delivered')),
    count(*) filter (where status in ('failed', 'complained')),
    count(*) filter (where status = 'bounced')
  into v_pending, v_success, v_failure, v_bounce
  from public.email_campaign_recipients where campaign_id = p_campaign_id;

  update public.email_campaign_history
  set success_count = v_success,
      failure_count = v_failure,
      bounce_count = v_bounce,
      delivery_status = case
        when delivery_status = 'cancelled' then 'cancelled'
        when v_pending > 0 then 'processing'
        when v_success > 0 and (v_failure + v_bounce) > 0 then 'partial'
        when v_success > 0 then 'completed'
        else 'failed'
      end,
      status = case
        when delivery_status = 'cancelled' then 'Cancelada'
        when v_pending > 0 then format('A enviar (%s concluidos)', v_success)
        when v_success > 0 and (v_failure + v_bounce) > 0 then format('Concluida (%s sucessos, %s falhas)', v_success, v_failure + v_bounce)
        when v_success > 0 then format('Concluida (%s sucessos)', v_success)
        else format('Falhou (%s erros)', v_failure + v_bounce)
      end,
      completed_at = case when v_pending = 0 then now() else completed_at end
  where id = p_campaign_id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.control_email_campaign(
  p_campaign_id uuid,
  p_action text,
  p_scheduled_at timestamptz default null
)
returns public.email_campaign_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.email_campaign_history;
begin
  if not public.app_has_permission('emails', 'edit') or not public.app_can_access_email_campaign(p_campaign_id) then
    raise exception 'Sem permissao para alterar esta campanha.' using errcode = '42501';
  end if;

  if p_action = 'cancel' then
    update public.email_campaign_history set delivery_status = 'cancelled', status = 'Cancelada' where id = p_campaign_id returning * into v_campaign;
    update public.email_campaign_recipients set status = 'cancelled'
    where campaign_id = p_campaign_id and status in ('pending', 'retry');
  elsif p_action = 'approve' then
    update public.email_campaign_history
      set delivery_status = case when coalesce(scheduled_at, now()) > now() then 'scheduled' else 'queued' end,
          status = case when coalesce(scheduled_at, now()) > now() then 'Agendada' else 'Na fila' end
      where id = p_campaign_id and delivery_status = 'draft'
      returning * into v_campaign;
  elsif p_action = 'reschedule' and p_scheduled_at is not null and p_scheduled_at > now() then
    update public.email_campaign_history set delivery_status = 'scheduled', status = 'Agendada', scheduled_at = p_scheduled_at
      where id = p_campaign_id and delivery_status in ('draft', 'scheduled', 'queued') returning * into v_campaign;
    update public.email_campaign_recipients set next_attempt_at = p_scheduled_at
      where campaign_id = p_campaign_id and status in ('pending', 'retry');
  else
    raise exception 'Acao invalida ou estado incompativel.';
  end if;

  if v_campaign.id is null then raise exception 'Campanha nao encontrada ou estado incompativel.'; end if;
  return v_campaign;
end;
$$;

revoke all on function public.app_can_access_email_campaign(uuid) from public, anon;
revoke all on function public.create_email_campaign(text,text,text,text,text,text,text,text,text,timestamptz,uuid,text,boolean,jsonb) from public, anon;
revoke all on function public.claim_email_deliveries(integer,uuid) from public, anon, authenticated;
revoke all on function public.refresh_email_campaign(uuid) from public, anon, authenticated;
revoke all on function public.control_email_campaign(uuid,text,timestamptz) from public, anon;

grant execute on function public.app_can_access_email_campaign(uuid) to authenticated, service_role;
grant execute on function public.create_email_campaign(text,text,text,text,text,text,text,text,text,timestamptz,uuid,text,boolean,jsonb) to authenticated, service_role;
grant execute on function public.claim_email_deliveries(integer,uuid) to service_role;
grant execute on function public.refresh_email_campaign(uuid) to service_role;
grant execute on function public.control_email_campaign(uuid,text,timestamptz) to authenticated, service_role;

update public.email_campaign_history
set delivery_status = case
  when status = 'Agendada' and scheduled_at > now() then 'scheduled'
  when lower(status) like 'falhou%' then 'failed'
  else 'completed'
end
where delivery_status = 'completed';
