// The front door for Instagram DM capture: the HTTP endpoint Meta calls.
//
// This module does four things and nothing else: it answers Meta's
// subscription handshake, verifies that a POST really came from Meta, drops the
// events that are our own outgoing messages, and hands the rest to `onEvent`.
// What an event MEANS (policy, replies, storage) lives elsewhere. It must not
// import the orchestrator: that boundary is what lets this file be tested with
// no database and no network.

const crypto = require('crypto');

const WEBHOOK_PATH = '/webhooks/instagram';

// ─── Signature ────────────────────────────────────────────────────────────────

// Meta signs the exact bytes it sends: `X-Hub-Signature-256: sha256=<hex>`,
// HMAC-SHA256 keyed with the app secret. The bytes must be the RAW body. A
// re-serialised req.body can differ in whitespace/key order and will not match.
// index.js captures them on req.rawBody through the verify hook on its global
// express.json().
const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/;

// Returns true only for a correctly signed body. Every other input (absent or
// malformed header, wrong length, non-hex, missing body, missing secret)
// returns false, never throws: a comparison that throws on a bad header would
// turn one malformed request into a 500 instead of a rejection.
function verifySignature(rawBody, header, appSecret) {
  // An empty secret is still a valid HMAC key, so an unset IG_APP_SECRET would
  // otherwise make every signature forgeable by anyone. Refuse instead.
  if (typeof appSecret !== 'string' || appSecret === '') return false;
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') return false;
  if (typeof header !== 'string') return false;

  const match = SIGNATURE_RE.exec(header);
  if (!match) return false;

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex'); // exactly 32 bytes: the regex fixed the length
  return crypto.timingSafeEqual(expected, received);
}

// Constant-time string equality that tolerates different lengths (timingSafeEqual
// itself throws on those). Hashing both sides first gives equal-length buffers.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ─── Echo filter ──────────────────────────────────────────────────────────────

// LOAD-BEARING. When we send a DM, Meta delivers that outgoing message back to
// this same webhook as an event with `message.is_echo === true`. If it were
// treated as inbound, the system would see its own reply as a new message from
// a creator, reply again, and loop, spending the reply budget and messaging a
// creator over and over from the user's account.
//
// This is the ONLY place echoes are stopped. The reply-policy function
// (decide()) deliberately does not check is_echo, and no later stage repeats
// this check. Anything that reaches `onEvent` is trusted to be inbound. So every
// path that yields events must go through messagingEvents() below, and this
// predicate must stay fail-closed: any truthy is_echo counts, not only `true`.
function isEcho(messagingEvent) {
  return Boolean(messagingEvent && messagingEvent.message && messagingEvent.message.is_echo);
}

// Flatten entry[].messaging[] into one array of inbound events. This is the
// single chokepoint for the echo filter above: it is the only exported way to
// get events out of a webhook body, and the route uses nothing else.
// Tolerates any malformed shape (returns [] / skips entries) rather than
// throwing, since the body is attacker-shaped until proven otherwise (a signed
// body is authentic, not well-formed).
function messagingEvents(body) {
  const entries = body && Array.isArray(body.entry) ? body.entry : [];
  const events = [];
  for (const entry of entries) {
    const messaging = entry && Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const event of messaging) {
      if (!event || typeof event !== 'object') continue;
      if (isEcho(event)) continue; // never reaches onEvent
      events.push(event);
    }
  }
  return events;
}

// ─── Route ────────────────────────────────────────────────────────────────────

// Mounts GET + POST /webhooks/instagram on `app`.
//   GET   Meta's subscription handshake: echo hub.challenge when the mode and
//         verify token match, else 403.
//   POST  verify signature (403 on failure) -> respond 200 -> hand each inbound
//         event to onEvent, detached.
//
// `onEvent(event)` may be async. It runs AFTER the 200 is sent, so its latency
// never holds Meta's connection (Meta retries on any non-2xx, and downstream
// extraction can take minutes). Errors it throws or rejects with are caught and
// logged here: a detached rejection must never become an unhandled one.
function registerInstagramWebhook(app, { onEvent } = {}) {
  if (typeof onEvent !== 'function') {
    throw new TypeError('registerInstagramWebhook requires an onEvent function');
  }

  app.get(WEBHOOK_PATH, (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = process.env.IG_WEBHOOK_VERIFY_TOKEN;

    // `expected` unset must not match an absent token (undefined === undefined),
    // so an unconfigured deploy rejects the handshake instead of passing it.
    const ok = mode === 'subscribe'
      && typeof token === 'string'
      && typeof expected === 'string' && expected !== ''
      && typeof challenge === 'string'
      && safeEqual(token, expected);
    if (!ok) return res.sendStatus(403);

    // text/plain, not the default text/html: the challenge is caller-supplied.
    res.status(200).type('text/plain').send(challenge);
  });

  app.post(WEBHOOK_PATH, (req, res) => {
    if (!req.rawBody) {
      // Not an attack, a wiring fault: the verify hook on express.json() in
      // index.js is gone, or the request was not JSON. Either way nothing can be
      // verified, so reject. Log it so it reads as a fault, not a silent 403.
      console.error('[ig-webhook] no req.rawBody: is the verify hook on express.json() in index.js still installed?');
      return res.sendStatus(403);
    }
    if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), process.env.IG_APP_SECRET)) {
      console.warn('[ig-webhook] rejected POST: bad or missing signature');
      return res.sendStatus(403);
    }

    // Respond before any work. Everything below is detached from this request.
    res.sendStatus(200);

    const body = req.body;
    if (!body || body.object !== 'instagram') return;
    const events = messagingEvents(body); // echoes are dropped here and nowhere else

    setImmediate(async () => {
      // In order, one at a time: two messages in a batch from one creator (a
      // link, then "DONE") must not race each other through a stateful flow.
      for (const event of events) {
        try {
          await onEvent(event);
        } catch (err) {
          // Message only: the event holds a creator's DM text and ids.
          console.error('[ig-webhook] onEvent failed:', err && err.message ? err.message : err);
        }
      }
    });
  });
}

module.exports = { verifySignature, isEcho, messagingEvents, registerInstagramWebhook };
