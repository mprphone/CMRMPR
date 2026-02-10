alter table if exists public.email_campaign_history
add column if not exists recipient_ids text[] not null default '{}'::text[],
add column if not exists recipient_results jsonb not null default '[]'::jsonb,
add column if not exists scheduled_at timestamptz,
add column if not exists send_delay integer,
add column if not exists template_id uuid;
