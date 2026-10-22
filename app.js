'use strict';
/* Lock In — daily discipline checklist with timers. Everything is stored on this device (localStorage). */

const KEY = 'lockin.v1';
const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ALL = [0, 1, 2, 3, 4, 5, 6];

const DEFAULT_TASKS = [
  { id: 'gym', name: 'Gym', type: 'stopwatch', days: [1, 2, 4, 5, 6], min: 30, labelByDay: { 1: 'Upper', 2: 'Lower', 4: 'Push', 5: 'Pull', 6: 'Legs' }, sub: '06:30' },
  { id: 'jog', name: 'Jog', type: 'countdown', days: [0, 3], target: 60, min: 20, sub: 'morning, before the sun' },
  { id: 'read', name: 'Read', type: 'countdown', days: ALL, target: 60, min: 20, sub: 'at the office before 9' },
  { id: 'learn', name: 'Learn a skill', type: 'countdown', days: [1, 2, 3, 4, 5, 6], target: 60, targetByDay: { 6: 30 }, min: 20, sub: 'drive home' },
  { id: 'biz', name: 'Business', type: 'countdown', days: ALL, target: 60, targetByDay: { 0: 180, 6: 180 }, min: 30, minByDay: { 0: 120, 6: 120 }, sub: 'evening' },
  { id: 'med', name: 'Meditate', type: 'countdown', days: ALL, target: 30, min: 10, sub: 'balcony, before bed' },
  { id: 'gainer', name: 'Mass gainer', type: 'tick', days: ALL },
  { id: 'meds', name: 'Night routine', type: 'tick', days: ALL, sub: 'at 20:00 so it dries before bed' },
  { id: 'bed', name: 'In bed by 22:00', type: 'tick', days: ALL, labelByDay: { 5: 'by 23:30', 6: 'by 23:30' }, sub: 'phone away' },
];

/* ---------- state ---------- */
let S, noSave = false;
function fresh() { return { settings: { dayStart: 4, chime: true }, tasks: JSON.parse(JSON.stringify(DEFAULT_TASKS)), days: {}, active: null, created: Date.now() }; }
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.tasks)) { s.settings = Object.assign({ dayStart: 4, chime: true }, s.settings); s.days = s.days || {}; return s; } } catch (e) { }
  return fresh();
}
function save() { if (!noSave) localStorage.setItem(KEY, JSON.stringify(S)); }

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dayKey(d = new Date()) { return ymd(new Date(d.getTime() - S.settings.dayStart * 3600e3)); }
function keyDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function wdOf(k) { return keyDate(k).getDay(); }
function addDays(k, n) { const d = keyDate(k); d.setDate(d.getDate() + n); return ymd(d); }
function fmtDate(k) { const d = keyDate(k); return DL[d.getDay()] + ', ' + d.getDate() + ' ' + MN[d.getMonth()]; }
function fmt(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s); }
function fmtMin(sec) { const m = Math.round(sec / 60); if (m < 60) return m + 'm'; return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; }

/* ---------- tasks & records ---------- */
function task(id) { return S.tasks.find(t => t.id === id); }
function targetFor(t, wd) { return (t.targetByDay && t.targetByDay[wd] != null) ? +t.targetByDay[wd] : +(t.target || 0); }
function minFor(t, wd) { const m = (t.minByDay && t.minByDay[wd] != null) ? +t.minByDay[wd] : +(t.min || 0); const tg = targetFor(t, wd); return t.type === 'countdown' && tg ? Math.min(m, tg) : m; }
function subFor(t, wd) { const l = t.labelByDay && t.labelByDay[wd]; return [l, t.sub].filter(Boolean).join(' · '); }
function scheduled(k) { const wd = wdOf(k); return S.tasks.filter(t => (t.days || ALL).includes(wd)); }
function rec(k, id) { const d = S.days[k]; return (d && d.t && d.t[id]) || { sec: 0, done: false }; }
function setRec(k, id, r) { S.days[k] = S.days[k] || { t: {} }; S.days[k].t[id] = r; }
function stats(k) { const ts = scheduled(k); let done = 0, sec = 0; ts.forEach(t => { const r = rec(k, t.id); if (r.done) done++; if (t.type !== 'tick') sec += r.sec || 0; }); return { total: ts.length, done, sec }; }
function kept(k) { const s = stats(k); return s.total > 0 && s.done === s.total; }
function streak() {
  let n = 0, k = dayKey(), guard = 0;
  if (!kept(k)) k = addDays(k, -1);
  while (guard++ < 4000) { const s = stats(k); if (s.total === 0) { if (!S.days[k] && guard > 60) break; k = addDays(k, -1); continue; } if (s.done === s.total) { n++; k = addDays(k, -1); } else break; }
  return n;
}

