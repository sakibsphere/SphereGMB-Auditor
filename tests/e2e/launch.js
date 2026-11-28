/**
 * GBP Sphere: Playwright Extension Launcher & Live Test Harness
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const CLEAN_JUNCTION_PATH = path.join(os.tmpdir(), 'sphere_gmb_ext');

function ensureCleanExtensionPath() {
  // If PROJECT_ROOT has spaces or special chars, Windows Chrome CLI args can break.
  // We maintain a directory junction in temp that points directly to the real project folder.
  if (!fs.existsSync(CLEAN_JUNCTION_PATH)) {
    try {
      execSync(`cmd /c mklink /J "${CLEAN_JUNCTION_PATH}" "${PROJECT_ROOT}"`, { stdio: 'ignore' });
    } catch (e) {
      // Fallback to project root if junction fails
      return PROJECT_ROOT;
    }
  }
  return CLEAN_JUNCTION_PATH;
}

async function launchExtension(options = {}) {
  const { headless = false, viewport = { width: 1366, height: 768 } } = options;
  const extPath = ensureCleanExtensionPath();
  const userDataDir = path.join(os.tmpdir(), `pw_profile_${Date.now()}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: headless,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    viewport: viewport,
    timeout: 30000
  });

  // Track service workers to resolve extension ID
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }

  const swUrl = serviceWorker.url();
  const match = swUrl.match(/chrome-extension:\/\/([a-z0-9]+)\//);
  if (!match) {
    throw new Error(`Failed to extract extension ID from service worker URL: ${swUrl}`);
  }

  const extensionId = match[1];

  return {
    context,
    serviceWorker,
    extensionId,
    extPath,
    cleanup: async () => {
      try {
        await context.close();
      } catch (e) {}
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (e) {}
    }
  };
}

module.exports = {
  launchExtension,
  PROJECT_ROOT,
  ensureCleanExtensionPath
};

if (require.main === module) {
  (async () => {
    try {
      const { extensionId, cleanup } = await launchExtension({ headless: false });
      console.log(`[Launch] Verified! Extension running with ID: ${extensionId}`);
      await cleanup();
      process.exit(0);
    } catch (err) {
      console.error('[Launch] Failed:', err);
      process.exit(1);
    }
  })();
}
