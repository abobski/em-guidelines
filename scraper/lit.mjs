// Literature search for published guidelines, with three interchangeable backends so one
// index being down doesn't stop the monthly refresh:
//   1. Europe PMC REST API (mirrors PubMed; returns abstracts + free full-text links)
//   2. NCBI E-utilities (PubMed)
//   3. Crossref (no publication-type data, so it relies on strict title filters)
//
// searchGuidelines(spec) -> [{ title, journal, date, doi, pmid, pmcid, abstract, fullTextUrl }]
//
// spec: {
//   issns: ['0039-2499', ...]       journals to search (print and/or electronic ISSN)
//   titleTerms: ['stroke', ...]     title must contain at least one (OR)
//   since: '2018-01-01'
//   allowStatements: false          also accept "scientific statement" / "position statement"
//   include: /regex/                optional extra title filter
//   exclude: /regex/                optional extra title exclusion
//   log
// }

import { stripTags, decode } from './util.mjs';

const UA = 'EM-Guidelines-Bot/1.0 (personal clinical reference app; monthly refresh)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Titles that discuss, evaluate, correct or summarize a guideline rather than being one.
const NOT_A_GUIDELINE_START = /^(abstract|evaluation of|evaluating|application of|using|integrating|optimizing|relevance of|retrospective|considerations|current management|the '?(10|ten)|'(10|ten)|[A-Z][\w'’-]+ [A-Z]{1,3}[,.] )/i;
const NOT_A_GUIDELINE_ANY = /\b(corrigendum|commandments|questions and answers|companion|practical instructions|point of view|in practice|advocacy|author response|common data elements?|diversity|disparities|curricula|reporting standards|delphi|resource utilization|ethics of|implementation|reporting case|after the|night shift|candle in|nothing about|effect on|fall risk|future|trials|implications|interpreting|users'? guide|insights|validat\w*|improves?|surveillance|capacity|nomenclature|laboratory|standardi[sz]\w*|reporting and data|key questions|lack of|make|performance measures|influence of|comments?|platelet activation|antibod\w*|aggregometry|lupus anticoagulant|interference|adaptation|cost|women's heart|delay within|deal with|toward|harmoni[sz]\w*|occult cancer|research|translation to|perspectives?|paradigm|problem in|proposed|corrections?|topical review|regulatory|accelerating|sexual health|environments|building|every minute)\b/i;
const NOT_A_GUIDELINE = /\?|\b(lessons|dissent|misinformation|misrepresent\w*|neglect\w*|why|versus|vs|evaluation of the|derivation|validation|simulated|adoption|discrepanc\w*|streamlining|improving|earlier treatment|following guideline|guideline-concordant|concordance|developing local|viewing|need for|endpoints|clinical trials|there is|caveats|pitfalls|perspective|controvers\w*|time to|beyond|rethinking|reconsider\w*|critical appraisal|comparison of|in action|knowledge gaps|experience with|institutional|outcome reports|regarding|request for|modification of|trends in|variation in|impact of|effect of|effects of|predictors|cohort|randomized|meta-analysis|systematic review|analysis of|correction|erratum|errata|retraction|retracted|response to|reply|comment(ary)? on|in reply|executive summary|summary of|at a glance|key (points|messages)|editorial|pocket|webinar|highlights|letter|podcast|implementation of|adherence to|survey|cost[- ]effectiveness|appraisal|review of the|critique|compliance with)\b/i;
// Crossref has no publication-type data, so its titles must look unmistakably like a guideline.
const STRICT_TITLE = /\b(19|20)\d\d\b[^:]*\b(guidelines?|focused update|clinical policy)\b|guidelines? (for|on|in)\b|clinical policy:|clinical practice guideline|surviving sepsis campaign|international consensus on|consensus (statement|guideline|recommendations)|recommendations (for|on|from)|guidelines?:/i;
const STATEMENT_TITLE = /scientific statement|position statement|position paper|policy statement/i;

async function getJson(url, init) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('non-JSON response');
  }
}

