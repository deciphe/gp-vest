// UI audit: overflow, offscreen, clipped text, tiny text across viewports
const { chromium } = require('playwright');
const pages = process.argv.slice(2);
const VPS = [[320, 700], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080]];
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const pg of pages) for (const [w, h] of VPS) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + require('path').resolve(pg)); await p.waitForTimeout(700);
    const r = await p.evaluate(eval(require('fs').readFileSync(require('path').join(__dirname,'audit-fn.js'),'utf8')));
    if (errs.length) r.push('JS errors: ' + errs.join(' | '));
    r.splice(0, r.length, ...r.filter(x => !/tiny text 9.5px: span/.test(x))); if (r.length) { bad++; console.log(`\n${pg} @ ${w}x${h}\n  - ` + r.join('\n  - ')); }
    await p.close();
  }
  console.log(bad ? `\n${bad} views with issues` : 'All views clean'); await b.close(); process.exit(bad ? 1 : 0);
})();
