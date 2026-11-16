// "Ask" tab: a Claude agent that answers clinical questions from this app's own data.
//
// The agent has four tools that run in the browser over the data already loaded (guideline
// summaries, topic lists, the IBCC and Tintinalli chapter indexes). It decides what to look up,
// reads the results, and answers with citations that open the cited item in the app.
//
// The API key is the user's own. It is typed into this device, kept in localStorage, and sent
// only to api.anthropic.com. It is never in the repo or on the site.

const MODEL = 'claude-opus-5-5';
const KEY_STORE = 'emg.anthropicKey';
const MAX_STEPS = 8;

let ctx; // helpers from app.js: { state, esc, expandQuery, score, rankCompare, isDiscussion, byId, srcName, fmtDate, topics }
let client = null;
const chat = { messages: [], turns: [], busy: false };

const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };

// ---------------------------------------------------------------- tools (run locally)

const TOOLS = [
  {
    name: 'search_guidelines',
    description: 'Full-text search over every guideline, clinical pathway and EM blog discussion in the app (titles, AI summaries, key points, topics). Returns the best matches with their ids. Use short keyword queries (2-5 words), and search again with different words if the first results miss.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords, e.g. "pulmonary embolism thrombolysis".' },
        limit: { type: 'integer', description: 'How many results, 1-12. Default 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_guideline',
    description: 'Read one item in full: its AI summary, key points, limitations, what the summary was written from (full text or abstract), access, and whether a newer version supersedes it. Call this for every item you plan to cite.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'An id returned by search_guidelines or get_topic.' } }, required: ['id'] },
  },
  {
    name: 'get_topic',
    description: 'Everything the app has filed under one topic: current guidelines and pathways (landmark first), EM blog discussion, IBCC chapters (with notes on recent major revisions) and Tintinalli 9e chapters. The topic must be an exact name from the topic list in your instructions.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  },
  {
    name: 'search_references',
    description: 'Search IBCC (Internet Book of Critical Care) and Tintinalli 9e chapter titles. Returns chapter titles only, not chapter text.',
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

const year = (g) => (g.lastPublished ?? '').slice(0, 4) || null;
const brief = (g) => ({
  id: g.id,
  title: g.title,
  source: ctx.srcName(g.source),
  year: year(g),
  kind: ctx.isDiscussion(g) ? 'blog discussion' : 'guideline',
  topics: g.topics,
  superseded: !!g.supersededBy || undefined,
  has_summary: !!g.ai?.summary,
});

function toolSearch({ query, limit }) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query must be a non-empty string');
  const n = Math.min(Math.max(Number.isInteger(limit) ? limit : 8, 1), 12);
  const all = ctx.state.data.guidelines;
  const groups = ctx.expandQuery(query);
  let hits = all.map((g) => [g, ctx.score(g, groups)]).filter(([, s]) => s > 0);
  if (!hits.length) { // no item has every word: rank by how many words match
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    hits = all.map((g) => [g, words.filter((w) => g._hay.includes(w)).length]).filter(([, s]) => s > 0);
  }
  hits.sort((a, b) => b[1] - a[1] || ctx.rankCompare(a[0], b[0]));
  return { total_matches: hits.length, results: hits.slice(0, n).map(([g]) => brief(g)) };
}

function toolGet({ id }) {
  const g = typeof id === 'string' && ctx.byId(id);
  if (!g) throw new Error(`No item with id "${id}". Use an id from search_guidelines or get_topic.`);
  const newer = g.supersededBy && ctx.byId(g.supersededBy);
  return {
    ...brief(g),
    full_title: g.fullTitle || undefined,
    published: g.lastPublished?.slice(0, 10) ?? null,
    category: g.category,
    population: g.ai?.population ?? g.population ?? null,
    access: g.ai?.access ?? null,
    summary: g.ai?.summary || g.summary || null,
    key_points: g.ai?.key_points ?? [],
    limitations: g.ai?.limitations ?? null,
    summary_written_from: g.ai?.basis ?? null,
    superseded_by: newer ? { id: newer.id, title: newer.title } : undefined,
  };
}

function toolTopic({ topic }) {
  if (!ctx.topics().includes(topic)) throw new Error(`"${topic}" is not a topic. Use an exact name from the topic list.`);
  const items = ctx.state.data.guidelines.filter((g) => g.topics.includes(topic)).sort(ctx.rankCompare);
  const recent = (c) => c.change?.significance === 'major' ? { date: c.change.date, note: c.change.summary } : undefined;
  return {
    guidelines: items.filter((g) => !ctx.isDiscussion(g) && !g.supersededBy).slice(0, 12).map(brief),
    discussion: items.filter(ctx.isDiscussion).sort((a, b) => (b.lastPublished ?? '').localeCompare(a.lastPublished ?? '')).slice(0, 6).map(brief),
    ibcc_chapters: (ctx.state.ibcc ?? []).filter((c) => c.topics.includes(topic)).map((c) => ({ ref: `ibcc:${c.slug}`, title: c.title, updated: c.lastmod, major_revision: recent(c) })),
    tintinalli_chapters: (ctx.state.tint ?? []).filter((c) => c.topics.includes(topic)).map((c) => ({ ref: `tint:${c.ch}`, chapter: c.ch, title: c.title, page: c.page })),
  };
}

function toolRefs({ query }) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query must be a non-empty string');
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const rank = (title) => words.filter((w) => title.toLowerCase().includes(w)).length;
  const top = (arr, map) => arr.map((c) => [c, rank(c.title)]).filter(([, s]) => s).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => map(c));
  return {
    ibcc_chapters: top(ctx.state.ibcc ?? [], (c) => ({ ref: `ibcc:${c.slug}`, title: c.title, updated: c.lastmod })),
    tintinalli_chapters: top(ctx.state.tint ?? [], (c) => ({ ref: `tint:${c.ch}`, chapter: c.ch, title: c.title, page: c.page })),
  };
}