/* ---------- timer ---------- */
function elapsed() { const a = S.active; if (!a) return 0; return a.acc + (a.running ? (Date.now() - a.startedAt) / 1000 : 0); }
function startTimer(id) {
  if (S.active) { openOverlay(S.active.id); return; }
  const k = dayKey();
  S.active = { id, key: k, startedAt: Date.now(), acc: 0, running: true, chimed: false };
  unlockAudio(); wake(true); save(); openOverlay(id); render();
}
function pauseTimer() { const a = S.active; if (!a || !a.running) return; a.acc += (Date.now() - a.startedAt) / 1000; a.running = false; wake(false); save(); updateOverlay(); renderBar(); }
function resumeTimer() { const a = S.active; if (!a || a.running) return; a.startedAt = Date.now(); a.running = true; unlockAudio(); wake(true); save(); updateOverlay(); renderBar(); }
function finishTimer() {
  const a = S.active; if (!a) return;
  const t = task(a.id), sec = elapsed(), wd = wdOf(a.key);
  if (t) { const r = rec(a.key, a.id); r.sec = (r.sec || 0) + sec; r.done = r.sec >= minFor(t, wd) * 60; r.at = Date.now(); setRec(a.key, a.id, r); }
  S.active = null; wake(false); stopSilent(); save(); closeOverlay(); render();
  if (t && !rec(a.key, a.id).done) toast('Logged ' + fmtMin(sec) + ' — under the minimum, not ticked');
}
function discardTimer() { S.active = null; wake(false); stopSilent(); save(); closeOverlay(); render(); }

let tickTimer = null, renderedKey = null;
function tick() {
  const a = S.active;
  if (a && a.running) {
    const t = task(a.id);
    if (t && t.type === 'countdown' && !a.chimed && elapsed() >= targetFor(t, wdOf(a.key)) * 60) { a.chimed = true; save(); chime(); }
  }
  if (overlayId) updateOverlay();
  if (a) renderBar();
  if (renderedKey && dayKey() !== renderedKey && view === 'today') render();
}

/* ---------- wake lock + audio ---------- */
let wl = null;
async function wake(on) {
  try {
    if (on) { if (!wl && navigator.wakeLock) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } }
    else if (wl) { const w = wl; wl = null; await w.release(); }
  } catch (e) { }
}
let AC = null, silent = null;
function silentWav() {
  const n = 8000 * 2, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function unlockAudio() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    if (!silent) { silent = new Audio(silentWav()); silent.loop = true; silent.volume = 0.01; silent.setAttribute('playsinline', ''); }
    silent.play().catch(() => { });
  } catch (e) { }
}
function stopSilent() { try { if (silent) silent.pause(); } catch (e) { } }
function chime() {
  if (!S.settings.chime) return;
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const t0 = AC.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      [[528, 0.22], [792, 0.10], [1056, 0.05]].forEach(([f, g0]) => {
        const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f;
        const t = t0 + i * 1.7; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 2.7);
      });
    }
  } catch (e) { }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { }
}

