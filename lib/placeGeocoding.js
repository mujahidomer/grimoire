// Google-backed location resolution for "place" entities.
//
// Same architecture as passageVerification: the geo facts live on the item's
// entities blob (entity.detail.location), written by a fire-and-forget
// save-time hook plus an on-demand sweep. canonical_entities is untouched —
// the registry answers "which shelf", items answer "where is it", exactly the
// split the passage pipeline established for Arabic text.
//
// Two Google surfaces, both keyed by GOOGLE_MAPS_API_KEY (Places API (New)):
//  - Text Search  → one-time geocode: place_id + lat/lng + address, persisted.
//  - Place Details → live richness (rating, hours, photo), proxied through
//    GET /api/places/:placeId so the key never ships in the app, with a
//    24h in-memory cache since venue facts move slowly.
//
// No key configured → geocoding marks entities "skipped_no_key" (retryable on
// a later sweep) and the details proxy 503s. Saving never breaks.

const PLACES_BASE = 'https://places.googleapis.com/v1';

function apiKey() {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  return key || null;
}

// ─── Text Search: name (+ extracted city/country) → one geocoded candidate ──

const SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.googleMapsUri',
].join(',');

async function searchPlace(query) {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': SEARCH_FIELDS,
    },
    body: JSON.stringify({ textQuery: query, pageSize: 1 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Places text search ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data.places) && data.places[0] ? data.places[0] : null;
}

// Build the search query from what extraction gave us. City/country pin the
// search down — "Salt" alone finds the wrong continent; "Salt, Dubai, United
// Arab Emirates" finds the burger spot on Kite Beach.
function searchQuery(entity) {
  const detail = entity.detail || {};
  const parts = [entity.name];
  if (typeof detail.city === 'string' && detail.city.trim()) parts.push(detail.city.trim());
  if (typeof detail.country === 'string' && detail.country.trim()) parts.push(detail.country.trim());
  return parts.join(', ');
}

// Statuses a later sweep may retry. "not_found" is terminal on purpose:
// re-searching a place Google doesn't know just burns quota every sweep.
const RETRYABLE = new Set(['error', 'skipped_no_key']);

function needsGeocode(entity) {
  if (!entity || entity.type !== 'place') return false;
  const loc = entity.detail && entity.detail.location;
  return !loc || RETRYABLE.has(loc.status);
}

// Resolve one entity in place: writes entity.detail.location and returns it.
async function geocodeEntity(entity) {
  const detail = { ...(entity.detail || {}) };
  if (!apiKey()) {
    detail.location = { status: 'skipped_no_key' };
  } else {
    try {
      const place = await searchPlace(searchQuery(entity));
      detail.location = place
        ? {
            status: 'resolved',
            place_id: place.id,
            lat: place.location?.latitude ?? null,
            lng: place.location?.longitude ?? null,
            address: place.formattedAddress || null,
            maps_url: place.googleMapsUri || null,
            resolved_name: place.displayName?.text || null,
          }
        : { status: 'not_found', note: `no result for "${searchQuery(entity)}"` };
    } catch (err) {
      detail.location = { status: 'error', note: err.message };
    }
  }
  entity.detail = detail;
  return detail.location;
}

// Fire-and-forget save-time hook (mirrors verifyItemEntitiesInBackground):
// re-reads the just-saved item, geocodes any place entities without a
// resolved location, writes the enriched entities back. Never throws.
function geocodeItemEntitiesInBackground(itemId, userId) {
  (async () => {
    const { getSupabase } = require('./supabase');
    const sb = getSupabase();
    const { data: item, error } = await sb
      .from('items').select('id, entities').eq('id', itemId).eq('user_id', userId).single();
    if (error || !item) return;

    const entities = item.entities || [];
    if (!entities.some(needsGeocode)) return;

    for (const entity of entities) {
      if (!needsGeocode(entity)) continue;
      const loc = await geocodeEntity(entity);
      console.log(`[geocode] place "${entity.name}" → ${loc.status}${loc.address ? ` (${loc.address})` : ''}`);
    }

    const { error: updErr } = await sb
      .from('items').update({ entities }).eq('id', itemId).eq('user_id', userId);
    if (updErr) console.error(`[geocode] write-back failed for ${itemId}: ${updErr.message}`);
  })().catch(err => console.error(`[geocode] background geocoding failed: ${err.message}`));
}

