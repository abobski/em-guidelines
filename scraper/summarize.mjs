#!/usr/bin/env node
// Writes AI summaries + key points + topic tags for every guideline and EM blog post into
// docs/data/summaries.json. Only items that are new or whose content changed (fingerprint) are
// sent, via the Message Batches API (50% price). Results are cached by fingerprint.
//
// Usage:
//   node scraper/summarize.mjs            submit + wait for the batch (needs ANTHROPIC_API_KEY)
//   node scraper/summarize.mjs --dry-run  fetch source text, report counts and estimated cost, send nothing
//   --limit=N                             only the first N pending items (for a trial run)
//   --only=src1,src2                      only these sources
//
// If the batch hasn't finished when POLL_MINUTES runs out, its id is saved to
// docs/data/summary-pending.json and collected on the next run.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { TOPICS, CATEGORIES } from './topics.mjs';
import { stripTags } from './util.mjs';

const MODEL = 'claude-opus-5-5';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const GUIDELINES = path.join(DATA, 'guidelines.json');
const SUMMARIES = path.join(DATA, 'summaries.json');
const PENDING = path.join(DATA, 'summary-pending.json');
const UA = 'EM-Guidelines-Bot/1.0 (personal clinical reference app; monthly refresh)';
const POLL_MINUTES = Number(process.env.POLL_MINUTES ?? 300);
const BATCH_CHUNK = 400;

// Source text budgets (characters). Long guidelines are trimmed to the paragraphs that carry
// recommendations; the summary records which basis it was written from.
const MAX_FULLTEXT_CHARS = 45_000;
const MAX_PAGE_CHARS = 40_000;
const MAX_POST_CHARS = 14_000;

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// ---------------------------------------------------------------- prompt + schema

