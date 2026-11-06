// Source adapter: ACC/AHA guidelines. The ACC guidelines page lists every joint ACC/AHA
// guideline by year with its JACC DOI. AHA-led guidelines that ACC doesn't list (stroke,
// ICH, SAH, CPR/ECC) come from the literature search below.
import { fetchText, stripTags, decode } from '../util.mjs';
import { searchGuidelines } from '../lit.mjs';

export const id = 'acc-aha';
export const name = 'ACC/AHA';
export const homepage = 'https://www.acc.org/Guidelines';
export const population = 'Adult';

// Topics an EM physician acts on. Everything else is kept but not flagged EM-relevant.
const EM_TOPICS = /coronary|chest pain|myocardial|stemi|atrial fibrillation|arrhythmi|bradycardia|conduction|syncope|heart failure|blood pressure|hypertension|aortic|pulmonary embolism|thrombo|pericard|endocarditis|peripheral artery|anticoag|stroke|hemorrhage|resuscitation|cardiac arrest|ventricular|valv/i;

export async function fetchGuidelines({ log }) {
  const html = await fetchText(homepage);
  const out = [];
  const seen = new Set();
  for (const sec of html.matchAll(/<section id='guidelines-(\d{4})'>([\s\S]*?)<\/section>/g)) {
    const year = sec[1];
    for (const m of sec[2].matchAll(/<a href="([^"]+)" title="(?:Read on [^:]+:\s*)?([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const url = decode(m[1]);
      if (seen.has(url)) continue;
      seen.add(url);
      const full = stripTags(m[2]);
      out.push({
        sourceUrl: url,
        title: shortTitle(full),
        summary: full,
        settings: [],
        emRelevant: EM_TOPICS.test(full),
        documents: [{ url, label: 'Full guideline (JACC)', lastModified: `${year}-01-01T00:00:00.000Z`, size: null }],
        _year: year,
      });
    }
  }
  log(`  ACC listing: ${out.length} guidelines`);

  // AHA-led guidelines not on the ACC page.
  let aha = [];
  try {
    aha = await searchGuidelines({
    issns: ['0039-2499', '1524-4628', '0009-7322', '1524-4539'],
    titleTerms: ['stroke', 'intracerebral hemorrhage', 'subarachnoid hemorrhage', 'cardiopulmonary resuscitation', 'emergency cardiovascular care', 'cerebral venous thrombosis', 'transient ischemic attack'],
    since: '2018-01-01',
    exclude: /evidence evaluation|ethics|education science|systems of care|conflicts of interest|knowledge gaps|registry|utstein|rehabilitation|recovery|survivors|primary care|diabetes|destination plans/i,
    log,
  });
  } catch (err) {
    log(`  ! AHA literature search unavailable: ${err.message}`);
  }
  for (const a of aha) {
    if (out.some((o) => sameTopic(o.summary, a.title))) continue;
    out.push(litRecord(a, true));
  }
  log(`  + ${out.length - seen.size} AHA guidelines from literature`);
  return out.map(({ _year, ...r }) => r);
}

// "2025 ACC/AHA/ACEP/... Guideline for the Management of Patients With Acute Coronary Syndromes"
//  -> "Acute Coronary Syndromes (2025)"
function shortTitle(full) {
  const year = full.match(/^(\d{4})\s/)?.[1];
  let t = full.replace(/^\d{4}\s+/, '').replace(/^.*?\bGuidelines?\s+(?:for|on)\s+(?:the\s+)?/i, '');
  t = t.replace(/^(?:Focused Update of the \d{4} )/i, '')
    .replace(/^(?:Diagnosis,? (?:and|&) )?(?:Prevention, )?(?:Detection, Evaluation,? and )?Management of /i, '')
    .replace(/^(?:Evaluation and Diagnosis of|Diagnosis and Management of|Evaluation and Management of|Management of) /i, '')
    .replace(/^(?:Adults? |Patients )With /i, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return year ? `${t} (${year})` : t;
}

function sameTopic(a, b) {
  const norm = (s) => new Set(s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
  const A = norm(a), B = norm(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.min(A.size, B.size) > 0.8;
}
const STOP = new Set(['guideline', 'guidelines', 'management', 'patients', 'with', 'from', 'american', 'heart', 'association', 'stroke', 'college', 'cardiology', 'report', 'joint', 'committee', 'clinical', 'practice', 'early', 'adults']);

export function litRecord(a, emRelevant = true) {
  const docs = [];
  if (a.fullTextUrl) docs.push({ url: a.fullTextUrl, label: 'Free full text', lastModified: a.date, size: null });
  if (a.doi) docs.push({ url: `https://doi.org/${a.doi}`, label: `Journal article (${a.journal})`, lastModified: a.date, size: null });
  if (a.pmid) docs.push({ url: `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`, label: 'PubMed abstract', lastModified: a.date, size: null });
  const short = shortLitTitle(a.title);
  return {
    sourceUrl: a.doi ? `https://doi.org/${a.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`,
    title: short,
    ...(short !== a.title ? { fullTitle: a.title } : {}),
    summary: a.abstract || `${a.journal}, ${a.date?.slice(0, 4) ?? ''}`,
    settings: [],
    emRelevant,
    documents: docs,
    publishedIn: a.journal,
    versionKey: (a.doi || `pmid:${a.pmid}`).toLowerCase(),
  };
}

// Drop publisher boilerplate so the topic leads:
// "Part 11: Post–Cardiac Arrest Care: 2025 American Heart Association Guidelines for CPR and ECC"
//   -> "Part 11: Post–Cardiac Arrest Care (2025 AHA)"
export function shortLitTitle(t) {
  const year = t.match(/\b(20\d\d)\b/)?.[1];
  let s = t
    .replace(/^(?:\d{4}\s+)?Clinical Practice Guidelines?(?: Update)? (?:by|from) (?:the )?[^:]*?:\s*/i, '')
    .replace(/^(?:\d{4}\s+)?(?:IDSA|ESC|ASH|AHA|ACC|ATS|EAST|WSES|SCCM|ERC)[A-Z/ ]*\s+(?=guidelines?\b)/i, '')
    .replace(/[:.]\s+(?:A|An)\s+(?:Official\s+)?[^:]*?\b(?:Guideline|Statement|Report)\b[^:]*$/i, '')
    .replace(/:\s+Executive\b.*$/i, '')
    .replace(/(?:[:.]\s*|(?<=[a-z]))(?:The\s+)?(?:Joint\s+)?Task Force\b.*$/i, '')
    .replace(/\s+developed in collaboration with\b.*$/i, '')
    .replace(/[:.]\s+(?:\d{4}\s+)?(?:American Heart Association|International Consensus|Guidelines? (?:of|from|by)|Recommendations? (?:of|from))\b.*$/i, '')
    .replace(/\s*[:.;,]\s*$/, '')
    .trim();
  const topic = s.replace(/^(?:\d{4}\s+)?(?:[A-Z][A-Za-z/]*\s+)?Guidelines?(?:\s+Update)?\s+(?:for|on)\s+(?:the\s+)?(?:early\s+)?(?:(?:diagnosis|evaluation|prevention|detection)(?:,|\s+and)?\s+)*(?:management|treatment|use|care)\s+(?:and\s+treatment\s+)?of\s+(?:patients\s+with\s+|adults\s+with\s+)?/i, '');
  if (topic !== s && topic.length >= 8) s = topic.charAt(0).toUpperCase() + topic.slice(1);
  if (s.length < 8) s = t;
  const org = /American Heart Association/i.test(t) && !/\bAHA\b/.test(s) ? 'AHA' : '';
  if (year && !s.includes(year)) s += ` (${[year, org].filter(Boolean).join(' ')})`;
  return s;
}
