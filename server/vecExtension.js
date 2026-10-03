// server/vecExtension.js — registers sqlite-vec's vec0 module on a connection.
// Shared by server/db.js (the live app connection) and server/migrate.js (its
// own standalone connection), so both load the extension the same way. Loading
// is unconditional, independent of the PROSPECT_EMBEDDINGS toggle: listings_vec
// must stay readable for schema consistency whether or not the embedding
// worker is enabled.
import * as sqliteVec from 'sqlite-vec';

export function loadVecExtension(database) {
  sqliteVec.load(database);
}
