'use strict';
/* ===== CONFIG ===== */
const CONFIG = {
  MONETAG_ZONE_ID: '',   // SETUP PLACEHOLDER: main zone ID (digits) from the Monetag dashboard. Empty = ads "unavailable".
  AD_MODE: 'sdk',        // 'sdk' = Monetag Rewarded Interstitial (reward only on reward_event_type 'valued') | 'smartlink' = sponsor redirect, unverified
  SMARTLINK_URL: '',     // SETUP PLACEHOLDER: your Monetag Direct Link / SmartLink (HTTPS) from the dashboard
  MOCK_MODE: false,      // DEV ONLY. Never unlocks a video. Keep false in production.
  TIMEZONE: 'Asia/Kolkata', // release dates (YYYY-MM-DD) switch on at 00:00 in this timezone
  ALLOWED_MEGA_HOSTS: ['mega.nz', 'mega.io'],
  CATALOGUE_URL: './videos.json'
};

const $ = (s) => document.querySelector(s);
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');
const state = { videos: [], filter: 'All', q: '', selectedId: null, busy: false, saved: new Set(), view: 'home' };
let lastFocus = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/* ===== URL validation ===== */
function parseHttps(s) {
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; }
}
function validMega(s) {
  const u = parseHttps(s);
  if (!u || !CONFIG.ALLOWED_MEGA_HOSTS.includes(u.hostname)) return null;
  const modern = /^\/(file|folder)\/[\w-]{8}$/.test(u.pathname) && u.hash.length > 1;
  const legacy = u.pathname === '/' && /^#F?![\w-]{8}![\w-]+/.test(u.hash);
  return modern || legacy ? u : null;
}

