import React from 'react';
import { Dialog } from '@ds/components/feedback/Dialog.jsx';
import { Button } from '@ds/components/core/Button.jsx';
import { linkRepost } from './api.js';

function humanize(v) {
  if (v == null) return v;
  return String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-flick) var(--ease-sluice)' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function CautionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function DiffLine({ line }) {
  const style = {
    add: { background: 'var(--danger-wash)', color: 'var(--text-body)' },
    remove: { color: 'var(--text-faint)', textDecoration: 'line-through' },
    context: { color: 'var(--text-muted)' },
  }[line.type];
  const prefix = { add: '+ ', remove: '− ', context: '  ' }[line.type];
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', padding: '0 10px', ...style }}>
      {prefix}{line.text}
    </div>
  );
}

// Non-gold caution affordance shown after a stake if the repost sentinel
// (server-side, deterministic) flagged the incoming listing as a likely
// re-post of one already tracked. The claim is ALREADY staked either way —
// this only offers to record the lineage relationship, never undoes it.
export function RepostCaution({ notice, onClose, onLinked }) {
  const [showDiff, setShowDiff] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => { setShowDiff(false); setLinking(false); setError(null); }, [notice]);

  // Keep rendering the last-known notice while `notice` goes back to null,
  // so the <Dialog> stays mounted (with content) through its animated exit
  // instead of the whole tree vanishing the instant it's told to close.
  const lastNotice = React.useRef(notice);
  if (notice) lastNotice.current = notice;
  const renderNotice = lastNotice.current;

  if (!renderNotice) return null;
  const { claimId, candidate } = renderNotice;

  async function link() {
    setLinking(true);
    setError(null);
    try {
      await linkRepost(claimId, candidate.prior_listing_id);
      onLinked();
    } catch (err) {
      setError(err.message);
      setLinking(false);
    }
  }

  const tierLabel = candidate.tier === 'exact'
    ? 'identical listing text'
    : `similar title · ${Math.round((candidate.title_similarity || 0) * 100)}% overlap`;

  return (
    <Dialog
      open={!!notice}
      title="Possible repost"
      onClose={onClose}
      width={560}
      footer={
        <React.Fragment>
          <Button variant="quiet" onClick={onClose} disabled={linking}>Keep separate</Button>
          <Button variant="danger" onClick={link} disabled={linking}>
            {linking ? 'Linking…' : 'Link as repost'}
          </Button>
        </React.Fragment>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <CautionIcon />
          <div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-body)' }}>
              This claim is already staked. It also looks like a repost of a listing already tracked:
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-strong)' }}>{candidate.company || 'Unknown company'}</strong>
              {' — '}{candidate.role || 'Untitled role'} · {candidate.stage || 'unknown stage'}
              {candidate.outcome_reason && ` · ${humanize(candidate.outcome_reason)}`}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
              {tierLabel} · claim #{candidate.prior_claim_id ?? '—'}
            </p>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              padding: 0, cursor: 'pointer', color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.05em', textTransform: 'uppercase',
            }}
          >
            <ChevronIcon open={showDiff} /> View diff
          </button>
          {showDiff && (
            <div style={{
              marginTop: 10, background: 'var(--bg-sunken)', border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)', padding: '8px 0', maxHeight: 260, overflowY: 'auto',
            }}>
              {candidate.diff && candidate.diff.length > 0
                ? candidate.diff.map((line, i) => <DiffLine key={i} line={line} />)
                : <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 10px' }}>No description text to compare.</p>}
            </div>
          )}
        </div>

        {error && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>
          linking only records the relationship — this claim stays staked either way
        </p>
      </div>
    </Dialog>
  );
}
