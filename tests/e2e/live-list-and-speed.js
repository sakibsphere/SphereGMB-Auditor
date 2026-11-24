/**
 * SphereGMB: Live check of the Maps "Export list" bar and the Dashboard website-speed check.
 * Usage: node tests/e2e/live-list-and-speed.js [--mobile]
 */

const path = require('path');
const fs = require('fs');
const { launchExtension, PROJECT_ROOT } = require('./launch');

const OUT_DIR = path.join(PROJECT_ROOT, 'test-results', 'screenshots');
const MOBILE = process.argv.includes('--mobile');
const suffix = MOBILE ? '-mobile' : '';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const viewport = MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 900 };
  const { context, cleanup } = await launchExtension({ headless: false, viewport });
  const result = {};
  try {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // 1. Results list -> Export list
    await page.goto('https://www.google.com/maps/search/mexican+restaurant/@40.7484,-73.9857,16z?hl=en', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.sgmb-list-bar .sgmb-list-label', { timeout: 25000 });
    await page.waitForTimeout(3000);
    result.barLabel = await page.textContent('.sgmb-list-bar .sgmb-list-label');
    result.barAboveFeed = await page.evaluate(() => document.querySelector('.sgmb-list-bar')?.nextElementSibling?.getAttribute('role') === 'feed');
    await page.screenshot({ path: path.join(OUT_DIR, `live-list-bar${suffix}.png`) });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      page.click('.sgmb-list-bar .sgmb-list-export'),
    ]);
    const csvPath = path.join(OUT_DIR, `live-list-export${suffix}.csv`);
    await download.saveAs(csvPath);
    const lines = fs.readFileSync(csvPath, 'utf8').split('\r\n').filter(Boolean);
    const header = lines[0].replace(/^\uFEFF/, '').split(',');
    const phoneCol = header.indexOf('phone');
    const catCol = header.indexOf('additional categories');
    const rows = lines.slice(1);
    result.listExport = {
      filename: download.suggestedFilename(),
      rows: rows.length,
      columns: header.length,
      // Rough check: rows with a phone-looking value and at least one secondary category.
      rowsWithPhone: rows.filter((r) => /\(\d{3}\) \d{3}-\d{4}/.test(r)).length,
      headerHasPhone: phoneCol >= 0,
      headerHasSecondary: catCol >= 0,
      firstRow: rows[0]?.slice(0, 140),
    };
    result.barAfter = await page.textContent('.sgmb-list-bar .sgmb-list-label');

    // 2. Place -> Dashboard -> website speed
    await page.goto('https://www.google.com/maps/place/Tacombi/data=!4m2!3m1!1s0x89c259a903a8074d:0x85e2e7637cfe73a5?hl=en', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.sgmb-maps-place .sgmb-chip-secondary', { timeout: 20000 });
    result.listBarGoneOnPlace = await page.evaluate(() => !document.querySelector('.sgmb-list-bar'));
    await page.click('.sgmb-maps-place [data-action="dashboard"]');
    await page.waitForSelector('[data-act="psi"]', { timeout: 8000 });
    await page.click('[data-act="psi"]');
    await page.waitForFunction(() => !document.querySelector('[data-act="psi"]'), null, { timeout: 120000 });
    result.speedResult = await page.evaluate(() => document.querySelector('[data-psi]')?.innerText.replace(/\s+/g, ' ').trim());
    await page.evaluate(() => document.querySelector('[data-psi]')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, `live-speed-check${suffix}.png`) });
    result.widgetsOnPlace = await page.evaluate(() => document.querySelectorAll('.sgmb-maps-place').length);
    result.overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    result.pageErrors = pageErrors.filter((e) => /sgmb|SphereGmb/i.test(e));
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error('[list-and-speed] failed:', err);
  process.exit(1);
});
