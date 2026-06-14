-- Grimoire — Storage bucket for web-UI uploads (PDFs + screenshots).
-- Run once in the Supabase SQL editor after schema.sql.
--
-- The web app (web/lib/api.ts → uploadFile) uploads files straight to this
-- bucket, then hands the resulting public URL to POST /api/save. The Railway
-- backend (lib/extractor.js) detects the .../storage/v1/object/... URL and
-- routes it to the PDF or image pipeline. Reads go through the public URL, so
-- the bucket is public; writes are restricted to each user's own folder.
--
-- Convention: objects are stored under `<auth.uid()>/<filename>` so the first
-- path segment scopes ownership for the RLS policies below.

-- ─── Bucket ───────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = excluded.public;

-- ─── RLS policies on storage.objects (scoped to the `uploads` bucket) ──────────
-- RLS is already enabled on storage.objects by Supabase; we just add policies.

-- Public read: anyone (including the backend's unauthenticated fetch) can read.
drop policy if exists "uploads public read" on storage.objects;
create policy "uploads public read"
  on storage.objects for select
  using (bucket_id = 'uploads');

-- Authenticated users may upload only into their own `<uid>/...` folder.
drop policy if exists "uploads owner insert" on storage.objects;
create policy "uploads owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users may update/delete only their own objects.
drop policy if exists "uploads owner update" on storage.objects;
create policy "uploads owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads owner delete" on storage.objects;
create policy "uploads owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
