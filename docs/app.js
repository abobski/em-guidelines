const $ = (s) => document.querySelector(s);
const esc = (s = '') => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SETTING_LABELS = { ED: 'ED', UC: 'Urgent Care', IP: 'Inpatient', ICU: 'ICU', NICU: 'NICU', OP: 'Outpatient', Surgery: 'Surgery', BHP: 'Behavioral' };
const SETTING_ORDER = ['ED', 'UC', 'IP', 'ICU', 'NICU', 'OP', 'Surgery', 'BHP'];
const RECENT_DAYS = 90;
const HOT_DAYS = 45;

// Common EM shorthand -> phrases that appear in titles/summaries (comma-separated).
const SYNONYMS = {
  dka: 'diabetic ketoacidosis', uti: 'urinary tract infection', nat: 'non-accidental trauma, physical abuse',
  abuse: 'non-accidental trauma', ssti: 'skin and soft tissue', cellulitis: 'skin and soft tissue', abscess: 'soft tissue infection',
  cap: 'community-acquired pneumonia, community acquired pneumonia', pna: 'pneumonia', pe: 'pulmonary embolism',
  apap: 'acetaminophen', tylenol: 'acetaminophen', tox: 'poisoning, overdose, ingestion', aom: 'otitis media', ear: 'otitis',
  age: 'gastroenteritis', vomiting: 'emesis, gastroenteritis', fever: 'febrile', sbi: 'febrile infant, febrile neonate',
  cspine: 'cervical spine', 'c-spine': 'cervical spine', tbi: 'traumatic brain injury, concussion', head: 'head injury, concussion',
  sz: 'seizure', se: 'status epilepticus', rsi: 'rapid sequence intubation, rsi, intubation', intubation: 'intubation, airway',
  sedation: 'procedural sedation', allergy: 'anaphylaxis, allergy', aub: 'abnormal uterine bleeding', pid: 'pelvic inflammatory disease',
  sti: 'sexually transmitted', std: 'sexually transmitted', hyperk: 'hyperkalemia', k: 'hyperkalemia',
  ich: 'intracerebral hemorrhage', iron: 'iron deficiency', kd: 'kawasaki', misc: 'mis-c', ptx: 'pneumothorax',
  sbo: 'small bowel obstruction, bowel obstruction', intuss: 'intussusception', appy: 'appendicitis', fb: 'foreign body',
  globe: 'open globe', eye: 'globe, orbital', shock: 'septic shock, shock',
  ami: 'myocardial infarction, acute coronary', mi: 'myocardial infarction, acute coronary',
  stemi: 'stemi, st-segment elevation, st-elevation, reperfusion', nstemi: 'non-st-elevation, without persistent st-segment',
  acs: 'acute coronary syndrome', cp: 'chest pain', afib: 'atrial fibrillation', af: 'atrial fibrillation',
  chf: 'heart failure', hf: 'heart failure', svt: 'supraventricular tachycardia', vt: 'ventricular arrhythmia',
  htn: 'hypertension, blood pressure', bp: 'blood pressure', dvt: 'deep vein thrombosis, venous thromboembolism, venous thrombo',
  vte: 'venous thromboembolism, venous thrombo', doac: 'direct oral anticoagulant', anticoag: 'anticoagula',
  tpa: 'thrombolytic, plasminogen activator', tnk: 'thrombolytic', cva: 'stroke', tia: 'transient ischemic attack',
  sah: 'subarachnoid hemorrhage', acls: 'advanced life support, cardiovascular life support', bls: 'basic life support',
  pals: 'pediatric life support, pediatric advanced life support', cpr: 'cardiopulmonary resuscitation, cardiac arrest',
  rosc: 'post-cardiac arrest, post–cardiac arrest, post-resuscitation', arrest: 'cardiac arrest',
  gib: 'gastrointestinal bleeding, gi bleeding', ugib: 'upper gastrointestinal', lgib: 'lower gastrointestinal',
  copd: 'chronic obstructive', ards: 'acute respiratory distress', dissection: 'aortic dissection', aaa: 'aortic',
  co: 'carbon monoxide', hit: 'heparin-induced', etoh: 'alcohol', psych: 'psychiatric, behavioral health', pex: 'pulmonary embolism',
};

