// Prospect UI kit — Claim Map (the board)
const { ClaimCard, StageColumnHead, Badge } = window.ProspectDesignSystem_c3fd64;

function ClaimMap({ claims, stages, onOpen }) {
  const counts = {};
  stages.forEach((s) => { counts[s.key] = claims.filter((c) => c.stage === s.key).length; });

  return (
    <div style={{ padding: '20px 30px 40px', overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(210px, 1fr))', gap: 14, minWidth: 1080 }}>
        {stages.map((s) => {
          const strike = s.key === 'Strike';
          const items = claims.filter((c) => c.stage === s.key);
          return (
            <div key={s.key}
              style={{
                background: 'var(--bg-sunken)', border: '1px solid var(--line)',
                borderRadius: 'var(--r-lg)', padding: 12, alignSelf: 'start',
                boxShadow: strike ? 'none' : 'var(--shadow-panel)',
              }}>
              <div style={{ padding: '2px 2px 12px' }}>
                <StageColumnHead name={s.key} count={counts[s.key]} gloss={s.gloss} strike={strike} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((c) => (
                  <ClaimCard key={c.id} role={c.role} company={c.company} meta={c.meta}
                    tags={c.tags} strike={c.strike} onClick={() => onOpen(c)} />
                ))}
                {items.length === 0 && (
                  <div style={{ height: 36, border: '1px dashed var(--galena-dim)', borderRadius: 'var(--r-md)', opacity: .5 }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.ClaimMap = ClaimMap;
