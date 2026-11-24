/**
 * SphereGMB: Comprehensive Playwright E2E Live Test Suite
 */

const { launchExtension, PROJECT_ROOT } = require('./launch');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'test-results', 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runTest(stepName, fn) {
  console.log(`\n========================================`);
  console.log(`[TEST] Starting: ${stepName}`);
  console.log(`========================================`);
  try {
    const result = await fn();
    console.log(`[PASS] ${stepName}`);
    return { step: stepName, status: 'PASS', details: result };
  } catch (err) {
    console.error(`[FAIL] ${stepName}:`, err.message);
    return { step: stepName, status: 'FAIL', error: err.message };
  }
}

async function main() {
  const targetStep = process.argv[2] || 'all';
  console.log(`Launching test harness. Target: ${targetStep}`);

  const { context, serviceWorker, extensionId, cleanup } = await launchExtension({
    headless: false
  });

  const errors = [];

  // Listen to service worker errors
  serviceWorker.on('console', msg => {
    const text = msg.text();
    console.log(`[SW-Console] [${msg.type()}] ${text}`);
    if (msg.type() === 'error') errors.push(`SW: ${text}`);
  });

  const results = [];

  try {
    // ----------------------------------------------------
    // TEST 01: Extension Installation & Manifest Loading
    // ----------------------------------------------------
    if (targetStep === 'all' || targetStep === '01') {
      const res = await runTest('01-ext-install-success', async () => {
        if (!extensionId) throw new Error('Extension ID is undefined');
        console.log(`Service worker active. Extension ID: ${extensionId}`);
        // Capture screenshot of an extension page to prove loading
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
        await page.waitForTimeout(500);
        const shotPath = path.join(SCREENSHOTS_DIR, '01-ext-install-success.png');
        await page.screenshot({ path: shotPath });
        await page.close();
        return { extensionId, screenshot: shotPath };
      });
      results.push(res);
    }

    // ----------------------------------------------------
    // TEST 02: Popup UI, Overview Tab (360px & 420px)
    // ----------------------------------------------------
    if (targetStep === 'all' || targetStep === '02' || targetStep === 'popup') {
      const res = await runTest('02-popup-overview', async () => {
        const page = await context.newPage();
        page.on('console', msg => {
          if (msg.type() === 'error') errors.push(`Popup: ${msg.text()}`);
        });

        // Test at 360px width
        await page.setViewportSize({ width: 360, height: 600 });
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
        await page.waitForSelector('.popup-container');
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-popup-overview-360px.png') });

        // Test at 420px width
        await page.setViewportSize({ width: 420, height: 600 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-popup-overview-420px.png') });
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-popup-overview.png') });

        // Verify elements
        const title = await page.textContent('.brand-title');
        const badge = await page.textContent('.brand-badge');
        const statusText = await page.textContent('#statusState');
        const toggleChecked = await page.isChecked('#enabledToggle');

        console.log(`Popup verification: Brand='${title.trim()}', Tag='${badge.trim()}', Status='${statusText.trim()}', Checked=${toggleChecked}`);
        if (!title.includes('SphereGMB')) throw new Error(`Unexpected title: ${title}`);
        if (!toggleChecked) throw new Error('Toggle is not checked by default');

        await page.close();
        return { title, badge, statusText };
      });
      results.push(res);
    }

    // ----------------------------------------------------
    // TEST 03: Popup UI, Engine On/Off Toggle
    // ----------------------------------------------------
    if (targetStep === 'all' || targetStep === '03' || targetStep === 'popup') {
      const res = await runTest('03-popup-toggle-disabled', async () => {
        const page = await context.newPage();
        await page.setViewportSize({ width: 380, height: 600 });
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
        await page.waitForSelector('.toggle-switch');

        // Click toggle to disable
        await page.click('.toggle-slider');
        await page.waitForTimeout(500);

        const statusTextDisabled = await page.textContent('#statusState');
        console.log(`Status after toggle: ${statusTextDisabled.trim()}`);
        if (!statusTextDisabled.includes('Paused')) throw new Error(`Expected paused state, got: ${statusTextDisabled}`);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-popup-toggle-disabled.png') });

        // Toggle back to enabled
        await page.click('.toggle-slider');
        await page.waitForTimeout(500);
        const statusTextActive = await page.textContent('#statusState');
        if (!statusTextActive.includes('Active')) throw new Error(`Expected active state, got: ${statusTextActive}`);

        await page.close();
        return { statusTextDisabled, statusTextActive };
      });
      results.push(res);
    }

    // ----------------------------------------------------
    // TEST 04: Popup UI, CID Decoder Tab
    // ----------------------------------------------------
    if (targetStep === 'all' || targetStep === '04' || targetStep === 'popup') {
      const res = await runTest('04-popup-cid-decoder', async () => {
        const page = await context.newPage();
        await page.setViewportSize({ width: 380, height: 600 });
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

        // Switch to decoder tab
        await page.click('.nav-tab[data-tab="tab-decoder"]');
        await page.waitForTimeout(300);

        // Fill test Hex Feature ID: 0x89c259af12345678:0x1b2c3d4e5f6a7b8c
        // 0x1b2c3d4e5f6a7b8c in decimal BigInt is 1958007344816880524
        await page.fill('#decoderInput', 'https://www.google.com/maps?cid=0x89c259af12345678:0x1b2c3d4e5f6a7b8c');
        await page.click('#decodeBtn');
        await page.waitForTimeout(400);

        const resCid = await page.textContent('#resCid');
        const resFeatureId = await page.textContent('#resFeatureId');
        console.log(`Decoder output: CID=${resCid}, FeatureID=${resFeatureId}`);

        if (resCid !== '1958007344816880524') {
          throw new Error(`CID mismatch. Expected 1958007344816880524, got ${resCid}`);
        }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-popup-cid-decoder.png') });
        await page.close();
        return { resCid, resFeatureId };
      });
      results.push(res);
    }

    // ----------------------------------------------------
    // TEST 05: Popup UI, Settings & Cache Manager
    // ----------------------------------------------------
    if (targetStep === 'all' || targetStep === '05' || targetStep === 'popup') {
      const res = await runTest('05-popup-settings-cache', async () => {
        const page = await context.newPage();
        await page.setViewportSize({ width: 380, height: 600 });
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

        // Switch to settings tab
        await page.click('.nav-tab[data-tab="tab-settings"]');
        await page.waitForTimeout(300);

        const cacheText = await page.textContent('#cacheCountLabel');
        console.log(`Cache display before clear: ${cacheText}`);

        // Click Clear Cache button
        await page.click('#clearCacheBtn');
        await page.waitForTimeout(400);

        const btnText = await page.textContent('#clearCacheBtn');
        console.log(`Clear button feedback: ${btnText}`);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-popup-settings-cache.png') });
        await page.close();
        return { cacheText, btnText };
      });
      results.push(res);
    }

    // ----------------------------------------------------
    // TEST 19: Non-Google Site, Quiet & Harmless
    // ----------------------------------------------------
    if (targetStep === 'all' || targetStep === '19') {
      const res = await runTest('19-non-google-site', async () => {
        const page = await context.newPage();
        const nonGoogleErrors = [];
        page.on('console', msg => {
          if (msg.type() === 'error') nonGoogleErrors.push(msg.text());
        });

        await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        // Check if any sgmb-* elements were injected into example.com
        const injectedCount = await page.evaluate(() => {
          return document.querySelectorAll('[class*="sgmb-"]').length;
        });

        console.log(`Injected SphereGMB elements on example.com: ${injectedCount}`);
        if (injectedCount > 0) {
          throw new Error(`Extension injected ${injectedCount} elements onto non-Google page!`);
        }
        if (nonGoogleErrors.length > 0) {
          throw new Error(`Errors on non-Google page: ${nonGoogleErrors.join(', ')}`);
        }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '19-non-google-site.png') });
        await page.close();
        return { injectedCount, nonGoogleErrors };
      });
      results.push(res);
    }

    console.log('\n========================================');
    console.log('Test Execution Summary:');
    console.log('========================================');
    results.forEach(r => {
      console.log(`[${r.status}] ${r.step}`);
    });

  } finally {
    await cleanup();
  }
}

main().catch(err => {
  console.error('[Runner Fatal Error]', err);
  process.exit(1);
});