const SYSTEM = `You write reference summaries for a mobile app used by emergency physicians at the bedside.
Each request gives you one source: a society clinical practice guideline, a hospital clinical pathway, a consensus or position statement, or an emergency-medicine blog post (RebelEM or ALiEM). Summarize only what the provided source text says.

Accuracy rules:
- Every statement must be supported by the provided text. Do not fill gaps from general knowledge, and do not state a recommendation the text doesn't make.
- Keep the numbers the source gives: doses, thresholds, time windows, ages, scores and decision-rule criteria. Keep recommendation strength or class and level of evidence when stated (for example "Class 1, LOE B-R" or "strong recommendation, moderate certainty").
- If the text is only an abstract or is cut short, summarize what is there and say so in "limitations". When the source gives no specific recommendations, say that rather than inferring them.
- For blog posts, report what the post concludes (its bottom line), the evidence it rests on, and the caveats it raises. Attribute opinions to the post ("the authors argue…"). In "discusses_guidelines", name any specific guidelines the post discusses, with year and society, or return an empty list.

Writing rules:
- "summary": 2-3 plain sentences: what the source covers (condition, population, setting) and its single most important takeaway.
- "key_points": guidelines and pathways get 4-8 bullets; blog posts get 3-5. Each bullet is one specific, actionable statement a clinician could use on shift, written in your own words. Put the most practice-changing points first. No bullet should just restate the title.
- "topics": choose 1-3 from the allowed list; choose the most specific that fit and use "Other" only when none fit.
- "category": the single best clinical category.
- "source_type": what kind of document this is.
- If the request says no source text is available, return an empty "summary" and empty "key_points", and use only the title to choose "topics", "category" and "population". Set "limitations" to "Paywalled: title only".
- "is_major_guideline": true only for a current national or international society guideline or clinical policy (for example ACC/AHA, ACEP, ESC, Surviving Sepsis, IDSA, AAP, ASH, CHEST). False for hospital pathways, blog posts, commentaries and narrow technical documents.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'key_points', 'topics', 'category', 'population', 'source_type', 'is_major_guideline', 'discusses_guidelines', 'limitations'],
  properties: {
    summary: { type: 'string' },
    key_points: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string', enum: TOPICS } },
    category: { type: 'string', enum: CATEGORIES },
    population: { type: 'string', enum: ['Adult', 'Pediatric', 'Both', 'Unclear'] },
    source_type: { type: 'string', enum: ['society guideline', 'hospital pathway', 'consensus or position statement', 'blog discussion', 'other'] },
    is_major_guideline: { type: 'boolean' },
    discusses_guidelines: { type: 'array', items: { type: 'string' } },
    limitations: { type: 'string' },
  },
};

// ---------------------------------------------------------------- source text

const BLOG_SOURCES = new Set(['rebelem', 'aliem']);

async function fetchText(url, init) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function htmlToText(html) {
  return stripTags(html.replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|li|h\d|tr|div)>/gi, '\n'));
}

// Long guideline: keep the opening, then the paragraphs that state recommendations, in order.
function pickRecommendationText(paragraphs, budget) {
  const RECO = /\brecommend|\bshould\b|\bwe suggest|\bclass (i|1|2a|2b|3)\b|\bLOE\b|level of evidence|\bCOR\b|strong recommendation|conditional recommendation|certainty of evidence|\bconsider\b/i;
  const opening = [];
  let used = 0;
  for (const p of paragraphs) {
    if (used > 5000) break;
    opening.push(p); used += p.length;
  }
  const picked = new Set(opening);
  for (const p of paragraphs) {
    if (used >= budget) break;
    if (!picked.has(p) && RECO.test(p)) { picked.add(p); used += p.length; }
  }
  return paragraphs.filter((p) => picked.has(p)).join('\n').slice(0, budget);
}

// Look a journal article up in Europe PMC: abstract, access status, and open full text.
async function europePmcLookup(g) {
  const doi = g.versionKey && !g.versionKey.startsWith('pmid:') && g.versionKey !== 'unmatched' ? g.versionKey
    : (g.sourceUrl.match(/10\.\d{4,9}\/[^\s?#]+/)?.[0] ?? null);
  const pmid = g.versionKey?.startsWith('pmid:') ? g.versionKey.slice(5) : (g.documents.find((d) => /pubmed/.test(d.url))?.url.match(/(\d{5,})/)?.[1] ?? null);
  const query = doi ? `DOI:"${doi}"` : pmid ? `EXT_ID:${pmid} AND SRC:MED` : null;
  if (!query) return null;
  const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?' + new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: '1' });
  const j = JSON.parse(await fetchText(url));
  const r = j.resultList?.result?.[0];
  if (!r) return null;
  const urls = [].concat(r.fullTextUrlList?.fullTextUrl ?? []);
  let access = 'unknown';
  if (r.isOpenAccess === 'Y') access = 'open-access';
  else if (r.inPMC === 'Y' || urls.some((u) => /free/i.test(u.availability))) access = 'free';
  else if (urls.some((u) => /subscription/i.test(u.availability))) access = 'subscription';
  let fullText = null;
  if (r.pmcid && (r.inEPMC === 'Y' || r.isOpenAccess === 'Y')) {
    try {
      const xml = await fetchText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${r.pmcid}/fullTextXML`);
      const paras = [...xml.matchAll(/<(?:p|title)[^>]*>([\s\S]*?)<\/(?:p|title)>/g)].map((m) => stripTags(m[1])).filter((p) => p.length > 30);
      if (paras.length) fullText = paras;
    } catch { /* not all PMC records have XML */ }
  }
  return { access, abstract: stripTags(r.abstractText ?? ''), fullText, title: r.title, journal: r.journalInfo?.journal?.isoabbreviation };
}

