/**
 * GBP Sphere: Google Search Live Test Script
 */

const { launchExtension, PROJECT_ROOT } = require('./launch');
const path = require('path');

const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'test-results', 'screenshots');

async function handleConsent(page) {
  try {
    const consentButton = page.locator('button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Alles akzeptieren"), form[action*="consent"] button');
    if (await consentButton.first().isVisible({ timeout: 2500 })) {
      console.log('[Consent] Detected consent dialog, clicking accept...');
      await consentButton.first().click();
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
    }
  } catch (e) {
    // No consent modal, proceed
  }
}

async function runSerpTest() {
  console.log('[SERP Test] Launching Chromium with extension...');
  const { context, serviceWorker, cleanup } = await launchExtension({
    headless: false,
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();
  const consoleMessages = [];

  page.on('console', msg => {
    console.log(`[Page-Console] [${msg.type()}] ${msg.text()}`);
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  serviceWorker.on('console', msg => {
    console.log(`[SW-Console] [${msg.type()}] ${msg.text()}`);
  });

  try {
    const url = 'https://www.google.com/search?q=Peter+Luger+Steak+House+Brooklyn&hl=en';
    console.log(`[SERP Test] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await handleConsent(page);

    // Check if CAPTCHA appears
    const hasCaptcha = await page.locator('form#captcha-form, div.g-recaptcha, iframe[src*="recaptcha"]').isVisible().catch(() => false);
    if (hasCaptcha) {
      console.error('[CAPTCHA DETECTED] Google presented a CAPTCHA. Stopping test.');
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'captcha-detected.png') });
      return;
    }

    // Wait 3 seconds for content script and network requests
    await page.waitForTimeout(3500);

    // Capture overall page screenshot
    const shotPath06 = path.join(SCREENSHOTS_DIR, '06-serp-kp-restaurant.png');
    await page.screenshot({ path: shotPath06, fullPage: false });
    console.log(`[Screenshot] Saved: ${shotPath06}`);

    // Inspect DOM for GBP Sphere injections
    const injectionInfo = await page.evaluate(() => {
      const kpRoot = document.querySelector('[data-sphere-gmb-root="1"], .sgmb-category-wrap, .sgmb-action-toolbar');
      const catBadges = Array.from(document.querySelectorAll('.sgmb-cat-chip')).map(el => el.textContent.trim());
      const buttons = Array.from(document.querySelectorAll('.sgmb-btn')).map(el => el.textContent.trim());
      const kpHeader = document.querySelector('.kp-header, #rhs .kp-header, .MDY31c');

      return {
        hasKpHeader: !!kpHeader,
        hasInjectedRoot: !!kpRoot,
        categories: catBadges,
        buttons: buttons
      };
    });

    console.log('[SERP Test Result]:', JSON.stringify(injectionInfo, null, 2));

    // Test Audit Button click if buttons exist
    const auditBtn = page.locator('.sgmb-btn-audit');
    if (await auditBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[SERP Test] Clicking "Audit Profile" button...');
      await auditBtn.first().click();
      await page.waitForTimeout(1000);

      // Capture screenshot with modal open
      const shotPath07 = path.join(SCREENSHOTS_DIR, '07-serp-kp-buttons.png');
      const shotPath14 = path.join(SCREENSHOTS_DIR, '14-audit-modal-overview.png');
      await page.screenshot({ path: shotPath07 });
      await page.screenshot({ path: shotPath14 });
      console.log(`[Screenshot] Modal saved: ${shotPath14}`);

      // Inspect Modal content
      const modalData = await page.evaluate(() => {
        const modal = document.querySelector('.sgmb-modal-card');
        if (!modal) return null;
        const score = modal.querySelector('.sgmb-score-num')?.textContent?.trim();
        const scoreLabel = modal.querySelector('.sgmb-score-label')?.textContent?.trim();
        const title = modal.querySelector('.sgmb-modal-title')?.textContent?.trim();
        const primaryCat = modal.querySelector('.sgmb-kpi-val')?.textContent?.trim();
        return { score, scoreLabel, title, primaryCat };
      });
      console.log('[Modal Data]:', JSON.stringify(modalData, null, 2));

      // Test Tab 2: Category Intelligence
      const tab2 = page.locator('.sgmb-modal-tab:has-text("Category Intelligence")');
      if (await tab2.isVisible().catch(() => false)) {
        await tab2.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '15-audit-modal-categories.png') });
      }

      // Test Tab 3: NAP Consistency
      const tab3 = page.locator('.sgmb-modal-tab:has-text("NAP & Ranking Factors")');
      if (await tab3.isVisible().catch(() => false)) {
        await tab3.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '16-audit-modal-nap.png') });
      }

      // Test close button
      const closeBtn = page.locator('.sgmb-modal-close');
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '17-audit-modal-actions.png') });
      }
    } else {
      console.log('[SERP Test] Audit button was not visible. Inspecting page selectors...');
    }

  } finally {
    await cleanup();
  }
}

runSerpTest().catch(err => {
  console.error('[SERP Test Error]', err);
  process.exit(1);
});

