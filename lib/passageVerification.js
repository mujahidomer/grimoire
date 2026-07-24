// Verification + enrichment for quoted Islamic passages (dua / hadith / quranic_verse
// entities). The LLM only *resolves* a passage to a candidate canonical source; the
// canonical text itself is always fetched from an authoritative dataset and the match
// is re-checked deterministically here, so a hallucinated reference cannot get stamped
// as verified.
//
// Ground truth:
//   - Quran:  api.quran.com v4 (Uthmani text, Saheeh International translation)
//   - Hadith: fawazahmed0/hadith-api CDN (sunnah.com-sourced JSON incl. scholar grades)
const { getAnthropicClient } = require('./anthropicClient');

const MODEL = process.env.PASSAGE_VERIFY_MODEL || 'claude-sonnet-5';

const HADITH_COLLECTIONS = {
  bukhari: 'Sahih al-Bukhari',
  muslim: 'Sahih Muslim',
  abudawud: 'Sunan Abi Dawud',
  tirmidhi: "Jami' at-Tirmidhi",
  nasai: "Sunan an-Nasa'i",
  ibnmajah: 'Sunan Ibn Majah',
  malik: 'Muwatta Malik',
  nawawi: 'An-Nawawi 40 Hadith',
  qudsi: '40 Hadith Qudsi',
  dehlawi: '40 Hadith of Shah Waliullah Dehlawi',
};

// Additional books served from the AhmedBaset/hadith-json dataset (also
// sunnah.com-sourced; Arabic + English, no grades). `ahmad` matches
// sunnah.com's partial Musnad Ahmad selection.
const EXTENDED_BOOKS = {
  ahmad:          { file: 'the_9_books/ahmed.json',              name: 'Musnad Ahmad',          slug: 'ahmad' },
  darimi:         { file: 'the_9_books/darimi.json',             name: 'Sunan ad-Darimi',       slug: 'darimi' },
  riyadussalihin: { file: 'other_books/riyad_assalihin.json',    name: 'Riyad as-Salihin',      slug: 'riyadussalihin' },
  bulugh:         { file: 'other_books/bulugh_almaram.json',     name: 'Bulugh al-Maram',       slug: 'bulugh' },
  mishkat:        { file: 'other_books/mishkat_almasabih.json',  name: 'Mishkat al-Masabih',    slug: 'mishkat' },
  adab:           { file: 'other_books/aladab_almufrad.json',    name: 'Al-Adab Al-Mufrad',     slug: 'adab' },
  shamail:        { file: 'other_books/shamail_muhammadiyah.json', name: "Shama'il Muhammadiyah", slug: 'shamail' },
};

// Primary collections in the search corpus load from the SAME dataset the
// numbered lookups use (fawazahmed0 full-book Arabic files), so a hadith
// number surfaced by search always agrees with lookup_hadith / sunnah.com
// numbering. (hadith-json's copies of these books number differently —
// citing its numbers made verification fail its own independent check.)
const SEARCH_ONLY_BOOKS = ['bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah', 'malik'];

const fetchFn = typeof fetch === 'function' ? fetch : require('node-fetch');

// ---------------------------------------------------------------------------
// Arabic normalization + fuzzy matching
// ---------------------------------------------------------------------------

