# In-depth review and GBP Compass comparison (24 Nov 2026, v1.5.0)

## 1. How this review was done

- **Live tests** in Chromium with the extension loaded (Playwright): the full feature matrix on Google Maps at 1366 px and 390 px, the interaction suite, and axe-core accessibility audits at 1366, 390 and 320 px.
- **Independent code review** by a separate reviewer that did not write the code, over every module, ranked by impact. Each finding was checked against the code before fixing.
- **Real-site checks**: the website audit run against a live business website with its live profile; rank parsing run on a live Local Finder page.
- **Real browser on Google Search**: automated browsers get Google's "verify you're human" page (SphereGMB never tries to get around it), so the Search features were tested in a normal signed-in Brave profile, driven remotely by a browser-automation extension: knowledge panel and local pack widgets, People also ask, review export, photo and post audits, Maps list and place pages, and a real rank check run by the owner. The extension's own pages (report, rank check, popup) cannot be driven that way and are covered by the automated Chromium tests.

## 2. Results

See section 5 for the final numbers.

### Defects found and fixed

| # | Severity | Area | Problem | Fix |
|---|---|---|---|---|
| 1 | High | Service worker | Profile cache never shrank; once storage was full every lookup failed and widgets said "Categories unavailable" | Pruning (expired, cap 800, oldest first) on start-up, install and every 40 writes; cache write can no longer break a lookup |
| 2 | High | Rank check | Each rank search tab also ran the widget scan and fetched a profile for every Local Finder row (about 600 extra requests for 30 keywords) | Rank tabs only read positions |
| 3 | High (found live) | Parser | Google sometimes returns the website as a `/url?q=` redirect; report links and the website check used the redirect | Unwrapped to the real URL |
| 4 | Medium | Security | A crafted link could start an audit (`?sphereGmbAudit=`) or the PAA collector (`?sgmbPaa=`) | One-time code that only SphereGMB creates |
| 5 | Medium | Security | CSV formula injection through review text, names, posts, answers | Cells starting with = + - @ tab CR get an apostrophe in every export |
| 6 | Medium | Performance | Maps results pages re-scanned every 400 ms forever | List bar writes its label only when it changes |
| 7 | Medium | Reliability | PageSpeed ran in the service worker, which Chrome stops after 30 s of waiting | Runs from the report page |
| 8 | Medium | Rank check | Duplicate searches after adding the location; non-Latin locations never added; results that never loaded saved as "not found"; website rank always "None" in Map mode; history mixed between modes; two rank pages mixed targets | All fixed |
| 9 | Medium | Category tools | Suggested categories sharing only the main noun (Chinese restaurant for a Mexican restaurant) | Main-noun-only matches need a shared specific word or the same industry group, and score lower |
| 10 | Medium | Accessibility | Report announced itself to screen readers on every update; review toast lost keyboard focus every tick | Live regions only on status text; toast updated in place |
| 11 | Low | Various | Name match in the middle of another name; non-Latin names never matched; debugger bar could stay after a worker restart; CID from a stray link; "Clear saved data" left reports and history; "Refresh list" wiped keywords; star character instead of SVG; handlers without error replies; a stale end-to-end script | All fixed |

## 3. GBP Compass: what it is and how it works

Sources: gbpcompass.com, its privacy policy and the Facebook reel caption (the video itself needs a Facebook login, so it was not watched). Its code was not available locally and was not downloaded; nothing was copied.

- Chrome **side panel** on Google Maps (Chrome 116+, desktop only).
- Reads the search results and listing data **Google Maps already loaded** on the page instead of sending its own requests.
- **Health score against the top 20** of the current Maps search: categories the top 20 use that the profile does not; reviews, rating, photos and attributes against the typical competitor; issues marked high, medium, low.
- **Checklist** in 11 sections (NAP, categories, services, hours, attributes, photos, reviews, posts, landing page), Pass / Fail / By hand, copy to Google Sheets, PDF report.
- **Entity Match**: reads the landing page (opens it in a background tab) and checks NAP, category and city in title / heading / URL, LocalBusiness schema, hours, map, reviews, link tracking; plus an on-page audit and a broken-link check. Website access is an optional permission.
- **Freemium**: 5 business audits a month free; Pro (unlimited, own logo on reports) announced.