const state = {
  data: null,
  ai: {},
  tab: 'browse',
  q: '',
  setting: load('setting', 'EM'),
  src: load('src', 'ALL'),
  cat: null,
  topic: null,
  saved: new Set(load('saved', [])),
  hot: new Set(),
  acepMember: load('acepMember', false),
};

// ACEP sign-in happens on ACEP's own page; the app never sees credentials. The browser keeps
// ACEP's session cookie, so later ACEP links on this device open signed in.
const ACEP_SIGNIN = 'https://www.acep.org/member-sign-in?ReturnUrl=%2Fpatient-care%2Fclinical-policies';

const DISCUSSION_BADGE = { rebelem: 'RebelEM', aliem: 'ALiEM' };
const PATHWAY_SOURCES = new Set(['nch', 'chop']);

function load(k, d) {
  try { const v = localStorage.getItem('emg:' + k); return v ? JSON.parse(v) : d; } catch { return d; }
}
function save(k, v) {
  try { localStorage.setItem('emg:' + k, JSON.stringify(v)); } catch {}
}

const daysAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;
// Sources give dates at different precision: year only (stored as Jan 1), month (1st), or a full date.
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const opts = { timeZone: 'UTC', year: 'numeric' };
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  if (midnight && d.getUTCDate() === 1 && d.getUTCMonth() === 0) return d.toLocaleDateString(undefined, opts);
  if (midnight && d.getUTCDate() === 1) return d.toLocaleDateString(undefined, { ...opts, month: 'short' });
  return d.toLocaleDateString(undefined, { ...opts, month: 'short', day: 'numeric' });
};

const isDiscussion = (g) => g.kind === 'discussion';
const byId = (id) => state.data.guidelines.find((x) => x.id === id);

// Landmark ordering: current major society guidelines first, then hospital pathways, then
// blog discussion; older versions last; newest first within each tier.
function tier(g) {
  if (isDiscussion(g)) return 3;
  if (PATHWAY_SOURCES.has(g.source)) return 2;
  if (g.ai?.is_major_guideline === false) return 1.5;
  return 1;
}
function rankCompare(a, b) {
  return (a.supersededBy ? 1 : 0) - (b.supersededBy ? 1 : 0)
    || tier(a) - tier(b)
    || (b.lastPublished ?? '').localeCompare(a.lastPublished ?? '')
    || a.title.localeCompare(b.title);
}

// ---------------------------------------------------------------- access / paywall

const ACCESS = {
  'open-access': { cls: 'free', label: 'Free full text (open access)' },
  free: { cls: 'free', label: 'Free full text' },
  subscription: { cls: 'paywall', label: 'Paywalled: subscription required' },
  members: { cls: 'paywall', label: 'Paywalled: ACEP members / Annals subscription' },
  unknown: { cls: 'maybe', label: 'Access unverified: may require a subscription' },
  'acep-signin': { cls: 'member', label: 'ACEP members only: opens with your ACEP sign-in on this device' },
};

function guidelineAccess(g) {
  if (g.source === 'acep') return state.acepMember ? 'acep-signin' : 'members';
  if (isDiscussion(g) || PATHWAY_SOURCES.has(g.source)) return 'free';
  if (g.ai?.access) return g.ai.access;
  if (g.documents.some((d) => /free full text/i.test(d.label))) return 'free';
  return 'unknown';
}

function docAccess(d, g) {
  if (/free full text|pubmed abstract/i.test(d.label)) return /pubmed/i.test(d.label) ? 'abstract' : 'free';
  if (/acep policy page/i.test(d.label)) return state.acepMember ? 'acep-signin' : 'members';
  if (/annals/i.test(d.label)) return 'subscription';
  if (/journal|annals|jacc/i.test(d.label)) return guidelineAccess(g);
  return 'free';
}

const docNote = { subscription: ' · paywall', members: ' · members only', unknown: ' · may be paywalled', abstract: ' · abstract only', 'acep-signin': ' · your ACEP sign-in' };

