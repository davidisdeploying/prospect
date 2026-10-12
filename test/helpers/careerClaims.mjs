import { stringify } from 'yaml';

const records = [
  ['skill-windows-endpoint-deployment', 'P1', ['sccm', 'mecm', 'windows deployment']],
  ['skill-firmware-device-security-configuration', 'P1', ['bios', 'uefi']],
  ['skill-hardware-lifecycle-breakfix', 'P1', ['hardware', 'break-fix']],
  ['skill-asset-inventory-operations', 'P1', ['inventory', 'asset management']],
  ['skill-linux-administration', 'P2', ['linux', 'ubuntu']],
  ['skill-networking-foundations', 'P2', ['networking', 'dns']],
  ['skill-containers', 'P2', ['docker', 'containers']],
  ['skill-python-automation', 'P2', ['python', 'automation']],
  ['skill-aws-coursework', 'C1', ['aws']],
  ['skill-azure-coursework', 'C1', ['azure']],
  ['skill-vmware-coursework', 'C1', ['vmware']],
  ['skill-windows-server-active-directory', 'C2', ['active directory', 'windows server']],
  ['credential-cs50p', 'X1', ['cs50p']],
  ['education-collin-aas-cloud-infrastructure', 'X1', ['associate degree', 'aas']],
  ['target-exclusion-cybersecurity', 'X1', []],
];

export function careerClaimsFixture(overrides = {}) {
  const claims = records.map(([claim_id, evidence_class, match_terms]) => ({
    claim_id,
    kind: claim_id.startsWith('skill-') ? 'skill' : 'preference',
    status: 'current', evidence_class,
    claim: `Canonical fact for ${claim_id}.`,
    safe_language: `Safe language for ${claim_id}.`,
    prohibited_inference: ['unsupported inference'],
    source_refs: ['fixture source'], confidence: 'high', public_safe: true,
    match_terms, job_families: ['infrastructure-support'],
    ...(overrides[claim_id] || {}),
  }));
  return `# Fixture\n\n\`\`\`yaml\n${stringify({ schema_version: 2, person: 'David Gomez', claims })}\`\`\`\n`;
}