// ---------- Europe PMC ----------
async function europePmc(spec) {
  const issn = spec.issns.map((i) => `ISSN:"${i}"`).join(' OR ');
  const terms = spec.titleTerms.map((t) => `TITLE:"${t}"`).join(' OR ');
  const type = '(PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Guideline" OR TITLE:"guideline" OR TITLE:"guidelines" OR TITLE:"clinical policy" OR TITLE:"consensus" OR TITLE:"recommendations"' +
    (spec.allowStatements ? ' OR TITLE:"statement"' : '') + ')';
  const query = `(${issn}) AND (${terms}) AND ${type} AND FIRST_PDATE:[${spec.since} TO 3000-12-31]`;
  const out = [];
  let cursor = '*';
  for (let page = 0; page < 5; page++) {
    const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?' +
      new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: '200', cursorMark: cursor });
    const j = await getJson(url);
    if (j.errCode) throw new Error(`Europe PMC ${j.errCode}: ${j.errMsg}`);
    for (const r of j.resultList?.result ?? []) {
      const ft = (r.fullTextUrlList?.fullTextUrl ?? []).find((f) => /free|open/i.test(f.availability) && f.documentStyle === 'html')
        ?? (r.pmcid ? { url: `https://pmc.ncbi.nlm.nih.gov/articles/${r.pmcid}/` } : null);
      out.push({
        title: clean(r.title),
        journal: r.journalInfo?.journal?.isoabbreviation || r.journalInfo?.journal?.title || '',
        date: iso(r.firstPublicationDate || r.journalInfo?.printPublicationDate),
        doi: r.doi ?? null,
        pmid: r.pmid ?? null,
        pmcid: r.pmcid ?? null,
        abstract: trimAbstract(r.abstractText),
        fullTextUrl: ft?.url ?? null,
        pubTypes: [].concat(r.pubTypeList?.pubType ?? []),
      });
    }
    if (!j.nextCursorMark || j.nextCursorMark === cursor || (j.resultList?.result ?? []).length < 200) break;
    cursor = j.nextCursorMark;
    await sleep(300);
  }
  return out;
}

