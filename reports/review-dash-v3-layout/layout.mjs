// Independent measurement of the 2026-10-12 layout amendment and client-share donut.
// Does not import visual-qa.mjs. A per-entity list is a card or panel whose
// rendered row count follows the data: tool ribbons, a data table that is not
// the fixed Metric/Value pair, a ranked-bar chart whose height is 50px per
// item, a client-mix legend, or a capability dot row. Live "Event mix" is the
// brief's bounded exception and may share a row.
//
//   cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27680 \
//     bun ../reports/review-dash-v3-layout/layout.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
const { contrastAndClip } = await import('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/scripts/contrast-clip.mjs');

const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27680';
const outDir = resolve(import.meta.dirname);
const screens = ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'callers', 'cost', 'protocol', 'live', 'settings'];
const widths = [390, 768, 1280, 1440];
// Round 2 measures light and dark at every width, including 768.
const failures = [];
const fail = (message) => failures.push(message);

const measure = () => {
  const root = document.querySelector('.signals-ui');
  const rootBox = root.getBoundingClientRect();
  const tiles = [...document.querySelectorAll('.signals-ui > .tiles')].map((el) => {
    const columns = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
    const items = [...el.children].map((child) => {
      const box = child.getBoundingClientRect();
      const spark = child.querySelector('.tile__spark svg');
      let sparkline = null;
      if (spark) {
        const svgBox = spark.getBoundingClientRect();
        const plot = spark.querySelector('.plot');
        const boxPlot = plot ? plot.getBBox() : null;
        sparkline = {
          svgHeight: svgBox.height,
          svgWidth: svgBox.width,
          tileClientWidth: child.clientWidth,
          tileWidth: box.width,
          plotBBoxHeight: boxPlot ? boxPlot.height : null,
          viewBoxHeight: Number(spark.getAttribute('height') || spark.viewBox?.baseVal?.height || 0),
        };
      }
      return { label: child.querySelector('.tile__label')?.textContent?.trim() ?? '', top: Math.round(box.top), height: Math.round(box.height), width: Math.round(box.width), sparkline };
    });
    const rows = new Map();
    for (const item of items) {
      const key = [...rows.keys()].find((k) => Math.abs(k - item.top) < 8) ?? item.top;
      rows.set(key, [...(rows.get(key) ?? []), item.label]);
    }
    return { columns, count: items.length, heights: items.map((item) => item.height), rows: [...rows.values()], items };
  });
  const grids = [...document.querySelectorAll('.signals-ui .grid')].map((grid) => {
    const gridBox = grid.getBoundingClientRect();
    const children = [...grid.children].map((el) => {
      const box = el.getBoundingClientRect();
      const title = el.querySelector('h2')?.textContent?.trim() ?? el.getAttribute('class');
      const tables = [...el.querySelectorAll('table')].filter((table) => !table.classList.contains('sr-only') && !table.closest('.v3-chart')).map((table) => ({
        headers: [...table.tHead?.rows?.[0]?.cells ?? []].map((cell) => cell.textContent.trim()),
        rows: table.tBodies[0]?.rows.length ?? 0,
      }));
      const ribbons = el.querySelectorAll('.ribrow').length;
      const ranked = [...el.querySelectorAll('[data-chart="bars"]')].map((chart) => {
        const rows = chart.querySelectorAll('table.sr-only tbody tr').length;
        const svg = chart.querySelector('svg[role=img]');
        const height = svg ? svg.getBoundingClientRect().height : 0;
        return { rows, height, grows: rows > 0 && Math.abs(height - rows * 50) < 4 };
      });
      const dots = [...el.querySelectorAll('[data-chart="dot-grid"]')].map((chart) => chart.querySelectorAll('table.sr-only tbody tr').length);
      const legend = el.querySelectorAll('.client-mix .legendlist .r').length;
      const eventRows = el.querySelectorAll('details.event-row').length;
      const entityTables = tables.filter((table) => !(table.headers.length === 2 && table.headers[0] === 'Metric' && table.headers[1] === 'Value'));
      const entity = ribbons > 0 || entityTables.some((table) => table.rows > 0) || ranked.some((chart) => chart.grows) || dots.some((n) => n > 0) || legend > 0 || eventRows > 0;
      return {
        title, top: Math.round(box.top), bottom: Math.round(box.bottom), width: box.width, height: box.height,
        full: Math.abs(box.width - gridBox.width) < 2,
        entity, ribbons, legend, dots, ranked, tables, eventRows,
        allowedShare: title === 'Event mix',
      };
    });
    const bands = [];
    for (const child of children) {
      const band = bands.find((row) => child.top < row.bottom - 8 && child.bottom > row.top + 8);
      if (band) { band.children.push(child); band.top = Math.min(band.top, child.top); band.bottom = Math.max(band.bottom, child.bottom); }
      else bands.push({ top: child.top, bottom: child.bottom, children: [child] });
    }
    return {
      width: gridBox.width,
      children,
      rows: bands.map((band) => ({
        titles: band.children.map((child) => child.title),
        widths: band.children.map((child) => Math.round(child.width)),
        heights: band.children.map((child) => Math.round(child.height)),
        covered: band.children.reduce((sum, child) => sum + child.width, 0),
        entities: band.children.filter((child) => child.entity && !child.allowedShare).map((child) => child.title),
      })),
    };
  });
  return { tiles, grids, rootWidth: rootBox.width };
};