// ---------------------------------------------------------------- init

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const res = await fetch('data/guidelines.json', { cache: 'no-cache' });
    state.data = await res.json();
  } catch {
    $('#list').innerHTML = '<p class="empty">Could not load guidelines. Connect once to download them for offline use.</p>';
    return;
  }
  const [changelog, summaries] = await Promise.all([
    fetch('data/changelog.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({ runs: [] })),
    fetch('data/summaries.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({ items: {} })),
  ]);
  state.changelog = changelog;
  state.summaryModel = summaries.model;

  const latest = changelog.runs[0];
  const changedNow = new Set([...(latest?.added ?? []), ...(latest?.updated ?? [])].map((x) => x.id));
  for (const g of state.data.guidelines) {
    const ai = summaries.items?.[g.id];
    if (ai) {
      g.ai = ai; // may have topics but an empty summary (paywalled, title-only tagging)
      if (ai.category && ai.category !== 'General') g.category = ai.category;
    }
    g.topics = g.ai?.topics ?? [];
    g._hay = [g.title, g.fullTitle, g.summary, g.ai?.summary, ...(g.ai?.key_points ?? []), ...g.topics, g.category,
      g.settings.join(' '), ...g.settings.map((s) => SETTING_LABELS[s] ?? s)].filter(Boolean).join(' ').toLowerCase();
    g._tl = g.title.toLowerCase();
    if (!isDiscussion(g) && (changedNow.has(g.id) || (g.lastPublished && daysAgo(g.lastPublished) <= HOT_DAYS))) state.hot.add(g.id);
  }

  renderSettings();
  renderSources();
  renderAccounts();
  bind();
  render();
  openFromUrl();

  const src = state.data.sources.map((s) => `<a href="${esc(s.homepage)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(', ');
  const n = Object.values(summaries.items ?? {}).filter((x) => x.summary).length;
  $('#meta').innerHTML = `Last refreshed ${fmtDate(state.data.generated)} · ${n} AI summaries${state.summaryModel ? ` (${esc(state.summaryModel)})` : ''} · Sources: ${src}`;
}

function bind() {
  const q = $('#q');
  q.addEventListener('input', () => { state.q = q.value.trim(); $('#clear').hidden = !state.q; render(); });
  $('#clear').addEventListener('click', () => { q.value = ''; state.q = ''; $('#clear').hidden = true; render(); q.focus(); });
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      state.topic = null;
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
      render();
      window.scrollTo({ top: 0 });
    }));
  $('#list').addEventListener('click', onClick);
  $('#detail').addEventListener('click', onClick);
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet();
    const star = e.target.closest('[data-star]');
    if (star) toggleSaved(star.dataset.star);
  });
  $('#sheet').addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  window.addEventListener('popstate', () => { if (!location.hash.startsWith('#g=') && $('#sheet').open) $('#sheet').close(); else openFromUrl(); });
}

function onClick(e) {
  const t = e.target.closest('[data-topic]');
  if (t) {
    e.preventDefault();
    if ($('#sheet').open) closeSheet();
    openTopic(t.dataset.topic);
    return;
  }
  if (e.target.closest('[data-back]')) { state.topic = null; render(); return; }
  if (e.target.closest('summary, details, a')) return;
  const el = e.target.closest('[data-id]');
  if (el) openDetail(el.dataset.id, true);
}

function renderAccounts() {
  const el = $('#accounts');
  el.innerHTML = `<h3>ACEP account</h3>
    <label class="toggle"><input type="checkbox" id="acep-member" ${state.acepMember ? 'checked' : ''}> I'm an ACEP member</label>
    ${state.acepMember ? `<p class="muted small">Sign in once below. ACEP's site keeps you signed in on this device, so ACEP policy links open the full policy. You enter your password on ACEP's page, never in this app. If links ask you to sign in again, ACEP's session has expired: tap the button again.</p>
    <a class="btn" href="${ACEP_SIGNIN}" target="_blank" rel="noopener">Sign in to ACEP</a>` : ''}`;
  $('#acep-member').addEventListener('change', (e) => {
    state.acepMember = e.target.checked;
    save('acepMember', state.acepMember);
    renderAccounts();
    render();
  });
}

function openTopic(name) {
  state.tab = 'topics';
  state.topic = name;
  document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === 'topics'));
  render();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- filters

function renderSettings() {
  const present = new Set(state.data.guidelines.flatMap((g) => g.settings));
  const opts = [['EM', 'EM-relevant'], ['ALL', 'All'], ...SETTING_ORDER.filter((s) => present.has(s)).map((s) => [s, SETTING_LABELS[s]])];
  const el = $('#settings');
  el.innerHTML = opts.map(([v, l]) => `<button class="chip" data-v="${v}" aria-pressed="${state.setting === v}">${esc(l)}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.setting = b.dataset.v;
    save('setting', state.setting);
    el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
    render();
  });
}

