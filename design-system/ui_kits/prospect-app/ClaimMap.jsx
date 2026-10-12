// Prospect UI kit — Claim Map (bounded pipeline + application ledger)
const { ClaimCard, StageColumnHead } = window.ProspectDesignSystem_c3fd64;

function ClaimMap({ claims, stages, onOpen }) {
  const actionStages = stages.filter((stage) => stage.key !== 'Staked');
  const applied = claims.filter((claim) => claim.stage === 'Staked');

  return (
    <div style={{ padding: '20px 30px 40px' }}>
      <div className="claim-stage-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        {stages.map((stage) => (
          <div key={stage.key} style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              <span>{stage.key}</span><strong style={{ color: 'var(--text-soft)' }}>{claims.filter((claim) => claim.stage === stage.key).length}</strong>
            </div>
            <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11 }}>{stage.gloss}</div>
          </div>
        ))}
      </div>

      <section style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-sunken)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 20, marginBottom: 12 }}>
          <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.12em' }}>Action stages</div><h2 style={{ margin: '3px 0 0', fontSize: 19 }}>What can move now</h2></div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 11 }}>Applied roles wait in the ledger below.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(210px, 1fr))', gap: 10 }}>
          {actionStages.map((stage) => {
            const items = claims.filter((claim) => claim.stage === stage.key);
            return (
              <div key={stage.key} style={{ padding: 11, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surface-card)' }}>
                <div style={{ padding: '2px 2px 10px' }}><StageColumnHead name={stage.key} count={items.length} gloss={stage.gloss} /></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((claim) => <ClaimCard key={claim.id} role={claim.role} company={claim.company} meta={claim.meta} tags={claim.tags} strike={claim.strike} onClick={() => onOpen(claim)} />)}
                  {items.length === 0 && <div style={{ padding: 12, border: '1px dashed var(--galena-dim)', borderRadius: 'var(--r-md)', color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>No claims here</div>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ marginTop: 14, padding: 14, border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--bg-sunken)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 20, marginBottom: 12 }}>
          <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.12em' }}>Staked · applied</div><h2 style={{ margin: '3px 0 0', fontSize: 19 }}>Waiting on employers</h2></div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 11 }}>Newest first · eight applications per page.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {applied.map((claim) => (
            <button key={claim.id} onClick={() => onOpen(claim)} style={{ padding: '11px 12px', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface-card)', color: 'var(--text-strong)', textAlign: 'left', cursor: 'pointer' }}>
              <strong style={{ display: 'block', fontSize: 13 }}>{claim.role}</strong>
              <span style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 11.5 }}>{claim.company}</span>
              <span style={{ display: 'block', marginTop: 6, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{claim.meta}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

window.ClaimMap = ClaimMap;
