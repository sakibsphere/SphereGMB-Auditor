---
name: gbp-audit-rules
description: "Rules for GBP Sphere's Google Business Profile audit: scoring weights, which checks exist, and the sourcing standard for any guideline or number shown to users. Use when changing content/modules/audit-engine.js, the Dashboard, Photo/Post audit copy, or adding a new check."
---

# GBP audit rules

## Scoring (content/modules/audit-engine.js)

Weights add up to 100. Each check returns `pass | warn | fail | unknown`. The score is
**earned points / points of the checks that could be verified**: an `unknown` check is shown but
never counts either way.

| Check | Max | Pass condition |
|---|---|---|
| Claimed and verified | 8 | No "Own this business?" prompt in the place data (`[49]`) |
| Primary category | 8 | Any category |
| Secondary categories | 8 | 2+ secondary (1 = 5 pts); Google allows up to 9 additional |
| Business name | 4 | No separators / "best", "cheap", "near me" (keyword stuffing = 1 pt) |
| Address | 6 | Present (missing is `warn`: service-area businesses hide it) |
| Phone | 8 | Present |
| Website | 6 | http(s) URL |
| Website link tracking (UTM) | 2 | `utm_` parameters on the profile link (only when a website exists) |
| Business hours | 8 | Any days listed |
| Holiday hours | 2 | No "X might affect these hours" notice from Google |
| Description | 6 | 250+ chars (1-249 = 3 pts). Google stopped showing owner descriptions publicly in Nov 2026, so absent = `unknown` |
| Photos | 8 | Google's own total 10+ (1-9 = 4) |
| Recent posts | 8 | Latest post within 7 days (30 days = 5, older = 2, none shown = 1) |
| Review volume | 8 | 100+ (25+ = 6, 1+ = 3) |
| Star rating | 6 | 4.5+ (4.0 = 4, 3.5 = 2) |
| Attributes | 4 | 3+ (1-2 = 2) |

`unknown` is for fields Google does not publish or that need the full profile lookup when it
failed. Never score an unloaded or unpublished field as a failure.

## Data sources

- The place request must carry Maps' feature groups (`PLACE_FLAGS` in lib/place-parser.js).
  Without them Google omits the weekly hours for about half of all places, the photo total
  (`[37][1]`) and the latest posts (`[122]`). Verified on 30 live places, Nov 2026.
- Social profiles and "Reviews from the web" exist only in the Google Search panel
  (`data-attrid` "kc:/common/topic:social media presence" and
  "kc:/location/location:third_party_aggregator_ratings"); dom-serp.js reads them.
- Competitors for a single profile: a Google Maps search (`tbm=map`, `mapsSearchUrl` in
  lib/place-parser.js) for the primary category with the map centred on the business's own
  coordinates. Results rank as for someone standing there; each row `[0][1][i][14]` is the same
  place array as a profile lookup (full categories and attributes; no photo total or posts, so
  the top 3 are re-fetched for the audit sheet). Order of use: your own list, this search, the
  results list the Dashboard was opened from, cached profiles.
- Not public anywhere: owner description (since Nov 2026), service areas, products, opening date,
  Q&A. Audit sheets say "Not in public data" for these.

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
