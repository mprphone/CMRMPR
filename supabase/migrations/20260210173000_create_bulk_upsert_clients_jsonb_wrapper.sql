create or replace function public.bulk_upsert_clients_jsonb(clients_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bulk_upsert_clients(clients_data::jsonb);
end;
$$;

grant execute on function public.bulk_upsert_clients_jsonb(jsonb) to anon, authenticated, service_role;
