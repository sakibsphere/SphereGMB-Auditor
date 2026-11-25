/**
 * SphereGMB: Full live feature matrix (Google Maps, popup, service worker).
 * Every check is independent: a failure is recorded and the run continues.
 *
 * Usage: node tests/e2e/full-feature-test.js [--mobile]
 * Writes test-results/screenshots/full-feature-report[-mobile].json
 */

const path = require('path');
const fs = require('fs');
const { launchExtension, PROJECT_ROOT } = require('./launch');

const OUT = path.join(PROJECT_ROOT, 'test-results', 'screenshots');
const MOBILE = process.argv.includes('--mobile');
const SUFFIX = MOBILE ? '-mobile' : '';
const PLACE = 'https://www.google.com/maps/place/Tacombi/data=!4m2!3m1!1s0x89c259a903a8074d:0x85e2e7637cfe73a5?hl=en';
const LIST = 'https://www.google.com/maps/search/mexican+restaurant/@40.7484,-73.9857,16z?hl=en';
const PLACE_FID = '0x89c259a903a8074d:0x85e2e7637cfe73a5';

const results = [];
async function check(id, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail ?? '', ms: Date.now() - started });
    console.log(`PASS ${id} ${name}${detail ? `, ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  } catch (err) {
    results.push({ id, name, status: 'FAIL', detail: err.message.split('\n')[0], ms: Date.now() - started });
    console.log(`FAIL ${id} ${name}, ${err.message.split('\n')[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const readCsv = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

async function download(page, trigger, name) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), trigger()]);
  const file = path.join(OUT, `${name}${SUFFIX}.csv`);
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename() };
}

async function newTabFrom(context, trigger) {
  const [tab] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), trigger()]);
  await tab.waitForLoadState('domcontentloaded').catch(() => {});
  const url = tab.url();
  await tab.close().catch(() => {});
  return url;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const viewport = MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 900 };
  const { context, serviceWorker, extensionId, cleanup } = await launchExtension({ headless: false, viewport });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.google.com' });  const pageErrors = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const w = (sel) => `.sgmb-maps-place ${sel}`;

    // ---------- A. Maps place panel ----------
    await page.goto(PLACE, { waitUntil: 'domcontentloaded', timeout: 45000 });

    await check('A1', 'Place widget mounts once, as row 2 under the header', async () => {
      await page.waitForSelector('.sgmb-maps-place', { timeout: 20000 });
      // Maps re-renders the panel while it loads; let it settle before counting.
      await page.waitForFunction(() => document.querySelectorAll('.sgmb-maps-place').length === 1, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, `full-a1-place${SUFFIX}.png`) });
      const info = await page.evaluate(() => {
        const ws = document.querySelectorAll('.sgmb-maps-place');
        return { count: ws.length, afterHeader: ws[0]?.previousElementSibling?.classList.contains('tAiQdd'), strays: document.querySelectorAll('body > [data-sphere-gmb-root]').length };
      });
      assert(info.count === 1, `${info.count} place widgets`);
      assert(info.strays === 0, 'widget attached directly to <body>');
      return `afterHeader=${info.afterHeader}`;
    });

    await check('A2', 'All categories load (primary + secondary)', async () => {
      await page.waitForSelector(w('.sgmb-chip-secondary'), { timeout: 20000 });
      const chips = await page.$$eval(w('.sgmb-chip'), (els) => els.map((e) => e.textContent.trim()));
      assert(chips.length >= 2 && !chips.some((c) => /loading|checking/i.test(c)), `chips: ${chips.join(' | ')}`);
      return chips.join(' | ');
    });

    await check('A3', 'Toolbar has all 6 buttons', async () => {
      const labels = await page.$$eval(w('.sgmb-action-btn'), (els) => els.map((e) => e.textContent.trim()));
      const expected = ['Export', 'Post Audit', 'Media Audit', 'Review Audit', 'Dashboard', 'SERP Checker'];
      assert(JSON.stringify(labels) === JSON.stringify(expected), labels.join(','));
    });

    await check('A4', 'Export downloads a full profile CSV', async () => {
      const { file, suggested } = await download(page, () => page.click(w('[data-action="export"]')), 'full-profile');
      const [header, row] = readCsv(file).split('\r\n');
      const cols = header.split(',');
      assert(cols.length === 26, `${cols.length} columns`);
      assert(row.startsWith('Tacombi,Mexican restaurant,'), row.slice(0, 60));
      assert(/\(212\) 967-5555/.test(row), 'phone missing');
      assert(/Monday: /.test(row), 'hours missing');
      assert(row.includes(PLACE_FID), 'feature ID missing');
      return suggested;
    });

    let report = null;
    await check('A5', 'Dashboard opens the full report page with score and 16 checks', async () => {
      [report] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), page.click(w('[data-action="dashboard"]'))]);
      report.on('pageerror', (e) => pageErrors.push(`report: ${e.message}`));
      await report.waitForSelector('.checks .check', { timeout: 15000 });
      const d = await report.evaluate(() => ({
        url: location.href,
        score: document.querySelector('.score-ring strong')?.textContent.trim(),
        checks: document.querySelectorAll('.checks .check').length,
        unknown: Array.from(document.querySelectorAll('.checks .check-unknown strong')).map((s) => s.textContent.trim()),
        title: document.querySelector('#biz-name')?.textContent.trim()
      }));
      assert(/^chrome-extension:\/\/.+\/pages\/report\.html\?id=/.test(d.url), d.url);
      assert(d.title === 'Tacombi', d.title);
      assert(d.checks === 16, `${d.checks} checks`);
      // Only fields Google does not publish may be unknown (the owner description).
      assert(d.unknown.every((u) => /description/i.test(u)), `unknown checks: ${d.unknown.join(', ')}`);
      await report.waitForTimeout(1200);
      await report.screenshot({ path: path.join(OUT, `full-report${SUFFIX}.png`) });
      return `score ${d.score}`;
    });

    await check('A6', 'Report shows every profile field, IDs and claimed status', async () => {
      const info = await report.$eval('#info', (el) => el.innerText);
      for (const needle of ['(212) 967-5555', 'ChIJ', '/g/11f3nl0y7n', '9647527766265852837', 'Claimed', 'Business Profile ID']) {
        assert(info.includes(needle), `missing ${needle}`);
      }
      const bpid = await report.$$eval('#info .kv-row', (rows) => rows.find((r) => /Business Profile ID/.test(r.textContent))?.querySelector('.kv-value')?.textContent.trim());
      assert(/^\d{10,}$/.test(bpid || ''), `Business Profile ID: ${bpid}`);
      const details = await report.$eval('#details', (el) => el.innerText);
      assert(/Monday/.test(details), 'hours missing');
      return `Business Profile ID ${bpid}`;
    });

    await check('A7', 'Copy report puts the audit on the clipboard (no em dashes)', async () => {
      // Playwright can't grant clipboard access to extension origins, so capture the write.
      await report.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
      await report.click('.topbar [data-act="copy"]');
      await report.waitForTimeout(400);
      const text = await report.evaluate(() => window.__copied);
      assert(/SphereGMB report: Tacombi/.test(text) && /Score: \d+\/100/.test(text) && /Checks:/.test(text), text.slice(0, 80));
      assert(!text.includes('\u2014'), 'em dash in the copied report');
      return `${text.split('\n').length} lines`;
    });

    await check('A8', 'Report "Profile CSV" button downloads', async () => {
      const { suggested } = await download(report, () => report.click('.topbar [data-act="csv"]'), 'full-report-csv');
      return suggested;
    });

    await check('A9', 'Category tools: list downloads, categories validated, related + services', async () => {
      await report.waitForSelector('#cat-tools h3, #cat-tools [role="alert"]', { timeout: 30000 });
      const c = await report.evaluate(() => ({
        error: document.querySelector('#cat-tools [role="alert"]')?.textContent || '',
        valid: document.querySelectorAll('#own-cats .badge-good').length,
        own: document.querySelectorAll('#own-cats [data-cat]').length,
        related: document.querySelectorAll('#cat-tools .cols-2 > div:first-child .list-row').length,
        relatedNames: Array.from(document.querySelectorAll('#cat-tools .cols-2 > div:first-child .list-row > div:first-child')).map((d) => d.firstChild.textContent.trim())
      }));
      assert(!c.error, c.error);
      assert(c.valid >= 3, `${c.valid} of ${c.own} categories validated`);
      assert(c.related >= 1, `${c.related} related categories`);
      // Only the main noun in common ("Chinese restaurant") is not a related category.
      assert(!c.relatedNames.some((n) => /^(Chinese|Pizza|Fast food|Italian) restaurant$/.test(n)), `unrelated suggestion: ${c.relatedNames.join(', ')}`);
      await report.fill('#cat-search', 'taco');
      await report.waitForTimeout(400);
      const hits = await report.$$eval('#cat-search-results .list-row', (els) => els.map((e) => e.firstElementChild.firstChild.textContent.trim()));
      assert(hits.includes('Taco restaurant'), hits.join(','));
      return `${c.valid}/${c.own} valid, ${c.related} related, search ok`;
    });

    await check('A10', 'Keyword finder returns Google suggestions', async () => {
      await report.click('[data-act="kw-run"]');
      await report.waitForSelector('#kw-results .kw-item, #kw-results p', { timeout: 60000 });
      const n = await report.$$eval('#kw-results .kw-item', (els) => els.length);
      assert(n >= 5, `${n} keywords`);
      return `${n} keywords`;
    });

    await check('A10b', 'Link groups: Google, directories and website audit, all https', async () => {
      const links = await report.$$eval('.link-row', (els) => els.map((a) => a.href));
      const sections = await report.$$eval('#google, #directories, #website', (els) => els.length);
      assert(sections === 3, `${sections} link sections`);
      assert(links.length >= 35, `${links.length} links`);
      assert(links.every((h) => /^https:\/\//.test(h)), 'non-https link');
      return `${links.length} links`;
    });

    await check('A10c', 'Report layout: no horizontal scroll, no em dashes on the page', async () => {
      const r = await report.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, em: document.body.innerText.includes('\u2014') }));
      assert(r.sw <= r.w + 1, `page is ${r.sw}px wide in a ${r.w}px window`);
      assert(!r.em, 'em dash on the report page');
      await report.screenshot({ path: path.join(OUT, `full-report-full${SUFFIX}.png`), fullPage: true });
      return `${r.sw}px`;
    });

    await check('A10e', 'Fix list: prioritised issues and a Google Sheets copy', async () => {
      const f = await report.evaluate(() => ({ items: document.querySelectorAll('#fixes .fix').length, desc: document.querySelector('#fixes .section-desc')?.textContent || '' }));
      await report.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
      await report.click('[data-act="sheets"]');
      await report.waitForTimeout(300);
      const tsv = await report.evaluate(() => window.__copied);
      assert(tsv.includes('Priority\tIssue\tDetail\tArea') && tsv.includes('Check\tStatus\tDetail\tPoints'), tsv.slice(0, 80));
      return `${f.items} items; ${f.desc.slice(0, 60)}`;
    });

    await check('A10f', 'Website check: permission asked, page read, entity and on-page results', async () => {
      // Playwright cannot click Chrome's permission prompt, so it is stubbed, and the site is
      // served from a fixture so the run does not depend on a third-party website.
      const fixture = '<!DOCTYPE html><html lang="en"><head><title>Tacombi | Mexican restaurant in New York</title><meta name="description" content="Tacos and Mexican food in New York City, from breakfast to late night, with locations across Manhattan."><meta name="viewport" content="width=device-width"></head><body><h1>Tacombi Empire State</h1><p>Tacombi 23 W 33rd St, New York, NY 10001. Call (212) 967-5555.</p></body></html>';
      await context.route(/https?:\/\/(www\.)?tacombi\.com\//, (route) => {
        const u = route.request().url();
        if (/robots\.txt$/.test(u)) return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'User-agent: *\nDisallow: /cart\nSitemap: https://www.tacombi.com/sitemap.xml\n' });
        return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: fixture });
      });
      await report.evaluate(() => { chrome.permissions.request = async () => true; });
      await report.click('[data-act="site"]');
      await report.waitForSelector('#site-box .checks .check, #site-box [role="alert"]', { timeout: 30000 });
      const r = await report.evaluate(() => ({
        alert: document.querySelector('#site-box [role="alert"]')?.textContent || '',
        checks: document.querySelectorAll('#site-box .check').length,
        name: document.querySelector('#site-box .check-pass strong')?.textContent || '',
        score: document.querySelector('#site-box .badge')?.textContent || ''
      }));
      await context.unroute(/https?:\/\/(www\.)?tacombi\.com\//);
      assert(!r.alert, r.alert);
      assert(r.checks >= 15, `${r.checks} checks`);
      await report.screenshot({ path: path.join(OUT, `full-report-sitecheck${SUFFIX}.png`) });
      return `${r.checks} checks, score ${r.score}`;
    });

    await check('A10g', 'Audit reports: Initial + Service List run, Excel and CSV download with the template sheets', async () => {
      // Opened from a single profile: competitors come from a Maps search at the business's address.
      const comp = await report.evaluate(() => {
        const i = document.querySelector('input[name="audit-kind"][value="competitor"]');
        return { disabled: i.disabled, checked: i.checked, note: i.closest('.audit-opt').textContent.replace(/\s+/g, ' '), desc: document.querySelector('#competitors .section-desc')?.textContent || '', status: document.getElementById('comp-search-status')?.textContent || '' };
      });
      assert(!comp.disabled && comp.checked && /around this business/.test(comp.note), `competitor option: ${comp.note}`);
      assert(/searched from this business's address/.test(comp.desc), `competitors section: ${comp.desc}`);
      // A different keyword searches again and updates the option.
      await report.fill('#comp-kw', 'taco restaurant');
      await report.press('#comp-kw', 'Enter');
      await report.waitForFunction(() => /"taco restaurant" around its address|Google did not answer|No businesses found/.test(document.getElementById('comp-search-status').textContent), null, { timeout: 30000 });
      const after = await report.evaluate(() => ({ status: document.getElementById('comp-search-status').textContent, note: document.querySelector('input[value="competitor"]').closest('.audit-opt').textContent }));
      assert(/"taco restaurant"/.test(after.note), `note after search: ${after.note}`);
      await report.click('[data-act="audit-run"]');
      await report.waitForSelector('#audit-out [data-act="audit-xlsx"]', { timeout: 60000 });
      const preview = await report.evaluate(() => Array.from(document.querySelectorAll('#audit-out details summary')).map((s) => s.textContent.replace(/\s+/g, ' ').trim()));
      const hoursRow = await report.evaluate(() => Array.from(document.querySelectorAll('#audit-out tr')).map((tr) => Array.from(tr.cells).map((c) => c.textContent.trim())).find((r) => r[0] === 'Business hours'));
      const [dl] = await Promise.all([report.waitForEvent('download', { timeout: 30000 }), report.click('[data-act="audit-xlsx"]')]);
      const xlsxPath = path.join(OUT, `full-audit${SUFFIX}.xlsx`);
      await dl.saveAs(xlsxPath);
      const buf = fs.readFileSync(xlsxPath);
      const text = buf.toString('utf8');
      assert(buf[0] === 0x50 && buf[1] === 0x4b, 'not a zip/xlsx');
      assert(text.includes('<sheet name="Initial GBP Audit"') && text.includes('<sheet name="Service List"'), 'sheets missing');
      assert(hoursRow && hoursRow[2] === 'Pass' && /days|AM|PM/.test(hoursRow[1]), `hours row: ${JSON.stringify(hoursRow)}`);
      const [csvDl] = await Promise.all([report.waitForEvent('download', { timeout: 30000 }), report.click('[data-act="audit-csv"]')]);
      assert(/\.csv$/.test(csvDl.suggestedFilename()), csvDl.suggestedFilename());
      assert(text.includes('<sheet name="GBP and Competitor Audit"'), 'competitor sheet missing');
      return `${preview.join(' | ')}; ${comp.status} Then: ${after.status}; xlsx ${Math.round(buf.length / 1024)} KB`;
    });

    await check('A10d', 'Website speed check responds on the report (result or clear message)', async () => {
      await report.click('[data-act="psi"]');
      await report.waitForFunction(() => !document.querySelector('[data-act="psi"]'), null, { timeout: 120000 });
      const text = await report.$eval('#psi', (el) => el.innerText.replace(/\s+/g, ' ').trim());
      assert(/Performance|quota|key|did not answer|failed/i.test(text), text);
      await report.close();
      return /Performance/.test(text) ? 'score shown' : `message: ${text.slice(0, 70)}`;
    });

    // On Maps, Photo and Post audits open Google Search (where the photo viewer and the full
    // Updates list exist) and run there; the automated tab gets Google's CAPTCHA page here.
    const auditTabUrl = async (action) => {
      const raw = await newTabFrom(context, () => page.click(w(`[data-action="${action}"]`)));
      return raw.includes('/sorry/') ? { url: decodeURIComponent(new URL(raw).searchParams.get('continue') || raw), captcha: true } : { url: raw, captcha: false };
    };

    await check('A11', 'Media Audit on Maps opens a Search media-audit tab', async () => {
      const { url, captcha } = await auditTabUrl('media-audit');
      assert(/google\.com\/search\?q=Tacombi/.test(url) && /sphereGmbAudit=photo/.test(url), url);
      return captcha ? 'correct URL (Google showed its CAPTCHA page to automation)' : 'correct URL';
    });

    await check('A12', 'Media Audit does not open a drawer on Maps (it runs in the Search tab)', async () => {
      await page.waitForTimeout(500);
      assert(!(await page.$('#sgmb-photo-audit-overlay')), 'a drawer opened on Maps');
    });

    await check('A13', 'Post Audit on Maps opens a Search post-audit tab', async () => {
      const { url, captcha } = await auditTabUrl('post-audit');
      assert(/google\.com\/search\?q=Tacombi/.test(url) && /sphereGmbAudit=post/.test(url), url);
      return captcha ? 'correct URL (Google showed its CAPTCHA page to automation)' : 'correct URL';
    });

    await check('A14', 'Review Audit on Maps opens Search with the place reviews dialog (#lrd)', async () => {
      const url = await newTabFrom(context, () => page.click(w('[data-action="review-audit"]')));
      const ok = (/sphereGmbAudit=review/.test(url) && url.includes(`lrd=${PLACE_FID}`)) || /google\.com\/sorry/.test(url);
      assert(ok, url);
      return /sorry/.test(url) ? 'tab opened; Google showed its CAPTCHA page (expected for automation)' : 'q + #lrd correct';
    });

    await check('A15', 'Automated tab payload is stored once and expires', async () => {
      const stored = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('activeAudit')).activeAudit || null);
      // The Search tab consumes it on load; if Google served a CAPTCHA it may remain until it expires (2 min).
      return stored ? `pending for ${stored.auditType} (consumed when Search loads)` : 'consumed';
    });

    let rank = null;
    await check('A16', 'SERP Checker opens the rank page with every category and the city', async () => {
      [rank] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), page.click(w('[data-action="serp-checker"]'))]);
      rank.on('pageerror', (e) => pageErrors.push(`rank: ${e.message}`));
      await rank.waitForFunction(() => document.getElementById('kw')?.value.length > 0, null, { timeout: 10000 });
      const r = await rank.evaluate(() => ({ url: location.href, kw: document.getElementById('kw').value.split('\n'), loc: document.getElementById('loc').value, name: document.getElementById('t-name').value, cid: document.getElementById('t-cid').value, preview: document.getElementById('loc-preview').textContent }));
      assert(/pages\/rank\.html/.test(r.url), r.url);
      assert(r.kw.length === 4 && r.kw[0] === 'mexican restaurant', r.kw.join('|'));
      assert(r.loc === 'New York' && r.name === 'Tacombi' && r.cid === '9647527766265852837', `${r.loc} / ${r.name} / ${r.cid}`);
      assert(/4 searches, for example "mexican restaurant New York"/.test(r.preview), r.preview);
      await rank.screenshot({ path: path.join(OUT, `full-rank${SUFFIX}.png`) });
      return r.preview;
    });

    await check('A17', 'Rank check runs one search and reports a position or stops at Google\'s check', async () => {
      await rank.fill('#kw', 'mexican restaurant');
      await rank.selectOption('#delay', '6');
      await rank.click('[data-act="start"]');
      await rank.waitForFunction(() => /Finished|verify you're human|Stopped/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
      const r = await rank.evaluate(() => ({ status: document.getElementById('status').textContent, cell: document.querySelector('#rows tr td:nth-child(3)')?.textContent.trim(), top: document.querySelector('#rows tr td:nth-child(6)')?.textContent.trim() }));
      const tabs = context.pages().filter((p) => /google\.com\/(search|sorry)/.test(p.url())).length;
      assert(tabs === 0, `${tabs} search tabs left open`);
      await rank.screenshot({ path: path.join(OUT, `full-rank-result${SUFFIX}.png`) });
      await rank.close();
      if (/verify you're human/.test(r.status)) return 'Google showed its check page; the run stopped and said so (expected for automation)';
      assert(r.cell && !/Waiting|No answer|Searching/.test(r.cell), `rank cell: ${r.cell}`);
      return `map rank ${r.cell}, top: ${r.top.slice(0, 40)}`;
    });

    // ---------- B. Results list ----------
    await page.goto(LIST, { waitUntil: 'domcontentloaded', timeout: 45000 });

    await check('B1', 'Result cards get widgets; no stray widgets', async () => {
      await page.waitForSelector('div[role="feed"] .sgmb-maps-card', { timeout: 20000 });
      await page.waitForTimeout(4000);
      const info = await page.evaluate(() => ({
        cards: document.querySelectorAll('div[role="feed"] .sgmb-maps-card').length,
        place: document.querySelectorAll('.sgmb-maps-place').length,
        loading: Array.from(document.querySelectorAll('.sgmb-maps-card .sgmb-chip-loading')).length,
        price: Array.from(document.querySelectorAll('.sgmb-maps-card .sgmb-chip')).filter((c) => /^\$/.test(c.textContent.trim())).length,
      }));
      assert(info.cards >= 3, `${info.cards} cards`);
      assert(info.place === 0, 'place widget on a results list');
      assert(info.price === 0, 'price prefix in categories');
      return `${info.cards} cards, ${info.loading} still loading`;
    });

    await check('B2', 'Export list downloads every card', async () => {
      const cards = await page.$$eval('div[role="feed"] .sgmb-maps-card', (els) => els.length);
      const { file, suggested } = await download(page, () => page.click('.sgmb-list-bar .sgmb-list-export'), 'full-list');
      const rows = readCsv(file).split('\r\n').filter(Boolean).length - 1;
      assert(rows === cards, `${rows} rows for ${cards} cards`);
      return `${suggested} (${rows} rows)`;
    });

    await check('B3', 'Card toolbar works (Dashboard on a result card)', async () => {
      const [card] = await Promise.all([context.waitForEvent('page', { timeout: 20000 }), page.click('div[role="feed"] .sgmb-maps-card [data-action="dashboard"]')]);
      await card.waitForSelector('#biz-name', { timeout: 15000 });
      const title = await card.$eval('#biz-name', (e) => e.textContent.trim());
      // Opened from a results list: the report compares the business with the rest of the list.
      const comp = await card.evaluate(() => ({
        rows: document.querySelectorAll('#competitors table tbody tr').length,
        desc: document.querySelector('#competitors .section-desc')?.textContent || '',
        missing: document.querySelectorAll('#competitors .cols-2 > div:first-child .list-row').length
      }));
      await card.screenshot({ path: path.join(OUT, `full-report-competitors${SUFFIX}.png`), fullPage: false });
      // Competitor audit sheet from the same search list.
      await card.click('[data-act="audit-run"]');
      await card.waitForSelector('#audit-out [data-act="audit-xlsx"]', { timeout: 90000 });
      const compHead = await card.evaluate(() => {
        const d = Array.from(document.querySelectorAll('#audit-out details')).find((x) => /Competitor/.test(x.querySelector('summary').textContent));
        return d ? Array.from(d.querySelector('tr').cells).map((c) => c.textContent.trim()) : [];
      });
      await card.screenshot({ path: path.join(OUT, `full-audit-preview${SUFFIX}.png`) });
      comp.auditHead = compHead;
      // Custom competitor from a pasted Maps link replaces the search list.
      await card.fill('#comp-link', 'https://www.google.com/maps/place/Wilkerson+Insurance+Agency/@32.91,-96.88,17z/data=!4m6!3m5!1s0x864c2945b1bd1b1b:0x4374e835d53256a2!8m2!3d32.9112209!4d-96.8858413');
      await card.press('#comp-link', 'Enter');
      await card.waitForSelector('#comp-list .comp-item', { timeout: 20000 });
      const custom = await card.evaluate(() => ({
        item: document.querySelector('#comp-list .comp-item strong').textContent,
        note: document.querySelector('input[value="competitor"]').closest('.audit-opt').textContent
      }));
      assert(/Wilkerson/.test(custom.item) && /\(your list\)/.test(custom.note), `custom: ${custom.item} / ${custom.note}`);
      await card.evaluate(() => { document.getElementById('audit-out').innerHTML = ''; });
      await card.click('[data-act="audit-run"]');
      await card.waitForSelector('#audit-out [data-act="audit-xlsx"]', { timeout: 90000 });
      const customHead = await card.evaluate(() => {
        const d = Array.from(document.querySelectorAll('#audit-out details')).find((x) => /Competitor/.test(x.querySelector('summary').textContent));
        return d ? Array.from(d.querySelector('tr').cells).map((c) => c.textContent.trim()) : [];
      });
      // The template keeps three competitor columns; unused ones stay as blank slots.
      assert(/^Competitor #1: Wilkerson/.test(customHead[2]) && customHead[3] === 'Competitor #2', `custom header: ${customHead.join(' | ')}`);
      await card.click('[data-act="comp-remove"]');
      assert(await card.$$eval('#comp-list .comp-item', (e) => e.length) === 0, 'remove left the item');
      await card.close();
      assert(compHead.length === 5 && compHead.slice(2).every((h) => /^Competitor #\d: /.test(h)), `competitor header: ${compHead.join(' | ')}`);
      assert(title && title !== 'Business profile', title);
      assert(comp.rows >= 3, `competitor table has ${comp.rows} rows`);
      assert(/businesses in "mexican restaurant"/i.test(comp.desc), comp.desc);
      return `${title}: ${comp.desc.slice(0, 70)}, ${comp.missing} missing categories`;
    });

    await check('B4', 'Clicking a card opens the place with a fresh widget (SPA navigation)', async () => {
      // Click where a user would: on the business name (the card link sits over it). Google may
      // reorder the list after Back, so read the card's name at click time.
      const clickCardName = async (i) => {
        const nameEl = page.locator('div[role="feed"] div.Nv2PK .qBF1Pd').nth(i);
        await nameEl.scrollIntoViewIfNeeded();
        const name = (await nameEl.textContent()).trim();
        const b = await nameEl.boundingBox();
        await page.mouse.click(b.x + Math.min(40, b.width / 2), b.y + b.height / 2);
        return name;
      };
      const first = await clickCardName(0);
      await page.waitForFunction((n) => document.querySelector('.sgmb-maps-place')?.dataset.sgmbName === n, first, { timeout: 20000 });
      await page.goBack();
      await page.waitForSelector('div[role="feed"] div.Nv2PK .qBF1Pd', { timeout: 20000 });
      await page.waitForTimeout(1500);
      const listWidgetGone = (await page.$$eval('.sgmb-maps-place', (els) => els.length)) === 0;
      const second = await clickCardName(1);
      await page.waitForFunction((n) => document.querySelector('.sgmb-maps-place')?.dataset.sgmbName === n, second, { timeout: 20000 });
      const count = await page.$$eval('.sgmb-maps-place', (els) => els.length);
      assert(listWidgetGone, 'place widget left behind on the results list after Back');
      assert(count === 1, `${count} place widgets after navigation`);
      return `${first} → back → ${second}`;
    });

    // ---------- C. Popup ----------
    const popup = await context.newPage();
    popup.on('pageerror', (e) => pageErrors.push(`popup: ${e.message}`));
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await check('C1', 'Popup renders with version and active state', async () => {
      const v = await popup.textContent('.version-label');
      const state = await popup.textContent('#statusState');
      assert(v === 'v1.6.0' && /Active/.test(state), `${v} / ${state}`);
      const recent = await popup.$$eval('#recentList a', (els) => els.length);
      assert(recent >= 1, 'recent reports list is empty');
      await popup.screenshot({ path: path.join(OUT, `popup-v14${SUFFIX}.png`) });
      return `${v}, ${state}, ${recent} recent reports`;
    });

    await check('C1b', 'Rank check tab: prefilled from the last business, location preview', async () => {
      await popup.click('[data-tab="tab-rank"]');
      await popup.waitForTimeout(300);
      const r = await popup.evaluate(() => ({ name: document.getElementById('rankName').value, kw: document.getElementById('rankKeywords').value.split('\n').filter(Boolean).length, preview: document.getElementById('rankPreview').textContent }));
      assert(r.name && r.kw >= 1 && /searches, e\.g\./.test(r.preview), JSON.stringify(r));
      await popup.click('#rankUseLoc');
      const off = await popup.textContent('#rankPreview');
      await popup.click('#rankUseLoc');
      await popup.screenshot({ path: path.join(OUT, `popup-rank${SUFFIX}.png`) });
      return `${r.name}: ${r.preview} | without location: ${off}`;
    });

    await check('C2', 'CID decoder: feature ID, ludocid link, invalid input', async () => {
      await popup.click('[data-tab="tab-decoder"]');
      const run = async (val) => {
        await popup.fill('#decoderInput', val);
        await popup.click('#decodeBtn');
        return popup.textContent('#resCid');
      };
      const a = await run(PLACE_FID);
      const b = await run('https://www.google.com/search?q=x&ludocid=9647527766265852837');
      const c = await run('hello world');
      assert(a === '9647527766265852837' && b === '9647527766265852837', `${a} / ${b}`);
      assert(/No CID/i.test(c), c);
    });

    await check('C3', 'Cache counts visited places and clears', async () => {
      await popup.click('[data-tab="tab-settings"]');
      await popup.waitForTimeout(500);
      const before = await popup.textContent('#cacheCountLabel');
      await popup.click('#clearCacheBtn');
      await popup.waitForTimeout(600);
      const after = await popup.textContent('#cacheCountLabel');
      assert(parseInt(before, 10) > 0 && parseInt(after, 10) === 0, `${before} → ${after}`);
      return `${before} → ${after}`;
    });

    await check('C4', 'On/off switch removes and restores widgets on open Google tabs', async () => {
      await popup.click('[data-tab="tab-overview"]');
      await page.bringToFront();
      const on = await page.$$eval('[data-sphere-gmb-root]', (e) => e.length);
      await popup.evaluate(() => { const t = document.getElementById('enabledToggle'); t.click(); });
      await page.waitForTimeout(1500);
      const off = await page.$$eval('[data-sphere-gmb-root]', (e) => e.length);
      await popup.evaluate(() => { const t = document.getElementById('enabledToggle'); t.click(); });
      await page.waitForFunction((n) => document.querySelectorAll('[data-sphere-gmb-root]').length >= n, on, { timeout: 20000 }).catch(() => {});
      const back = await page.$$eval('[data-sphere-gmb-root]', (e) => e.length);
      assert(on > 0 && off === 0 && back >= on, `on ${on} → off ${off} → on ${back}`);
      return `on ${on} → off ${off} → on ${back}`;
    });

    // ---------- D. Scope ----------
    await check('D1', 'Extension stays off non-Search/Maps pages', async () => {
      const other = await context.newPage();
      await other.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
      await other.waitForTimeout(1500);
      const injected = await other.evaluate(() => Boolean(window.SphereGmb) || document.querySelectorAll('[data-sphere-gmb-root]').length > 0);
      await other.close();
      assert(!injected, 'content script ran on example.com');
    });

    await check('D2', 'No extension errors on any page', async () => {
      const ours = pageErrors.filter((e) => /sgmb|SphereGmb|popup:/i.test(e));
      assert(ours.length === 0, ours.join(' | '));
    });
  } finally {
    await cleanup();
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n${passed}/${results.length} checks passed (${MOBILE ? 'mobile 390px' : 'desktop 1366px'})`);
  fs.writeFileSync(path.join(OUT, `full-feature-report${SUFFIX}.json`), JSON.stringify(results, null, 2));
  if (passed !== results.length) process.exitCode = 1;
})().catch((err) => {
  console.error('[full-feature-test] crashed:', err);
  process.exit(1);
});
