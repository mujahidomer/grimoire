const { extractContent } = require('./extractor');
const { processLinkedResource, extractEntities } = require('./classifier');
const { upsertLinkedResource, mergeItemEntities, getItemById, getSubcategoryVocabulary,
  linkedResourceCreatorConflict } = require('./repository');
const { resolveEntities } = require('./entityResolution');
const { verifyItemEntitiesInBackground } = require('./passageVerification');
const { geocodeItemEntitiesInBackground } = require('./placeGeocoding');
const { resolveEntityUrlsInBackground } = require('./entityUrlResolution');

// ─── Linked-resource digest entries ───────────────────────────────────────────
// A linked resource is an extension of the save it hangs off, not an item of
// its own (Muji 2026-07-25): it gets the same extraction → entity → canonical
// resolution → verification/geocoding treatment as a save, but its entities
// land on the PARENT item's blob, so they show up in that item's Digest tab
// and in the global Digest. Its summary/takeaways are not kept — only the
// digest entries.
//
// Never throws: failing to mine entities out of a follow-up link must not fail
// the attach (or the save) that triggered it.
async function attachResourceEntities(itemId, userId, sourceUrl, text) {
  if (!text || !text.trim()) return 0;
  try {
    const subcategoryVocab = await getSubcategoryVocabulary();
    const entities = await extractEntities(text, sourceUrl, subcategoryVocab);
    if (entities.length === 0) return 0;

    // Canonicalize before the write, same ordering constraint as the main
    // pipeline: `entities` is one jsonb blob, so resolution has to land
    // before it's persisted, not after.
    await resolveEntities(entities);
    const { added } = await mergeItemEntities(itemId, userId, entities);
    if (added > 0) {
      verifyItemEntitiesInBackground(itemId, userId);
      geocodeItemEntitiesInBackground(itemId, userId);
      resolveEntityUrlsInBackground(entities);
    }
    console.log(`[linkedResource] ${sourceUrl} → ${added} new entit${added === 1 ? 'y' : 'ies'} on item ${itemId}`);
    return added;
  } catch (err) {
    console.error(`[linkedResource] entity extraction failed for ${sourceUrl}:`, err.message);
    return 0;
  }
}

// Extracts + classifies the link, upserts it onto the item, mines it for digest
// entries that land on that item, then returns the item's refreshed
// linked_resources. The caller owns auth and the item-exists check.
//
// The entity pass runs inline rather than detached: extractContent above
// already dominates this request's latency, and the client sits on a spinner
// then refetches the item — so finishing here is what makes the new digest
// entries visible on the page the user is already looking at.
async function attachLinkedResource(itemId, userId, url) {
  let extracted = null;
  let blocked = null;
  try { extracted = await extractContent(url); }
  catch (err) {
    if (err.blocked) blocked = err.message;
    console.error('Linked resource extraction failed:', err.message);
  }

  // Two reasons not to write the row at all. Both were found on the same page:
  // a CAPTCHA-walled tracker that sixteen reels pointed at (2026-11-05).
  //
  //  - A page we were blocked from reading is a receipt for a failed read, not
  //    an attachment. Stored, it puts a resource titled "(Blocked by CAPTCHA)"
  //    under the save and mines nothing out of it.
  //  - One URL across two creators' reels means the resolution is wrong. The
  //    first creator keeps it; the rest don't get a copy.
  //
  // `skipped` tells a caller acting on the user's behalf (the DM tray) why
  // nothing was attached, so it can park the capture instead of reporting a
  // clean success.
  const skip = blocked ? 'blocked_page' : null;
  const clash = skip ? null : await linkedResourceCreatorConflict(userId, itemId, url);
  if (skip || clash) {
    const why = skip ? blocked : `already attached to @${clash}'s save`;
    console.warn(`[linkedResource] not attaching ${url} to item ${itemId}: ${why}`);
    const current = await getItemById(itemId, userId);
    return {
      linked_resources: current?.linked_resources || [],
      content_extracted: false,
      skipped: skip || 'other_creator',
    };
  }

  const processed = await processLinkedResource(extracted?.text || '', extracted?.title);
  await upsertLinkedResource(itemId, userId, {
    source_url: url,
    title: processed.title,
    type: processed.resource_type,
    body_content: processed.content
  });

  await attachResourceEntities(itemId, userId, url, extracted?.text);

  const refreshed = await getItemById(itemId, userId);
  // content_extracted: false means the page could not be read, so the resource
  // was stored empty. The attach still happened; callers that act on a user's
  // behalf (the DM tray) say so rather than reporting a clean success.
  return {
    linked_resources: refreshed.linked_resources || [],
    content_extracted: Boolean(extracted?.text && extracted.text.trim())
  };
}

module.exports = { attachLinkedResource, attachResourceEntities };
