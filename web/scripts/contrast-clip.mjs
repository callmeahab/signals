// Shared reviewer measurement: composited text contrast and visible overflow.
export async function contrastAndClip(page, tag) {
  return page.evaluate((tagName) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const parse = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const over = (fg, bg) => {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };
    const backdrop = (el) => {
      let node = el;
      const layers = [];
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const parsed = parse(bg);
        if (parsed.a > 0.01) layers.push(parsed);
        if (parsed.a > 0.98) break;
        node = node.parentElement;
      }
      const root = parse(getComputedStyle(document.body).backgroundColor);
      let acc = root.a > 0 ? root : { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.reverse()) acc = over(layer, acc);
      return acc;
    };
    const failures = [];
    const seen = new Set();
    const nodes = [...document.querySelectorAll('body *')].filter((el) => {
      if (el.closest('.sr-only, [aria-hidden="true"]')) return false;
      if(el.matches('.skip-link')&&el.getBoundingClientRect().bottom<0)return false;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      return own;
    });
    for (const el of nodes) {
      const style = getComputedStyle(el);
      const fg0 = parse(style.color);
      if (fg0.a < 0.2) continue;
      const bg = backdrop(el);
      const fg = over(fg0, bg);
      const L = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const lum = (c) => 0.2126 * L(c.r) + 0.7152 * L(c.g) + 0.0722 * L(c.b);
      const a = lum(fg), b = lum(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio >= 4.5) continue;
      const sample = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
      const key = `${style.color}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}|${sample}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ tag: tagName, sample, ratio: Math.round(ratio * 100) / 100, size: style.fontSize, weight: style.fontWeight, color: style.color });
      if (failures.length > 40) break;
    }
    const clipped = [];
    for (const el of document.querySelectorAll('#main *')) {
      if (el.closest('.table-scroll, nav, .topbar, pre, .copy-block, .sr-only')) continue;
      const style = getComputedStyle(el);
      if (!['hidden', 'clip'].includes(style.overflowX) && style.textOverflow !== 'ellipsis') continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.innerText && el.innerText.trim()) {
        clipped.push({ tag: tagName, text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80), sw: el.scrollWidth, cw: el.clientWidth });
        if (clipped.length > 15) break;
      }
    }
    return { failures, clipped, overflow: [document.documentElement.scrollWidth, innerWidth] };
  }, tag);
}

