const UA = 'EM-Guidelines-Bot/1.0 (personal clinical reference app; monthly refresh)';
const DELAY_MS = Number(process.env.SCRAPE_DELAY_MS ?? 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

export async function fetchText(url) {
  await sleep(DELAY_MS);
  return withRetry(async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
}

export async function fetchHead(url) {
  await sleep(DELAY_MS / 2);
  try {
    return await withRetry(async () => {
      const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const lm = res.headers.get('last-modified');
      return {
        lastModified: lm ? new Date(lm).toISOString() : null,
        size: Number(res.headers.get('content-length')) || null,
      };
    }, 2);
  } catch {
    return null;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };

export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripTags(s) {
  return decode(s.replace(/<[^>]+>/g, ' ')).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

export function absolutize(href, base) {
  return new URL(href, base).toString();
}
