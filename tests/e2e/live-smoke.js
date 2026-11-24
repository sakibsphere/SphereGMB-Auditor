/**
 * SphereGMB: Live smoke test.
 * Loads the unpacked extension in Chromium, opens a real Google Maps place and a
 * Google Search knowledge panel, and reports what the extension rendered.
 *
 * Usage: node tests/e2e/live-smoke.js [--mobile]
 * Google may show a consent page or CAPTCHA; the script reports that instead of failing silently.
 */

const path = require('path');
const fs = require('fs');
const { launchExtension, PROJECT_ROOT } = require('./launch');

const OUT_DIR = path.join(PROJECT_ROOT, 'test-results', 'screenshots');
const MOBILE = process.argv.includes('--mobile');

const TARGETS = [
  {
    id: 'maps-place',
    url: 'https://www.google.com/maps/place/Empire+State+Building/@40.7484405,-73.9856644,17z/data=!3m1!4b1!4m6!3m5!1s0x89c259a9b3117469:0xd134e199a405a163!8m2!3d40.7484405!4d-73.9856644!16zL20vMDJuZF8?hl=en',
  },
  {
    id: 'serp-kp',
    url: 'https://www.google.com/search?q=Empire+State+Building+New+York&hl=en',
  },
];

async function dismissConsent(page) {
  const btn = page.locator('button:has-text("Reject all"), button:has-text("Accept all")').first();
  if (await btn.isVisible({ timeout: 2500 }).catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}

async function inspect(page) {
  return page.evaluate(() => {
    const widget = document.querySelector('[data-sphere-gmb-root="1"]');
    const chips = Array.from(document.querySelectorAll('.sgmb-chip')).map((c) => c.textContent.trim());
    const buttons = Array.from(document.querySelectorAll('.sgmb-action-btn')).map((b) => b.textContent.trim());
    const rect = widget ? widget.getBoundingClientRect() : null;
    return {
      title: document.title,
      captcha: /unusual traffic|captcha/i.test(document.body.innerText.slice(0, 3000)),
      widgetCount: document.querySelectorAll('[data-sphere-gmb-root="1"]').length,
      widgetParentClass: widget?.parentElement?.className || null,
      widgetRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      chips: chips.slice(0, 12),
      buttons: [...new Set(buttons)],
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const viewport = MOBILE ? { width: 390, height: 844 } : { width: 1366, height: 900 };
  const { context, cleanup, extensionId } = await launchExtension({ headless: false, viewport });
  console.log(`[smoke] extension ${extensionId} loaded (${MOBILE ? 'mobile' : 'desktop'} viewport)`);
  const report = {};

  try {
    for (const target of TARGETS) {
      const page = await context.newPage();
      const errors = [];
      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' && /SphereGMB|sgmb|chrome-extension/i.test(text)) errors.push(text);
        if (/\[SphereGMB\]/.test(text) && /error/i.test(text)) errors.push(text);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await dismissConsent(page);
      await page.waitForTimeout(9000);

      const state = await inspect(page);
      state.errors = errors;
      report[target.id] = state;
      const shot = path.join(OUT_DIR, `smoke-${target.id}${MOBILE ? '-mobile' : ''}.png`);
      await page.screenshot({ path: shot });
      console.log(`[smoke] ${target.id}:`, JSON.stringify(state, null, 2));
      await page.close();
    }
  } finally {
    await cleanup();
  }

  fs.writeFileSync(path.join(OUT_DIR, `smoke-report${MOBILE ? '-mobile' : ''}.json`), JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
