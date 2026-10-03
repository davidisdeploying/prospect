import React from 'react';
import { Dialog } from '@ds/components/feedback/Dialog.jsx';
import { Input } from '@ds/components/forms/Input.jsx';
import { Select } from '@ds/components/forms/Select.jsx';
import { Textarea } from '@ds/components/forms/Textarea.jsx';
import { Button } from '@ds/components/core/Button.jsx';
import { listResumeVersions, createResumeVersion } from './api.js';

const EMPTY = {
  role: '', company: '', location: '', comp: '',
  source_url: '', employment_type: '', workplace_type: '',
  salary_min: '', salary_max: '', salary_period: '', salary_currency: '',
  posted_at: '', description: '',
};

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'internship', label: 'Internship' },
  { value: 'other', label: 'Other' },
];

const WORKPLACE_TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'on_site', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];

const SALARY_PERIOD_OPTIONS = [
  { value: '', label: '—' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

// Trim strings; drop blank fields entirely so we never send "".
function present(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

export function StakeDialog({ open, onClose, onStake }) {
  const [fields, setFields] = React.useState(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const [resumeVersions, setResumeVersions] = React.useState([]);
  const [resumeVersionId, setResumeVersionId] = React.useState('');
  const [creatingResume, setCreatingResume] = React.useState(false);
  const [newResumeLabel, setNewResumeLabel] = React.useState('');
  const [resumeError, setResumeError] = React.useState(null);

  React.useEffect(() => {
    if (open) {
      setFields(EMPTY); setError(null); setSubmitting(false);
      setResumeVersionId(''); setCreatingResume(false); setNewResumeLabel(''); setResumeError(null);
      listResumeVersions()
        .then((data) => setResumeVersions(data.resume_versions))
        .catch(() => setResumeVersions([]));
    }
  }, [open]);

  function set(key) {
    return (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  }

  async function addResumeVersion() {
    const label = newResumeLabel.trim();
    if (!label) return;
    setResumeError(null);
    try {
      const created = await createResumeVersion({ label });
      setResumeVersions((rv) => [created, ...rv]);
      setResumeVersionId(String(created.id));
      setCreatingResume(false);
      setNewResumeLabel('');
    } catch (err) {
      setResumeError(err.message);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const salaryMin = present(fields.salary_min);
      const salaryMax = present(fields.salary_max);
      await onStake({
        source: 'Manual',
        company: present(fields.company) ?? null,
        role: present(fields.role) || 'Untitled role',
        location: present(fields.location) ?? null,
        comp: present(fields.comp) ?? null,
        ...(present(fields.source_url) && { source_url: present(fields.source_url) }),
        ...(present(fields.employment_type) && { employment_type: present(fields.employment_type) }),
        ...(present(fields.workplace_type) && { workplace_type: present(fields.workplace_type) }),
        ...(salaryMin && { salary_min: Number(salaryMin) }),
        ...(salaryMax && { salary_max: Number(salaryMax) }),
        ...(present(fields.salary_period) && { salary_period: present(fields.salary_period) }),
        ...(present(fields.salary_currency) && { salary_currency: present(fields.salary_currency).toUpperCase() }),
        ...(present(fields.posted_at) && { posted_at: present(fields.posted_at) }),
        ...(present(fields.description) && { description: present(fields.description) }),
      }, resumeVersionId ? Number(resumeVersionId) : undefined);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Stake a claim"
      onClose={onClose}
      width={520}
      footer={
        <React.Fragment>
          <Button variant="quiet" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="gold" disabled={!fields.role.trim() || submitting} onClick={submit}>
            Stake a claim
          </Button>
        </React.Fragment>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
        <Input label="Role" placeholder="Senior Backend Engineer" value={fields.role} onChange={set('role')} autoFocus />
        <Input label="Company" placeholder="Granite Map Co." value={fields.company} onChange={set('company')} />
        <Input label="Location" placeholder="Remote (US)" value={fields.location} onChange={set('location')} />
        <Input label="Comp" placeholder="$185k – $215k" mono value={fields.comp} onChange={set('comp')} />
        <Input label="Listing URL" placeholder="https://…" value={fields.source_url} onChange={set('source_url')} />
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <Select label="Employment type" options={EMPLOYMENT_TYPE_OPTIONS} value={fields.employment_type} onChange={set('employment_type')} />
          </div>
          <div style={{ flex: 1 }}>
            <Select label="Workplace" options={WORKPLACE_TYPE_OPTIONS} value={fields.workplace_type} onChange={set('workplace_type')} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Salary range
          </span>
          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <Input placeholder="Min" mono value={fields.salary_min} onChange={set('salary_min')} />
            </div>
            <div style={{ flex: 1 }}>
              <Input placeholder="Max" mono value={fields.salary_max} onChange={set('salary_max')} />
            </div>
            <div style={{ flex: 1 }}>
              <Select options={SALARY_PERIOD_OPTIONS} value={fields.salary_period} onChange={set('salary_period')} />
            </div>
            <div style={{ flex: 1 }}>
              <Input placeholder="USD" mono value={fields.salary_currency} onChange={set('salary_currency')} />
            </div>
          </div>
        </div>
        <Input label="Posted date" type="date" value={fields.posted_at} onChange={set('posted_at')} />
        <Textarea label="Description" placeholder="Paste the listing text…" value={fields.description} onChange={set('description')} />
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Select
                label="Résumé version"
                options={[{ value: '', label: '— skip —' }, ...resumeVersions.map((rv) => ({ value: String(rv.id), label: rv.label }))]}
                value={resumeVersionId}
                onChange={(e) => setResumeVersionId(e.target.value)}
              />
            </div>
            <Button variant="quiet" size="sm" onClick={() => setCreatingResume((v) => !v)}>
              {creatingResume ? 'Cancel' : '+ New'}
            </Button>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
            optional; which résumé you'll send
          </p>
          {creatingResume && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <Input placeholder="e.g. v3 — backend focus" value={newResumeLabel} onChange={(e) => setNewResumeLabel(e.target.value)} />
              </div>
              <Button variant="quiet" size="sm" disabled={!newResumeLabel.trim()} onClick={addResumeVersion}>
                Add
              </Button>
            </div>
          )}
          {resumeError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '6px 0 0' }}>{resumeError}</p>}
        </div>
        {error && <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-faint)', margin: 0 }}>
          survey the field · stake the few worth your time
        </p>
      </div>
    </Dialog>
  );
}
