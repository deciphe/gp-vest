// ==UserScript==
// @name         GP. Dashboard for Vest
// @namespace    https://github.com/deciphe/gp-vest
// @version      1.9.0
// @description  Your whole Vest profile: every account, every trade, what you spent and what you got paid. Plus affiliate earnings. Runs in your browser.
// @author       GP.
// @match        https://next.vestmarkets.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @updateURL    https://gigaprop.xyz/gp-vest.user.js
// @downloadURL  https://gigaprop.xyz/gp-vest.user.js
// ==/UserScript==

(function () {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ---------- local storage (Tampermonkey) ----------
  const KEYS = ['analytics', 'payouts', 'payoutsAt', 'withdrawals', 'withdrawalsAt', 'theme'];
  const store = {
    get: k => GM_getValue(k, null),
    set: (k, v) => { GM_setValue(k, v); document.dispatchEvent(new Event('gp-update')); },
    all: () => Object.fromEntries(KEYS.map(k => [k, GM_getValue(k, null)]))
  };

  if (typeof GM_addValueChangeListener === 'function') ['analytics', 'payouts', 'withdrawals'].forEach(k => GM_addValueChangeListener(k, (n, o, v, remote) => { if (remote) document.dispatchEvent(new Event('gp-update')); }));

  // ---------- read the data Vest's own pages load ----------
  // Copies JSON responses only. Never reads request headers, tokens or passwords.
  const WANT = /api-gateway[^/]*\/v\d+\//i;
  const pick = (x, ...ks) => { for (const k of ks) if (x[k] != null && x[k] !== '') return x[k]; };
  const iso = v => v == null ? null : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : v;
  const STRONG = /^(trader_?amount|requested_?amount|payout_?amount)/i;
  const keys = x => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x) : [];
  const strong = x => keys(x).some(k => STRONG.test(k));
  const weak = x => { const k = keys(x).join(' '); return /\bid\b/.test(k) && /amount/i.test(k) && /status|state/i.test(k) && /created/i.test(k); };
  function normPayout(x) {
    const cents = pick(x, 'trader_amount_cents', 'traderAmountCents', 'amount_cents', 'amountCents');
    return {
      id: String(pick(x, 'id', 'payout_id', 'payoutId', 'withdrawal_id', 'uuid')),
      account_id: String(pick(x, 'account_id', 'accountId', 'source_account_id', 'sourceAccountId') || ''),
      trader_amount: cents != null ? Number(cents) / 100 : Number(pick(x, 'trader_amount', 'traderAmount', 'payout_amount', 'payoutAmount', 'amount', 'requested_amount', 'requestedAmount') || 0),
      status: String(pick(x, 'status', 'state') || ''),
      created_at: iso(pick(x, 'created_at', 'createdAt', 'created_at_ms', 'createdAtMs', 'requested_at', 'requestedAt')),
      executed_at: iso(pick(x, 'executed_at', 'executedAt', 'executed_at_ms', 'completed_at', 'completedAt', 'paid_at', 'paidAt'))
    };
  }
  function findPayouts(url, b, depth) {
    if (depth > 3 || !b || typeof b !== 'object') return null;
    const loose = /payout|withdraw/i.test(url);
    if (Array.isArray(b)) return b.some(x => strong(x) || (loose && weak(x))) ? b.filter(x => strong(x) || (loose && weak(x))) : null;
    for (const k in b) { const r = findPayouts(url, b[k], depth + 1); if (r) return r; }
    return null;
  }
  const isWd = x => { const k = keys(x).join(' '); return /tx_?hash|recipient|destination|to_address|toAddress|network|chain/i.test(k) && /amount/i.test(k) && !STRONG.test(k); };
  function findWithdrawals(url, b, depth) {
    if (!/withdraw/i.test(url) || depth > 3 || !b || typeof b !== 'object') return null;
    if (Array.isArray(b)) return b.some(isWd) ? b.filter(isWd) : null;
    for (const k in b) { const r = findWithdrawals(url, b[k], depth + 1); if (r) return r; }
    return null;
  }
  function normWithdrawal(x) {
    const cents = pick(x, 'amount_cents', 'amountCents');
    return {
      id: String(pick(x, 'id', 'withdrawal_id', 'withdrawalId', 'uuid')),
      amount: cents != null ? Number(cents) / 100 : Number(String(pick(x, 'amount', 'requested_amount', 'value') || 0).replace(/[$,]/g, '')),
      network: String(pick(x, 'network', 'chain', 'chain_name') || ({ 42161: 'Arbitrum', 8453: 'Base', 1: 'Ethereum' })[pick(x, 'chain_id', 'chainId')] || ''),
      status: String(pick(x, 'status', 'state') || ''),
      created_at: iso(pick(x, 'created_at', 'createdAt', 'created_at_ms', 'requested_at')),
      updated_at: iso(pick(x, 'updated_at', 'updatedAt', 'executed_at', 'completed_at'))
    };
  }
  function saveWithdrawals(list) {
    const cur = store.get('withdrawals') || {};
    list.forEach(x => { if (x.id && x.id !== 'undefined' && x.created_at) cur[x.id] = x; });
    store.set('withdrawals', cur); store.set('withdrawalsAt', Date.now());
  }
  function savePayouts(list) {
    const cur = store.get('payouts') || {};
    list.forEach(x => { if (x.id && x.id !== 'undefined' && x.created_at) cur[x.id] = x; });
    store.set('payouts', cur); store.set('payoutsAt', Date.now());
  }
  // Vest's own Export CSV has the full history: read it when it is made.
  function parseCSV(t) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const h = (rows.shift() || []).map(s => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    return rows.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
  }
  function takeCSV(text) {
    try {
      const rows = parseCSV(String(text).replace(/^﻿/, ''));
      if (!rows.length) return;
      const k = Object.keys(rows[0]).join(' ');
      if (/trader_amount|requested_amount/.test(k)) savePayouts(rows.map(normPayout));
      else if (/^withdraw/i.test(lastTab) && /amount/.test(k) && /status/.test(k)) saveWithdrawals(rows.map(normWithdrawal));
    } catch (e) {}
  }
  let lastTab = '';
  document.addEventListener('click', e => { try { const el = e.target.closest('button,[role=tab],a'); const s = el && el.textContent.trim(); if (s && s.length < 30 && !/export/i.test(s)) lastTab = s; } catch (er) {} }, true);
  const COU = W.URL.createObjectURL;
  W.URL.createObjectURL = function (o) {
    try { if (o instanceof W.Blob && o.size < 5e6 && /csv|text|octet|^$/i.test(o.type || '')) o.text().then(t => { if (/,/.test(t.split('\n')[0] || '')) takeCSV(t); }).catch(() => {}); } catch (e) {}
    return COU.apply(this, arguments);
  };
  const quiet = a => { try { const h = a.getAttribute('href') || ''; if (/^data:text\/csv/i.test(h)) takeCSV(decodeURIComponent(h.split(',').slice(1).join(','))); return W.__gpSilent > Date.now() && /^(blob:|data:)/.test(h); } catch (e) { return false; } };
  const AC = W.HTMLAnchorElement.prototype.click;
  W.HTMLAnchorElement.prototype.click = function () { if (quiet(this)) return; return AC.apply(this, arguments); };
  const DE = W.EventTarget.prototype.dispatchEvent;
  W.EventTarget.prototype.dispatchEvent = function (e) { if (this instanceof W.HTMLAnchorElement && e && e.type === 'click' && quiet(this)) return true; return DE.apply(this, arguments); };
  const qp = (url, k) => { try { return new URL(url, location.href).searchParams.get(k); } catch (e) { return null; } };
  // Drop analytics saved by older versions (they could keep a short date range).
  { const a = GM_getValue('analytics', null); if (a && !a.from) GM_setValue('analytics', null); }
  function handle(url, b) {
    const now = Date.now();
    if (b && b.totals && Array.isArray(b.daily) && 'due_cents' in b.totals) {
      const cur = store.get('analytics') || {};
      const from = qp(url, 'from_date') || (b.daily[0] && b.daily[0].date) || '9999';
      const byDate = {};
      (cur.daily || []).forEach(r => { byDate[r.date] = r; });
      b.daily.forEach(r => { byDate[r.date] = r; });
      const daily = Object.values(byDate).sort((x, y) => x.date < y.date ? -1 : 1);
      const act = daily.find(r => ['due_cents', 'pending_cents', 'paid_cents', 'net_cents'].some(k => r[k]));
      const wider = !cur.totals || from <= (act ? act.date : from);
      store.set('analytics', { totals: wider ? b.totals : cur.totals, from: wider ? from : cur.from, daily, at: now });
      return;
    }
    if (/\/affiliate\//i.test(url)) return;
    const wd = findWithdrawals(url, b, 0);
    if (wd && wd.length) saveWithdrawals(wd.map(normWithdrawal));
    const arr = findPayouts(url, b, 0);
    if (arr && arr.length) savePayouts(arr.map(normPayout));
  }
  const take = (url, text) => { if (!WANT.test(url) || !text || text.length > 3e6) return; const s = text.trimStart(); if (s[0] !== '{' && s[0] !== '[') { if (/^[\w" ]+(,[\w" ]+)+\r?\n/.test(s)) takeCSV(s); return; } try { handle(url, JSON.parse(s)); } catch (e) {} };
  const f = W.fetch;
  W.fetch = async function (...a) {
    const r = await f.apply(this, a);
    try { const u = (a[0] && a[0].url) || String(a[0]); if (WANT.test(u)) r.clone().text().then(t => take(u, t)).catch(() => {}); } catch (e) {}
    return r;
  };
  const XO = W.XMLHttpRequest.prototype.open, XS = W.XMLHttpRequest.prototype.send;
  W.XMLHttpRequest.prototype.open = function (m, u) { this.__gpu = String(u); return XO.apply(this, arguments); };
  // Profile scraper reuses the signed-in session Vest's own page already uses.
  // Kept in memory only, used only for read-only GETs to Vest's API, never saved or sent anywhere else.
  let AUTH = null;
  const XH = W.XMLHttpRequest.prototype.setRequestHeader;
  W.XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (/^authorization$/i.test(k) && /api-gateway[^/]*vestmarkets\.com/.test(this.__gpu || '')) AUTH = v; } catch (e) {} return XH.apply(this, arguments); };
  W.XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => { try { if (this.responseType === '' || this.responseType === 'text') take(this.__gpu, this.responseText); } catch (e) {} });
    return XS.apply(this, arguments);
  };


  // ---------- MFP site map (GP. Lab only): notes which data the MFP site loads, as shapes without any values ----------
  if (/(^|\.)myfundedperpetuals\.com$/.test(location.hostname)) {
    const shape = (v, d) => { if (v === null) return 'null'; if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1), 'x' + v.length] : []; if (typeof v === 'object') { if (d > 5) return 'object'; const o = {}; Object.keys(v).slice(0, 60).forEach(k => { o[k] = shape(v[k], d + 1); }); return o; } return typeof v; };
    const norm = u => { try { const x = new URL(u, location.href); return x.host + x.pathname.replace(/\/[0-9a-f-]{8,}|\/\d{3,}/gi, '/:id') + (x.search ? '?' + [...x.searchParams.keys()].join('&') : ''); } catch (e) { return String(u).slice(0, 120); } };
    const note = (method, url, hdrs, text) => { try { if (!/myfundedperpetuals\.com|^\//.test(url) || !text || text.length > 4e6) return; const s = text.trimStart(); if (s[0] !== '{' && s[0] !== '[') return;
      const m = GM_getValue('mfpMap', {}) || {}; const k = method + ' ' + norm(url); m[k] = { headers: hdrs, shape: shape(JSON.parse(s), 0), at: Date.now() }; const keys = Object.keys(m); if (keys.length > 250) delete m[keys[0]]; GM_setValue('mfpMap', m); } catch (e) {} };
    const F0 = W.fetch;
    W.fetch = async function (i, o) { const r = await F0.apply(this, arguments); try { const u = (i && i.url) || String(i), m = ((o && o.method) || (i && i.method) || 'GET').toUpperCase(); const hn = []; try { new Headers((o && o.headers) || (i && i.headers) || {}).forEach((v, k) => hn.push(k)); } catch (e) {} r.clone().text().then(t => note(m, u, hn, t)).catch(() => {}); } catch (e) {} return r; };
    const O0 = W.XMLHttpRequest.prototype.open, H0 = W.XMLHttpRequest.prototype.setRequestHeader, S0 = W.XMLHttpRequest.prototype.send;
    W.XMLHttpRequest.prototype.open = function (m, u) { this.__mm = String(m).toUpperCase(); this.__mu = String(u); this.__mh = []; return O0.apply(this, arguments); };
    W.XMLHttpRequest.prototype.setRequestHeader = function (k) { try { this.__mh.push(String(k).toLowerCase()); } catch (e) {} return H0.apply(this, arguments); };
    W.XMLHttpRequest.prototype.send = function () { this.addEventListener('load', () => { try { if (this.responseType === '' || this.responseType === 'text') note(this.__mm, this.__mu, this.__mh, this.responseText); else if (this.responseType === 'json') note(this.__mm, this.__mu, this.__mh, JSON.stringify(this.response)); } catch (e) {} }); return S0.apply(this, arguments); };
  }

  // ---------- dashboard overlay ----------
  const CSS = "\n:host{--rgb:239,226,189;--hi1:#fff7df;--hi2:#efe2bd;--hi3:#c9b27a;--btn1:#f6ecd0;--btn2:#d9c48c;--bg:#0f0f0e;--card:rgba(28,28,26,.72);--card2:#232321;--line:rgba(247,246,242,.09);--line2:rgba(var(--rgb),.22);--fg:#f7f6f2;--mute:rgba(247,246,242,.6);--faint:rgba(247,246,242,.36);\n--cream:#efe2bd;--gold:#d9c48c;--mint:#8fdcb4;--sans:\"Manrope\",system-ui,-apple-system,\"Segoe UI\",sans-serif;color-scheme:dark}\n:host([data-theme=\"mono\"]){--rgb:226,226,232;--hi1:#ffffff;--hi2:#e6e6ea;--hi3:#9a9aa2;--btn1:#f2f2f4;--btn2:#a9a9b0;--bg:#0e0e10;--card:rgba(24,24,27,.8);--line:rgba(255,255,255,.08);--cream:#ececf0;--gold:#c9c9cf;--mint:#b4e6cc}\n*{box-sizing:border-box}\n\n.root{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--bg);color:var(--fg);font-family:var(--sans);-webkit-font-smoothing:antialiased;margin:0;padding-block:40px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));overflow-x:hidden;overflow-y:auto}\n#sky{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}\n.wrap{position:relative;z-index:1;max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:16px}\n.top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:0 4px 8px}\n.brand{font-size:20px;font-weight:800;letter-spacing:-.04em}.brand i{font-style:normal;color:var(--cream)}\n.brand span{margin-left:14px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.live{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;color:var(--mute)}\n.hdr-r{display:flex;align-items:center;gap:18px;flex-wrap:wrap}\n.pay{display:flex;align-items:center;gap:12px;padding:6px 6px 6px 18px;border-radius:99px;border:1px solid var(--line2);background:linear-gradient(150deg,rgba(var(--rgb),.12),rgba(var(--rgb),.02));text-decoration:none;color:var(--fg);backdrop-filter:blur(14px);transition:border-color .2s,transform .2s}\n.pay:hover{border-color:rgba(var(--rgb),.5);transform:translateY(-1px)}\n.pay:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n.pay-l{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.pay-v{font-size:17px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}\n.pay-b{display:flex;align-items:center;gap:6px;padding:9px 16px;border-radius:99px;background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413;font-size:13px;font-weight:800;letter-spacing:-.01em}\n.live b{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 5px rgba(143,220,180,.14),0 0 14px var(--mint);animation:pulse 2.4s ease-in-out infinite}\n@keyframes pulse{50%{box-shadow:0 0 0 8px rgba(143,220,180,.04),0 0 18px var(--mint)}}\n.card{position:relative;background:var(--card);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:26px;padding:28px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 30px 80px -40px rgba(0,0,0,.8)}\n.corner:before{content:\"\";position:absolute;left:14px;top:14px;width:64px;height:64px;border-left:1px solid var(--line2);border-top:1px solid var(--line2);border-top-left-radius:8px;pointer-events:none}\n.lab{font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.row1{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px}\n@media (max-width:980px){.row1{grid-template-columns:1fr}}\n.hero{min-height:420px;display:flex;flex-direction:column;overflow:hidden}\n#moon{position:absolute;right:-40px;top:-40px;width:520px;height:520px;pointer-events:none;opacity:.95}\n.hero .big{margin-top:auto;font-size:clamp(64px,10vw,150px);font-weight:800;letter-spacing:-.065em;line-height:.86;font-variant-numeric:tabular-nums;\nbackground:linear-gradient(180deg,var(--hi1) 0%,var(--hi2) 55%,var(--hi3) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 40px rgba(var(--rgb),.18))}\n.hero .big small{font-size:.38em;letter-spacing:-.03em}\n.hero .of{margin-top:14px;font-size:16px;font-weight:600;color:var(--mute)}\n.hero .of b{color:var(--fg);font-weight:800}\n.track{margin-top:26px;position:relative;height:14px;border-radius:99px;background:rgba(247,246,242,.07);overflow:hidden}\n.track span{position:absolute;top:0;bottom:0;border-radius:99px}\n.legend{margin-top:12px;display:flex;gap:18px;flex-wrap:wrap;font-size:12px;font-weight:600;color:var(--mute)}\n.legend i{display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:7px;vertical-align:1px}\n.side{display:grid;grid-template-rows:auto 1fr;gap:16px}\n.next{overflow:hidden;background:linear-gradient(150deg,rgba(var(--rgb),.13),rgba(var(--rgb),.02) 55%),var(--card);border-color:var(--line2)}\n.next .when{margin-top:14px;font-size:64px;font-weight:800;letter-spacing:-.06em;line-height:.9}\n.next .amt{margin-top:18px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}\n.next .amt b{font-size:40px;font-weight:800;letter-spacing:-.045em;color:var(--cream);font-variant-numeric:tabular-nums}\n.next .amt span{font-size:13px;font-weight:600;color:var(--mute)}\n.ring{position:absolute;right:24px;top:24px;width:76px;height:76px}\n.stats{display:grid;grid-template-columns:1fr 1fr;gap:16px}\n.stat{padding:22px}\n.stat b{display:block;margin-top:12px;font-size:30px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums}\n.stat span{display:block;margin-top:6px;font-size:12px;font-weight:600;color:var(--faint)}\n.stat.hl b{color:var(--cream)}\n.cal-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}\n.cal-head h2{margin:8px 0 0;font-size:30px;font-weight:800;letter-spacing:-.04em}\n.cal-head p{margin:6px 0 0;font-size:14px;font-weight:600;color:var(--mute)}\n.keys{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;font-weight:600;color:var(--mute)}\n.keys i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;vertical-align:-1px}\n.wk{font-size:13px;font-weight:600;color:var(--mute)}.wk b{color:var(--cream);font-weight:800}\n.dow,.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}\n.dow{margin-top:20px}.dow span{padding-left:4px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.cal{margin-top:10px}\n.cell{position:relative;min-height:108px;border-radius:18px;padding:14px 16px;background:rgba(247,246,242,.025);border:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden}\n.cell.pad{background:transparent;border-color:transparent}\n.cell .d{font-size:12px;font-weight:700;color:var(--faint)}\n.cell .v{margin-top:auto;font-size:clamp(15px,1.7vw,26px);font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums;position:relative;z-index:1}\n.cell .fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(var(--rgb),.0),rgba(var(--rgb),.22));}\n.cell.zero .v{color:rgba(247,246,242,.18)}\n.cell.today{border-color:rgba(143,220,180,.5);box-shadow:0 0 0 1px rgba(143,220,180,.25),0 0 30px -8px rgba(143,220,180,.5)}\n.cell.today .d{color:var(--mint)}\n.cell.today .fill{background:linear-gradient(180deg,rgba(143,220,180,0),rgba(143,220,180,.22))}\n.cell.peak{border-color:rgba(var(--rgb),.4)}\n.cell.peak .v{color:var(--cream);text-shadow:0 0 24px rgba(var(--rgb),.35)}\n.cell.past{opacity:.35}\n@media (max-width:760px){.dow,.cal{gap:5px}.cell{min-height:70px;padding:8px;border-radius:12px}.dow span{letter-spacing:.05em}}\n#chart{display:block;width:100%;min-width:760px;height:auto}\nsvg text{font-family:var(--sans)}\n.tip{position:fixed;z-index:5;pointer-events:none;padding:10px 12px;border-radius:12px;background:#1f1f1d;border:1px solid var(--line2);font-size:12px;font-weight:600;color:var(--mute);opacity:0;transition:opacity .12s;box-shadow:0 14px 40px rgba(0,0,0,.5)}\n.tip b{display:block;font-size:18px;font-weight:800;color:var(--cream);letter-spacing:-.03em}\n.trig{width:100%;display:flex;align-items:center;gap:14px;padding:18px 22px;border-radius:20px;border:1px solid var(--line);background:var(--card);backdrop-filter:blur(18px);color:var(--mute);font:600 15px var(--sans);cursor:pointer;text-align:left;transition:border-color .2s,background .2s,color .2s}\n.trig:hover,.trig[aria-expanded=\"true\"]{border-color:var(--line2);background:rgba(var(--rgb),.05);color:var(--fg)}\n.trig:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n.trig b{color:var(--cream)}\n.stack{display:flex}.stack i{width:14px;height:14px;border-radius:5px;border:2px solid #1c1c1a;margin-left:-4px}.stack i:first-child{margin-left:0}\n.chev{margin-left:auto;transition:transform .25s}\n.trig[aria-expanded=\"true\"] .chev{transform:rotate(180deg)}\n.menu{overflow:hidden;max-height:0;opacity:0;transition:max-height .5s ease,opacity .25s,margin .25s}\n.menu.open{max-height:2600px;opacity:1;margin-top:12px}\n.menu ol{list-style:none;margin:0;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;background:var(--card);border:1px solid var(--line);border-radius:22px;backdrop-filter:blur(18px)}\n.menu li{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:14px;background:rgba(247,246,242,.025);border:1px solid transparent}\n.menu li.soon{border-color:rgba(var(--rgb),.18);background:rgba(var(--rgb),.05)}\n.menu li.today{border-color:rgba(143,220,180,.35);background:rgba(143,220,180,.07)}\n.dot{width:10px;height:36px;border-radius:99px;flex:none}\n.who{font-size:14px;font-weight:700;letter-spacing:-.01em}\n.meta{font-size:12px;color:var(--faint);font-weight:600;margin-top:3px}\n.tag{margin-left:auto;text-align:right;font-variant-numeric:tabular-nums}\n.tag b{display:block;font-size:17px;font-weight:800;letter-spacing:-.025em}\n.tag span{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--faint);margin-top:3px}\nli.locked .who,li.locked .tag b{color:var(--mute)}\nli.soon .tag span{color:var(--cream)}\nli.today .tag span,li.open .tag span{color:var(--mint)}\n.note{font-size:12px;color:var(--faint);line-height:1.6;padding:4px 6px;max-width:80ch}\n@media (prefers-reduced-motion:reduce){.menu,.chev,.trig{transition:none}.live b{animation:none}}\n.sec{display:flex;align-items:baseline;gap:16px;padding:28px 4px 0;border-top:1px solid var(--line);margin-top:12px}\n.sec .lab{margin:0}\n#moon2{position:absolute;right:-40px;top:-40px;width:520px;height:520px;pointer-events:none;opacity:.95}\n\n[hidden]{display:none!important}\nsection{display:flex;flex-direction:column;gap:16px}\n.empty{font-size:18px;font-weight:700}\n.pay-b.ref{cursor:pointer;border:0;font-family:var(--sans)}\n.seg{display:flex;gap:2px;padding:3px;border-radius:99px;background:rgba(247,246,242,.05);border:1px solid var(--line)}\n.seg button{font:700 11.5px var(--sans);padding:6px 12px;border-radius:99px;border:0;background:transparent;color:var(--mute);cursor:pointer}\n.seg button.on{background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413}\n.seg button:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n\n.duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 20px;align-items:stretch}\n.duo>*{min-width:0}\n.duo .hero{min-height:380px;container-type:inline-size}\n.duo .hero .big{font-size:clamp(56px,15.5cqi,128px)}\n.duo #moon,.duo #moon2{position:absolute;top:-95px;width:560px;height:560px;pointer-events:none;opacity:.95;transform:none}\n.a.hero #moon{right:-290px;left:auto}\n.p.hero #moon2{left:-290px;right:auto}\n.p.hero{text-align:right}\n.p.hero .legend{justify-content:flex-end}\n.p.hero.corner:before{left:auto;right:14px;border-left:0;border-right:1px solid var(--line2);border-top-left-radius:0;border-top-right-radius:8px}\n.lab .k{color:var(--cream);margin-right:10px}\n.duo .next{min-height:190px}.duo .next .when{font-size:56px}.duo .next .amt b{font-size:36px}\n.duo .stats{grid-template-columns:1fr 1fr}\n.duo .stat{padding:20px}.duo .stat b{font-size:clamp(20px,1.75vw,28px);margin-top:10px}\n@media (min-width:1280px){.duo .stats{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.duo .stat{padding:18px 16px}.duo .stat .lab{letter-spacing:.16em;font-size:10.5px}}\n.ledger{display:flex;flex-direction:column;min-height:0}\n.ledger .menu.open{margin-top:10px}\n.ledger .menu ol{max-height:452px;overflow:auto;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));scrollbar-width:thin;scrollbar-color:rgba(var(--rgb),.25) transparent;\n-webkit-mask-image:linear-gradient(180deg,#000 88%,transparent);mask-image:linear-gradient(180deg,#000 88%,transparent);padding-bottom:40px}\n.ledger .menu li{padding:11px 13px;gap:12px}\n.ledger .tag b{font-size:16px}\n.ledger .dot{height:32px;width:8px}\n@media (max-width:1060px){.duo{grid-template-columns:1fr}.duo .a{order:1}.duo .p{order:2}\n.p.hero{text-align:left}.p.hero .legend{justify-content:flex-start}.a.hero #moon,.p.hero #moon2{left:auto;right:-150px;top:-60px;width:360px;height:360px}\n.p.hero.corner:before{right:auto;left:14px;border-right:0;border-left:1px solid var(--line2);border-top-right-radius:0;border-top-left-radius:8px}}\n\n.tbtn{position:relative;width:42px;height:42px;border-radius:14px;border:1px solid var(--line2);cursor:pointer;padding:0;display:grid;place-items:center;overflow:hidden;\nbackground:radial-gradient(120% 90% at 50% 120%,rgba(var(--rgb),.22),transparent 60%),linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.01)),rgba(20,20,19,.6);backdrop-filter:blur(14px);\nbox-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 30px -12px rgba(0,0,0,.8);transition:border-color .25s,transform .25s}\n.tbtn svg{width:26px;height:auto;filter:drop-shadow(0 0 8px rgba(var(--rgb),.35));transition:transform .4s cubic-bezier(.2,.8,.2,1)}\n.tbtn:after{content:\"\";position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.18) 50%,transparent 65%);transform:translateX(-120%);transition:transform .7s}\n.tbtn:hover{border-color:rgba(var(--rgb),.55);transform:translateY(-1px)}.tbtn:hover:after{transform:translateX(120%)}\n.tbtn:active svg{transform:scale(.88)}\n.tbtn:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n\n.lock{display:flex;align-items:center;gap:14px}\n.lock .vm{position:relative;display:block;width:58px}\n.lock .vm svg{display:block;width:100%;height:auto;filter:drop-shadow(0 0 14px rgba(var(--rgb),.35))}\n.lock .vm:after{content:\"\";position:absolute;left:-30%;right:-30%;bottom:-7px;height:1px;background:linear-gradient(90deg,transparent,rgba(var(--rgb),.55),transparent)}\n.lock .vm:before{content:\"\";position:absolute;left:0;right:0;bottom:-16px;height:22px;background:radial-gradient(50% 60% at 50% 0,rgba(var(--rgb),.22),transparent);pointer-events:none}\n.lock .lx{font-size:15px;font-weight:600;color:var(--faint);transform:translateY(-1px)}\n\n.tbtn{width:36px;height:36px;border-radius:99px}\n.tbtn .sw{width:18px;height:18px;border-radius:99px;background:linear-gradient(145deg,#ffffff,#e6e6ea 45%,#9a9aa2);box-shadow:0 0 0 3px rgba(255,255,255,.06),0 0 14px rgba(226,226,232,.45);transition:transform .3s}\n:host([data-theme=\"mono\"]) .tbtn .sw{background:linear-gradient(145deg,#fff7df,#efe2bd 45%,#c9b27a);box-shadow:0 0 0 3px rgba(239,226,189,.08),0 0 14px rgba(239,226,189,.5)}\n.tbtn:hover .sw{transform:scale(1.12)}\n.x{width:34px;height:34px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.04);color:var(--mute);font:700 14px var(--sans);cursor:pointer;display:grid;place-items:center}.x:hover{border-color:var(--line2);color:var(--fg)}\n.rf{width:34px;height:34px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.04);color:var(--cream);cursor:pointer;display:grid;place-items:center;padding:0;transition:border-color .25s,transform .25s}.rf:hover{border-color:var(--line2);transform:translateY(-1px)}.rf.spin svg{animation:gpspin .9s linear infinite}.rf:disabled{cursor:default}@keyframes gpspin{to{transform:rotate(360deg)}}\n.lseg{display:inline-flex;gap:4px;padding:4px;margin:0 0 10px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.03)}.lseg button{font:700 12px var(--sans);letter-spacing:.01em;color:var(--mute);background:none;border:0;padding:7px 14px;border-radius:99px;cursor:pointer}.lseg button.on{background:rgba(var(--rgb),.14);color:var(--fg)}.lseg[hidden]{display:none}\n.pf{border:1px solid var(--line2);background:linear-gradient(150deg,rgba(var(--rgb),.12),rgba(var(--rgb),.02));color:var(--fg);font:800 13px var(--sans);padding:9px 16px;border-radius:99px;cursor:pointer}.pf:hover{border-color:rgba(var(--rgb),.5)}\n@media (max-width:640px){.next .when{font-size:44px!important;padding-right:86px}.hero .lab{position:relative;z-index:2}.duo #moon,.duo #moon2,.a.hero #moon,.p.hero #moon2{width:300px!important;height:300px!important;right:-110px!important;left:auto!important;top:-70px!important}.duo .hero{min-height:320px}.card{padding:22px}.of{font-size:14px}}\n@media (max-width:420px){.hdr-r{width:100%;gap:10px}.pay{flex:1 1 auto;min-width:0;justify-content:space-between;padding-left:14px}.pay-l{display:none}.pay-b{padding:8px 12px;white-space:nowrap}}\n";
  const BODY = "\n<canvas id=\"sky\"></canvas>\n<div class=\"wrap\">\n <div class=\"top\">\n  <div class=\"lock\" aria-label=\"Vest \u00d7 GIGAPROP\"><span class=\"vm\"><svg viewBox=\"-20 -30 589 400\" aria-hidden=\"true\"><path d=\"M130.463 1.64132L2.10114 104.296C0.259255 105.778 0.259255 108.571 2.10114 110.032L136.429 217.472V4.52427C136.429 1.43111 132.865 -0.260628 130.453 1.64132H130.463Z\" fill=\"url(#vg1)\"/><path d=\"M546.559 104.307L418.198 1.6418C415.785 -0.290179 412.222 1.43159 412.222 4.52475V217.483L546.559 110.043C548.401 108.561 548.401 105.768 546.559 104.307Z\" fill=\"url(#vg2)\"/><path d=\"M272.038 325.934L136.429 217.482V335.143C136.429 337.165 138.06 338.827 140.112 338.827H408.597C410.62 338.827 412.281 337.195 412.281 335.143V217.482L276.672 325.934C275.331 327.005 273.439 327.005 272.068 325.934H272.038Z\" fill=\"url(#vg3)\" stroke=\"var(--hi2)\" stroke-opacity=\".35\" stroke-width=\"6\"/></svg></span><span class=\"lx\">\u00d7</span><span class=\"brand\">GIGAPROP<i>.</i></span></div>\n  <div class=\"hdr-r\"><button class=\"tbtn\" id=\"theme\" aria-label=\"Switch theme\" title=\"Theme\"><i class=\"sw\"></i><svg width=\"0\" height=\"0\" style=\"position:absolute\" aria-hidden=\"true\"><defs>\n<linearGradient id=\"vg1\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi1)\" stop-opacity=\".95\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".45\"/></linearGradient>\n<linearGradient id=\"vg2\" x1=\"1\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi1)\" stop-opacity=\".85\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".2\"/></linearGradient>\n<linearGradient id=\"vg3\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi2)\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".02\"/></linearGradient></defs></svg></button><div class=\"live\"><b></b><span id=\"snap\"></span></div><button class=\"rf\" id=\"refresh\" aria-label=\"Refresh\" title=\"Refresh\"><svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 11a8 8 0 1 0-2.3 5.7\"/><path d=\"M20 4v7h-7\"/></svg></button><a class=\"pay\" id=\"payLink\" href=\"/affiliates\"><span class=\"pay-l\">Available</span><span class=\"pay-v\" id=\"avail\">$0.00</span><span class=\"pay-b\">Request payout <svg width=\"12\" height=\"12\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M3.5 8.5l5-5M4.5 3.5h4v4\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></span></a><button class=\"x\" id=\"gpClose\" aria-label=\"Close\">\u2715</button></div>\n </div>\n\n <div class=\"duo\" id=\"duo\">\n  <div class=\"a card corner hero\">\n   <canvas id=\"moon\" class=\"mc\" width=\"1040\" height=\"1040\"></canvas>\n   <div class=\"lab\"><span class=\"k\">Affiliate</span>Lifetime earned</div>\n   <div class=\"big\" id=\"net\"></div>\n   <div class=\"of\" id=\"of\"></div>\n   <div class=\"track\" id=\"track\"></div>\n   <div class=\"legend\"><span><i style=\"background:var(--mint)\"></i>Paid out</span><span><i style=\"background:var(--cream)\"></i>Unlocked</span><span><i style=\"background:rgba(var(--rgb),.38)\"></i>Next 7 days</span><span><i style=\"background:rgba(247,246,242,.14)\"></i>On hold</span></div>\n  </div>\n  <div class=\"p card corner hero\">\n   <canvas id=\"moon2\" class=\"mc\" width=\"1040\" height=\"1040\"></canvas>\n   <div class=\"lab\"><span class=\"k\">Payouts</span>Total</div>\n   <div class=\"big\" id=\"pRecv\"></div>\n   <div class=\"of\" id=\"pOf\"></div>\n   <div class=\"track\" id=\"pTrack\"></div>\n   <div class=\"legend\"><span><i style=\"background:var(--mint)\"></i>Received</span><span><i style=\"background:var(--cream)\"></i>Processing</span></div>\n  </div>\n\n  <div class=\"a card next\">\n   <svg class=\"ring\" viewBox=\"0 0 76 76\" id=\"ring\"></svg>\n   <div class=\"lab\">Next unlock</div>\n   <div class=\"when\" id=\"nWhen\"></div>\n   <div class=\"amt\"><b id=\"nAmt\"></b><span id=\"nFrom\"></span></div>\n  </div>\n  <div class=\"p card next\">\n   <svg class=\"ring\" viewBox=\"0 0 76 76\" id=\"pring\"></svg>\n   <div class=\"lab\">Arriving</div>\n   <div class=\"when\" id=\"pWhen\"></div>\n   <div class=\"amt\"><b id=\"pAmt\"></b><span id=\"pCnt\"></span></div>\n  </div>\n\n  <div class=\"a stats\">\n   <div class=\"card stat hl\"><div class=\"lab\">Next 7 days</div><b id=\"s7\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">On hold</div><b id=\"sHeld\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Paid out</div><b id=\"sPaid\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Fully unlocked</div><b id=\"sEnd\"></b></div>\n  </div>\n  <div class=\"p stats\">\n   <div class=\"card stat hl\"><div class=\"lab\">Largest</div><b id=\"pMax\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\" id=\"pAvgL\">Average</div><b id=\"pAvg\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Payouts</div><b id=\"pN\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Accounts paid</div><b id=\"pAcc\"></b></div>\n  </div>\n\n  <div class=\"a ledger\">\n   <button class=\"trig\" id=\"trig\" aria-expanded=\"true\" aria-controls=\"menu\"><span class=\"stack\" id=\"stack\"></span><span id=\"trigTxt\"></span><svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>\n   <div class=\"menu open\" id=\"menu\"><ol id=\"list\"></ol></div>\n  </div>\n  <div class=\"p ledger\">\n   <button class=\"trig\" id=\"ptrig\" aria-expanded=\"true\" aria-controls=\"pmenu\"><span class=\"stack\" id=\"pstack\"></span><span id=\"ptrigTxt\"></span><svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>\n   <div class=\"menu open\" id=\"pmenu\"><div class=\"lseg\" id=\"pseg\"><button data-v=\"pay\" class=\"on\">Payouts</button><button data-v=\"wd\">Withdrawals</button></div><ol id=\"plist\"></ol></div>\n  </div>\n </div>\n <div class=\"card empty\" id=\"empty\" hidden>Open Vest Affiliates or Portfolio and press the GP. button.</div>\n\n</div>\n<div class=\"tip\" id=\"tip\"></div>\n\n\n";
  function fonts() {
    if (document.getElementById('gp-font')) return;
    const l = document.createElement('link'); l.id = 'gp-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap';
    (document.head || document.documentElement).appendChild(l);
  }

  // ---------- GP. Flat: one flat black layer over every screen ----------
  const VEST_SVG = '<svg viewBox="0 0 549 340" aria-hidden="true"><defs><linearGradient id="fv1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b4b0a7"/><stop offset="1" stop-color="#4c4a46"/></linearGradient><linearGradient id="fv2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a968e"/><stop offset="1" stop-color="#3e3c39"/></linearGradient><linearGradient id="fv3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3835"/><stop offset="1" stop-color="#8e8a82"/></linearGradient></defs><path d="M130.463 1.64132L2.10114 104.296C0.259255 105.778 0.259255 108.571 2.10114 110.032L136.429 217.472V4.52427C136.429 1.43111 132.865 -0.260628 130.453 1.64132H130.463Z" fill="url(#fv1)"/><path d="M546.559 104.307L418.198 1.6418C415.785 -0.290179 412.222 1.43159 412.222 4.52475V217.483L546.559 110.043C548.401 108.561 548.401 105.768 546.559 104.307Z" fill="url(#fv2)"/><path d="M272.038 325.934L136.429 217.482V335.143C136.429 337.165 138.06 338.827 140.112 338.827H408.597C410.62 338.827 412.281 337.195 412.281 335.143V217.482L276.672 325.934C275.331 327.005 273.439 327.005 272.068 325.934H272.038Z" fill="url(#fv3)"/></svg>';
  function FLAT(S, M, P) {
    return `
${S}{--bg:#0b0b0b;--card:#0f0f0f;--card2:#151515;--line:rgba(238,234,226,.075);--line2:rgba(238,234,226,.15);--fg:#eeeae2;--mute:#a39e94;--faint:rgba(238,234,226,.42);--rgb:227,218,201;--cream:#e3dac9;--gold:#e3dac9;--hi1:#e3dac9;--hi2:#e3dac9;--hi3:#e3dac9;--btn1:#e3dac9;--btn2:#e3dac9;--mint:#9fd7b2;--rose:#e8988c;background:#0b0b0b}
${M}{--rgb:226,226,232;--cream:#e8e8ec;--gold:#e8e8ec;--hi1:#e8e8ec;--hi2:#e8e8ec;--hi3:#e8e8ec;--btn1:#e8e8ec;--btn2:#e8e8ec;--fg:#f1f1f3;--mute:#9e9ea5;--faint:rgba(241,241,243,.42);--bg:#0b0b0c}
${P}.card{background:var(--card);backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none;border-color:var(--line);border-radius:22px}
${P}.next{background:var(--card);border-color:var(--line)}
${P}.corner:before,${P}.vm:before,${P}.vm:after,${P}.tbtn:after{display:none}
${P}.lab,${P}.pay-l,${P}.dow span,${P}.svp span,${P}.ratio div,${P}.tag span{letter-spacing:0;text-transform:none;font-size:13px;font-weight:600;color:var(--mute)}
${P}.lab .k{color:var(--fg);font-weight:700;margin-right:8px}
${P}.duo .stat .lab{letter-spacing:0;font-size:13px}
${P}.tag span{font-size:12px}
${P}li.soon .tag span{color:var(--cream)}${P}li.today .tag span,${P}li.open .tag span{color:var(--mint)}
${P}.big,${P}.hero .big,${P}.tierBig{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:var(--cream);-webkit-text-fill-color:var(--cream);filter:none;letter-spacing:-.06em}
${P}.big.neg{color:var(--rose);-webkit-text-fill-color:var(--rose)}
${P}.next .when{color:var(--fg)}
${P}.pay{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;border-color:var(--line2)}
${P}.pay-b,${P}.pill,${P}.seg button.on,${P}.ladder span.on{background:var(--cream);color:#0b0b0b}
${P}.seg{background:transparent;border-color:var(--line)}
${P}.trig,${P}.menu,${P}.menu ol{background:var(--card);backdrop-filter:none;-webkit-backdrop-filter:none}
${P}.trig:hover,${P}.trig[aria-expanded="true"]{background:var(--card2);border-color:var(--line2)}
${P}.menu li{background:rgba(238,234,226,.02)}
${P}.menu li.soon{background:rgba(238,234,226,.04);border-color:var(--line2)}
${P}.stack i{border-color:#0f0f0f}
${P}.live b{box-shadow:none;animation:none}
${P}.tbtn,${P}.ib,${P}.x{background:transparent;border-color:var(--line)}
${P}.tbtn svg,${P}.vm svg{filter:none}
${P}.tbtn .sw,${P}.ib i{background:#cfcfd4;box-shadow:none}
${M} .tbtn .sw,${M} .ib i{background:#e3dac9;box-shadow:none}
${P}#vg1 stop:first-child{stop-color:#b4b0a7;stop-opacity:1}${P}#vg1 stop:last-child{stop-color:#4c4a46;stop-opacity:1}
${P}#vg2 stop:first-child{stop-color:#9a968e;stop-opacity:1}${P}#vg2 stop:last-child{stop-color:#3e3c39;stop-opacity:1}
${P}#vg3 stop:first-child{stop-color:#3a3835;stop-opacity:1}${P}#vg3 stop:last-child{stop-color:#8e8a82;stop-opacity:1}
${P}.vm svg path[stroke]{stroke:none}
${P}.cell{background:rgba(238,234,226,.02)}
${P}.cell.today{box-shadow:none;border-color:rgba(159,215,178,.45)}
${P}.cell.peak .v{text-shadow:none}
${P}.tip,${P}.dd .pop{background:#131313;border-color:var(--line2)}
${P}th{background:#0f0f0f;letter-spacing:0;text-transform:none;font-size:12.5px;font-weight:700}
${P}.score .bar i{background:var(--cream)}
${P}#moon,${P}#moon2,${P}.duo #moon,${P}.duo #moon2,${P}.moon{opacity:.42;-webkit-mask-image:radial-gradient(closest-side,#000 35%,transparent 100%);mask-image:radial-gradient(closest-side,#000 35%,transparent 100%)}
`;
  }
  // big faded halftone moon rising from the bottom-right corner, sparse toward the edges
  function flatField(c, rgb) {
    const x = c.getContext('2d'), w = c.width, h = c.height, dp = devicePixelRatio || 1;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    const R = Math.max(w, h * 1.4) * .62, cx = w * .98, cy = h * 1.12, s = 9 * dp;
    const hh = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
    for (let j = 0; ; j++) { const py = j * s * .866; if (py > h + s) break;
      for (let px = j % 2 ? s / 2 : 0; px < w + s; px += s) {
        const dx = (px - cx) / R, dy = (py - cy) / R, d2 = dx * dx + dy * dy; if (d2 >= 1) continue;
        const dz = Math.sqrt(1 - d2); let l = Math.max(0, dx * -.5 + dy * -.55 + dz * .67);
        l *= .86 + .14 * hh(Math.floor(px / (60 * dp)), Math.floor(py / (60 * dp)));
        const edge = Math.min(1, Math.max(0, (1 - Math.sqrt(d2)) / .45));
        const a = (.035 + .15 * l) * (.25 + .75 * edge); const r = s * .2 * (.45 + .55 * l) * (.55 + .45 * edge);
        if (a < .012 || r < .3) continue;
        x.fillStyle = 'rgba(' + rgb + ',' + a.toFixed(3) + ')'; x.beginPath(); x.arc(px, py, r, 0, 6.283); x.fill();
      } }
  }
  function closeDash() { const h = document.getElementById('gp-dash'); if (h) h.remove(); document.documentElement.style.overflow = ''; }
  function openDash(startView) {
    closeDash(); fonts();
    const HOST = document.createElement('div'); HOST.id = 'gp-dash';
    const ROOT = HOST.attachShadow({ mode: 'open' });
    ROOT.innerHTML = '<style>' + CSS + FLAT(':host', ':host([data-theme="mono"])', '') + '.root{background:var(--bg)}</style><div class="root">' + BODY + '</div>';
    document.documentElement.appendChild(HOST);
    document.documentElement.style.overflow = 'hidden';
    ROOT.getElementById('gpClose').onclick = closeDash;
    ROOT.querySelector('.lock').style.cursor = 'pointer'; ROOT.querySelector('.lock').onclick = () => { closeDash(); openGate(); };
    if (!GM_getValue('analytics', null) && !GM_getValue('payouts', null)) setTimeout(() => ROOT.getElementById('refresh').click(), 300);
    ROOT.getElementById('payLink').onclick = e => { e.preventDefault(); closeDash(); location.href = '/affiliates'; };
    mountDash(ROOT, HOST, store, startView);
    const rf = ROOT.getElementById('refresh');
    rf.onclick = async () => {
      rf.disabled = true; rf.classList.add('spin');
      await refreshAll();
      rf.disabled = false; rf.classList.remove('spin');
      document.dispatchEvent(new Event('gp-update'));
    };
  }
  // ---------- profile: every account, every closed position, what you paid, what you got paid ----------
  const PCSS = ".gpp{--rgb:239,226,189;--hi1:#fff7df;--hi2:#efe2bd;--hi3:#c9b27a;--btn1:#f6ecd0;--btn2:#d9c48c;--bg:#0f0f0e;--card:rgba(28,28,26,.72);--line:rgba(247,246,242,.09);--line2:rgba(var(--rgb),.22);--fg:#f7f6f2;--mute:rgba(247,246,242,.6);--faint:rgba(247,246,242,.36);--cream:#efe2bd;--mint:#8fdcb4;--rose:#e3a3a3;--sans:\"Manrope\",system-ui,-apple-system,\"Segoe UI\",sans-serif;\n  color-scheme:dark;color:var(--fg);background:var(--bg);font-family:var(--sans);-webkit-font-smoothing:antialiased;position:relative;min-height:100vh;padding:36px max(16px,env(safe-area-inset-left,0px)) 72px;overflow-x:hidden;box-sizing:border-box}\n.gpp[data-theme=\"mono\"]{--rgb:226,226,232;--hi1:#fff;--hi2:#e6e6ea;--hi3:#9a9aa2;--btn1:#f2f2f4;--btn2:#a9a9b0;--bg:#0e0e10;--card:rgba(24,24,27,.8);--line:rgba(255,255,255,.08);--cream:#ececf0;--mint:#b4e6cc}\n.gpp *{box-sizing:border-box}\n.gpp [hidden]{display:none!important}\n.gpp button{font-family:inherit}\n.gpp .sky{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}\n.gpp .wrap{position:relative;z-index:1;max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:16px}\n.gpp .top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:0 4px 4px}\n.gpp .lock{display:flex;align-items:center;gap:14px}\n.gpp .vm{position:relative;display:block;width:58px}\n.gpp .vm svg{display:block;width:100%;height:auto;filter:drop-shadow(0 0 14px rgba(var(--rgb),.35))}\n.gpp .vm:after{content:\"\";position:absolute;left:-30%;right:-30%;bottom:-7px;height:1px;background:linear-gradient(90deg,transparent,rgba(var(--rgb),.55),transparent)}\n.gpp .lx{font-size:15px;font-weight:600;color:var(--faint)}\n.gpp .brand{font-size:20px;font-weight:800;letter-spacing:-.04em}.gpp .brand i{font-style:normal;color:var(--cream)}\n.gpp .brand span{margin-left:12px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.gpp .hdr-r{display:flex;align-items:center;gap:14px;flex-wrap:wrap}\n.gpp .live{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;color:var(--mute)}\n.gpp .live b{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 5px rgba(143,220,180,.14),0 0 14px var(--mint)}\n.gpp .ib{width:34px;height:34px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.04);color:var(--cream);cursor:pointer;display:grid;place-items:center;padding:0;transition:border-color .2s,transform .2s}\n.gpp .ib:hover{border-color:var(--line2);transform:translateY(-1px)}\n.gpp .ib i{width:16px;height:16px;border-radius:50%;background:linear-gradient(145deg,#fff,#b9b9c0 55%,#7d7d85);box-shadow:0 0 14px rgba(226,226,232,.35)}\n.gpp[data-theme=\"mono\"] .ib i{background:linear-gradient(145deg,#fff7df,#efe2bd 55%,#c9b27a);box-shadow:0 0 14px rgba(239,226,189,.4)}\n.gpp .ib.spin svg{animation:gppspin .9s linear infinite}@keyframes gppspin{to{transform:rotate(360deg)}}\n.gpp .pill{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:99px;background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413;font-size:12.5px;font-weight:800;border:0;cursor:pointer;text-decoration:none}\n.gpp .card{position:relative;background:var(--card);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:24px;padding:24px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 30px 80px -40px rgba(0,0,0,.8);min-width:0}\n.gpp .corner:before{content:\"\";position:absolute;left:14px;top:14px;width:64px;height:64px;border-left:1px solid var(--line2);border-top:1px solid var(--line2);border-top-left-radius:8px;pointer-events:none}\n.gpp .lab{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.gpp .lab .k{color:var(--cream);margin-right:10px}\n.gpp .pos{color:var(--mint)}.gpp .neg{color:var(--rose)}\n.gpp .num{font-variant-numeric:tabular-nums}\n\n/* filters */\n.gpp .fbar{position:sticky;top:10px;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border-radius:20px}\n.gpp .seg{display:inline-flex;gap:3px;padding:3px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.03)}\n.gpp .seg button{border:0;background:none;color:var(--mute);font-size:12px;font-weight:700;padding:7px 12px;border-radius:99px;cursor:pointer;white-space:nowrap}\n.gpp .seg button.on{background:rgba(var(--rgb),.16);color:var(--fg)}\n.gpp .dd{position:relative}\n.gpp .dd>button{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:rgba(247,246,242,.03);color:var(--fg);font-size:12px;font-weight:700;padding:8px 12px;border-radius:99px;cursor:pointer;white-space:nowrap}\n.gpp .dd>button b{color:var(--cream);font-weight:800}\n.gpp .dd>button.act{border-color:var(--line2);background:rgba(var(--rgb),.1)}\n.gpp .dd .pop{position:absolute;top:calc(100% + 8px);left:0;min-width:220px;max-height:340px;overflow:auto;padding:8px;border-radius:16px;border:1px solid var(--line2);background:rgba(20,20,19,.97);box-shadow:0 24px 60px -20px rgba(0,0,0,.9);display:none;z-index:10}\n.gpp .dd.open .pop{display:block}\n.gpp .pop label{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;font-size:12.5px;font-weight:600;color:var(--mute);cursor:pointer}\n.gpp .pop label:hover{background:rgba(247,246,242,.05);color:var(--fg)}\n.gpp .pop input{accent-color:var(--cream)}\n.gpp .pop .row{display:flex;gap:6px;padding:4px 4px 8px;border-bottom:1px solid var(--line);margin-bottom:6px}\n.gpp .pop .row button{flex:1;border:1px solid var(--line);background:none;color:var(--mute);font-size:11px;font-weight:700;padding:6px;border-radius:8px;cursor:pointer}\n.gpp .dates{display:flex;align-items:center;gap:6px}\n.gpp .dates input{background:rgba(247,246,242,.04);border:1px solid var(--line);color:var(--fg);font:600 12px var(--sans);padding:7px 10px;border-radius:10px;color-scheme:dark}\n.gpp .search{background:rgba(247,246,242,.04);border:1px solid var(--line);color:var(--fg);font:600 12px var(--sans);padding:8px 12px;border-radius:99px;width:150px}\n.gpp .reset{margin-left:auto;border:0;background:none;color:var(--faint);font-size:12px;font-weight:700;cursor:pointer}\n.gpp .reset:hover{color:var(--fg)}\n.gpp .count{font-size:12px;font-weight:700;color:var(--mute)}\n\n/* hero */\n.gpp .r1{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px}\n.gpp .hero{min-height:400px;display:flex;flex-direction:column;overflow:hidden}\n.gpp .moon{position:absolute;right:-90px;top:-70px;width:520px;height:520px;pointer-events:none;opacity:.95}\n.gpp .big{margin-top:auto;font-size:clamp(56px,8.6vw,136px);font-weight:800;letter-spacing:-.065em;line-height:.86;font-variant-numeric:tabular-nums;background:linear-gradient(180deg,var(--hi1),var(--hi2) 55%,var(--hi3));-webkit-background-clip:text;background-clip:text;color:transparent;position:relative}\n.gpp .big small{font-size:.4em;letter-spacing:-.02em}\n.gpp .big.neg{background:linear-gradient(180deg,#ffe3e3,#e3a3a3 60%,#b06f6f);-webkit-background-clip:text;background-clip:text}\n.gpp .of{margin-top:16px;font-size:15px;font-weight:600;color:var(--mute);position:relative}.gpp .of b{color:var(--fg);font-weight:800}\n.gpp .chips3{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px;position:relative}\n.gpp .chips3 span{font-size:12px;font-weight:700;padding:7px 12px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.04);color:var(--mute)}\n.gpp .chips3 span b{color:var(--fg)}\n\n/* tier */\n.gpp .tier{display:flex;flex-direction:column;gap:18px;overflow:hidden}\n.gpp .tierTop{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}\n.gpp .tierBig{font-size:96px;font-weight:800;letter-spacing:-.07em;line-height:.8;background:linear-gradient(180deg,var(--hi1),var(--hi3));-webkit-background-clip:text;background-clip:text;color:transparent}\n.gpp .rating{font-size:30px;font-weight:800;letter-spacing:-.03em;color:var(--cream);text-align:right}\n.gpp .rating small{display:block;font-size:11px;letter-spacing:.2em;color:var(--faint);font-weight:700;margin-bottom:6px}\n.gpp .score{display:flex;align-items:center;gap:12px;font-size:13px;font-weight:700;color:var(--mute)}\n.gpp .score .bar{flex:1;height:8px;border-radius:99px;background:rgba(247,246,242,.07);overflow:hidden}\n.gpp .score .bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--hi3),var(--hi1))}\n.gpp .comp{display:grid;grid-template-columns:110px 1fr 74px;align-items:center;gap:12px;font-size:12.5px;font-weight:700}\n.gpp .comp span{color:var(--mute)}.gpp .comp em{font-style:normal;text-align:right;color:var(--fg);font-variant-numeric:tabular-nums}\n.gpp .comp .bar{height:6px;border-radius:99px;background:rgba(247,246,242,.07);overflow:hidden}.gpp .comp .bar i{display:block;height:100%;border-radius:99px;background:var(--cream);opacity:.85}\n.gpp .ladder{display:flex;gap:4px;margin-top:2px}\n.gpp .ladder span{flex:1;text-align:center;font-size:10.5px;font-weight:800;padding:6px 0;border-radius:8px;background:rgba(247,246,242,.04);color:var(--faint)}\n.gpp .ladder span.on{background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413}\n\n/* kpis */\n.gpp .kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}\n.gpp .kpi{padding:18px 18px 16px}\n.gpp .kpi b{display:block;margin-top:10px;font-size:clamp(20px,1.9vw,27px);font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}\n.gpp .kpi small{display:block;margin-top:6px;font-size:11.5px;font-weight:600;color:var(--faint)}\n@media (max-width:1180px){.gpp .kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}\n@media (max-width:980px){.gpp .r1{grid-template-columns:1fr}}\n@media (max-width:640px){.gpp .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.gpp .moon{width:340px;height:340px;right:-120px;top:-60px}.gpp .tierBig{font-size:72px}}\n\n/* equity */\n.gpp .eqHead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}\n.gpp .eq{position:relative;height:280px}\n.gpp .eq svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}\n.gpp .eqx{display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--faint);margin-top:10px}\n.gpp .tip{position:absolute;pointer-events:none;padding:10px 12px;border-radius:12px;background:rgba(20,20,19,.95);border:1px solid var(--line2);font-size:12px;font-weight:700;white-space:nowrap;transform:translate(-50%,-115%);display:none}\n.gpp .tip small{display:block;color:var(--faint);font-weight:600;margin-bottom:3px}\n\n/* breakdowns */\n.gpp .r3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}\n@media (max-width:1100px){.gpp .r3{grid-template-columns:1fr}}\n.gpp .bk{display:flex;flex-direction:column;gap:6px;margin-top:14px}\n.gpp .bkr{display:grid;grid-template-columns:minmax(70px,1fr) 1.4fr 84px;align-items:center;gap:12px;padding:9px 10px;border-radius:12px;font-size:12.5px;font-weight:700;cursor:pointer}\n.gpp .bkr:hover{background:rgba(247,246,242,.04)}\n.gpp .bkr.sel{background:rgba(var(--rgb),.1)}\n.gpp .bkr span small{display:block;color:var(--faint);font-weight:600;font-size:11px;margin-top:2px}\n.gpp .bkr .bar{position:relative;height:8px;border-radius:99px;background:rgba(247,246,242,.06)}\n.gpp .bkr .bar i{position:absolute;top:0;bottom:0;border-radius:99px}\n.gpp .bkr .bar:after{content:\"\";position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--line)}\n.gpp .bkr em{font-style:normal;text-align:right;font-variant-numeric:tabular-nums}\n.gpp .hrs{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;align-items:end;height:120px;margin-top:16px}\n.gpp .hrs div{position:relative;border-radius:4px 4px 2px 2px;min-height:2px}\n.gpp .hrsx{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;font-size:9.5px;color:var(--faint);font-weight:700;margin-top:6px;text-align:center}\n.gpp .wk{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:18px}\n.gpp .wk div{padding:10px 4px;border-radius:12px;text-align:center;font-size:11px;font-weight:800;color:var(--faint);background:rgba(247,246,242,.03)}\n.gpp .wk div b{display:block;font-size:12.5px;margin-top:4px}\n\n/* accounts */\n.gpp .accHead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}\n.gpp .accSum{display:flex;gap:8px;flex-wrap:wrap}\n.gpp .accSum span{font-size:12px;font-weight:700;padding:7px 12px;border-radius:99px;background:rgba(247,246,242,.04);border:1px solid var(--line);color:var(--mute)}\n.gpp .accSum span b{color:var(--fg)}\n.gpp .accs{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:16px;max-height:470px;overflow:auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:rgba(var(--rgb),.25) transparent}\n.gpp .acc{padding:14px 14px 12px;border-radius:16px;border:1px solid var(--line);background:rgba(247,246,242,.025);cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:border-color .2s,background .2s}\n.gpp .acc:hover{border-color:var(--line2)}\n.gpp .acc.sel{border-color:rgba(var(--rgb),.6);background:rgba(var(--rgb),.08)}\n.gpp .acc .t{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:800}\n.gpp .st{font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;padding:4px 8px;border-radius:99px}\n.gpp .st.Active{background:rgba(143,220,180,.14);color:var(--mint)}\n.gpp .st.Passed{background:rgba(var(--rgb),.16);color:var(--cream)}\n.gpp .st.Failed{background:rgba(227,163,163,.12);color:var(--rose)}\n.gpp .st.Closed{background:rgba(247,246,242,.07);color:var(--mute)}\n.gpp .acc .p{font-size:11.5px;color:var(--faint);font-weight:600}\n.gpp .acc .v{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;font-weight:700;color:var(--mute)}\n.gpp .acc .v b{font-size:17px;letter-spacing:-.02em}\n.gpp .sorts{display:flex;gap:8px;align-items:center}\n\n/* table */\n.gpp .tblHead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}\n.gpp .tw{overflow:auto;border-radius:16px;border:1px solid var(--line)}\n.gpp table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums;min-width:980px}\n.gpp th{position:sticky;top:0;background:rgba(24,24,22,.98);text-align:left;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:800;padding:12px 14px;cursor:pointer;white-space:nowrap;user-select:none}\n.gpp th.r,.gpp td.r{text-align:right}\n.gpp th.on{color:var(--cream)}\n.gpp td{padding:11px 14px;border-top:1px solid var(--line);font-weight:600;color:var(--mute);white-space:nowrap}\n.gpp td b{color:var(--fg);font-weight:800}\n.gpp tr:hover td{background:rgba(247,246,242,.025)}\n.gpp .side{font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;padding:3px 7px;border-radius:6px}\n.gpp .side.long{background:rgba(143,220,180,.12);color:var(--mint)}.gpp .side.short{background:rgba(227,163,163,.12);color:var(--rose)}\n.gpp .pager{display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12px;font-weight:700;color:var(--mute)}\n.gpp .pager div{display:flex;gap:6px}\n.gpp .pager button{border:1px solid var(--line);background:none;color:var(--fg);font-size:12px;font-weight:700;padding:7px 12px;border-radius:10px;cursor:pointer}\n.gpp .pager button:disabled{opacity:.35;cursor:default}\n.gpp .empty{padding:60px 20px;text-align:center;color:var(--mute);font-weight:700}\n.gpp .prog{font-size:12px;font-weight:700;color:var(--cream)}\n\n.gpp .side2{display:flex;flex-direction:column;gap:16px}\n.gpp .svp{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.gpp .svp>div{padding:16px;border-radius:16px;background:rgba(247,246,242,.03);border:1px solid var(--line)}\n.gpp .svp span{display:block;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.gpp .svp b{display:block;font-size:clamp(22px,2.2vw,30px);font-weight:800;letter-spacing:-.03em;margin:8px 0 12px;font-variant-numeric:tabular-nums}\n.gpp .svp .bar{height:6px;border-radius:99px;background:rgba(247,246,242,.07);overflow:hidden}.gpp .svp .bar i{display:block;height:100%;border-radius:99px}\n.gpp .plans{display:flex;flex-direction:column;gap:4px;max-height:300px;overflow:auto;scrollbar-width:thin}\n.gpp .pr{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;cursor:pointer}\n.gpp .pr:hover{background:rgba(247,246,242,.04)}.gpp .pr.sel{background:rgba(var(--rgb),.1)}\n.gpp .pr b{font-size:13px;font-weight:800}.gpp .pr small{display:block;margin-top:3px;font-size:11.5px;color:var(--faint);font-weight:600}\n.gpp .pr em{font-style:normal;font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap}\n.gpp .st.HitMLL,.gpp .st.HitDLL{background:rgba(227,163,163,.12);color:var(--rose)}\n.gpp .st.Refunded{background:rgba(247,246,242,.07);color:var(--mute)}\n.gpp .accs{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}\n.gpp .st{white-space:nowrap}\n.gpp .hdr-r{gap:10px}\n.gpp .r1{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}\n.gpp .hero{min-height:360px}\n.gpp .ratio{display:flex;flex-direction:column;gap:8px;margin-top:18px;position:relative;max-width:420px}\n.gpp .ratio div{display:grid;grid-template-columns:44px 1fr;align-items:center;gap:10px;font-size:11px;font-weight:700;color:var(--faint);letter-spacing:.08em;text-transform:uppercase}\n.gpp .ratio i{display:block;height:6px;border-radius:99px;opacity:.85}\n.gpp .cash{display:flex;flex-direction:column}\n.gpp .cash .eq{flex:1;min-height:220px;height:auto}\n.gpp .kpis{grid-template-columns:repeat(6,minmax(0,1fr))}\n.gpp .types{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}\n.gpp .ty{padding:20px;cursor:pointer;transition:border-color .2s}\n.gpp .ty:hover{border-color:var(--line2)}.gpp .ty.sel{border-color:rgba(var(--rgb),.6)}\n.gpp .tyH{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}\n.gpp .tyH b{font-size:14px;font-weight:800;letter-spacing:-.01em}\n.gpp .tyH small{display:block;margin-top:5px;font-size:11.5px;font-weight:600;color:var(--faint)}\n.gpp .tyH em{font-style:normal;font-size:22px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;white-space:nowrap}\n.gpp .fun{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:18px}\n.gpp .fun div{position:relative;padding-bottom:10px}\n.gpp .fun span{display:block;font-size:20px;font-weight:800;letter-spacing:-.02em}\n.gpp .fun small{display:block;font-size:11px;font-weight:600;color:var(--faint);margin-top:2px;white-space:nowrap}\n.gpp .fun i{position:absolute;left:0;bottom:0;height:3px;border-radius:99px;background:var(--cream);opacity:.8}\n.gpp .fun div:after{content:\"\";position:absolute;left:0;right:0;bottom:0;height:3px;border-radius:99px;background:rgba(247,246,242,.07);z-index:-1}\n.gpp .tk{display:flex;gap:6px;flex-wrap:wrap}\n.gpp .tk span{display:flex;gap:8px;align-items:baseline;font-size:11.5px;font-weight:700;color:var(--faint);padding:8px 12px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.03)}\n.gpp .tk b{font-size:13px;color:var(--fg);font-weight:800}\n.gpp .trade .r3{margin-top:6px;gap:28px}\n.gpp .lab.sm{font-size:10px;margin-bottom:-4px}\n.gpp .drawer{display:flex;flex-direction:column}\n.gpp .trig{display:flex;align-items:center;gap:12px;width:100%;padding:16px 22px;border-radius:20px;border:1px solid var(--line);background:var(--card);backdrop-filter:blur(18px);color:var(--mute);font:600 14px var(--sans);cursor:pointer;text-align:left}\n.gpp .trig b{color:var(--fg);font-weight:800}\n.gpp .trig:hover{border-color:var(--line2)}\n.gpp .trig .chev{margin-left:auto;transition:transform .25s;color:var(--faint)}\n.gpp .trig[aria-expanded=\"true\"] .chev{transform:rotate(180deg)}\n.gpp .menu{display:none;margin-top:10px;padding:18px;border-radius:20px;border:1px solid var(--line);background:var(--card);backdrop-filter:blur(18px)}\n.gpp .menu.open{display:block}\n.gpp .mhead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}\n.gpp .mini{border:1px solid var(--line);background:none;color:var(--fg);font-size:12px;font-weight:700;padding:7px 12px;border-radius:10px;cursor:pointer}\n.gpp .mini:disabled{opacity:.35;cursor:default}\n.gpp .accs{margin-top:0;max-height:520px}\n.gpp .tw{max-height:620px}\n@media (max-width:1180px){.gpp .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}\n@media (max-width:640px){.gpp .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.gpp .hdr-r{width:100%}}\n\n/* ---- responsive (last so it wins) ---- */\n@media (max-width:1100px){.gpp .r1{grid-template-columns:1fr}.gpp .cash .eq{min-height:240px}.gpp .trade .r3{grid-template-columns:1fr 1fr}}\n@media (max-width:760px){\n .gpp{padding:20px 16px 56px}\n .gpp .wrap{gap:12px}\n .gpp .top{gap:12px}\n .gpp .lock{gap:10px}.gpp .vm{width:42px}.gpp .brand{font-size:18px}.gpp .brand span{display:none}\n .gpp .hdr-r{width:100%;gap:8px}\n .gpp .hdr-r .live{order:9;width:100%}\n .gpp .seg button{padding:7px 10px}\n .gpp .card{padding:20px;border-radius:20px}\n .gpp .hero{min-height:300px}\n .gpp .moon{width:380px;height:380px;right:-150px;top:-90px}\n .gpp .big{font-size:clamp(52px,17vw,84px)}\n .gpp .of{font-size:14px}\n .gpp .kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}\n .gpp .kpi{padding:16px}.gpp .kpi b{font-size:22px}\n .gpp .types{grid-template-columns:1fr}\n .gpp .tyH em{font-size:20px}\n .gpp .fun span{font-size:18px}\n .gpp .trade .r3{grid-template-columns:1fr;gap:22px}\n .gpp .tk span{padding:7px 10px}\n .gpp .eqHead{flex-direction:column;align-items:flex-start;gap:6px}\n .gpp .lab{letter-spacing:.16em}\n .gpp .trig{padding:15px 18px;font-size:13.5px}\n .gpp .menu{padding:14px}\n .gpp .accs{grid-template-columns:1fr}\n .gpp .hrsx{font-size:10px}\n .gpp .hero .lab [data-r=scope]{display:none}\n .gpp .bkr{grid-template-columns:minmax(0,1.3fr) minmax(50px,.8fr) 76px;gap:10px;padding:9px 6px}\n .gpp .bkr span small{white-space:nowrap}\n}\n@media (max-width:360px){.gpp .kpi b{font-size:19px}.gpp .seg button{padding:7px 8px;font-size:11.5px}}\n.gpp .hrsx{font-size:10px}\n.gpp .hero .lab{z-index:2}\n";
  const PBODY = "<canvas class=\"sky\" data-r=\"sky\"></canvas>\n<div class=\"wrap\">\n <header class=\"top\">\n  <div class=\"lock\" aria-label=\"Vest \u00d7 GIGAPROP\"><span class=\"vm\"><svg viewBox=\"-20 -30 589 400\" aria-hidden=\"true\"><defs><linearGradient id=\"vg1\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi1)\" stop-opacity=\".95\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".45\"/></linearGradient><linearGradient id=\"vg2\" x1=\"1\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi1)\" stop-opacity=\".85\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".2\"/></linearGradient><linearGradient id=\"vg3\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi2)\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".02\"/></linearGradient></defs><path d=\"M130.463 1.64132L2.10114 104.296C0.259255 105.778 0.259255 108.571 2.10114 110.032L136.429 217.472V4.52427C136.429 1.43111 132.865 -0.260628 130.453 1.64132H130.463Z\" fill=\"url(#vg1)\"/><path d=\"M546.559 104.307L418.198 1.6418C415.785 -0.290179 412.222 1.43159 412.222 4.52475V217.483L546.559 110.043C548.401 108.561 548.401 105.768 546.559 104.307Z\" fill=\"url(#vg2)\"/><path d=\"M272.038 325.934L136.429 217.482V335.143C136.429 337.165 138.06 338.827 140.112 338.827H408.597C410.62 338.827 412.281 337.195 412.281 335.143V217.482L276.672 325.934C275.331 327.005 273.439 327.005 272.068 325.934H272.038Z\" fill=\"url(#vg3)\" stroke=\"var(--hi2)\" stroke-opacity=\".35\" stroke-width=\"6\"/></svg></span><span class=\"lx\">\u00d7</span><span class=\"brand\">GIGAPROP<i>.</i><span>Profile</span></span></div>\n  <div class=\"hdr-r\">\n   <div class=\"seg\" data-r=\"range\"><button data-v=\"all\" class=\"on\">All</button><button data-v=\"7\">7D</button><button data-v=\"30\">30D</button><button data-v=\"custom\">Custom</button></div>\n   <div class=\"dates\" data-r=\"dates\" hidden><input type=\"date\" data-r=\"from\"><input type=\"date\" data-r=\"to\"></div>\n   <div class=\"seg\" data-r=\"scopeSeg\"><button data-v=\"funded\" class=\"on\">Funded</button><button data-v=\"all\">All accounts</button></div>\n   <div class=\"dd\" data-f=\"plan\"><button>Plan <b></b></button><div class=\"pop\"></div></div>\n   <button class=\"ib\" data-r=\"theme\" aria-label=\"Switch theme\" title=\"Switch theme\"><i></i></button>\n   <div class=\"live\"><b></b><span data-r=\"snap\"></span></div>\n   <span class=\"prog\" data-r=\"prog\"></span>\n   <button class=\"ib\" data-r=\"refresh\" aria-label=\"Pull everything again\" title=\"Pull everything again\" hidden><svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 11a8 8 0 1 0-2.3 5.7\"/><path d=\"M20 4v7h-7\"/></svg></button>\n   <button class=\"ib\" data-r=\"close\" aria-label=\"Close\" hidden>\u2715</button>\n  </div>\n </header>\n\n <div class=\"r1\">\n  <div class=\"card corner hero\">\n   <canvas class=\"moon\" data-r=\"moon\" width=\"1040\" height=\"1040\"></canvas>\n   <div class=\"lab\" style=\"position:relative\"><span class=\"k\">Real PnL</span><span data-r=\"scope\"></span></div>\n   <div class=\"big\" data-r=\"net\"></div>\n   <div class=\"of\" data-r=\"of\"></div>\n   <div class=\"ratio\" data-r=\"ratio\"></div>\n  </div>\n  <div class=\"card cash\">\n   <div class=\"eqHead\"><div class=\"lab\"><span class=\"k\">Cash</span>Payouts in, accounts out</div><span class=\"count\" data-r=\"ret\"></span></div>\n   <div class=\"eq\" data-r=\"eq\"><svg data-r=\"eqsvg\" viewBox=\"0 0 1000 280\" preserveAspectRatio=\"none\"></svg><div class=\"tip\" data-r=\"tip\"></div></div>\n   <div class=\"eqx\" data-r=\"eqx\"></div>\n  </div>\n </div>\n\n <div class=\"kpis\" data-r=\"kpis\"></div>\n\n <div class=\"types\" data-r=\"types\"></div>\n\n <div class=\"card trade\">\n  <div class=\"eqHead\"><div class=\"lab\"><span class=\"k\">Trading</span><span data-r=\"tScope\"></span></div><div class=\"tk\" data-r=\"tk\"></div></div>\n  <div class=\"r3\">\n   <div><div class=\"lab sm\">Markets</div><div class=\"bk\" data-r=\"bkMkt\"></div></div>\n   <div><div class=\"lab sm\">Exits</div><div class=\"bk\" data-r=\"bkExit\"></div></div>\n   <div><div class=\"lab sm\">Hour opened</div><div class=\"hrs\" data-r=\"hrs\"></div><div class=\"hrsx\" data-r=\"hrsx\"></div><div class=\"lab sm\" style=\"margin-top:18px\">Direction</div><div class=\"bk\" data-r=\"bkSide\"></div></div>\n  </div>\n </div>\n\n <div class=\"drawer\">\n  <button class=\"trig\" data-r=\"accTrig\" aria-expanded=\"false\"><span data-r=\"accTxt\"></span><svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>\n  <div class=\"menu\" data-r=\"accMenu\">\n   <div class=\"mhead\"><div class=\"accSum\" data-r=\"accSum\"></div><div class=\"seg\" data-r=\"accSort\"><button data-v=\"new\" class=\"on\">Newest</button><button data-v=\"net\">Result</button><button data-v=\"paid\">Paid out</button></div></div>\n   <div class=\"accs\" data-r=\"accs\"></div>\n  </div>\n </div>\n\n <div class=\"drawer\">\n  <button class=\"trig\" data-r=\"trTrig\" aria-expanded=\"false\"><span data-r=\"trTxt\"></span><svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>\n  <div class=\"menu\" data-r=\"trMenu\">\n   <div class=\"mhead\"><span class=\"count\" data-r=\"pinfo\"></span><div style=\"display:flex;gap:8px\"><button class=\"mini\" data-r=\"prev\">Prev</button><button class=\"mini\" data-r=\"next\">Next</button><button class=\"mini\" data-r=\"csv\">CSV</button></div></div>\n   <div class=\"tw\"><table><thead><tr data-r=\"thead\"></tr></thead><tbody data-r=\"tbody\"></tbody></table></div>\n  </div>\n </div>\n</div>\n";
  function GPProfile(root, D, opt) {
    opt = opt || {};
    const $ = r => root.querySelector('[data-r="' + r + '"]');
    const RGB = () => getComputedStyle(root).getPropertyValue('--rgb').trim() || '239,226,189';
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const money = (v, d = 2) => (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sMoney = (v, d = 2) => (v > 0 ? '+' : '') + money(v, d);
    const pct = (v, d = 0) => isFinite(v) ? (v * 100).toFixed(d) + '%' : '—';
    const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    const fmtD = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const fmtDT = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const dur = ms => { const m = Math.round(ms / 6e4); if (m < 60) return m + 'm'; const h = m / 60; if (h < 48) return h.toFixed(h < 10 ? 1 : 0) + 'h'; return (h / 24).toFixed(1) + 'd'; };
    const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const EXIT = { liquidation: 'Force closed', user_requested: 'Manual close', stop_loss: 'Stop loss', take_profit: 'Take profit', '': 'Other' };
    const exitName = r => EXIT[r] || String(r).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    const sizeName = v => !v ? '' : v >= 1000 ? '$' + (v / 1000) + 'K' : '$' + v;
  
    // ---------- data ----------
    const A = {}; D.accounts.forEach(a => { A[a.id] = a; });
    const lines = {};
    D.accounts.forEach(a => { if (a.kind === 'Primary') return; const L = lines[a.root] = lines[a.root] || { id: a.root, accs: [], cost: 0, paid: 0, pays: 0 }; L.accs.push(a); if (a.id === a.root) L.cost = a.cost || 0; });
    Object.values(lines).forEach(L => {
      L.accs.sort((x, y) => x.created - y.created);
      const r = L.accs.find(a => a.id === L.id) || L.accs[0], last = L.accs[L.accs.length - 1];
      Object.assign(L, { plan: r.plan, size: r.size, kind0: r.kind, created: r.created, origin: r.origin, mll: r.mll, dll: r.dll, target: r.target, split: r.split, status: last.status, funded: L.accs.some(a => a.kind === 'Funded' || a.kind === 'Instant') });
    });
    const PO = (D.payouts || []).filter(p => !/fail|reject|cancel/i.test(p.status));
    PO.forEach(p => { const a = A[p.acct]; const L = a && lines[a.root]; if (L) { L.paid += p.amt; L.pays++; } });
    const TRADING = !!D.tradingOnly;
    const T = D.trades.map(t => Object.assign({ net: t.pnl - t.fee - t.fund, hold: Math.max(0, t.t1 - t.t0), root: (A[t.acct] || {}).root || t.acct }, t)).sort((a, b) => a.t1 - b.t1);
    if (TRADING) T.forEach(t => { const a = A[t.acct]; const L = a && lines[a.root]; if (L) { L.paid += t.net; } });
    const opts = {
      kind: ['Funded', 'Instant', 'Eval', 'Primary'].filter(k => D.accounts.some(a => a.kind === k)),
      status: ['Active', 'Passed', 'Hit MLL', 'Hit DLL', 'Failed', 'Closed', 'Refunded'].filter(s => D.accounts.some(a => a.status === s)),
      size: [...new Set(D.accounts.filter(a => a.size).map(a => a.size))].sort((a, b) => a - b).map(String),
      plan: [...new Set(D.accounts.filter(a => a.kind !== 'Primary').map(a => a.plan))].sort(),
      mkt: [...new Set(T.map(t => t.sym))].sort((a, b) => T.filter(t => t.sym === b).length - T.filter(t => t.sym === a).length),
      exit: [...new Set(T.map(t => t.reason))]
    };
    const label = { kind: v => v === 'Eval' ? 'Evaluation' : v === 'Instant' ? 'Instant funded' : v, status: v => v, size: v => sizeName(+v), plan: v => v, mkt: v => v, exit: v => exitName(v) };
    const DEF = () => ({ range: 'all', from: '', to: '', side: 'all', res: 'all', q: '', line: '', scope: TRADING && !D.accounts.some(a => a.kind === 'Funded') ? 'all' : 'funded', kind: new Set(), status: new Set(), size: new Set(), plan: new Set(), mkt: new Set(), exit: new Set() });
    const F = DEF();
    let SORT = { k: 't1', d: -1 }, PAGE = 0, EQM = 'event', ACCSORT = 'new';
  
    function inRange(t) {
      if (F.range === 'all') return true;
      if (F.range === 'custom') { const k = dayKey(t); return (!F.from || k >= F.from) && (!F.to || k <= F.to); }
      const s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - (+F.range - 1)); return t >= s.getTime();
    }
    const lineOk = L => L && (!F.line || L.id === F.line) && (!F.size.size || F.size.has(String(L.size))) && (!F.plan.size || F.plan.has(L.plan)) && (!F.q || (L.plan + ' ' + L.id + ' ' + L.accs.map(a => a.id).join(' ')).toLowerCase().includes(F.q.toLowerCase()));
    function filteredTrades() {
      return T.filter(t => {
        const a = A[t.acct]; if (!a) return false;
        if (F.scope === 'funded' && a.kind !== 'Funded' && a.kind !== 'Instant') return false;
        if (F.kind.size && !F.kind.has(a.kind)) return false;
        if (F.status.size && !F.status.has(a.status)) return false;
        if (a.kind !== 'Primary' && !lineOk(lines[a.root])) return false;
        if (a.kind === 'Primary' && (F.line || F.size.size || F.plan.size)) return false;
        if (!inRange(t.t1)) return false;
        if (F.side !== 'all' && t.side !== F.side) return false;
        if (F.res === 'win' && !(t.net > 0)) return false;
        if (F.res === 'loss' && !(t.net < 0)) return false;
        if (F.mkt.size && !F.mkt.has(t.sym)) return false;
        if (F.exit.size && !F.exit.has(t.reason)) return false;
        return true;
      });
    }
    function econ() {
      const Ls = Object.values(lines).filter(L => lineOk(L) && (!F.status.size || F.status.has(L.status)));
      if (TRADING) { const X = filteredTrades(); const ev = X.map(t => ({ t: t.t1, v: t.net, lab: t.sym + ' ' + t.side })); const w = X.filter(t => t.net > 0).reduce((s, t) => s + t.net, 0), l = -X.filter(t => t.net < 0).reduce((s, t) => s + t.net, 0); return { Ls, buys: [], pays: [], spent: l, paid: w, net: w - l, events: ev }; }
      const ids = new Set(Ls.map(L => L.id));
      const buys = Ls.filter(L => inRange(L.created)).map(L => ({ t: L.created, v: -L.cost, lab: L.plan + ' bought' }));
      const pays = PO.filter(p => { const a = A[p.acct]; return a && ids.has(a.root) && inRange(p.at); }).map(p => ({ t: p.at, v: p.amt, lab: 'Payout · ' + (A[p.acct].plan || '') }));
      const spent = -buys.reduce((s, x) => s + x.v, 0), paid = pays.reduce((s, x) => s + x.v, 0);
      return { Ls, buys, pays, spent, paid, net: paid - spent, events: buys.concat(pays).sort((a, b) => a.t - b.t) };
    }
    function tstats(X) {
      const n = X.length, W = X.filter(t => t.net > 0), Lo = X.filter(t => t.net < 0);
      const gw = W.reduce((s, t) => s + t.net, 0), gl = Lo.reduce((s, t) => s + t.net, 0);
      const holds = X.map(t => t.hold).sort((a, b) => a - b);
      return { n, wins: W.length, losses: Lo.length, wr: n ? W.length / n : NaN, pf: gl ? gw / -gl : (gw > 0 ? Infinity : NaN), aw: W.length ? gw / W.length : 0, al: Lo.length ? gl / Lo.length : 0, med: holds.length ? holds[holds.length >> 1] : 0, fees: X.reduce((s, t) => s + t.fee, 0), lev: n ? X.reduce((s, t) => s + t.lev, 0) / n : 0 };
    }
  
    // ---------- render ----------
    function render() {
      const E = econ(), X = filteredTrades(), S = tstats(X);
      const big = v => { const a = Math.abs(v), w = Math.floor(a), c = Math.round((a - w) * 100); return (v < 0 ? '−$' : '$') + w.toLocaleString('en-US') + '<small>.' + String(c === 100 ? 0 : c).padStart(2, '0') + '</small>'; };
      $('net').innerHTML = big(E.net); $('net').classList.toggle('neg', E.net < 0);
      const bought = E.Ls.filter(L => L.cost > 0).length, fundedL = E.Ls.filter(L => L.funded), paidL = E.Ls.filter(L => L.paid > 0);
      $('scope').textContent = F.line ? sizeName(lines[F.line].size) + ' ' + lines[F.line].plan : F.plan.size ? [...F.plan].join(' · ') : TRADING ? 'Closed trades, after fees' : 'Payouts minus account costs';
      root.querySelector('.hero .k').textContent = TRADING ? 'Trading PnL' : 'Real PnL';
      root.querySelector('.cash .lab').innerHTML = TRADING ? '<span class="k">Equity</span>Every closed trade' : '<span class="k">Cash</span>Payouts in, accounts out';
      $('of').innerHTML = TRADING ? `<b>${money(E.paid)}</b> won · <b>${money(E.spent)}</b> lost · <b>${X.length}</b> trades` : `<b>${money(E.paid)}</b> paid out · <b>${money(E.spent)}</b> spent`;
      const mx = Math.max(E.paid, E.spent, 1);
      $('ratio').innerHTML = `<div><span>${TRADING ? 'Won' : 'Paid'}</span><i style="width:${E.paid / mx * 100}%;background:var(--mint)"></i></div><div><span>${TRADING ? 'Lost' : 'Spent'}</span><i style="width:${E.spent / mx * 100}%;background:var(--rose)"></i></div>`;
      $('ret').textContent = TRADING ? (isFinite(S.pf) ? 'Profit factor ' + S.pf.toFixed(2) : '') : E.spent ? (E.paid / E.spent).toFixed(2) + 'x return' : '';
  
      const evL = E.Ls.filter(L => L.kind0 === 'Eval'), passed = evL.filter(L => L.funded).length, done = evL.filter(L => L.funded || /Hit|Refunded/.test(L.status)).length;
      const K = [
        ['Paid out', money(E.paid), E.pays.length + ' payouts', 'pos'],
        ['Spent', money(E.spent), bought + ' accounts'],
        ['Cost per funded', fundedL.length ? money(E.spent / fundedL.length) : '—', fundedL.length + ' funded'],
        ['Paid per funded', fundedL.length ? money(E.paid / fundedL.length) : '—', 'Avg payout ' + (E.pays.length ? money(E.paid / E.pays.length) : '—')],
        ['Eval pass rate', done ? pct(passed / done) : '—', `${passed} of ${done}`],
        ['Funded → paid', fundedL.length ? pct(paidL.length / fundedL.length) : '—', `${paidL.length} of ${fundedL.length}`]
      ];
      if (TRADING) { const allL = Object.values(lines).filter(L => lineOk(L)), fu = allL.filter(L => L.funded).length, pa = allL.filter(L => L.status === 'Passed').length, fa = allL.filter(L => L.status === 'Failed').length;
        K.splice(0, K.length, ['Win rate', pct(S.wr, 1), `${S.wins}W · ${S.losses}L`], ['Profit factor', isFinite(S.pf) ? S.pf.toFixed(2) : '—', 'Avg win ' + money(S.aw, 0)], ['Avg loss', money(S.al, 0), 'Per losing trade'], ['Accounts', allL.length, fu + ' funded'], ['Pass rate', pa + fa ? pct(pa / (pa + fa)) : '—', `${pa} passed · ${fa} failed`], ['Fees', money(S.fees), 'Median hold ' + (S.n ? dur(S.med) : '—')]); }
      $('kpis').innerHTML = K.map(k => `<div class="card kpi"><div class="lab">${k[0]}</div><b class="${k[3] || ''}">${k[1]}</b><small>${k[2]}</small></div>`).join('');
  
      // account types
      const byPlan = {}; Object.values(lines).filter(L => (!F.line || L.id === F.line) && (!F.q)).forEach(L => { if (!inRange(L.created) && !E.pays.length) return; const k = L.plan; const g = byPlan[k] = byPlan[k] || { plan: L.plan, size: L.size, n: 0, cost: 0, f: 0, p: 0, paid: 0, mll: L.mll, dll: L.dll, target: L.target, split: L.split };
        const inR = inRange(L.created); if (inR) { g.n++; g.cost += L.cost; if (L.funded) g.f++; if (L.paid) g.p++; if (L.status === 'Passed') g.ps = (g.ps || 0) + 1; }
        g.paid += TRADING ? L.paid : PO.filter(p => (A[p.acct] || {}).root === L.id && inRange(p.at)).reduce((s, p) => s + p.amt, 0); });
      $('types').innerHTML = Object.values(byPlan).filter(g => g.n || g.paid).sort((a, b) => b.n - a.n).map(g => { const r = g.paid - g.cost, on = F.plan.has(g.plan), fx = g.n ? g.f / g.n : 0, px = g.n ? g.p / g.n : 0;
        return `<div class="card ty ${on ? 'sel' : ''}" data-k="${esc(g.plan)}"><div class="tyH"><div><b>${esc(sizeName(g.size))} ${esc(g.plan)}</b><small>MLL ${money(g.size * g.mll, 0)} · ${g.dll ? 'DLL ' + money(g.size * g.dll, 0) : 'No DLL'}${g.target ? ' · Target ' + money(g.target, 0) : ''}${g.split ? ' · ' + Math.round(g.split * 100) + '%' : ''}</small></div><em class="${cls(r)}">${sMoney(r, 0)}</em></div>
          <div class="fun"><div><span>${g.n}</span><small>${TRADING ? 'accounts' : 'bought · ' + money(g.n ? g.cost / g.n : 0)}</small><i style="width:100%"></i></div>${TRADING ? `<div><span>${g.ps || 0}</span><small>passed</small><i style="width:${g.n ? (g.ps || 0) / g.n * 100 : 0}%"></i></div>` : `<div><span>${g.f}</span><small>funded · ${pct(fx)}</small><i style="width:${fx * 100}%"></i></div>`}<div><span>${g.p}</span><small>${TRADING ? 'pnl ' + sMoney(g.paid, 0) : 'paid · ' + money(g.paid, 0)}</small><i style="width:${px * 100}%;background:var(--mint)"></i></div></div></div>`; }).join('');
      $('types').querySelectorAll('.ty').forEach(r => r.onclick = () => { const k = r.dataset.k; F.plan.has(k) ? F.plan.delete(k) : F.plan.add(k); PAGE = 0; render(); });
  
      $('tScope').textContent = (F.scope === 'funded' ? 'Funded accounts' : 'All accounts') + ' · ' + S.n + ' trades';
      $('tk').innerHTML = [['Win rate', pct(S.wr, 1)], ['Profit factor', isFinite(S.pf) ? S.pf.toFixed(2) : '—'], ['Avg win', money(S.aw, 0)], ['Avg loss', money(S.al, 0)], ['Median hold', S.n ? dur(S.med) : '—'], ['Avg leverage', S.n ? S.lev.toFixed(0) + 'x' : '—']].map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('');
  
      renderEq(E);
      renderBk(X);
      renderLines(E.Ls);
      renderTable(X);
      renderFilters();
    }
  
    function renderEq(E) {
      const svg = $('eqsvg'), Wd = 1000, Hh = 280;
      let pts = [];
      if (EQM === 'event') { let c = 0; pts = E.events.map(e => { c += e.v; return { t: e.t, v: c, lab: fmtDT(e.t) + ' · ' + e.lab + ' ' + sMoney(e.v) }; }); }
      else { const m = {}; E.events.forEach(e => { const k = dayKey(e.t); m[k] = (m[k] || 0) + e.v; }); let c = 0; pts = Object.keys(m).sort().map(k => { c += m[k]; const [y, mo, d] = k.split('-').map(Number), t = new Date(y, mo - 1, d).getTime(); return { t, v: c, lab: fmtD(t) + ' · ' + sMoney(m[k]) + ' that day' }; }); }
      if (!pts.length) { svg.innerHTML = ''; $('eqx').innerHTML = ''; return; }
      pts.unshift({ t: pts[0].t, v: 0, lab: 'Start' });
      const vs = pts.map(p => p.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), pad = (hi - lo) * 0.08 || 1;
      const y = v => Hh - ((v - lo + pad) / (hi - lo + 2 * pad)) * Hh, x = i => pts.length < 2 ? 0 : i / (pts.length - 1) * Wd;
      const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join('');
      const C = RGB(), y0 = y(0);
      svg.innerHTML = `<defs><linearGradient id="gppA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${C})" stop-opacity=".3"/><stop offset="1" stop-color="rgb(${C})" stop-opacity="0"/></linearGradient>
        <clipPath id="gppU"><rect x="0" y="0" width="${Wd}" height="${y0}"/></clipPath><clipPath id="gppD"><rect x="0" y="${y0}" width="${Wd}" height="${Hh - y0}"/></clipPath></defs>
        <line x1="0" x2="${Wd}" y1="${y0}" y2="${y0}" stroke="rgba(247,246,242,.18)" stroke-dasharray="4 6" vector-effect="non-scaling-stroke"/>
        <path d="${line}L${Wd} ${y0}L0 ${y0}Z" fill="url(#gppA)" clip-path="url(#gppU)"/><path d="${line}L${Wd} ${y0}L0 ${y0}Z" fill="rgba(227,163,163,.16)" clip-path="url(#gppD)"/>
        <path d="${line}" fill="none" stroke="rgb(${C})" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
      const n = 5, ticks = []; for (let i = 0; i < n; i++) ticks.push(pts[Math.round(i / (n - 1) * (pts.length - 1))]);
      $('eqx').innerHTML = ticks.map(p => `<span>${fmtD(p.t)}</span>`).join('');
      const box = $('eq'), tip = $('tip');
      box.onmousemove = e => { const r = box.getBoundingClientRect(), i = Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - r.left) / r.width * (pts.length - 1)))), p = pts[i];
        tip.style.display = 'block'; tip.style.left = (x(i) / Wd * r.width) + 'px'; tip.style.top = (y(p.v) / Hh * r.height) + 'px'; tip.innerHTML = `<small>${esc(p.lab)}</small>${sMoney(p.v)}`; };
      box.onmouseleave = () => { tip.style.display = 'none'; };
    }
  
    function bkRows(el, groups, key, nameOf) {
      const max = Math.max(1, ...groups.map(g => Math.abs(g.net)));
      el.innerHTML = groups.map(g => `<div class="bkr ${key && F[key].has(g.k) ? 'sel' : ''}" data-k="${esc(g.k)}"><span>${esc(nameOf(g.k))}<small>${g.n} trades · ${pct(g.w / g.n)} win</small></span><div class="bar"><i style="${g.net >= 0 ? 'left:50%' : 'right:50%'};width:${Math.abs(g.net) / max * 50}%;background:${g.net >= 0 ? 'var(--mint)' : 'var(--rose)'}"></i></div><em class="${cls(g.net)}">${sMoney(g.net, 0)}</em></div>`).join('') || '<div class="count">No trades</div>';
      if (key) el.querySelectorAll('.bkr').forEach(r => r.onclick = () => { const k = r.dataset.k; F[key].has(k) ? F[key].delete(k) : F[key].add(k); PAGE = 0; render(); });
    }
    function group(X, f) { const m = {}; X.forEach(t => { const k = f(t); const g = m[k] = m[k] || { k, n: 0, w: 0, net: 0 }; g.n++; if (t.net > 0) g.w++; g.net += t.net; }); return Object.values(m).sort((a, b) => b.n - a.n); }
    function renderBk(X) {
      bkRows($('bkMkt'), group(X, t => t.sym).slice(0, 5), 'mkt', v => v);
      bkRows($('bkExit'), group(X, t => t.reason).slice(0, 5), 'exit', exitName);
      bkRows($('bkSide'), group(X, t => t.side), null, v => v === 'long' ? 'Long' : 'Short');
      $('bkSide').querySelectorAll('.bkr').forEach(r => { r.classList.toggle('sel', F.side === r.dataset.k); r.onclick = () => { F.side = F.side === r.dataset.k ? 'all' : r.dataset.k; PAGE = 0; render(); }; });
      const hrs = Array.from({ length: 24 }, () => ({ n: 0, net: 0 })); X.forEach(t => { const h = new Date(t.t0).getHours(); hrs[h].n++; hrs[h].net += t.net; });
      const mx = Math.max(1, ...hrs.map(h => Math.abs(h.net)));
      $('hrs').innerHTML = hrs.map((h, i) => `<div title="${i}:00 · ${h.n} trades · ${sMoney(h.net)}" style="height:${h.n ? Math.max(4, Math.abs(h.net) / mx * 100) : 2}%;background:${!h.n ? 'rgba(247,246,242,.06)' : h.net >= 0 ? 'var(--mint)' : 'var(--rose)'};opacity:${h.n ? .85 : 1}"></div>`).join('');
      $('hrsx').innerHTML = hrs.map((h, i) => `<span>${i % 3 === 0 ? (i % 12 || 12) + (i < 12 ? 'a' : 'p') : ''}</span>`).join('');
    }
  
    function path(L) {
      return L.accs.map(a => a.kind === 'Eval' ? (L.accs.filter(x => x.kind === 'Eval').length > 1 ? 'Step ' + a.step : 'Eval') : a.kind === 'Instant' ? 'Instant' : 'Funded').join(' → ');
    }
    function renderLines(Ls) {
      const showLs = F.scope === 'funded' ? Ls.filter(L => L.funded) : Ls; Ls = showLs;
      $('accTxt').innerHTML = `<b>${Ls.length}</b> ${F.scope === 'funded' ? 'funded accounts' : 'accounts bought'} · ${sMoney(Ls.reduce((s, L) => s + L.paid - L.cost, 0))}`;
      const st = s => Ls.filter(L => L.status === s).length;
      $('accSum').innerHTML = [['Active', st('Active')], ['Passed', Ls.filter(L => L.funded).length], ['Hit MLL', st('Hit MLL')], ['Hit DLL', st('Hit DLL')], ['Refunded', st('Refunded')], ['Paid out', Ls.filter(L => L.paid > 0).length]].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
      const list = Ls.slice().sort((a, b) => ACCSORT === 'net' ? (b.paid - b.cost) - (a.paid - a.cost) : ACCSORT === 'paid' ? b.paid - a.paid : b.created - a.created);
      $('accs').innerHTML = list.map(L => { const r = L.paid - L.cost;
        return `<div class="acc ${F.line === L.id ? 'sel' : ''}" data-id="${L.id}"><div class="t"><span>${sizeName(L.size)} ${esc(L.plan)}</span><span class="st ${L.status.replace(/\W/g, '')}">${esc(L.status)}</span></div>
        <div class="p">${esc(path(L))}${L.funded ? ' ✓' : ''} · ${fmtD(L.created)}</div>
        <div class="p">MLL ${money(L.size * L.mll, 0)} · ${L.dll ? 'DLL ' + money(L.size * L.dll, 0) : 'No DLL'}${L.target ? ' · Target ' + money(L.target, 0) : ''} · ${Math.round(L.split * 100)}% split</div>
        <div class="v"><span>${TRADING ? 'Trading PnL' : 'Cost ' + money(L.cost) + (L.paid ? ' · Paid ' + money(L.paid) : '')}</span><b class="${cls(r)}">${sMoney(r)}</b></div></div>`; }).join('') || '<div class="count">No accounts match</div>';
      $('accs').querySelectorAll('.acc').forEach(el => el.onclick = () => { F.line = F.line === el.dataset.id ? '' : el.dataset.id; if (F.line) F.kind.clear(); PAGE = 0; render(); });
    }
  
    const COLS = [['t1', 'Closed'], ['acct', 'Account'], ['sym', 'Market'], ['side', 'Side'], ['qty', 'Size', 1], ['open', 'Entry', 1], ['close', 'Exit', 1], ['hold', 'Hold', 1], ['reason', 'Exit type'], ['lev', 'Lev', 1], ['fee', 'Fees', 1], ['net', 'Trade PnL', 1]];
    function renderTable(X) {
      $('trTxt').innerHTML = `<b>${X.length}</b> trades`;
      $('thead').innerHTML = COLS.map(c => `<th class="${c[2] ? 'r' : ''} ${SORT.k === c[0] ? 'on' : ''}" data-k="${c[0]}">${c[1]}${SORT.k === c[0] ? (SORT.d < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('');
      $('thead').querySelectorAll('th').forEach(th => th.onclick = () => { const k = th.dataset.k; SORT = { k, d: SORT.k === k ? -SORT.d : -1 }; render(); });
      const rows = X.slice().sort((a, b) => { const x = a[SORT.k], y = b[SORT.k]; return (x > y ? 1 : x < y ? -1 : 0) * SORT.d; });
      const PS = 50, pages = Math.max(1, Math.ceil(rows.length / PS)); PAGE = Math.min(PAGE, pages - 1);
      const fx = v => v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 2 : 4 });
      $('tbody').innerHTML = rows.slice(PAGE * PS, PAGE * PS + PS).map(t => { const a = A[t.acct] || {};
        return `<tr><td>${fmtDT(t.t1)}</td><td>${esc(a.kind === 'Primary' ? 'Primary' : sizeName(a.size) + ' ' + a.kind)} <span style="color:var(--faint)">${esc(t.acct.slice(0, 4))}</span></td><td><b>${esc(t.sym)}</b></td><td><span class="side ${t.side}">${t.side}</span></td><td class="r">${fx(t.qty)}</td><td class="r">${fx(t.open)}</td><td class="r">${fx(t.close)}</td><td class="r">${dur(t.hold)}</td><td>${exitName(t.reason)}</td><td class="r">${t.lev}x</td><td class="r">${money(t.fee)}</td><td class="r"><b class="${cls(t.net)}">${sMoney(t.net)}</b></td></tr>`; }).join('') || `<tr><td colspan="12" class="empty">No trades match these filters</td></tr>`;
      $('pinfo').textContent = rows.length ? `${PAGE * PS + 1}–${Math.min(rows.length, PAGE * PS + PS)} of ${rows.length}` : '';
      $('prev').disabled = PAGE === 0; $('next').disabled = PAGE >= pages - 1;
      $('prev').onclick = () => { PAGE--; render(); }; $('next').onclick = () => { PAGE++; render(); };
    }
  
    function renderFilters() {
      root.querySelectorAll('.dd').forEach(dd => {
        const k = dd.dataset.f, set = F[k], b = dd.querySelector('button');
        b.querySelector('b').textContent = set.size ? set.size : '';
        b.classList.toggle('act', !!set.size);
        if (!dd.dataset.built) {
          dd.dataset.built = 1;
          const pop = dd.querySelector('.pop');
          pop.innerHTML = `<div class="row"><button data-a="all">All</button><button data-a="none">Clear</button></div>` + opts[k].map(v => `<label><input type="checkbox" value="${esc(v)}">${esc(label[k](v))}</label>`).join('');
          pop.onclick = e => e.stopPropagation();
          pop.querySelectorAll('input').forEach(i => i.onchange = () => { i.checked ? F[k].add(i.value) : F[k].delete(i.value); PAGE = 0; render(); });
          pop.querySelectorAll('[data-a]').forEach(x => x.onclick = () => { F[k].clear(); if (x.dataset.a === 'all') opts[k].forEach(v => F[k].add(String(v))); PAGE = 0; render(); });
          b.onclick = e => { e.stopPropagation(); const o = !dd.classList.contains('open'); root.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open')); dd.classList.toggle('open', o); };
        }
        dd.querySelectorAll('input').forEach(i => { i.checked = F[k].has(i.value); });
      });
      [['range', F.range], ['scopeSeg', F.scope], ['accSort', ACCSORT]].forEach(([r, v]) => { [...$(r).children].forEach(b => b.classList.toggle('on', b.dataset.v === v)); });
      $('dates').hidden = F.range !== 'custom';
    }
  
    // ---------- wiring ----------
    const segs = { range: v => { F.range = v; }, scopeSeg: v => { F.scope = v; }, accSort: v => { ACCSORT = v; } };
    Object.keys(segs).forEach(r => { $(r).onclick = e => { const b = e.target.closest('button'); if (!b) return; segs[r](b.dataset.v); PAGE = 0; render(); }; });
    $('from').onchange = e => { F.from = e.target.value; render(); }; $('to').onchange = e => { F.to = e.target.value; render(); };
    [['accTrig', 'accMenu'], ['trTrig', 'trMenu']].forEach(([t, m]) => { $(t).onclick = () => { const o = $(t).getAttribute('aria-expanded') !== 'true'; $(t).setAttribute('aria-expanded', o); $(m).classList.toggle('open', o); }; });
    root.addEventListener('click', () => root.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open')));
    $('csv').onclick = () => {
      const X = filteredTrades(), head = ['closed_at', 'opened_at', 'account', 'type', 'size', 'plan', 'status', 'market', 'side', 'qty', 'entry', 'exit', 'hold_min', 'exit_type', 'leverage', 'pnl', 'fees', 'funding', 'net'];
      const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
      const rows = X.map(t => { const a = A[t.acct] || {}; return [new Date(t.t1).toISOString(), new Date(t.t0).toISOString(), t.acct, a.kind, a.size, a.plan, a.status, t.sym, t.side, t.qty, t.open, t.close, Math.round(t.hold / 6e4), exitName(t.reason), t.lev, t.pnl.toFixed(2), t.fee.toFixed(2), t.fund.toFixed(2), t.net.toFixed(2)].map(q).join(','); });
      const blob = new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' });
      if (opt.download) return opt.download(blob, 'vest-profile-trades.csv');
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vest-profile-trades.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    if (opt.onRefresh) { $('refresh').hidden = false; $('refresh').onclick = () => opt.onRefresh($('refresh'), $('prog')); }
    if (opt.onClose) { $('close').hidden = false; $('close').onclick = opt.onClose; }
    $('snap').textContent = D.at ? 'Updated ' + fmtDT(D.at) : '';
  
    // ---------- art ----------
    function h(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
    function vn(a, b) { const i = Math.floor(a), j = Math.floor(b), f = a - i, k = b - j, u = f * f * (3 - 2 * f), v = k * k * (3 - 2 * k); return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v; }
    function drawMoon() {
      const c = $('moon'), x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, 520, 520); const C = RGB(); const CX = 260, CY = 260, R = 215, g = 6.5;
      const gr = x.createRadialGradient(CX, CY, R * .6, CX, CY, R * 1.2); gr.addColorStop(0, `rgba(${C},.10)`); gr.addColorStop(1, `rgba(${C},0)`); x.fillStyle = gr; x.fillRect(0, 0, 520, 520);
      const cr = []; for (let k = 0; k < 12; k++) { const a = h(k, 3) * 6.283, rr = Math.sqrt(h(k, 4)) * R * .85; cr.push([CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, R * (k < 3 ? .14 + h(k, 5) * .05 : .04 + h(k, 5) * .05)]); }
      for (let j = 0; j < 520 / (g * .866); j++) for (let i = 0; i < 520 / g + 1; i++) {
        const px = i * g + (j % 2 ? g / 2 : 0), py = j * g * .866, dx = (px - CX) / R, dy = (py - CY) / R, d2 = dx * dx + dy * dy; if (d2 >= 1) continue;
        const dz = Math.sqrt(1 - d2); let l = Math.max(0, dx * -.55 + dy * -.4 + dz * .73); l *= 1 - .28 * Math.min(1, Math.max(0, (vn(px / 70 + 2, py / 70) - .55) / .17));
        for (const [ax, ay, ar] of cr) { const ox = (px - ax) / ar, oy = (py - ay) / ar, d = Math.hypot(ox, oy); if (d > 1.2) continue; const w = Math.exp(-Math.pow((d - .85) / .18, 2)); l += .45 * w * (ox * -.55 + oy * -.4) / Math.max(d, .2); if (d < .75) l *= .75; }
        l = Math.min(1, Math.max(0, l)); const r = g * .47 * Math.pow(l, .8); if (r < .35) continue;
        x.fillStyle = `rgba(${C},${(.12 + .55 * l).toFixed(3)})`; x.beginPath(); x.arc(px, py, r, 0, 6.283); x.fill();
      }
    }
    function drawSky() {
      const c = $('sky'), x = c.getContext('2d'), C = RGB(), dp = window.devicePixelRatio || 1;
      c.width = innerWidth * dp; c.height = innerHeight * dp; flatField(c, C);
    }
  
    function setTheme(v) { root.dataset.theme = v; drawMoon(); drawSky(); render(); if (opt.saveTheme) opt.saveTheme(v); }
    $('theme').onclick = () => setTheme(root.dataset.theme === 'mono' ? 'cream' : 'mono');
    addEventListener('resize', drawSky);
    setTheme(opt.theme || 'cream');
  }
  
  const API = 'https://api-gateway.hz.vestmarkets.com';
  async function api(path) {
    if (!AUTH) throw new Error('noauth');
    const r = await f.call(W, API + path, { headers: { Accept: 'application/json', Authorization: AUTH } });
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }
  function planShort(p) {
    p = String(p || '').replace('Vest Capital ', '');
    if (/Instant/.test(p)) return 'Instant Funded';
    const tier = (p.split('|').pop() || '').trim();
    if (/2-Step/.test(p)) return '2-Step ' + tier;
    const g = p.match(/(\d+)% Goal/), d = p.match(/(\d+)% Daily/);
    return ('1-Step ' + (g ? g[1] + '% ' : '') + (/No Daily/.test(p) ? 'No DLL ' : d ? d[1] + '% DLL ' : '') + tier).replace(/\s+/g, ' ').trim();
  }
  async function pages(path, key, curKey) {
    let out = [], cur = null, n = 0;
    do { const j = await api(path + (cur ? (path.includes('?') ? '&' : '?') + 'cursor=' + encodeURIComponent(cur) : '')); out = out.concat(j[key] || []); const nx = j[curKey]; if (!nx || nx === cur) break; cur = nx; } while (++n < 60);
    return out;
  }
  async function scrapeProfile(prog) {
    const say = t => { if (prog) prog.textContent = t; };
    say('Reading accounts…');
    const acc = (await api('/v3/accounts?limit=500')).accounts || [];
    const cap = (await api('/v3/capital/accounts?limit=500')).accounts || [];
    say('Reading purchases…');
    let purch = []; try { purch = await pages('/v3/payments/purchases', 'items', 'nextCursor'); } catch (e) {}
    let pays = []; try { pays = await pages('/v3/history/payouts?sort_by=created_at&sort_dir=desc&limit=50', 'items', 'next'); } catch (e) {}
    // match each purchased account to the order that bought it
    const pool = purch.map(p => ({ at: Date.parse(p.paidAt || p.createdAt), name: p.productName, left: p.quantity || 1, unit: ((p.amountPaidMinor || 0) - (p.refundedMinor || 0)) / (p.quantity || 1) / 100 }));
    const cost = {};
    cap.filter(c => /_purchase$/.test(c.origin || '')).sort((x, y) => x.created_at - y.created_at).forEach(c => {
      const cs = pool.filter(p => p.name === c.plan_name && p.left > 0 && c.created_at - p.at >= -6e5 && c.created_at - p.at <= 2592e5);
      if (!cs.length) return; const p = cs.reduce((m, x) => Math.abs(c.created_at - x.at) < Math.abs(c.created_at - m.at) ? x : m); p.left--; cost[c.id] = p.unit;
    });
    const bal = {}; acc.forEach(a => { bal[a.account_id] = +a.amount || 0; });
    const accounts = cap.map(c => {
      const kind = c.plan_product_type === 'instant_funded' ? 'Instant' : c.account_type === 2 ? 'Eval' : 'Funded';
      const status = c.status === 4 ? 'Hit MLL' : c.status === 5 ? 'Hit DLL' : c.status === 6 ? 'Passed' : c.finalized_at ? 'Refunded' : 'Active';
      const st = (c.stages || []).find(s => s.kind === 'eval');
      return { id: c.id, root: c.root_account_id || c.id, kind, status, size: +c.initial_capital || 0, plan: planShort(c.plan_name), step: c.step || 1, steps: c.steps_total || 1, created: c.created_at || 0, ended: c.finalized_at || null, mll: +c.max_drawdown_pct || 0, dll: +c.max_daily_loss_pct || 0, target: st ? +st.profit_target || 0 : 0, split: +c.max_profit_split_pct || 0, origin: c.origin, cost: cost[c.id] || 0, balance: bal[c.id] || 0 };
    });
    const known = new Set(accounts.map(a => a.id));
    acc.filter(a => !known.has(a.account_id)).forEach(a => accounts.push({ id: a.account_id, root: a.account_id, kind: 'Primary', status: 'Active', size: 0, plan: 'Primary account', step: 1, steps: 1, created: 0, ended: null, mll: 0, dll: 0, target: 0, split: 0, origin: 'primary', cost: 0, balance: +a.amount || 0 }));
    const payouts = pays.map(x => ({ id: x.id, acct: x.account_id, amt: +x.trader_amount || 0, status: x.status || '', at: x.executed_at || x.created_at }));
    const trades = []; let done = 0;
    const sym = s => String(s || '').replace(/-USD-PERP$|-PERP$|-USD$/, '');
    const one = async a => {
      for (let off = 0; off < 20000; off += 100) {
        const j = await api(`/v3/positions?account_id=${a.id}&limit=100&offset=${off}`);
        const ps = j.positions || [];
        ps.forEach(x => { if (!x.closeDate) return; trades.push({ id: x.positionId, acct: x.accountId, sym: sym(x.symbol), side: x.side, qty: +x.quantity, open: +x.openPrice, close: +x.closePrice, t0: x.openDate, t1: x.closeDate, pnl: +x.pnl || 0, fee: +x.fee || 0, fund: +x.funding || 0, lev: +x.leverage || 0, reason: x.closeReason || '' }); });
        if (ps.length < 100) break;
      }
      done++; say(`Trades ${done}/${accounts.length} accounts`);
    };
    const q = accounts.slice(); await Promise.all([0, 1, 2, 3].map(async () => { while (q.length) { const a = q.shift(); try { await one(a); } catch (e) { if (String(e).includes('noauth')) throw e; } } }));
    const D = { at: Date.now(), accounts, trades, payouts };
    GM_setValue('profile', D); say('');
    return D;
  }

  // ---------- MyFundedPerps: your own API key, read-only calls to MFP's API ----------
  const IS_MFP = /(^|\.)myfundedperpetuals\.com$/.test(location.hostname);
  const MFP_API = 'https://developers.myfundedperpetuals.com/v1';
  function mreq(path) {
    const key = GM_getValue('mfpKey', '');
    if (!key) return Promise.reject(new Error('nokey'));
    return new Promise((ok, no) => GM_xmlhttpRequest({ method: 'GET', url: MFP_API + path, headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, timeout: 20000,
      onload: r => { if (r.status === 401 || r.status === 403) return no(new Error('badkey')); if (r.status !== 200) return no(new Error('http ' + r.status)); try { ok(JSON.parse(r.responseText)); } catch (e) { no(e); } },
      onerror: () => no(new Error('net')), ontimeout: () => no(new Error('net')) }));
  }
  async function scrapeMFP(prog) {
    const say = t => { if (prog) prog.textContent = t; };
    say('Reading accounts…');
    const accs = (await mreq('/accounts')).data || [];
    const ts = v => typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || 0;
    const pc = v => v == null || v === '' ? 0 : (+v > 1 ? +v / 100 : +v);
    const trimPct = v => String(Math.round(v * 1000) / 10).replace(/\.0$/, '');
    const accounts = accs.map(a => {
      const rq = (a.risk && a.risk.requirements) || {}, size = +a.starting_balance || 0, tg = pc(rq.profit_target_pct), dl = pc(rq.daily_loss_pct), md = pc(rq.max_drawdown_pct);
      const plan = (a.stage === 'funded' ? 'Funded' : (tg ? trimPct(tg) + '% target' : 'Evaluation')) + (dl ? ' · ' + trimPct(dl) + '% DLL' : ' · No DLL');
      return { id: String(a.id), root: String(a.id), kind: a.stage === 'funded' ? 'Funded' : 'Eval', status: ({ active: 'Active', passed: 'Passed', failed: 'Failed', closed: 'Closed' })[a.status] || 'Active', size, plan, step: 1, steps: 1, created: ts(a.created_at), ended: null, mll: md, dll: dl, target: tg * size, split: 0, origin: a.stage, cost: 0, balance: +a.balance || 0 };
    });
    const trades = []; let done = 0;
    const one = async a => {
      let cur = '', n = 0;
      do {
        const j = await mreq(`/positions?account_id=${encodeURIComponent(a.id)}&status=closed&limit=100${cur ? '&cursor=' + encodeURIComponent(cur) : ''}`);
        (j.data || []).forEach(x => { if (!x.closed_at) return; const sd = String(x.side || '').toLowerCase();
          trades.push({ id: String(x.id), acct: String(x.account_id || a.id), sym: x.symbol || x.coin || String(x.market_id || '').split('|').pop(), side: /short|sell/.test(sd) ? 'short' : 'long', qty: +x.size || 0, open: +x.entry_price || 0, close: +x.exit_price || 0, t0: ts(x.opened_at), t1: ts(x.closed_at), pnl: +x.realized_pnl || 0, fee: +x.fees || 0, fund: +x.funding || 0, lev: +x.leverage || 0, reason: x.close_reason || '' }); });
        cur = j.has_more ? j.next_cursor : '';
      } while (cur && ++n < 200);
      done++; say(`Trades ${done}/${accounts.length} accounts`);
    };
    const q = accounts.slice(); await Promise.all([0, 1, 2].map(async () => { while (q.length) await one(q.shift()); }));
    const D = { at: Date.now(), accounts, trades, payouts: [], tradingOnly: true };
    GM_setValue('mfpProfile', D); say('');
    return D;
  }
  function mfpKeyCard(ROOT, el, done) {
    const c = document.createElement('div');
    c.innerHTML = `<div class="card" style="max-width:460px;margin:12vh auto 0;padding:30px;display:flex;flex-direction:column;gap:14px">
      <div class="lab"><span class="k">MyFundedPerps</span>API key</div>
      <input data-r="mk" type="password" autocomplete="off" spellcheck="false" placeholder="fp_live_…" style="background:rgba(247,246,242,.04);border:1px solid var(--line);color:var(--fg);font:600 14px var(--sans);padding:13px 14px;border-radius:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><a href="https://docs.myfundedperpetuals.com/settings/api-keys" target="_blank" rel="noopener" style="color:var(--faint);font-size:12px;font-weight:700;text-decoration:none">Where to find it ↗</a><button class="pill" data-r="mks">Save</button></div>
      <span class="count" data-r="mke"></span></div>`;
    el.querySelector('.wrap').appendChild(c);
    const inp = c.querySelector('[data-r=mk]'), msg = c.querySelector('[data-r=mke]');
    c.querySelector('[data-r=mks]').onclick = () => { const v = inp.value.trim(); if (!/^fp_(live|test)_/.test(v)) { msg.textContent = 'Keys start with fp_live_'; return; } GM_setValue('mfpKey', v); done(); };
    inp.onkeydown = e => { if (e.key === 'Enter') c.querySelector('[data-r=mks]').click(); };
    setTimeout(() => inp.focus(), 50);
  }
  function closeProfile() { const h = document.getElementById('gp-prof'); if (h) h.remove(); document.documentElement.style.overflow = ''; }
  function openProfile() {
    closeProfile(); closeDash(); fonts();
    const HOST = document.createElement('div'); HOST.id = 'gp-prof';
    const ROOT = HOST.attachShadow({ mode: 'open' });
    ROOT.innerHTML = '<style>' + PCSS + FLAT('.gpp', '.gpp[data-theme="mono"]', '.gpp ') + '.gpp{position:fixed;inset:0;overflow:auto;z-index:2147483647;min-height:0}</style><div class="gpp">' + PBODY + '</div>';
    document.documentElement.appendChild(HOST); document.documentElement.style.overflow = 'hidden';
    const el = ROOT.querySelector('.gpp');
    const KEY = IS_MFP ? 'mfpProfile' : 'profile', SCRAPE = IS_MFP ? scrapeMFP : scrapeProfile;
    const D = GM_getValue(KEY, null) || { at: 0, accounts: [], trades: [], tradingOnly: IS_MFP };
    const run = async (btn, prog) => {
      btn.disabled = true; btn.classList.add('spin');
      try { await SCRAPE(prog); btn.classList.remove('spin'); openProfile(); }
      catch (e) { btn.disabled = false; btn.classList.remove('spin'); const m = String(e); if (/nokey|badkey/.test(m)) { GM_setValue('mfpKey', ''); openProfile(); return; } prog.textContent = m.includes('noauth') ? 'Sign in to Vest, wait a moment, then try again' : 'No answer, try again'; }
    };
    const lk = ROOT.querySelector('.lock'); lk.style.cursor = 'pointer'; lk.onclick = () => { closeProfile(); if (!IS_MFP) openGate(); };
    if (IS_MFP) { const mb = document.createElement('button'); mb.className = 'ib'; mb.style.cssText = 'width:auto;padding:0 14px;font:800 12.5px var(--sans);color:var(--fg)';
      const cnt = () => Object.keys(GM_getValue('mfpMap', {}) || {}).length; mb.textContent = 'Map · ' + cnt();
      mb.onclick = async () => { const txt = JSON.stringify({ host: location.host, pages: GM_getValue('mfpPages', []), endpoints: GM_getValue('mfpMap', {}) }); try { await navigator.clipboard.writeText(txt); mb.textContent = 'Copied · paste to Claude'; } catch (e) { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;inset:10%;z-index:9;background:#111;color:#eee'; el.appendChild(ta); ta.select(); mb.textContent = 'Select all and copy'; } };
      ROOT.querySelector('.hdr-r').insertBefore(mb, ROOT.querySelector('.hdr-r').firstChild); }
        if (IS_MFP) { ROOT.querySelector('.lx').style.display = 'none'; ROOT.querySelector('.vm').style.display = 'none'; ROOT.querySelector('.brand span').textContent = 'MFP Profile'; }
    if (IS_MFP && !GM_getValue('mfpKey', '')) { [...el.querySelector('.wrap').children].forEach(x => { if (!x.classList.contains('top')) x.style.display = 'none'; }); [...ROOT.querySelector('.hdr-r').children].forEach(x => { if (!/Map|Copied|Select/.test(x.textContent) && x.dataset.r !== 'close') x.style.display = 'none'; }); ROOT.querySelector('[data-r=close]').hidden = false; ROOT.querySelector('[data-r=close]').onclick = closeProfile; mfpKeyCard(ROOT, el, () => openProfile()); return; }
    GPProfile(el, D, { theme: GM_getValue('theme', null) || 'cream', saveTheme: v => GM_setValue('theme', v), onClose: closeProfile, onRefresh: run });
    if (IS_MFP ? !D.at : !D.payouts) setTimeout(() => run(ROOT.querySelector('[data-r=refresh]'), ROOT.querySelector('[data-r=prog]')), 300);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfile(); });


  // ---------- gate: pick Earnings or Profile ----------
  const GCSS = `:host{all:initial}
  .g{--bg:#0b0b0b;--fg:#eeeae2;--mute:#a39e94;--line:rgba(238,234,226,.09);position:fixed;inset:0;z-index:2147483647;background:var(--bg);color:var(--fg);font-family:"Manrope",system-ui,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;overflow:auto}
  .g[data-theme=mono]{--bg:#0b0b0c;--fg:#f1f1f3;--mute:#9e9ea5}
  .sky{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
  .vmk{position:fixed;right:clamp(28px,7vw,120px);bottom:clamp(28px,7vh,96px);width:clamp(150px,17vw,280px);pointer-events:none;opacity:.9}
  .vmk svg{display:block;width:100%;height:auto}
  .top{position:relative;display:flex;justify-content:space-between;align-items:center;padding:clamp(24px,5vh,56px) clamp(20px,6vw,96px) 0}
  .brand{display:flex;align-items:baseline;gap:14px;font-size:clamp(26px,2.6vw,38px);font-weight:800;letter-spacing:-.045em}
  .brand b{font-weight:800}
  .brand span{font-size:12px;letter-spacing:.32em;font-weight:700;color:var(--mute)}
  .x{width:40px;height:40px;border-radius:99px;border:1px solid var(--line);background:transparent;color:var(--mute);font-size:14px;cursor:pointer}
  .x:hover{color:var(--fg);border-color:rgba(238,234,226,.2)}
  .doors{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:clamp(18px,4vh,44px);padding:clamp(24px,5vh,56px) clamp(20px,6vw,96px) clamp(40px,8vh,96px);max-width:900px}
  .d{position:relative;display:block;padding:0;border:0;background:none;cursor:pointer;text-align:left;color:inherit;font:inherit}
  .d+.d{padding-top:clamp(18px,4vh,44px);border-top:1px solid var(--line)}
  .d small{display:block;font-size:15px;font-weight:600;color:var(--mute)}
  .d b{display:inline-flex;align-items:flex-start;gap:.12em;margin-top:6px;font-size:clamp(68px,10vw,148px);font-weight:800;letter-spacing:-.065em;line-height:.86;color:var(--c);transition:transform .35s cubic-bezier(.2,.8,.2,1)}
  .d b em{font-style:normal;font-size:.28em;font-weight:700;letter-spacing:0;color:var(--mute);margin-top:.18em;transition:transform .35s cubic-bezier(.2,.8,.2,1),color .2s}
  .d span{display:block;margin-top:clamp(12px,1.6vh,18px);font-size:clamp(17px,1.5vw,22px);font-weight:600;color:var(--mute);font-variant-numeric:tabular-nums;min-height:1.2em}
  .d span strong{font-weight:800;color:var(--fg)}
  .d:hover b,.d:focus-visible b{transform:translateX(10px)}
  .d:hover b em,.d:focus-visible b em{transform:translate(4px,-4px);color:var(--fg)}
  .d:focus-visible{outline:none}
  @media (max-width:700px){.vmk{width:120px;opacity:.7}.doors{justify-content:flex-start;padding-top:12vh}}`;
  function closeGate() { const h = document.getElementById('gp-gate'); if (h) h.remove(); document.documentElement.style.overflow = ''; }
  function openGate() {
    closeGate(); closeDash(); closeProfile(); fonts();
    const mono = GM_getValue('theme', null) === 'mono';
    const V = mono ? { rgb: '226,226,232', c: '#e8e8ec' } : { rgb: '227,218,201', c: '#e3dac9' };
    const money = v => (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const an = GM_getValue('analytics', null), pr = GM_getValue('profile', null);
    const earn = an && an.totals ? '<strong>' + money(an.totals.net_cents / 100) + '</strong> earned' : 'affiliate earnings and payouts';
    let prof = 'every account, every trade';
    if (pr && pr.payouts) { const spent = pr.accounts.reduce((s, a) => s + (a.cost || 0), 0), paid = pr.payouts.filter(p => !/fail|reject|cancel/i.test(p.status)).reduce((s, p) => s + p.amt, 0); prof = '<strong>' + (paid - spent >= 0 ? '+' : '') + money(paid - spent) + '</strong> real PnL'; }
    const HOST = document.createElement('div'); HOST.id = 'gp-gate';
    const R = HOST.attachShadow({ mode: 'open' });
    R.innerHTML = `<style>${GCSS}</style><div class="g" data-theme="${mono ? 'mono' : 'cream'}" style="--c:${V.c}">
      <canvas class="sky"></canvas><div class="vmk">${VEST_SVG}</div>
      <div class="top"><div class="brand"><b>GIGAPROP.</b><span>VEST</span></div><button class="x" aria-label="Close">✕</button></div>
      <div class="doors">
        <button class="d" data-go="earn"><small>affiliate · payouts</small><b>Earnings<em>↗</em></b><span>${earn}</span></button>
        <button class="d" data-go="prof"><small>accounts · trades</small><b>Profile<em>↗</em></b><span>${prof}</span></button>
      </div></div>`;
    document.documentElement.appendChild(HOST); document.documentElement.style.overflow = 'hidden';
    const sky = R.querySelector('.sky'), dp = devicePixelRatio || 1; sky.width = innerWidth * dp; sky.height = innerHeight * dp; flatField(sky, V.rgb);
    R.querySelector('.x').onclick = closeGate;
    R.querySelectorAll('.d').forEach(d => d.onclick = () => { closeGate(); d.dataset.go === 'prof' ? openProfile() : openDash('aff'); });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeGate(); });

  // Refresh: open Affiliates and Portfolio in hidden frames, press the same buttons a person would, read what Vest returns.
  function pull(path, steps) {
    return new Promise(done => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1400px;height:900px;opacity:0;pointer-events:none';
      f.src = path; document.documentElement.appendChild(f);
      const t0 = Date.now(); let i = 0, tc = 0, gone = false;
      const end = () => { if (gone) return; gone = true; clearInterval(t); f.remove(); done(); };
      const fresh = k => { const v = GM_getValue(k, null); const at = v && typeof v === 'object' ? v.at : v; return at && at > tc; };
      const t = setInterval(() => {
        if (Date.now() - t0 > 30000) return end();
        const s = steps[i]; if (!s) return end();
        try {
          const w = f.contentWindow, d = f.contentDocument;
          if (!tc) {
            const b = d && [...d.querySelectorAll('button,[role=tab],a')].find(x => x.textContent.trim() === s.click);
            if (b) { if (s.silent) w.__gpSilent = Date.now() + 6000; b.click(); tc = Date.now(); }
          } else if ((s.wait && fresh(s.wait)) || Date.now() - tc > (s.ms || 5000)) { i++; tc = 0; }
        } catch (e) {}
      }, 250);
    });
  }
  const refreshAll = () => Promise.all([
    pull('/affiliates', [{ click: '1Y', wait: 'analytics', ms: 8000 }]),
    pull('/portfolio', [{ click: 'Payouts', ms: 1500 }, { click: 'Export CSV', silent: 1, wait: 'payoutsAt', ms: 6000 }, { click: 'Withdrawals', ms: 1500 }, { click: 'Export CSV', silent: 1, wait: 'withdrawalsAt', ms: 6000 }])
  ]);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDash(); });

  function mountDash(ROOT, HOST, store, startView) {
const $ = id => ROOT.getElementById(id);
const HAS = false;
const HOLD = 30;
const usd = (c, dec) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: dec ? 2 : 0 });
const big = c => usd(c - c % 100) + '<small>.' + String(Math.round(c % 100)).padStart(2, '0') + '</small>';
const day = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const add = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };
const fmt = dt => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtT = dt => dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const RGB = () => getComputedStyle(HOST).getPropertyValue('--rgb').trim() || '239,226,189';
const CV = n => getComputedStyle(HOST).getPropertyValue(n).trim();
const num = v => parseFloat(v) || 0;
const toggle = (t, m) => t.onclick = () => { const o = t.getAttribute('aria-expanded') !== 'true'; t.setAttribute('aria-expanded', o); m.classList.toggle('open', o); };

