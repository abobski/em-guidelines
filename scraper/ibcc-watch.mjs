#!/usr/bin/env node
// Watches the Internet Book of Critical Care (IBCC, emcrit.org/ibcc) for new and revised chapters.
//
// - EMCrit's sitemap gives every chapter's last-modified date (one request per run).
// - For a revised chapter that the app links to a topic, each paragraph's fingerprint (short hash) is
//   compared with the previous run's. Claude reads only the new paragraphs (plus how many were
//   removed) and writes a one- or two-sentence note on what changed, rated major (changes ED/ICU
//   management) or minor.
// - New chapters are tagged with app topics by Claude from their title and opening text.
// - Updates docs/data/ibcc.json (titles, links, dates, topics and change notes) and
//   scraper/state/ibcc-hashes.json (paragraph fingerprints). Chapter text is never stored.
// - Opens one GitHub issue per run listing major changes and new EM-relevant chapters.
//
// Without ANTHROPIC_API_KEY changes are recorded without notes; without GITHUB_TOKEN no issue.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { TOPICS } from './topics.mjs';
import { fetchText, stripTags, decode } from './util.mjs';

const MODEL = 'claude-opus-5-5';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'data', 'ibcc.json');
const HASHES = path.join(ROOT, 'scraper', 'state', 'ibcc-hashes.json');
const SITEMAP = 'https://emcrit.org/ibcc-sitemap.xml';
const SKIP = new Set(['pddf', 'index', 'about-guide', 'toc', 'pdf']); // navigation pages and duplicates
const OWNER_MENTION = '@abobski';
const MAX_DIFF_CHARS = 24_000;
const log = (...a) => console.log(...a);

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Chapter body as a list of paragraphs (headings, paragraphs, list items, table cells).
function chapterParagraphs(html) {
  const start = html.indexOf('class="entry-content"');
  const end = html.indexOf('</article>', start);
  const body = start >= 0 ? html.slice(start, end > 0 ? end : undefined) : html;
  return body
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .split(/<\/?(?:p|li|h[1-6]|td|th|blockquote|div)[^>]*>/i)
    .map(stripTags)
    .filter((s) => s.length > 2);
}

const slugOf = (url) => url.split('/ibcc/')[1].replace(/\/$/, '');
const fp = (p) => createHash('sha1').update(p).digest('hex').slice(0, 10);

async function ask(system, user, schema, effort = 'low') {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.find((b) => b.type === 'text')?.text;
  return JSON.parse(text);
}

const CHANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['significance', 'summary'],
  properties: {
    significance: { type: 'string', enum: ['major', 'minor'] },
    summary: { type: 'string' },
  },
};

async function describeChange(title, removedCount, added) {
  return ask(
    'You compare two revisions of a chapter from the Internet Book of Critical Care for emergency physicians. ' +
      'Rate the revision "major" only if it changes clinical management: diagnostic approach, drug choice or dose, thresholds or targets, disposition, or adds/removes a recommendation. ' +
      'Wording, formatting, references, links, typo fixes or reordering are "minor". ' +
      'Write the summary in your own words, 1-2 sentences, specific (name the drug, dose or criterion that changed). Do not quote the chapter.',
    `Chapter: ${title}\n\n${removedCount} paragraph(s) were removed or reworded (old text not available).\n\nNew or reworded paragraphs in the current version:\n${added.join('\n').slice(0, MAX_DIFF_CHARS) || '(none)'}`,
    CHANGE_SCHEMA,
    'medium',
  );
}

const TOPIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topics'],
  properties: { topics: { type: 'array', items: { type: 'string', enum: TOPICS } } },
};

async function tagTopics(title, paras) {
  const r = await ask(
    'Tag a critical care textbook chapter with 0-3 topics from the fixed list, for an emergency medicine reference app. ' +
      'Use only topics the chapter is mainly about. Return an empty list if none fits or the chapter is not relevant to emergency care.',
    `Chapter title: ${title}\n\nOpening text:\n${paras.join('\n').slice(0, 6000)}`,
    TOPIC_SCHEMA,
  );
  return r.topics.filter((t) => t !== 'Other');
}

