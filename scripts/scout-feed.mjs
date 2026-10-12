#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baseUrl = (process.env.PROSPECT_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const command = process.argv[2];
const inputPath = process.argv[3];

function usage() {
  console.error('usage: node scripts/scout-feed.mjs profile [json-file]');
  console.error('   or: node scripts/scout-feed.mjs import <json-file>');
  process.exit(2);
}

async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error || JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
}

if (command === 'profile') {
  const file = inputPath || path.join(root, 'config', 'scout-profile.json');
  await post('/api/scout/profile', JSON.parse(fs.readFileSync(file, 'utf8')));
} else if (command === 'import' && inputPath) {
  await post('/api/scout/discoveries/import', JSON.parse(fs.readFileSync(inputPath, 'utf8')));
} else {
  usage();
}
