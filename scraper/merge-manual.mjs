#!/usr/bin/env node
// Merges hand-pulled summaries (written during a one-time browser pull of guidelines whose
// publishers block automated access) into docs/data/summaries.json.
//
// Usage: node scraper/merge-manual.mjs <dir-of-json-files>
// Each file: { id, summary, key_points, topics, category, population, source_type,
//              is_major_guideline, discusses_guidelines, limitations, basis, access }
// Files with a "blocked" field are skipped. Summaries are stored under the guideline's current
// fingerprint, so the monthly summarizer leaves them alone until the guideline itself changes.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS, CATEGORIES } from './topics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];
if (!dir) throw new Error('usage: node scraper/merge-manual.mjs <dir>');

const data = JSON.parse(await readFile(path.join(ROOT, 'docs/data/guidelines.json'), 'utf8'));
const storeFile = path.join(ROOT, 'docs/data/summaries.json');
const store = JSON.parse(await readFile(storeFile, 'utf8'));
const byId = new Map(data.guidelines.map((g) => [g.id, g]));
const topicSet = new Set(TOPICS);
const catSet = new Set(CATEGORIES);

let merged = 0;
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
  const x = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
  if (x.blocked) { console.log(`skip (blocked): ${x.id}`); continue; }
  const g = byId.get(x.id);
  if (!g) { console.log(`skip (unknown id): ${x.id}`); continue; }
  const problems = [];
  if (!x.summary?.trim()) problems.push('empty summary');
  if (!Array.isArray(x.key_points) || x.key_points.length < 2) problems.push('too few key points');
  const topics = (x.topics ?? []).filter((t) => topicSet.has(t));
  if (!topics.length) problems.push('no valid topics');
  if (!catSet.has(x.category)) problems.push(`bad category ${x.category}`);
  if (problems.length) { console.log(`skip (${problems.join(', ')}): ${x.id}`); continue; }
  store.items[x.id] = {
    fp: g.fingerprint,
    summary: x.summary.trim(),
    key_points: x.key_points.map((s) => s.trim()).filter(Boolean).slice(0, 8),
    topics: topics.slice(0, 3),
    category: x.category,
    population: x.population ?? 'Unclear',
    source_type: x.source_type ?? 'society guideline',
    is_major_guideline: x.is_major_guideline ?? true,
    discusses_guidelines: x.discusses_guidelines ?? [],
    limitations: (x.limitations ?? '').trim(),
    basis: x.basis ?? 'full text (one-time pull)',
    access: x.access ?? 'free',
    model: 'claude (one-time browser pull)',
    generatedAt: new Date().toISOString(),
  };
  merged++;
  console.log(`merged: ${g.title}`);
}
await writeFile(storeFile, JSON.stringify(store) + '\n');
console.log(`${merged} summaries merged.`);
