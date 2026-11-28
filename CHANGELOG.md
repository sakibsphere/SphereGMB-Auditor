# Changelog

## 1.6.1, 2026-11-28

No new permissions.

- **Use GBP Sphere from AI assistants (MCP).** A local MCP server (`mcp/server.js`, no dependencies, no API key) lets Claude, ChatGPT (Codex), Cursor, VS Code and other MCP clients search Google Maps, read full profiles, run the 16-check audit with fix list and competitor benchmark, find local competitors, check Google Maps rankings from the business address, research categories and save the Excel agency audit. `--http` adds a local JSON API and MCP over HTTP on 127.0.0.1. Setup: [docs/MCP.md](docs/MCP.md).
- **New name: GBP Sphere** (was SphereGMB). "GMB" stood for Google My Business, which Google renamed to Google Business Profile. The repository is now github.com/sakibsphere/GBP-Sphere (the old address redirects). The download file name (`sphere-gmb.zip`) stays the same, so old links keep working.
- New logo: a score ring around a map pin, in the toolbar icon, popup, Dashboard and audit badge.
- Media audit downloads now go to `Downloads/GBP-Sphere/`.
- The one-line installer puts new installs in `Downloads/GBP-Sphere-Extension` on Windows, macOS and Linux (it finds a moved or translated Downloads folder). Existing installs in `SphereGMB` in your home folder keep updating in place, so saved data carries on. The Windows installer no longer changes settings in the shell you run it from, and it refuses to empty a folder that is not a GBP Sphere install.
- Fixed: the CID decoder and report links picked the wrong place from a Maps link that came from a search; Clear saved data now also removes saved audit options and custom competitors; rank history keeps the latest check first; anonymous reviews with the same date and rating no longer merge in the CSV export; the speed test can be retried after an error.

## 1.6.0, 2026-11-25

Accurate numbers, a full agency audit you can download, and a free speed test.

New
- **Audit reports** (report page): tick Initial GBP Audit, GBP and Competitor Audit and/or Service List, run, and download them as one Excel workbook (one sheet each, in the agency template layout: purple title and section bands, lavender header, Pass/Fail and Status dropdowns, frozen headers) or as CSV. The competitor sheet compares the business with the top 3 from the same search. Opened from a single profile, it searches Google Maps for the primary category (or a keyword you type) from the business's own address, so you no longer need to start from a results list; the Competitors section shows the business's position there too. Or compare with up to 3 competitors you add yourself: paste a Google Maps link (address bar or Share link), a cid= link or a CID. Your list is saved per business. Optional website checks fill LocalBusiness markup, lead form, phone, offer and social proof.
- **Free website speed test, no API key**: measures the real page in a small window (Largest Contentful Paint, layout shift, server response, load time, page weight) with Google's Core Web Vitals thresholds. Google's PageSpeed lab test stays as a second option. New permission `scripting`, used only for this, on the one site you allow.
- **GBP audit with 16 checks** built from the agency checklist: claimed and verified, UTM tracking on the website link, holiday hours Google has not confirmed, Google's photo total, how recent the latest post is, plus the earlier checks. The score now counts only what can be verified, so nothing Google hides costs points.
- Search panel extras: social profiles and "Reviews from the web" are read when the business is opened on Google Search.

Fixed (wrong numbers)
- **Hours missing for about half of all businesses**: the place request lacked the feature groups Google Maps sends, so Google left out the weekly hours. Verified on 30 live places: hours now read for 30 of 30 (was 15). The same change brings Google's photo total and the latest posts.
- **"No owner description" for everyone**: Google no longer shows owner descriptions publicly. The audit now says so and leaves it out of the score instead of failing every profile.
- **Photo counts that did not match the downloads**: the audit, now **Media Audit**, shows Google's own total ("On Google") separately from the photos and videos actually found, which are exactly what the download buttons save; any gap is explained.

Changed
- "Photo Audit" is now "Media Audit" (it covers photos and videos).
- Media and Post audit results are saved per business and reused in the audit sheets.

## 1.5.0, 2026-11-24

An in-depth review (live tests plus an independent code review) and three features inspired by GBP Compass, built from scratch.

New
- **Competitor benchmark**: Dashboard opened from a Maps results list, the Local Finder or the local pack compares the business with the rest of that search (up to 20): reviews, rating, categories, attributes and description against the typical competitor and the top 3, list position, and categories competitors use that it does not. Without a list, it falls back to businesses with the same primary category you opened before, and says so.
- **Fix list**: failed checks and competitor gaps in one list marked High, Medium or Low; copy for Google Sheets in one click.
- **Website check**: reads the linked page (as inert HTML, scripts never run) and checks name, phone and address against the profile, category and city in title, H1 and URL, LocalBusiness schema agreement, hours, map and reviews, plus on-page basics, robots.txt and sitemap. Asks Chrome for permission to that one site only when you click (`optional_host_permissions`).

