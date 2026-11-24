---
name: selector-maintenance
description: "Fix SphereGMB when Google changes Search or Maps markup: widget missing, categories stuck on Loading, review export stopping early, buttons in the wrong place. Use before editing any DOM selector in content/modules/dom-*.js or review-scraper.js."
---

# Selector maintenance

Google rotates generated class names (e.g. `tAiQdd`, `bwb7ce`, `RVCQse`) every few months. Most "the extension stopped working" reports are a selector that no longer matches.

## 1. Reproduce and measure before editing

```bash
npm run test:smoke                       # Maps place + Search KP, prints widget count, chips, errors
node tests/e2e/live-interactions.js      # clicks every toolbar button on a live Maps place
node tests/e2e/live-trusted-wheel.js     # checks the chrome.debugger wheel still loads more
```

Google Search usually shows a CAPTCHA to automated Chromium. Never try to bypass it (no stealth flags, no solver). Inspect Search in a normal browser session instead and hand the findings back as anonymised markup.

## 2. Find the new markup

In the page console (or an agent's browser tool), dump the element chain instead of guessing:

```js
const chain = (el) => { const out = []; for (let c = el, i = 0; c && i < 8; c = c.parentElement, i++) out.push(`${c.tagName.toLowerCase()}${c.getAttribute('role') ? `[role=${c.getAttribute('role')}]` : ''}.${String(c.className).trim().split(/\s+/).slice(0, 3).join('.')}`); return out.join(' < '); };
chain(document.querySelector('h1'));
```

For lists that lazy-load, test both programmatic scroll and a real wheel. If only the real wheel loads more, the page checks `isTrusted` and only `chrome.debugger` input works (see `background/service-worker.js` → `trustedWheel`).

## 3. Choose selectors in this order

1. URL patterns and IDs: `/maps/place/`, `!1s0x…:0x…`, `data-fid`, `ludocid=`
2. Semantic attributes: `role`, `aria-label`, `data-attrid`, `data-item-id`, `data-review-id`
3. Generated classes, only as the last fallback, and keep the previous class next to the new one

## 4. Lock it in with a test

- Capture the real element with the anonymiser pattern used for `test/fixtures/search-review-card-2026.html` (replace names, text, URLs and IDs; strip `jsaction`, `data-ved`, styles).
- Add a case to `test/test-review-dialog.js` (jsdom, real modules) or `test/test-dom-integration.js`.
- `npm run verify` must pass, then re-run the live script from step 1.

## Rules

- One widget per place panel; nothing mounted outside `div[role="main"]` or the results feed.
- Never ship sample names, counts or scores as fallbacks.
- Escape every value read from the page before inserting HTML.
