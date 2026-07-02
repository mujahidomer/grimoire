-- Grimoire — Backend Foundation schema (Doc A)
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
-- The full mature-product schema is provisioned here; only the tables flagged
-- "Build now" in Doc A carry application logic this phase. Everything else is
-- schema-only scaffolding so deferred features never force a migration.
--
-- Conventions (Doc A §Schema):
--   every table:  id uuid pk default gen_random_uuid()
--                 user_id uuid not null references auth.users
--                 created_at timestamptz default now()
--                 updated_at timestamptz default now()
--   RLS:          restricted to auth.uid() = user_id
-- Exceptions are noted inline (categories is a shared lookup; join/leaf tables
-- carry a denormalized user_id purely to keep RLS policies simple).

create extension if not exists "vector";

-- ─── updated_at trigger ───────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── categories (shared lookup, not user-scoped) ──────────────────────────────
-- The 10 fixed categories. A lookup table (not an enum) so an 11th category is a
-- one-row insert, never an ALTER TYPE. items.category FKs to categories(name).
create table if not exists categories (
  id   serial primary key,
  name text not null unique
);

insert into categories (name) values
  ('Food & Cooking'),
  ('Technology'),
  ('Health & Fitness'),
  ('Finance'),
  ('Learning & Education'),
  ('Entertainment'),
  ('Travel'),
  ('Business & Career'),
  ('Personal Development'),
  ('Other')
on conflict (name) do nothing;

-- ─── profiles (1:1 with auth.users) ───────────────────────────────────────────
-- Freemium + referral scaffolding. No logic this phase.
create table if not exists profiles (
  id            uuid primary key references auth.users on delete cascade,
  plan          text not null default 'free',
  referred_by   uuid references auth.users,
  referral_code text unique,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─── items (core saved-link table) ────────────────────────────────────────────
create table if not exists items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users on delete cascade,
  title               text not null,
  category            text not null references categories(name),
  type                text not null,                       -- 'video' | 'article'
  source_url          text not null,                       -- normalized on write
  date_saved          date not null,
  source              text not null default 'telegram',    -- how it entered Grimoire
  summary             text,
  key_takeaways       jsonb not null default '[]',         -- free-form value: nested object (new) or string[] (legacy)
  transcript          text,
  caption             text,
  artifact_type       text not null default 'none',        -- skill|tool|resource|person|concept|none
  artifact_name       text,
  artifact_url        text,
  artifact_url_source text,                                -- content|caption|linked resource
  skills              jsonb,                               -- DEPRECATED — superseded by entities; kept for transition. skill-type saves only.
  entities            jsonb,                               -- unified actionable entities: [{type, name, url, category_path, detail}]
  -- DEPRECATED — legacy/migration only; null on all new items.
  drive_file_id       text,
  drive_file_link     text,
  telegram_message_id text,
  -- Full-text search vector over the meaningful text. Generated, so it stays in
  -- sync automatically; queried by the keyword path in the retrieval API.
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),   'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')),  'B') ||
    setweight(to_tsvector('english', coalesce(transcript, '')),'C') ||
    setweight(to_tsvector('english', coalesce(caption, '')),  'C')
  ) stored,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (user_id, source_url)
);