Fixed
- Profile cache could grow until storage was full, after which every lookup failed. It is now pruned (expired entries, cap of 800, oldest first) and a failed cache write never breaks a lookup.
- Rank-check search tabs also ran the full widget scan and fetched a profile for every Local Finder row; they now only read positions.
- A crafted link with `?sphereGmbAudit=` or `?sgmbPaa=` could start an audit or the PAA collector. Both now need a one-time code that only SphereGMB creates.
- CSV formula injection: review text, names, posts and answers starting with = + - @ are neutralised in every export.
- Website links that Google returns as `/url?q=` redirects are unwrapped (report links and the website check used the redirect).
- PageSpeed runs from the report page instead of the service worker, which Chrome stops after 30 s of waiting.
- Rank check: keywords de-duplicated after the location is added; results that never loaded are no longer saved as "not found"; website rank only in Web mode; history kept per mode; jobs stored per run so two rank pages don't mix; the open search tab closes if the page is closed; name matching works for non-Latin names and no longer matches a name in the middle of another.
- Related categories no longer suggest businesses that share only the main noun ("Chinese restaurant" for a Mexican restaurant).
- Maps results pages no longer re-scan every 400 ms (the list bar rewrote its label on each scan).
- Review export toast keeps keyboard focus on "Download CSV" while progress updates; the star in the summary is an SVG.
- Report page no longer announces itself to screen readers on every update; "Refresh list" keeps keyword results; custom seeds respect the 10-seed limit and keep non-Latin text.
- Popup "Clear saved data" now clears reports, rank history and the category list too, and shows storage used.
- Service worker: every message handler reports errors; debugger detach survives a worker restart; the CID comes from the feature ID first.
- Stale end-to-end script (live-interactions) updated for the report page.

