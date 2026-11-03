// ==UserScript==
// @name         GP. Dashboard for Vest
// @namespace    https://github.com/deciphe/gp-vest
// @version      1.0.1
// @description  Your Vest affiliate earnings, unlock dates and payouts on one clean page. Data stays in your browser.
// @author       GP.
// @match        https://next.vestmarkets.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/deciphe/gp-vest/main/gp-vest.user.js
// @downloadURL  https://raw.githubusercontent.com/deciphe/gp-vest/main/gp-vest.user.js
// ==/UserScript==

(function () {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ---------- local storage (Tampermonkey) ----------
  const KEYS = ['analytics', 'payouts', 'payoutsAt', 'theme'];
  const store = {
    get: k => GM_getValue(k, null),
    set: (k, v) => { GM_setValue(k, v); document.dispatchEvent(new Event('gp-update')); },
    all: () => Object.fromEntries(KEYS.map(k => [k, GM_getValue(k, null)]))
  };

  // ---------- read the data Vest's own pages load ----------
  // Copies JSON responses only. Never reads request headers, tokens or passwords.
  const WANT = /api-gateway[^/]*\/v\d+\/(affiliate|capital|payout|withdraw|history|accounts|user-state)/i;
  const isPayout = x => x && typeof x === 'object' && ('trader_amount' in x || 'requested_amount' in x);
  function handle(url, b) {
    const now = Date.now();
    if (b && b.totals && Array.isArray(b.daily) && 'due_cents' in b.totals) {
      const cur = store.get('analytics');
      if (!cur || b.daily.length >= (cur.daily || []).length || now - (cur.at || 0) > 6e5) store.set('analytics', Object.assign({}, b, { at: now }));
      return;
    }
    let arr = null;
    if (Array.isArray(b) && b.some(isPayout)) arr = b;
    else if (b && typeof b === 'object') for (const k in b) if (Array.isArray(b[k]) && b[k].some(isPayout)) { arr = b[k]; break; }
    if (arr) {
      const cur = store.get('payouts') || {};
      arr.filter(isPayout).forEach(x => { if (x.id) cur[x.id] = x; });
      store.set('payouts', cur); store.set('payoutsAt', now);
    }
  }
  const take = (url, text) => { if (!WANT.test(url) || !text || text.length > 3e6) return; try { handle(url, JSON.parse(text)); } catch (e) {} };
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
  const CSS = "\n:host{--rgb:239,226,189;--hi1:#fff7df;--hi2:#efe2bd;--hi3:#c9b27a;--btn1:#f6ecd0;--btn2:#d9c48c;--bg:#0f0f0e;--card:rgba(28,28,26,.72);--card2:#232321;--line:rgba(247,246,242,.09);--line2:rgba(var(--rgb),.22);--fg:#f7f6f2;--mute:rgba(247,246,242,.6);--faint:rgba(247,246,242,.36);\n--cream:#efe2bd;--gold:#d9c48c;--mint:#8fdcb4;--sans:\"Manrope\",system-ui,-apple-system,\"Segoe UI\",sans-serif;color-scheme:dark}\n:host([data-theme=\"mono\"]){--rgb:226,226,232;--hi1:#ffffff;--hi2:#e6e6ea;--hi3:#9a9aa2;--btn1:#f2f2f4;--btn2:#a9a9b0;--bg:#0e0e10;--card:rgba(24,24,27,.8);--line:rgba(255,255,255,.08);--cream:#ececf0;--gold:#c9c9cf;--mint:#b4e6cc}\n*{box-sizing:border-box}\n\n.root{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--bg);color:var(--fg);font-family:var(--sans);-webkit-font-smoothing:antialiased;padding:40px 16px 64px}\n#sky{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}\n.wrap{position:relative;z-index:1;max-width:1440px;margin:0 auto;display:flex;flex-direction:column;gap:16px}\n.top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:0 4px 8px}\n.brand{font-size:20px;font-weight:800;letter-spacing:-.04em}.brand i{font-style:normal;color:var(--cream)}\n.brand span{margin-left:14px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.live{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:600;color:var(--mute)}\n.hdr-r{display:flex;align-items:center;gap:18px;flex-wrap:wrap}\n.pay{display:flex;align-items:center;gap:12px;padding:6px 6px 6px 18px;border-radius:99px;border:1px solid var(--line2);background:linear-gradient(150deg,rgba(var(--rgb),.12),rgba(var(--rgb),.02));text-decoration:none;color:var(--fg);backdrop-filter:blur(14px);transition:border-color .2s,transform .2s}\n.pay:hover{border-color:rgba(var(--rgb),.5);transform:translateY(-1px)}\n.pay:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n.pay-l{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.pay-v{font-size:17px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}\n.pay-b{display:flex;align-items:center;gap:6px;padding:9px 16px;border-radius:99px;background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413;font-size:13px;font-weight:800;letter-spacing:-.01em}\n.live b{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 5px rgba(143,220,180,.14),0 0 14px var(--mint);animation:pulse 2.4s ease-in-out infinite}\n@keyframes pulse{50%{box-shadow:0 0 0 8px rgba(143,220,180,.04),0 0 18px var(--mint)}}\n.card{position:relative;background:var(--card);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--line);border-radius:26px;padding:28px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 30px 80px -40px rgba(0,0,0,.8)}\n.corner:before{content:\"\";position:absolute;left:14px;top:14px;width:64px;height:64px;border-left:1px solid var(--line2);border-top:1px solid var(--line2);border-top-left-radius:8px;pointer-events:none}\n.lab{font-size:11px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.row1{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px}\n@media (max-width:980px){.row1{grid-template-columns:1fr}}\n.hero{min-height:420px;display:flex;flex-direction:column;overflow:hidden}\n#moon{position:absolute;right:-40px;top:-40px;width:520px;height:520px;pointer-events:none;opacity:.95}\n.hero .big{margin-top:auto;font-size:clamp(64px,10vw,150px);font-weight:800;letter-spacing:-.065em;line-height:.86;font-variant-numeric:tabular-nums;\nbackground:linear-gradient(180deg,var(--hi1) 0%,var(--hi2) 55%,var(--hi3) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 40px rgba(var(--rgb),.18))}\n.hero .big small{font-size:.38em;letter-spacing:-.03em}\n.hero .of{margin-top:14px;font-size:16px;font-weight:600;color:var(--mute)}\n.hero .of b{color:var(--fg);font-weight:800}\n.track{margin-top:26px;position:relative;height:14px;border-radius:99px;background:rgba(247,246,242,.07);overflow:hidden}\n.track span{position:absolute;top:0;bottom:0;border-radius:99px}\n.legend{margin-top:12px;display:flex;gap:18px;flex-wrap:wrap;font-size:12px;font-weight:600;color:var(--mute)}\n.legend i{display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:7px;vertical-align:1px}\n.side{display:grid;grid-template-rows:auto 1fr;gap:16px}\n.next{overflow:hidden;background:linear-gradient(150deg,rgba(var(--rgb),.13),rgba(var(--rgb),.02) 55%),var(--card);border-color:var(--line2)}\n.next .when{margin-top:14px;font-size:64px;font-weight:800;letter-spacing:-.06em;line-height:.9}\n.next .amt{margin-top:18px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}\n.next .amt b{font-size:40px;font-weight:800;letter-spacing:-.045em;color:var(--cream);font-variant-numeric:tabular-nums}\n.next .amt span{font-size:13px;font-weight:600;color:var(--mute)}\n.ring{position:absolute;right:24px;top:24px;width:76px;height:76px}\n.stats{display:grid;grid-template-columns:1fr 1fr;gap:16px}\n.stat{padding:22px}\n.stat b{display:block;margin-top:12px;font-size:30px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums}\n.stat span{display:block;margin-top:6px;font-size:12px;font-weight:600;color:var(--faint)}\n.stat.hl b{color:var(--cream)}\n.cal-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}\n.cal-head h2{margin:8px 0 0;font-size:30px;font-weight:800;letter-spacing:-.04em}\n.cal-head p{margin:6px 0 0;font-size:14px;font-weight:600;color:var(--mute)}\n.keys{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;font-weight:600;color:var(--mute)}\n.keys i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;vertical-align:-1px}\n.wk{font-size:13px;font-weight:600;color:var(--mute)}.wk b{color:var(--cream);font-weight:800}\n.dow,.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}\n.dow{margin-top:20px}.dow span{padding-left:4px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:var(--faint)}\n.cal{margin-top:10px}\n.cell{position:relative;min-height:108px;border-radius:18px;padding:14px 16px;background:rgba(247,246,242,.025);border:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden}\n.cell.pad{background:transparent;border-color:transparent}\n.cell .d{font-size:12px;font-weight:700;color:var(--faint)}\n.cell .v{margin-top:auto;font-size:clamp(15px,1.7vw,26px);font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums;position:relative;z-index:1}\n.cell .fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(var(--rgb),.0),rgba(var(--rgb),.22));}\n.cell.zero .v{color:rgba(247,246,242,.18)}\n.cell.today{border-color:rgba(143,220,180,.5);box-shadow:0 0 0 1px rgba(143,220,180,.25),0 0 30px -8px rgba(143,220,180,.5)}\n.cell.today .d{color:var(--mint)}\n.cell.today .fill{background:linear-gradient(180deg,rgba(143,220,180,0),rgba(143,220,180,.22))}\n.cell.peak{border-color:rgba(var(--rgb),.4)}\n.cell.peak .v{color:var(--cream);text-shadow:0 0 24px rgba(var(--rgb),.35)}\n.cell.past{opacity:.35}\n@media (max-width:760px){.dow,.cal{gap:5px}.cell{min-height:70px;padding:8px;border-radius:12px}.dow span{letter-spacing:.05em}}\n#chart{display:block;width:100%;min-width:760px;height:auto}\nsvg text{font-family:var(--sans)}\n.tip{position:fixed;z-index:5;pointer-events:none;padding:10px 12px;border-radius:12px;background:#1f1f1d;border:1px solid var(--line2);font-size:12px;font-weight:600;color:var(--mute);opacity:0;transition:opacity .12s;box-shadow:0 14px 40px rgba(0,0,0,.5)}\n.tip b{display:block;font-size:18px;font-weight:800;color:var(--cream);letter-spacing:-.03em}\n.trig{width:100%;display:flex;align-items:center;gap:14px;padding:18px 22px;border-radius:20px;border:1px solid var(--line);background:var(--card);backdrop-filter:blur(18px);color:var(--mute);font:600 15px var(--sans);cursor:pointer;text-align:left;transition:border-color .2s,background .2s,color .2s}\n.trig:hover,.trig[aria-expanded=\"true\"]{border-color:var(--line2);background:rgba(var(--rgb),.05);color:var(--fg)}\n.trig:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n.trig b{color:var(--cream)}\n.stack{display:flex}.stack i{width:14px;height:14px;border-radius:5px;border:2px solid #1c1c1a;margin-left:-4px}.stack i:first-child{margin-left:0}\n.chev{margin-left:auto;transition:transform .25s}\n.trig[aria-expanded=\"true\"] .chev{transform:rotate(180deg)}\n.menu{overflow:hidden;max-height:0;opacity:0;transition:max-height .5s ease,opacity .25s,margin .25s}\n.menu.open{max-height:2600px;opacity:1;margin-top:12px}\n.menu ol{list-style:none;margin:0;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;background:var(--card);border:1px solid var(--line);border-radius:22px;backdrop-filter:blur(18px)}\n.menu li{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:14px;background:rgba(247,246,242,.025);border:1px solid transparent}\n.menu li.soon{border-color:rgba(var(--rgb),.18);background:rgba(var(--rgb),.05)}\n.menu li.today{border-color:rgba(143,220,180,.35);background:rgba(143,220,180,.07)}\n.dot{width:10px;height:36px;border-radius:99px;flex:none}\n.who{font-size:14px;font-weight:700;letter-spacing:-.01em}\n.meta{font-size:12px;color:var(--faint);font-weight:600;margin-top:3px}\n.tag{margin-left:auto;text-align:right;font-variant-numeric:tabular-nums}\n.tag b{display:block;font-size:17px;font-weight:800;letter-spacing:-.025em}\n.tag span{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--faint);margin-top:3px}\nli.locked .who,li.locked .tag b{color:var(--mute)}\nli.soon .tag span{color:var(--cream)}\nli.today .tag span,li.open .tag span{color:var(--mint)}\n.note{font-size:12px;color:var(--faint);line-height:1.6;padding:4px 6px;max-width:80ch}\n@media (prefers-reduced-motion:reduce){.menu,.chev,.trig{transition:none}.live b{animation:none}}\n.sec{display:flex;align-items:baseline;gap:16px;padding:28px 4px 0;border-top:1px solid var(--line);margin-top:12px}\n.sec .lab{margin:0}\n#moon2{position:absolute;right:-40px;top:-40px;width:520px;height:520px;pointer-events:none;opacity:.95}\n\n[hidden]{display:none!important}\nsection{display:flex;flex-direction:column;gap:16px}\n.empty{font-size:18px;font-weight:700}\n.pay-b.ref{cursor:pointer;border:0;font-family:var(--sans)}\n.seg{display:flex;gap:2px;padding:3px;border-radius:99px;background:rgba(247,246,242,.05);border:1px solid var(--line)}\n.seg button{font:700 11.5px var(--sans);padding:6px 12px;border-radius:99px;border:0;background:transparent;color:var(--mute);cursor:pointer}\n.seg button.on{background:linear-gradient(180deg,var(--btn1),var(--btn2));color:#141413}\n.seg button:focus-visible{outline:2px solid var(--cream);outline-offset:2px}\n\n.x{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:rgba(247,246,242,.04);color:var(--mute);font:700 16px var(--sans);cursor:pointer}.x:hover{color:var(--fg);border-color:var(--line2)}\n";
  const BODY = "<canvas id=\"sky\"></canvas>\n<div class=\"wrap\">\n <div class=\"top\">\n  <div class=\"brand\">GIGAPROP<i>.</i><span>Vest</span></div>\n  <div class=\"hdr-r\"><div class=\"seg\" id=\"view\"><button data-v=\"aff\" class=\"on\">Affiliate</button><button data-v=\"pay\">Payouts</button></div><div class=\"seg\" id=\"theme\"><button data-v=\"cream\" class=\"on\">Cream</button><button data-v=\"mono\">Mono</button></div><div class=\"live\"><b></b><span id=\"snap\"></span></div><a class=\"pay\" href=\"/affiliates\" id=\"payLink\"><span class=\"pay-l\">Available</span><span class=\"pay-v\" id=\"avail\">$0.00</span><span class=\"pay-b\">Request payout <svg width=\"12\" height=\"12\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M3.5 8.5l5-5M4.5 3.5h4v4\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></span></a><button class=\"x\" id=\"gpClose\" aria-label=\"Close\">\u2715</button></div>\n </div>\n\n <section id=\"affSec\">\n <div class=\"row1\">\n  <div class=\"card corner hero\">\n   <canvas id=\"moon\" width=\"1040\" height=\"1040\"></canvas>\n   <div class=\"lab\">Lifetime earned</div>\n   <div class=\"big\" id=\"net\"></div>\n   <div class=\"of\" id=\"of\"></div>\n   <div class=\"track\" id=\"track\"></div>\n   <div class=\"legend\"><span><i style=\"background:var(--mint)\"></i>Paid out</span><span><i style=\"background:var(--cream)\"></i>Unlocked</span><span><i style=\"background:rgba(var(--rgb),.38)\"></i>Unlocks in 7 days</span><span><i style=\"background:rgba(247,246,242,.14)\"></i>Still on hold</span></div>\n  </div>\n  <div class=\"side\">\n   <div class=\"card next\">\n    <svg class=\"ring\" viewBox=\"0 0 76 76\" id=\"ring\"></svg>\n    <div class=\"lab\">Next unlock</div>\n    <div class=\"when\" id=\"nWhen\"></div>\n    <div class=\"amt\"><b id=\"nAmt\"></b><span id=\"nFrom\"></span></div>\n   </div>\n   <div class=\"stats\">\n    <div class=\"card stat hl\"><div class=\"lab\">Next 7 days</div><b id=\"s7\"></b></div>\n    <div class=\"card stat\"><div class=\"lab\">On hold</div><b id=\"sHeld\"></b></div>\n    <div class=\"card stat\"><div class=\"lab\">Paid out</div><b id=\"sPaid\"></b></div>\n    <div class=\"card stat\"><div class=\"lab\">Fully unlocked by</div><b id=\"sEnd\"></b></div>\n   </div>\n  </div>\n </div>\n\n\n <div>\n  <button class=\"trig\" id=\"trig\" aria-expanded=\"true\" aria-controls=\"menu\">\n   <span class=\"stack\" id=\"stack\"></span><span id=\"trigTxt\"></span>\n   <svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>\n  </button>\n  <div class=\"menu open\" id=\"menu\"><ol id=\"list\"></ol></div>\n </div>\n </section>\n\n <section id=\"paySec\">\n \n <div class=\"row1\">\n  <div class=\"card corner hero\">\n   <canvas id=\"moon2\" class=\"moonc\" width=\"1040\" height=\"1040\"></canvas>\n   <div class=\"lab\">Received</div>\n   <div class=\"big\" id=\"pRecv\"></div>\n   <div class=\"of\" id=\"pOf\"></div>\n   <div class=\"track\" id=\"pTrack\"></div>\n   <div class=\"legend\"><span><i style=\"background:var(--mint)\"></i>Received</span><span><i style=\"background:var(--cream)\"></i>Processing</span></div>\n  </div>\n  <div class=\"side\">\n   <div class=\"card next\">\n    <div class=\"lab\">Arriving</div>\n    <div class=\"when\" id=\"pWhen\"></div>\n    <div class=\"amt\"><b id=\"pAmt\"></b><span id=\"pCnt\"></span></div>\n   </div>\n   <div class=\"stats\">\n        <div class=\"card stat\"><div class=\"lab\">Payouts</div><b id=\"pN\"></b></div>\n    <div class=\"card stat\"><div class=\"lab\">Accounts paid</div><b id=\"pAcc\"></b></div>\n   </div>\n  </div>\n </div>\n <div>\n  <button class=\"trig\" id=\"ptrig\" aria-expanded=\"true\" aria-controls=\"pmenu\">\n   <span class=\"stack\" id=\"pstack\"></span><span id=\"ptrigTxt\"></span>\n   <svg class=\"chev\" width=\"14\" height=\"14\" viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M2.5 4.5 6 8l3.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>\n  </button>\n  <div class=\"menu open\" id=\"pmenu\"><ol id=\"plist\"></ol></div>\n </div>\n </section>\n <div class=\"card empty\" id=\"empty\" hidden>Open Vest Affiliates or Portfolio and press the GP. button.</div>\n\n</div>\n<div class=\"tip\" id=\"tip\"></div>\n\n\n";
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
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDash(); });

  function mountDash(ROOT, HOST, store, startView) {
const $ = id => ROOT.getElementById(id);

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

let VIEW = startView || 'aff';
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
  $('list').innerHTML = rows.map(r => {
    const st = r.days < 0 ? 'open' : r.days === 0 ? 'today' : r.days <= 7 ? 'soon' : 'locked';
    const col = st === 'open' || st === 'today' ? 'var(--mint)' : st === 'soon' ? 'linear-gradient(var(--hi1),var(--hi3))' : 'rgba(247,246,242,.16)';
    const lab = st === 'open' ? 'Unlocked' : r.days === 0 ? 'Today' : r.days === 1 ? 'Tomorrow' : `In ${r.days} days`;
    return `<li class="${st}"><span class="dot" style="background:${col}"></span><div><div class="who">${fmt(r.unlock)}</div></div><div class="tag"><b>${usd(r.cents, 1)}</b><span>${lab}</span></div></li>`;
  }).join('');
}

