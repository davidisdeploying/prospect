import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType, BorderStyle, Document, LevelFormat, Packer, Paragraph, TextRun,
} from 'docx';
import PDFDocument from 'pdfkit';
import { sha256File } from './fileSafety.js';

const clean = (value, max = 2000) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export class PackageDraftValidationError extends Error {}

function draftError(message) {
  throw new PackageDraftValidationError(message);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) draftError(`${label} must be a JSON object`);
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) draftError(`${label} must contain exactly: ${wanted.join(', ')}`);
}

function stringArray(value, label, { min = 0, max = 50 } = {}) {
  if (!Array.isArray(value)) draftError(`${label} must be an array`);
  const result = value.map((item) => clean(item, 1000)).filter(Boolean).slice(0, max);
  if (result.length < min) draftError(`${label} must contain at least ${min} item(s)`);
  return result;
}

export function validatePackageDraft(value, packageRow) {
  exactKeys(value, ['resume', 'cover_letter', 'verification'], 'draft');
  if (!value.resume || !value.cover_letter || !Array.isArray(value.verification)) draftError('draft must contain resume, cover_letter, and verification');
  exactKeys(value.resume, ['name', 'contact_line', 'summary', 'skills', 'experience', 'education', 'certifications'], 'resume');
  const resume = {
    name: clean(value.resume.name, 100), contact_line: clean(value.resume.contact_line, 300),
    summary: clean(value.resume.summary, 1200), skills: stringArray(value.resume.skills, 'resume.skills', { min: 1 }),
    experience: Array.isArray(value.resume.experience) ? value.resume.experience.slice(0, 12).map((item, index) => {
      exactKeys(item, ['employer', 'title', 'dates', 'location', 'bullets'], `resume.experience[${index}]`);
      const row = {
        employer: clean(item?.employer, 200), title: clean(item?.title, 200), dates: clean(item?.dates, 100),
        location: clean(item?.location, 150), bullets: stringArray(item?.bullets, `resume.experience[${index}].bullets`, { min: 1, max: 10 }),
      };
      if (!row.employer || !row.title || !row.dates) draftError(`resume.experience[${index}] is missing employer, title, or dates`);
      return row;
    }) : null,
    education: stringArray(value.resume.education, 'resume.education'),
    certifications: stringArray(value.resume.certifications, 'resume.certifications'),
  };
  if (!resume.name || !resume.contact_line || !resume.summary || !resume.experience?.length) draftError('resume is missing required grounded content');
  const coverLetter = {
    salutation: clean(value.cover_letter.salutation, 200),
    paragraphs: stringArray(value.cover_letter.paragraphs, 'cover_letter.paragraphs', { min: 2, max: 8 }),
    closing: clean(value.cover_letter.closing, 300),
  };
  exactKeys(value.cover_letter, ['salutation', 'paragraphs', 'closing'], 'cover_letter');
  if (!coverLetter.salutation || !coverLetter.closing) draftError('cover letter is missing salutation or closing');
  const allowedClaims = new Set(packageRow.evidence_snapshot?.claims?.map((item) => item.claim_id) || []);
  const verification = value.verification.map((item, index) => {
    exactKeys(item, ['statement', 'evidence_claim_ids'], `verification[${index}]`);
    const statement = clean(item?.statement, 1000);
    const evidenceClaimIds = stringArray(item?.evidence_claim_ids, `verification[${index}].evidence_claim_ids`, { min: 1 });
    if (!statement || evidenceClaimIds.some((id) => !allowedClaims.has(id))) draftError(`verification[${index}] contains ungrounded evidence`);
    return { statement, evidence_claim_ids: evidenceClaimIds };
  });
  if (!verification.length) draftError('verification must contain at least one grounded statement');
  const allText = JSON.stringify({ resume, coverLetter }).toLowerCase();
  if (/\bwgu\b|western governors university/i.test(allText)) draftError('draft contains private WGU information');
  for (const blocked of packageRow.baseline_audit?.blocked_statements || []) {
    const phrase = clean(blocked?.text || blocked?.statement || blocked, 500);
    if (phrase && allText.includes(phrase.toLowerCase())) draftError(`draft contains baseline-blocked statement: ${phrase}`);
  }
  return { resume, cover_letter: coverLetter, verification };
}

function safeAscii(value) {
  return String(value ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '');
}

