/**
 * SphereGMB: Live interaction test on Google Maps.
 * Clicks the toolbar buttons on a real place page and on a results list and reports what happened.
 *
 * Usage: node tests/e2e/live-interactions.js [--mobile]
 */

const path = require('path');
const fs = require('fs');
const { launchExtension, PROJECT_ROOT } = require('./launch');

const OUT_DIR = path.join(PROJECT_ROOT, 'test-results', 'screenshots');
const MOBILE = process.argv.includes('--mobile');
const suffix = MOBILE ? '-mobile' : '';
const PLACE_URL = 'https://www.google.com/maps/place/Tacombi/data=!4m2!3m1!1s0x89c259a903a8074d:0x85e2e7637cfe73a5?hl=en';
const SEARCH_URL = 'https://www.google.com/maps/search/mexican+restaurant/@40.7484,-73.9857,16z?hl=en';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const viewport = MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 900 };
  const { context, cleanup } = await launchExtension({ headless: false, viewport });
  const results = {};
  try {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(PLACE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.sgmb-maps-place .sgmb-chip-secondary', { timeout: 20000 }).catch(() => {});
    results.place = await page.evaluate(() => ({
      widgets: document.querySelectorAll('[data-sphere-gmb-root]').length,
      chips: Array.from(document.querySelectorAll('.sgmb-maps-place .sgmb-chip')).map((c) => c.textContent.trim()),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    }));
    await page.screenshot({ path: path.join(OUT_DIR, `live-maps-widget${suffix}.png`) });

    // Export -> real CSV download
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('.sgmb-maps-place [data-action="export"]'),
    ]);
    const csvPath = path.join(OUT_DIR, `live-export${suffix}.csv`);
    await download.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').split('\r\n');
    const header = csv[0].split(',');
    const row = csv[1];
    results.export = { filename: download.suggestedFilename(), columns: header.length, rowPreview: row.slice(0, 160) };

    // Dashboard: opens the full report page in a new tab (since 1.4.0)
    const [report] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }),
      page.click('.sgmb-maps-place [data-action="dashboard"]'),
    ]);
    await report.waitForSelector('.checks .check', { timeout: 15000 });
    await report.waitForTimeout(700);
    results.dashboard = await report.evaluate(() => ({
      url: location.pathname,
      score: document.querySelector('.score-ring strong')?.textContent.trim(),
      grade: document.querySelector('.score-ring span')?.textContent.trim(),
      checks: Array.from(document.querySelectorAll('.checks .check')).map((c) => `${c.className.replace(/.*check-/, '')}: ${c.querySelector('strong')?.textContent.trim()}`),
      fitsViewport: document.documentElement.scrollWidth <= window.innerWidth + 1,
    }));
    await report.screenshot({ path: path.join(OUT_DIR, `live-dashboard${suffix}.png`) });
    results.profileTab = await report.$eval('#info', (el) => el.innerText.slice(0, 600));
    await report.close();

    // Media audit on Maps opens a Google Search tab and runs there (since 1.3.0)
    const [photoTab] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }),
      page.click('.sgmb-maps-place [data-action="media-audit"]'),
    ]);
    await photoTab.waitForLoadState('domcontentloaded').catch(() => {});
    results.photoAudit = { url: photoTab.url().slice(0, 120), captcha: /\/sorry\//.test(photoTab.url()) };
    results.photoAuditOpenedTab = true;
    await photoTab.close();

    // Results list
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('div[role="feed"] .sgmb-maps-card', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(5000);
    results.searchList = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div[role="feed"] .sgmb-maps-card'));
      return {
        placeWidgetsOnList: document.querySelectorAll('.sgmb-maps-place').length,
        cardsWithWidget: cards.length,
        orphanWidgets: Array.from(document.querySelectorAll('[data-sphere-gmb-root]')).filter((w) => !w.closest('div[role="feed"]') && !w.closest('div[role="main"]')).length,
        firstCards: cards.slice(0, 4).map((c) => Array.from(c.querySelectorAll('.sgmb-chip')).map((x) => x.textContent.trim()).join(' / ')),
      };
    });
    await page.screenshot({ path: path.join(OUT_DIR, `live-maps-search${suffix}.png`) });
    results.pageErrors = pageErrors.filter((e) => /sgmb|SphereGmb/i.test(e));
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `live-interactions${suffix}.json`), JSON.stringify(results, null, 2));
})().catch((err) => {
  console.error('[interactions] failed:', err);
  process.exit(1);
});
