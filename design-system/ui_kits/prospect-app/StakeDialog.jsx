// Prospect UI kit — Stake a claim dialog
const { Dialog, Input, Select, Button } = window.ProspectDesignSystem_c3fd64;

function StakeDialog({ open, onClose, onStake }) {
  const [role, setRole] = React.useState('');
  const [company, setCompany] = React.useState('');

  React.useEffect(() => { if (open) { setRole(''); setCompany(''); } }, [open]);

  return (
    <Dialog open={open} title="Stake a claim" onClose={onClose}
      footer={
        <React.Fragment>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="gold" disabled={!role.trim()} onClick={() => onStake(role || 'Untitled role', company || 'Unknown')}>Stake a claim</Button>
        </React.Fragment>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Role" placeholder="Senior Backend Engineer" value={role} onChange={(e) => setRole(e.target.value)} autoFocus />
        <Input label="Company" placeholder="Granite Map Co." value={company} onChange={(e) => setCompany(e.target.value)} />
        <Select label="Stage" options={['Showings', 'Staked']} defaultValue="Staked" />
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', margin: 0 }}>survey the field · stake the few worth your time</p>
      </div>
    </Dialog>
  );
}

window.StakeDialog = StakeDialog;
