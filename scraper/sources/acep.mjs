// Source adapter: ACEP clinical policies. The public ACEP listing gives the current policy
// set; the Annals of Emergency Medicine publication (dates, DOI, abstract, free full text)
// comes from the literature search and is matched to each listing entry by topic words.
import { fetchText, fetchHead, stripTags, absolutize } from '../util.mjs';
import { searchGuidelines } from '../lit.mjs';

export const id = 'acep';
export const name = 'ACEP Clinical Policies';
export const homepage = 'https://www.acep.org/patient-care/clinical-policies';
export const population = 'Adult';

const BASE = 'https://www.acep.org';

// ACEP's policy pages require a member sign-in, but the policy PDFs they link to are public.
// This map was read once from the signed-in pages (2026-11). A policy ACEP adds later won't be
// here until the map is refreshed; it then falls back to the Annals record (title-only summary).
const F = 'https://www.acep.org/siteassets/sites/acep/media/clinical-policies/final-cp-pdfs/';
const N = 'https://www.acep.org/siteassets/new-pdfs/clinical-policies/';
const S = 'https://www.acep.org/siteassets/sites/acep/media/clinical-policies/';
const POLICY_PDFS = {
  'psychiatric-patient': F + 'psychpatient-cp.pdf',
  'acute-blunt-trauma': F + 'acuteblunttrauma-cp.pdf',
  'acute-heart-failure-syndromes': N + 'acute-heart-failure-syndrome-clinical-policy.pdf',
  'acute-ischemic-stroke': N + 'acuteischemicstrokecp.pdf',
  'acute-venous-thromboembolic-disease': F + 'acute-venous-thromboembolic-disease-cp.pdf',
  appendicitis: S + 'appendicitis2023.pdf',
  'asymptomatic-elevated-blood-pressure': N + 'asympt-hypert2-final-bod-approved-2013.pdf',
  cannabis: F + 'cannabis-exposure-cp.pdf',
  'carbon-monoxide-poisoning': F + 'carbonmonoxide3-cp.pdf',
  'community-acquired-pneumonia': N + 'cp-pneumonia.pdf',
  'direct-oral-anticoagulants': F + 'direct-oral-anticoagulants---cp.pdf',
  'early-pregnancy': N + 'cp-earlypregnancy-doc.pdf',
  'endotracheal-intubation': F + 'endotracheal-intubation-cp.pdf',
  'fever---infants-and-children-younger-than-2-years': N + 'pedi-fever.pdf',
  headache: S + 'cp-headache.pdf',
  'nonst-elevation-acute-coronary-syndromes': N + 'nste.acs.2.2018.final.pdf',
  opioids: F + 'opioids-cp.pdf',
  'outpatient-management-asymptomatic-elevated-blood-pressure': F + 'asxhypertension-cp.pdf',
  'procedural-sedation-and-analgesia': N + 'clinical-policy-procedural-sedation-and-analgesia-in-the-emergency-department.pdf',
  'reperfusion-therapy-for-stemi': F + 'reperfusion-cp.pdf',
  seizure: N + 'seizures.pdf',
  'severe-agitation': N + 'severe-agitation-cp.pdf',
  'suspected-transient-ischemic-attack': F + 'susptectedtia-cp.pdf',
  'thrombolytics-for-the-management-of-acute-ischemic-stroke': S + 'thrombolytics-for-the-management-of-acute-ischemic-stroke-b.pdf',
  // Members-only PDFs (they return a sign-in page): mild-traumatic-brain-injury2, thoracic-aortic-dissection
};
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
    const pdfUrl = POLICY_PDFS[url.split('/').pop().toLowerCase()];
    if (pdfUrl) {
      const h = await fetchHead(pdfUrl);
      if (h) docs.unshift({ url: pdfUrl, label: 'Policy PDF (ACEP)', lastModified: match?.date ?? h.lastModified, size: h.size, access: 'free' });
    }
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
