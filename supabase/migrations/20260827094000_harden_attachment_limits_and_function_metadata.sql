-- Audit hardening: bound private attachment uploads and correct function
-- volatility metadata reported by plpgsql_check/Supabase DB lint.

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'application/octet-stream',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]::text[]
where id = 'attachments';

alter function public.app_default_module_permissions(text) stable;
