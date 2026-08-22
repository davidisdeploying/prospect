// Prospect UI kit — Hunt Report (analytics)
const { StatChip, Badge } = window.ProspectDesignSystem_c3fd64;

function StrataFunnel({ stages, claims }) {
  // counts per stage, widest at top
  const counts = stages.map((s) => ({ name: s.short || s.key, key: s.key, n: claims.filter((c) => c.stage === s.key).length }));
  // illustrative widths
  const widths = [100, 76, 54, 34, 18];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {counts.map((c, i) => {
        const strike = c.key === 'Strike';
        return (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 130, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: strike ? 'var(--accent)' : 'var(--text-muted)' }}>{c.name}</div>
            <div style={{ flex: 1, height: 30, position: 'relative', display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: widths[i] + '%', height: '100%', borderRadius: 3,
                background: strike ? 'linear-gradient(180deg, var(--gold-hi), var(--gold-sh))' : 'var(--surface-raised)',
                border: '1px solid', borderColor: strike ? 'var(--gold-edge)' : 'var(--line)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 12, color: strike ? 'var(--text-on-gold)' : 'var(--text-soft)',
                fontWeight: strike ? 700 : 400,
              }}>{c.n}</div>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        <div style={{ width: 130 }} />
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>wide rock up top · the gold seam at the bottom</div>
      </div>
    </div>
  );
}

function HuntReport({ metrics, stages, claims }) {
  return (
    <div style={{ padding: '24px 30px 48px', display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 26, alignItems: 'start' }}>
      <section style={{ background: 'var(--bg-sunken)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontFamily: 'var(--font-slab)', fontWeight: 600, fontSize: 16, color: 'var(--text-strong)' }}>Your search, read like a core sample</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent)', border: '1px solid var(--gold-sh)', padding: '4px 9px', borderRadius: 'var(--r-sm)' }}>cross-section</span>
        </div>
        <StrataFunnel stages={stages} claims={claims} />
      </section>

      <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontFamily: 'var(--font-slab)', fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>Hunt Report</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>30-day yield</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: 'var(--line)' }}>
          {metrics.map((m) => <StatChip key={m.k} k={m.k} value={m.v} sub={m.sub} hi={m.hi} />)}
        </div>
      </section>
    </div>
  );
}

window.HuntReport = HuntReport;
