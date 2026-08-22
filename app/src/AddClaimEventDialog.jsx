import React from 'react';
import { Dialog } from '@ds/components/feedback/Dialog.jsx';
import { Select } from '@ds/components/forms/Select.jsx';
import { Input } from '@ds/components/forms/Input.jsx';
import { Textarea } from '@ds/components/forms/Textarea.jsx';
import { Button } from '@ds/components/core/Button.jsx';

// Source of truth: server/validate.js ENUMS.claim_event_kind — keep in sync.
const KIND_OPTIONS = [
  { value: '', label: 'Select a kind…' },
  { value: 'assessment_requested', label: 'Assessment requested' },
  { value: 'assessment_completed', label: 'Assessment completed' },
  { value: 'recruiter_contact', label: 'Recruiter contact' },
  { value: 'employer_email', label: 'Employer email' },
  { value: 'status_check', label: 'Status check' },
];

const EMPTY = { kind: '', due_at: '', note: '' };

// Fail-closed shape mirrors DeleteClaimDialog/StakeDialog: onAdd is awaited, the dialog itself
// never closes on success (the caller does that once the request truly lands) and stays open
// with the error rendered inline on failure.
export function AddClaimEventDialog({ open, onClose, onAdd }) {
  const [fields, setFields] = React.useState(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (open) { setFields(EMPTY); setError(null); setSubmitting(false); }
  }, [open]);

  function set(key) {
    return (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function submit() {
    if (!fields.kind) return;
    setSubmitting(true);
    setError(null);
    try {
      const note = fields.note.trim();
      await onAdd({
        kind: fields.kind,
        due_at: fields.due_at || null,
        payload: note ? { note } : null,
      });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Log a touchpoint"
      onClose={onClose}
      width={420}
      footer={
        <React.Fragment>
          <Button variant="quiet" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="gold" disabled={!fields.kind || submitting} onClick={submit}>
            {submitting ? 'Logging…' : 'Log touchpoint'}
          </Button>
        </React.Fragment>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Select label="Kind" options={KIND_OPTIONS} value={fields.kind} onChange={set('kind')} />
        <Input label="Due" hint="optional" type="date" mono value={fields.due_at} onChange={set('due_at')} />
        <Textarea label="Note" hint="optional" rows={3} placeholder="Any detail worth keeping" value={fields.note} onChange={set('note')} />
        {error && <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{error}</p>}
      </div>
    </Dialog>
  );
}