const donut = () => {
  const mix = document.querySelector('.client-mix');
  if (!mix) return null;
  const card = mix.closest('.card') ?? mix.closest('.panel');
  const grid = card?.parentElement;
  const cardBox = card.getBoundingClientRect();
  const gridBox = grid.getBoundingClientRect();
  const legend = getComputedStyle(mix.querySelector('.legendlist'));
  const rows = [...mix.querySelectorAll('.legendlist .r')].map((row) => ({
    name: row.querySelector('span')?.textContent?.trim() ?? '',
    calls: row.querySelector('b')?.textContent?.trim() ?? '',
    pct: row.querySelector('span:last-child')?.textContent?.trim() ?? '',
  }));
  const values = [...mix.querySelectorAll('table.sr-only tbody tr')].map((row) => ({
    name: row.cells[0].textContent.trim(),
    value: Number(row.cells[1].textContent),
  }));
  const arcs = [...mix.querySelectorAll('.stroke-draw')].map((path) => ({
    length: path.getTotalLength(),
    color: getComputedStyle(path).stroke,
  }));
  const beside = [...(grid?.children ?? [])].filter((child) => child !== card).filter((child) => {
    const box = child.getBoundingClientRect();
    return box.bottom > cardBox.top + 8 && box.top < cardBox.bottom - 8;
  }).map((child) => child.querySelector('h2')?.textContent?.trim() ?? child.className);
  return {
    columns: legend.gridTemplateColumns.split(' ').filter(Boolean).length,
    rows,
    values,
    arcs,
    full: Math.abs(cardBox.width - gridBox.width) < 2,
    beside,
  };
};

