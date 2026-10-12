import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyJobFamily, UNCATEGORIZED } from '../jobFamily.js';

// §5.2.4 oracle — the 9 live listings (FLEET-WORKER1-BUILD-20260719-524-job-family).
const ORACLE = [
  ['IT Support Associate II, OTS', 'it_support'],
  ['IT Support Specialist – Systems & Microsoft 365 Focus', 'it_support'],
  ['Associate Engineer, Data Center', 'datacenter'],
  ['Desktop Support Technician', 'desktop_support'],
  ['IT Support Technician', 'it_support'],
  ['Desktop Technician', 'desktop_support'],
  ['L-1 Technical Support', 'it_support'],
  ['ServiceNow Desktop Support', 'desktop_support'],
  ['Datacenter Technician', 'datacenter'],
];

test('classifyJobFamily matches the §5.2.4 oracle for all 9 live titles', () => {
  for (const [role, expected] of ORACLE) {
    assert.equal(classifyJobFamily(role), expected, `title: ${role}`);
  }
});

test('classifyJobFamily is case-insensitive', () => {
  assert.equal(classifyJobFamily('desktop support technician'), 'desktop_support');
  assert.equal(classifyJobFamily('DESKTOP SUPPORT TECHNICIAN'), 'desktop_support');
  assert.equal(classifyJobFamily('DataCenter Technician'), 'datacenter');
});

test('classifyJobFamily treats "data center" and "datacenter" as equivalent', () => {
  assert.equal(classifyJobFamily('Data Center Technician'), 'datacenter');
  assert.equal(classifyJobFamily('Datacenter Technician'), 'datacenter');
  assert.equal(classifyJobFamily('DATA CENTER Technician'), 'datacenter');
});

test('classifyJobFamily falls back to uncategorized for an unmatched title', () => {
  assert.equal(classifyJobFamily('Staff Accountant'), UNCATEGORIZED);
  assert.equal(classifyJobFamily('Product Manager'), UNCATEGORIZED);
});

test('classifyJobFamily falls back to uncategorized for empty/whitespace/nullish titles', () => {
  assert.equal(classifyJobFamily(''), UNCATEGORIZED);
  assert.equal(classifyJobFamily('   '), UNCATEGORIZED);
  assert.equal(classifyJobFamily(null), UNCATEGORIZED);
  assert.equal(classifyJobFamily(undefined), UNCATEGORIZED);
});

test('classifyJobFamily checks datacenter before desktop/it-support (rule order)', () => {
  assert.equal(classifyJobFamily('Desktop Support Engineer, Data Center'), 'datacenter');
});