// Returns { blocks: [content blocks], basis, access } or null when there's nothing to summarize.
async function buildContent(g) {
  const header = `Source: ${g.sourceName}\nTitle: ${g.fullTitle || g.title}\nPublished/revised: ${g.lastPublished?.slice(0, 10) ?? 'unknown'}\nCare settings: ${g.settings.join(', ') || 'not specified'}\nURL: ${g.sourceUrl}\n`;

  if (BLOG_SOURCES.has(g.source) && g.wpId) {
    const post = JSON.parse(await fetchText(`${g.wpApi}/${g.wpId}?_fields=content`));
    const text = htmlToText(post.content?.rendered ?? '');
    const basis = text.length > MAX_POST_CHARS ? 'partial post text' : 'full post';
    return { blocks: [{ type: 'text', text: `${header}\n--- POST TEXT ---\n${text.slice(0, MAX_POST_CHARS)}` }], basis, access: 'free' };
  }

  const pdf = g.documents.find((d) => /\.pdf(\?|$)/i.test(d.url));
  if (pdf) {
    const res = await fetch(pdf.url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) throw new Error('PDF too large');
    return {
      blocks: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
        { type: 'text', text: header },
      ],
      basis: 'full pathway PDF',
      access: 'free',
    };
  }

  if (g.source === 'chop') {
    const html = await fetchText(g.sourceUrl);
    const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
    const text = htmlToText(main);
    return { blocks: [{ type: 'text', text: `${header}\n--- PATHWAY PAGE TEXT ---\n${text.slice(0, MAX_PAGE_CHARS)}` }], basis: text.length > MAX_PAGE_CHARS ? 'partial pathway page' : 'full pathway page', access: 'free' };
  }

  // Journal-published guideline (ACC/AHA, ACEP, societies).
  let lit = null;
  try { lit = await europePmcLookup(g); } catch { /* fall back to stored abstract */ }
  const abstract = lit?.abstract || (g.summary && g.summary.length > 200 ? g.summary : '');
  if (lit?.fullText) {
    const body = pickRecommendationText(lit.fullText, MAX_FULLTEXT_CHARS);
    const total = lit.fullText.join('\n').length;
    return {
      blocks: [{ type: 'text', text: `${header}\n--- ABSTRACT ---\n${abstract}\n\n--- FULL TEXT ${total > MAX_FULLTEXT_CHARS ? '(EXCERPTED: opening plus recommendation paragraphs)' : ''} ---\n${body}` }],
      basis: total > MAX_FULLTEXT_CHARS ? 'abstract + recommendation excerpts from full text' : 'full text',
      access: lit.access,
    };
  }
  if (abstract) {
    return { blocks: [{ type: 'text', text: `${header}\n--- ABSTRACT (full text not available) ---\n${abstract}` }], basis: 'abstract only', access: lit?.access ?? 'unknown' };
  }
  // Paywalled with no abstract (e.g. ACEP clinical policies): tag topics from the title only so the
  // entry still appears on topic pages and gets RebelEM/ALiEM cross-references.
  return {
    blocks: [{ type: 'text', text: `${header}\n--- NO SOURCE TEXT AVAILABLE (paywalled, no abstract). Use the title only for topics/category; leave summary and key_points empty. ---` }],
    basis: 'title only (paywalled)',
    access: g.source === 'acep' ? 'subscription' : lit?.access ?? 'unknown',
  };
}

// ---------------------------------------------------------------- batch plumbing

function request(customId, g, content) {
  const blog = BLOG_SOURCES.has(g.source);
  return {
    custom_id: customId,
    params: {
      model: MODEL,
      max_tokens: 12000,
      // Medium effort for guidelines (accuracy on recommendations); low for blog posts.
      output_config: { effort: blog || content.basis.startsWith('title only') ? 'low' : 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: content.blocks }],
    },
  };
}

function parseResult(message) {
  if (message.stop_reason === 'refusal') return { error: 'refusal' };
  if (message.stop_reason === 'max_tokens') return { error: 'max_tokens' };
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return { data: JSON.parse(text) }; } catch { return { error: 'bad JSON' }; }
}

function clean(data) {
  return {
    summary: data.summary.trim(),
    key_points: data.key_points.map((s) => s.trim()).filter(Boolean).slice(0, 8),
    topics: [...new Set(data.topics)].slice(0, 3),
    category: data.category,
    population: data.population,
    source_type: data.source_type,
    is_major_guideline: data.is_major_guideline,
    discusses_guidelines: data.discusses_guidelines.slice(0, 6),
    limitations: data.limitations.trim(),
  };
}

async function collect(client, pending, store) {
  const still = [];
  for (const b of pending.batches) {
    const batch = await client.messages.batches.retrieve(b.id);
    if (batch.processing_status !== 'ended') { still.push(b); continue; }
    let ok = 0, failed = 0;
    for await (const r of await client.messages.batches.results(b.id)) {
      const meta = b.items[r.custom_id];
      if (!meta) continue;
      if (r.result.type !== 'succeeded') { failed++; continue; }
      const parsed = parseResult(r.result.message);
      if (parsed.error) { failed++; log(`    ! ${meta.id}: ${parsed.error}`); continue; }
      store.items[meta.id] = { fp: meta.fp, ...clean(parsed.data), basis: meta.basis, access: meta.access, model: MODEL, generatedAt: new Date().toISOString() };
      ok++;
    }
    log(`  batch ${b.id}: ${ok} summaries, ${failed} failed (failed items retry next run)`);
  }
  pending.batches = still;
}

// ---------------------------------------------------------------- main

