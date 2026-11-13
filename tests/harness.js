// Loads the userscript on a stand-in Vest page with sample data, opens the dashboard and the profile,
// then runs the same layout audit on each at every screen size.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const US = fs.readFileSync(path.join(__dirname, '..', 'gp-vest.user.js'), 'utf8');
const day = 864e5, now = Date.now();
const iso = t => new Date(t).toISOString().slice(0, 10);
const daily = Array.from({ length: 40 }, (_, i) => ({ date: iso(now - (39 - i) * day), due_cents: i > 8 ? 5000 + i * 300 : 0, pending_cents: 0, paid_cents: i <= 8 ? 4000 : 0, reversed_cents: 0, net_cents: 5000 }));
const accounts = [], trades = [], payouts = [];
for (let i = 0; i < 24; i++) {
  const root = 'r' + i, funded = i % 3 === 0;
  accounts.push({ id: root, root, kind: i > 20 ? 'Instant' : 'Eval', status: funded ? 'Passed' : i % 2 ? 'Hit MLL' : 'Hit DLL', size: i > 20 ? 500 : 5000, plan: i > 20 ? 'Instant Funded' : i % 2 ? '2-Step Silver' : '1-Step 5% 3% DLL Silver', step: 1, steps: 1, created: now - (30 - i) * day, mll: .06, dll: .03, target: 250, split: .8, origin: 'eval_purchase', cost: i % 2 ? 14 : 61.75, balance: 0 });
  if (funded) { accounts.push({ id: 'f' + i, root, kind: 'Funded', status: i % 2 ? 'Active' : 'Hit DLL', size: 5000, plan: accounts[accounts.length - 1].plan, step: 2, steps: 1, created: now - (28 - i) * day, mll: .06, dll: .03, target: 250, split: .8, origin: 'eval_promotion', cost: 0, balance: 5000 });
    payouts.push({ id: 'p' + i, acct: 'f' + i, amt: 80 + i * 9, status: 'executed', at: now - (20 - i) * day }); }
  for (let k = 0; k < 6; k++) { const t0 = now - (29 - i) * day + k * 36e5, w = (i + k) % 3 !== 0; trades.push({ id: 't' + i + k, acct: funded ? 'f' + i : root, sym: ['NDX', 'BTC', 'GC'][k % 3], side: k % 2 ? 'long' : 'short', qty: 1.2345, open: 27000.5, close: 27010.25, t0, t1: t0 + 9e5, pnl: w ? 120 : -95, fee: 6.3, fund: 0, lev: 50, reason: ['take_profit', 'stop_loss', 'user_requested', 'liquidation'][k % 4] }); }
}
const S = { analytics: { from: '2025-01-01', at: now, totals: { due_cents: 300000, held_cents: 280000, paid_cents: 36000, net_cents: 336000 }, daily },
  payouts: Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['x' + i, { id: 'x' + i, account_id: 'acc' + (i % 4), trader_amount: 60 + i * 7, status: i < 2 ? 'processing' : 'executed', created_at: new Date(now - i * day).toISOString(), executed_at: i < 2 ? null : new Date(now - i * day + 864e5).toISOString() }])),
  payoutsAt: now, withdrawals: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['w' + i, { id: 'w' + i, amount: 100 + i * 40, network: 'Arbitrum', status: i < 2 ? 'processing' : 'completed', created_at: new Date(now - i * day).toISOString() }])), withdrawalsAt: now,
  profile: { at: now, accounts, trades, payouts } };
const VPS = [[320, 700], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080]];
const audit = fs.readFileSync(path.join(__dirname, 'audit-fn.js'), 'utf8');
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const view of ['gate', 'dashboard', 'profile']) for (const [w, h] of VPS) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); const errs = []; const r0 = [];
    p.on('pageerror', e => errs.push(e.message));
    await ctx.route('https://next.vestmarkets.com/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#111"></body></html>' }));
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.addInitScript(`window.__s=${JSON.stringify(S)};window.GM_getValue=(k,d)=>k in window.__s?window.__s[k]:d;window.GM_setValue=(k,v)=>{window.__s[k]=v};window.unsafeWindow=window;` + US);
    await p.goto('https://next.vestmarkets.com/trade'); await p.waitForTimeout(1500);
    await p.click('#gp-dock >> button'); await p.waitForTimeout(500);
    if (!(await p.$('#gp-gate'))) r0.push('gate did not open');
    if (view !== 'gate') { await p.click('#gp-gate >> [data-go=' + (view === 'profile' ? 'prof' : 'earn') + ']'); await p.waitForTimeout(1200); }
    if (!(await p.$({ gate: '#gp-gate', profile: '#gp-prof', dashboard: '#gp-dash' }[view]))) r0.push(view + ' did not open');
    const r = r0.concat(await p.evaluate(audit + '()')).filter(x => !/tiny text 9.5px: span/.test(x)); if (errs.length) r.push('JS errors: ' + errs.join(' | '));
    if (r.length) { bad++; console.log(`\n${view} @ ${w}x${h}\n  - ` + r.join('\n  - ')); }
    await ctx.close();
  }
  console.log(bad ? `\n${bad} views with issues` : 'Userscript views clean'); await b.close(); process.exit(bad ? 1 : 0);
})();
