# UI & code checklist audit, v1.3.1 (2026-11-24)

The checklist combines 18 public UI/UX and "vibe-coded app" checklists (sources at the end). Items that only apply to websites (SEO, hero sections, logins, databases, payments, hosting, hiring, tool lists) were dropped. Each item below was checked against GBP Sphere's in-page widget, inspector drawer, toasts and popup.

**How it was measured:** `node tests/e2e/ui-audit.js` (axe-core 4.10 with WCAG 2.2 A/AA + best-practice rules, scoped to GBP Sphere's own UI, light and dark themes, at 1366, 390 and 320 px), plus keyboard, focus and target-size checks in the same script. Also `npm run verify` and `npm run test:full` / `test:full:mobile`.

**Result:** 0 axe violations in widget, drawer and popup, light and dark, at all three widths. Full feature matrix 26/26 at desktop and mobile.

Status: **Pass** (already met) · **Fixed** (failed, fixed in v1.3.1) · **Partly** · **Open** · **N/A**

## Accessibility
| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Real buttons/links, no clickable divs | Pass | All controls are `<button>`/`<a>` |
| 2 | Headings, lists, tables, labels, landmarks | Fixed | Popup inputs had no labels; tab panels moved off `<main>` |
| 3 | Icon-only controls have names | Pass | Close buttons, score pill have `aria-label` |
| 4 | Decorative icons hidden; meaningful images described | Fixed | Popup SVGs now `aria-hidden` |
| 5 | Status never by color alone | Fixed | Checklist rows: distinct icons (check/alert/cross/dash) + visible "Pass/Improve/Missing/Not checked" |
| 6 | Async status announced (role=status) | Fixed | Toasts and drawer progress lines are live regions |
| 7 | WCAG AA with automated + manual + screen reader | Partly | Automated + keyboard checks pass; no screen-reader session was run |
| 8 | Plain language | Pass | Sentence case, plain verbs |

## Keyboard & focus
| # | Item | Status | Notes |
|---|---|---|---|
| 9 | Everything usable by keyboard | Fixed | Drawer tabs now support Arrow/Home/End; popup tabs too |
| 10 | Logical tab order | Pass | |
| 11 | Visible focus indicator | Fixed | Google's CSS replaced our ring with teal; now orchid 2 px, enforced |
| 12 | Focus indicator ≥ 3:1 | Pass | Orchid on white 5.2:1, Pale Orchid on dark surface > 9:1 |
| 13 | No keyboard trap; Escape exits | Fixed | Drawers are now proper modals: focus in, Tab contained, Escape closes, focus returns to the opener |
| 14 | Focus not hidden by sticky UI | Pass | Drawer footer is outside the scroll area |
| 15 | Keyboard shortcuts | Open | None added (optional) |

## Color & contrast
| # | Item | Status | Notes |
|---|---|---|---|
| 16 | Text 4.5:1 / large 3:1 | Fixed | Dark-mode accent `#A35BD6` was 4.18:1; now palette Soft Lilac `#BB74E2` (5.6:1) |
| 17 | UI components 3:1 | Pass | axe clean |
| 18 | Measured on real backgrounds, per screen | Pass | axe on rendered widget/drawer/popup, light + dark |
| 19 | Pastels/transparency audited | Pass | Chips, tints, stat strips covered by axe |
| 20 | Error color paired with text/icon | Pass | |
| 21 | 5–6 named colors as variables | Pass | Amethyst tokens |

## Typography
| # | Item | Status | Notes |
|---|---|---|---|
| 22 | One type family, scale as variables | Fixed | 14 scattered sizes → 6 tokens (`--sgmb-fs-*`) |
| 23 | Body ≥ 16 px on phones | Fixed | Drawer body 16 px under 560 px |
| 24 | 45–75 characters per line | Pass | 480 px drawer |
| 25 | 200% zoom without loss | Pass | Reflow verified at 320 px |
| 26 | Survives text-spacing overrides | Fixed | Fixed control heights → `min-height` |
| 27 | Consistent fonts, correct copy | Pass | |

## Layout & responsive
| # | Item | Status | Notes |
|---|---|---|---|
| 28 | No horizontal scroll | Pass | Checked at 1366/390/320; long table values now wrap |
| 29 | Reflow at 320 px | Pass | |
| 30 | Fluid layout | Pass | Grid with `auto-fit`, `min()` widths |
| 31 | Drawer fits; fixed parts don't cover content | Pass | |
| 32 | Spacing and radius from one scale | Partly | Radius consistent; spacing values not yet tokenised |
| 33 | Grouping, hierarchy, not everything centered | Pass | |
| 34 | Clickable things look clickable, hover states | Pass | |
| 35 | Tested across sizes and themes | Pass | 3 widths × light/dark |
| 36 | Unknowns recorded, re-check after fixes | Pass | This document; audit re-run after fixes |

## Touch targets
| # | Item | Status | Notes |
|---|---|---|---|
| 37 | ≥ 24 px (44 recommended) | Fixed | All ≥ 24 px; 44 px on touchscreens (`pointer: coarse`) |
| 38 | Hit area via padding | Pass | |
| 39 | Spacing between targets | Pass | 6 px gaps |
| 40 | Nothing hover-only | Pass | Tooltips are extra, not required |

## States
| # | Item | Status | Notes |
|---|---|---|---|
| 41 | Loading/empty/error/success designed | Fixed | Photo/Post/PAA now have error states; PAA empty state |
| 42 | No endless loading; retry | Fixed | Errors show "Try again" |
| 43 | Long work async with progress | Fixed | Fake 35% bar replaced with honest indeterminate bar (static when reduced motion) |
| 44 | Errors say what and how to fix | Pass | |
| 45 | No raw stack traces | Pass | Details go to console only |
| 46 | Success confirmations | Fixed | "Saved …" toast after every CSV export |
| 47 | Friendly not-found states | Pass | |
| 48 | Double clicks don't duplicate work | Fixed | Toolbar buttons are busy-locked; audits guard re-entry |
| 49 | Recoverable errors | Pass | |
| 50 | Persistent input labels + hint | Fixed | Popup decoder and API-key fields |
| 51 | Inline validation | Fixed | API key format checked as you type; decoder marks invalid input |
| 52 | Edge-case testing | Partly | Long text, odd characters covered in unit tests; offline not tested |
| 53 | Toasts give enough time | Fixed | ≥ 5 s and pause while hovered/focused; summaries stay until closed |

## Motion
| # | Item | Status | Notes |
|---|---|---|---|
| 54 | Respect reduced motion | Pass | |
| 55 | Motion only for change | Pass | Drawer open only |
| 56 | No flashing | Pass | |
| 57 | Timing tokens | Fixed | `--sgmb-ease`, `--sgmb-dur` |

## Copy
| # | Item | Status | Notes |
|---|---|---|---|
| 58 | Descriptive labels | Fixed | Popup "Clear saved data", "Show GBP Sphere on Google" |
| 59 | No placeholders or unsourced numbers | Pass | Regression test guards it |
| 60 | No dead controls | Fixed | Popup Maps link had `href="#"` |
| 61 | Consistent tone | Pass | |

## Design system
| # | Item | Status | Notes |
|---|---|---|---|
| 62 | Tokens for color/type/radius | Fixed | Type scale added |
| 63 | System covers all components | Pass | |
| 64 | Consistent across widget, drawer, popup | Fixed | Popup redesigned on the same tokens and signature |
| 65 | SVG icons, no emoji | Pass | |
| 66 | Active tab clearly styled | Pass | |
| 67 | Nielsen heuristics review | Open | Not done formally |

## Performance
| # | Item | Status | Notes |
|---|---|---|---|
| 68 | Fast UI | Pass | Widget mounts with DOM data immediately |
| 69 | Compressed, lazy images | Pass | Drawer thumbnails `loading="lazy"` |
| 70 | Cache repeated work | Pass | 24 h profile cache, in-flight de-duplication |
| 71 | Retries with backoff | Fixed | Profile lookups retry network/429/5xx (0.8 s, 2 s) |

## Security & privacy
| # | Item | Status | Notes |
|---|---|---|---|
| 72 | No secrets in code or history | Pass | Pattern scan of tracked files and git history: none |
| 73 | Validate external payloads | Fixed | Service worker rejects messages not from the extension; IDs, URLs, coordinates validated |
| 74 | Safe HTML output | Pass | Every interpolated page value goes through `escapeHtml`; links http(s) only; no `eval` |
| 75 | Least privilege | Pass | storage, debugger, downloads, google.com, each justified in README |
| 76 | Data use documented | Pass | README permissions and privacy |
| 77 | Fail closed | Pass | |
| 78 | No secrets in logs | Pass | API key never logged |
| 79 | Lockfile, scanned dependencies | Pass | Dev-only deps; `npm audit` 0 vulnerabilities |
| 80 | Human review of AI code | Pass | Live verification found and fixed bugs AI-written code had |

## Code quality
| # | Item | Status | Notes |
|---|---|---|---|
| 81 | Lint and checks pass | Pass | |
| 82 | Files under 400 lines | Open | `review-scraper.js` and `content.css` are larger |
| 83 | Tests, coverage target | Partly | 40 unit/DOM tests + live suites; coverage not measured |
| 84 | Code review | Pass | `/code-review`, CI |
| 85 | JSDoc, changelog | Partly | Changelog yes; JSDoc on most, not all, functions |
| 86 | Fresh clone works from README | Pass | |
| 87 | Errors logged | Pass | `[GBP Sphere]` console prefix |
| 88 | External dependencies listed | Fixed | `docs/GOOGLE_DEPENDENCIES.md` |

**Open items:** keyboard shortcuts (15), spacing tokens (32), Nielsen review (67), files over 400 lines (82), coverage measurement (83), full JSDoc (85), screen-reader session (7), offline testing (52).

## Sources
wapsolution.com UI/UX checklist 2026 · pixlogix.com website UI/UX checklist · innowinkagency.com accessibility best practices 2026 · ein-des-ein.com UX/UI checklist 2026 · LinkedIn "My 2026 UI/UX checklist" · awesomic.com UI/UX tools · leadzo.co.in hiring checklist (nothing applicable) · mydesignaudit.com UX audit checklist · capiproduct.com responsive UX audit · standoutmcp.io vibe-coded launch checklist · vibebridge.dev UI quality checklist (no content returned) · aimeeqdevlin.com vibe-coded checklist (SEO only) · fourmeta.com vibe-coding security checklist · dev.to vibe-coding checklist · Reddit r/webdev open-source security checklist (could not be read) · vibecodesource.com deployment checklist · aboveyellow.com premium vibe-coded sites · infinisynapse.com vibe-coding checklist.
