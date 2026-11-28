/**
 * GBP Sphere: UI quality audit (accessibility + interaction checks) on live Google Maps.
 *
 * Runs axe-core (WCAG 2.2 A/AA rules) scoped to GBP Sphere's own UI only, the widget, the
 * report and rank check pages and the popup, plus checks axe can't do: touch target size, keyboard
 * reachability, visible focus, focus moving into / back out of the drawer.
 *
 * Usage: node tests/e2e/ui-audit.js [--mobile]
 */

const path = require('path');
const fs = require('fs');
const { launchExtension, PROJECT_ROOT } = require('./launch');

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const OUT = path.join(PROJECT_ROOT, 'test-results', 'screenshots');
const MOBILE = process.argv.includes('--mobile');
const NARROW = process.argv.includes('--narrow'); // 320 px: WCAG 1.4.10 reflow
const PLACE = 'https://www.google.com/maps/place/Tacombi/data=!4m2!3m1!1s0x89c259a903a8074d:0x85e2e7637cfe73a5?hl=en';

async function axe(page, selector) {
  await page.evaluate(AXE);
  return page.evaluate(async (sel) => {
    const res = await window.axe.run({ include: [[sel]] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, rules: { region: { enabled: false } } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.failureSummary?.split('\n').slice(0, 2).join(' ') || '', target: v.nodes[0]?.target?.join(' ') }));
  }, selector);
}

async function targets(page, selector) {
  return page.evaluate((sel) => {
    const out = [];
    document.querySelectorAll(sel).forEach((root) => {
      root.querySelectorAll('button, a[href], [role="button"], [role="tab"], input').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        out.push({ label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
      });
    });
    return { total: out.length, under24: out.filter((t) => t.w < 24 || t.h < 24), under44h: out.filter((t) => t.h < 44).length };
  }, selector);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const viewport = NARROW ? { width: 320, height: 700 } : MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 900 };
  const { context, extensionId, cleanup } = await launchExtension({ headless: false, viewport });
  const report = {};
  try {
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(PLACE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.sgmb-maps-place .sgmb-score-pill', { timeout: 25000 });
    await page.waitForTimeout(1500);

    report.widgetAxe = await axe(page, '.sgmb-maps-place');
    report.widgetTargets = await targets(page, '.sgmb-maps-place');

    // Keyboard: focus the first toolbar button, Tab through the widget, check focus is visible.
    report.keyboard = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.sgmb-maps-place button'));
      btns[0].focus();
      return { focusable: btns.length, firstFocused: document.activeElement === btns[0] };
    });
    await page.keyboard.press('Tab');
    report.focusVisible = await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { inWidget: Boolean(el.closest('.sgmb-maps-place')), label: el.textContent.trim().slice(0, 20), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` };
    });

    // Full report page (opened by Dashboard with the keyboard), then the rank check page.
    const [rep] = await Promise.all([
      context.waitForEvent('page', { timeout: 15000 }),
      (async () => { await page.focus('.sgmb-maps-place [data-action="dashboard"]'); await page.keyboard.press('Enter'); })()
    ]);
    await rep.setViewportSize(viewport);
    await rep.emulateMedia({ reducedMotion: 'reduce' });
    await rep.waitForSelector('#cat-tools h3, #cat-tools [role="alert"]', { timeout: 30000 });
    report.reportAxe = await axe(rep, 'body');
    report.reportTargets = await targets(rep, 'body');
    report.reportOverflowX = await rep.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    report.reportTabsAria = await rep.evaluate(() => ({ nav: Boolean(document.querySelector('nav[aria-label]')), h1: document.querySelectorAll('h1').length, h2: document.querySelectorAll('h2').length, unlabeledButtons: Array.from(document.querySelectorAll('button')).filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label'))).length }));
    await rep.keyboard.press('Tab');
    report.reportFocusVisible = await rep.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${document.activeElement.tagName} ${s.outlineStyle} ${s.outlineWidth}`; });
    await rep.screenshot({ path: path.join(OUT, `ui-audit-report${MOBILE ? '-mobile' : NARROW ? '-320' : ''}.png`) });
    await rep.goto(`chrome-extension://${extensionId}/pages/rank.html`);
    await rep.waitForTimeout(500);
    report.rankAxe = await axe(rep, 'body');
    report.rankTargets = await targets(rep, 'body');
    report.rankOverflowX = await rep.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    report.rankLabels = await rep.evaluate(() => ['kw', 't-name', 't-cid', 't-domain', 'mode', 'delay'].map((id) => Boolean(document.querySelector(`label[for="${id}"]`))).every(Boolean));
    await rep.screenshot({ path: path.join(OUT, `ui-audit-rank${MOBILE ? '-mobile' : NARROW ? '-320' : ''}.png`) });
    await rep.close();

    // Dark theme on the in-page widget.
    await page.evaluate(() => document.documentElement.setAttribute('data-sgmb-theme', 'dark'));
    report.widgetAxeDark = await axe(page, '.sgmb-maps-place');
    await page.evaluate(() => document.documentElement.setAttribute('data-sgmb-theme', 'light'));

    // Popup
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 640 });
    await popup.emulateMedia({ reducedMotion: 'reduce' }); // measure final colors, not mid fade-in
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForTimeout(400);
    report.popupAxe = await axe(popup, 'body');
    report.popupTargets = await targets(popup, 'body');
    await popup.click('[data-tab="tab-settings"]');
    report.popupSettingsAxe = await axe(popup, 'body');
    report.popupLabels = await popup.evaluate(() => ['decoderInput', 'psiKeyInput'].map((id) => Boolean(document.querySelector(`label[for="${id}"]`))));
    await popup.fill('#psiKeyInput', 'not-a-key');
    report.popupKeyValidation = await popup.evaluate(() => ({ invalid: document.getElementById('psiKeyInput').getAttribute('aria-invalid'), message: document.getElementById('psiKeyStatus').textContent.slice(0, 40) }));
    await popup.emulateMedia({ colorScheme: 'dark' });
    report.popupAxeDark = await axe(popup, 'body');
    await popup.click('[data-tab="tab-decoder"]');
    report.popupDecoderAxeDark = await axe(popup, 'body');
    await popup.click('[data-tab="tab-rank"]');
    report.popupRankAxeDark = await axe(popup, 'body');
    await popup.emulateMedia({ colorScheme: 'light' });
    report.popupRankAxe = await axe(popup, 'body');
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, `ui-audit${MOBILE ? '-mobile' : ''}.json`), JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error('[ui-audit] failed:', err);
  process.exit(1);
});
