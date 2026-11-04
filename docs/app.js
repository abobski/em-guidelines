const $ = (s) => document.querySelector(s);
const esc = (s = '') => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SETTING_LABELS = { ED: 'ED', UC: 'Urgent Care', IP: 'Inpatient', NICU: 'NICU', OP: 'Outpatient', Surgery: 'Surgery', BHP: 'Behavioral' };
const SETTING_ORDER = ['ED', 'UC', 'IP', 'NICU', 'OP', 'Surgery', 'BHP'];
const RECENT_DAYS = 90;
const HOT_DAYS = 45;

// Common EM shorthand -> words that appear in titles/summaries.
const SYNONYMS = {
  dka: 'diabetic ketoacidosis', uti: 'urinary tract infection', nat: 'non-accidental trauma abuse',
  abuse: 'non-accidental trauma', ssti: 'skin soft tissue infection', cellulitis: 'skin soft tissue infection',
  abscess: 'skin soft tissue infection', cap: 'community acquired pneumonia', pna: 'pneumonia',
  pe: 'pulmonary embolism', apap: 'acetaminophen', tylenol: 'acetaminophen', tox: 'ingestion poisoning overdose',
  aom: 'acute otitis media', ear: 'otitis', gi: 'gastroenteritis', age: 'acute gastroenteritis dehydration',
  vomiting: 'emesis gastroenteritis', fever: 'febrile', sbi: 'febrile infant neonate', neonate: 'neonate infant',
  cspine: 'cervical spine', 'c-spine': 'cervical spine', tbi: 'concussion head', head: 'concussion intracranial',
  sz: 'seizure', se: 'status epilepticus', status: 'status epilepticus', rsi: 'rsi intubation', intubation: 'rsi',
  sedation: 'procedural sedation', anaphylaxis: 'anaphylaxis allergic', allergy: 'anaphylaxis', ped: 'pediatric',
  aub: 'abnormal uterine bleeding', pid: 'pelvic inflammatory disease', sti: 'sexually transmitted infection',
  std: 'sexually transmitted infection', hyperk: 'hyperkalemia', k: 'hyperkalemia', ich: 'intracranial',
  stroke: 'stroke neurologic deterioration', iron: 'iron deficiency anemia', kd: 'kawasaki', misc: 'mis-c',
  ptx: 'pneumothorax', sbo: 'small bowel obstruction', intuss: 'intussusception', appy: 'appendicitis',
  fb: 'foreign body', globe: 'open globe', eye: 'globe', sepsis: 'sepsis', shock: 'sepsis',
};

const state = {
  data: null,
  tab: 'browse',
  q: '',
  setting: load('setting', 'EM'),
  cat: null,
  saved: new Set(load('saved', [])),
  hot: new Set(),
};

function load(k, d) {
  try { const v = localStorage.getItem('emg:' + k); return v ? JSON.parse(v) : d; } catch { return d; }
}
function save(k, v) {
  try { localStorage.setItem('emg:' + k, JSON.stringify(v)); } catch {}
}

const daysAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const res = await fetch('data/guidelines.json', { cache: 'no-cache' });
    state.data = await res.json();
  } catch {
    $('#list').innerHTML = '<p class="empty">Could not load guidelines. Connect once to download them for offline use.</p>';
    return;
  }
  let changelog = { runs: [] };
  try { changelog = await (await fetch('data/changelog.json', { cache: 'no-cache' })).json(); } catch {}
  state.changelog = changelog;

  const latest = changelog.runs[0];
  const changedNow = new Set([...(latest?.added ?? []), ...(latest?.updated ?? [])].map((x) => x.id));
  for (const g of state.data.guidelines) {
    g._hay = [g.title, g.summary, g.category, g.settings.join(' '), ...g.settings.map((s) => SETTING_LABELS[s] ?? s)].join(' ').toLowerCase();
    g._tl = g.title.toLowerCase();
    if (changedNow.has(g.id) || (g.lastPublished && daysAgo(g.lastPublished) <= HOT_DAYS)) state.hot.add(g.id);
  }

  renderSettings();
  bind();
  render();
  openFromUrl();

  const src = state.data.sources.map((s) => `<a href="${esc(s.homepage)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(', ');
  $('#meta').innerHTML = `Last refreshed ${fmtDate(state.data.generated)} · Sources: ${src}`;
}

function bind() {
  const q = $('#q');
  q.addEventListener('input', () => { state.q = q.value.trim(); $('#clear').hidden = !state.q; render(); });
  $('#clear').addEventListener('click', () => { q.value = ''; state.q = ''; $('#clear').hidden = true; render(); q.focus(); });
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
      render();
      window.scrollTo({ top: 0 });
    }));
  $('#list').addEventListener('click', onItemClick);
  $('#detail').addEventListener('click', onItemClick);
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet();
    const star = e.target.closest('[data-star]');
    if (star) toggleSaved(star.dataset.star);
  });
  $('#sheet').addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  window.addEventListener('popstate', () => { if (!location.hash.startsWith('#g=') && $('#sheet').open) $('#sheet').close(); else openFromUrl(); });
}

function onItemClick(e) {
  const el = e.target.closest('[data-id]');
  if (el) openDetail(el.dataset.id, true);
}

function renderSettings() {
  const present = new Set(state.data.guidelines.flatMap((g) => g.settings));
  const opts = [['EM', 'ED + UC'], ['ALL', 'All'], ...SETTING_ORDER.filter((s) => present.has(s)).map((s) => [s, SETTING_LABELS[s]])];
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

function bySetting(g) {
  if (state.setting === 'ALL') return true;
  if (state.setting === 'EM') return g.emRelevant;
  return g.settings.includes(state.setting);
}

function expandQuery(q) {
  const words = q.toLowerCase().split(/[\s,/]+/).filter(Boolean);
  return words.map((w) => [w, ...(SYNONYMS[w] ? SYNONYMS[w].split(' ') : [])]);
}

function score(g, groups) {
  let s = 0;
  for (const alts of groups) {
    let best = 0;
    for (const w of alts) {
      if (g._tl.startsWith(w)) best = Math.max(best, 10);
      else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(g._tl)) best = Math.max(best, 7);
      else if (g._tl.includes(w)) best = Math.max(best, 4);
      else if (g._hay.includes(w)) best = Math.max(best, 2);
    }
    if (!best) return 0;
    s += best;
  }
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

function itemHtml(g, groups, showCat = true) {
  const tags = g.settings.map((s) => `<span class="tag">${esc(s)}</span>`).join('');
  const hot = state.hot.has(g.id) ? '<span class="tag hot">Updated</span>' : '';
  const star = state.saved.has(g.id) ? '<span class="star" aria-label="Saved">★</span>' : '';
  return `<li><button class="item" data-id="${esc(g.id)}">
    <span class="body">
      <span class="t">${highlight(g.title, groups)} ${star}</span>
      <span class="sub">${tags}${hot}${showCat ? `<span>${esc(g.category)}</span>` : ''}<span class="date">Rev. ${fmtDate(g.lastPublished)}</span></span>
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </button></li>`;
}

const list = (items, groups, showCat = true) => `<ul class="card-list">${items.map((g) => itemHtml(g, groups, showCat)).join('')}</ul>`;

function render() {
  const all = state.data.guidelines;
  const scoped = all.filter(bySetting);
  const recentCount = scoped.filter((g) => state.hot.has(g.id)).length;
  $('#recent-badge').hidden = !recentCount;
  $('#recent-badge').textContent = recentCount;

  let pool = scoped;
  if (state.tab === 'saved') pool = scoped.filter((g) => state.saved.has(g.id));
  if (state.tab === 'recent') pool = scoped.filter((g) => g.lastPublished && daysAgo(g.lastPublished) <= RECENT_DAYS);

  const groups = state.q ? expandQuery(state.q) : null;
  if (groups) pool = pool.map((g) => [g, score(g, groups)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].title.localeCompare(b[0].title)).map(([g]) => g);

  // Category chips (browse tab, no active search)
  const cats = $('#cats');
  if (state.tab === 'browse' && !groups) {
    const counts = {};
    scoped.forEach((g) => (counts[g.category] = (counts[g.category] ?? 0) + 1));
    const names = Object.keys(counts).sort();
    if (state.cat && !counts[state.cat]) state.cat = null;
    cats.innerHTML = [`<button class="chip" data-c="" aria-pressed="${!state.cat}">All categories</button>`,
      ...names.map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}<span class="n">${counts[c]}</span></button>`)].join('');
    cats.onclick = (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.c || null;
      render();
    };
    if (state.cat) pool = pool.filter((g) => g.category === state.cat);
  } else {
    cats.innerHTML = '';
  }

  $('#count').textContent = `${scoped.length} pathways`;
  const el = $('#list');

  if (!pool.length) {
    const msg = state.tab === 'saved' && !state.q
      ? 'No saved pathways yet. Open one and tap ☆ Save.'
      : state.q ? `No matches for “${esc(state.q)}”${state.setting !== 'ALL' ? ' in this setting — try <button class="chip" id="try-all">All settings</button>' : ''}.` : 'Nothing here yet.';
    el.innerHTML = `<p class="empty">${msg}</p>`;
    $('#try-all')?.addEventListener('click', () => $('#settings .chip[data-v="ALL"]').click());
    return;
  }

  if (groups) {
    el.innerHTML = `<h2 class="group-h">${pool.length} result${pool.length === 1 ? '' : 's'}</h2>` + list(pool, groups);
  } else if (state.tab === 'recent') {
    pool.sort((a, b) => (b.lastPublished ?? '').localeCompare(a.lastPublished ?? ''));
    const byMonth = groupBy(pool, (g) => new Date(g.lastPublished).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    el.innerHTML = runsSummary() + Object.entries(byMonth).map(([m, gs]) => `<h2 class="group-h">Revised ${esc(m)}</h2>${list(gs)}`).join('');
  } else {
    const byCat = groupBy(pool, (g) => g.category);
    el.innerHTML = Object.keys(byCat).sort().map((c) => `<h2 class="group-h">${esc(c)}</h2>${list(byCat[c], null, false)}`).join('');
  }
}