/* ===== Catalogue ===== */
function todayString(res) {
  let t = Date.now(); // prefer SERVER time (Date header) over the device clock, which users can change
  const h = res && res.headers.get('date'), s = h && Date.parse(h);
  if (s) t = s;
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
function normalise(raw, today) {
  const seen = new Set(), out = [];
  if (!Array.isArray(raw)) throw new Error('videos.json must be an array');
  for (const e of raw) {
    if (!e || typeof e !== 'object' || e.published !== true) continue;
    const ok = ['id', 'title', 'category'].every((k) => typeof e[k] === 'string' && e[k].trim());
    if (!ok || seen.has(e.id) || !parseHttps(e.thumbnail) || !validMega(e.megaUrl)) { console.warn('Skipped entry', e && e.id); continue; }
    if (e.date !== undefined && (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || isNaN(Date.parse(e.date)))) { console.warn('Bad date, skipped', e.id); continue; }
    if (e.date && e.date > today) continue; // scheduled for the future: hidden until its date
    seen.add(e.id);
    out.push({ date: e.date || '',
      id: e.id, title: e.title.trim(), category: e.category.trim(), thumbnail: e.thumbnail, megaUrl: e.megaUrl,
      description: typeof e.description === 'string' ? e.description : '',
      duration: typeof e.duration === 'string' && /^\d{1,2}(:\d{2}){1,2}$/.test(e.duration) ? e.duration : '',
      tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string').map((t) => t.toLowerCase()) : []
    });
  }
  return out.map((v, i) => [v, i]).sort((x, y) => (y[0].date.localeCompare(x[0].date)) || (x[1] - y[1])).map((p) => p[0]); // newest first; undated last
}
async function loadCatalogue() {
  showSkeleton();
  try {
    const res = await fetch(CONFIG.CATALOGUE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.videos = normalise(await res.json(), todayString(res));
    renderHome();
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    resumePending(!!(nav && nav.type === 'back_forward'));
  } catch (err) {
    console.error(err);
    $('#grid').replaceChildren();
    showState('#state', navigator.onLine ? 'Could not load the catalogue.' : 'You appear to be offline.', true);
  }
}

/* ===== Rendering ===== */
function showState(sel, msg, retry) {
  const s = $(sel); s.replaceChildren(el('p', '', msg)); s.hidden = false;
  if (retry) { const b = el('button', 'btn', 'Retry'); b.type = 'button'; b.addEventListener('click', loadCatalogue); s.append(b); }
}
function showSkeleton() {
  $('#state').hidden = true;
  const g = $('#grid'); g.replaceChildren();
  for (let i = 0; i < 6; i++) g.append(el('div', 'skel'));
}
function card(v) {
  const b = el('button', 'card'); b.type = 'button'; b.dataset.id = v.id;
  const t = el('div', 'thumb'), img = el('img'); img.loading = 'lazy'; img.alt = 'Thumbnail for ' + v.title; img.src = v.thumbnail;
  img.addEventListener('error', () => { img.src = 'assets/placeholder.svg'; }, { once: true });
  t.append(img);
  if (v.duration) t.append(el('span', 'dur', v.duration));
  const p = el('span', 'play', '▶'); p.setAttribute('aria-hidden', 'true'); t.append(p);
  const i = el('div', 'info'); i.append(el('div', 'title', v.title), el('div', 'cat', v.category));
  b.append(t, i);
  b.addEventListener('click', () => openModal(v.id, b));
  return b;
}
function chipList() {
  const l = ['All'];
  if (state.videos.some((v) => v.tags.includes('trending'))) l.push('Trending');
  if (state.videos.some((v) => v.tags.includes('latest'))) l.push('Latest');
  state.videos.forEach((v) => { if (!l.includes(v.category)) l.push(v.category); });
  return l;
}
function matches(v) {
  const f = state.filter;
  if (f === 'Trending' && !v.tags.includes('trending')) return false;
  if (f === 'Latest' && !v.tags.includes('latest')) return false;
  if (f !== 'All' && f !== 'Trending' && f !== 'Latest' && v.category !== f) return false;
  const q = state.q.trim().toLowerCase();
  return !q || (v.title + ' ' + v.description + ' ' + v.category).toLowerCase().includes(q);
}
function renderHome() {
  const chips = $('#chips'); chips.replaceChildren();
  chipList().forEach((c) => {
    const b = el('button', 'chip', c); b.type = 'button'; b.setAttribute('aria-pressed', String(c === state.filter));
    b.addEventListener('click', () => { state.filter = c; renderHome(); });
    chips.append(b);
  });
  const list = state.videos.filter(matches), g = $('#grid'); g.replaceChildren(...list.map(card));
  if (!state.videos.length) showState('#state', 'No videos available yet.');
  else if (!list.length) showState('#state', 'No results. Try a different search or category.');
  else $('#state').hidden = true;
}
function renderCategories() {
  const l = $('#catList'); l.replaceChildren();
  chipList().filter((c) => c !== 'All').forEach((c) => {
    const n = state.videos.filter((v) => (c === 'Trending' || c === 'Latest') ? v.tags.includes(c.toLowerCase()) : v.category === c).length;
    const b = el('button', '', c); b.type = 'button'; b.append(el('span', 'muted', String(n)));
    b.addEventListener('click', () => { state.filter = c; showView('home'); });
    l.append(b);
  });
}
function renderSaved() {
  const list = state.videos.filter((v) => state.saved.has(v.id));
  $('#savedGrid').replaceChildren(...list.map(card));
  if (list.length) $('#savedState').hidden = true; else showState('#savedState', 'Nothing saved yet.');
}
function showView(name) {
  state.view = name;
  ['home', 'categories', 'saved', 'settings'].forEach((n) => { $('#view-' + n).hidden = n !== name; });
  document.querySelectorAll('.bottomnav button').forEach((b) => {
    const on = b.dataset.view === name; b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (name === 'home') renderHome();
  if (name === 'categories') renderCategories();
  if (name === 'saved') renderSaved();
  window.scrollTo(0, 0);
}

/* ===== Modal ===== */
function setStatus(kind, content) {
  const s = $('#status'); s.className = 'status ' + (kind || ''); s.replaceChildren();
  if (content) s.append(content);
}
const txt = (t) => document.createTextNode(t);
function openModal(id, trigger) {
  const v = state.videos.find((x) => x.id === id); if (!v) return;
  state.selectedId = id; lastFocus = trigger || document.activeElement;
  $('#mImg').src = v.thumbnail; $('#mImg').alt = 'Thumbnail for ' + v.title;
  $('#mImg').onerror = () => { $('#mImg').src = 'assets/placeholder.svg'; };
  $('#mTitle').textContent = v.title; $('#mCat').textContent = v.category;
  $('#mDesc').textContent = v.description || 'No description.';
  $('#watchBtn').textContent = 'Watch Video'; setStatus('');
  syncSave();
  $('#modal').hidden = false; document.body.classList.add('lock'); $('#mClose').focus();
  if (inTelegram && tg.BackButton) { try { tg.BackButton.show(); tg.BackButton.onClick(closeModal); } catch { /* optional */ } }
}
function closeModal() {
  $('#modal').hidden = true; document.body.classList.remove('lock');
  if (inTelegram && tg.BackButton) { try { tg.BackButton.offClick(closeModal); tg.BackButton.hide(); } catch { /* optional */ } }
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function syncSave() {
  const on = state.saved.has(state.selectedId), b = $('#saveBtn');
  b.textContent = on ? 'Saved ✓' : 'Save'; b.setAttribute('aria-pressed', String(on));
}
function toggleSave() {
  const id = state.selectedId; if (!id) return;
  state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
  store.set('cinegrid.saved', JSON.stringify([...state.saved])); syncSave();
  if (state.view === 'saved') renderSaved();
}
function trapFocus(e) {
  if ($('#modal').hidden) return;
  if (e.key === 'Escape') return closeModal();
  if (e.key !== 'Tab') return;
  const f = [...$('#modal').querySelectorAll('button:not([disabled])')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ===== Rewarded ad adapter (internal abstraction, NOT an official Monetag function) =====
   Real path uses the documented Monetag SDK global show_<MAIN_ZONE_ID>({ ymid }).
   Per docs.monetag.com the promise ALSO resolves when the user closes the ad early, so a reward is granted only when
   result.reward_event_type === 'valued'. Returns { status: 'rewarded'|'not_rewarded'|'unavailable'|'error', mock? } */
async function runRewardedAd() {
  if (CONFIG.MOCK_MODE) {
    await sleep(800);
    const o = new URLSearchParams(location.search).get('mock') || 'valued';
    const map = { valued: 'rewarded', not_valued: 'not_rewarded', unavailable: 'unavailable', reject: 'error' };
    return { status: map[o] || 'error', mock: true };
  }
  if (!/^\d+$/.test(CONFIG.MONETAG_ZONE_ID)) return { status: 'unavailable', reason: 'zone' };
  const fn = window['show_' + CONFIG.MONETAG_ZONE_ID];
  if (typeof fn !== 'function') return { status: 'unavailable', reason: 'sdk' };
  try {
    const res = await fn({ ymid: newId() });
    return res && res.reward_event_type === 'valued' ? { status: 'rewarded' } : { status: 'not_rewarded' };
  } catch (e) { return { status: 'error' }; }
}

function goToMega(u, msg) {
  store.set('cinegrid.pending', '');
  const a = el('a', '', 'Continue to MEGA'); a.href = u.href; a.rel = 'noopener noreferrer'; // same context: no target=_blank
  setStatus('ok', null);
  $('#status').append(txt((msg || 'Reward confirmed. Opening the video on MEGA…') + ' If nothing happens: '), a);
  window.location.assign(u.href);
}

async function onWatch() {
  if (state.busy) return;
  const v = state.videos.find((x) => x.id === state.selectedId), mega = v && validMega(v.megaUrl);
  if (!mega) return setStatus('error', txt('This video link is invalid, so it was not opened.'));
  if (CONFIG.AD_MODE === 'smartlink') {
    const s = parseHttps(CONFIG.SMARTLINK_URL);
    if (!s) return setStatus('error', txt('The sponsor link is not configured, so the video stays locked.'));
    store.set('cinegrid.pending', JSON.stringify({ id: v.id, t: Date.now() }));
    setStatus('', txt('Opening the sponsor page… come back here to continue to the video.'));
    window.location.assign(s.href); // same context, user-initiated
    return;
  }
  state.busy = true; $('#watchBtn').disabled = true; setStatus('', txt('Loading advertisement…'));
  const r = await runRewardedAd();
  state.busy = false; $('#watchBtn').disabled = false;
  if (r.status === 'rewarded') {
    if (r.mock) return setStatus('ok', txt('TEST MODE — simulated reward. The video was NOT opened.'));
    return goToMega(mega);
  }
  $('#watchBtn').textContent = 'Try again';
  const m = {
    not_rewarded: 'The ad was not completed, so no reward was granted. You can try again.',
    unavailable: r.reason === 'zone' ? 'Ads are not configured yet (missing Monetag zone ID). The video stays locked.' :
      r.reason === 'sdk' ? 'The ad SDK did not load (missing script, blocked, or offline). The video stays locked.' :
      'No ad is available right now. Please try again later.',
    error: 'The ad failed to load or show. The video stays locked. You can try again.'
  };
  setStatus('error', txt((r.mock ? 'TEST MODE — ' : '') + m[r.status]));
}

/* Direct-link mode: after returning from the sponsor page, continue to the MEGA link saved before leaving. */
let resuming = false;
function resumePending(auto) {
  if (resuming) return;
  let p = null;
  try { p = JSON.parse(store.get('cinegrid.pending', 'null')); } catch { p = null; }
  if (!p || Date.now() - p.t > 30 * 60 * 1000) { store.set('cinegrid.pending', ''); return; }
  const v = state.videos.find((x) => x.id === p.id), m = v && validMega(v.megaUrl);
  if (!m) { store.set('cinegrid.pending', ''); return; }
  resuming = true; openModal(v.id);
  const go = el('a', '', 'Continue to MEGA'); go.href = m.href; go.rel = 'noopener noreferrer';
  go.addEventListener('click', () => store.set('cinegrid.pending', ''));
  const cancel = el('button', 'btn ghost', 'Cancel'); cancel.type = 'button';
  let timer = 0;
  cancel.addEventListener('click', () => { clearTimeout(timer); store.set('cinegrid.pending', ''); resuming = false; setStatus(''); });
  setStatus('ok', null);
  $('#status').append(txt(auto ? 'Welcome back. Opening the video on MEGA… ' : 'Welcome back. Tap to continue: '), go, txt(' '), cancel);
  if (auto) timer = setTimeout(() => { store.set('cinegrid.pending', ''); window.location.assign(m.href); }, 1500);
}

/* ===== Init ===== */
function applyTheme() {
  const p = store.get('cinegrid.theme', 'auto');
  const t = p !== 'auto' ? p : (tg && inTelegram && tg.colorScheme) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = t; $('#themeSel').value = p;
}
function init() {
  if (tg) { try { tg.ready(); tg.expand(); } catch { /* browser preview */ } }
  $('#testBanner').hidden = !CONFIG.MOCK_MODE;
  if (CONFIG.AD_MODE === 'smartlink') $('#notice').textContent = 'Tapping Watch Video opens a sponsor page first. Come back afterwards and the video opens on MEGA. We cannot verify that the sponsor page was viewed.';
  window.addEventListener('pageshow', (e) => { if (e.persisted && state.videos.length) resumePending(true); });
  try { state.saved = new Set(JSON.parse(store.get('cinegrid.saved', '[]'))); } catch { state.saved = new Set(); }
  applyTheme();
  $('#themeSel').addEventListener('change', (e) => { store.set('cinegrid.theme', e.target.value); applyTheme(); });
  $('#clearSaved').addEventListener('click', () => { state.saved.clear(); store.set('cinegrid.saved', '[]'); renderSaved(); });
  $('#searchBtn').addEventListener('click', () => {
    const row = $('#searchRow'), open = row.hidden;
    showView('home'); row.hidden = !open; $('#searchBtn').setAttribute('aria-expanded', String(open));
    if (open) $('#search').focus();
  });
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; renderHome(); });
  document.querySelectorAll('.bottomnav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#mClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#watchBtn').addEventListener('click', onWatch);
  $('#saveBtn').addEventListener('click', toggleSave);
  document.addEventListener('keydown', trapFocus);
  loadCatalogue();
}
init();