const documentStyles = {
  default: {
    document: {
      run: { font: 'Georgia', size: 19, color: '202020' },
      paragraph: { spacing: { after: 45, line: 220, lineRule: 'auto' } },
    },
  },
  paragraphStyles: [
    {
      id: 'ProspectName', name: 'Prospect Name', basedOn: 'Normal', quickFormat: true,
      run: { font: 'Arial', bold: true, size: 30, color: '202020' },
      paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 25 } },
    },
    {
      id: 'ProspectContact', name: 'Prospect Contact', basedOn: 'Normal', quickFormat: true,
      run: { font: 'Arial', size: 17, color: '555555' },
      paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 75 } },
    },
    {
      id: 'ProspectHeading', name: 'Prospect Heading', basedOn: 'Normal', quickFormat: true,
      run: { font: 'Arial', bold: true, size: 17, color: '8F1D1D', allCaps: true },
      paragraph: {
        spacing: { before: 85, after: 35 },
        border: { bottom: { color: 'A3262A', space: 1, style: BorderStyle.SINGLE, size: 6 } },
        keepNext: true,
      },
    },
    {
      id: 'ProspectJob', name: 'Prospect Job', basedOn: 'Normal', quickFormat: true,
      paragraph: { spacing: { before: 40, after: 10 }, keepNext: true },
    },
    {
      id: 'ProspectMeta', name: 'Prospect Meta', basedOn: 'Normal', quickFormat: true,
      run: { font: 'Arial', size: 16, color: '555555' },
      paragraph: { spacing: { after: 20 }, keepNext: true },
    },
    {
      id: 'ProspectLetter', name: 'Prospect Letter', basedOn: 'Normal', quickFormat: true,
      run: { font: 'Georgia', size: 21, color: '202020' },
      paragraph: { spacing: { after: 145, line: 255, lineRule: 'auto' } },
    },
  ],
};

const numbering = {
  config: [{
    reference: 'prospect-bullets',
    levels: [{
      level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 330, hanging: 170 }, spacing: { after: 20 } } },
    }],
  }],
};

function heading(text) {
  return new Paragraph({ style: 'ProspectHeading', text: safeAscii(text).toUpperCase() });
}

function headerParagraphs(resume) {
  return [
    new Paragraph({ style: 'ProspectName', text: safeAscii(resume.name) }),
    new Paragraph({ style: 'ProspectContact', text: safeAscii(resume.contact_line) }),
  ];
}

function resumeParagraphs(value) {
  const resume = value.resume;
  const paragraphs = [
    ...headerParagraphs(resume),
    heading('Professional Summary'),
    new Paragraph({ text: safeAscii(resume.summary) }),
    heading('Core Skills'),
    new Paragraph({ text: resume.skills.map(safeAscii).join(' | ') }),
    heading('Experience'),
  ];
  for (const job of resume.experience) {
    paragraphs.push(
      new Paragraph({
        style: 'ProspectJob',
        children: [
          new TextRun({ text: safeAscii(job.employer), bold: true }),
          new TextRun({ text: ' | ' }),
          new TextRun({ text: safeAscii(job.title), italics: true }),
        ],
      }),
      new Paragraph({
        style: 'ProspectMeta',
        text: safeAscii(`${job.dates}${job.location ? ` | ${job.location}` : ''}`),
      }),
      ...job.bullets.map((bullet) => new Paragraph({
        numbering: { reference: 'prospect-bullets', level: 0 },
        text: safeAscii(bullet),
      })),
    );
  }
  if (resume.education.length) paragraphs.push(
    heading('Education'),
    ...resume.education.map((text) => new Paragraph({ text: safeAscii(text) })),
  );
  if (resume.certifications.length) paragraphs.push(
    heading('Certifications'),
    ...resume.certifications.map((text) => new Paragraph({ text: safeAscii(text) })),
  );
  return paragraphs;
}

function closingRuns(value) {
  return safeAscii(value).split('\n').map((text, index) => new TextRun({ text, break: index === 0 ? 0 : 1 }));
}

function letterParagraphs(value) {
  const letter = value.cover_letter;
  return [
    ...headerParagraphs(value.resume),
    heading('Cover Letter'),
    new Paragraph({ style: 'ProspectLetter', text: safeAscii(letter.salutation) }),
    ...letter.paragraphs.map((text) => new Paragraph({ style: 'ProspectLetter', text: safeAscii(text) })),
    new Paragraph({ style: 'ProspectLetter', children: closingRuns(letter.closing) }),
  ];
}