const RUN = { search_guidelines: toolSearch, get_guideline: toolGet, get_topic: toolTopic, search_references: toolRefs };
const STEP_LABEL = {
  search_guidelines: (i) => `Searched guidelines: “${i.query ?? ''}”`,
  get_guideline: (i) => `Read: ${ctx.byId(i.id)?.title ?? i.id}`,
  get_topic: (i) => `Opened topic: ${i.topic ?? ''}`,
  search_references: (i) => `Searched IBCC / Tintinalli chapters: “${i.query ?? ''}”`,
};

const systemPrompt = () => `You are the assistant inside "EM Guidelines", a personal reference app used by an emergency physician at the bedside. You answer clinical questions using only what your tools return from the app.

What the app holds: AI-written summaries and key points of published guidelines and clinical pathways (ACEP, AHA/ACC, ESC, specialty societies, Nationwide Children's, CHOP), summaries of RebelEM and ALiEM posts, and chapter indexes (titles only) for IBCC and Tintinalli 9e. It does not hold guideline full text or textbook text.

How to work:
- Look things up before answering. Start with get_topic when the question matches a topic, or search_guidelines otherwise. Read each item with get_guideline before you cite it. Search again with different words if the first results miss.
- Prefer the current version of a guideline over a superseded one, and society guidelines over blog posts. Blog posts are the authors' views: say so when you use one.
- Check the population. Do not apply a pediatric pathway to an adult question or the reverse without saying so.
- Every clinical statement needs a citation right after it, in double square brackets with the item id exactly as returned, for example [[acep:some-id]]. For IBCC and Tintinalli use the ref exactly as returned, for example [[ibcc:pe]] or [[tint:56]]. These become links in the app. Never invent an id.
- Give doses, thresholds and timing only when they appear in a tool result. If the app's summary lacks the detail, say that the summary does not include it and point to the cited source or to the IBCC or Tintinalli chapter that would have it.
- If the app has nothing useful on the question, say so plainly and suggest checking OpenEvidence or UpToDate. Do not answer from memory.
- If guidelines disagree, say so and give each position with its citation.

Format: lead with the direct answer in one or two sentences. Then short bullets for the specifics. Keep it under about 250 words unless asked for more. Plain language, no preamble, no closing summary. Use "- " for bullets and **bold** sparingly; no tables or headings.

These are summaries, so finish with one line naming which source the physician should open to confirm before acting, when a decision depends on it.

Topic list (exact names for get_topic):
${ctx.topics().join(' | ')}`;

// ---------------------------------------------------------------- agent loop

async function getClient() {
  if (client) return client;
  const { default: Anthropic } = await import('./vendor/anthropic-sdk.mjs');
  // The key is the user's own and stays on their device; there is no server to keep it on.
  client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });
  return client;
}

