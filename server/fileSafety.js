import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertNoSymlinkComponents(root, candidate) {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlinks are not allowed');
  }
}

export function regularFileBeneath(candidatePath, rootPath) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) throw new Error('path is required');
  const root = fs.realpathSync(path.resolve(rootPath));
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path must be a file beneath the configured root');
  assertNoSymlinkComponents(root, candidate);
  const real = fs.realpathSync(candidate);
  const realRelative = path.relative(root, real);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('path escapes the configured root');
  if (!fs.statSync(real).isFile()) throw new Error('path must identify a regular file');
  return real;
}

export function regularFile(candidatePath) {
  const candidate = path.resolve(candidatePath);
  const parsed = path.parse(candidate);
  assertNoSymlinkComponents(parsed.root, candidate);
  const real = fs.realpathSync(candidate);
  if (!fs.statSync(real).isFile()) throw new Error('path must identify a regular file');
  return real;
}
