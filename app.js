/* Disc Logs - a play tracker for a public Discogs collection.
   Safety notes for reviewers:
   - No sign-in, no passwords, no API keys. Only public Discogs data is read.
   - The only network requests go to https://api.discogs.com (enforced by the
     Content-Security-Policy in index.html). Cover images load from i.discogs.com.
   - Everything the user does (plays, cartridge) is stored in this browser's
     localStorage on their own device. Nothing is sent anywhere.
   - No third-party scripts or libraries. Text from Discogs is always escaped
     before it is put on the page. */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const shortDate = t => { const d = new Date(t); return String(d.getDate()).padStart(2,'0') + ' ' + MON[d.getMonth()] + ' ’' + String(d.getFullYear()).slice(2); };
const fmtDate = t => new Date(t).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const API = 'https://api.discogs.com';
const safeImg = u => /^https:\/\/i\.discogs\.com\//.test(String(u || '')) ? String(u) : '';
const safeId = v => /^\d{1,12}$/.test(String(v)) ? String(v) : null;

/* ---- storage (this device only) ---- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('dl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dl.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
let user = store.get('user', '');
let lib = store.get('lib', null);          // {user, updated, rows:[[rid,artist,title,year,format,thumb]]}
let extras = store.get('extras', []);      // records picked via "Playing something new" that aren't in the collection
let plays = store.get('plays', {});        // rid -> {rid,artist,title,thumb,times:[ms],half:[ms]}
let RECS = [], byId = new Map();

function setLibrary() {
  const rows = [...(lib ? lib.rows : [])];
  for (const e of extras) if (!rows.some(r => r[0] === e[0])) rows.push(e);
  RECS = rows.map(r => ({rid:r[0], artist:r[1], title:r[2], year:r[3], format:r[4], thumb:safeImg(r[5]), key:norm(r[1] + ' ' + r[2])}));
  byId = new Map(RECS.map(r => [r.rid, r]));
  $('libLine').textContent = lib ? `${lib.user}: ${lib.rows.length.toLocaleString()} records, updated ${new Date(lib.updated).toLocaleDateString(undefined, {month:'long', day:'numeric', year:'numeric'})}.` : '';
}
const info = rid => byId.get(rid) || plays[rid] || {rid, artist:'', title:'Unknown record', thumb:''};
const cover = rid => { const u = safeImg(info(rid).thumb); return u ? `<img class="cov" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="cov none" aria-hidden="true"></span>'; };
const savePlays = () => store.set('plays', plays);

/* ---- loading a public collection ---- */
async function dg(path) {
  for (let tries = 0; tries < 4; tries++) {
    const r = await fetch(API + path, {credentials:'omit'});
    if (r.status === 429) { await sleep(30000); continue; }
    if (!r.ok) { const e = new Error('status ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  throw new Error('busy');
}
async function loadCollection(u, msgEl) {
  const rows = []; let page = 1, pages = 1;
  do {
    msgEl.textContent = `Loading your collection${pages > 1 ? ` (page ${page} of ${pages})` : ''}...`;
    const j = await dg(`/users/${encodeURIComponent(u)}/collection/folders/0/releases?per_page=100&page=${page}`);
    pages = (j.pagination && j.pagination.pages) || 1;
    for (const x of j.releases || []) {
      const id = safeId(x.id); if (!id || rows.some(r => r[0] === id)) continue;
      const b = x.basic_information || {};
      rows.push([id, (b.artists || []).map(a => String(a.name || '').replace(/ \(\d+\)$/, '')).join(', '), String(b.title || ''), b.year ? String(b.year) : '',
        (b.formats || []).map(q => [...(q.descriptions || []), q.text].filter(Boolean).join(', ')).join('; '), safeImg(b.cover_image && !/spacer/.test(b.cover_image) ? b.thumb || b.cover_image : b.thumb)]);
    }
    page++; if (page <= pages) await sleep(1100);
  } while (page <= pages);
  return rows;
}
async function startWith(u) {
  const msg = $('setupMsg');
  try {
    const rows = await loadCollection(u, msg);
    lib = {user:u, updated:Date.now(), rows};
    const have = new Set(rows.map(r => r[0])); extras = extras.filter(r => !have.has(r[0]));
    if (!store.set('lib', lib)) msg.textContent = 'Loaded, but this browser won\'t save it (private browsing may be on).';
    store.set('extras', extras); store.set('user', u); user = u;
    setLibrary(); showApp(); render(); return true;
  } catch (e) {
    msg.textContent = e.status === 404 ? 'Discogs doesn\'t know that username. Check the spelling.' : e.status === 403 || e.status === 401 ? 'That collection is private on Discogs. Make it public in your Discogs privacy settings, then try again.' : 'Couldn\'t reach Discogs just now. Try again in a minute.';
    return false;
  }
}
function showApp() { $('setup').hidden = true; $('app').hidden = false; }
$('setupForm').addEventListener('submit', async e => { e.preventDefault(); const u = $('userIn').value.trim(); if (!u) return; await startWith(u); });
$('refreshBtn').addEventListener('click', async () => { if (!user) return; $('setup').hidden = false; await startWith(user); });
$('changeUser').addEventListener('click', () => { setMenu(false); $('app').hidden = true; $('setup').hidden = false; $('userIn').value = user; $('userIn').focus(); });

/* ---- plays ---- */
function allEvents() { const ev = []; for (const p of Object.values(plays)) for (const t of p.times || []) ev.push({rid:p.rid, t}); return ev.sort((a, b) => b.t - a.t); }
const lastPlayed = rid => { const ts = plays[rid]?.times || []; return ts.length ? Math.max(...ts) : 0; };
const isHalf = (rid, t) => (plays[rid]?.half || []).includes(t);
function playBtn(rid) { const n = lastPlayed(rid); return `<button class="play" data-rid="${esc(rid)}">${n ? `Last Played<small>${shortDate(n)}</small>` : 'Unlogged'}</button>`; }
function fmtShort(f) { f = String(f || ''); return f.length > 42 ? f.slice(0, 40).replace(/[ ,;]+$/, '') + '…' : f; }
function row(r) { return `<li>${cover(r.rid)}<div><div class="t">${esc(r.title)}</div><div class="a">${esc(r.artist)}</div><div class="m">${esc([r.year, fmtShort(r.format)].filter(Boolean).join(' · '))}</div></div>${playBtn(r.rid)}</li>`; }
function logPlay(rid, base, t = Date.now()) {
  const p = plays[rid] || (plays[rid] = {rid, artist:base.artist || '', title:base.title || '', thumb:safeImg(base.thumb), times:[]});
  p.times.push(t); savePlays(); render();
  toast(`Logged ${base.title || 'record'}`, () => removePlay(rid, t), () => setHalf(rid, t, true));
}
function removePlay(rid, t) {
  const p = plays[rid]; if (!p) return; const i = p.times.indexOf(t); if (i > -1) p.times.splice(i, 1);
  if (p.half) { p.half = p.half.filter(v => v !== t); if (!p.half.length) delete p.half; }
  if (!p.times.length) delete plays[rid];
  savePlays(); render(); toast(`Removed a play of ${p.title}`);
}
function setHalf(rid, t, on) {
  const p = plays[rid]; if (!p) return; p.half = (p.half || []).filter(v => v !== t); if (on) p.half.push(t); if (!p.half.length) delete p.half;
  savePlays(); render(); toast(on ? `Marked ${p.title} as one side` : `Marked ${p.title} as the whole record`);
}

/* ---- rendering ---- */
function renderStats() { const ev = allEvents(); const now = new Date(); const m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  $('sTotal').textContent = ev.length.toLocaleString(); $('sMonth').textContent = ev.filter(e => e.t >= m0).length.toLocaleString();
  $('sRecords').textContent = Object.values(plays).filter(p => (p.times || []).length).length.toLocaleString(); }
function renderLog() {
  const q = norm($('q').value.trim());
  if (!q) { const seen = new Set(), recent = [];
    for (const e of allEvents()) { if (seen.has(e.rid)) continue; seen.add(e.rid); recent.push({...info(e.rid), rid:e.rid}); if (recent.length >= 8) break; }
    $('qhint').textContent = recent.length ? 'Recently played. Or search for something else.' : 'Search for the record you\'re putting on.';
    $('results').innerHTML = recent.map(row).join(''); return; }
  const words = q.split(/\s+/); const hits = RECS.filter(r => words.every(w => r.key.includes(w))).slice(0, 50);
  $('qhint').textContent = hits.length ? `${hits.length === 50 ? 'First 50 matches' : hits.length + ' match' + (hits.length === 1 ? '' : 'es')}.` : 'No match. Check the spelling, or add it from the menu (top right).';
  $('results').innerHTML = hits.map(row).join('');
}
function renderTop() { const arr = Object.values(plays).filter(p => (p.times || []).length).sort((a, b) => b.times.length - a.times.length || lastPlayed(b.rid) - lastPlayed(a.rid)).slice(0, 100);
  $('toplist').innerHTML = arr.length ? arr.map((p, i) => { const x = info(p.rid); return `<li>${cover(p.rid)}<div><div class="t"><span class="rank">${i + 1}.</span> ${esc(x.title)}</div><div class="a">${esc(x.artist)}</div><div class="m">Last played ${shortDate(lastPlayed(p.rid))}</div></div><div class="count">${p.times.length}</div></li>`; }).join('') : '<li class="empty">Nothing logged yet.</li>'; }
function renderRecent() { const ev = allEvents().slice(0, 60);
  $('recentlist').innerHTML = ev.length ? ev.map(e => { const x = info(e.rid), h = isHalf(e.rid, e.t); return `<li>${cover(e.rid)}<div><div class="t">${esc(x.title)}</div><div class="a">${esc(x.artist)}</div><div class="m">${fmtDate(e.t)}${h ? ' · one side' : ''}</div></div><div class="rbtns"><button class="ghost" data-half="${esc(e.rid)}" data-t="${e.t}">${h ? 'Whole record' : 'One side'}</button><button class="ghost" data-rm="${esc(e.rid)}" data-t="${e.t}">Remove</button></div></li>`; }).join('') : '<li class="empty">Nothing logged yet. Go to Log a play and tap a record after you put it on.</li>'; }
function render() { renderStats(); renderCart(); renderLog(); renderTop(); renderRecent(); }

/* ---- toast ---- */
let lastUndo = null, lastSide = null, toastTimer = 0;
function toast(msg, undo, side) { $('toastMsg').textContent = msg; lastUndo = undo || null; lastSide = side || null; $('undoBtn').hidden = !undo; $('sideBtn').hidden = !side; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, undo ? 7000 : 3500); }
$('undoBtn').addEventListener('click', () => { if (lastUndo) { lastUndo(); lastUndo = null; } $('toast').hidden = true; });
$('sideBtn').addEventListener('click', () => { if (lastSide) { lastSide(); lastSide = null; } $('toast').hidden = true; });

/* ---- clicks ---- */
function clearSearch() { if ($('q').value) { $('q').value = ''; $('qClear').hidden = true; } }
$('q').addEventListener('input', () => { $('qClear').hidden = !$('q').value; renderLog(); });
$('qClear').addEventListener('click', () => { $('q').value = ''; $('qClear').hidden = true; renderLog(); $('q').focus(); });
document.addEventListener('click', e => {
  const b = e.target.closest('button[data-rid]'); if (b) { const rid = b.dataset.rid; clearSearch(); logPlay(rid, info(rid)); return; }
  const hb = e.target.closest('button[data-half]'); if (hb) { const t = Number(hb.dataset.t); setHalf(hb.dataset.half, t, !isHalf(hb.dataset.half, t)); return; }
  const rb = e.target.closest('button[data-rm]'); if (rb) { removePlay(rb.dataset.rm, Number(rb.dataset.t)); return; }
  const pk = e.target.closest('button[data-pick]'); if (pk) { pickFound(Number(pk.dataset.pick)); return; }
});
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.id !== b.dataset.p; });
}));

