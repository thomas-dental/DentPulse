const crypto = require('crypto');

// Short-lived in-memory store of "exportable" payloads emitted by the
// response formatter. The chatbot message includes URLs containing the
// token; the export route looks up the payload by token and streams it.
//
// Anything not retrieved within TTL_MS is garbage-collected. Token is a
// crypto-random 22-char base64url string — unguessable enough for a
// 10-minute window that only the user who saw the chat message can hit.

const TTL_MS = 10 * 60 * 1000;
const store = new Map();

function gc() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}

function put(payload) {
  gc();
  const token = crypto.randomBytes(16).toString('base64url');
  store.set(token, { payload, expiresAt: Date.now() + TTL_MS });
  return token;
}

function get(token) {
  gc();
  const entry = store.get(token);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.payload;
}

module.exports = { put, get };
