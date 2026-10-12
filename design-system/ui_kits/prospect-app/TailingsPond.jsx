// Prospect UI kit — Tailings Pond (archive of dead claims)
const { EmptyState, Button, Badge } = window.ProspectDesignSystem_c3fd64;

function TailingsPond({ items, onStake }) {
  if (!items || items.length === 0) {
    return (
      <div style={{ padding: '60px 30px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', border: '1px dashed var(--galena-dim)', borderRadius: 'var(--r-lg)' }}>
          <EmptyState
            title="Nothing in the tailings pond yet."
            line="Dead, withdrawn, and passed claims settle here. Move one from a claim's drawer to see it."
            action={<Button variant="ghost" onClick={onStake}>Stake a claim</Button>}
          />
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: '22px 30px 40px', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 760 }}>
      {items.map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 14px', background: 'var(--surface-card)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', opacity: .85 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-soft)' }}>{c.role}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.company} · <span style={{ fontFamily: 'var(--font-mono)' }}>{c.id}</span></div>
          </div>
          <Badge tone="danger">{c.reason || 'Tailings'}</Badge>
        </div>
      ))}
    </div>
  );
}

window.TailingsPond = TailingsPond;