function renderSources() {
  const srcs = state.data.sources;
  const pops = [...new Set(srcs.map((s) => s.population).filter(Boolean))].sort();
  const opts = [['ALL', 'All sources'], ...pops.map((p) => [p, p === 'Pediatric' ? 'Peds' : p]), ...srcs.map((s) => [s.id, s.name])];
  if (!opts.some(([v]) => v === state.src)) state.src = 'ALL';
  const el = $('#sources');
  el.innerHTML = opts.map(([v, l]) => `<button class="chip ${v === 'Adult' || v === 'Pediatric' ? 'pop' : ''} ${DISCUSSION_BADGE[v] ? 'blog' : ''}" data-v="${esc(v)}" aria-pressed="${state.src === v}">${esc(l)}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.src = b.dataset.v;
    save('src', state.src);
    el.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
    render();
  });
}

function bySource(g) {
  if (state.src === 'ALL') return true;
  if (state.src === 'Adult' || state.src === 'Pediatric') return g.population === state.src || g.ai?.population === state.src || g.ai?.population === 'Both';
  return g.source === state.src;
}

const srcName = (id) => state.data.sources.find((s) => s.id === id)?.name ?? id;

function bySetting(g) {
  if (state.setting === 'ALL') return true;
  if (state.setting === 'EM') return g.emRelevant;
  return g.settings.includes(state.setting);
}

// Blog posts appear in search, topic pages and guideline cross-references; in Browse only when
// their source is picked in the source filter.
const showDiscussions = () => !!DISCUSSION_BADGE[state.src];

// ---------------------------------------------------------------- search

function expandQuery(q) {
  const words = q.toLowerCase().split(/[\s,/]+/).filter(Boolean);
  return words.map((w) => [w, ...(SYNONYMS[w] ? SYNONYMS[w].split(/,\s*/) : [])]);
}

const reEsc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function score(g, groups) {
  let s = 0;
  for (const alts of groups) {
    let best = 0;
    for (const w of alts) {
      // Short shorthand ("pe", "mi") must match a whole word, never a prefix ("Pediatric").
      const short = w.length <= 3;
      const word = new RegExp(`\\b${reEsc(w)}\\b`);
      if (short) {
        if (word.test(g._tl)) best = Math.max(best, 8);
        else if (word.test(g._hay)) best = Math.max(best, 2);
        continue;
      }
      if (g._tl.startsWith(w)) best = Math.max(best, 10);
      else if (new RegExp(`\\b${reEsc(w)}`).test(g._tl)) best = Math.max(best, 7);
      else if (g._tl.includes(w)) best = Math.max(best, 4);
      else if (g._hay.includes(w)) best = Math.max(best, 2);
    }
    if (!best) return 0;
    s += best;
  }
  // Ties go to current, major, EM-relevant, recent guidelines; blog posts rank below guidelines.
  if (!g.supersededBy) s += 2;
  s += { 1: 2, 1.5: 1, 2: 1, 3: -1 }[tier(g)] ?? 0;
  if (g.emRelevant) s += 1;
  if (g.lastPublished && daysAgo(g.lastPublished) < 5 * 365) s += 1;
  return s;
}

function highlight(text, groups) {
  let out = esc(text);
  if (!groups) return out;
  const words = [...new Set(groups.flat())].filter((w) => w.length > 1).sort((a, b) => b.length - a.length);
  if (!words.length) return out;
  const re = new RegExp(`(${words.map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return out.replace(re, '<mark>$1</mark>');
}

// ---------------------------------------------------------------- list rendering

function badgeFor(g) {
  if (DISCUSSION_BADGE[g.source]) return `<span class="tag blog ${g.source}">${DISCUSSION_BADGE[g.source]}</span>`;
  const a = guidelineAccess(g);
  return a === 'subscription' || a === 'members' ? '<span class="tag paywall">Paywall</span>' : '';
}

function itemHtml(g, groups, showCat = true, landmark = false) {
  const tags = g.settings.map((s) => `<span class="tag">${esc(s)}</span>`).join('');
  const hot = g.supersededBy ? '<span class="tag old">Older version</span>' : state.hot.has(g.id) ? '<span class="tag hot">Updated</span>' : '';
  const pop = g.population === 'Pediatric' ? '<span class="tag peds">Peds</span>' : '';
  const star = state.saved.has(g.id) ? '<span class="star" aria-label="Saved">★</span>' : '';
  const lm = landmark ? '<span class="tag landmark">Landmark · current</span>' : '';
  return `<li><button class="item ${landmark ? 'is-landmark' : ''}" data-id="${esc(g.id)}">
    <span class="body">
      <span class="t">${highlight(g.title, groups)} ${star}</span>
      <span class="sub">${lm}${badgeFor(g)}${pop}${tags}${hot}<span>${esc(showCat ? g.category : srcName(g.source))}</span><span class="date">${g.lastPublished ? fmtDate(g.lastPublished) : ''}</span></span>
      ${landmark && g.ai?.summary ? `<span class="lm-sum">${esc(g.ai.summary)}</span>` : ''}
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </button></li>`;
}

// The same guideline is often co-published (e.g. Circulation + JACC) and picked up by two
// sources. In lists, keep only the best-ranked copy: same year + same topic words.
function dedupeCopublished(items) {
  const seen = new Set();
  return items.filter((g) => {
    if (isDiscussion(g)) return true;
    const key = (g.lastPublished?.slice(0, 4) ?? '') + '|' + [...words(g.title.replace(/\(.*?\)/g, ''))].sort().join(' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const list = (items, groups, showCat = true, landmarkFirst = false) =>
  `<ul class="card-list">${items.map((g, i) => itemHtml(g, groups, showCat, landmarkFirst && i === 0 && !g.supersededBy && tier(g) <= 1.5)).join('')}</ul>`;

function render() {
  const all = state.data.guidelines;
  const scoped = all.filter((g) => bySetting(g) && bySource(g));
  const recentCount = scoped.filter((g) => state.hot.has(g.id) && !g.supersededBy).length;
  $('#recent-badge').hidden = !recentCount;
  $('#recent-badge').textContent = recentCount;
  $('#count').textContent = `${scoped.filter((g) => !g.supersededBy && !isDiscussion(g)).length} guidelines`;
  $('#cats').innerHTML = '';

  const groups = state.q ? expandQuery(state.q) : null;
  const el = $('#list');

  if (groups) {
    const hits = scoped.map((g) => [g, score(g, groups)]).filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || rankCompare(a[0], b[0])).map(([g]) => g);
    if (!hits.length) return empty(`No matches for “${esc(state.q)}”${state.setting !== 'ALL' ? ' in this setting — try <button class="chip" id="try-all">All settings</button>' : ''}.`);
    const guides = dedupeCopublished(hits.filter((g) => !isDiscussion(g)));
    const posts = hits.filter(isDiscussion);
    el.innerHTML = `<h2 class="group-h">${guides.length} guideline${guides.length === 1 ? '' : 's'}</h2>${guides.length ? list(guides, groups, true, true) : ''}` +
      (posts.length ? `<h2 class="group-h">${posts.length} RebelEM / ALiEM discussion${posts.length === 1 ? '' : 's'}</h2>${list(posts.slice(0, 40), groups)}` : '');
    return;
  }

  if (state.tab === 'topics') return state.topic ? renderTopic(scoped) : renderTopicIndex(scoped);

  if (state.tab === 'saved') {
    const pool = scoped.filter((g) => state.saved.has(g.id)).sort(rankCompare);
    return pool.length ? (el.innerHTML = list(pool)) : empty('No saved guidelines yet. Open one and tap ☆ Save.');
  }

  let pool = scoped.filter((g) => !g.supersededBy && (showDiscussions() || !isDiscussion(g)));

  if (state.tab === 'recent') {
    pool = pool.filter((g) => !isDiscussion(g) && g.lastPublished && daysAgo(g.lastPublished) <= RECENT_DAYS);
    if (!pool.length) return empty('Nothing revised in the last 90 days for these filters.');
    pool.sort((a, b) => (b.lastPublished ?? '').localeCompare(a.lastPublished ?? ''));
    const byMonth = groupBy(pool, (g) => new Date(g.lastPublished).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
    el.innerHTML = runsSummary() + Object.entries(byMonth).map(([m, gs]) => `<h2 class="group-h">Revised ${esc(m)}</h2>${list(gs)}`).join('');
    return;
  }

  // Browse: category chips, then each category with its landmark guideline first.
  const counts = {};
  pool.forEach((g) => (counts[g.category] = (counts[g.category] ?? 0) + 1));
  const names = Object.keys(counts).sort();
  if (state.cat && !counts[state.cat]) state.cat = null;
  const cats = $('#cats');
  cats.innerHTML = [`<button class="chip" data-c="" aria-pressed="${!state.cat}">All categories</button>`,
    ...names.map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}<span class="n">${counts[c]}</span></button>`)].join('');
  cats.onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.cat = b.dataset.c || null;
    render();
  };
  if (state.cat) pool = pool.filter((g) => g.category === state.cat);
  if (!pool.length) return empty('Nothing here for these filters.');
  const byCat = groupBy(pool, (g) => g.category);
  el.innerHTML = Object.keys(byCat).sort().map((c) => `<h2 class="group-h">${esc(c)}</h2>${list(dedupeCopublished(byCat[c].sort(rankCompare)), null, false, true)}`).join('');
}

function empty(msg) {
  $('#list').innerHTML = `<p class="empty">${msg}</p>`;
  $('#try-all')?.addEventListener('click', () => $('#settings .chip[data-v="ALL"]').click());
}

// ---------------------------------------------------------------- topics

function renderTopicIndex(scoped) {
  const counts = {};
  for (const g of scoped) for (const t of g.topics) {
    counts[t] ??= { guides: 0, posts: 0 };
    isDiscussion(g) ? counts[t].posts++ : counts[t].guides++;
  }
  const names = Object.keys(counts).filter((t) => t !== 'Other' && counts[t].guides).sort();
  if (!names.length) return empty('Topics appear once AI summaries have been generated (monthly refresh).');
  $('#list').innerHTML = `<p class="update-run">Each topic page lists the current landmark guideline first, then other guidelines and pathways, older versions, and RebelEM / ALiEM discussion.</p>
    <ul class="card-list">${names.map((t) => `<li><button class="item" data-topic="${esc(t)}"><span class="body"><span class="t">${esc(t)}</span>
      <span class="sub"><span>${counts[t].guides} guideline${counts[t].guides === 1 ? '' : 's'}</span>${counts[t].posts ? `<span>· ${counts[t].posts} discussion${counts[t].posts === 1 ? '' : 's'}</span>` : ''}</span></span><span class="chev">›</span></button></li>`).join('')}</ul>`;
}

function renderTopic(scoped) {
  const t = state.topic;
  const items = scoped.filter((g) => g.topics.includes(t));
  const guides = dedupeCopublished(items.filter((g) => !isDiscussion(g)).sort(rankCompare));
  const current = guides.filter((g) => !g.supersededBy);
  const older = guides.filter((g) => g.supersededBy);
  const posts = items.filter(isDiscussion).sort((a, b) => (b.lastPublished ?? '').localeCompare(a.lastPublished ?? ''));
  $('#list').innerHTML = `<button class="back" data-back>‹ All topics</button><h2 class="topic-h">${esc(t)}</h2>
    ${current.length ? `<h3 class="group-h">Guidelines &amp; pathways</h3>${list(current, null, true, true)}` : ''}
    ${posts.length ? `<h3 class="group-h">Discussion: RebelEM &amp; ALiEM</h3>${list(posts)}` : ''}
    ${older.length ? `<h3 class="group-h">Older versions</h3>${list(older)}` : ''}
    <div class="actions"><a class="btn" href="${uptodateUrl(t)}" target="_blank" rel="noopener">Search UpToDate: ${esc(t)} <span class="paywall-note">subscription</span></a></div>`;
}

// ---------------------------------------------------------------- cross-references

const STOP = new Set(['guideline', 'guidelines', 'american', 'association', 'society', 'college', 'management', 'patients', 'with', 'from', 'focused', 'update', 'clinical', 'practice', 'acute', 'adult', 'adults', 'the', 'and', 'for', 'of', 'in', 'on']);
const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

// RebelEM/ALiEM posts on the same topic; posts that name this guideline (same year + topic words) first.
function relatedDiscussion(g, limit = 6) {
  if (!g.topics.length) return [];
  const year = g.lastPublished?.slice(0, 4);
  const gw = words(g.title);
  return state.data.guidelines.filter((p) => isDiscussion(p) && p.topics.some((t) => g.topics.includes(t)))
    .map((p) => {
      let s = p.topics.filter((t) => g.topics.includes(t)).length * 2;
      const named = (p.ai?.discusses_guidelines ?? []).join(' ');
      if (named) {
        const nw = words(named);
        const overlap = [...gw].filter((w) => nw.has(w)).length;
        if (overlap >= 2) s += 4;
        if (year && named.includes(year)) s += 2;
      }
      if (p.lastPublished && daysAgo(p.lastPublished) < 3 * 365) s += 1;
      return [p, s];
    })
    .sort((a, b) => b[1] - a[1] || (b[0].lastPublished ?? '').localeCompare(a[0].lastPublished ?? ''))
    .slice(0, limit).map(([p]) => p);
}

function relatedGuidelines(p, limit = 6) {
  return state.data.guidelines.filter((g) => !isDiscussion(g) && !g.supersededBy && g.topics.some((t) => p.topics.includes(t)))
    .sort(rankCompare).slice(0, limit);
}

const uptodateUrl = (q) => `https://www.uptodate.com/contents/search?search=${encodeURIComponent(q)}`;

// ---------------------------------------------------------------- detail sheet

function aiBlock(g) {
  const ai = g.ai;
  if (ai?.summary) {
    return `<section class="ai">
      <div class="ai-h"><span class="tag ai-tag">AI summary</span><span class="muted small">${esc(ai.basis ? 'From ' + ai.basis : '')}</span></div>
      <p class="summary">${esc(ai.summary)}</p>
      ${ai.key_points?.length ? `<ul class="kp">${ai.key_points.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
      ${ai.limitations ? `<p class="limits">Limitations: ${esc(ai.limitations)}</p>` : ''}
      <p class="ai-warn">AI-generated by Claude from the source text. Check the source before you rely on it clinically.</p>
    </section>`;
  }
  const access = guidelineAccess(g);
  if (access === 'acep-signin') {
    return `<section class="ai none"><p><strong>No AI summary.</strong> ACEP policies are members-only and have no public abstract, so they aren't summarized. Open the policy with your ACEP sign-in below${relatedDiscussion(g).length ? ', and see the RebelEM / ALiEM discussion below' : ''}. Not signed in yet? <a href="${ACEP_SIGNIN}" target="_blank" rel="noopener">Sign in to ACEP</a>.</p></section>`;
  }
  if (access === 'members' || access === 'subscription') {
    return `<section class="ai none"><p><strong>No summary available.</strong> The full text is behind a paywall and the publisher provides no abstract, so there is nothing to summarize from. Use the source link below if you have access${relatedDiscussion(g).length ? ', or see the RebelEM / ALiEM discussion below' : ''}.</p></section>`;
  }
  return `${g.summary ? `<p class="summary"><span class="muted small">Source description:</span> ${esc(g.summary)}</p>` : ''}
    <p class="muted small">AI summary pending; it will be added at the next monthly refresh.</p>`;
}

function discussionCard(p) {
  const badge = DISCUSSION_BADGE[p.source];
  return `<details class="disc ${p.source}">
    <summary><span class="tag blog ${p.source}">${badge}</span> <span class="disc-t">${esc(p.title)}</span> <span class="muted small">${fmtDate(p.lastPublished)}</span></summary>
    ${p.ai?.summary ? `<p class="summary">${esc(p.ai.summary)}</p>${p.ai.key_points?.length ? `<ul class="kp">${p.ai.key_points.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
      <p class="ai-warn">AI summary of a ${badge} post. These are the authors' views, not a guideline.</p>` : `<p class="summary">${esc(p.summary)}</p>`}
    <a class="btn small-btn" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">Read on ${badge} ↗</a>
  </details>`;
}

function openFromUrl() {
  const m = location.hash.match(/^#g=(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]), false);
}

function openDetail(id, push) {
  const g = byId(id);
  if (!g) return;
  if (push) history.pushState(null, '', '#g=' + encodeURIComponent(id));
  const src = state.data.sources.find((s) => s.id === g.source);
  const disc = isDiscussion(g);
  const access = guidelineAccess(g);
  const accessInfo = disc ? null : ACCESS[access];

  const docs = g.documents.map((d, i) => {
    const a = docAccess(d, g);
    const label = i === 0 && /pdf/i.test(d.label) ? 'Open pathway PDF' : d.label;
    return `<a class="btn ${i === 0 ? 'primary' : ''}" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(label)}${docNote[a] ? `<span class="paywall-note">${docNote[a].replace(' · ', '')}</span>` : ''}</a>`;
  }).join('');
  const siblings = state.data.guidelines.filter((x) => x.id !== g.id && x.source === g.source && x.title.toLowerCase() === g.title.toLowerCase());
  const newer = g.supersededBy && byId(g.supersededBy);
  const sourceBtn = g.documents.some((d) => d.url === g.sourceUrl) ? '' : `<a class="btn" href="${esc(g.sourceUrl)}" target="_blank" rel="noopener">Source page</a>`;
  const topics = g.topics.filter((t) => t !== 'Other');
  const related = disc ? relatedGuidelines(g) : relatedDiscussion(g);

  $('#detail').innerHTML = `
    <h2>${esc(g.title)}</h2>
    ${g.fullTitle ? `<p class="full-title">${esc(g.fullTitle)}</p>` : ''}
    <div class="meta-row">${disc ? `<span class="tag blog ${g.source}">${DISCUSSION_BADGE[g.source]} discussion</span>` : ''}
      ${g.settings.map((s) => `<span class="tag">${esc(SETTING_LABELS[s] ?? s)}</span>`).join('')}
      ${state.hot.has(g.id) ? '<span class="tag hot">Recently updated</span>' : ''}</div>
    <div class="meta-row" style="margin-top:8px">${esc(g.category)} · ${esc(src?.name ?? g.source)}${g.publishedIn ? ` · ${esc(g.publishedIn)}` : ''}${g.population ? ` · ${esc(g.population)}` : ''} · ${g.lastPublished ? (disc ? 'Posted ' : 'Published/revised ') + fmtDate(g.lastPublished) : 'Date not listed'}</div>
    ${accessInfo ? `<div class="access ${accessInfo.cls}">${esc(accessInfo.label)}</div>` : ''}
    ${newer ? `<div class="newer">A newer version exists: <button class="linkish" data-id="${esc(newer.id)}">${esc(newer.title)}</button></div>` : ''}
    ${topics.length ? `<div class="topic-chips">${topics.map((t) => `<button class="chip" data-topic="${esc(t)}">${esc(t)} ›</button>`).join('')}</div>` : ''}
    ${aiBlock(g)}
    <div class="actions">
      ${docs}
      ${sourceBtn}
      ${disc ? '' : `<a class="btn" href="${uptodateUrl(topics[0] || g.title.replace(/\(\d{4}.*?\)/, ''))}" target="_blank" rel="noopener">Search UpToDate <span class="paywall-note">subscription</span></a>`}
      <button class="btn" data-star="${esc(g.id)}">${state.saved.has(g.id) ? '★ Saved' : '☆ Save'}</button>
    </div>
    ${!disc && related.length ? `<div class="related"><h3>Discussion: RebelEM &amp; ALiEM</h3>${related.map(discussionCard).join('')}</div>` : ''}
    ${disc && related.length ? `<div class="related"><h3>Related guidelines</h3>${list(related, null, true, true)}</div>` : ''}
    ${siblings.length ? `<div class="related"><h3>Other settings</h3>${list(siblings)}</div>` : ''}`;
  const d = $('#sheet');
  if (!d.open) d.showModal();
  d.querySelector('.sheet-inner').scrollTop = 0;
}

function closeSheet() {
  if (location.hash.startsWith('#g=')) history.back();
  else $('#sheet').close();
}

function toggleSaved(id) {
  state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
  save('saved', [...state.saved]);
  const b = $(`[data-star="${CSS.escape(id)}"]`);
  if (b) b.textContent = state.saved.has(id) ? '★ Saved' : '☆ Save';
  render();
}

function runsSummary() {
  const r = state.changelog?.runs?.find((x) => x.added.length || x.updated.length || x.removed.length);
  if (!r) return `<p class="update-run">Guidelines revised by the source in the last ${RECENT_DAYS} days (from document dates).</p>`;
  const parts = [r.added.length && `${r.added.length} new`, r.updated.length && `${r.updated.length} updated`, r.removed.length && `${r.removed.length} retired`].filter(Boolean).join(', ');
  return `<p class="update-run">Last change detected ${fmtDate(r.date)}: ${parts}. Below: guidelines revised in the last ${RECENT_DAYS} days.</p>`;
}

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => ((acc[fn(x)] ??= []).push(x), acc), {});
}

init();
