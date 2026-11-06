// Source adapter: Children's Hospital of Philadelphia (CHOP) clinical pathways.
import { fetchText, stripTags, absolutize } from '../util.mjs';

export const id = 'chop';
export const name = 'CHOP';
export const homepage = 'https://www.chop.edu/pathways-library';
export const population = 'Pediatric';

const BASE = 'https://www.chop.edu';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Setting phrases that appear after the title in labels like "Asthma, ED and Inpatient".
const SETTING_TOKENS = [
  [/all settings/i, ['ED', 'IP', 'OP']],
  [/\bED\b|emergency/i, ['ED']],
  [/urgent care/i, ['UC']],
  [/n\/iicu|\bnicu\b|\biicu\b/i, ['NICU']],
  [/\bpicu\b|\bcicu\b|\bicu\b/i, ['ICU']],
  [/inpatient|\bpcu\b/i, ['IP']],
  [/primary care|outpatient|specialty/i, ['OP']],
  [/behavioral health/i, ['BHP']],
  [/perioperative|surgery|surgical|eras\b/i, ['Surgery']],
];
const SETTING_ONLY = /^(?:\s|and|\/|,|all settings|ed|emergency(?: department)?|urgent care|n\/iicu|nicu|iicu|picu|cicu|icu|pcu|inpatient|primary care|outpatient|specialty|care|behavioral health)+$/i;

export async function fetchGuidelines({ log }) {
  const html = await fetchText(homepage);
  const items = new Map();
  for (const m of html.matchAll(/<a href="(\/clinical-pathway\/[^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    const url = absolutize(m[1], BASE);
    if (items.has(url)) continue;
    items.set(url, parseLabel(stripTags(m[2])));
  }
  log(`  listing: ${items.size} pathways`);

  const out = [];
  for (const [url, { title, settings }] of items) {
    let revised = null;
    let summary = '';
    try {
      const page = await fetchText(url);
      const rev = stripTags(page.match(/Revised:\s*(?:<[^>]+>\s*)*([A-Za-z]+\s+\d{4})/i)?.[1] ?? '');
      revised = monthToIso(rev);
      const desc = page.match(/<meta name="description" content="([^"]*)"/i)?.[1];
      if (desc && desc.length > 40) summary = stripTags(desc);
    } catch (err) {
      log(`  ! ${url}: ${err.message}`);
    }
    out.push({
      sourceUrl: url,
      title,
      summary: summary || `CHOP clinical pathway for ${title.toLowerCase()}${settings.length ? ` (${settings.join(', ')})` : ''}.`,
      settings,
      documents: [{ url, label: 'Pathway (web)', lastModified: revised, size: null }],
    });
  }
  return out;
}

function parseLabel(label) {
  const parts = label.split(/,\s*/);
  const settings = new Set();
  // Peel setting-only segments off the end; keep the rest as the title.
  while (parts.length > 1 && SETTING_ONLY.test(parts.at(-1).trim())) {
    const seg = parts.pop();
    for (const [re, codes] of SETTING_TOKENS) if (re.test(seg)) codes.forEach((c) => settings.add(c));
  }
  // Labels like "Peritonsillar Abscess (PTA) ED and Inpatient" put settings after a space, not a comma.
  let title = parts.join(', ').trim();
  const tail = title.match(/\s((?:ED|Inpatient|PICU|ICU|N\/IICU)(?:\s+and\s+(?:ED|Inpatient|PICU|ICU|N\/IICU))*)$/);
  if (tail) {
    title = title.slice(0, -tail[0].length).trim();
    for (const [re, codes] of SETTING_TOKENS) if (re.test(tail[1])) codes.forEach((c) => settings.add(c));
  }
  return { title, settings: [...settings].sort() };
}

function monthToIso(s) {
  const m = s.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  return new Date(Date.UTC(Number(m[2]), mi, 1)).toISOString();
}
