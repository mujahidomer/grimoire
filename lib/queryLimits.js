const { getSupabase } = require('./supabase');

// Per-user daily chat rate limiting (query_usage table). One row per user per
// UTC day. A normal query costs 1 credit; a Deep Dive costs 3 (1 base + 2 extra),
// tracked as query_count +1 AND deep_count +1. Remaining credits are therefore
// DAILY_LIMIT - query_count - (deep_count * DEEP_EXTRA_COST).
//
// The server uses the service-role key (RLS bypassed), so every call scopes by
// user_id explicitly, matching the rest of the data layer.

const DAILY_LIMIT = 20;
const DEEP_EXTRA_COST = 2;        // deep search costs 2 extra credits (3 total)
const DEEP_TOTAL_COST = 1 + DEEP_EXTRA_COST;

// Today's date as a UTC YYYY-MM-DD string. The query_usage.date column is a DATE
// and we key the daily window on UTC so resetAt (midnight UTC) lines up exactly.
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// Midnight tonight UTC as an ISO string — when today's window resets.
function resetAtUtc() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0
  ));
  return next.toISOString();
}

function computeRemaining(queryCount, deepCount) {
  return DAILY_LIMIT - queryCount - (deepCount * DEEP_EXTRA_COST);
}

// Today's row for this user, or zeros if none exists yet.
async function getTodayRow(userId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('query_usage')
    .select('query_count, deep_count')
    .eq('user_id', userId)
    .eq('date', todayUtc())
    .maybeSingle();
  if (error) throw new Error(`query_usage read failed: ${error.message}`);
  return {
    queryCount: data?.query_count ?? 0,
    deepCount: data?.deep_count ?? 0
  };
}

// getUsage — today's usage snapshot for the frontend usage bar.
async function getUsage(userId) {
  const { queryCount, deepCount } = await getTodayRow(userId);
  return {
    queryCount,
    deepCount,
    remaining: computeRemaining(queryCount, deepCount),
    resetAt: resetAtUtc()
  };
}

// checkLimit — can this user run a (normal | deep) query right now? A deep query
// needs DEEP_TOTAL_COST credits free; a normal query needs 1.
async function checkLimit(userId, isDeep) {
  const { queryCount, deepCount } = await getTodayRow(userId);
  const remaining = computeRemaining(queryCount, deepCount);
  const needed = isDeep ? DEEP_TOTAL_COST : 1;
  return {
    allowed: remaining >= needed,
    remaining,
    resetAt: resetAtUtc()
  };
}

// incrementUsage — record one query against today's row. Upserts on
// (user_id, date); a deep query also bumps deep_count so it costs 3 total.
async function incrementUsage(userId, isDeep) {
  const sb = getSupabase();
  const { queryCount, deepCount } = await getTodayRow(userId);
  const { error } = await sb
    .from('query_usage')
    .upsert(
      {
        user_id: userId,
        date: todayUtc(),
        query_count: queryCount + 1,
        deep_count: deepCount + (isDeep ? 1 : 0)
      },
      { onConflict: 'user_id,date' }
    );
  if (error) throw new Error(`query_usage upsert failed: ${error.message}`);
}

module.exports = { getUsage, checkLimit, incrementUsage, DAILY_LIMIT, DEEP_TOTAL_COST };