// Strip tashkeel/tatweel and unify letter variants so transcription-level
// differences don't defeat matching.
function normalizeArabic(s) {
  return (s || '')
    .replace(/[ً-ٰٟـۖ-ۭ]/g, '') // harakat, quranic marks, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ئى]/g, 'ي')
    .replace(/ة/g, 'ه')
    // Keep Arabic LETTERS only — this also drops Arabic punctuation (،؛؟),
    // which otherwise glues onto tokens and defeats containment matching.
    .replace(/[^ء-ي\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fraction of the passage's tokens found in the canonical text (multiset
// containment). The passage is usually a excerpt of a longer hadith (which
// includes the isnad), so containment — not symmetric similarity — is the
// right test.
function containmentScore(passageAr, canonicalAr) {
  const passage = normalizeArabic(passageAr).split(' ').filter(Boolean);
  if (passage.length === 0) return 0;
  const pool = new Map();
  for (const tok of normalizeArabic(canonicalAr).split(' ')) {
    pool.set(tok, (pool.get(tok) || 0) + 1);
  }
  let hit = 0;
  for (const tok of passage) {
    const n = pool.get(tok) || 0;
    if (n > 0) { hit++; pool.set(tok, n - 1); }
  }
  return hit / passage.length;
}

// ---------------------------------------------------------------------------
// Canonical lookups
// ---------------------------------------------------------------------------

async function getJson(url) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

// verseKey: "2:256" or a range "78:31-36" (same surah only).
async function lookupQuran(verseKey) {
  const m = /^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/.exec((verseKey || '').trim());
  if (!m) throw new Error(`invalid verse key: ${verseKey}`);
  const surah = Number(m[1]);
  const first = Number(m[2]);
  const last = m[3] ? Number(m[3]) : first;
  if (last < first || last - first > 20) throw new Error(`invalid verse range: ${verseKey}`);

  const arabic = [];
  const translation = [];
  for (let v = first; v <= last; v++) {
    const data = await getJson(
      `https://api.quran.com/api/v4/verses/by_key/${surah}:${v}?words=false&translations=20&fields=text_uthmani`
    );
    arabic.push(data.verse.text_uthmani);
    const t = (data.verse.translations?.[0]?.text || '')
      .replace(/<sup[^>]*>.*?<\/sup>/g, '')
      .trim();
    translation.push(t);
  }
  return {
    kind: 'quran',
    reference: `Quran ${surah}:${first}${last !== first ? `-${last}` : ''}`,
    arabic: arabic.join(' '),
    translation: translation.join(' '),
    translation_source: 'Saheeh International',
    source_url: `https://quran.com/${surah}/${first}${last !== first ? `-${last}` : ''}`,
  };
}

// Lazily downloaded + trimmed per-book index for extended lookups and
// full-text search. Cached for the process lifetime (backfill run / server).
const bookCache = new Map();

async function loadBook(key) {
  if (bookCache.has(key)) return bookCache.get(key);
  let rows;
  if (EXTENDED_BOOKS[key]) {
    const data = await getJson(`https://cdn.jsdelivr.net/gh/AhmedBaset/hadith-json@main/db/by_book/${EXTENDED_BOOKS[key].file}`);
    rows = (data.hadiths || []).map(h => {
      const norm = normalizeArabic(h.arabic);
      return {
        idInBook: h.idInBook,
        arabic: h.arabic,
        narrator: h.english?.narrator || null,
        english: h.english?.text || null,
        norm,
        tokens: new Set(norm.split(' ')),
      };
    });
  } else if (SEARCH_ONLY_BOOKS.includes(key)) {
    const data = await getJson(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-${key}.json`);
    rows = (data.hadiths || []).map(h => {
      const norm = normalizeArabic(h.text);
      return {
        idInBook: h.hadithnumber,
        arabic: h.text,
        narrator: null,
        english: null,
        norm,
        tokens: new Set(norm.split(' ')),
      };
    });
  } else {
    throw new Error(`unknown book "${key}"`);
  }
  bookCache.set(key, rows);
  return rows;
}

async function lookupHadithExtended(coll, hadithNumber) {
  const book = EXTENDED_BOOKS[coll];
  const num = Number(hadithNumber);
  const rows = await loadBook(coll);
  const row = rows.find(h => h.idInBook === num);
  if (!row) throw new Error(`hadith ${coll}:${hadithNumber} not found (book has ${rows.length} hadiths)`);
  return {
    kind: 'hadith',
    reference: `${book.name} ${num}`,
    collection: coll,
    hadith_number: String(num),
    arabic: row.arabic,
    english: [row.narrator, row.english].filter(Boolean).join(' '),
    grades: [],
    section: null,
    source_url: `https://sunnah.com/${book.slug}:${num}`,
  };
}

// Full-text Arabic search across every book in the corpus: score each hadith
// by how much of the (normalized) query it contains. This is how a passage
// with no usable reference gets located.
async function searchHadith(query, books) {
  const corpus = (Array.isArray(books) && books.length ? books : [
    ...SEARCH_ONLY_BOOKS, ...Object.keys(EXTENDED_BOOKS),
  ]).map(b => String(b).toLowerCase().trim());

  const queryNorm = normalizeArabic(query);
  const queryTokens = queryNorm.split(' ').filter(Boolean);
  if (queryTokens.length < 2) throw new Error('query too short — pass a distinctive Arabic phrase');

  const hits = [];
  for (const key of corpus) {
    if (!EXTENDED_BOOKS[key] && !SEARCH_ONLY_BOOKS.includes(key)) continue;
    const rows = await loadBook(key);
    const bookName = EXTENDED_BOOKS[key]?.name || HADITH_COLLECTIONS[key] || key;
    for (const row of rows) {
      let hit = 0;
      for (const tok of queryTokens) if (row.tokens.has(tok)) hit++;
      let score = hit / queryTokens.length;
      if (score >= 0.5 && row.norm.includes(queryNorm)) score += 0.5;
      if (score >= 0.6) {
        hits.push({
          collection: key,
          book: bookName,
          hadith_number: row.idInBook,
          score: Number(score.toFixed(2)),
          narrator: row.narrator,
          arabic: row.arabic.length > 700 ? row.arabic.slice(0, 700) + '…' : row.arabic,
          english: row.english ? (row.english.length > 500 ? row.english.slice(0, 500) + '…' : row.english) : null,
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return { matches: hits.slice(0, 5), total_matches: hits.length };
}

async function lookupHadith(collection, hadithNumber) {
  const coll = String(collection || '').toLowerCase().trim();
  if (EXTENDED_BOOKS[coll]) return lookupHadithExtended(coll, hadithNumber);
  if (!HADITH_COLLECTIONS[coll]) {
    throw new Error(`unknown collection "${collection}" — available: ${[...Object.keys(HADITH_COLLECTIONS), ...Object.keys(EXTENDED_BOOKS)].join(', ')}`);
  }
  const num = String(hadithNumber).trim();
  const base = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';
  const [ara, eng] = await Promise.all([
    getJson(`${base}/ara-${coll}/${num}.json`),
    getJson(`${base}/eng-${coll}/${num}.json`),
  ]);
  const araH = ara.hadiths?.[0];
  const engH = eng.hadiths?.[0];
  if (!araH || !engH) throw new Error(`hadith ${coll}:${num} not found`);
  return {
    kind: 'hadith',
    reference: `${HADITH_COLLECTIONS[coll]} ${num}`,
    collection: coll,
    hadith_number: num,
    arabic: araH.text,
    english: engH.text,
    grades: (engH.grades || []).filter(g => g && g.name && g.grade),
    section: Object.values(eng.metadata?.section || {})[0] || null,
    source_url: `https://sunnah.com/${coll}:${num}`,
  };
}

// ---------------------------------------------------------------------------
// LLM resolution loop
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'lookup_quran',
    description: 'Fetch the canonical Uthmani Arabic and Saheeh International translation for a verse or short range, e.g. "2:256" or "78:31-36".',
    input_schema: {
      type: 'object',
      properties: { verse_key: { type: 'string' } },
      required: ['verse_key'],
    },
  },
  {
    name: 'lookup_hadith',
    description: 'Fetch the canonical Arabic and English for a hadith by number. Collections: bukhari, muslim, abudawud, tirmidhi, nasai, ibnmajah, malik, nawawi, qudsi, dehlawi (these include scholar grades), plus ahmad (partial Musnad Ahmad, sunnah.com numbering), darimi, riyadussalihin, bulugh, mishkat, adab, shamail (no grades).',
    input_schema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        hadith_number: { type: 'string' },
      },
      required: ['collection', 'hadith_number'],
    },
  },
  {
    name: 'search_hadith',
    description: 'Full-text search across all collections by a distinctive ARABIC phrase from the passage (diacritics/hamza variants are normalized away). Use when the reference is unknown, wrong, or the numbered lookup keeps missing. Returns the top matches with collection + hadith number, which you can then confirm via lookup_hadith.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A distinctive Arabic phrase (3+ words) from the passage.' },
        books: {
          type: 'array', items: { type: 'string' },
          description: 'Optional subset of collections to search; omit to search everything.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'finish',
    description: 'Report your final verdict for this passage.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['matched', 'unsourced', 'not_found'],
          description: 'matched = confirmed against a lookup result you made. unsourced = a genuine supplication/saying but not from the Quran or a canonical hadith collection (e.g. a contemporary or viral dua). not_found = likely canonical but you could not locate it (e.g. collection not available in the lookup tool).',
        },
        kind: { type: 'string', enum: ['quran', 'hadith'], description: 'Only when matched.' },
        verse_key: { type: 'string', description: 'When matched quran, e.g. "2:256" or "78:31-36".' },
        collection: { type: 'string', description: 'When matched hadith.' },
        hadith_number: { type: 'string', description: 'When matched hadith.' },
        corrected_arabic: {
          type: 'string',
          description: 'The exact Arabic of the quoted passage COPIED from the lookup result (the relevant excerpt for hadith — matn only, no isnad). Never compose Arabic yourself.',
        },
        corrected_translation: { type: 'string', description: 'Accurate English translation of corrected_arabic. Prefer the lookup translation, trimmed to the quoted passage.' },
        narrator: { type: 'string', description: 'Narrating companion when known, e.g. "Shaddad ibn Aws".' },
        notes: { type: 'string', description: 'Short note on anything a reader should know: authenticity discussion, saved text was garbled, reference was wrong, etc.' },
        saved_text_issues: {
          type: 'array',
          items: { type: 'string' },
          description: 'Each concrete problem found in the saved entity (wrong reference number, garbled Arabic, transliteration in arabic field, missing source, ...).',
        },
      },
      required: ['status'],
    },
  },
];

const SYSTEM_PROMPT = `You verify quoted Islamic passages (duas, hadiths, Quranic verses) saved from social-media transcripts. The saved text often contains speech-to-text errors, wrong or missing references, or missing fields.

Your job for the given entity:
1. Identify what the passage actually is and where it canonically comes from.
2. CONFIRM it with lookup_quran / lookup_hadith — you may try several candidates. A verse citation in the saved data may be wrong; trust the text over the citation.
3. Call finish with your verdict.

Rules:
- Never report kind/reference in finish unless a lookup call in THIS conversation returned that exact source and its text matches the quoted passage.
- corrected_arabic must be copied from the lookup result (for hadith: just the relevant matn excerpt, with harakat as given). Do not write Arabic from memory.
- Many duas come from hadith collections — match them to the hadith they appear in.
- When you cannot place the passage by reference, use search_hadith with a distinctive Arabic phrase before giving up. If the saved Arabic looks garbled, search with the phrase as it SHOULD read.
- ALTERED CANONICAL TEXT: if the saved passage is a garbled, mistranscribed, partially-remembered, or altered version of a canonical passage you located, that IS a match — return the canonical source with the canonical wording in corrected_arabic, and record exactly what was altered in saved_text_issues. Never leave a passage uncorrected when you found its authentic original.
- Reserve "unsourced" for genuinely contemporary compositions with no canonical original (viral/social-media duas). Even then, say in notes what it is and where it circulates, so the reader gets an answer, not a shrug.
- "not_found" is a last resort for passages that are likely canonical but that neither lookups nor search could locate; name the suspected source in notes (e.g. a collection outside the corpus like As-Silsilah as-Sahihah).
- Whole-surah references (e.g. "Surah Al-Muzammil"): confirm with a lookup of its first verse, set verse_key to the chapter form like "73:1", and note it refers to the whole surah.
- Grades: only the primary-collection lookups return grades. For books without grades (e.g. Musnad Ahmad), you may state well-established scholarly gradings in notes, attributed by name (e.g. "graded Sahih by al-Albani in Silsilah as-Sahihah 2578") — never in the grades data itself.
- Be conservative about WHICH source, not about correcting: when lookups keep disagreeing with the passage, prefer not_found over a shaky match.`;

async function resolvePassage(entity, { log = () => {} } = {}) {
  const client = getAnthropicClient();
  const messages = [{
    role: 'user',
    content: `Verify this saved entity:\n${JSON.stringify(
      { name: entity.name, type: entity.type, detail: entity.detail },
      null, 2
    )}`,
  }];

  let lastLookup = null;
  // Every successful lookup this conversation, keyed by source — a finish
  // verdict may only cite one of these, and its corrected_arabic must
  // actually live in that source's text. Rejected verdicts loop back to the
  // model with the reason instead of escaping as bogus matches.
  const confirmedLookups = new Map();

  const rejectFinish = (verdict) => {
    if (verdict.status !== 'matched') return null;
    const key = verdict.kind === 'quran'
      ? `quran:${(verdict.verse_key || '').trim()}`
      : `${(verdict.collection || '').toLowerCase().trim()}:${String(verdict.hadith_number || '').trim()}`;
    const source = confirmedLookups.get(key);
    if (!source) {
      return `finish rejected: you cited ${key} but never successfully looked it up in this conversation. Call the lookup first, and copy corrected_arabic from its result.`;
    }
    const score = containmentScore(verdict.corrected_arabic || '', source.arabic);
    if (score < 0.8) {
      return `finish rejected: your corrected_arabic does not match the text of ${key} (containment ${score.toFixed(2)}). Copy the passage exactly from that lookup result — or reconsider whether this is really the right source.`;
    }
    return null;
  };

  for (let turn = 0; turn < 14; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      tool_choice: turn === 13 ? { type: 'tool', name: 'finish' } : { type: 'auto' },
      messages,
    });

    const toolUses = response.content.filter(b => b.type === 'tool_use');
    messages.push({ role: 'assistant', content: response.content });
    if (toolUses.length === 0) {
      messages.push({ role: 'user', content: 'Use the tools. Call finish when done.' });
      continue;
    }

    const toolResults = [];
    let finishVerdict = null;
    for (const toolUse of toolUses) {
      if (toolUse.name === 'finish') {
        const rejection = turn === 13 ? null : rejectFinish(toolUse.input);
        if (rejection) {
          log(`  ${rejection}`);
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: rejection, is_error: true });
        } else {
          finishVerdict = toolUse.input;
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'ok' });
        }
        continue;
      }
      let result;
      try {
        if (toolUse.name === 'lookup_quran') {
          result = await lookupQuran(toolUse.input.verse_key);
          lastLookup = result;
          confirmedLookups.set(`quran:${(toolUse.input.verse_key || '').trim()}`, result);
        } else if (toolUse.name === 'search_hadith') {
          result = await searchHadith(toolUse.input.query, toolUse.input.books);
        } else {
          result = await lookupHadith(toolUse.input.collection, toolUse.input.hadith_number);
          lastLookup = result;
          confirmedLookups.set(`${result.collection}:${result.hadith_number}`, result);
        }
        log(`  lookup ${toolUse.name} ${JSON.stringify(toolUse.input)} → ok`);
      } catch (err) {
        result = { error: err.message };
        log(`  lookup ${toolUse.name} ${JSON.stringify(toolUse.input)} → ${err.message}`);
      }
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) });
    }
    if (finishVerdict) return { verdict: finishVerdict, lastLookup };
    messages.push({ role: 'user', content: toolResults });
  }
  return { verdict: { status: 'not_found', notes: 'resolution did not converge' }, lastLookup };
}

