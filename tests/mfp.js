// MyFundedPerps flow: key card -> save -> pull accounts + closed positions from a stand-in API -> profile, audited at every size
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const US = fs.readFileSync(path.join(__dirname, '..', 'gp-lab.user.js'), 'utf8');
const audit = fs.readFileSync(path.join(__dirname, 'audit-fn.js'), 'utf8');
const now = Date.now(), day = 864e5;
const accounts = Array.from({ length: 9 }, (_, i) => ({ id: 'acc_' + i, account_number: 1000 + i, name: 'Challenge ' + i, stage: i < 3 ? 'funded' : 'evaluation', status: ['active', 'passed', 'failed', 'closed'][i % 4], starting_balance: i % 2 ? '10000' : '25000', balance: '10120', created_at: new Date(now - (20 - i) * day).toISOString(), risk: { requirements: { daily_loss_pct: i % 3 ? 4 : null, max_drawdown_pct: 8, profit_target_pct: i < 3 ? null : 10 } } }));
const pos = id => Array.from({ length: 130 }, (_, k) => ({ id: id + '_p' + k, account_id: id, market_id: 'binance|BTCUSDT', symbol: ['BTC', 'ETH', 'SOL'][k % 3], side: k % 2 ? 'long' : 'short', size: '0.5', entry_price: '68000', exit_price: '68120', leverage: '20', status: 'closed', opened_at: new Date(now - (k + 1) * 36e5).toISOString(), closed_at: new Date(now - k * 36e5).toISOString(), realized_pnl: String((k % 3 ? 1 : -1) * (40 + k)), fees: '3.2', funding: '0.1', close_reason: ['take_profit', 'stop_loss', 'manual'][k % 3] }));
const VPS = [[320, 700], [390, 844], [768, 1024], [1440, 900]];
(async () => {
  const b = await chromium.launch(); let bad = 0, calls = 0, authOk = true;
  for (const [w, h] of VPS) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await ctx.route('https://app.myfundedperpetuals.com/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#111"></body></html>' }));
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await p.exposeFunction('__mfp', (url, auth) => { calls++; if (auth !== 'Bearer fp_live_TEST') { authOk = false; return { status: 401, body: '{}' }; }
      const u = new URL(url); let body;
      if (u.pathname === '/v1/accounts') body = { data: accounts };
      else if (u.pathname === '/v1/positions') { const id = u.searchParams.get('account_id'), all = pos(id), off = +(u.searchParams.get('cursor') || 0), lim = +u.searchParams.get('limit'); const pg = all.slice(off, off + lim); body = { data: pg, has_more: off + lim < all.length, next_cursor: String(off + lim) }; }
      return { status: 200, body: JSON.stringify(body || {}) }; });
    await ctx.addInitScript(`window.__s={};window.GM_getValue=(k,d)=>k in window.__s?window.__s[k]:d;window.GM_setValue=(k,v)=>{window.__s[k]=v};window.unsafeWindow=window;
      window.GM_xmlhttpRequest=o=>{window.__mfp(o.url,o.headers.Authorization).then(r=>o.onload({status:r.status,responseText:r.body}))};` + US);
    await p.goto('https://app.myfundedperpetuals.com/terminal'); await p.waitForTimeout(1400);
    await p.click('#gp-btn >> button'); await p.waitForTimeout(500);
    const r = [];
    if (!(await p.$('#gp-prof >> [data-r=mk]'))) r.push('key card missing');
    else { await p.fill('#gp-prof >> [data-r=mk]', 'fp_live_TEST'); await p.click('#gp-prof >> [data-r=mks]'); await p.waitForTimeout(3500); }
    const st = await p.evaluate(() => { const D = window.__s.mfpProfile; return D ? { a: D.accounts.length, t: D.trades.length } : null; });
    if (!st || st.a !== 9 || st.t !== 9 * 130) r.push('pulled ' + JSON.stringify(st) + ', wanted 9 accounts / 1170 trades');
    r.push(...(await p.evaluate(audit + '()')).filter(x => !/tiny text 9.5px: span/.test(x)));
    if (errs.length) r.push('JS errors: ' + errs.join(' | '));
    if (!authOk) r.push('key not sent as Bearer');
    if (w === 1440) await p.screenshot({ path: path.join(__dirname, '..', '..', 'mfp-shot.png') }).catch(() => {});
    if (r.length) { bad++; console.log(`\nmfp @ ${w}x${h}\n  - ` + r.join('\n  - ')); }
    await ctx.close();
  }
  console.log(bad ? `\n${bad} views with issues` : `MFP views clean (${calls} API calls)`); await b.close(); process.exit(bad ? 1 : 0);
})();