function wordDocument(children) {
  return new Document({
    styles: documentStyles,
    numbering,
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 540, right: 720, bottom: 540, left: 720, header: 0, footer: 0, gutter: 0 },
        },
      },
      children,
    }],
  });
}

function pdfBuffer(draw) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const document = new PDFDocument({
      autoFirstPage: true,
      size: 'LETTER',
      margins: { top: 38, right: 48, bottom: 38, left: 48 },
      info: { Title: 'Prospect application package', Author: 'David Gomez', Creator: 'Prospect' },
    });
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    try { draw(document); document.end(); } catch (error) { reject(error); }
  });
}

function pdfHeader(document, resume) {
  document.font('Helvetica-Bold').fontSize(15).fillColor('#202020')
    .text(safeAscii(resume.name), { align: 'center', lineGap: 0 });
  document.moveDown(0.05).font('Helvetica').fontSize(8.25).fillColor('#555555')
    .text(safeAscii(resume.contact_line), { align: 'center', lineGap: 0 });
  document.moveDown(0.35);
}

function pdfHeading(document, text) {
  document.moveDown(0.25).font('Helvetica-Bold').fontSize(8.2).fillColor('#8f1d1d')
    .text(safeAscii(text).toUpperCase(), { characterSpacing: 0.55, lineGap: 0 });
  const ruleY = document.y + 1;
  document.save().strokeColor('#a3262a').lineWidth(0.65)
    .moveTo(document.page.margins.left, ruleY)
    .lineTo(document.page.width - document.page.margins.right, ruleY).stroke().restore();
  document.y = ruleY + 3;
}

function pdfBody(document, text, options = {}) {
  document.font(options.bold ? 'Times-Bold' : options.italics ? 'Times-Italic' : 'Times-Roman')
    .fontSize(options.size || 8.8).fillColor(options.color || '#202020')
    .text(safeAscii(text), { lineGap: 0.4, paragraphGap: options.paragraphGap ?? 1.5 });
}

function pdfBullets(document, bullets) {
  for (const bullet of bullets) {
    const text = safeAscii(bullet);
    const left = document.page.margins.left + 11;
    const width = document.page.width - document.page.margins.right - left;
    const height = document.font('Times-Roman').fontSize(8.55).heightOfString(text, { width, lineGap: 0.2 });
    if (document.y + height > document.page.height - document.page.margins.bottom) document.addPage();
    const y = document.y + 4;
    document.save().fillColor('#202020').circle(document.page.margins.left + 3, y, 1.35).fill().restore();
    document.fillColor('#202020').text(text, left, document.y, { width, lineGap: 0.2, paragraphGap: 1 });
  }
}

function renderResumePdf(value) {
  return pdfBuffer((document) => {
    const resume = value.resume;
    pdfHeader(document, resume);
    pdfHeading(document, 'Professional Summary');
    pdfBody(document, resume.summary);
    pdfHeading(document, 'Core Skills');
    pdfBody(document, resume.skills.join(' | '));
    pdfHeading(document, 'Experience');
    for (const job of resume.experience) {
      document.font('Times-Bold').fontSize(9).fillColor('#202020').text(safeAscii(job.employer), { continued: true });
      document.font('Times-Italic').text(safeAscii(` | ${job.title}`));
      document.font('Helvetica').fontSize(7.8).fillColor('#555555')
        .text(safeAscii(`${job.dates}${job.location ? ` | ${job.location}` : ''}`), { paragraphGap: 0.5 });
      pdfBullets(document, job.bullets);
    }
    if (resume.education.length) {
      pdfHeading(document, 'Education');
      for (const item of resume.education) pdfBody(document, item, { paragraphGap: 0.5 });
    }
    if (resume.certifications.length) {
      pdfHeading(document, 'Certifications');
      for (const item of resume.certifications) pdfBody(document, item, { paragraphGap: 0.5 });
    }
  });
}

function renderLetterPdf(value) {
  return pdfBuffer((document) => {
    pdfHeader(document, value.resume);
    pdfHeading(document, 'Cover Letter');
    document.moveDown(0.35);
    pdfBody(document, value.cover_letter.salutation, { size: 10, paragraphGap: 7 });
    for (const paragraph of value.cover_letter.paragraphs) pdfBody(document, paragraph, { size: 10, paragraphGap: 8 });
    pdfBody(document, value.cover_letter.closing, { size: 10 });
  });
}