create index if not exists items_user_idx        on items (user_id);
create index if not exists items_category_idx     on items (user_id, category);
create index if not exists items_search_idx       on items using gin (search_vector);
-- Backfill for deployments created before the skills column existed (create
-- table if not exists is a no-op on an existing table).
alter table items add column if not exists skills jsonb;
-- Unified entities array. Replaces the separate skills + highlights extraction;
-- skills is kept for now during the transition (don't drop yet).
alter table items add column if not exists entities jsonb;
alter table items add column if not exists data_version text default 'v1';
alter table items add column if not exists subcategory text;
update items set data_version = 'v1' where data_version is null;
-- Save-pipeline status: 'pending' (row created, extraction not started yet) ->
-- 'processing' (background job running) -> 'completed' | 'failed'. Existing
-- rows predate the async /api/save split and are fully saved, hence 'completed'.
alter table items add column if not exists status text not null default 'completed';
create index if not exists items_status_idx on items (status) where status in ('pending', 'processing');
-- ⚠️  MANUAL STEP FOR MUJI: run this block in the Supabase SQL editor BEFORE
--     deploying the category-dashboard release (it is idempotent and harmless
--     to the running app — old code never touches these columns).
-- Hierarchical categories:
--   * top_category — one of the fixed 13 top-level categories (closed list in
--     lib/topCategories.js). Null = saved before this feature / still
--     processing; the backfill script assigns it.
--   * category — REPURPOSED as the free-text topic subcategory under
--     top_category (LLM-generated, e.g. 'Prompt Engineering'). The FK to the
--     legacy 10-value categories lookup is dropped; `categories` remains only
--     as historical scaffolding.
--   * category_manually_set — true once the user manually moves an item;
--     save-time reclassification, consolidation, and backfill must all skip
--     such rows (enforced in their queries, see lib/repository.js).
alter table items add column if not exists top_category text;
alter table items add column if not exists category_manually_set boolean not null default false;
alter table items drop constraint if exists items_category_fkey;
create index if not exists items_top_category_idx on items (user_id, top_category);

-- ─── tags (canonical vocabulary) ──────────────────────────────────────────────
create table if not exists tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  added_date date not null default current_date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, name)
);
create index if not exists tags_user_idx on tags (user_id);

-- ─── item_tags (many-to-many join) ────────────────────────────────────────────
-- Carries its own user_id (denormalized from item/tag) so RLS is a flat
-- auth.uid() = user_id check, matching every other table.
create table if not exists item_tags (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  item_id            uuid not null references items on delete cascade,
  tag_id             uuid not null references tags on delete cascade,
  confidence_pending boolean not null default false,       -- the '?' low-confidence marker
  created_at         timestamptz default now(),
  unique (item_id, tag_id)
);
create index if not exists item_tags_item_idx on item_tags (item_id);
create index if not exists item_tags_tag_idx  on item_tags (tag_id);

-- ─── linked_resources (1:many off items) ──────────────────────────────────────
create table if not exists linked_resources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  item_id      uuid not null references items on delete cascade,
  title        text not null,
  type         text not null,                              -- product|article|resource
  source_url   text not null,                              -- normalized on write
  added_date   date not null default current_date,
  body_content text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (item_id, source_url)
);
create index if not exists linked_resources_item_idx on linked_resources (item_id);

-- ─── embeddings (pgvector semantic retrieval) — BUILT THIS PHASE ───────────────
create table if not exists embeddings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  item_id     uuid not null references items on delete cascade,
  chunk_index int not null,
  chunk_text  text not null,
  embedding   vector(1536),                                -- OpenAI text-embedding-3-small
  created_at  timestamptz default now(),
  unique (item_id, chunk_index)
);
create index if not exists embeddings_item_idx on embeddings (item_id);
-- Cosine-distance ANN index. lists=100 is fine for a personal-scale library;
-- raise it if the corpus grows large.
create index if not exists embeddings_vector_idx
  on embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ─── query_usage (per-user daily chat rate limits) — BUILT THIS PHASE ─────────
-- ⚠️  MANUAL STEP FOR MUJI: this table is NEW. Run the block below in the
--     Supabase SQL editor (Dashboard → SQL Editor) once — `create table if not
--     exists` is a no-op if you have already run it. The app's lib/queryLimits.js
--     reads/writes this table on every /api/chat call.
create table if not exists query_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  date date not null default current_date,
  query_count int not null default 0,
  deep_count int not null default 0,
  created_at timestamptz default now(),
  unique (user_id, date)
);

create index if not exists query_usage_user_date
on query_usage (user_id, date);

-- ─── api_tokens (future MCP server) — schema only, no logic ───────────────────
create table if not exists api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  token_hash   text not null,
  name         text,
  created_at   timestamptz default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- ─── chats + messages — schema only; /api/chat is stateless this phase ────────
