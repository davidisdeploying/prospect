import React from 'react';
import { STAGE_TONE } from '@ds/components/core/Badge.jsx';
import { search } from './api.js';

// Sentinels server/index.js wraps each FTS5 match in (see SNIPPET_OPEN/SNIPPET_CLOSE there).
const SNIPPET_OPEN = '';
const SNIPPET_CLOSE = '';

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

// Board's one gold accent is already spent on "Stake a claim" — demote Strike's
// STAGE_TONE gold to positive here so search results don't spend a second.
const TONE_COLOR = {
  neutral: 'var(--text-faint)',
  positive: 'var(--positive)',
  danger: 'var(--danger)',
};

function stageColor(stage) {
  const tone = STAGE_TONE[stage] || 'neutral';
  return TONE_COLOR[tone === 'gold' ? 'positive' : tone];
}

function Snippet({ text }) {
  if (!text) return null;
  const parts = text.split(SNIPPET_OPEN);
  return (
    <>
      {parts.map((part, i) => {
        if (i === 0) return part;
        const [match, ...rest] = part.split(SNIPPET_CLOSE);
        return (
          <React.Fragment key={i}>
            <mark style={{ background: 'var(--accent-wash-soft)', color: 'var(--text-strong)', borderRadius: 2 }}>{match}</mark>
            {rest.join(SNIPPET_CLOSE)}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function Search({ onOpenClaim }) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef(null);

  React.useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); return; }
    const timer = setTimeout(() => {
      search(query).then((data) => setResults(data.results || [])).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  React.useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(claimId) {
    onOpenClaim(claimId);
    setOpen(false);
    setQ('');
  }

  const showPanel = open && q.trim().length > 0;

  return (
    <div ref={boxRef} className="prospect-search" style={{ position: 'relative', width: 280 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
        borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--bg-sunken)',
      }}>
        <span style={{ color: 'var(--text-faint)', display: 'flex' }}><SearchIcon /></span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search claims — company, role, notes"
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-body)',
          }}
        />
      </div>
      {showPanel && (
        <div className="prospect-search-results" style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 380, maxHeight: 360,
          overflowY: 'auto', zIndex: 60, borderRadius: 'var(--r-md)', border: '1px solid var(--line)',
          background: 'var(--surface-card)', boxShadow: 'var(--shadow-panel)',
        }}>
          {results.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>No matches</div>
          )}
          {results.map((r) => (
            <button
              key={r.claim_id}
              onClick={() => pick(r.claim_id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                border: 'none', borderBottom: '1px solid var(--line)', background: 'transparent', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-sunken)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)' }}>
                  {r.company || 'Unknown company'}{r.role ? ` — ${r.role}` : ''}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase',
                  color: stageColor(r.stage),
                }}>{r.stage}</span>
              </div>
              {r.snippet && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  <Snippet text={r.snippet} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