function runTool(block) {
  try {
    const fn = RUN[block.name];
    if (!fn) throw new Error(`Unknown tool ${block.name}`);
    if (!block.input || typeof block.input !== 'object') throw new Error('Tool input was not valid JSON.');
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(fn(block.input)) };
  } catch (err) {
    return { type: 'tool_result', tool_use_id: block.id, content: err.message, is_error: true };
  }
}

async function ask(question, onUpdate) {
  const turn = { q: question, steps: [], answer: '', error: null, done: false };
  chat.turns.push(turn);
  chat.busy = true;
  const start = chat.messages.length;
  chat.messages.push({ role: 'user', content: question });
  onUpdate();
  try {
    const api = await getClient();
    for (let step = 0; step < MAX_STEPS; step++) {
      turn.answer = '';
      const stream = api.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages: chat.messages,
      });
      stream.on('text', (delta) => { turn.answer += delta; onUpdate(true); });
      const msg = await stream.finalMessage();
      chat.messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason === 'tool_use') {
        const calls = msg.content.filter((b) => b.type === 'tool_use');
        for (const c of calls) turn.steps.push(STEP_LABEL[c.name]?.(c.input ?? {}) ?? c.name);
        chat.messages.push({ role: 'user', content: calls.map(runTool) });
        onUpdate();
        continue;
      }
      if (msg.stop_reason === 'refusal') turn.error = 'Claude declined to answer this question.';
      else if (msg.stop_reason === 'max_tokens') turn.error = 'The answer was cut off for length. Ask a narrower question.';
      else if (!turn.answer.trim()) turn.error = 'No answer came back. Try rewording the question.';
      break;
    }
    if (!turn.answer.trim() && !turn.error) turn.error = 'Stopped after too many lookups without an answer. Try a narrower question.';
  } catch (err) {
    chat.messages.length = start; // drop the failed exchange so the next question starts clean
    const status = err?.status;
    turn.error = status === 401 ? 'Anthropic rejected the API key. Check it under “API key” below.'
      : status === 429 ? 'Rate limit or out of credit on this API key. Try again in a minute.'
      : status === 529 || status >= 500 ? 'Anthropic is overloaded right now. Try again in a minute.'
      : !navigator.onLine ? 'You are offline. The Ask tab needs a connection.'
      : `Could not get an answer (${err?.message ?? 'unknown error'}).`;
    if (status === 401) client = null;
  }
  turn.done = true;
  chat.busy = false;
  onUpdate();
}

// ---------------------------------------------------------------- rendering

// Model text is escaped first; only **bold**, "- " bullets and [[citations]] become markup.
function renderAnswer(text) {
  const { esc, state, byId } = ctx;
  const cite = (ref) => {
    if (ref.startsWith('ibcc:')) {
      const c = (state.ibcc ?? []).find((x) => x.slug === ref.slice(5));
      return c ? `<a class="cite" href="${esc(c.url)}" target="_blank" rel="noopener">IBCC: ${esc(c.title)} ↗</a>` : '';
    }
    if (ref.startsWith('tint:')) {
      const c = (state.tint ?? []).find((x) => x.ch === ref.slice(5));
      if (!c) return '';
      return state.tintHas ? `<button class="cite" data-tint-page="${c.page}">Tintinalli Ch ${esc(c.ch)}, p. ${c.page}</button>`
        : `<span class="cite">Tintinalli Ch ${esc(c.ch)} ${esc(c.title)}, p. ${c.page}</span>`;
    }
    const g = byId(ref);
    return g ? `<button class="cite" data-id="${esc(g.id)}">${esc(g.title)}</button>` : '';
  };
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\[([^\]]+)\]\]/g, (_, r) => cite(r.trim()));
  const out = [];
  let inList = false;
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-•]\s+(.*)$/);
    if (m) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

const turnHtml = (t) => `<article class="ask-turn">
  <p class="ask-q">${ctx.esc(t.q)}</p>
  ${t.steps.length ? `<ul class="ask-steps">${t.steps.map((s) => `<li>${ctx.esc(s)}</li>`).join('')}</ul>` : ''}
  ${t.answer.trim() ? `<div class="ask-a">${renderAnswer(t.answer)}</div>` : ''}
  ${!t.done && !t.answer.trim() ? '<p class="muted small ask-wait">Looking things up…</p>' : ''}
  ${t.error ? `<p class="ask-err">${ctx.esc(t.error)}</p>` : ''}
  ${t.done && t.answer.trim() ? '<p class="ai-warn">AI answer built from this app’s guideline summaries. It can be wrong or out of date: open the cited source before acting.</p>' : ''}
</article>`;