// ---------------------------------------------------------------------------
// Entity verification
// ---------------------------------------------------------------------------

// Independent of the LLM: re-fetch the claimed source and check the passage
// text actually lives in it.
async function confirmVerdict(verdict) {
  if (verdict.status !== 'matched') return { canonical: null, score: null };
  let canonical;
  if (verdict.kind === 'quran') {
    canonical = await lookupQuran(verdict.verse_key);
  } else {
    canonical = await lookupHadith(verdict.collection, verdict.hadith_number);
  }
  const score = containmentScore(verdict.corrected_arabic || '', canonical.arabic);
  return { canonical, score };
}

const MIN_CONTAINMENT = 0.8;

async function verifyEntity(entity, { log = () => {} } = {}) {
  const { verdict } = await resolvePassage(entity, { log });
  const detail = { ...(entity.detail || {}) };
  // Transliteration is unwanted in the digest (user decision 2026-07-24):
  // never added, and stripped from older saves as they pass through.
  if ('transliteration' in detail) delete detail.transliteration;
  const issues = Array.isArray(verdict.saved_text_issues)
    ? verdict.saved_text_issues
    : verdict.saved_text_issues ? [String(verdict.saved_text_issues)] : [];
  const changed = [];

  let status;
  let sourceUrl = null;
  let canonical = null;

  if (verdict.status === 'matched') {
    let confirmation;
    try {
      confirmation = await confirmVerdict(verdict);
    } catch (err) {
      log(`  confirm failed: ${err.message}`);
      confirmation = { canonical: null, score: 0 };
    }
    canonical = confirmation.canonical;
    if (!canonical || confirmation.score < MIN_CONTAINMENT) {
      status = 'needs_review';
      issues.push(`claimed source ${canonical ? canonical.reference : '(unfetchable)'} failed independent text check (score ${confirmation.score?.toFixed(2) ?? 'n/a'})`);
    } else {
      sourceUrl = canonical.source_url;

      const setField = (key, value) => {
        if (!value) return;
        if ((detail[key] || '').trim() === value.trim()) return;
        if (detail[key]) changed.push(key); else changed.push(`${key} (added)`);
        detail[key] = value.trim();
      };

      // Quran: exactly one correct text — overwrite. Hadith/dua: overwrite too,
      // but preserve the transcript wording when it materially differed.
      const newArabic = verdict.kind === 'quran' ? canonical.arabic : (verdict.corrected_arabic || '').trim();
      if (newArabic) {
        const old = (detail.arabic || '').trim();
        if (old && normalizeArabic(old) !== normalizeArabic(newArabic) && verdict.kind !== 'quran') {
          detail.arabic_as_saved = old;
        }
        setField('arabic', newArabic);
      }
      setField('translation', verdict.corrected_translation || (verdict.kind === 'quran' ? canonical.translation : null));
      setField('source', canonical.reference);
      if (verdict.narrator) setField('narrator', verdict.narrator);
      if (canonical.grades?.length) {
        detail.grades = canonical.grades;
        changed.push('grades');
      }
      status = changed.length > 0 ? 'corrected' : 'verified';
    }
  } else if (verdict.status === 'unsourced') {
    status = 'unsourced';
  } else {
    status = 'needs_review';
  }

  const updated = {
    ...entity,
    detail: {
      ...detail,
      verification: {
        status,
        checked_at: new Date().toISOString().slice(0, 10),
        method: `${MODEL} + ${canonical?.kind === 'quran' ? 'quran.com' : canonical ? 'sunnah.com dataset' : 'canonical lookup'}`,
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
        ...(changed.length ? { corrections: changed } : {}),
        ...(issues.length ? { issues } : {}),
        ...(verdict.notes ? { notes: verdict.notes } : {}),
      },
    },
  };

  return {
    updated,
    report: {
      name: entity.name,
      type: entity.type,
      status,
      reference: canonical?.reference || null,
      source_url: sourceUrl,
      changed,
      issues,
      notes: verdict.notes || null,
    },
  };
}