/* ---------- rendering ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let view = 'today', editId = null, selDay = null, overlayId = null, confirmReset = false;
const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

function nav(v) { return `<div class="nav">${[['today', 'Today'], ['history', 'History'], ['settings', 'Settings']].filter(([k]) => k !== v).map(([k, l]) => `<button data-a="view" data-v="${k}">${l}</button>`).join('')}</div>`; }

function rowHtml(k, t, interactive) {
  const wd = wdOf(k), r = rec(k, t.id), live = S.active && S.active.id === t.id && S.active.key === k;
  const half = !r.done && r.sec > 0;
  let tm;
  if (live) tm = fmt(elapsed());
  else if (t.type === 'tick') tm = r.done ? '✓' : '—';
  else if (r.sec > 0) tm = fmtMin(r.sec);
  else tm = t.type === 'countdown' ? fmt(targetFor(t, wd) * 60) : 'start';
  let sub = subFor(t, wd);
  if (live) sub = (S.active.running ? 'running' : 'paused') + (t.type === 'countdown' ? ' · ' + fmt(targetFor(t, wd) * 60) + ' · min ' + minFor(t, wd) + 'm' : '');
  else if (t.type === 'countdown') sub = [sub, 'min ' + minFor(t, wd) + 'm'].filter(Boolean).join(' · ');
  else if (t.type === 'stopwatch') sub = [sub, 'stopwatch'].filter(Boolean).join(' · ');
  const ia = interactive ? `data-a="${t.type === 'tick' ? 'toggle' : 'open'}" data-id="${t.id}" data-k="${k}"` : '';
  const ck = interactive ? `data-a="toggle" data-id="${t.id}" data-k="${k}"` : '';
  return `<div class="row ${r.done ? 'done' : ''} ${live ? 'live' : ''}">
    <button class="ck ${r.done ? 'on' : ''} ${half ? 'half' : ''}" ${ck} aria-label="toggle"></button>
    <button class="t" ${ia}><b>${esc(t.name)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button>
    <span class="tm num">${tm}</span>${interactive && t.type !== 'tick' ? '<span class="arrow">›</span>' : ''}</div>`;
}

function renderToday() {
  const k = dayKey(), st = stats(k), ts = scheduled(k), isKept = st.total > 0 && st.done === st.total;
  let h = `<div class="top"><div><div class="date">${esc(fmtDate(k))}</div><h1>Today</h1></div>${nav('today')}</div>
  <div class="stats"><div class="st ${isKept ? 'kept' : ''}"><b>${st.done} / ${st.total}</b><span>${isKept ? 'day kept' : 'done'}</span></div>
  <div class="st"><b>${fmtMin(st.sec)}</b><span>locked in</span></div><div class="st"><b>${streak()}</b><span>day streak</span></div></div>`;
  if (!isStandalone() && /iPhone|iPad/.test(navigator.userAgent)) h += `<div class="hint">To install: tap <b>Share</b> → <b>Add to Home Screen</b>. Then open it from the home screen, not Safari.</div>`;
  h += `<div class="list">${ts.length ? ts.map(t => rowHtml(k, t, true)).join('') : '<div class="empty">Nothing scheduled today. Add tasks in Settings.</div>'}</div>`;
  return h;
}

function renderHistory() {
  const today = dayKey();
  const todayWd = wdOf(today), mondayOffset = (todayWd + 6) % 7;
  const end = addDays(today, 6 - mondayOffset); // this week's Sunday
  const start = addDays(end, -7 * 6 + 1);
  let cells = DN.slice(1).concat(DN[0]).map(d => `<div class="h">${d}</div>`).join('');
  for (let k = start; k <= end; k = addDays(k, 1)) {
    const s = stats(k), fut = k > today;
    let cls = 'd';
    if (!fut && s.total) { const f = s.done / s.total; cls += f >= 1 ? ' p3' : f >= 0.5 ? ' p2' : f > 0 ? ' p1' : ''; }
    if (k === today) cls += ' today'; if (k === selDay) cls += ' sel';
    cells += `<button class="${cls}" data-a="selday" data-k="${k}" ${fut ? 'disabled style="opacity:.3"' : ''}>${keyDate(k).getDate()}</button>`;
  }
  const wkStart = addDays(today, -mondayOffset); let wkKept = 0, wkSec = 0;
  for (let i = 0; i < 7; i++) { const k = addDays(wkStart, i); if (k > today) break; const s = stats(k); wkSec += s.sec; if (s.total && s.done === s.total) wkKept++; }
  let h = `<div class="top"><div><div class="date">last 6 weeks</div><h1>History</h1></div>${nav('history')}</div>
  <div class="wk"><div><b>${streak()}</b><span>day streak</span></div><div><b>${wkKept}</b><span>days kept this week</span></div><div><b>${fmtMin(wkSec)}</b><span>locked in this week</span></div></div>
  <div class="grid">${cells}</div><div class="legend"><span>■ none</span><span style="color:#1b6a33">■ half</span><span style="color:#30d158">■ all done</span></div>`;
  const k = selDay || today, s = stats(k);
  h += `<div class="daydetail"><h3>${esc(fmtDate(k))} <span class="dim">· ${s.done}/${s.total} · ${fmtMin(s.sec)}</span></h3><div class="list">${scheduled(k).map(t => rowHtml(k, t, k === today)).join('') || '<div class="empty">Nothing scheduled.</div>'}</div></div>`;
  return h;
}

function taskSummary(t) {
  const days = (t.days || ALL).length === 7 ? 'daily' : (t.days || []).map(d => DN[d]).join(' ');
  let x = t.type === 'tick' ? 'tick' : t.type === 'stopwatch' ? 'stopwatch · min ' + (t.min || 0) + 'm' : (t.target || 0) + ' min · min ' + (t.min || 0) + 'm';
  const ov = t.targetByDay ? Object.entries(t.targetByDay).map(([d, m]) => DN[d] + ' ' + m + 'm').join(', ') : '';
  return [days, x, ov].filter(Boolean).join(' · ');
}

function renderSettings() {
  let h = `<div class="top"><div><div class="date">lock in</div><h1>Settings</h1></div>${nav('settings')}</div>
  <div class="sec"><h3>Tasks</h3><div class="card">${S.tasks.map((t, i) => `<div class="item"><button class="t" data-a="edit" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(taskSummary(t))}</span></button>
    <button class="mv" data-a="move" data-id="${t.id}" data-d="-1" ${i === 0 ? 'disabled style="opacity:.2"' : ''}>▲</button><button class="mv" data-a="move" data-id="${t.id}" data-d="1" ${i === S.tasks.length - 1 ? 'disabled style="opacity:.2"' : ''}>▼</button></div>`).join('')}
    <button class="item btn" data-a="add">+ Add task</button></div></div>
  <div class="sec"><h3>Options</h3><div class="card">
    <div class="toggle"><div><b>Calm chime when a countdown hits 0</b><div class="note">Phone unlocked, app open. Works on silent too.</div></div><button class="sw ${S.settings.chime ? 'on' : ''}" data-a="chime"></button></div>
    <div class="field"><label>Day starts at (a late night still counts for the same day)</label><select data-a="daystart">${[0, 1, 2, 3, 4, 5, 6].map(x => `<option value="${x}" ${S.settings.dayStart === x ? 'selected' : ''}>${pad(x)}:00</option>`).join('')}</select></div>
  </div></div>
  <div class="sec"><h3>Backup</h3><div class="card">
    <button class="item btn" data-a="copy">Copy backup to clipboard</button>
    <button class="item btn" data-a="download">Download backup file</button>
    <div class="field"><label>Restore: paste a backup here, then tap Import</label><textarea id="imp" placeholder="{ ... }"></textarea></div>
    <button class="item btn" data-a="import">Import (replaces everything)</button>
  </div><div class="note">Data lives only on this phone. Copy a backup now and then (paste it into Notes).</div></div>
  <div class="sec"><div class="card"><button class="item danger" data-a="reset">${confirmReset ? 'Tap again to erase everything' : 'Reset everything'}</button></div></div>
  <div class="note" style="text-align:center;margin-top:20px">Lock In · ${isStandalone() ? 'installed' : 'running in browser — add to Home Screen'}</div>`;
  return h;
}

function renderEdit() {
  const t = task(editId) || { id: 'new', name: '', type: 'countdown', days: ALL.slice(), target: 60, min: 20 };
  const tb = t.targetByDay || {}, mb = t.minByDay || {};
  const lbd = t.labelByDay ? Object.entries(t.labelByDay).map(([d, l]) => DN[d] + ':' + l).join(', ') : '';
  return `<div class="top"><div><div class="date">task</div><h1>${t.id === 'new' ? 'New task' : 'Edit'}</h1></div><div class="nav"><button data-a="view" data-v="settings">Back</button></div></div>
  <div class="sec"><div class="card">
    <div class="field"><label>Name</label><input id="f-name" value="${esc(t.name)}" placeholder="e.g. Read"></div>
    <div class="field"><label>Subtitle (optional)</label><input id="f-sub" value="${esc(t.sub || '')}" placeholder="e.g. at the office before 9"></div>
    <div class="field"><label>Type</label><div class="seg" id="f-type">${[['countdown', 'Countdown'], ['stopwatch', 'Stopwatch'], ['tick', 'Tick']].map(([v, l]) => `<button data-a="seg" data-v="${v}" class="${t.type === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><label>Days</label><div class="days" id="f-days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button data-a="day" data-v="${d}" class="${(t.days || ALL).includes(d) ? 'on' : ''}">${DN[d]}</button>`).join('')}</div></div>
    <div class="field" id="f-timed"><div class="two"><div><label>Minutes (countdown)</label><input id="f-target" type="number" inputmode="numeric" value="${t.target || ''}"></div><div><label>Minimum to count as done</label><input id="f-min" type="number" inputmode="numeric" value="${t.min || ''}"></div></div></div>
    <div class="field"><div class="two"><div><label>Sat minutes</label><input id="f-t6" type="number" inputmode="numeric" value="${tb[6] != null ? tb[6] : ''}" placeholder="same"></div><div><label>Sat minimum</label><input id="f-m6" type="number" inputmode="numeric" value="${mb[6] != null ? mb[6] : ''}" placeholder="same"></div></div></div>
    <div class="field"><div class="two"><div><label>Sun minutes</label><input id="f-t0" type="number" inputmode="numeric" value="${tb[0] != null ? tb[0] : ''}" placeholder="same"></div><div><label>Sun minimum</label><input id="f-m0" type="number" inputmode="numeric" value="${mb[0] != null ? mb[0] : ''}" placeholder="same"></div></div></div>
    <div class="field"><label>Label by day (optional) — e.g. Mon:Upper, Tue:Lower</label><input id="f-lbd" value="${esc(lbd)}" placeholder="Mon:Upper, Tue:Lower"></div>
  </div></div>
  <div class="sec"><div class="card"><button class="item btn" data-a="savetask" data-id="${t.id}">Save</button></div></div>
  ${t.id !== 'new' ? `<div class="sec"><div class="card"><button class="item danger" data-a="deltask" data-id="${t.id}">Delete task</button></div></div>` : ''}`;
}

function render() {
  renderedKey = dayKey();
  const app = $('#app');
  app.innerHTML = view === 'today' ? renderToday() : view === 'history' ? renderHistory() : view === 'edit' ? renderEdit() : renderSettings();
  renderBar();
}

function renderBar() {
  let bar = $('#bar');
  const a = S.active;
  if (!a || overlayId) { if (bar) bar.remove(); return; }
  const t = task(a.id); if (!t) { S.active = null; save(); if (bar) bar.remove(); return; }
  const over = t.type === 'countdown' && elapsed() >= targetFor(t, wdOf(a.key)) * 60;
  if (!bar) { bar = document.createElement('div'); bar.id = 'bar'; bar.className = 'bar'; document.body.appendChild(bar); }
  bar.innerHTML = `<span class="dot ${!a.running ? 'paused' : over ? 'over' : ''}"></span><button class="name" data-a="open" data-id="${t.id}">${esc(t.name)}</button><span class="time num">${fmt(elapsed())}</span><button class="btn" data-a="finish">Done</button>`;
}

/* ---------- overlay (timer screen) ---------- */
function openOverlay(id) {
  const t = task(id); if (!t) return;
  overlayId = id;
  const wd = wdOf(S.active && S.active.id === id ? S.active.key : dayKey());
  const ov = $('#overlay');
  ov.innerHTML = `<div class="ov-top"><button data-a="closeov">‹ Back</button><span class="dim small">${t.type === 'countdown' ? 'countdown · ' + fmt(targetFor(t, wd) * 60) : 'stopwatch'}</span></div>
  <div class="ov-mid"><div class="lab" id="ov-lab">now</div><h2>${esc(t.name)}</h2><div class="sub">${esc(subFor(t, wd))}</div>
  <div class="time num" id="ov-time">0:00</div><div class="state muted" id="ov-state"></div><div class="prog"><i id="ov-prog" style="width:0"></i></div></div>
  <div class="ov-btns" id="ov-btns"></div><div class="ov-foot" id="ov-foot"></div>`;
  ov.hidden = false; renderBar(); updateOverlay();
}
function closeOverlay() { overlayId = null; $('#overlay').hidden = true; renderBar(); }
function updateOverlay() {
  const t = task(overlayId); if (!t) return closeOverlay();
  const a = S.active && S.active.id === overlayId ? S.active : null;
  const k = a ? a.key : dayKey(), wd = wdOf(k), tg = targetFor(t, wd) * 60, mn = minFor(t, wd) * 60, r = rec(k, t.id);
  const el = a ? elapsed() : 0, total = (r.sec || 0) + el;
  const timeEl = $('#ov-time'), st = $('#ov-state'), pr = $('#ov-prog'), btns = $('#ov-btns'), foot = $('#ov-foot'), lab = $('#ov-lab');
  let shown, cls = 'time num';
  if (t.type === 'countdown') { const left = tg - el; shown = left >= 0 ? fmt(left) : '+' + fmt(-left); if (left < 0) cls += ' over'; }
  else shown = fmt(el);
  if (a && !a.running) cls += ' paused';
  timeEl.textContent = shown; timeEl.className = cls;
  lab.textContent = !a ? 'ready' : a.running ? 'now' : 'paused';
  let state = '', scls = 'state muted';
  if (!a) { state = r.sec ? 'logged today: ' + fmtMin(r.sec) + (r.done ? ' ✓' : '') : (mn ? 'minimum ' + Math.round(mn / 60) + ' min to count' : 'press start'); }
  else if (t.type === 'countdown' && el >= tg) { state = "Time. Press Done"; scls = 'state over'; }
  else if (mn && total >= mn) { state = 'minimum reached ✓'; scls = 'state ok'; }
  else if (mn) { state = fmt(Math.max(0, mn - total)) + ' to minimum'; scls = 'state warn'; }
  else state = 'running';
  st.textContent = state; st.className = scls;
  const frac = t.type === 'countdown' && tg ? Math.min(1, el / tg) : mn ? Math.min(1, total / mn) : 0;
  pr.style.width = (frac * 100) + '%'; pr.className = t.type === 'countdown' && el >= tg ? 'over' : '';
  const want = !a ? 'ready' : a.running ? 'run' : 'paused';
  if (btns.dataset.mode !== want) {
    btns.dataset.mode = want;
    btns.innerHTML = want === 'ready' ? `<button class="start" data-a="start" data-id="${t.id}">Start</button>`
      : `<button class="pause" data-a="${want === 'run' ? 'pause' : 'resume'}">${want === 'run' ? 'Pause' : 'Resume'}</button><button class="done" data-a="finish">Done</button>`;
    foot.innerHTML = want === 'ready' ? `<button data-a="manualdone" data-id="${t.id}">${r.done ? 'Un-tick' : 'Mark done without timer'}</button>` : `<button data-a="discard">Discard this session</button>`;
  }
}