function load() { return Promise.resolve(store.all()); }

function renderAff(a) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const T = a.totals;
  const rows = a.daily.filter(r => r.due_cents > 0).map(r => { const e = day(r.date), u = add(e, HOLD); return { earned: e, unlock: u, cents: r.due_cents, days: Math.round((u - today) / 864e5) }; }).sort((x, y) => x.unlock - y.unlock);
  const sum = f => rows.filter(f).reduce((s, r) => s + r.cents, 0);
  const held = T.held_cents != null ? T.held_cents : sum(r => r.days >= 0);
  const unlocked = Math.max(0, T.due_cents - held);
  const week = sum(r => r.days >= 0 && r.days <= 6), later = Math.max(0, held - week);
  const paid = T.paid_cents, net = T.net_cents;
  $('avail').textContent = usd(unlocked, 1);
  $('net').innerHTML = big(net);
  $('of').innerHTML = `<b>${usd(paid + unlocked, 1)}</b> unlocked · <b>${usd(held, 1)}</b> still on hold`;
  let x0 = 0; const seg = (c, col) => { const w = c / (net || 1) * 100, s = `<span style="left:${x0}%;width:${Math.max(w, c > 0 ? .6 : 0)}%;background:${col}"></span>`; x0 += w; return s; };
  $('track').innerHTML = seg(paid, 'var(--mint)') + seg(unlocked, 'var(--cream)') + seg(week, 'rgba(var(--rgb),.38)') + seg(later, 'rgba(247,246,242,.14)');
  $('s7').textContent = usd(week, 1); $('sHeld').textContent = usd(held, 1); $('sPaid').textContent = usd(paid, 1);
  const last = rows[rows.length - 1]; $('sEnd').textContent = last ? fmt(last.unlock) : '—';
  const next = rows.find(r => r.days >= 0);
  if (next) {
    $('nWhen').textContent = next.days === 0 ? 'Today' : next.days === 1 ? 'Tomorrow' : `In ${next.days} days`;
    $('nAmt').textContent = usd(next.cents, 1); $('nFrom').textContent = fmt(next.unlock);
    const done = Math.min(1, Math.max(0, (HOLD - next.days) / HOLD)), C = 2 * Math.PI * 32;
    $('ring').innerHTML = `<circle cx="38" cy="38" r="32" fill="none" stroke="rgba(247,246,242,.08)" stroke-width="6"/><circle cx="38" cy="38" r="32" fill="none" stroke="${CV('--cream')}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C * done} ${C}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle" font-size="14" font-weight="800" fill="#f7f6f2">${Math.round(done * 100)}%</text>`;
  } else { $('nWhen').textContent = 'All clear'; $('nAmt').textContent = ''; $('nFrom').textContent = ''; $('ring').innerHTML = ''; }
  const pending = rows.filter(r => r.days >= 0);
  $('stack').innerHTML = pending.slice(0, 4).map(r => `<i style="background:${r.days === 0 ? 'var(--mint)' : r.days <= 7 ? 'var(--cream)' : 'rgba(247,246,242,.3)'}"></i>`).join('');
  $('trigTxt').innerHTML = `<b>${pending.length}</b> unlocks · ${usd(held, 1)}`;
  const all = a.daily.filter(r => (r.due_cents || 0) + (r.paid_cents || 0) > 0).map(r => { const u = add(day(r.date), HOLD); return { unlock: u, cents: (r.due_cents || 0) + (r.paid_cents || 0), paidOut: !r.due_cents, days: Math.round((u - today) / 864e5) }; }).sort((x, y) => x.unlock - y.unlock);
  $('list').innerHTML = all.map(r => {
    const st = r.days < 0 ? 'open' : r.days === 0 ? 'today' : r.days <= 7 ? 'soon' : 'locked';
    const col = st === 'open' || st === 'today' ? 'var(--mint)' : st === 'soon' ? 'linear-gradient(var(--hi1),var(--hi3))' : 'rgba(247,246,242,.16)';
    const lab = r.paidOut && r.days < 0 ? 'Paid out' : st === 'open' ? 'Unlocked' : r.days === 0 ? 'Today' : r.days === 1 ? 'Tomorrow' : `In ${r.days} days`;
    return `<li class="${st}"><span class="dot" style="background:${col}"></span><div><div class="who">${fmt(r.unlock)}</div></div><div class="tag"><b>${usd(r.cents, 1)}</b><span>${lab}</span></div></li>`;
  }).join('');
}

