import React from 'react';
import { Dialog } from '@ds/components/feedback/Dialog.jsx';
import { Select } from '@ds/components/forms/Select.jsx';
import { Textarea } from '@ds/components/forms/Textarea.jsx';
import { Button } from '@ds/components/core/Button.jsx';

const REASON_OPTIONS = [
  { value: '', label: 'Select a reason…' },
  { value: 'completed', label: 'Completed' },
  { value: 'no_longer_required', label: 'No longer required' },
  { value: 'superseded', label: 'Superseded' },
];

export function ResolveClaimEventDialog({ open, event, onClose, onResolve }) {
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (open) {
      setReason('');
      setNote('');
      setSubmitting(false);
      setError(null);
    }
  }, [open, event?.id]);

  async function submit() {
    if (!event || !reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await onResolve({ reason, note: note.trim() || null });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Resolve hard gate"
      onClose={onClose}
      width={420}
      footer={
        <React.Fragment>
          <Button variant="quiet" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="gold" disabled={!reason || submitting} onClick={submit}>
            {submitting ? 'Resolving…' : 'Resolve gate'}
          </Button>
        </React.Fragment>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          The original deadline stays in the timeline. Prospect adds a separate resolution event
          and removes the gate from Today and future notifications.
        </p>
        <Select
          label="Reason"
          options={REASON_OPTIONS}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Textarea
          label="Note"
          hint="optional"
          rows={3}
          maxLength={1000}
          placeholder="What completed, changed, or replaced this gate?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{error}</p>}
      </div>
    </Dialog>
  );
}
