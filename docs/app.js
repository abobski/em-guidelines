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
  tab: 'browse',
  q: '',
  setting: load('setting', 'EM'),
  src: load('src', 'ALL'),
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
  renderSources();
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
  el.innerHTML = opts.map(([v, l]) => `<button class="chip ${v === 'Adult' || v === 'Pediatric' ? 'pop' : ''}" data-v="${esc(v)}" aria-pressed="${state.src === v}">${esc(l)}</button>`).join('');
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
  if (state.src === 'Adult' || state.src === 'Pediatric') return g.population === state.src;
  return g.source === state.src;
}

const srcName = (id) => state.data.sources.find((s) => s.id === id)?.name ?? id;

function bySetting(g) {
  if (state.setting === 'ALL') return true;
  if (state.setting === 'EM') return g.emRelevant;
  return g.settings.includes(state.setting);
}

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
  // Prefer current, EM-relevant, recent guidelines when relevance ties.
  if (!g.supersededBy) s += 2;
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

function itemHtml(g, groups, showCat = true) {
  const tags = g.settings.map((s) => `<span class="tag">${esc(s)}</span>`).join('');
  const hot = g.supersededBy ? '<span class="tag old">Older version</span>' : state.hot.has(g.id) ? '<span class="tag hot">Updated</span>' : '';
  const pop = g.population === 'Pediatric' ? '<span class="tag peds">Peds</span>' : '';
  const star = state.saved.has(g.id) ? '<span class="star" aria-label="Saved">★</span>' : '';
  return `<li><button class="item" data-id="${esc(g.id)}">
    <span class="body">
      <span class="t">${highlight(g.title, groups)} ${star}</span>
      <span class="sub">${pop}${tags}${hot}<span>${esc(showCat ? g.category : srcName(g.source))}</span><span class="date">${g.lastPublished ? fmtDate(g.lastPublished) : ''}</span></span>
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </button></li>`;
}

const list = (items, groups, showCat = true) => `<ul class="card-list">${items.map((g) => itemHtml(g, groups, showCat)).join('')}</ul>`;

function render() {
  const all = state.data.guidelines;
  const scoped = all.filter((g) => bySetting(g) && bySource(g));
  const recentCount = scoped.filter((g) => state.hot.has(g.id) && !g.supersededBy).length;
  $('#recent-badge').hidden = !recentCount;
  $('#recent-badge').textContent = recentCount;

  // Older versions of a guideline only show up in search results (and Saved).
  let pool = state.q || state.tab === 'saved' ? scoped : scoped.filter((g) => !g.supersededBy);
  if (state.tab === 'saved') pool = scoped.filter((g) => state.saved.has(g.id));
  if (state.tab === 'recent') pool = pool.filter((g) => g.lastPublished && daysAgo(g.lastPublished) <= RECENT_DAYS);

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

  $('#count').textContent = `${scoped.filter((g) => !g.supersededBy).length} guidelines`;
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
    const byMonth = groupBy(pool, (g) => new Date(g.lastPublished).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }));
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
    `<a class="btn ${i === 0 ? 'primary' : ''}" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(i === 0 && /pdf/i.test(d.label) ? 'Open pathway PDF' : d.label)}</a>`).join('');
  const siblings = state.data.guidelines.filter((x) => x.id !== g.id && x.source === g.source && x.title.toLowerCase() === g.title.toLowerCase());
  const newer = g.supersededBy && state.data.guidelines.find((x) => x.id === g.supersededBy);
  const sourceBtn = g.documents.some((d) => d.url === g.sourceUrl) ? '' : `<a class="btn" href="${esc(g.sourceUrl)}" target="_blank" rel="noopener">Source page</a>`;
  $('#detail').innerHTML = `
    <h2>${esc(g.title)}</h2>
    ${g.fullTitle ? `<p class="full-title">${esc(g.fullTitle)}</p>` : ''}
    <div class="meta-row">${g.settings.map((s) => `<span class="tag">${esc(SETTING_LABELS[s] ?? s)}</span>`).join('')}
      ${state.hot.has(g.id) ? '<span class="tag hot">Recently updated</span>' : ''}</div>
    <div class="meta-row" style="margin-top:8px">${esc(g.category)} · ${esc(src?.name ?? g.source)}${g.publishedIn ? ` · ${esc(g.publishedIn)}` : ''}${g.population ? ` · ${esc(g.population)}` : ''} · ${g.lastPublished ? 'Published/revised ' + fmtDate(g.lastPublished) : 'Date not listed'}</div>
    ${newer ? `<div class="newer">A newer version exists: <button class="linkish" data-id="${esc(newer.id)}">${esc(newer.title)}</button></div>` : ''}
    ${g.summary ? `<p class="summary">${esc(g.summary)}</p>` : ''}
    <div class="actions">
      ${docs}
      ${sourceBtn}
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
