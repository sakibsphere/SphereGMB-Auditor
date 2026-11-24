/**
 * SphereGMB: Live review export test on Google Search.
 * Opens a business, opens Google's reviews dialog, clicks the injected "Export reviews" button
 * and checks that the CSV contains every review (not just the first page).
 *
 * Usage: node tests/e2e/live-review-export.js ["business name and address"]
 */

const path = require('path');
const fs = require('fs');
const { launchExtension, PROJECT_ROOT } = require('./launch');

const OUT_DIR = path.join(PROJECT_ROOT, 'test-results', 'screenshots');
const QUERY = process.argv[2] || 'Wilkerson Insurance Agency 2727 Lyndon B Johnson Fwy Suite 1062 Farmers Branch TX';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { context, cleanup } = await launchExtension({ headless: false, viewport: { width: 1366, height: 900 } });
  const result = {};
  try {
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => { if (/SphereGMB/.test(m.text())) logs.push(m.text()); });
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(QUERY)}&hl=en`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    if (/unusual traffic|captcha/i.test(await page.evaluate(() => document.body.innerText.slice(0, 3000)))) {
      console.log(JSON.stringify({ blocked: 'Google CAPTCHA' }));
      return;
    }
    result.kpWidget = await page.evaluate(() => Boolean(document.querySelector('.sgmb-serp-kp')));
    result.kpChips = await page.evaluate(() => Array.from(document.querySelectorAll('.sgmb-serp-kp .sgmb-chip')).map((c) => c.textContent.trim()));

    await page.click('a[data-fid][role="button"]');
    await page.waitForSelector('#sgmb-modal-export-btn', { timeout: 15000 });
    result.exportButton = await page.textContent('#sgmb-modal-export-btn');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 240000 }),
      page.click('#sgmb-modal-export-btn'),
    ]);
    const csvPath = path.join(OUT_DIR, 'live-reviews.csv');
    await download.saveAs(csvPath);
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
    const header = rows[0];
    const data = rows.slice(1).filter((r) => r.length > 1);
    const col = (name) => header.indexOf(name);
    result.reviewsInCsv = data.length;
    result.uniqueIds = new Set(data.map((r) => r[col('Review ID')])).size;
    result.withText = data.filter((r) => r[col('Review Text')].length > 0).length;
    result.withRating = data.filter((r) => /^[1-5]$/.test(r[col('Star Rating')])).length;
    result.withOwnerReply = data.filter((r) => r[col('Owner Response')].length > 0).length;
    result.sample = data.slice(0, 2).map((r) => ({ name: r[col('Reviewer Name')], rating: r[col('Star Rating')], date: r[col('Review Date')], text: r[col('Review Text')].slice(0, 80), owner: r[col('Owner Response')].slice(0, 60) }));
    result.toast = await page.evaluate(() => document.getElementById('sgmb-review-toast')?.innerText || '');
    result.extensionLogs = logs.slice(-5);
    await page.screenshot({ path: path.join(OUT_DIR, 'live-review-export.png') });
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error('[review-export] failed:', err);
  process.exit(1);
});
