import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GMAIL_QUERY,
  GMAIL_READONLY_SCOPE,
  LINKEDIN_ALERT_SENDER,
  parseLinkedInAlert,
} from '../server/scoutGmail.js';

function encoded(value) {
  return Buffer.from(value).toString('base64url');
}

function forwardedMessage(html, plain = '') {
  return {
    id: 'gmail-message-1',
    threadId: 'gmail-thread-1',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'owner@example.com' },
        { name: 'Subject', value: 'Fwd: cloud engineer jobs' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: encoded(plain) } },
        { mimeType: 'text/html', body: { data: encoded(html) } },
      ],
    },
  };
}

function directMessage(html, plain = '') {
  return {
    id: 'gmail-message-2',
    threadId: 'gmail-thread-2',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: `LinkedIn Job Alerts <${LINKEDIN_ALERT_SENDER}>` },
        { name: 'Subject', value: '"Senior Cloud Engineer": Public Storage and more' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: encoded(plain) } },
        { mimeType: 'text/html', body: { data: encoded(html) } },
      ],
    },
  };
}

test('Gmail bridge uses the read-only scope and a narrow outer-sender query', () => {
  assert.equal(GMAIL_READONLY_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
  assert.match(DEFAULT_GMAIL_QUERY, /^from:\(/);
  assert.ok(DEFAULT_GMAIL_QUERY.includes('owner@example.com'));
  assert.ok(DEFAULT_GMAIL_QUERY.includes(LINKEDIN_ALERT_SENDER));
  assert.ok(DEFAULT_GMAIL_QUERY.includes('newer_than:'));
});

test('parser verifies the embedded LinkedIn sender and extracts unique titled jobs', () => {
  const html = `
    <p>From: LinkedIn Job Alerts &lt;${LINKEDIN_ALERT_SENDER}&gt;</p>
    <div>
      <a href="https://www.linkedin.com/comm/jobs/view/4348069115/?trackingId=abc">
        Senior Cloud Engineer&nbsp;
      </a>
      <p>Public Storage · Dallas, Texas</p>
      <a href="https://www.linkedin.com/jobs/view/4348069115/?trk=email">View job</a>
    </div>
    <div>
      <a href="https://www.linkedin.com/comm/jobs/view/4455667788/?midToken=x">
        Desktop Support Technician
      </a>
      <p>Contoso</p><p>Richardson, Texas</p>
    </div>`;
  const result = parseLinkedInAlert(forwardedMessage(html));
  assert.equal(result.accepted, true);
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(result.jobs.map((job) => job.external_job_id), ['4348069115', '4455667788']);
  assert.equal(result.jobs[0].role, 'Senior Cloud Engineer');
  assert.equal(result.jobs[0].company, 'Public Storage');
  assert.equal(result.jobs[0].location, 'Dallas, Texas');
  assert.equal(result.jobs[0].source_url, 'https://www.linkedin.com/jobs/view/4348069115/');
});

test('parser accepts a direct LinkedIn alert whose sender appears only in the From header', () => {
  const html = `
    <div>
      <a href="https://www.linkedin.com/comm/jobs/view/4501122334/?trackingId=direct">
        Senior Cloud Engineer&nbsp;
      </a>
      <p>Public Storage &middot; Dallas, Texas</p>
    </div>`;
  const result = parseLinkedInAlert(directMessage(html));
  assert.equal(result.accepted, true);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].external_job_id, '4501122334');
  assert.equal(result.jobs[0].role, 'Senior Cloud Engineer');
  assert.equal(result.jobs[0].company, 'Public Storage');
  assert.equal(result.jobs[0].location, 'Dallas, Texas');
});

test('entity decoding splits company from location on a raw &middot; separator', () => {
  const decoded = parseLinkedInAlert(directMessage(`
    <div>
      <a href="https://www.linkedin.com/comm/jobs/view/4509988776/">Data Center Technician</a>
      <p>Ericsson &middot; Fort Worth, TX</p>
    </div>`));
  assert.equal(decoded.jobs.length, 1);
  assert.equal(decoded.jobs[0].company, 'Ericsson');
  assert.equal(decoded.jobs[0].location, 'Fort Worth, TX');
  assert.ok(!decoded.jobs[0].company.includes('&'), 'company must not retain a raw HTML entity');
});

test('parser rejects unrelated forwarded mail even if it contains a LinkedIn job URL', () => {
  const result = parseLinkedInAlert(forwardedMessage(
    '<a href="https://www.linkedin.com/jobs/view/123456/">Cloud Engineer</a>'
  ));
  assert.equal(result.accepted, false);
  assert.equal(result.jobs.length, 0);
});
