(() => {
      const out = []; const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth);
      const roots = [document]; document.querySelectorAll('*').forEach(e => { if (e.shadowRoot) roots.push(e.shadowRoot); });
      const name = e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').filter(Boolean).join('.') : '') + (e.dataset && e.dataset.r ? '[' + e.dataset.r + ']' : '');
      for (const R of roots) R.querySelectorAll('*').forEach(e => {
        const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden]')) return;
        if (['CANVAS', 'SVG', 'svg', 'path', 'circle', 'STYLE', 'SCRIPT', 'line', 'defs', 'linearGradient', 'stop', 'clipPath', 'rect'].includes(e.tagName)) return;
        const bx = e.getBoundingClientRect(); if (!bx.width || !bx.height) return;
        const scrollable = /auto|scroll/.test(cs.overflowX) || e.closest('.tw,.accs,.plans,.pop');
        if (!scrollable && bx.right > vw + 1 && cs.position !== 'fixed' && !e.closest('.moon,canvas')) out.push('off right edge: ' + name(e) + ' ' + Math.round(bx.right));
        const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (own) {
          let anc = e.parentElement; while (anc && anc !== document.body && !(R.host && anc === R.host)) { const ac = getComputedStyle(anc); if (/hidden|clip/.test(ac.overflowX) && !/auto|scroll/.test(ac.overflowX)) { const ab = anc.getBoundingClientRect(); if (bx.right > ab.right + 2 || bx.left < ab.left - 2) out.push('cut off by box: ' + name(e) + ' "' + e.textContent.trim().slice(0, 24) + '"'); break; } anc = anc.parentElement; }
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
          const rg = document.createRange(); rg.selectNodeContents(e); const tops = new Set([...rg.getClientRects()].map(q => Math.round(q.top / 4))); const lines = tops.size;
          if (/\blab\b|\bk\b|count|name|btn|pill|code/.test(String(e.className)) && lines >= 3) out.push('wraps 3+ lines: ' + name(e) + ' "' + e.textContent.trim().slice(0, 24) + '"');
          if (/^H1$|big|res/.test(e.tagName + ' ' + e.className) && lines >= 3 && !e.querySelector('br')) out.push('headline wraps: ' + name(e));
          if (/btn|pill|code|seg|trig/.test(String(e.className)) && lines >= 2) out.push('button text wraps: ' + name(e));
          if (parseFloat(cs.fontSize) < 10) out.push('tiny text ' + cs.fontSize + ': ' + name(e));
          if (!scrollable && e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible') out.push('clipped text: ' + name(e) + ' "' + e.textContent.trim().slice(0, 30) + '"');
          if (!scrollable && cs.whiteSpace === 'nowrap' && e.parentElement) { const pb = e.parentElement.getBoundingClientRect(); if (bx.right > pb.right + 2 && getComputedStyle(e.parentElement).overflowX !== 'visible') out.push('nowrap spills: ' + name(e)); }
        }
      });
      return [...new Set(out)].slice(0, 12);
    })