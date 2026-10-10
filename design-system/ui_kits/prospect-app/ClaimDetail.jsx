// Prospect UI kit — Claim detail (ticket + logbook drawer)
const { Badge, Tag, KeyValue, Textarea, Button, IconButton, Tooltip, STAGE_TONE } = window.ProspectDesignSystem_c3fd64;

const STAGE_GLOSS = {
  Showings: 'Saved / interested', Staked: 'Applied',
  'Working the Vein': 'Active interview loops', Strike: 'Offer', Tailings: 'Rejected / dead',
};

function ClaimDetail({ claim, onClose, onTailings }) {
  if (!claim) return null;
  const tone = STAGE_TONE[claim.stage] || 'neutral';
  const rows = [
    claim.comp && { k: 'Comp', v: claim.comp, num: true },
    claim.remote && { k: 'Location', v: claim.remote },
    claim.source && { k: 'Source', v: claim.source },
    claim.next && { k: 'Next', v: claim.next },
    claim.contacts && { k: 'Contacts', v: claim.contacts },
  ].filter(Boolean);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(16,23,26,.6)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', height: '100%', background: 'var(--surface-card)', borderLeft: '1px solid var(--line)', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* torn-ticket header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px dashed var(--galena-dim)', background: 'var(--bg-sunken)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{claim.id} · staked 2026-06-09</span>
          <IconButton size="sm" label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </IconButton>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Tooltip label={STAGE_GLOSS[claim.stage]}><Badge tone={tone}>{claim.stage}</Badge></Tooltip>
            {claim.strike && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>paydirt</span>}
          </div>
          <h2 style={{ fontFamily: 'var(--font-slab)', fontWeight: 700, fontSize: 23, color: 'var(--text-strong)', marginTop: 8 }}>{claim.role}</h2>
          <div style={{ color: 'var(--text-muted)', margin: '3px 0 18px', fontSize: 14 }}>{claim.company}{claim.remote ? ` — ${claim.remote}` : ''}</div>

          <KeyValue rows={rows} />

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Core samples · logbook</div>
            <Textarea rows={4} defaultValue={claim.samples || ''} placeholder="Log what you dug up — contacts, comp signals, gut read…" />
          </div>
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--line)', background: 'var(--bg-sunken)' }}>
          <Button variant="danger" size="sm" onClick={() => onTailings(claim)}>Move to tailings</Button>
          <Button variant="gold" size="sm">Advance stage →</Button>
        </div>
      </div>
    </div>
  );
}

window.ClaimDetail = ClaimDetail;
