#!/usr/bin/env node
// Weekly watch for new or revised ACEP clinical policies. Opens one GitHub issue per new finding
// (mentioning the repo owner, so GitHub sends an email / mobile push). Without GITHUB_TOKEN it
// only prints what it found.
//
// Two signals:
//  1. A policy on ACEP's public policy list that isn't in the adapter's PDF map yet.
//  2. A "Clinical Policy" article in Annals of Emergency Medicine (last 180 days) whose DOI the
//     app doesn't have yet: a new or revised policy, often before ACEP's site lists it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, stripTags } from './util.mjs';
import { searchGuidelines } from './lit.mjs';
import { POLICY_PDFS, MEMBERS_ONLY, homepage } from './sources/acep.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_MENTION = '@abobski';
const log = (...a) => console.log(...a);

async function main() {
  const alerts = [];

  // 1. ACEP list vs. known policies.
  const html = await fetchText(homepage);
  const known = new Set([...Object.keys(POLICY_PDFS), ...MEMBERS_ONLY]);
  const seen = new Set();
  for (const m of html.matchAll(/<a href="\/patient-care\/clinical-policies\/([^"#?/]+)"[^>]*>\s*(?:<span>)?([^<]{3,})/g)) {
    const slug = m[1].toLowerCase();
    const title = stripTags(m[2]);
    if (seen.has(slug) || known.has(slug) || /outside organizations|development process/i.test(title)) continue;
    seen.add(slug);
    alerts.push({
      title: `New ACEP clinical policy: ${title}`,
      body: `ACEP lists a clinical policy the app doesn't have a PDF for yet:\n\n**${title}**\nhttps://www.acep.org/patient-care/clinical-policies/${m[1]}\n\nIt already appears in the app (title only). To add its PDF and a full AI summary, sign in to ACEP in Claude's in-app browser and ask Claude to re-pull the ACEP policy PDFs.`,
    });
  }

  // 2. Annals "Clinical Policy" publications the app doesn't have.
  const data = JSON.parse(await readFile(path.join(ROOT, 'docs', 'data', 'guidelines.json'), 'utf8'));
  const haveDois = new Set(data.guidelines.filter((g) => g.source === 'acep').map((g) => g.versionKey));
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  try {
    const pubs = await searchGuidelines({ issns: ['0196-0644', '1097-6760'], titleTerms: ['clinical policy'], since, log });
    for (const p of pubs) {
      const key = (p.doi || `pmid:${p.pmid}`).toLowerCase();
      if (haveDois.has(key)) continue;
      alerts.push({
        title: `ACEP clinical policy published in Annals: ${p.title.replace(/^Clinical Policy:\s*/i, '').slice(0, 150)}`,
        body: `A new or revised ACEP clinical policy was published in Annals of Emergency Medicine (${p.date?.slice(0, 10)}):\n\n**${p.title}**\n${p.doi ? `https://doi.org/${p.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`}\n\nThe app picks it up at the next monthly refresh once ACEP lists it. If it's a new topic, its PDF needs a re-pull with your ACEP sign-in.`,
      });
    }
  } catch (err) {
    log(`Annals check skipped: ${err.message}`);
  }

  log(alerts.length ? alerts.map((a) => `• ${a.title}`).join('\n') : 'No new ACEP policies.');
  if (!alerts.length || !process.env.GITHUB_TOKEN) return;

  // Open one issue per alert, skipping any that already exist (open or closed).
  const repo = process.env.GITHUB_REPOSITORY;
  const gh = (url, init = {}) => fetch(`https://api.github.com${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', ...(init.headers ?? {}) },
  });
  const existing = await (await gh(`/repos/${repo}/issues?state=all&labels=acep-watch&per_page=100`)).json();
  const titles = new Set((Array.isArray(existing) ? existing : []).map((i) => i.title));
  for (const a of alerts) {
    if (titles.has(a.title)) continue;
    const res = await gh(`/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: a.title, body: `${OWNER_MENTION} ${a.body}`, labels: ['acep-watch'] }),
    });
    log(res.ok ? `Opened issue: ${a.title}` : `Failed to open issue (${res.status}): ${a.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