function renderPay(map) {
  const P = Object.values(map).map(p => ({ acct: (p.account_id || '').slice(0, 4), amt: num(p.trader_amount) * 100, status: String(p.status || '').toLowerCase(), created: new Date(p.created_at), executed: p.executed_at ? new Date(p.executed_at) : null }))
    .filter(p => !isNaN(p.created)).sort((a, b) => b.created - a.created);
  const isRecv = p => /executed|completed|paid/.test(p.status), isFail = p => /fail|reject|cancel/.test(p.status);
  const recv = P.filter(isRecv), proc = P.filter(p => !isRecv(p) && !isFail(p));
  const sR = recv.reduce((s, p) => s + p.amt, 0), sP = proc.reduce((s, p) => s + p.amt, 0);
  $('pRecv').innerHTML = big(sR);
  $('pOf').innerHTML = `<b>${usd(sR, 1)}</b> received · <b>${usd(sP, 1)}</b> processing`;
  const tot = sR + sP || 1;
  $('pTrack').innerHTML = `<span style="left:0;width:${sR / tot * 100}%;background:var(--mint)"></span><span style="left:${sR / tot * 100}%;width:${sP / tot * 100}%;background:var(--cream)"></span>`;
  const lastEta = proc.length ? Math.max(...proc.map(p => p.created.getTime() + 864e5)) : 0, hrs = Math.max(0, Math.round((lastEta - Date.now()) / 36e5));
  $('pWhen').textContent = proc.length ? (hrs <= 0 ? 'Now' : hrs < 24 ? `Within ${hrs}h` : 'Tomorrow') : 'Nothing pending';
  $('pAmt').textContent = proc.length ? usd(sP, 1) : ''; $('pCnt').textContent = proc.length ? `${proc.length} payouts` : '';
  $('pN').textContent = P.length; $('pAcc').textContent = new Set(P.map(p => p.acct)).size;
  $('pstack').innerHTML = P.slice(0, 4).map(p => `<i style="background:${isRecv(p) ? 'var(--mint)' : 'var(--cream)'}"></i>`).join('');
  $('ptrigTxt').innerHTML = `<b>${P.length}</b> payouts · ${usd(sR + sP, 1)}`;
  $('plist').innerHTML = P.map(p => {
    const ok = isRecv(p), bad = isFail(p);
    return `<li class="${ok ? 'open' : bad ? 'locked' : 'soon'}"><span class="dot" style="background:${ok ? 'var(--mint)' : bad ? 'rgba(217,163,163,.6)' : 'linear-gradient(var(--hi1),var(--hi3))'}"></span><div><div class="who">${fmtT(ok && p.executed ? p.executed : p.created)}</div></div><div class="tag"><b>${usd(p.amt, 1)}</b><span>${ok ? 'Received' : bad ? 'Failed' : 'Processing'}</span></div></li>`;
  }).join('');
}