Found by live testing in a real browser (Brave, signed in, Google Search without CAPTCHA)
- Google's 2026 knowledge panel puts the name and rating in a fixed-height box; the widget inside it hid the business name and was cut off under the photos. It now moves below any box that clips it.
- People also ask answers no longer contain Google's hidden "[Highlight start]" / "[Highlight end]" markers.
- Photo audit counts now match the download buttons (Google's "All" tab can show fewer items than "By owner").
- Post audit "per month" averages over the months the profile has actually posted, not always 12.
- Sponsored (ad) listings are left out of the competitor benchmark and list positions.
- Rank check tells a chain's branches apart: when a result has no ID, its street or phone must match.

Open source and install
- One-command install for Windows (`install.ps1`) and macOS/Linux (`install.sh`), a permanent "latest" zip link, and a release workflow that builds and publishes the zip when a version tag is pushed.
- The release zip was missing the `pages/` folder (report and rank pages); the build now fails if any file the extension loads is missing.
- Personal data removed: local folder paths in the docs, test screenshots (one showed an IP address), and an internal analysis of another extension. `test-results/` is ignored.

## 1.4.0, 2026-11-24

One extension for the whole GBP audit: a full report page, real Google categories, a keyword finder, bulk rank checks and a deeper People also ask collector.

- **Full profile report**: Dashboard now opens a clean, light report page (extension page, printable) instead of the in-page drawer: score ring, every public field with copy buttons, claimed or unclaimed status, Business Profile ID, Place ID, CID, KGMID, booking links, a UTM check on the website link, hours, attributes and the audit checklist. Recent reports are listed in the popup.
- **Research links**: 40+ links built from the profile's IDs, grouped as Google Maps links (review list, review request, knowledge panel, Place ID and CID links, same address, same website, competitors, Local Finder), other maps and directories (Apple Maps, Bing Maps, HERE, OpenStreetMap, Waze, Facebook, Yelp, Foursquare) and website and brand audits (Ads Transparency, Meta Ad Library, Trends, site: index counts by period, PageSpeed, Rich Results, schema validator, robots.txt, sitemap.xml, Open Graph, WHOIS, BuiltWith, Wayback, backlinks, SSL, Safe Browsing).
- **Real Google categories**: categories are checked against Google's current list (about 4,050, downloaded at runtime from community lists, not bundled). "Find more" next to the categories opens related real categories, categories used by competitors you viewed, Google's predefined services and a search over the whole list.
- **Keyword finder**: Google search suggestions for the categories, services and your own seeds, with the city and optional A to Z expansion. Copy, CSV or send to the rank check.
- **Bulk rank check**: SERP Checker and a new Rank check tab in the popup check every category plus custom keywords, optionally with a location added to each. One background search at a time with a pause, Local Finder position (top 20), website position, top competitor, change since the last run, CSV. Stops at Google's "verify you're human" page and never tries to get around it.
- **People also ask**: options first: depth in levels (1 to 4), country and language, and also collect organic results, ads, related searches and autocomplete (optionally A to Z). Each question shows its level; one CSV for everything.
- **Popup**: Rank check tab, recent reports, a quiet looping animation on the logo and header (off with reduced motion).
- Place parser reads Business Profile ID, claimed status and booking links. Profile cache moved to a new key so older entries refresh.
- No em dashes anywhere in the UI, docs or code.

## 1.3.1, 2026-11-24

UI and code checked item by item against 18 public UI/UX and "vibe-coded app" checklists; results in `docs/UI_CHECKLIST_AUDIT.md`. axe-core reports 0 violations in light and dark at 1366, 390 and 320 px.

- Drawers behave as real dialogs: focus moves in, Tab stays inside, Escape closes, focus returns to the button that opened them.
- Dashboard and popup tabs follow the WAI-ARIA tabs pattern (selected state, arrow keys).
- Checklist status shown with distinct icons and words, not color alone.
- Dark-mode accent now meets 4.5:1 contrast (palette Soft Lilac).
- Type scale tokens; 16 px body text on phones; controls grow with enlarged text; 44 px touch targets on touchscreens.
- Error states with "Try again" for photo, post and People also ask audits; "Saved …" confirmations after exports; no duplicate runs on double click; toasts pause while hovered or focused.
- Popup redesigned on the same design tokens, with visible field labels and API-key format check.
- Profile lookups retry on network errors, 429 and 5xx; service worker ignores messages from outside the extension.
- `docs/GOOGLE_DEPENDENCIES.md` lists every Google surface SphereGMB relies on.

## 1.3.0, 2026-11-24

- **New permission: `downloads`**, saves photos and videos from the photo audit into `Downloads/SphereGMB/<business>/`.
- **New look**: one design system for everything SphereGMB adds to Google: an amethyst rule on the left of each block, a completeness score pill next to the categories, an even button grid, and a right-side inspector drawer (Dashboard, audits) instead of centered pop-ups. Follows Google's light or dark theme.
- **Photo audit, for real**: opens "See photos", walks every category (All, Latest, By owner, Videos, Exterior…) and counts photos and videos per category, owner vs customer uploads. Download all photos at original size and all videos as MP4.
- **Post audit, for real**: reads every post in the Updates view (not just the few on the panel), expands each to full text, and reports first and latest post, posts per month, gaps, length, reading ease, image/button use, service and city mentions, near-duplicates and policy issues (phone numbers in text, over 1,500 characters). Posts CSV. Optional suggestions from Chrome's built-in on-device AI when available.
- **People also ask collector** (Google Search results only): opens questions until Google stops adding more, groups them by type, lists answers and quoted sites, exports CSV.
- **Review export details**: multi-paragraph reviews keep their line breaks; sub-ratings (Food/Service/Atmosphere), visit details (meal, price), Q&A answers, review photos (links + captions), likes, Local Guide status and reviewer counts are separate CSV columns instead of being mixed into the text.
- On Maps, Photo and Post audits open a Google Search tab and run there (like Review Audit).

## 1.2.2, 2026-11-24

- **Review export collects every review again** (it stopped after 10–20). Google loads the next page only when a real wheel moves the list into its last few hundred pixels; each step now jumps near the end and sends one trusted wheel. Verified live: 10 → 20 → 30 → 40 → 50 → 59.
- Assisted mode keeps its "scroll to load more" instruction on screen.
- Maps result-card buttons are clickable; local-pack rows get feature IDs and categories.
- **Export list** button on Google Maps results: one CSV with every business in the list (full profile per row).
- Review export now shows a summary when it finishes (average rating, star distribution, owner-reply rate) and adds it to the CSV.
- Dashboard: optional free website speed check (Google PageSpeed Insights, mobile).
- Contributor tooling: maintenance guides (`.agents/skills/`), GitHub Actions CI, issue templates, `npm run package`.

## 1.2.1, 2026-11-19

- **New permission: `debugger`.** Google's reviews dialog only loads more reviews on a real mouse-wheel event, so review export now scrolls through `chrome.debugger` and detaches when done. Chrome shows a "started debugging" bar during the export; Cancel switches to assisted mode.
- Review export no longer stops after the first page.
- Parser for Google's 2026 review cards: full text, star count, owner reply and date, review ID.

## 1.2.0, 2026-11-19

- Full profile data (all categories, phone, hours, description, attributes, IDs) from Google's place data; 26-column profile CSV.
- Dashboard with 11 weighted checks.
- Content scripts limited to Google Search and Maps (previously ran on Gmail, Docs, Drive).
- Fixed: review export crash and lock, stray Maps widgets, repeated automated downloads, Post/Photo Audit opening extra tabs, hardcoded sample data.