// ---------- NCBI E-utilities ----------
async function pubmed(spec) {
  const E = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  const issn = spec.issns.map((i) => `"${i}"[is]`).join(' OR ');
  const terms = spec.titleTerms.map((t) => `"${t}"[ti]`).join(' OR ');
  const type = '(guideline[pt] OR practice guideline[pt] OR guideline*[ti] OR "clinical policy"[ti] OR consensus[ti] OR recommendations[ti]' +
    (spec.allowStatements ? ' OR statement[ti]' : '') + ')';
  const term = `(${issn}) AND (${terms}) AND ${type} AND ("${spec.since.replace(/-/g, '/')}"[dp] : "3000"[dp])`;
  let ids;
  try {
    const s = await getJson(`${E}esearch.fcgi`, { method: 'POST', body: new URLSearchParams({ db: 'pubmed', retmode: 'json', retmax: '500', term }) });
    if (s.esearchresult?.ERROR) throw new Error(s.esearchresult.ERROR.slice(0, 80));
    ids = s.esearchresult?.idlist ?? [];
  } catch {
    ids = await pubmedWebIds(term); // E-utilities search down: use the PubMed site's own search
  }
  if (!ids.length) return [];
  await sleep(400);
  ids = ids.slice(0, 500);
  const sum = await getJson(`${E}esummary.fcgi`, { method: 'POST', body: new URLSearchParams({ db: 'pubmed', retmode: 'json', id: ids.join(',') }) });
  await sleep(400);
  const absRes = await fetch(`${E}efetch.fcgi`, { method: 'POST', headers: { 'User-Agent': UA }, body: new URLSearchParams({ db: 'pubmed', retmode: 'xml', rettype: 'abstract', id: ids.join(',') }) });
  const xml = absRes.ok ? await absRes.text() : '';
  const abstracts = {};
  for (const a of xml.matchAll(/<PMID[^>]*>(\d+)<\/PMID>[\s\S]*?(?:<Abstract>([\s\S]*?)<\/Abstract>|<\/PubmedArticle>)/g)) {
    if (a[2] && !abstracts[a[1]]) abstracts[a[1]] = stripTags(a[2]);
  }
  return ids.map((id) => {
    const r = sum.result[id];
    const ids2 = Object.fromEntries((r.articleids ?? []).map((x) => [x.idtype, x.value]));
    return {
      title: clean(r.title),
      journal: r.source,
      date: iso(r.sortpubdate?.replace(/\//g, '-').slice(0, 10) || r.pubdate),
      doi: ids2.doi ?? null,
      pmid: id,
      pmcid: ids2.pmc ?? null,
      abstract: trimAbstract(abstracts[id]),
      fullTextUrl: ids2.pmc ? `https://pmc.ncbi.nlm.nih.gov/articles/${ids2.pmc}/` : null,
      pubTypes: r.pubtype ?? [],
    };
  });
}

// PubMed website search (format=pmid) — used only when the E-utilities search API is down.
async function pubmedWebIds(term) {
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const url = 'https://pubmed.ncbi.nlm.nih.gov/?' + new URLSearchParams({ term, format: 'pmid', size: '200', sort: 'date', page: String(page) });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`PubMed web HTTP ${res.status}`);
    const html = await res.text();
    const chunk = html.match(/search-results-chunk">([\s\S]*?)<\/pre>/);
    if (!chunk) {
      if (page === 1 && !/No results were found/i.test(html)) throw new Error('PubMed web: unexpected page');
      break;
    }
    const got = chunk[1].split(/\s+/).filter((x) => /^\d+$/.test(x));
    ids.push(...got);
    if (got.length < 200) break;
    await sleep(600);
  }
  return ids;
}

// ---------- Crossref ----------
async function crossref(spec) {
  const out = [];
  for (const issn of spec.issns) {
    const url = `https://api.crossref.org/journals/${issn}/works?` + new URLSearchParams({
      'query.bibliographic': `guideline ${spec.titleTerms.join(' ')}`,
      filter: `from-pub-date:${spec.since},type:journal-article`,
      rows: '200',
      select: 'DOI,title,issued,container-title,short-container-title,abstract',
    });
    let j;
    try {
      j = await getJson(url);
    } catch (err) {
      if (/HTTP 404/.test(err.message)) continue;
      throw err;
    }
    for (const r of j.message?.items ?? []) {
      const [y, m = 1, d = 1] = r.issued?.['date-parts']?.[0] ?? [];
      out.push({
        title: clean(r.title?.[0] ?? ''),
        journal: r['short-container-title']?.[0] || r['container-title']?.[0] || '',
        date: y ? new Date(Date.UTC(y, m - 1, d)).toISOString() : null,
        doi: r.DOI,
        pmid: null,
        pmcid: null,
        abstract: trimAbstract(r.abstract ? stripTags(r.abstract) : ''),
        fullTextUrl: null,
        pubTypes: [],
      });
    }
    await sleep(300);
  }
  return out;
}

const BACKENDS = [['Europe PMC', europePmc], ['PubMed', pubmed], ['Crossref', crossref]];

export async function searchGuidelines(spec) {
  const log = spec.log ?? (() => {});
  let raw = null;
  let used = null;
  const errors = [];
  for (const [name, fn] of BACKENDS) {
    try {
      raw = await fn(spec);
      used = name;
      break;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      log(`    ${name} unavailable (${err.message}); trying next backend`);
    }
  }
  if (!raw) throw new Error(`all literature backends failed — ${errors.join('; ')}`);

  const termRe = new RegExp(spec.titleTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const kept = [];
  const seen = new Set();
  for (const r of raw.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))) {
    if (!r.title || !r.date) continue;
    if (!termRe.test(r.title)) continue;
    if (NOT_A_GUIDELINE.test(r.title) || NOT_A_GUIDELINE_START.test(r.title) || NOT_A_GUIDELINE_ANY.test(r.title)) continue;
    const isGuidelineType = r.pubTypes.some((p) => /guideline/i.test(p));
    if (!isGuidelineType && r.pubTypes.some((p) => /comment|editorial|letter|news|erratum|observational|clinical trial/i.test(p))) continue;
    // Without a Guideline publication type, the title itself must read like a guideline.
    if (!isGuidelineType && !STRICT_TITLE.test(r.title) && !(spec.allowStatements && STATEMENT_TITLE.test(r.title))) continue;
    if (spec.include && !spec.include.test(r.title)) continue;
    if (spec.exclude && spec.exclude.test(r.title)) continue;
    const key = r.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key) || (r.doi && seen.has(r.doi.toLowerCase()))) continue; // co-published copies
    seen.add(key);
    if (r.doi) seen.add(r.doi.toLowerCase());
    kept.push(r);
  }
  log(`    ${used}: ${raw.length} hits → ${kept.length} guidelines`);
  return kept;
}

function clean(t) {
  return stripTags(decode(t || '')).replace(/\.$/, '').replace(/\s+/g, ' ').trim();
}

function iso(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function trimAbstract(s) {
  if (!s) return '';
  const t = stripTags(s).replace(/^(abstract|background|purpose|aim|introduction|objectives?)[:.]?\s*/i, '');
  return t.length > 420 ? t.slice(0, 417).replace(/\s+\S*$/, '') + '…' : t;
}
