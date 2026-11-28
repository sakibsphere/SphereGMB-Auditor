/**
 * GBP Sphere: Checks that the service worker's trusted wheel (chrome.debugger) really scrolls
 * a Google page and makes it lazy-load more content. Uses the Maps results feed because
 * automated sessions get a CAPTCHA on Google Search.
 *
 * Usage: node tests/e2e/live-trusted-wheel.js
 */

const { launchExtension } = require('./launch');

(async () => {
  const { context, serviceWorker, cleanup } = await launchExtension({ headless: false, viewport: { width: 1366, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto('https://www.google.com/maps/search/insurance+agency/@32.9112,-96.8858,14z?hl=en', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('div[role="feed"] div.Nv2PK', { timeout: 25000 });
    await page.waitForTimeout(2500);

    const feedState = () => page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      const r = feed.getBoundingClientRect();
      return { scrollTop: Math.round(feed.scrollTop), cards: feed.querySelectorAll('div.Nv2PK').length, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.6) };
    });

    const before = await feedState();
    const tabId = await serviceWorker.evaluate(async () => (await chrome.tabs.query({ url: '*://www.google.com/maps/*' }))[0]?.id);
    const results = [];
    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-undef
      results.push(await serviceWorker.evaluate(({ id, x, y }) => trustedWheel(id, { x, y, deltaY: 900 }), { id: tabId, x: before.x, y: before.y }));
      await page.waitForTimeout(2000);
    }
    const after = await feedState();
    // eslint-disable-next-line no-undef
    await serviceWorker.evaluate((id) => releaseDebugger(id), tabId);

    const report = { calls: results, before: { scrollTop: before.scrollTop, cards: before.cards }, after: { scrollTop: after.scrollTop, cards: after.cards } };
    report.scrolled = after.scrollTop > before.scrollTop;
    report.loadedMore = after.cards > before.cards;
    console.log(JSON.stringify(report, null, 2));
    if (!report.scrolled) process.exitCode = 1;
  } finally {
    await cleanup();
  }
})().catch((err) => {
  console.error('[trusted-wheel] failed:', err);
  process.exit(1);
});
