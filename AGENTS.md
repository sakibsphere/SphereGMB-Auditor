# SphereGMB: notes for coding agents

Chrome extension (Manifest V3, plain JavaScript, no build step) that audits Google Business Profiles on Google Search and Maps.

## Before you change anything

- Read the skill that matches the task:
  - `.agents/skills/selector-maintenance/`, Google changed markup, widget/export broke
  - `.agents/skills/gbp-audit-rules/`, scoring, audit checks, any user-facing guideline or number
  - `.agents/skills/release-checklist/`, version bump, packaging, release
- `npm install` once, then `npm run verify` (ESLint + syntax/manifest check + unit, DOM and review-dialog tests). It must pass with zero errors before you hand work back.

## Layout

- `lib/place-parser.js`, parses Google's place-preview JSON; shared by the service worker and tests
- `lib/category-tools.js` (category list, related categories, keyword seeds) and `lib/report-links.js` (research links), pure and unit-tested
- `background/service-worker.js`, profile lookups + cache, audit-tab routing, trusted wheel (`chrome.debugger`) for review export
- `content/modules/`, `dom-maps.js`, `dom-serp.js` adapters; toolbar, audits, exporters, review scraper, `paa.js`, `rank-runner.js` (reads positions in rank-check search tabs)
- `pages/`, extension pages: `report.html` (full profile report) and `rank.html` (bulk rank check), shared `pages.css` / `common.js`
- `test/`, Node tests (vm sandbox, mock DOM, jsdom with real anonymised markup)
- `tests/e2e/`, Playwright scripts against live Google Maps

## Browser testing

Load the extension in Chromium with `node tests/e2e/launch.js` or the `tests/e2e/live-*.js` scripts (Playwright).

Google Search often shows a CAPTCHA to automated browsers. Do not bypass it (no stealth flags, CAPTCHA solvers, or proxies). Verify Search manually and say so in the QA report.

## Hard rules

- Core features must work with no paid API and no key.
- No sample business names, counts or scores in shipped code.
- Inline SVG icons, never emoji; escape all page-derived values before inserting HTML.
- Keep permissions minimal and justify each one in the README.
