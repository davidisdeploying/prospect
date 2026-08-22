import React from 'react';
import { Dialog } from '@ds/components/feedback/Dialog.jsx';
import { Button } from '@ds/components/core/Button.jsx';

// Fail-closed shape mirrors TailingsDialog.jsx: onConfirm is awaited, the dialog itself never
// closes on success (the caller does that once the request truly lands) and stays open with the
// error rendered inline on failure -- no silent failure, no auto-close on error.
export function DeleteClaimDialog({ open, onClose, onConfirm }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (open) { setError(null); setSubmitting(false); }
  }, [open]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Abandon claim"
      onClose={onClose}
      width={420}
      footer={
        <React.Fragment>
          <Button variant="quiet" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="danger" disabled={submitting} onClick={submit}>
            {submitting ? 'Abandoning…' : 'Abandon claim'}
          </Button>
        </React.Fragment>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-body)', margin: 0 }}>
          <strong>Abandon claim</strong> — plain gloss: permanently delete. This removes the claim,
          its logbook, history, and contacts from Prospect for good. The listing itself is only
          removed if no other claim or repost still points at it.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)', margin: 0 }}>
          A backup is written to the server first, so it can be recovered by hand if needed — but
          there is no undo inside Prospect itself.
        </p>
        {error && <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{error}</p>}
      </div>
    </Dialog>
  );
}