function runsSummary() {
  const r = state.changelog?.runs?.find((x) => x.added.length || x.updated.length || x.removed.length);
  if (!r) return `<p class="update-run">Pathways revised by the source in the last ${RECENT_DAYS} days (from document dates).</p>`;
  const parts = [r.added.length && `${r.added.length} new`, r.updated.length && `${r.updated.length} updated`, r.removed.length && `${r.removed.length} retired`].filter(Boolean).join(', ');
  return `<p class="update-run">Last change detected ${fmtDate(r.date)}: ${parts}. Below: pathways revised in the last ${RECENT_DAYS} days.</p>`;
}

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => ((acc[fn(x)] ??= []).push(x), acc), {});
}

function openFromUrl() {
  const m = location.hash.match(/^#g=(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]), false);
}

function openDetail(id, push) {
  const g = state.data.guidelines.find((x) => x.id === id);
  if (!g) return;
  if (push) history.pushState(null, '', '#g=' + encodeURIComponent(id));
  const src = state.data.sources.find((s) => s.id === g.source);
  const docs = g.documents.map((d, i) =>
    `<a class="btn ${i === 0 ? 'primary' : ''}" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(i === 0 ? 'Open pathway PDF' : d.label)}</a>`).join('');
  const siblings = state.data.guidelines.filter((x) => x.id !== g.id && x.title.toLowerCase() === g.title.toLowerCase());
  $('#detail').innerHTML = `
    <h2>${esc(g.title)}</h2>
    <div class="meta-row">${g.settings.map((s) => `<span class="tag">${esc(SETTING_LABELS[s] ?? s)}</span>`).join('')}
      ${state.hot.has(g.id) ? '<span class="tag hot">Recently updated</span>' : ''}</div>
    <div class="meta-row" style="margin-top:8px">${esc(g.category)} · ${esc(src?.name ?? g.source)} · Revised ${fmtDate(g.lastPublished)}</div>
    ${g.summary ? `<p class="summary">${esc(g.summary)}</p>` : ''}
    <div class="actions">
      ${docs}
      <a class="btn" href="${esc(g.sourceUrl)}" target="_blank" rel="noopener">Source page</a>
      <button class="btn" data-star="${esc(g.id)}">${state.saved.has(g.id) ? '★ Saved' : '☆ Save'}</button>
    </div>
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

init();
