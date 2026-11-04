-- Instagram keyword gates: remembering which saved reels still need a comment.
--
-- Additive and idempotent. Both columns are nullable with no default, so every
-- existing row is untouched and insertNew keeps working without knowing they
-- exist.
--
-- gate_keyword     the word the creator asks you to comment ("DESIGN"), as
--                  detected from the caption. NULL means "not looked at yet";
--                  a row that was looked at and is not a gate is recorded in
--                  gate_checked_at with gate_keyword left NULL, so detection
--                  is not re-run over the whole library every time.
-- gate_checked_at  when detection last ran for this row.
-- gate_commented_at when the keyword was actually posted as a comment. The
--                  queue is "has a keyword, has not been commented".

alter table items add column if not exists gate_keyword      text;
alter table items add column if not exists gate_checked_at   timestamptz;
alter table items add column if not exists gate_commented_at timestamptz;

-- The queue read: one user's gated-but-uncommented Instagram saves, newest
-- first. Partial, so it indexes only the rows the queue can ever return.
create index if not exists items_gate_pending_idx
  on items (user_id, created_at desc)
  where gate_keyword is not null and gate_commented_at is null;
