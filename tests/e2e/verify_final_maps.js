const { launchExtension } = require('./launch');

(async () => {
  const { context, page, cleanup } = await launchExtension({
    headless: false,
    viewport: { width: 1366, height: 768 }
  });

  try {
    const testPage = page || await context.newPage();
    const targetUrl = 'https://www.google.com/maps/place/Empire+State+Building/@40.7484405,-73.9856644,17z/data=!4m6!3m5!1s0x89c259a9b3117469:0xd134e199a405a163!8m2!3d40.7484405!4d-73.9856644?hl=en';
    await testPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    try {
      const consent = testPage.locator('button:has-text("Accept all"), button:has-text("I agree")');
      if (await consent.first().isVisible({ timeout: 3000 })) {
        await consent.first().click();
      }
    } catch (e) {}

    // Wait for content script and async category resolution
    await testPage.waitForTimeout(5000);

    const widgetState = await testPage.evaluate(() => {
      const container = document.querySelector('.sgmb-categories-container');
      const chips = Array.from(document.querySelectorAll('.sgmb-chip')).map(c => c.textContent.trim());
      const tai = document.querySelector('.tAiQdd');
      const isNextSibling = tai && container && (container.previousElementSibling === tai || container.parentElement !== tai);
      
      return {
        mounted: !!container,
        parentTag: container?.parentElement?.tagName,
        parentClass: container?.parentElement?.className,
        isBelowTai: isNextSibling,
        chips,
        rect: container ? container.getBoundingClientRect() : null
      };
    });

    console.log('Live Widget State:', JSON.stringify(widgetState, null, 2));
    await testPage.screenshot({ path: 'sphere-gmb/test-results/screenshots/final-verified-maps-widget.png' });
  } finally {
    await cleanup();
  }
})();