async function main() {
  await mkdir(path.dirname(HASHES), { recursive: true });
  const hashes = JSON.parse(await readFile(HASHES, 'utf8').catch(() => '{}'));
  const store = JSON.parse(await readFile(OUT, 'utf8'));
  const bySlug = new Map(store.chapters.map((c) => [c.slug, c]));
  const today = new Date().toISOString().slice(0, 10);

  const xml = await fetchText(SITEMAP);
  const entries = [...xml.matchAll(/<loc>(.*?)<\/loc>\s*<lastmod>(.*?)<\/lastmod>/g)]
    .map((m) => ({ url: decode(m[1]), slug: slugOf(decode(m[1])), lastmod: m[2].slice(0, 10) }))
    .filter((e) => !SKIP.has(e.slug));
  if (entries.length < 100) throw new Error(`Sitemap returned only ${entries.length} chapters; not updating.`);

  const added = [], major = [], minor = [];
  for (const e of entries) {
    const c = bySlug.get(e.slug);
    const relevant = !c || c.topics.length;
    const prev = relevant ? hashes[e.slug] : null;
    const changed = c && c.lastmod !== e.lastmod;
    // Fetch text for new chapters, revised EM-relevant chapters, and to seed a missing baseline.
    if (!(!c || (relevant && (changed || !prev)))) {
      if (changed) c.lastmod = e.lastmod; // not linked to any topic: track the date only
      continue;
    }

    let html;
    try { html = await fetchText(e.url); } catch (err) { log(`skip ${e.slug}: ${err.message}`); continue; }
    const paras = chapterParagraphs(html);
    const now = paras.map(fp);

    if (!c) {
      const title = decode(html.match(/og:title" content="([^"]*)/)?.[1] ?? e.slug);
      const topics = client ? await tagTopics(title, paras).catch(() => []) : [];
      const ch = { slug: e.slug, url: e.url, title, lastmod: e.lastmod, topics, addedAt: today };
      store.chapters.push(ch);
      bySlug.set(e.slug, ch);
      if (topics.length) added.push(ch);
      hashes[e.slug] = now;
      log(`new: ${title} [${topics.join(', ')}]`);
      continue;
    }

    if (changed && prev) {
      const before = new Set(prev), after = new Set(now);
      const removedCount = prev.filter((h) => !after.has(h)).length;
      const addedP = paras.filter((p, i) => !before.has(now[i]));
      const delta = addedP.join('').length;
      let change;
      if (!delta && !removedCount) change = null; // only the date moved
      else if ((delta < 120 && removedCount <= 1) || !client) change = { significance: delta < 120 ? 'minor' : 'unknown', summary: delta < 120 ? 'Small wording edits.' : null };
      else change = await describeChange(c.title, removedCount, addedP).catch((err) => ({ significance: 'unknown', summary: null, error: err.message }));
      if (change) {
        c.change = { date: e.lastmod, significance: change.significance, summary: change.summary };
        (change.significance === 'major' ? major : minor).push(c);
        log(`${change.significance}: ${c.title}${change.summary ? ` (${change.summary})` : ''}`);
      }
    } else if (changed) {
      c.change = { date: e.lastmod, significance: 'unknown', summary: null }; // no baseline to compare yet
    }
    c.lastmod = e.lastmod;
    hashes[e.slug] = now;
  }

  // Chapters dropped from the sitemap stay listed but are marked so the app can hide them.
  const live = new Set(entries.map((e) => e.slug));
  for (const c of store.chapters) c.removed = live.has(c.slug) ? undefined : true;

  store.checkedAt = today;
  store.chapters.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  await writeFile(OUT, JSON.stringify(store, null, 0));
  await writeFile(HASHES, JSON.stringify(hashes));
  log(`IBCC: ${entries.length} chapters, ${added.length} new EM-relevant, ${major.length} major and ${minor.length} other revisions.`);

  if (!(added.length || major.length) || !process.env.GITHUB_TOKEN) return;
  const repo = process.env.GITHUB_REPOSITORY;
  const lines = [
    ...major.map((c) => `- **${c.title}** (${c.topics.join(', ')}): ${c.change.summary}\n  ${c.url}`),
    ...added.map((c) => `- New chapter: **${c.title}** (${c.topics.join(', ')})\n  ${c.url}`),
  ];
  const title = `IBCC updates ${today}: ${[major.length && `${major.length} major revision${major.length > 1 ? 's' : ''}`, added.length && `${added.length} new chapter${added.length > 1 ? 's' : ''}`].filter(Boolean).join(', ')}`;
  const body = `${OWNER_MENTION} IBCC chapters the app links to changed:\n\n${lines.join('\n')}\n\nChange notes are AI-written from the changed paragraphs; read the chapter before acting on them. The app shows these on the topic pages after this run deploys.`;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ title, body, labels: ['ibcc-watch'] }),
  });
  log(res.ok ? `Opened issue: ${title}` : `Failed to open issue (${res.status})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
