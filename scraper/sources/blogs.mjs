// EM blog sources (WordPress sites). Each post becomes a "discussion" record: it is listed and
// searchable on its own, summarized like a guideline, and cross-referenced to guidelines that
// share a topic. The summarizer pulls the full post text from the same WordPress API.
import { stripTags } from '../util.mjs';

const UA = 'EM-Guidelines-Bot/1.0 (personal clinical reference app; monthly refresh)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BLOGS = [
  {
    id: 'rebelem',
    name: 'RebelEM',
    homepage: 'https://rebelem.com/',
    api: 'https://rebelem.com/wp-json/wp/v2/posts',
    since: '2018-01-01T00:00:00',
    params: {},
  },
  {
    id: 'aliem',
    name: 'ALiEM',
    homepage: 'https://www.aliem.com/',
    api: 'https://www.aliem.com/wp-json/wp/v2/posts',
    since: '2019-01-01T00:00:00',
    // Non-clinical categories: medical education, social media & tech, academic, education
    // articles, book club, how I work smarter, wellness, podcasts, MEdIC, AIR, clinical images.
    params: { categories_exclude: '77,40,76,9,123,185,326,9868,156,176,905' },
  },
];

async function fetchAll(blog, log) {
  const out = [];
  for (let page = 1; page <= 40; page++) {
    const url = `${blog.api}?` + new URLSearchParams({
      per_page: '100', page: String(page), after: blog.since, orderby: 'date', order: 'desc',
      _fields: 'id,date,modified,link,title,excerpt', ...blog.params,
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 400 && page > 1) break; // past the last page
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = await res.json();
    out.push(...posts);
    const totalPages = Number(res.headers.get('x-wp-totalpages') || 1);
    if (page >= totalPages) break;
    await sleep(400);
  }
  log(`  ${blog.name}: ${out.length} posts`);
  return out;
}

export const sources = BLOGS.map((blog) => ({
  id: blog.id,
  name: blog.name,
  homepage: blog.homepage,
  population: null,
  kind: 'discussion',
  async fetchGuidelines({ log }) {
    const posts = await fetchAll(blog, log);
    return posts.map((p) => {
      const date = new Date(p.date + 'Z').toISOString();
      const excerpt = stripTags(p.excerpt?.rendered ?? '').replace(/\s*(Read More|Continue reading).*$/i, '');
      return {
        sourceUrl: p.link,
        title: stripTags(p.title?.rendered ?? ''),
        summary: excerpt.length > 400 ? excerpt.slice(0, 397).replace(/\s+\S*$/, '') + '…' : excerpt,
        settings: [],
        emRelevant: true,
        kind: 'discussion',
        wpId: p.id,
        wpApi: blog.api,
        // Post id, not the modified date: routine edits shouldn't trigger a re-summary.
        versionKey: `wp:${p.id}`,
        documents: [{ url: p.link, label: `${blog.name} post`, lastModified: date, size: null, access: 'free' }],
      };
    });
  },
}));