export function renderAsk(el) {
  const { esc } = ctx;
  const hasKey = !!getKey();
  const draft = el.querySelector('#ask-input')?.value ?? '';
  el.innerHTML = `<section class="ask">
    ${hasKey ? `
      <div id="ask-log">${chat.turns.map(turnHtml).join('')}</div>
      ${chat.turns.length ? '' : `<p class="update-run">Ask a clinical question. Claude looks through this app’s guidelines, pathways, blog discussion and the IBCC and Tintinalli chapter lists, then answers with links to what it used. Do not enter patient names or other identifiers.</p>
        <div class="ask-examples">${['Who needs imaging for suspected PE, and when can I use PERC?', 'Febrile infant 29-60 days: workup and who can go home?', 'First-line agents and BP target in acute aortic dissection'].map((q) => `<button class="chip" data-ask-example="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
      <form id="ask-form" class="ask-form">
        <textarea id="ask-input" rows="2" placeholder="${chat.turns.length ? 'Follow-up question…' : 'e.g. Anticoagulation reversal for warfarin ICH'}" enterkeyhint="send" ${chat.busy ? 'disabled' : ''}>${esc(draft)}</textarea>
        <button class="btn primary" ${chat.busy ? 'disabled' : ''}>${chat.busy ? 'Working…' : 'Ask'}</button>
      </form>
      ${chat.turns.length && !chat.busy ? '<button class="linkish" id="ask-new">New conversation</button>' : ''}` : ''}
    <details class="ask-key" ${hasKey ? '' : 'open'}>
      <summary>API key ${hasKey ? '(saved on this device)' : 'needed'}</summary>
      <p class="muted small">The Ask tab uses your own Anthropic API key. It is saved on this device only and sent only to Anthropic. Each question costs a few cents on your Anthropic account. Create a key at console.anthropic.com → API keys, and set a monthly spend limit there.</p>
      <div class="nlm-row"><input id="ask-key" type="password" autocomplete="off" placeholder="${hasKey ? 'Key saved. Paste a new one to replace it' : 'sk-ant-…'}"><button class="btn" id="ask-key-save">Save</button>${hasKey ? '<button class="btn" id="ask-key-remove">Remove</button>' : ''}</div>
      <span id="ask-key-status" class="muted small"></span>
    </details>
  </section>`;

  const rerender = (streaming) => {
    if (ctx.state.tab !== 'ask') return;
    if (streaming) { // only refresh the log while text streams, so the page doesn't jump
      const log = el.querySelector('#ask-log');
      if (log) { log.innerHTML = chat.turns.map(turnHtml).join(''); return; }
    }
    renderAsk(el);
  };
  const submit = (q) => { if (q.trim() && !chat.busy) { const i = el.querySelector('#ask-input'); if (i) i.value = ''; ask(q.trim(), rerender); } };

  el.querySelector('#ask-form')?.addEventListener('submit', (e) => { e.preventDefault(); submit(el.querySelector('#ask-input').value); });
  el.querySelector('#ask-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e.target.value); } });
  el.querySelectorAll('[data-ask-example]').forEach((b) => b.addEventListener('click', () => submit(b.dataset.askExample)));
  el.querySelector('#ask-new')?.addEventListener('click', () => { chat.messages = []; chat.turns = []; renderAsk(el); });
  el.querySelector('#ask-key-save')?.addEventListener('click', () => {
    const v = el.querySelector('#ask-key').value.trim();
    if (!/^sk-ant-/.test(v)) { el.querySelector('#ask-key-status').textContent = 'That does not look like an Anthropic API key (it starts with sk-ant-).'; return; }
    try { localStorage.setItem(KEY_STORE, v); } catch { el.querySelector('#ask-key-status').textContent = 'Could not save on this device.'; return; }
    client = null;
    renderAsk(el);
  });
  el.querySelector('#ask-key-remove')?.addEventListener('click', () => { try { localStorage.removeItem(KEY_STORE); } catch { /* nothing to remove */ } client = null; renderAsk(el); });
}

export function initAsk(helpers) { ctx = helpers; }