// Fire-and-forget save-time hook (mirrors embedItemInBackground): re-reads the
// just-saved item, verifies any unchecked dua/hadith/quranic_verse entities,
// and writes the enriched entities back. Never throws — a verification outage
// must not break saving.
const VERIFIABLE_TYPES = ['dua', 'hadith', 'quranic_verse'];

function verifyItemEntitiesInBackground(itemId, userId) {
  (async () => {
    const { getSupabase } = require('./supabase');
    const sb = getSupabase();
    const { data: item, error } = await sb
      .from('items').select('id, entities').eq('id', itemId).eq('user_id', userId).single();
    if (error || !item) return;

    const entities = item.entities || [];
    const pending = entities.filter(e =>
      e && VERIFIABLE_TYPES.includes(e.type) && !e.detail?.verification?.status);
    if (pending.length === 0) return;

    const updated = [];
    let changed = false;
    for (const entity of entities) {
      if (!pending.includes(entity)) { updated.push(entity); continue; }
      try {
        const { updated: verifiedEntity, report } = await verifyEntity(entity);
        updated.push(verifiedEntity);
        changed = true;
        console.log(`[verify] ${entity.type} "${entity.name}" → ${report.status}${report.reference ? ` (${report.reference})` : ''}`);
      } catch (err) {
        console.error(`[verify] ${entity.type} "${entity.name}" failed: ${err.message}`);
        updated.push(entity);
      }
    }
    if (!changed) return;

    const { error: updErr } = await sb
      .from('items').update({ entities: updated }).eq('id', itemId).eq('user_id', userId);
    if (updErr) console.error(`[verify] write-back failed for ${itemId}: ${updErr.message}`);
  })().catch(err => console.error(`[verify] background verification failed: ${err.message}`));
}

module.exports = {
  verifyEntity,
  verifyItemEntitiesInBackground,
  lookupQuran,
  lookupHadith,
  searchHadith,
  normalizeArabic,
  containmentScore,
  HADITH_COLLECTIONS,
};