function renderPay(map) {
  const P = Object.values(map).map(p => ({ acct: (p.account_id || '').slice(0, 4), amt: num(p.trader_amount) * 100, status: String(p.status || '').toLowerCase(), created: new Date(p.created_at), executed: p.executed_at ? new Date(p.executed_at) : null }))
    .filter(p => !isNaN(p.created)).sort((a, b) => b.created - a.created);
  const isRecv = p => /executed|completed|paid/.test(p.status), isFail = p => /fail|reject|cancel/.test(p.status);
  const recv = P.filter(isRecv), proc = P.filter(p => !isRecv(p) && !isFail(p));
  const sR = recv.reduce((s, p) => s + p.amt, 0), sP = proc.reduce((s, p) => s + p.amt, 0);
  $('pRecv').innerHTML = big(sR + sP);
  $('pOf').innerHTML = `<b>${usd(sR, 1)}</b> received · <b>${usd(sP, 1)}</b> processing`;
  const tot = sR + sP || 1;
  $('pTrack').innerHTML = `<span style="left:0;width:${sR / tot * 100}%;background:var(--mint)"></span><span style="left:${sR / tot * 100}%;width:${sP / tot * 100}%;background:var(--cream)"></span>`;
  const lastEta = proc.length ? Math.max(...proc.map(p => p.created.getTime() + 864e5)) : 0, hrs = Math.max(0, Math.round((lastEta - Date.now()) / 36e5));
  $('pWhen').textContent = proc.length ? (hrs <= 0 ? 'Now' : hrs < 24 ? `Within ${hrs}h` : 'Tomorrow') : 'Nothing pending';
  $('pAmt').textContent = proc.length ? usd(sP, 1) : ''; $('pCnt').textContent = proc.length ? `${proc.length} payouts` : '';
  const rp = proc.length ? Math.min(1, Math.max(0, 1 - hrs / 24)) : 1, C2 = 2 * Math.PI * 32;
  $('pring').innerHTML = `<circle cx="38" cy="38" r="32" fill="none" stroke="rgba(247,246,242,.08)" stroke-width="6"/><circle cx="38" cy="38" r="32" fill="none" stroke="${proc.length ? CV('--cream') : CV('--mint')}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C2 * rp} ${C2}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle" font-size="14" font-weight="800" fill="#f7f6f2">${proc.length ? hrs + 'h' : '✓'}</text>`;
  const ok = P.filter(p => !isFail(p)), amts = ok.map(p => p.amt);
  $('pMax').textContent = amts.length ? usd(Math.max(...amts), 1) : '—';
  $('pAvg').textContent = amts.length ? usd(amts.reduce((a, b) => a + b, 0) / amts.length, 1) : '—';
  $('pN').textContent = P.length; $('pAcc').textContent = new Set(P.map(p => p.acct)).size;
  $('pstack').innerHTML = P.slice(0, 4).map(p => `<i style="background:${isRecv(p) ? 'var(--mint)' : 'var(--cream)'}"></i>`).join('');
  $('ptrigTxt').innerHTML = `<b>${P.length}</b> payouts · ${usd(sR + sP, 1)}`;
  $('plist').innerHTML = P.map(p => {
    const ok = isRecv(p), bad = isFail(p);
    return `<li class="${ok ? 'open' : bad ? 'locked' : 'soon'}"><span class="dot" style="background:${ok ? 'var(--mint)' : bad ? 'rgba(217,163,163,.6)' : 'linear-gradient(var(--hi1),var(--hi3))'}"></span><div><div class="who">${fmtT(ok && p.executed ? p.executed : p.created)}</div></div><div class="tag"><b>${usd(p.amt, 1)}</b><span>${ok ? 'Received' : bad ? 'Failed' : 'Processing'}</span></div></li>`;
  }).join('');
}