/* ---- "Playing something new?": search Discogs' public database ---- */
let found = [];
const fv = id => $(id).value.trim();
const cleanMx = s => norm(s).replace(/[^a-z0-9]/g, '');
function rowFound(x, i) { const d = [x.year, x.country, x.label, x.catno].filter(Boolean).map(esc).join(' · ');
  return `<li>${x.thumb ? `<img class="cov" src="${esc(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="cov none" aria-hidden="true"></span>'}<div><div class="t">${esc(x.title)}${x.mx ? '<span class="chip">runout matches</span>' : ''}</div><div class="a">${esc(x.artist)}</div><div class="m">${d}</div><div class="m">${esc(x.format)}</div>${x.details ? `<div class="m">${esc(x.details)}</div>` : ''}<div class="m"><a href="https://www.discogs.com/release/${esc(x.rid)}" target="_blank" rel="noopener noreferrer">See it on Discogs</a></div></div><button class="play" data-pick="${i}">This one</button></li>`; }
$('findForm').addEventListener('submit', async e => { e.preventDefault();
  const a = fv('fArtist'), t = fv('fTitle'), b = fv('fBarcode').replace(/\s+/g, ''), m = fv('fMatrix'), y = fv('fYear');
  if (!(a || t || b || m)) { $('findMsg').textContent = 'Fill in at least one of artist, title, barcode or runout.'; return; }
  $('findList').hidden = true; $('manualBox').hidden = true; $('findMsg').textContent = 'Looking on Discogs...';
  const prm = {type:'release', per_page:'25'}; if (a) prm.artist = a; if (t) prm.release_title = t; if (b) prm.barcode = b; if (y) prm.year = y; if (m && !b) prm.q = m;
  try {
    let j = await dg('/database/search?' + new URLSearchParams(prm));
    if (!j.results.length && prm.q && (a || t)) { delete prm.q; j = await dg('/database/search?' + new URLSearchParams(prm)); }
    if (!j.results.length && y) { delete prm.year; j = await dg('/database/search?' + new URLSearchParams(prm)); }
    found = (j.results || []).filter(r => safeId(r.id) && (!r.format || /vinyl/i.test(r.format.join(' ')))).slice(0, 15).map(r => { const [ar, ...ti] = String(r.title || '').split(' - ');
      return {rid:String(r.id), artist:ar.replace(/ \(\d+\)$/, '').replace(/\*$/, ''), title:ti.join(' - ') || r.title, year:r.year || '', country:r.country || '', label:(r.label || [])[0] || '', catno:r.catno || '', format:(r.format || []).join(', '), thumb:safeImg(r.thumb)}; });
    if (found.length > 1 && found.length <= 8) { $('findMsg').textContent = 'Checking the details of each version...';
      for (const x of found) { try { const d = await dg('/releases/' + x.rid); const ids = d.identifiers || [];
        x.details = [(d.formats || []).map(f => f.text).filter(Boolean).join(', '), ids.filter(i => /matrix|runout/i.test(i.type)).map(i => i.value).slice(0, 2).join(' / ')].filter(Boolean).join(' — ');
        if (m) x.mx = ids.some(i => /matrix|runout/i.test(i.type) && cleanMx(i.value).includes(cleanMx(m).slice(0, 12))); } catch (err) {} }
      found.sort((p, q) => (q.mx ? 1 : 0) - (p.mx ? 1 : 0)); }
    if (!found.length) { $('findMsg').textContent = 'Discogs has nothing matching that.'; $('manualBox').hidden = false; return; }
    $('findMsg').textContent = found.length === 1 ? 'Found it. Tap This one to log a play.' : `${found.length} versions found. Pick the one that matches your copy (check the label, catalog number, country and runout).`;
    $('findList').innerHTML = found.map(rowFound).join(''); $('findList').hidden = false; $('manualBox').hidden = false;
  } catch (err) { $('findMsg').textContent = 'Couldn\'t reach Discogs just now. Try again in a minute.'; $('manualBox').hidden = false; }
});
function pickFound(i) { const x = found[i]; if (!x) return;
  if (!byId.has(x.rid)) { extras.push([x.rid, x.artist, x.title, String(x.year || ''), x.format, x.thumb]); store.set('extras', extras); setLibrary(); }
  logPlay(x.rid, x); $('findList').hidden = true; $('manualBox').hidden = true; ['fArtist','fTitle','fBarcode','fMatrix','fYear'].forEach(id => { $(id).value = ''; });
  $('findMsg').innerHTML = `Logged <b>${esc(x.title)}</b>. To add it to your Discogs collection, <a href="https://www.discogs.com/release/${esc(x.rid)}" target="_blank" rel="noopener noreferrer">open it on Discogs</a> and tap Add to Collection.`; }
$('manualBtn').addEventListener('click', () => { const artist = fv('fArtist'), title = fv('fTitle');
  if (!artist || !title) { $('findMsg').textContent = 'Type the artist and title above first.'; return; }
  const rid = 'x-' + (norm(artist + '-' + title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record');
  logPlay(rid, {artist, title}); ['fArtist','fTitle','fBarcode','fMatrix','fYear'].forEach(id => { $(id).value = ''; });
  $('manualBox').hidden = true; $('findList').hidden = true; $('findMsg').textContent = `Logged ${title}.`; });

/* ---- cartridge ---- */
const SHAPES = {unknown:0, conical:400, elliptical:300, shibata:800, line:800, microline:1000};
const SHAPE_NAME = {conical:'conical', elliptical:'elliptical', shibata:'Shibata', line:'line contact', microline:'MicroLine-type'};
const CARTS = [["umami red","microline"],["hana ml","microline"],["hana mh","microline"],["hana sl","shibata"],["hana sh","shibata"],["hana el","elliptical"],["hana eh","elliptical"],
["vm95c","conical"],["vm95e","elliptical"],["vm95en","elliptical"],["vm95ml","microline"],["vm95sh","shibata"],["at95e","elliptical"],["vm520eb","elliptical"],["vm530en","elliptical"],["vm540ml","microline"],["vm740ml","microline"],["vm750sh","shibata"],["vm760slc","line"],
["oc9xeb","elliptical"],["oc9xen","elliptical"],["oc9xml","microline"],["oc9xsh","shibata"],["oc9xsl","line"],["at33ptg","microline"],
["2m red","elliptical"],["2m blue","elliptical"],["2m bronze","line"],["2m black","shibata"],["om 5e","elliptical"],["om5e","elliptical"],["om 10","elliptical"],["om10","elliptical"],
["quintet red","elliptical"],["quintet blue","elliptical"],["quintet bronze","line"],["quintet black","shibata"],["cadenza red","line"],["cadenza bronze","microline"],["cadenza black","shibata"],["windfeld","microline"],
["dl-103","conical"],["dl103","conical"],["dl-110","elliptical"],["dl110","elliptical"],["grado prestige","elliptical"],["rega carbon","conical"],["m97xe","elliptical"],["goldring e3","elliptical"],
["rainier","elliptical"],["olympia","elliptical"],["moonstone","elliptical"],["blue point","elliptical"],["songbird","elliptical"],["amethyst","line"],["starling","microline"]];
function guessShape(model) { const m = norm(model).replace(/[\s_]+/g, ' '); let best = null;
  for (const [k, v] of CARTS) { if ((m.includes(k) || m.replace(/[\s-]/g, '').includes(k.replace(/[\s-]/g, ''))) && (!best || k.length > best[0].length)) best = [k, v]; }
  return best ? best[1] : null; }
let CART = store.get('cart', null) || {current:{model:'', installed:null, prior:0, shape:'unknown'}, history:[], minutes:40, life:1000};
const dstr = t => { if (!t) return ''; const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dparse = v => { if (!v) return null; const [y, mo, da] = v.split('-').map(Number); return new Date(y, mo - 1, da).getTime(); };
function cartStats() { const c = CART.current || {}, since = c.installed || 0; const evs = allEvents().filter(e => e.t >= since);
  const units = evs.reduce((a, e) => a + (isHalf(e.rid, e.t) ? .5 : 1), 0);
  const hours = units * (Number(CART.minutes) || 40) / 60 + (Number(c.prior) || 0); const life = Number(CART.life) || 1000; return {n:evs.length, hours, life, pct:hours / life}; }
let cartDirty = false;
function renderCart() { const c = CART.current || {}, st = cartStats(), h = Math.round(st.hours), pct = Math.min(100, Math.round(st.pct * 100));
  $('cartModel').textContent = c.model || 'Your cartridge (add its model below)';
  $('cartNewHead').textContent = c.model ? 'Replaced your cartridge with a different one?' : 'Which cartridge are you using?';
  const left = st.life - st.hours, box = $('cartBox'); box.classList.remove('lvl-yellow', 'lvl-red', 'lvl-fire');
  if (c.model) { if (left <= 25) box.classList.add('lvl-fire'); else if (left <= 50) box.classList.add('lvl-red'); else if (left <= 100) box.classList.add('lvl-yellow'); }
  $('cartLeft').textContent = c.model && left <= 100 ? (left > 0 ? ` · about ${Math.max(0, Math.round(left))} hours left` : ' · past its expected life') : '';
  const bar = $('cartBar'); bar.style.width = pct + '%'; bar.className = st.pct >= 1 ? 'due' : st.pct >= .8 ? 'warn' : '';
  $('cartLine').innerHTML = `About ${h.toLocaleString()} of <span class="life">${st.life.toLocaleString()} hours</span> (${pct}%). ${st.n.toLocaleString()} play${st.n === 1 ? '' : 's'} logged ${c.installed ? 'since ' + esc(new Date(c.installed).toLocaleDateString(undefined, {month:'long', day:'numeric', year:'numeric'})) : 'so far'}${Number(c.prior) ? `, plus ${Number(c.prior)} hours from before` : ''}.`;
  const a = $('cartAlert'), nm = c.model || 'cartridge';
  if (c.model && st.pct >= 1) { a.hidden = false; a.textContent = `Your ${nm} is at about ${h.toLocaleString()} hours, past its expected ${st.life.toLocaleString()}. Time to retip or replace it; a worn stylus can damage records before it sounds bad.`; }
  else if (c.model && st.pct >= .8) { a.hidden = false; a.textContent = `Your ${nm} is at about ${h.toLocaleString()} of ${st.life.toLocaleString()} hours. Time to start thinking about a replacement.`; }
  else a.hidden = true;
  const hist = (CART.history || []).slice().reverse(); $('cartHist').hidden = !hist.length;
  $('cartHist').innerHTML = hist.map(x => `<li class="block"><div class="t">${esc(x.model || 'Cartridge')}</div><div class="m">${x.installed ? new Date(x.installed).toLocaleDateString() : '?'} to ${new Date(x.removed).toLocaleDateString()} · about ${Math.round(x.hours || 0).toLocaleString()} hours</div></li>`).join('');
  if (cartDirty || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#cartSettings'))) return;
  $('cInst').value = dstr(c.installed); $('cShape').value = c.shape || guessShape(c.model || '') || 'unknown'; $('cLife').value = CART.life; $('cMin').value = CART.minutes; $('cPrior').value = c.prior || 0; }
function saveCart(msg) { $('cartMsg').textContent = store.set('cart', CART) ? msg : 'This browser won\'t save that (private browsing may be on).'; render(); }
$('cShape').addEventListener('change', () => { const h = SHAPES[$('cShape').value]; if (h) $('cLife').value = h; });
['input', 'change'].forEach(ev => $('cartSettings').addEventListener(ev, () => { cartDirty = true; }));
$('cartSettings').addEventListener('submit', e => { e.preventDefault(); cartDirty = false;
  CART.current.installed = dparse($('cInst').value); CART.current.shape = $('cShape').value; CART.life = Math.max(50, Number($('cLife').value) || 1000);
  CART.minutes = Math.max(5, Number($('cMin').value) || 40); CART.current.prior = Math.max(0, Number($('cPrior').value) || 0);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); saveCart('Saved.'); });
$('cNewDate').value = dstr(Date.now());
$('cNewModel').addEventListener('input', () => { const g = guessShape($('cNewModel').value);
  $('cGuess').innerHTML = !$('cNewModel').value.trim() ? '' : g ? `Looks like ${g === 'elliptical' ? 'an' : 'a'} ${SHAPE_NAME[g]} stylus, about <span class="life">${SHAPES[g].toLocaleString()} hours</span>. You can change the shape after.` : 'Not in the built-in list. After you add it, pick the stylus shape above (it\'s in the maker\'s specs).'; });
$('cartNew').addEventListener('submit', e => { e.preventDefault(); const model = $('cNewModel').value.trim(), when = dparse($('cNewDate').value);
  if (!model || !when) { $('cartMsg').textContent = 'Type the model and the date it went in.'; return; }
  const shape = guessShape(model) || 'unknown';
  if (CART.current.model) { const st = cartStats(); CART.history = CART.history || []; CART.history.push({model:CART.current.model, installed:CART.current.installed, removed:when, hours:Math.round(st.hours)}); CART.current = {model, installed:when, prior:0, shape}; }
  else CART.current = {model, installed:when, prior:CART.current.prior || 0, shape};
  if (SHAPES[shape]) CART.life = SHAPES[shape]; $('cNewModel').value = ''; $('cGuess').textContent = '';
  saveCart(`Now counting ${model} from ${new Date(when).toLocaleDateString()}.`); });

/* ---- backup (a file the user keeps) ---- */
$('backupBtn').addEventListener('click', () => {
  const data = JSON.stringify({app:'disclogs', saved:Date.now(), user, plays, cart:CART, extras}, null, 1);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], {type:'application/json'}));
  a.download = `disc-logs-backup-${dstr(Date.now())}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  $('backupMsg').textContent = 'Backup saved to your downloads.'; });
$('restoreFile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d || d.app !== 'disclogs' || typeof d.plays !== 'object') throw 0;
    for (const [rid, p] of Object.entries(d.plays)) { if (!p || !Array.isArray(p.times)) continue;
      const cur = plays[rid] || (plays[rid] = {rid, artist:String(p.artist || ''), title:String(p.title || ''), thumb:safeImg(p.thumb), times:[]});
      cur.times = [...new Set([...cur.times, ...p.times.filter(Number.isFinite)])].sort((a, b) => a - b);
      if (Array.isArray(p.half)) { cur.half = [...new Set([...(cur.half || []), ...p.half.filter(Number.isFinite)])]; } }
    if (d.cart && d.cart.current && !(CART.current && CART.current.model)) { CART = d.cart; store.set('cart', CART); }
    if (Array.isArray(d.extras)) { for (const x of d.extras) if (Array.isArray(x) && !extras.some(y => y[0] === x[0])) extras.push(x.map(String)); store.set('extras', extras); setLibrary(); }
    savePlays(); render(); $('backupMsg').textContent = 'Backup restored.';
  } catch (err) { $('backupMsg').textContent = 'That file isn\'t a Disc Logs backup.'; }
  e.target.value = ''; });

/* ---- menu ---- */
function setMenu(open) { $('menu').hidden = !open; $('menuBtn').setAttribute('aria-expanded', String(open)); if (open) window.scrollTo({top:0}); }
$('menuBtn').addEventListener('click', () => setMenu($('menu').hidden));
$('menuClose').addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('menu').hidden) setMenu(false); });
$('cartAlert').addEventListener('click', () => { setMenu(true); $('cartBox').open = true; });

/* ---- start ---- */
setLibrary();
if (lib && lib.rows && user) { showApp(); render(); } else { $('setup').hidden = false; render(); }