function dualStamp(now) {
  const utc = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${utc} / ${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} CDT`;
}

export async function renderApplicationPackage({ packageRow, draft, artifactRoot, metadata = {}, now = new Date() }) {
  const validated = validatePackageDraft(draft, packageRow);
  const directory = applicationPackageArtifactDirectory(artifactRoot, packageRow.id, now);
  if (fs.existsSync(directory)) throw new Error(`artifact directory already exists: ${directory}`);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const temp = `${directory}.tmp-${crypto.randomUUID()}`; fs.mkdirSync(temp);
  try {
    const [resumeDocx, resumePdf, letterDocx, letterPdf] = await Promise.all([
      Packer.toBuffer(wordDocument(resumeParagraphs(validated))),
      renderResumePdf(validated),
      Packer.toBuffer(wordDocument(letterParagraphs(validated))),
      renderLetterPdf(validated),
    ]);
    const files = {
      'resume.docx': resumeDocx,
      'resume.pdf': resumePdf,
      'cover_letter.docx': letterDocx,
      'cover_letter.pdf': letterPdf,
    };
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(temp, name), bytes, { flag: 'wx' });
    const hashes = Object.fromEntries(Object.keys(files).map((name) => [name, sha256File(path.join(temp, name))]));
    const verification = { schema_version: 1, package_id: packageRow.id, run_token: metadata.runToken || null, response_token_match: metadata.responseTokenMatch === true, statements: validated.verification, artifacts: hashes };
    fs.writeFileSync(path.join(temp, 'verification.json'), JSON.stringify(verification, null, 2) + '\n', { flag: 'wx' });
    hashes['verification.json'] = sha256File(path.join(temp, 'verification.json'));
    const rows = Object.entries(hashes).map(([name, hash]) => `| \`${name}\` | \`${hash}\` | generated derivative |`).join('\n');
    const manifest = `# Artifact manifest\n\n- Created: \`${dualStamp(now)}\`\n- Project: \`Career\`\n- Producing seat: \`prospect-worker\`\n- Model/provider: \`${metadata.model || 'unknown'} / ${metadata.provider || 'unknown'}\`\n- Source task or token: \`${metadata.runToken || 'local deterministic render'}\`\n- Purpose: \`Grounded application package ${packageRow.id}; local review only, never submitted\`\n- Sensitivity: \`sensitive\`\n- Retention: \`keep\`\n\n## Files\n\n| File | SHA-256 | Role |\n|---|---|---|\n${rows}\n\n## Verification\n\n\`Strict draft schema and Career evidence identifiers validated; four documents hashed before Prospect registration. Human review remains required before any external use.\`\n`;
    fs.writeFileSync(path.join(temp, 'MANIFEST.md'), manifest, { flag: 'wx' });
    fs.renameSync(temp, directory);
    return { directory, validated, hashes, files: Object.keys(files).map((name) => ({ name, path: path.join(directory, name), sha256: hashes[name] })) };
  } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
}

export function applicationPackageArtifactDirectory(artifactRoot, packageId, now = new Date()) {
  const date = now.toISOString().slice(0, 10); const year = date.slice(0, 4);
  return path.join(path.resolve(artifactRoot), year, date, `prospect-worker-prospect-package-${packageId}`);
}

export function inspectApplicationPackageRender({ packageRow, artifactRoot, metadata = {}, now = new Date() }) {
  const directory = applicationPackageArtifactDirectory(artifactRoot, packageRow.id, now);
  const names = ['resume.docx', 'resume.pdf', 'cover_letter.docx', 'cover_letter.pdf'];
  const companionNames = ['verification.json', 'MANIFEST.md'];
  for (const name of [...names, ...companionNames]) {
    const candidate = path.join(directory, name);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`rendered companion is not a regular file: ${name}`);
  }
  const verification = JSON.parse(fs.readFileSync(path.join(directory, 'verification.json'), 'utf8'));
  if (Number(verification.package_id) !== Number(packageRow.id)) throw new Error('rendered package id does not match');
  if (metadata.runToken && verification.run_token !== metadata.runToken) throw new Error('rendered package token does not match');
  if (verification.response_token_match !== true) throw new Error('rendered package lacks response token verification');
  const hashes = {};
  for (const name of names) {
    hashes[name] = sha256File(path.join(directory, name));
    if (verification.artifacts?.[name] !== hashes[name]) throw new Error(`rendered artifact hash drift: ${name}`);
  }
  hashes['verification.json'] = sha256File(path.join(directory, 'verification.json'));
  return { directory, hashes, files: names.map((name) => ({ name, path: path.join(directory, name), sha256: hashes[name] })) };
}
