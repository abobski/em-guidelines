// Source adapter: ACEP clinical policies. The public ACEP listing gives the current policy
// set; the Annals of Emergency Medicine publication (dates, DOI, abstract, free full text)
// comes from the literature search and is matched to each listing entry by topic words.
import { fetchText, stripTags, absolutize } from '../util.mjs';
import { searchGuidelines } from '../lit.mjs';

export const id = 'acep';
export const name = 'ACEP Clinical Policies';
export const homepage = 'https://www.acep.org/patient-care/clinical-policies';
export const population = 'Adult';

const BASE = 'https://www.acep.org';
const STOP = new Set(['clinical', 'policy', 'policies', 'critical', 'issues', 'evaluation', 'management', 'adult', 'adults', 'patients', 'patient', 'presenting', 'emergency', 'department', 'with', 'from', 'that', 'this', 'acute', 'suspected', 'the', 'and', 'for', 'use', 'in', 'of', 'to']);

export async function fetchGuidelines({ log }) {
  const html = await fetchText(homepage);
  const listing = new Map();
  for (const m of html.matchAll(/<a href="(\/patient-care\/clinical-policies\/[^"#?]+)"[^>]*>\s*(?:<span>)?([^<]{3,})/g)) {
    const url = absolutize(m[1], BASE);
    const label = stripTags(m[2]);
    if (/outside organizations|development process/i.test(label)) continue; // index pages, not policies
    if (!listing.has(url)) listing.set(url, label);
  }
  log(`  listing: ${listing.size} policies`);

  let pubs = [];
  try {
    pubs = await searchGuidelines({
      issns: ['0196-0644', '1097-6760'],
      titleTerms: ['clinical policy'],
      since: '2010-01-01',
      log,
    });
  } catch (err) {
    log(`  ! literature enrichment unavailable: ${err.message}`);
  }

  const out = [];
  for (const [url, title] of listing) {
    const words = topicWords(title);
    // Newest publication sharing most of the policy's topic words.
    const match = pubs
      .map((p) => ({ p, score: overlap(words, topicWords(p.title)) }))
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score || b.p.date.localeCompare(a.p.date))[0]?.p;

    const docs = [{ url, label: 'ACEP policy page', lastModified: match?.date ?? null, size: null }];
    if (match?.fullTextUrl) docs.unshift({ url: match.fullTextUrl, label: 'Free full text', lastModified: match.date, size: null });
    if (match?.doi) docs.push({ url: `https://doi.org/${match.doi}`, label: 'Annals of Emergency Medicine', lastModified: match.date, size: null });

    out.push({
      sourceUrl: url,
      title,
      summary: match?.abstract || (match ? match.title : `ACEP clinical policy: ${title}.`),
      settings: ['ED'],
      emRelevant: true,
      documents: docs,
      publishedIn: match ? 'Ann Emerg Med' : undefined,
      versionKey: match ? (match.doi || `pmid:${match.pmid}`).toLowerCase() : 'unmatched',
    });
  }
  return out;
}

function topicWords(s) {
  return new Set(s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  return [...a].filter((w) => b.has(w)).length / a.size;
}
