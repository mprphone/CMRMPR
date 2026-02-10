alter table if exists public.email_campaign_history
add column if not exists recipient_results jsonb not null default '[]'::jsonb;