## 4. Side by side

| Capability | GBP Compass | SphereGMB 1.5.0 |
|---|---|---|
| Price | Free for 5 audits a month, Pro planned | Free and unlimited, open source (MIT) |
| Where it works | Google Maps side panel, desktop Chrome only | Google Maps and Google Search (knowledge panel, local pack, Local Finder), plus a full report page; works on any Chromium browser |
| Hidden secondary categories on every listing | Not advertised | Yes, inline on every result |
| Competitor comparison | Top 20 of the Maps search | Same idea: up to 20 from the Maps list, Local Finder or local pack, with fallback to same-category businesses you viewed |
| Prioritised fix list | High / medium / low | High / medium / low, from the audit and the competitor gaps |
| Copy to Google Sheets | Yes | Yes (fix list and checklist) |
| PDF | Yes | Print or PDF from the report page |
| Website "Entity Match" and on-page audit | Yes, background tab, broken-link check | Yes, inert HTML fetch (no page scripts run), robots.txt, sitemap; no broken-link check yet |
| Real Google category list and validation | Not advertised | Yes, about 4,050 categories, related categories, predefined services |
| Keyword finder | No | Google suggestions with city and A to Z |
| Bulk rank check | No | Yes, every category plus custom keywords, history and change |
| Review export | Not advertised | Full CSV with replies, photos, sub-ratings |
| Photo and post audits | Counts in the checklist | Full photo audit with downloads; post cadence, gaps, policy checks |
| People also ask | No | Yes, with levels, country and language |
| Extra requests to Google | None (reads loaded data) | One profile request per listing shown (cached for 24 hours, capped) |
| Brand on the report | Pro feature | Not yet |

**Where SphereGMB is ahead**: coverage (Search and Maps, every listing), free and unlimited, open source, category validation, keyword finder, bulk rank check, review/photo/post depth, People also ask.

**Where GBP Compass is ahead**: it sends no requests of its own to Google (lighter and less likely to be rate-limited), a side panel that stays open while browsing, a broken-link check, and announced white-label reports.

## 5. Final numbers

| Check | Before this review | After (v1.5.0) |
|---|---|---|
| Lint, syntax, unit, DOM, jsdom tests | all passing (but no tests for the issues above) | all passing: 18 unit, 20 DOM, 10 review dialog, 4 rank runner, 3 website check |
| Live feature matrix, desktop 1366 px | 31/31 | 33/33 (adds fix list + Sheets copy, website check, competitor benchmark) |
| Live feature matrix, mobile 390 px | 31/31 | 33/33 |
| Live interaction suite | failing (stale: still expected the old Dashboard drawer) | passing, no page errors |
| axe-core, 1366 / 390 / 320 px | clean | clean, including the new sections |
| Website check on a real business site | n/a | ran on the live site and live profile; found the `/url?q=` website bug, now fixed |
| Rank parsing on a live Local Finder page | ads and positions correct | unchanged, plus stricter name matching |
| Google Search with the extension (Brave) | not tested (CAPTCHA for automation) | tested live: knowledge panel (classic and 2026 layout), local pack, People also ask (9 questions, 2 levels), review export (59 of 59, CSV checked), photo audit, post audit (30 posts), Maps list and place, rank check |
| Issues found live in Brave | n/a | 6, all fixed: widget hidden by the 2026 panel header, "[Highlight]" markers in answers, photo counts, posts per month, ads counted as competitors, chain branches in rank matching |
| Release zip | missing the report and rank pages | complete (42 files); build fails if a loaded file is missing |

## 6. Recommended next steps

1. **Read Maps' own loaded data where possible** (as GBP Compass does) and fall back to the profile request only when needed: fewer requests, less rate-limit risk.
2. **Broken-link check** in the website check (on click, capped, same-site links first).
3. **Own logo and name on the printed report** for agencies (free, stored locally).
4. **Photo and post counts in the competitor benchmark** (needs per-competitor counts, which today require opening each listing).
5. Manual Search check in a normal Chrome profile after each release: People also ask options, a 3 to 5 keyword rank check, review export.
