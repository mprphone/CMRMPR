-- Rastreio de abertura de email via pixel invisível (com as limitações
-- conhecidas do setor: Apple Mail pré-carrega imagens quase sempre,
-- Gmail/Outlook por vezes bloqueiam-nas por omissão).

alter table public.email_campaign_recipients
  add column if not exists opened_at timestamptz,
  add column if not exists open_count integer not null default 0;

create or replace function public.register_email_open(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient public.email_campaign_recipients;
begin
  select * into v_recipient
  from public.email_campaign_recipients
  where unsubscribe_token = p_token;

  if not found then return; end if;

  update public.email_campaign_recipients
  set opened_at = coalesce(opened_at, now()),
      open_count = open_count + 1
  where id = v_recipient.id;

  insert into public.email_delivery_events (recipient_id, campaign_id, event_type, payload)
  values (v_recipient.id, v_recipient.campaign_id, 'opened', '{}'::jsonb);
end;
$$;

revoke all on function public.register_email_open(uuid) from public, anon, authenticated;
grant execute on function public.register_email_open(uuid) to service_role;
