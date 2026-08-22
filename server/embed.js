// server/embed.js — synchronous, timeout-guarded embed calls for request
// handlers (query-time search §5.2.2, capture-time repost detection §5.2.3).
// Standalone from server/enrich.js's document-side embedListing (fire-and-forget,
// listing-id driven, never awaited from a request, no timeout) — everything here
// is awaited inline in a request handler, so a hard timeout is required so a
// slow/unreachable Ollama can't hang the request.
import { OLLAMA_URL, EMBED_MODEL } from './ollamaConfig.js';
const EMBED_TIMEOUT_MS = 2500;

function vecBuffer(embedding) {
  return Buffer.from(Float32Array.from(embedding).buffer);
}

// Shared fetch: throws on timeout, non-200, or a malformed/wrong-shape
// response — callers must degrade, never let this take down the request.
async function embedWithPrefix(prefix, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: `${prefix}${text}` }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ollama /api/embed returned ${res.status}`);
    const data = await res.json();
    const embedding = data.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length !== 768) {
      throw new Error(`unexpected embedding shape: ${Array.isArray(embedding) ? embedding.length : typeof embedding}`);
    }
    return vecBuffer(embedding);
  } finally {
    clearTimeout(timer);
  }
}

// embedQuery(text) -> Buffer (768-dim float32, vec0 MATCH-ready). `search_query:`
// is the query-side counterpart to enrich.js's `search_document:` prefix
// (nomic-embed-text is prefix-trained on the two sides asymmetrically).
export async function embedQuery(text) {
  return embedWithPrefix('search_query: ', text);
}

// embedDocument(text) -> Buffer, same shape/guard as embedQuery but on the
// asymmetric document side (§5.2.3 capture-time repost detection embeds the
// incoming snapshot as a document, to compare against other listings'
// `search_document:`-prefixed embeddings in listings_vec).
export async function embedDocument(text) {
  return embedWithPrefix('search_document: ', text);
}
