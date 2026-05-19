drop policy if exists "Public access for attachments bucket" on storage.objects;

create policy "Authenticated users can manage attachments bucket"
on storage.objects for all
to authenticated
using (bucket_id = 'attachments' and (select auth.role()) = 'authenticated')
with check (bucket_id = 'attachments' and (select auth.role()) = 'authenticated');