let LIST = 'pay';
$('pseg').onclick = e => { const b = e.target.closest('button'); if (!b) return; LIST = b.dataset.v; render(); };
function renderWd(map, P) {
  const W2 = Object.values(map || {}).map(w => ({ amt: num(w.amount) * 100, status: String(w.status || '').toLowerCase(), created: new Date(w.created_at), network: w.network || '' }))
    .filter(w => !isNaN(w.created)).sort((a, b) => b.created - a.created);
  const done = w => /complete|executed|sent|success|confirmed|paid/.test(w.status), bad = w => /fail|reject|cancel/.test(w.status);
  const ok = W2.filter(w => !bad(w)), sum = ok.reduce((s, w) => s + w.amt, 0);
  $('pseg').hidden = !W2.length;
  if (W2.length) { $('pAvgL').textContent = 'Withdrawn'; $('pAvg').textContent = usd(sum, 1); }
  if (LIST !== 'wd' || !W2.length) return;
  [...$('pseg').children].forEach(b => b.classList.toggle('on', b.dataset.v === 'wd'));
  $('pstack').innerHTML = W2.slice(0, 4).map(w => `<i style="background:${done(w) ? 'var(--mint)' : 'var(--cream)'}"></i>`).join('');
  $('ptrigTxt').innerHTML = `<b>${W2.length}</b> withdrawals · ${usd(sum, 1)}`;
  $('plist').innerHTML = W2.map(w => {
    const ok = done(w), b = bad(w);
    return `<li class="${ok ? 'open' : b ? 'locked' : 'soon'}"><span class="dot" style="background:${ok ? 'var(--mint)' : b ? 'rgba(217,163,163,.6)' : 'linear-gradient(var(--hi1),var(--hi3))'}"></span><div><div class="who">${fmtT(w.created)}</div></div><div class="tag"><b>${usd(w.amt, 1)}</b><span>${ok ? (w.network || 'Sent') : b ? 'Failed' : 'Processing'}</span></div></li>`;
  }).join('');
}