const adoptionShare = () => {
  const card = [...document.querySelectorAll('.card')].find((el) => el.querySelector('h2')?.textContent?.trim() === 'Clients');
  if (!card) return null;
  const headers = [...card.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
  const rows = [...card.querySelectorAll('tbody tr')].map((row) => ({
    name: row.cells[0]?.textContent?.trim() ?? '',
    meter: row.querySelector('meter')?.value ?? null,
    pct: row.cells[2]?.textContent?.trim() ?? '',
    sessions: row.cells[3]?.textContent?.trim() ?? '',
    calls: row.cells[4]?.textContent?.trim() ?? '',
  }));
  const box = card.getBoundingClientRect();
  const parent = card.parentElement.getBoundingClientRect();
  return { headers, rows, full: Math.abs(box.width - parent.width) < 2 };
};

async function openScreen(page, screen) {
  await page.goto(`${product}/#${screen}`, { waitUntil: 'commit' });
  await page.locator('.signals-ui .panel, .signals-ui .card, .signals-ui .tiles').first().waitFor({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  for (const chart of await page.locator('.v3-chart').all()) await chart.scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const report = { product, widths: {}, many: {}, adoption: {}, contrast: [] };
try {
  for (const width of widths) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await context.addInitScript(() => localStorage.setItem('signals-theme', theme === 'dark' ? 'dark' : 'light'));
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-10-12T00:00:00Z'));
      const key = `${width}/${theme}`;
      const desktop = width >= 1024;
      report.widths[key] = {};
      for (const screen of screens) {
        await openScreen(page, screen);
        const scan = await contrastAndClip(page, `${screen}/${key}`);
        report.contrast.push({ screen, key, failures: scan.failures.length, clipped: scan.clipped.length });
        for (const item of scan.failures) fail(`Contrast ${screen}/${key} ${JSON.stringify(item)}`);
        for (const item of scan.clipped) fail(`Clip ${screen}/${key} ${JSON.stringify(item)}`);
        const measured = await page.evaluate(measure);
        report.widths[key][screen] = measured;
        for (const tile of measured.tiles) {
          if (tile.count === 6) {
            const shape = tile.rows.map((row) => row.length);
            if (desktop && JSON.stringify(shape) !== JSON.stringify([3, 3])) fail(`${screen}/${key}: overview-style tiles are ${JSON.stringify(shape)}, expected [3,3]`);
            if (width === 390 && shape.some((n) => n !== 1)) fail(`${screen}/${key}: tiles are not one column ${JSON.stringify(shape)}`);
            if (width === 768 && JSON.stringify(shape) !== JSON.stringify([2, 2, 2])) fail(`${screen}/${key}: tablet tiles are ${JSON.stringify(shape)}, expected [2,2,2]`);
          }
          if (desktop) {
            for (const item of tile.items) {
              if (!item.sparkline) continue;
              const plot = item.sparkline.viewBoxHeight - 10;
              if (!(item.sparkline.svgHeight >= 96)) fail(`${screen}/${key}: ${item.label} spark svg ${item.sparkline.svgHeight}px`);
              if (!(plot >= 96)) fail(`${screen}/${key}: ${item.label} spark plot range ${plot}px`);
              const delta = Math.abs(item.sparkline.svgWidth - item.sparkline.tileClientWidth);
              if (delta > 2) fail(`${screen}/${key}: ${item.label} spark is ${delta.toFixed(1)}px off the tile width`);
            }
          }
        }
        if (width === 390 || desktop) {
          for (const grid of measured.grids) {
            for (const row of grid.rows) {
              if (width === 390 && row.titles.length !== 1) fail(`${screen}/${key}: row is not a single column ${JSON.stringify(row.titles)}`);
              if (desktop && row.entities.length && (row.titles.length > 1 || row.covered < grid.width - 8)) {
                fail(`${screen}/${key}: per-entity list shares a row ${JSON.stringify(row)}`);
              }
              if (desktop && row.titles.length === 1 && row.covered < grid.width - 8) {
                fail(`${screen}/${key}: fixed card orphaned beside a gap ${JSON.stringify(row)}`);
              }
            }
          }
        }
        if (screen === 'adoption') {
          const share = await page.evaluate(adoptionShare);
          report.adoption[key] = share;
          if (share && !share.headers.includes('Share of calls')) fail(`${key}: Adoption table headers ${JSON.stringify(share.headers)}`);
          if (desktop && share && !share.full) fail(`${key}: Clients table is not full width`);
        }
      }
      if (theme === 'light') {
        await page.getByLabel('Select project').selectOption('demo-many-clients');
        await openScreen(page, 'overview');
        const mix = await page.evaluate(donut);
        report.many[key] = mix;
        if (!mix) fail(`${key}: 27-client mix missing`);
        else {
          if (mix.rows.length !== 27) fail(`${key}: legend rows ${mix.rows.length}`);
          if (mix.values.length !== 27) fail(`${key}: donut table rows ${mix.values.length}`);
          if (desktop && mix.columns < 2) fail(`${key}: legend columns ${mix.columns}`);
          if (width === 390 && mix.columns !== 1) fail(`${key}: phone legend columns ${mix.columns}`);
          if (desktop && (!mix.full || mix.beside.length)) fail(`${key}: something beside client mix ${JSON.stringify(mix.beside)} full=${mix.full}`);
          const zero = mix.values.filter((item) => item.value === 0).length;
          if (mix.arcs.length !== mix.values.length - zero) fail(`${key}: arcs ${mix.arcs.length} for ${mix.values.length} values and ${zero} zeros`);
          const positive = mix.values.filter((item) => item.value > 0);
          const arcTotal = mix.arcs.reduce((sum, arc) => sum + arc.length, 0);
          const callTotal = positive.reduce((sum, item) => sum + item.value, 0);
          const paired = positive.map((item, index) => ({ ...item, arc: mix.arcs[index]?.length ?? 0, callShare: item.value / callTotal, arcShare: (mix.arcs[index]?.length ?? 0) / arcTotal }));
          report.many[key].paired = paired.map((item) => ({ name: item.name, value: item.value, callShare: item.callShare, arcShare: item.arcShare }));
          const orderCalls = [...positive].sort((a, b) => b.value - a.value).map((item) => item.name).join('|');
          const orderArcs = [...paired].sort((a, b) => b.arc - a.arc).map((item) => item.name).join('|');
          if (orderCalls !== orderArcs) fail(`${key}: arc order does not follow calls`);
          for (const item of paired) {
            if (Math.abs(item.arcShare - item.callShare) > 0.03) fail(`${key}: ${item.name} arc share ${item.arcShare.toFixed(3)} vs calls ${item.callShare.toFixed(3)}`);
          }
        }
        await openScreen(page, 'adoption');
        const share = await page.evaluate(adoptionShare);
        report.adoption[`many/${key}`] = share;
        if (share) {
          const legendPct = Object.fromEntries((mix?.rows ?? []).map((row) => [row.name, row.pct]));
          for (const row of share.rows) {
            if (legendPct[row.name] && legendPct[row.name] !== row.pct) fail(`${key}: Adoption ${row.name} shows ${row.pct}, overview legend shows ${legendPct[row.name]}`);
          }
          if (share.rows.length !== 27) fail(`${key}: Adoption client rows ${share.rows.length}`);
        }
      }
      await context.close();
    }
  }
} catch (error) {
  failures.push(`probe crashed: ${error.stack ?? error}`);
} finally {
  await browser.close();
  writeFileSync(resolve(outDir, 'layout.json'), JSON.stringify({ failures, report }, null, 2));
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Layout probe passed: ${Object.keys(report.widths).length} viewports, contrast failures ${report.contrast.reduce((n, row) => n + row.failures, 0)}, clipped ${report.contrast.reduce((n, row) => n + row.clipped, 0)}`);
