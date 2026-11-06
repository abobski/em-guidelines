#!/usr/bin/env node
// Pulls guidelines from every source adapter, merges with the previous snapshot,
// and writes docs/data/guidelines.json + docs/data/changelog.json.
//
// Usage: node scraper/index.mjs [--only=nch]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorize } from './categories.mjs';
import * as nch from './sources/nationwide-childrens.mjs';
import * as chop from './sources/chop.mjs';
import * as acep from './sources/acep.mjs';
import * as acc from './sources/acc.mjs';
import { sources as societies } from './sources/societies.mjs';

// Register new sources here.
const SOURCES = [acep, acc, ...societies, nch, chop];

const EM_SETTINGS = new Set(['ED', 'UC']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'docs', 'data');
const DATA_FILE = path.join(DATA_DIR, 'guidelines.json');
const LOG_FILE = path.join(DATA_DIR, 'changelog.json');
const MIN_RATIO = 0.6; // refuse to publish if a source suddenly returns <60% of its previous count

const log = (...a) => console.log(...a);
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Fingerprint of the clinically meaningful content: if it changes, the guideline "updated".
function fingerprint(g) {
  const docs = g.documents.map((d) => `${d.url}|${d.lastModified ?? ''}|${d.size ?? ''}`).sort();
  return createHash('sha1').update(JSON.stringify([g.title, g.settings, docs])).digest('hex').slice(0, 12);
}

async function main() {
  const now = new Date().toISOString();
  const prev = await readJson(DATA_FILE, { guidelines: [], sources: [] });
  const prevById = new Map(prev.guidelines.map((g) => [g.id, g]));
  const changelog = await readJson(LOG_FILE, { runs: [] });

  const results = [];
  const sourceMeta = [];
  const run = { date: now, added: [], updated: [], removed: [], errors: [] };

  for (const src of SOURCES) {
    const prevForSource = prev.guidelines.filter((g) => g.source === src.id);
    if (only && !only.includes(src.id)) {
      results.push(...prevForSource);
      sourceMeta.push(prev.sources.find((s) => s.id === src.id));
      continue;
    }
    log(`→ ${src.name}`);
    let raw;
    try {
      raw = await src.fetchGuidelines({ log });
    } catch (err) {
      log(`  ✗ source failed: ${err.message} — keeping previous data`);
      run.errors.push({ source: src.id, error: err.message });
      results.push(...prevForSource);
      sourceMeta.push(prev.sources.find((s) => s.id === src.id) ?? { id: src.id, name: src.name, homepage: src.homepage });
      continue;
    }

    if (prevForSource.length && raw.length < prevForSource.length * MIN_RATIO) {
      const msg = `only ${raw.length} items vs ${prevForSource.length} previously — likely a site change; keeping previous data`;
      log(`  ✗ ${msg}`);
      run.errors.push({ source: src.id, error: msg });
      results.push(...prevForSource);
      sourceMeta.push(prev.sources.find((s) => s.id === src.id));
      continue;
    }

    const seen = new Set();
    for (const r of raw) {
      const id = `${src.id}:${slug(new URL(r.sourceUrl).pathname.split('/').pop() || r.title)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const g = {
        id,
        source: src.id,
        title: r.title,
        summary: r.summary || '',
        category: r.category || categorize(r.title, r.summary),
        settings: r.settings || [],
        emRelevant: r.emRelevant ?? (r.settings || []).some((s) => EM_SETTINGS.has(s)),
        sourceUrl: r.sourceUrl,
        documents: r.documents || [],
        lastPublished: latest(r.documents),
        population: r.population || src.population || null,
        ...(r.publishedIn ? { publishedIn: r.publishedIn } : {}),
      };
      g.fingerprint = fingerprint(g);
      const old = prevById.get(id);
      g.firstSeen = old?.firstSeen ?? now;
      if (!old) {
        g.lastChanged = now;
        if (prev.guidelines.length) run.added.push({ id, title: g.title });
      } else if (old.fingerprint !== g.fingerprint) {
        g.lastChanged = now;
        run.updated.push({ id, title: g.title });
      } else {
        g.lastChanged = old.lastChanged;
      }
      if (r.fetchError) run.errors.push({ source: src.id, id, error: r.fetchError });
      results.push(g);
    }
    for (const old of prevForSource) {
      if (!seen.has(old.id)) run.removed.push({ id: old.id, title: old.title });
    }
    markSuperseded(results.filter((g) => g.source === src.id));
    sourceMeta.push({ id: src.id, name: src.name, homepage: src.homepage, population: src.population ?? null, lastFetched: now, count: seen.size });
    log(`  ✓ ${seen.size} guidelines`);
  }

  results.sort((a, b) => a.title.localeCompare(b.title));
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    DATA_FILE,
    JSON.stringify({ generated: now, sources: sourceMeta.filter(Boolean), guidelines: results }, null, 1) + '\n',
  );

  changelog.runs.unshift(run);
  changelog.runs = changelog.runs.slice(0, 24);
  await writeFile(LOG_FILE, JSON.stringify(changelog, null, 1) + '\n');

  log(`\nadded ${run.added.length} · updated ${run.updated.length} · removed ${run.removed.length} · errors ${run.errors.length}`);
}

// Within a source, an older guideline on the same topic (same settings, near-identical
// title once years and boilerplate are removed) is flagged as superseded by the newer one.
const TOPIC_STOP = new Set(['guideline', 'guidelines', 'update', 'focused', 'management', 'patients', 'with', 'from', 'for', 'the', 'and', 'of', 'in', 'on', 'a', 'an', 'to', 'clinical', 'practice', 'american', 'association', 'society', 'college', 'acc', 'aha', 'esc', 'report', 'joint', 'committee']);
function topicSet(t) {
  return new Set(t.toLowerCase().replace(/\(.*?\)|\b(19|20)\d\d\b/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !TOPIC_STOP.has(w)));
}
function markSuperseded(items) {
  const sorted = [...items].sort((a, b) => (b.lastPublished ?? '').localeCompare(a.lastPublished ?? ''));
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i];
    delete g.supersededBy;
    if (!g.lastPublished) continue;
    const A = topicSet(g.title);
    for (let j = 0; j < i; j++) {
      const n = sorted[j];
      if (n.supersededBy || n.settings.join() !== g.settings.join() || n.lastPublished === g.lastPublished) continue;
      const B = topicSet(n.title);
      const inter = [...A].filter((w) => B.has(w)).length;
      const jac = inter / (A.size + B.size - inter || 1);
      if (jac >= 0.75) { g.supersededBy = n.id; break; }
    }
  }
}

function latest(docs = []) {
  const dates = docs.map((d) => d.lastModified).filter(Boolean).sort();
  return dates.at(-1) ?? null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
