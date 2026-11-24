---
name: gbp-audit-rules
description: "Rules for SphereGMB's Google Business Profile audit: scoring weights, which checks exist, and the sourcing standard for any guideline or number shown to users. Use when changing content/modules/audit-engine.js, the Dashboard, Photo/Post audit copy, or adding a new check."
---

# GBP audit rules

## Scoring (content/modules/audit-engine.js)

Total is 100. Each check returns `pass | warn | fail | unknown`.

| Check | Max | Pass condition |
|---|---|---|
| Primary category | 10 | Any category |
| Secondary categories | 10 | 2+ secondary (1 = 6 pts) |
| Business name | 5 | Present, no separators / "best", "cheap", "near me" (keyword stuffing = 2 pts) |
| Address | 10 | Present (missing is `warn`: service-area businesses hide it) |
| Phone | 10 | Present |
| Website | 10 | http(s) URL |
| Opening hours | 10 | Any days listed |
| Description | 10 | 250+ chars (1–249 = 5 pts; Google allows 750) |
| Review volume | 10 | 100+ (25+ = 7, 1+ = 3) |
| Star rating | 10 | 4.5+ (4.0 = 7, 3.5 = 4) |
| Attributes | 5 | 3+ (1–2 = 3) |

`unknown` is only for fields that need the full profile lookup when it failed. Never score an unloaded field as a failure.

## Adding a check

1. Keep the total at 100, rebalance, don't append.
2. Add a unit test in `test/test-suite.js` (complete profile still scores 100; a thin one fails the new check).
3. The `detail` text tells the owner what to do, in one sentence.

## Sourcing standard for copy

- Numbers and limits must come from Google's own documentation (Business Profile Help, Maps Platform docs) or a dated, named study. Put the source in a code comment next to the string.
- No invented statistics, no "X% more calls" without a citation, no fake benchmark names.
- When Google doesn't expose something publicly (exact photo totals, post history), say so in the UI instead of estimating.

## Current guideline values used in the UI

- Photos: JPG/PNG, 10 KB–5 MB, recommended 720 × 720 px, minimum 250 × 250 px.
- Videos: up to 30 s, 75 MB, 720p or higher.
- Description: up to 750 characters.
- Offer and event posts expire on their end date.