async function render() {
  const S = await load();
  const hasA = !!(S.analytics && S.analytics.totals), hasP = !!(S.payouts && Object.keys(S.payouts).length);
  const v = VIEW;
  [...$('view').children].forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('affSec').hidden = v !== 'aff' || !hasA; $('paySec').hidden = v !== 'pay' || !hasP;
  $('empty').hidden = v === 'aff' ? hasA : hasP;
  $('empty').textContent = v === 'aff' ? 'Open Vest Affiliates and press the GP. Dashboard button.' : 'Open Vest Portfolio and press the GP. Dashboard button.';
  const at = Math.max(S.analytics ? S.analytics.at || 0 : 0, S.payoutsAt || 0);
  $('snap').textContent = at ? 'Updated ' + fmtT(new Date(at)) : '';
  ROOT.querySelector('.pay').hidden = !hasA;
  if (hasA) renderAff(S.analytics);
  if (hasP) renderPay(S.payouts);
}

toggle($('trig'), $('menu')); toggle($('ptrig'), $('pmenu'));


// stippled moon + starfield
function h(a, b) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }
function vn(a, b) { const i = Math.floor(a), j = Math.floor(b), f = a - i, k = b - j, u = f * f * (3 - 2 * f), v = k * k * (3 - 2 * k); return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v; }
function drawMoon() {
  const c = $('moon'), x = c.getContext('2d'); x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, 520, 520); const C = RGB(); const CX = 300, CY = 220, R = 200, g = 6.5;
  const gr = x.createRadialGradient(CX, CY, R * .5, CX, CY, R * 1.5); gr.addColorStop(0, `rgba(${C},.10)`); gr.addColorStop(1, `rgba(${C},0)`); x.fillStyle = gr; x.fillRect(0, 0, 520, 520);
  const cr = []; for (let k = 0; k < 12; k++) { const a = h(k, 3) * 6.283, rr = Math.sqrt(h(k, 4)) * R * .85; cr.push([CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, R * (k < 3 ? .14 + h(k, 5) * .05 : .04 + h(k, 5) * .05)]); }
  for (let j = 0; j < 520 / (g * .866); j++) for (let i = 0; i < 520 / g + 1; i++) {
    const px = i * g + (j % 2 ? g / 2 : 0), py = j * g * .866, dx = (px - CX) / R, dy = (py - CY) / R, d2 = dx * dx + dy * dy; if (d2 >= 1) continue;
    const dz = Math.sqrt(1 - d2); let l = Math.max(0, dx * -.55 + dy * -.4 + dz * .73); l *= 1 - .28 * Math.min(1, Math.max(0, (vn(px / 70 + 2, py / 70) - .55) / .17));
    for (const [ax, ay, ar] of cr) { const ox = (px - ax) / ar, oy = (py - ay) / ar, d = Math.hypot(ox, oy); if (d > 1.2) continue; const w = Math.exp(-Math.pow((d - .85) / .18, 2)); l += .45 * w * (ox * -.55 + oy * -.4) / Math.max(d, .2); if (d < .75) l *= .75; }
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
  draw(); window.addEventListener('resize', draw);
})();
function setTheme(v) {
  HOST.dataset.theme = v;
  [...$('theme').children].forEach(b => b.classList.toggle('on', b.dataset.v === v));
  drawMoon(); drawSky(); render();
}
$('view').onclick = e => { const b = e.target.closest('button'); if (!b) return; VIEW = b.dataset.v; render(); };
$('theme').onclick = e => { const b = e.target.closest('button'); if (!b) return; setTheme(b.dataset.v); store.set('theme', b.dataset.v); };
setTheme(store.get('theme') || 'cream');

document.addEventListener('gp-update', () => { if (HOST.isConnected) render(); });

  }

  // ---------- GP. button on Affiliates and Portfolio ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clickText = t => { const b = [...document.querySelectorAll('button,[role=tab]')].find(x => x.textContent.trim() === t); if (b) b.click(); return !!b; };
  function gpButton() {
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
      if (aff || pay) { clickText(aff ? '1Y' : 'Payouts'); await sleep(3000); }
      t.textContent = 'Dashboard';
      openDash(pay ? 'pay' : 'aff');
    };
    document.body.appendChild(host);
  }
  setInterval(gpButton, 1200);
})();
