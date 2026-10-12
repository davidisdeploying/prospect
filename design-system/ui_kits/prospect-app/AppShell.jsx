// Prospect UI kit — app shell (top bar + left rail)
const { Logo, Wordmark, Button, IconButton, Badge } = window.ProspectDesignSystem_c3fd64;

function NavIcon({ d }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
}
const icons = {
  map: <NavIcon d={<><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></>} />,
  report: <NavIcon d={<><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></>} />,
  tailings: <NavIcon d={<><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></>} />,
  survey: <NavIcon d={<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>} />,
};

function AppShell({ view, setView, onStake, children }) {
  const nav = [
    { id: 'map', label: 'Claim Map', plain: 'Board' },
    { id: 'report', label: 'Hunt Report', plain: 'Analytics' },
    { id: 'tailings', label: 'Tailings Pond', plain: 'Archive' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '224px 1fr', minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* left rail */}
      <aside style={{ borderRight: '1px solid var(--line)', background: 'var(--slate-850)', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Wordmark size={21} />
        <Button variant="gold" size="sm" onClick={onStake} style={{ width: '100%' }}
          iconLeft={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>}>
          Stake a claim
        </Button>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map((n) => {
            const active = view === n.id;
            return (
              <button key={n.id} onClick={() => setView(n.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left',
                  padding: '9px 11px', borderRadius: 'var(--r-md)', border: '1px solid',
                  borderColor: active ? 'var(--line)' : 'transparent',
                  background: active ? 'var(--surface-card)' : 'transparent',
                  color: active ? 'var(--text-strong)' : 'var(--text-muted)',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: active ? 600 : 500,
                  transition: 'color var(--dur-flick), background var(--dur-flick)',
                }}>
                <span style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>{icons[n.id]}</span>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                  {n.label}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{n.plain}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <span style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--surface-raised)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-soft)' }}>JM</span>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 13, color: 'var(--text-body)' }}>Jordan M.</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>self-hosted</div>
          </div>
        </div>
      </aside>
      {/* main */}
      <main className="prospect-field" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}

function ViewHeader({ eyebrow, title, sub, right }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, padding: '24px 30px 18px', borderBottom: '1px solid var(--line)' }}>
      <div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{eyebrow}</span>
        <h1 style={{ fontFamily: 'var(--font-slab)', fontWeight: 700, fontSize: 28, color: 'var(--text-strong)', marginTop: 8, letterSpacing: '-.01em' }}>{title}</h1>
        {sub && <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 5 }}>{sub}</div>}
      </div>
      {right}
    </header>
  );
}

window.AppShell = AppShell;
window.ViewHeader = ViewHeader;