async function render() {
  const S = await load();
  const hasA = !!(S.analytics && S.analytics.totals), hasP = !!((S.payouts && Object.keys(S.payouts).length) || (S.withdrawals && Object.keys(S.withdrawals).length));
  ROOT.querySelectorAll('#duo .a').forEach(e => e.hidden = !hasA);
  ROOT.querySelectorAll('#duo .p').forEach(e => e.hidden = !hasP);
  $('duo').style.gridTemplateColumns = hasA && hasP ? '' : '1fr';
  $('empty').hidden = hasA || hasP;
  const at = Math.max(S.analytics ? S.analytics.at || 0 : 0, S.payoutsAt || 0, S.withdrawalsAt || 0);
  $('snap').textContent = at ? 'Updated ' + fmtT(new Date(at)) : '';
  ROOT.querySelector('.pay').hidden = !hasA;
  if (hasA) renderAff(S.analytics);
  if (hasP) { [...$('pseg').children].forEach(b => b.classList.toggle('on', b.dataset.v === LIST)); renderPay(S.payouts || {}); renderWd(S.withdrawals, S.payouts); }
}

toggle($('trig'), $('menu')); toggle($('ptrig'), $('pmenu'));
document.addEventListener('gp-update', () => { if (HOST.isConnected) render(); });