// On-demand sweep over every item (the place-type twin of sweepEntities'
// meta-category pass): geocode all place entities still lacking a resolved
// location. Serves both the one-off backfill and the iOS sweep button.
async function geocodePendingPlaces({ userId }) {
  if (!userId) { const e = new Error('userId is required'); e.status = 400; throw e; }
  const { getSupabase } = require('./supabase');
  const sb = getSupabase();
  const { data: items, error } = await sb
    .from('items')
    .select('id, entities')
    .eq('user_id', userId)
    .not('entities', 'is', null);
  if (error) throw new Error(`geocode sweep items read failed: ${error.message}`);

  let scanned = 0, resolved = 0, failed = 0, itemsUpdated = 0;
  for (const item of items || []) {
    const entities = Array.isArray(item.entities) ? item.entities : [];
    const pending = entities.filter(needsGeocode);
    if (pending.length === 0) continue;

    for (const entity of pending) {
      scanned += 1;
      const loc = await geocodeEntity(entity);
      if (loc.status === 'resolved') resolved += 1; else failed += 1;
      console.log(`[geocode] place "${entity.name}" → ${loc.status}`);
    }

    const { error: updErr } = await sb
      .from('items').update({ entities }).eq('id', item.id).eq('user_id', userId);
    if (updErr) throw new Error(`geocode sweep write failed: ${updErr.message}`);
    itemsUpdated += 1;
  }
  return { scanned, resolved, failed, itemsUpdated };
}

// ─── Place Details proxy ─────────────────────────────────────────────────────

const DETAILS_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'internationalPhoneNumber',
  'rating',
  'userRatingCount',
  'priceLevel',
  'currentOpeningHours.openNow',
  'currentOpeningHours.weekdayDescriptions',
  'websiteUri',
  'googleMapsUri',
  'photos',
].join(',');

const DETAILS_TTL_MS = 24 * 60 * 60 * 1000;
const detailsCache = new Map(); // place_id → { at, payload }

async function getPlaceDetails(placeId) {
  if (!apiKey()) { const e = new Error('GOOGLE_MAPS_API_KEY is not configured'); e.status = 503; throw e; }
  if (!placeId || typeof placeId !== 'string') { const e = new Error('placeId is required'); e.status = 400; throw e; }

  const cached = detailsCache.get(placeId);
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.payload;

  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': DETAILS_FIELDS },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`Place details ${res.status}: ${body.slice(0, 200)}`);
    e.status = res.status === 404 ? 404 : 502;
    throw e;
  }
  const place = await res.json();

  // One representative photo, resolved to a plain https URL the app can load
  // directly (skipHttpRedirect returns the googleusercontent URI as JSON
  // instead of 302ing image bytes through us).
  let photoUrl = null;
  const photoName = Array.isArray(place.photos) && place.photos[0] ? place.photos[0].name : null;
  if (photoName) {
    try {
      const photoRes = await fetch(
        `${PLACES_BASE}/${photoName}/media?maxWidthPx=1000&skipHttpRedirect=true&key=${apiKey()}`
      );
      if (photoRes.ok) photoUrl = (await photoRes.json()).photoUri || null;
    } catch { /* photo is decoration — never fail details over it */ }
  }

  const payload = {
    place_id: place.id,
    name: place.displayName?.text || null,
    address: place.formattedAddress || null,
    phone: place.internationalPhoneNumber || null,
    rating: place.rating ?? null,
    rating_count: place.userRatingCount ?? null,
    price_level: place.priceLevel || null,
    open_now: place.currentOpeningHours?.openNow ?? null,
    opening_hours: place.currentOpeningHours?.weekdayDescriptions || null,
    website: place.websiteUri || null,
    maps_url: place.googleMapsUri || null,
    photo_url: photoUrl,
  };
  detailsCache.set(placeId, { at: Date.now(), payload });
  return payload;
}

module.exports = {
  geocodeEntity,
  geocodeItemEntitiesInBackground,
  geocodePendingPlaces,
  getPlaceDetails,
  needsGeocode,
};