async function main() {
  const data = await readJson(GUIDELINES, null);
  if (!data) throw new Error('docs/data/guidelines.json missing — run the scraper first');
  const store = await readJson(SUMMARIES, { items: {} });
  const pending = await readJson(PENDING, { batches: [] });
  const sourceName = Object.fromEntries(data.sources.map((s) => [s.id, s.name]));
  const live = new Set(data.guidelines.map((g) => g.id));

  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!DRY && !hasKey) {
    log('ANTHROPIC_API_KEY not set — skipping summaries (add it as a repository secret to enable).');
    return;
  }
  const client = DRY ? null : new Anthropic();

  // 1. Collect any batch left over from a previous run.
  if (client && pending.batches.length) {
    log(`Collecting ${pending.batches.length} pending batch(es)…`);
    await collect(client, pending, store);
  }

  // 2. Work out what needs (re)summarizing.
  const inFlight = new Set(pending.batches.flatMap((b) => Object.values(b.items).map((m) => m.id)));
  let todo = data.guidelines.filter((g) =>
    !g.supersededBy && !inFlight.has(g.id) && (!ONLY || ONLY.includes(g.source)) &&
    store.items[g.id]?.fp !== g.fingerprint);
  todo = todo.slice(0, LIMIT);
  log(`${todo.length} item(s) need a summary.`);

  // 3. Fetch source text.
  const requests = [];
  const items = {};
  let chars = 0, pdfBytes = 0, i = 0;
  const bases = {};
  for (const g of todo) {
    i++;
    let content;
    try {
      content = await buildContent({ ...g, sourceName: sourceName[g.source] ?? g.source });
    } catch (err) {
      log(`  ! ${g.id}: ${err.message}`);
      continue;
    }
    await sleep(250);
    bases[content.basis] = (bases[content.basis] ?? 0) + 1;
    for (const b of content.blocks) {
      if (b.type === 'text') chars += b.text.length;
      if (b.type === 'document') pdfBytes += b.source.data.length * 0.75;
    }
    const customId = 'r' + createHash('sha1').update(g.id).digest('hex').slice(0, 20) + '_' + i;
    items[customId] = { id: g.id, fp: g.fingerprint, basis: content.basis, access: content.access };
    requests.push(request(customId, g, content));
    if (i % 50 === 0) log(`  prepared ${i}/${todo.length}`);
  }

  // Rough cost estimate: ~4 chars/token for text; PDFs ~1,500 tokens/page at ~60 KB/page; system prompt
  // cached after the first request. Batch pricing is half of $4 in / $20 out per million tokens.
  const sysTokens = Math.round(SYSTEM.length / 4 + JSON.stringify(SCHEMA).length / 4);
  const inTokens = chars / 4 + (pdfBytes / 60_000) * 1500 + sysTokens * 0.1 * requests.length;
  const blogCount = requests.filter((r) => r.params.output_config.effort === 'low').length;
  const outTokens = blogCount * 1200 + (requests.length - blogCount) * 2500; // incl. thinking
  const cost = (inTokens * 4 + outTokens * 20) / 1e6 / 2;
  log(`\n${requests.length} requests · ~${Math.round(inTokens / 1e3)}K input tokens · ~${Math.round(outTokens / 1e3)}K output tokens · est. $${cost.toFixed(2)} (batch pricing)`);
  log('Source basis:', bases);

  // Drop cached summaries for items that no longer exist.
  for (const id of Object.keys(store.items)) if (!live.has(id)) delete store.items[id];

  if (DRY) { log('\nDry run — nothing sent.'); return; }

  // 4. Submit in chunks, then poll.
  for (let k = 0; k < requests.length; k += BATCH_CHUNK) {
    const chunk = requests.slice(k, k + BATCH_CHUNK);
    const batch = await client.messages.batches.create({ requests: chunk });
    const chunkItems = Object.fromEntries(chunk.map((r) => [r.custom_id, items[r.custom_id]]));
    pending.batches.push({ id: batch.id, created: new Date().toISOString(), items: chunkItems });
    log(`Submitted batch ${batch.id} (${chunk.length} requests)`);
  }
  await writeFile(PENDING, JSON.stringify(pending, null, 1) + '\n'); // survive a crash mid-poll

  const deadline = Date.now() + POLL_MINUTES * 60_000;
  while (pending.batches.length && Date.now() < deadline) {
    await sleep(60_000);
    await collect(client, pending, store);
    await save(store, pending);
  }
  await save(store, pending);
  if (pending.batches.length) log(`${pending.batches.length} batch(es) still processing — they'll be collected next run.`);
}

async function save(store, pending) {
  store.generated = new Date().toISOString();
  store.model = MODEL;
  await writeFile(SUMMARIES, JSON.stringify(store) + '\n');
  await writeFile(PENDING, JSON.stringify(pending, null, 1) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
