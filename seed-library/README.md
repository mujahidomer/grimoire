# Starter library (seed content)

These are the pre-processed items a new user can pre-load during onboarding
(`/seed-picker` → signup → `POST /api/seed`).

## How it works

- **`catalog.json`** — the canonical `id → url → segment` list. Keep its ids in
  sync with `web/lib/seed-catalog.ts` (the web catalog adds titles/summaries for
  the picker cards; the ids must match exactly).
- **`<id>.md`** — one finished, structured Markdown file per catalog item, in the
  same format the capture pipeline writes (front-matter + `## Summary` /
  `## Key Takeaways` / `## Transcript` …). **These are what get copied into a
  user's library.** They are intentionally **not** committed pre-built — generate
  them before launch.
- At runtime `lib/seed.js` parses `<id>.md` with the existing `md-parse` and
  upserts it via the repository layer (same path as the Drive→Postgres
  migration). The live extraction/classification pipeline is **never** run during
  signup.

## Generating the MD files (one-time, pre-launch)

```bash
# Needs the same env as the server (SUPADATA_API_KEY, model keys, etc.)
node scripts/build-seed-library.js            # build any missing files
node scripts/build-seed-library.js --force    # rebuild everything
node scripts/build-seed-library.js --only ai-karpathy-llms
```

The script runs each catalog URL through `extractContent` → `processContent` →
`renderItemAsMarkdown` and writes `seed-library/<id>.md`. Review the output (it's
just Markdown) and edit by hand where the auto-summary is weak.

## Required front-matter

Each `<id>.md` must have at least a `source_url` (the seeding upsert is keyed on
`(user_id, source_url)`). Typical front-matter:

```yaml
---
title: Andrej Karpathy: How LLMs work
category: Technology
type: video
source_url: https://www.youtube.com/watch?v=zjkBMFhNj_g
tags: [llm, ai, fundamentals]
---
```

## Adding more items / backfilling thin tabs

Recipes currently has **no** live items and Islamic has **one** (the rest of the
originally-spec'd URLs 404'd). To add content:

1. Add an entry to `catalog.json` **and** to `web/lib/seed-catalog.ts` (same id).
2. Run `node scripts/build-seed-library.js --only <id>`.
3. Commit the new `<id>.md`.

If an `<id>.md` is missing at runtime, `/api/seed` logs a warning and skips just
that item — the rest of the batch still seeds.