create table if not exists chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  item_id    uuid references items on delete cascade,      -- null = library-wide chat
  title      text,
  created_at timestamptz default now()
);
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  chat_id    uuid not null references chats on delete cascade,
  role       text not null,
  content    text not null,
  created_at timestamptz default now()
);

-- ─── updated_at triggers ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['profiles','items','tags','linked_resources']
  loop
    execute format(
      'drop trigger if exists set_updated_at on %1$I;
       create trigger set_updated_at before update on %1$I
         for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- ─── Semantic search RPC ──────────────────────────────────────────────────────
-- Cosine-similarity search over embeddings, scoped to one user, returning one row
-- per item (best-matching chunk) above a relevance threshold. The threshold is
-- enforced here so an off-topic library returns NOTHING rather than nearest-but-
-- irrelevant rows (Doc A item 9). Similarity = 1 - cosine distance, in [0,1].
create or replace function match_items(
  query_embedding vector(1536),
  match_user      uuid,
  match_threshold float default 0.0,
  match_count     int   default 10
)
returns table (item_id uuid, similarity float)
language sql stable as $$
  select e.item_id, max(1 - (e.embedding <=> query_embedding)) as similarity
  from embeddings e
  where e.user_id = match_user
  group by e.item_id
  having max(1 - (e.embedding <=> query_embedding)) >= match_threshold
  order by similarity desc
  limit match_count;
$$;

-- ─── Read-only ad-hoc query RPC (library analytics / Job B) ───────────────────
-- Executes an LLM-generated SELECT against the user's library and returns the
-- rows as jsonb. Used by lib/libraryAnalytics.js for whole-library analytics
-- questions ("how many Instagram saves do I have?", "what are my main themes?").
--
-- Safety:
--   * Rejects anything that is not a single SELECT (regex guard).
--   * Wrapping the query inside `(<query>) q` makes statement-chaining (a
--     trailing `; drop ...`) a syntax error, so only one statement can run.
--   * Caps output at 100 rows.
--   * statement_timeout caps runtime at 10s.
-- The service role bypasses RLS, so the GENERATED SQL must scope by user_id
-- itself — the SQL-generator prompt enforces a `where user_id = '<uuid>'` filter.
create or replace function exec_read_query(query_text text)
returns jsonb
language plpgsql
set statement_timeout = '10s'
as $$
declare
  result jsonb;
begin
  if query_text !~* '^\s*select\y' then
    raise exception 'Only SELECT queries are allowed';
  end if;
  execute format(
    'select coalesce(jsonb_agg(row_to_json(q)), ''[]''::jsonb) from (%s) q',
    query_text
  ) into result;
  return result;
end;
$$;

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- Every user-scoped table: a user may only touch their own rows. The server's
-- service-role key bypasses RLS for pipeline writes; these policies protect the
-- anon/authenticated paths (UI, future MCP server).
alter table profiles         enable row level security;
alter table items            enable row level security;
alter table tags             enable row level security;
alter table item_tags        enable row level security;
alter table linked_resources enable row level security;
alter table embeddings       enable row level security;
alter table api_tokens       enable row level security;
alter table chats            enable row level security;
alter table messages         enable row level security;
alter table query_usage      enable row level security;
alter table categories       enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'items','tags','item_tags','linked_resources','embeddings',
    'api_tokens','chats','messages','query_usage'
  ]
  loop
    execute format('drop policy if exists owner_all on %I;', t);
    execute format(
      'create policy owner_all on %I
         for all using (auth.uid() = user_id)
         with check (auth.uid() = user_id);', t);
  end loop;
end $$;

-- profiles keys on id (= auth.users.id), not user_id.
drop policy if exists owner_all on profiles;
create policy owner_all on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- categories is a shared read-only lookup: any authenticated user may read it.
drop policy if exists read_all on categories;
create policy read_all on categories for select using (true);