// stippled moon + starfield
function h(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
function vn(a, b) { const i = Math.floor(a), j = Math.floor(b), f = a - i, k = b - j, u = f * f * (3 - 2 * f), v = k * k * (3 - 2 * k); return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v; }
function drawMoon() {
  const c = $('moon'), x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, 520, 520); const C = RGB(); const CX = 260, CY = 260, R = 215, g = 6.5;
  const gr = x.createRadialGradient(CX, CY, R * .6, CX, CY, R * 1.2); gr.addColorStop(0, `rgba(${C},.10)`); gr.addColorStop(1, `rgba(${C},0)`); x.fillStyle = gr; x.fillRect(0, 0, 520, 520);
  const cr = []; for (let k = 0; k < 12; k++) { const a = h(k, 3) * 6.283, rr = Math.sqrt(h(k, 4)) * R * .85; cr.push([CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, R * (k < 3 ? .14 + h(k, 5) * .05 : .04 + h(k, 5) * .05)]); }
  for (let j = 0; j < 520 / (g * .866); j++) for (let i = 0; i < 520 / g + 1; i++) {
    const px = i * g + (j % 2 ? g / 2 : 0), py = j * g * .866, dx = (px - CX) / R, dy = (py - CY) / R, d2 = dx * dx + dy * dy; if (d2 >= 1) continue;
    const dz = Math.sqrt(1 - d2); let l = Math.max(0, dx * -.08 + dy * -.5 + dz * .86); l *= 1 - .28 * Math.min(1, Math.max(0, (vn(px / 70 + 2, py / 70) - .55) / .17));
    for (const [ax, ay, ar] of cr) { const ox = (px - ax) / ar, oy = (py - ay) / ar, d = Math.hypot(ox, oy); if (d > 1.2) continue; const w = Math.exp(-Math.pow((d - .85) / .18, 2)); l += .45 * w * (ox * -.08 + oy * -.5) / Math.max(d, .2); if (d < .75) l *= .75; }
    l = Math.min(1, Math.max(0, l)); const r = g * .47 * Math.pow(l, .8); if (r < .35) continue;
    x.fillStyle = `rgba(${C},${(.12 + .55 * l).toFixed(3)})`; x.beginPath(); x.arc(px, py, r, 0, 6.283); x.fill();
  }
  const m2 = $('moon2').getContext('2d'); m2.clearRect(0, 0, 1040, 1040); m2.drawImage(c, 0, 0);
}
let drawSky;
(function () {
  const c = $('sky'), x = c.getContext('2d');
  const draw = drawSky = () => { const C = RGB();
    c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; flatField(c, C);
  };
  draw(); addEventListener('resize', draw);
})();
function setTheme(v) {
  HOST.dataset.theme = v;
  drawMoon(); drawSky(); render();
}
$('theme').onclick = () => { const v = HOST.dataset.theme === 'mono' ? 'cream' : 'mono'; setTheme(v); store.set('theme', v); };
load().then(S => setTheme(S.theme || 'cream'));



  }

  // ---------- GP. button on Affiliates and Portfolio ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clickText = t => { const b = [...document.querySelectorAll('button,[role=tab]')].find(x => x.textContent.trim() === t); if (b) b.click(); return !!b; };
  function gpButton() {
    if (W.top !== W.self) return;
    let host = document.getElementById('gp-btn');
    if (host || !document.body) return;
    fonts();
    host = document.createElement('div'); host.id = 'gp-btn';
    const pos = GM_getValue('btnPos', null) || { side: 'right', y: 0.5 };
    const place = () => { host.style.cssText = `position:fixed;z-index:2147483646;top:${Math.round(pos.y * 100)}%;transform:translateY(-50%);${pos.side}:10px`; host.dataset.side = pos.side; };
    place();
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      button{display:flex;align-items:center;gap:0;height:38px;padding:0 0 0 0;border-radius:99px;cursor:grab;color:#f7f6f2;touch-action:none;user-select:none;
        font:800 12.5px "Manrope",system-ui,sans-serif;letter-spacing:-.01em;
        background:#0f0f0f;border:1px solid rgba(238,234,226,.16);box-shadow:0 14px 34px -12px rgba(0,0,0,.85);
        transition:border-color .2s,box-shadow .2s;opacity:.82}
      :host([data-side=left]) button{flex-direction:row-reverse}
      button:hover,button.busy{opacity:1;border-color:rgba(238,234,226,.36)}
      button.drag{cursor:grabbing;opacity:1;box-shadow:0 20px 44px -10px rgba(0,0,0,.9)}
      b{width:36px;text-align:center;flex:none}
      i{font-style:normal;color:#e3dac9}
      span{max-width:0;overflow:hidden;white-space:nowrap;padding:0;border-radius:99px;background:#e3dac9;color:#0b0b0b;transition:max-width .25s,padding .25s,margin .25s}
      button:hover span,button.busy span{max-width:120px;padding:7px 12px;margin:0 4px}
      button.drag span{max-width:0;padding:0;margin:0}
    </style><button id="b" title="GP. (drag to move)"><b>GP<i>.</i></b><span id="t">Open</span></button>`;
    const btn = root.getElementById('b');
    
    let sx = 0, sy = 0, moved = false, down = false;
    btn.addEventListener('pointerdown', e => { down = true; moved = false; sx = e.clientX; sy = e.clientY; btn.setPointerCapture(e.pointerId); });
    btn.addEventListener('pointermove', e => {
      if (!down) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      moved = true; btn.classList.add('drag');
      host.style.cssText = `position:fixed;z-index:2147483646;left:${e.clientX - 19}px;top:${e.clientY - 19}px`;
    });
    btn.addEventListener('pointerup', e => {
      if (!down) return; down = false; btn.classList.remove('drag');
      if (!moved) return;
      pos.side = e.clientX < innerWidth / 2 ? 'left' : 'right';
      pos.y = Math.min(0.95, Math.max(0.05, e.clientY / innerHeight));
      GM_setValue('btnPos', pos); place();
    });
    btn.onclick = e => { if (moved) { moved = false; return; } IS_MFP ? openProfile() : openGate(); };
    document.body.appendChild(host);
  }
  setInterval(gpButton, 1200);
  if (/(^|\.)myfundedperpetuals\.com$/.test(location.hostname)) setInterval(() => { try { const ps = GM_getValue('mfpPages', []) || []; if (!ps.includes(location.pathname)) { ps.push(location.pathname); GM_setValue('mfpPages', ps.slice(-60)); } } catch (e) {} }, 2000);
})();