/* ---------- actions ---------- */
function toast(msg) { const e = document.createElement('div'); e.className = 'toast'; e.textContent = msg; document.body.appendChild(e); setTimeout(() => e.remove(), 2200); }
function toggle(k, id) {
  const t = task(id); if (!t) return;
  if (S.active && S.active.id === id && S.active.key === k) { openOverlay(id); return; }
  const r = rec(k, id); r.done = !r.done; r.at = Date.now(); setRec(k, id, r); save(); render();
}
function readEditForm(id) {
  const t = task(id) || { id: 'id' + Date.now().toString(36) };
  t.name = $('#f-name').value.trim() || 'Task';
  t.sub = $('#f-sub').value.trim(); if (!t.sub) delete t.sub;
  t.type = $('#f-type .on').dataset.v;
  t.days = [...document.querySelectorAll('#f-days .on')].map(b => +b.dataset.v).sort();
  const num = s => { const v = $(s).value.trim(); return v === '' ? null : Math.max(0, parseInt(v, 10) || 0); };
  if (t.type === 'tick') { delete t.target; delete t.min; delete t.targetByDay; delete t.minByDay; }
  else {
    t.target = num('#f-target') || 0; t.min = num('#f-min') || 0;
    const tb = {}, mb = {}; [6, 0].forEach(d => { const a = num('#f-t' + d), b = num('#f-m' + d); if (a != null) tb[d] = a; if (b != null) mb[d] = b; });
    if (Object.keys(tb).length) t.targetByDay = tb; else delete t.targetByDay;
    if (Object.keys(mb).length) t.minByDay = mb; else delete t.minByDay;
  }
  const lbd = {}; $('#f-lbd').value.split(',').map(s => s.trim()).filter(Boolean).forEach(p => { const [d, ...l] = p.split(':'); const i = DN.findIndex(x => x.toLowerCase() === d.trim().toLowerCase().slice(0, 3)); if (i >= 0 && l.length) lbd[i] = l.join(':').trim(); });
  if (Object.keys(lbd).length) t.labelByDay = lbd; else delete t.labelByDay;
  if (!task(id)) S.tasks.push(t);
  return t;
}
function backupText() { return JSON.stringify(S); }
async function copyBackup() { try { await navigator.clipboard.writeText(backupText()); toast('Backup copied'); } catch (e) { toast('Could not copy — use Download'); } }
function downloadBackup() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([backupText()], { type: 'application/json' })); a.download = 'lockin-backup-' + dayKey() + '.json'; document.body.appendChild(a); a.click(); a.remove(); }
function importBackup() {
  try { const s = JSON.parse($('#imp').value); if (!s || !Array.isArray(s.tasks)) throw 0; S = s; S.settings = Object.assign({ dayStart: 4, chime: true }, S.settings); S.days = S.days || {}; S.active = null; save(); toast('Imported'); view = 'today'; render(); }
  catch (e) { toast('That is not a Lock In backup'); }
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a, id = b.dataset.id;
  switch (a) {
    case 'view': view = b.dataset.v; confirmReset = false; render(); window.scrollTo(0, 0); break;
    case 'toggle': toggle(b.dataset.k, id); break;
    case 'open': if (S.active && S.active.id !== id) { openOverlay(S.active.id); toast('Finish ' + task(S.active.id).name + ' first'); } else openOverlay(id); break;
    case 'start': startTimer(id); break;
    case 'pause': pauseTimer(); break;
    case 'resume': resumeTimer(); break;
    case 'finish': finishTimer(); break;
    case 'discard': discardTimer(); break;
    case 'closeov': closeOverlay(); render(); break;
    case 'manualdone': { const k = dayKey(), r = rec(k, id); r.done = !r.done; r.at = Date.now(); setRec(k, id, r); save(); closeOverlay(); render(); break; }
    case 'selday': selDay = b.dataset.k; render(); break;
    case 'edit': editId = id; view = 'edit'; render(); window.scrollTo(0, 0); break;
    case 'add': editId = 'new'; view = 'edit'; render(); window.scrollTo(0, 0); break;
    case 'move': { const i = S.tasks.findIndex(t => t.id === id), j = i + (+b.dataset.d); if (j < 0 || j >= S.tasks.length) break; [S.tasks[i], S.tasks[j]] = [S.tasks[j], S.tasks[i]]; save(); render(); break; }
    case 'seg': b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('#f-timed').style.opacity = b.dataset.v === 'tick' ? .35 : 1; break;
    case 'day': b.classList.toggle('on'); break;
    case 'savetask': readEditForm(id); save(); view = 'settings'; render(); toast('Saved'); break;
    case 'deltask': S.tasks = S.tasks.filter(t => t.id !== id); if (S.active && S.active.id === id) S.active = null; save(); view = 'settings'; render(); break;
    case 'chime': S.settings.chime = !S.settings.chime; save(); render(); if (S.settings.chime) { unlockAudio(); chime(); } break;
    case 'copy': copyBackup(); break;
    case 'download': downloadBackup(); break;
    case 'import': importBackup(); break;
    case 'reset': if (!confirmReset) { confirmReset = true; render(); } else { S = fresh(); save(); confirmReset = false; view = 'today'; render(); toast('Reset'); } break;
  }
});
document.addEventListener('change', e => { if (e.target.dataset.a === 'daystart') { S.settings.dayStart = +e.target.value; save(); render(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (S.active && S.active.running) wake(true); if (AC && AC.state === 'suspended') AC.resume(); tick(); if (view === 'today') render(); } });

/* ---------- boot ---------- */
S = load();
if (location.search.includes('demo')) { // screenshot state only, never saved
  noSave = true; const k = dayKey();
  setRec(k, 'gym', { sec: 3840, done: true }); setRec(k, 'gainer', { sec: 0, done: true }); setRec(k, 'read', { sec: 1380, done: false });
  S.active = { id: 'biz', key: k, startedAt: Date.now() - 4662e3, acc: 0, running: true, chimed: false };
  for (let i = 1; i <= 6; i++) scheduled(addDays(k, -i)).forEach(t => setRec(addDays(k, -i), t.id, { sec: t.type === 'tick' ? 0 : 3600, done: i !== 3 || t.id === 'gym' }));
  if (location.search.includes('ov')) setTimeout(() => openOverlay('biz'), 50);
  const vm = location.search.match(/v=(\w+)/); if (vm) view = vm[1];
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
if ('serviceWorker' in navigator && !noSave) navigator.serviceWorker.register('./sw.js').catch(() => { });
render();
if (S.active) { if (S.active.running) wake(true); }
tickTimer = setInterval(tick, 500);
