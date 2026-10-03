import React from 'react';
import { Dialog } from '@ds/components/feedback/Dialog.jsx';
import { Select } from '@ds/components/forms/Select.jsx';
import { Textarea } from '@ds/components/forms/Textarea.jsx';
import { Button } from '@ds/components/core/Button.jsx';

// Source of truth: server/validate.js ENUMS.outcome_reason — keep in sync.
const OUTCOME_REASON_OPTIONS = [
  { value: '', label: '— choose one —' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'ghosted', label: 'Ghosted' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'closed', label: 'Closed' },
  { value: 'declined', label: 'Declined' },
  { value: 'timeout', label: 'Timed out' },
  { value: 'other', label: 'Other' },
];

export function TailingsDialog({ open, onClose, onConfirm, initialReason, ghostOrigin = false }) {
  const [outcomeReason, setOutcomeReason] = React.useState(initialReason || '');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (open) { setOutcomeReason(initialReason || ''); setNote(''); setError(null); setSubmitting(false); }
  }, [open, initialReason]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      // A ghost-suggested drop always stamps cause='timeout' — the timer triggered it —
      // even if David edits the prefilled reason before confirming; the click is still his.
      await onConfirm({
        outcome_reason: outcomeReason,
        note: note.trim() || undefined,
        transition_cause: ghostOrigin ? 'timeout' : 'manual',
      });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Drop to the tailings pile"
      onClose={onClose}
      width={440}
      footer={
        <React.Fragment>
          <Button variant="quiet" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="gold" disabled={!outcomeReason || submitting} onClick={submit}>
            Confirm
          </Button>
        </React.Fragment>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Select label="Outcome" options={OUTCOME_REASON_OPTIONS} value={outcomeReason} onChange={(e) => setOutcomeReason(e.target.value)} autoFocus />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
            why this claim is going to the tailings pile (dead/rejected)
          </p>
        </div>
        <div>
          <Textarea label="Note" placeholder="Anything worth remembering — optional" value={note} onChange={(e) => setNote(e.target.value)} />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
            logged to this claim's history alongside the move
          </p>
        </div>
        {error && <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{error}</p>}
      </div>
    </Dialog>
  );
}
