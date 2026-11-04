// Source adapter: Nationwide Children's Hospital clinical pathways.
// Every adapter exports `id`, `name`, `homepage`, and `async fetchGuidelines(ctx)`
// returning an array of raw guideline records (see scraper/index.mjs for the shape).

import { fetchText, fetchHead, decode, stripTags, absolutize } from '../util.mjs';

export const id = 'nch';
export const name = "Nationwide Children's";
export const homepage =
  'https://www.nationwidechildrens.org/for-medical-professionals/tools-for-your-practice/clinical-pathways';

const BASE = 'https://www.nationwidechildrens.org';
const PATH_PREFIX = '/for-medical-professionals/tools-for-your-practice/clinical-pathways/';

// Section headings on the listing page -> short setting codes.
const SECTION_SETTINGS = {
  'emergency department': 'ED',
  'urgent care': 'UC',
  inpatient: 'IP',
  nicu: 'NICU',
  outpatient: 'OP',
  surgery: 'Surgery',
  'behavioral health pavilion': 'BHP',
};

export async function fetchGuidelines({ log }) {
  const listing = await fetchText(homepage);

  // 1. Walk the page in order, tracking which <h2> section each card falls under.
  const byUrl = new Map();
  const tokenRe = /<h2[^>]*>([\s\S]*?)<\/h2>|<h4>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h4>\s*(?:<p>([\s\S]*?)<\/p>)?/g;
  let section = null;
  for (const m of listing.matchAll(tokenRe)) {
    if (m[1] !== undefined) {
      section = SECTION_SETTINGS[stripTags(m[1]).toLowerCase()] ?? null;
      continue;
    }
    const href = m[2];
    if (!href.startsWith(PATH_PREFIX) || href.endsWith('/misc')) continue;
    const url = absolutize(href, BASE);
    const rec = byUrl.get(url) ?? { url, title: stripTags(m[3]), description: '', settings: new Set() };
    if (m[4] && !rec.description) rec.description = stripTags(m[4]);
    if (section) rec.settings.add(section);
    byUrl.set(url, rec);
  }

  // 2. The left-nav list carries "Title - ED/IP/UC" labels; use it to fill in settings
  //    and to catch pathways that only appear in the nav.
  const navRe = new RegExp(`<a href="(${PATH_PREFIX.replace(/\//g, '\\/')}[a-z0-9-]+)">([^<]+)<\\/a>`, 'g');
  for (const m of listing.matchAll(navRe)) {
    if (m[1].endsWith('/misc')) continue;
    const url = absolutize(m[1], BASE);
    const label = decode(m[2]).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const dash = label.lastIndexOf(' - ');
    const title = dash > 0 ? label.slice(0, dash).trim() : label;
    const codes = dash > 0 ? label.slice(dash + 3).split('/').map((s) => s.trim()) : [];
    const rec = byUrl.get(url) ?? { url, title, description: '', settings: new Set() };
    rec.navTitle = title;
    codes.forEach((c) => rec.settings.add(normalizeSetting(c)));
    byUrl.set(url, rec);
  }

  log(`  listing: ${byUrl.size} pathways`);

  // 3. Visit each pathway page for PDF links + a summary; HEAD the PDFs for Last-Modified.
  const out = [];
  for (const rec of byUrl.values()) {
    try {
      const page = await fetchText(rec.url);
      const pdfs = [...new Set(
        [...page.matchAll(/href="([^"]+\.pdf)(?:\?[^"]*)?"/gi)].map((m) => absolutize(decode(m[1]), BASE)),
      )].filter((u) => u.includes('/clinical-pathways/'));

      const pdfMeta = [];
      for (const pdf of pdfs) {
        const h = await fetchHead(pdf);
        pdfMeta.push({
          url: pdf,
          label: pdfLabel(pdf),
          lastModified: h?.lastModified ?? null,
          size: h?.size ?? null,
        });
      }

      const h1 = page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const pageTitle = h1 ? stripTags(h1[1]) : '';
      const summary = rec.description || extractSummary(page);

      out.push({
        sourceUrl: rec.url,
        title: cleanTitle(rec.navTitle || pageTitle || rec.title),
        summary,
        settings: [...rec.settings].filter(Boolean).sort(),
        documents: pdfMeta,
      });
    } catch (err) {
      log(`  ! ${rec.url}: ${err.message}`);
      out.push({
        sourceUrl: rec.url,
        title: cleanTitle(rec.navTitle || rec.title),
        summary: rec.description,
        settings: [...rec.settings].filter(Boolean).sort(),
        documents: [],
        fetchError: err.message,
      });
    }
  }
  return out;
}

function normalizeSetting(code) {
  const c = code.toUpperCase();
  if (c === 'SURGERY') return 'Surgery';
  return c;
}

function cleanTitle(t) {
  return t.replace(/^clinical pathway:\s*/i, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

function pdfLabel(url) {
  const file = decodeURIComponent(url.split('/').pop().replace(/\.pdf$/i, ''));
  if (/algorithm|pathway/i.test(file)) return 'Pathway (PDF)';
  if (/order|set/i.test(file)) return 'Order set (PDF)';
  if (/table|appendix|dosing/i.test(file)) return 'Appendix (PDF)';
  return file.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + ' (PDF)';
}

function extractSummary(page) {
  const body = page.match(/<div class="[^"]*rtf[^"]*">([\s\S]*?)<\/div>/i);
  if (!body) return '';
  const p = body[1].match(/<p>([\s\S]*?)<\/p>/i);
  const text = p ? stripTags(p[1]) : '';
  return text.length > 400 ? text.slice(0, 397) + '…' : text;
}
