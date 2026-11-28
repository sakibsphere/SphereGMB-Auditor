# Contributing to GBP Sphere

Thanks for helping. Most contributions are one of three things: a Google page changed and a selector broke, a new audit check, or a free integration from the [roadmap](docs/ROADMAP.md).

## Setup

```bash
git clone https://github.com/sakibsphere/GBP-Sphere.git
cd GBP-Sphere
npm install
```

Load the folder at `chrome://extensions` → Developer mode → **Load unpacked**. After editing code, click the reload icon on the extension card **and reload your Google tabs** (old tabs keep the previous script).

## Before opening a pull request

```bash
npm run verify        # ESLint + syntax/manifest check + unit and DOM tests
npm run test:smoke    # optional: real Chromium against live Google Maps
```

All three parts of `verify` must pass. If you changed anything visible, attach a desktop and a phone-width (390 px) screenshot.

## Fixing a broken selector

1. Reproduce on a live page and note the URL.
2. Prefer stable hooks, `data-attrid`, `data-fid`, `data-item-id`, `role`, `aria-label`, URL patterns, over Google's generated class names. If you must use a class, keep the old one as a fallback.
3. Add or adjust a case in `test/test-dom-integration.js` that mirrors the real markup.

## Ground rules

- No paid APIs required for core features. Optional integrations must work with a user-supplied key or a free tier, and the key stays in `chrome.storage.local`.
- No data leaves the browser except requests to Google (and, later, opt-in free APIs listed in the roadmap).
- Audit copy must be factual. Cite Google's documentation for any guideline or number; don't invent statistics.
- UI: inline SVG icons (no emoji as icons), escape every value that comes from a page before inserting HTML.
- Keep permissions minimal; request anything new as an optional permission at the moment it is needed.

## Reporting a bug

Open an issue with the page URL, what you expected, what happened, a screenshot, and any `[GBP Sphere]` lines from the DevTools console.
