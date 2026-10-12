import crypto from 'node:crypto';

const FALLBACK_FIELDS = Object.freeze([
  'comp', 'company', 'description', 'location', 'posted_at', 'role', 'source', 'source_url',
]);

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export function listingSnapshotHash(listing) {
  if (listing?.snapshot_hash) return String(listing.snapshot_hash);
  if (listing?.raw_payload != null) return sha256(listing.raw_payload);
  return sha256(JSON.stringify(Object.fromEntries(
    FALLBACK_FIELDS.map((field) => [field, listing?.[field] ?? null]),
  )));
}
