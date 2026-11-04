// ==UserScript==
// @name         GP. Dashboard for Vest
// @namespace    https://github.com/deciphe/gp-vest
// @version      1.3.0
// @description  Your Vest affiliate earnings, unlock dates and payouts on one clean page. Data stays in your browser.
// @author       GP.
// @match        https://next.vestmarkets.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/deciphe/gp-vest/main/gp-vest.user.js
// @downloadURL  https://raw.githubusercontent.com/deciphe/gp-vest/main/gp-vest.user.js
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
      network: String(pick(x, 'network', 'chain', 'chain_name') || ''),
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
  W.XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => { try { if (this.responseType === '' || this.responseType === 'text') take(this.__gpu, this.responseText); } catch (e) {} });
    return XS.apply(this, arguments);
  };

  // ---------- dashboard overlay ----------
  const CSS = "\n:host{--rgb:239,226,189;--hi1:#fff7df;--hi2:#efe2bd;--hi3:#c9b27a;--btn1:#f6ecd0;--btn2:#d9c48c;--bg:#0f0f0e;--card:rgba(28,28,26,.72);--card2:#232321;--line:rgba(247,246,242,.09);--line2:rgba(var(--rgb),.22);--fg:#f7f6f2;--mute:rgba(247,246,242,.6);--faint:rgba(247,246,242,.36);\n--cream:#efe2bd;--gold:#d9c48c;--mint:#8fdcb4;--sans:\"Manrope\",system-ui,-apple-system,\"Segoe UI\",sans-serif;color-scheme:dark}\n:host([data-theme=\"mono\"]){--rgb:226,226,232;--hi1:#ffffff;--hi2:#e6e6ea;--hi3:#9a9aa2;--btn1:#f2f2f4;--btn2:#a9a9b0;--bg:#0e0e10;--card:rgba(24,24,27,.8);--line:rgba(255,255,255,.08);--cream:#ececf0;--gold:#c9c9cf;--mint:#b4e6cc}\n*{box-sizing:border-box}\n\n.root{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--bg);color:var(--fg);font-family:var(--sans);-webkit-font-smoothing:antialiased;margin:0;padding-block:40px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));overflow-x:hidden;overflow-y:auto}\n#sky{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}\n.wrap{position:relative;z-index:1;max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:16px}\n.top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:0 4px 8px}\n.brand{font-size:20px;font-weight:800;letter-spacing:-.04em}.brand i{font-style:normal;color:var(--cream)}\n.brand span{margin-left:14px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.live{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;color:var(--mute)}\n.hdr-r{display:flex;align-items:center;gap:18px;flex-wrap:wrap}\n.pay{display:flex;align-items:center;gap:12px;padding:6px 6px 6px 18px;border-radius:99px;border:1px solid var(--line2);background:linear-gradient(150deg,rgba(var(--rgb),.12),rgba(var(--rgb),.02));text-decoration:none;color:var(--fg);backdrop-filter:blur(14px);transition:border-color .2s,transform .2s}\n.pay:hover{border-color:rgba(var(--rgb),.5);transform:translateY(-1px)}\n.pay:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n.pay-l{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.pay-v{font-size:17px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}\n.pay-b{display:flex;align-items:center;gap:6px;padding:9px 16px;border-radius:99px;background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413;font-size:13px;font-weight:800;letter-spacing:-.01em}\n.live b{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 5px rgba(143,220,180,.14),0 0 14px var(--mint);animation:pulse 2.4s ease-in-out infinite}\n@keyframes pulse{50%{box-shadow:0 0 0 8px rgba(143,220,180,.04),0 0 18px var(--mint)}}\n.card{position:relative;background:var(--card);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:26px;padding:28px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 30px 80px -40px rgba(0,0,0,.8)}\n.corner:before{content:\"\";position:absolute;left:14px;top:14px;width:64px;height:64px;border-left:1px solid var(--line2);border-top:1px solid var(--line2);border-top-left-radius:8px;pointer-events:none}\n.lab{font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.row1{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px}\n@media (max-width:980px){.row1{grid-template-columns:1fr}}\n.hero{min-height:420px;display:flex;flex-direction:column;overflow:hidden}\n#moon{position:absolute;right:-40px;top:-40px;width:520px;height:520px;pointer-events:none;opacity:.95}\n.hero .big{margin-top:auto;font-size:clamp(64px,10vw,150px);font-weight:800;letter-spacing:-.065em;line-height:.86;font-variant-numeric:tabular-nums;\nbackground:linear-gradient(180deg,var(--hi1) 0%,var(--hi2) 55%,var(--hi3) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 40px rgba(var(--rgb),.18))}\n.hero .big small{font-size:.38em;letter-spacing:-.03em}\n.hero .of{margin-top:14px;font-size:16px;font-weight:600;color:var(--mute)}\n.hero .of b{color:var(--fg);font-weight:800}\n.track{margin-top:26px;position:relative;height:14px;border-radius:99px;background:rgba(247,246,242,.07);overflow:hidden}\n.track span{position:absolute;top:0;bottom:0;border-radius:99px}\n.legend{margin-top:12px;display:flex;gap:18px;flex-wrap:wrap;font-size:12px;font-weight:600;color:var(--mute)}\n.legend i{display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:7px;vertical-align:1px}\n.side{display:grid;grid-template-rows:auto 1fr;gap:16px}\n.next{overflow:hidden;background:linear-gradient(150deg,rgba(var(--rgb),.13),rgba(var(--rgb),.02) 55%),var(--card);border-color:var(--line2)}\n.next .when{margin-top:14px;font-size:64px;font-weight:800;letter-spacing:-.06em;line-height:.9}\n.next .amt{margin-top:18px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}\n.next .amt b{font-size:40px;font-weight:800;letter-spacing:-.045em;color:var(--cream);font-variant-numeric:tabular-nums}\n.next .amt span{font-size:13px;font-weight:600;color:var(--mute)}\n.ring{position:absolute;right:24px;top:24px;width:76px;height:76px}\n.stats{display:grid;grid-template-columns:1fr 1fr;gap:16px}\n.stat{padding:22px}\n.stat b{display:block;margin-top:12px;font-size:30px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums}\n.stat span{display:block;margin-top:6px;font-size:12px;font-weight:600;color:var(--faint)}\n.stat.hl b{color:var(--cream)}\n.cal-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}\n.cal-head h2{margin:8px 0 0;font-size:30px;font-weight:800;letter-spacing:-.04em}\n.cal-head p{margin:6px 0 0;font-size:14px;font-weight:600;color:var(--mute)}\n.keys{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;font-weight:600;color:var(--mute)}\n.keys i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;vertical-align:-1px}\n.wk{font-size:13px;font-weight:600;color:var(--mute)}.wk b{color:var(--cream);font-weight:800}\n.dow,.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}\n.dow{margin-top:20px}.dow span{padding-left:4px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.cal{margin-top:10px}\n.cell{position:relative;min-height:108px;border-radius:18px;padding:14px 16px;background:rgba(247,246,242,.025);border:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden}\n.cell.pad{background:transparent;border-color:transparent}\n.cell .d{font-size:12px;font-weight:700;color:var(--faint)}\n.cell .v{margin-top:auto;font-size:clamp(15px,1.7vw,26px);font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums;position:relative;z-index:1}\n.cell .fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(var(--rgb),.0),rgba(var(--rgb),.22));}\n.cell.zero .v{color:rgba(247,246,242,.18)}\n.cell.today{border-color:rgba(143,220,180,.5);box-shadow:0 0 0 1px rgba(143,220,180,.25),0 0 30px -8px rgba(143,220,180,.5)}\n.cell.today .d{color:var(--mint)}\n.cell.today .fill{background:linear-gradient(180deg,rgba(143,220,180,0),rgba(143,220,180,.22))}\n.cell.peak{border-color:rgba(var(--rgb),.4)}\n.cell.peak .v{color:var(--cream);text-shadow:0 0 24px rgba(var(--rgb),.35)}\n.cell.past{opacity:.35}\n@media (max-width:760px){.dow,.cal{gap:5px}.cell{min-height:70px;padding:8px;border-radius:12px}.dow span{letter-spacing:.05em}}\n#chart{display:block;width:100%;min-width:760px;height:auto}\nsvg text{font-family:var(--sans)}\n.tip{position:fixed;z-index:5;pointer-events:none;padding:10px 12px;border-radius:12px;background:#1f1f1d;border:1px solid var(--line2);font-size:12px;font-weight:600;color:var(--mute);opacity:0;transition:opacity .12s;box-shadow:0 14px 40px rgba(0,0,0,.5)}\n.tip b{display:block;font-size:18px;font-weight:800;color:var(--cream);letter-spacing:-.03em}\n.trig{width:100%;display:flex;align-items:center;gap:14px;padding:18px 22px;border-radius:20px;border:1px solid var(--line);background:var(--card);backdrop-filter:blur(18px);color:var(--mute);font:600 15px var(--sans);cursor:pointer;text-align:left;transition:border-color .2s,background .2s,color .2s}\n.trig:hover,.trig[aria-expanded=\"true\"]{border-color:var(--line2);background:rgba(var(--rgb),.05);color:var(--fg)}\n.trig:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n.trig b{color:var(--cream)}\n.stack{display:flex}.stack i{width:14px;height:14px;border-radius:5px;border:2px solid #1c1c1a;margin-left:-4px}.stack i:first-child{margin-left:0}\n.chev{margin-left:auto;transition:transform .25s}\n.trig[aria-expanded=\"true\"] .chev{transform:rotate(180deg)}\n.menu{overflow:hidden;max-height:0;opacity:0;transition:max-height .5s ease,opacity .25s,margin .25s}\n.menu.open{max-height:2600px;opacity:1;margin-top:12px}\n.menu ol{list-style:none;margin:0;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;background:var(--card);border:1px solid var(--line);border-radius:22px;backdrop-filter:blur(18px)}\n.menu li{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:14px;background:rgba(247,246,242,.025);border:1px solid transparent}\n.menu li.soon{border-color:rgba(var(--rgb),.18);background:rgba(var(--rgb),.05)}\n.menu li.today{border-color:rgba(143,220,180,.35);background:rgba(143,220,180,.07)}\n.dot{width:10px;height:36px;border-radius:99px;flex:none}\n.who{font-size:14px;font-weight:700;letter-spacing:-.01em}\n.meta{font-size:12px;color:var(--faint);font-weight:600;margin-top:3px}\n.tag{margin-left:auto;text-align:right;font-variant-numeric:tabular-nums}\n.tag b{display:block;font-size:17px;font-weight:800;letter-spacing:-.025em}\n.tag span{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--faint);margin-top:3px}\nli.locked .who,li.locked .tag b{color:var(--mute)}\nli.soon .tag span{color:var(--cream)}\nli.today .tag span,li.open .tag span{color:var(--mint)}\n.note{font-size:12px;color:var(--faint);line-height:1.6;padding:4px 6px;max-width:80ch}\n@media (prefers-reduced-motion:reduce){.menu,.chev,.trig{transition:none}.live b{animation:none}}\n.sec{display:flex;align-items:baseline;gap:16px;padding:28px 4px 0;border-top:1px solid var(--line);margin-top:12px}\n.sec .lab{margin:0}\n#moon2{position:absolute;right:-40px;top:-40px;width:520px;height:520px;pointer-events:none;opacity:.95}\n\n[hidden]{display:none!important}\nsection{display:flex;flex-direction:column;gap:16px}\n.empty{font-size:18px;font-weight:700}\n.pay-b.ref{cursor:pointer;border:0;font-family:var(--sans)}\n.seg{display:flex;gap:2px;padding:3px;border-radius:99px;background:rgba(247,246,242,.05);border:1px solid var(--line)}\n.seg button{font:700 11.5px var(--sans);padding:6px 12px;border-radius:99px;border:0;background:transparent;color:var(--mute);cursor:pointer}\n.seg button.on{background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413}\n.seg button:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n\n.duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 20px;align-items:stretch}\n.duo>*{min-width:0}\n.duo .hero{min-height:380px;container-type:inline-size}\n.duo .hero .big{font-size:clamp(56px,15.5cqi,128px)}\n.duo #moon,.duo #moon2{position:absolute;top:-95px;width:560px;height:560px;pointer-events:none;opacity:.95;transform:none}\n.a.hero #moon{right:-290px;left:auto}\n.p.hero #moon2{left:-290px;right:auto}\n.p.hero{text-align:right}\n.p.hero .legend{justify-content:flex-end}\n.p.hero.corner:before{left:auto;right:14px;border-left:0;border-right:1px solid var(--line2);border-top-left-radius:0;border-top-right-radius:8px}\n.lab .k{color:var(--cream);margin-right:10px}\n.duo .next{min-height:190px}.duo .next .when{font-size:56px}.duo .next .amt b{font-size:36px}\n.duo .stats{grid-template-columns:1fr 1fr}\n.duo .stat{padding:20px}.duo .stat b{font-size:clamp(20px,1.75vw,28px);margin-top:10px}\n@media (min-width:1280px){.duo .stats{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.duo .stat{padding:18px 16px}.duo .stat .lab{letter-spacing:.16em;font-size:10.5px}}\n.ledger{display:flex;flex-direction:column;min-height:0}\n.ledger .menu.open{margin-top:10px}\n.ledger .menu ol{max-height:452px;overflow:auto;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));scrollbar-width:thin;scrollbar-color:rgba(var(--rgb),.25) transparent;\n-webkit-mask-image:linear-gradient(180deg,#000 88%,transparent);mask-image:linear-gradient(180deg,#000 88%,transparent);padding-bottom:40px}\n.ledger .menu li{padding:11px 13px;gap:12px}\n.ledger .tag b{font-size:16px}\n.ledger .dot{height:32px;width:8px}\n@media (max-width:1060px){.duo{grid-template-columns:1fr}.duo .a{order:1}.duo .p{order:2}\n.p.hero{text-align:left}.p.hero .legend{justify-content:flex-start}.a.hero #moon,.p.hero #moon2{left:auto;right:-150px;top:-60px;width:360px;height:360px}\n.p.hero.corner:before{right:auto;left:14px;border-right:0;border-left:1px solid var(--line2);border-top-right-radius:0;border-top-left-radius:8px}}\n\n.tbtn{position:relative;width:42px;height:42px;border-radius:14px;border:1px solid var(--line2);cursor:pointer;padding:0;display:grid;place-items:center;overflow:hidden;\nbackground:radial-gradient(120% 90% at 50% 120%,rgba(var(--rgb),.22),transparent 60%),linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.01)),rgba(20,20,19,.6);backdrop-filter:blur(14px);\nbox-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 30px -12px rgba(0,0,0,.8);transition:border-color .25s,transform .25s}\n.tbtn svg{width:26px;height:auto;filter:drop-shadow(0 0 8px rgba(var(--rgb),.35));transition:transform .4s cubic-bezier(.2,.8,.2,1)}\n.tbtn:after{content:\"\";position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.18) 50%,transparent 65%);transform:translateX(-120%);transition:transform .7s}\n.tbtn:hover{border-color:rgba(var(--rgb),.55);transform:translateY(-1px)}.tbtn:hover:after{transform:translateX(120%)}\n.tbtn:active svg{transform:scale(.88)}\n.tbtn:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n\n.lock{display:flex;align-items:center;gap:14px}\n.lock .vm{position:relative;display:block;width:58px}\n.lock .vm svg{display:block;width:100%;height:auto;filter:drop-shadow(0 0 14px rgba(var(--rgb),.35))}\n.lock .vm:after{content:\"\";position:absolute;left:-30%;right:-30%;bottom:-7px;height:1px;background:linear-gradient(90deg,transparent,rgba(var(--rgb),.55),transparent)}\n.lock .vm:before{content:\"\";position:absolute;left:0;right:0;bottom:-16px;height:22px;background:radial-gradient(50% 60% at 50% 0,rgba(var(--rgb),.22),transparent);pointer-events:none}\n.lock .lx{font-size:15px;font-weight:600;color:var(--faint);transform:translateY(-1px)}\n\n.tbtn{width:36px;height:36px;border-radius:99px}\n.tbtn .sw{width:18px;height:18px;border-radius:99px;background:linear-gradient(145deg,#ffffff,#e6e6ea 45%,#9a9aa2);box-shadow:0 0 0 3px rgba(255,255,255,.06),0 0 14px rgba(226,226,232,.45);transition:transform .3s}\n:host([data-theme=\"mono\"]) .tbtn .sw{background:linear-gradient(145deg,#fff7df,#efe2bd 45%,#c9b27a);box-shadow:0 0 0 3px rgba(239,226,189,.08),0 0 14px rgba(239,226,189,.5)}\n.tbtn:hover .sw{transform:scale(1.12)}\n.x{width:34px;height:34px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.04);color:var(--mute);font:700 14px var(--sans);cursor:pointer;display:grid;place-items:center}.x:hover{border-color:var(--line2);color:var(--fg)}\n.rf{width:34px;height:34px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.04);color:var(--cream);cursor:pointer;display:grid;place-items:center;padding:0;transition:border-color .25s,transform .25s}.rf:hover{border-color:var(--line2);transform:translateY(-1px)}.rf.spin svg{animation:gpspin .9s linear infinite}.rf:disabled{cursor:default}@keyframes gpspin{to{transform:rotate(360deg)}}\n.lseg{display:inline-flex;gap:4px;padding:4px;margin:0 0 10px;border-radius:99px;border:1px solid var(--line);background:rgba(247,246,242,.03)}.lseg button{font:700 12px var(--sans);letter-spacing:.01em;color:var(--mute);background:none;border:0;padding:7px 14px;border-radius:99px;cursor:pointer}.lseg button.on{background:rgba(var(--rgb),.14);color:var(--fg)}.lseg[hidden]{display:none}\n";
  const BODY = "\n<canvas id=\"sky\"></canvas>\n<div class=\"wrap\">\n <div class=\"top\">\n  <div class=\"lock\" aria-label=\"Vest \u00d7 GIGAPROP\"><span class=\"vm\"><svg viewBox=\"-20 -30 589 400\" aria-hidden=\"true\"><path d=\"M130.463 1.64132L2.10114 104.296C0.259255 105.778 0.259255 108.571 2.10114 110.032L136.429 217.472V4.52427C136.429 1.43111 132.865 -0.260628 130.453 1.64132H130.463Z\" fill=\"url(#vg1)\"/><path d=\"M546.559 104.307L418.198 1.6418C415.785 -0.290179 412.222 1.43159 412.222 4.52475V217.483L546.559 110.043C548.401 108.561 548.401 105.768 546.559 104.307Z\" fill=\"url(#vg2)\"/><path d=\"M272.038 325.934L136.429 217.482V335.143C136.429 337.165 138.06 338.827 140.112 338.827H408.597C410.62 338.827 412.281 337.195 412.281 335.143V217.482L276.672 325.934C275.331 327.005 273.439 327.005 272.068 325.934H272.038Z\" fill=\"url(#vg3)\" stroke=\"var(--hi2)\" stroke-opacity=\".35\" stroke-width=\"6\"/></svg></span><span class=\"lx\">\u00d7</span><span class=\"brand\">GIGAPROP<i>.</i></span></div>\n  <div class=\"hdr-r\"><button class=\"tbtn\" id=\"theme\" aria-label=\"Switch theme\" title=\"Theme\"><i class=\"sw\"></i><svg width=\"0\" height=\"0\" style=\"position:absolute\" aria-hidden=\"true\"><defs>\n<linearGradient id=\"vg1\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi1)\" stop-opacity=\".95\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".45\"/></linearGradient>\n<linearGradient id=\"vg2\" x1=\"1\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi1)\" stop-opacity=\".85\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".2\"/></linearGradient>\n<linearGradient id=\"vg3\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"var(--hi2)\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"var(--hi3)\" stop-opacity=\".02\"/></linearGradient></defs></svg></button><div class=\"live\"><b></b><span id=\"snap\"></span></div><button class=\"rf\" id=\"refresh\" aria-label=\"Refresh\" title=\"Refresh\"><svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 11a8 8 0 1 0-2.3 5.7\"/><path d=\"M20 4v7h-7\"/></svg></button><a class=\"pay\" id=\"payLink\" href=\"/affiliates\"><span class=\"pay-l\">Available</span><span class=\"pay-v\" id=\"avail\">$0.00</span><span class=\"pay-b\">Request payout <svg width=\"12\" height=\"12\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M3.5 8.5l5-5M4.5 3.5h4v4\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></span></a><button class=\"x\" id=\"gpClose\" aria-label=\"Close\">\u2715</button></div>\n </div>\n\n <div class=\"duo\" id=\"duo\">\n  <div class=\"a card corner hero\">\n   <canvas id=\"moon\" class=\"mc\" width=\"1040\" height=\"1040\"></canvas>\n   <div class=\"lab\"><span class=\"k\">Affiliate</span>Lifetime earned</div>\n   <div class=\"big\" id=\"net\"></div>\n   <div class=\"of\" id=\"of\"></div>\n   <div class=\"track\" id=\"track\"></div>\n   <div class=\"legend\"><span><i style=\"background:var(--mint)\"></i>Paid out</span><span><i style=\"background:var(--cream)\"></i>Unlocked</span><span><i style=\"background:rgba(var(--rgb),.38)\"></i>Next 7 days</span><span><i style=\"background:rgba(247,246,242,.14)\"></i>On hold</span></div>\n  </div>\n  <div class=\"p card corner hero\">\n   <canvas id=\"moon2\" class=\"mc\" width=\"1040\" height=\"1040\"></canvas>\n   <div class=\"lab\"><span class=\"k\">Payouts</span>Total</div>\n   <div class=\"big\" id=\"pRecv\"></div>\n   <div class=\"of\" id=\"pOf\"></div>\n   <div class=\"track\" id=\"pTrack\"></div>\n   <div class=\"legend\"><span><i style=\"background:var(--mint)\"></i>Received</span><span><i style=\"background:var(--cream)\"></i>Processing</span></div>\n  </div>\n\n  <div class=\"a card next\">\n   <svg class=\"ring\" viewBox=\"0 0 76 76\" id=\"ring\"></svg>\n   <div class=\"lab\">Next unlock</div>\n   <div class=\"when\" id=\"nWhen\"></div>\n   <div class=\"amt\"><b id=\"nAmt\"></b><span id=\"nFrom\"></span></div>\n  </div>\n  <div class=\"p card next\">\n   <svg class=\"ring\" viewBox=\"0 0 76 76\" id=\"pring\"></svg>\n   <div class=\"lab\">Arriving</div>\n   <div class=\"when\" id=\"pWhen\"></div>\n   <div class=\"amt\"><b id=\"pAmt\"></b><span id=\"pCnt\"></span></div>\n  </div>\n\n  <div class=\"a stats\">\n   <div class=\"card stat hl\"><div class=\"lab\">Next 7 days</div><b id=\"s7\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">On hold</div><b id=\"sHeld\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Paid out</div><b id=\"sPaid\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Fully unlocked</div><b id=\"sEnd\"></b></div>\n  </div>\n  <div class=\"p stats\">\n   <div class=\"card stat hl\"><div class=\"lab\">Largest</div><b id=\"pMax\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\" id=\"pAvgL\">Average</div><b id=\"pAvg\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Payouts</div><b id=\"pN\"></b></div>\n   <div class=\"card stat\"><div class=\"lab\">Accounts paid</div><b id=\"pAcc\"></b></div>\n  </div>\n\n  <div class=\"a ledger\">\n   <button class=\"trig\" id=\"trig\" aria-expanded=\"true\" aria-controls=\"menu\"><span class=\"stack\" id=\"stack\"></span><span id=\"trigTxt\"></span><svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>\n   <div class=\"menu open\" id=\"menu\"><ol id=\"list\"></ol></div>\n  </div>\n  <div class=\"p ledger\">\n   <button class=\"trig\" id=\"ptrig\" aria-expanded=\"true\" aria-controls=\"pmenu\"><span class=\"stack\" id=\"pstack\"></span><span id=\"ptrigTxt\"></span><svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>\n   <div class=\"menu open\" id=\"pmenu\"><div class=\"lseg\" id=\"pseg\"><button data-v=\"pay\" class=\"on\">Payouts</button><button data-v=\"wd\">Withdrawals</button></div><ol id=\"plist\"></ol></div>\n  </div>\n </div>\n <div class=\"card empty\" id=\"empty\" hidden>Open Vest Affiliates or Portfolio and press the GP. button.</div>\n\n</div>\n<div class=\"tip\" id=\"tip\"></div>\n\n\n";
  function fonts() {
    if (document.getElementById('gp-font')) return;
    const l = document.createElement('link'); l.id = 'gp-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap';
    (document.head || document.documentElement).appendChild(l);
  }
  function closeDash() { const h = document.getElementById('gp-dash'); if (h) h.remove(); document.documentElement.style.overflow = ''; }
  function openDash(startView) {
    closeDash(); fonts();
    const HOST = document.createElement('div'); HOST.id = 'gp-dash';
    const ROOT = HOST.attachShadow({ mode: 'open' });
    ROOT.innerHTML = '<style>' + CSS + '</style><div class="root">' + BODY + '</div>';
    document.documentElement.appendChild(HOST);
    document.documentElement.style.overflow = 'hidden';
    ROOT.getElementById('gpClose').onclick = closeDash;
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
    const w = c.width = innerWidth * devicePixelRatio, hh = c.height = innerHeight * devicePixelRatio; x.clearRect(0, 0, w, hh);
    const g = x.createRadialGradient(w * .15, hh * .05, 0, w * .15, hh * .05, w * .7); g.addColorStop(0, `rgba(${C},.06)`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, hh);
    const s = 12 * devicePixelRatio; x.fillStyle = `rgba(${C},.045)`; for (let yy = 0; yy < hh; yy += s) for (let xx = 0; xx < w; xx += s) { x.beginPath(); x.arc(xx, yy, 1.1 * devicePixelRatio, 0, 6.283); x.fill(); }
    for (let k = 0; k < 120; k++) { x.fillStyle = `rgba(247,246,242,${.08 + h(k, 9) * .35})`; x.beginPath(); x.arc(h(k, 7) * w, h(k, 8) * hh, (.5 + h(k, 6) * 1.1) * devicePixelRatio, 0, 6.283); x.fill(); }
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
    host.style.cssText = 'position:fixed;right:20px;bottom:56px;z-index:2147483646';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      button{display:flex;align-items:center;gap:10px;font:800 13px "Manrope",system-ui,sans-serif;letter-spacing:-.01em;padding:7px 8px 7px 16px;border-radius:99px;cursor:pointer;color:#f7f6f2;
        background:linear-gradient(150deg,rgba(239,226,189,.16),rgba(239,226,189,.03)),rgba(20,20,19,.88);border:1px solid rgba(239,226,189,.3);backdrop-filter:blur(14px);box-shadow:0 18px 40px -14px rgba(0,0,0,.8)}
      button:hover{border-color:rgba(239,226,189,.6)}
      i{font-style:normal;color:#efe2bd}
      span{padding:7px 13px;border-radius:99px;background:linear-gradient(180deg,#f6ecd0,#d9c48c);color:#141413}
    </style><button id="b"><b>GP<i>.</i></b><span id="t">Dashboard</span></button>`;
    root.getElementById('b').onclick = async () => {
      const t = root.getElementById('t'); t.textContent = 'Loading…';
      const path = location.pathname, aff = path.startsWith('/affiliates'), pay = path.startsWith('/portfolio');
      if (aff) { clickText('1Y'); await sleep(3000); }
      else if (pay) await pull('/portfolio', [{ click: 'Payouts', ms: 1500 }, { click: 'Export CSV', silent: 1, wait: 'payoutsAt', ms: 6000 }, { click: 'Withdrawals', ms: 1500 }, { click: 'Export CSV', silent: 1, wait: 'withdrawalsAt', ms: 6000 }]);
      t.textContent = 'Dashboard';
      openDash(pay ? 'pay' : 'aff');
    };
    document.body.appendChild(host);
  }
  setInterval(gpButton, 1200);
})();
