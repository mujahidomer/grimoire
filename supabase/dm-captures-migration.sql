-- Instagram DM capture — run this in the Supabase SQL editor BEFORE deploying
-- the code. Deploy first and every save breaks, not just Instagram ones.
--
-- Idempotent: safe to run twice. Additive only — no existing row is touched,
-- no column is dropped, no other user's data is read or written.
-- These statements are already in supabase/schema.sql; this file is just the
-- subset that is new, written out standalone (schema.sql builds its RLS and
-- updated_at triggers in plpgsql loops that cannot be pasted piecemeal).

-- ─── 1. items.source_author ───────────────────────────────────────────────────
-- Creator handle (Instagram ownerUsername / X author) so an incoming Instagram
-- DM can be matched to the reel it came from. No backfill: only new saves.
alter table items add column if not exists source_author text;
create index if not exists items_source_author_idx on items (user_id, source_author);

-- ─── 2. dm_captures ───────────────────────────────────────────────────────────
-- One row per in-flight creator conversation. Written by the webhook pipeline
-- with the service-role key, so the flow survives a restart and a re-delivered
-- webhook cannot do the same work twice (processed_message_ids).
create table if not exists dm_captures (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  sender_igsid    text not null,
  sender_username text,
  state           text not null default 'awaiting_link',
    -- awaiting_link | replied | matched | needs_user | expired
  reply_attempts  int  not null default 0,
  links_seen      jsonb not null default '[]',   -- raw URLs, pre-resolution
  resolved_url    text,
  matched_item_id uuid references items(id) on delete set null,
  needs_user_reason text,  -- follow_gate | freeform_gate | hub_page | unusable_link | no_match | reply_failed | unknown_sender | reply_exhausted
  last_message_id text,    -- Meta's message id; idempotency key
  last_message_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  processed_message_ids jsonb not null default '[]'
);

create index if not exists dm_captures_user_state_idx
  on dm_captures (user_id, state);

-- At most one live capture per sender. Terminal states (matched, expired)
-- are excluded so a later reel from the same creator opens a fresh capture.
create unique index if not exists dm_captures_one_active_idx
  on dm_captures (user_id, sender_igsid)
  where state in ('awaiting_link', 'replied', 'needs_user');

-- ─── 3. append_dm_capture_message ─────────────────────────────────────────────
-- Atomically record a processed Meta message id. One UPDATE statement, so two
-- concurrent deliveries serialize on the row lock: the second re-evaluates its
-- WHERE against the first's committed row, sees the id, and updates nothing.
-- Returns true when this call recorded the id, false when it was already
-- recorded. Callers record AFTER the message's work succeeds, never before
-- (a lost message is unrecoverable; duplicate work is idempotent). Raises when
-- the capture does not exist for that user, so a wrong id is not mistaken for
-- a duplicate.
create or replace function append_dm_capture_message(
  p_user_id uuid, p_capture_id uuid, p_message_id text
) returns boolean
language plpgsql as $$
declare n int;
begin
  update dm_captures
     set processed_message_ids = processed_message_ids || to_jsonb(p_message_id)
   where id = p_capture_id
     and user_id = p_user_id
     and not jsonb_exists(processed_message_ids, p_message_id);
  get diagnostics n = row_count;
  if n = 0 and not exists (
    select 1 from dm_captures where id = p_capture_id and user_id = p_user_id
  ) then
    raise exception 'dm_capture % not found for user %', p_capture_id, p_user_id;
  end if;
  return n > 0;
end;
$$;

-- ─── 4. updated_at trigger (same function the other tables use) ───────────────
drop trigger if exists set_updated_at on dm_captures;
create trigger set_updated_at before update on dm_captures
  for each row execute function set_updated_at();

-- ─── 5. RLS ───────────────────────────────────────────────────────────────────
-- Same owner_all shape as items/tags/linked_resources. The backend's
-- service-role key bypasses this; it exists so a leaked anon key cannot read
-- another person's captures.
alter table dm_captures enable row level security;
drop policy if exists owner_all on dm_captures;
create policy owner_all on dm_captures
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
