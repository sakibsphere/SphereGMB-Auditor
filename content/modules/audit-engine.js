/**
 * GBP Sphere: Audit Engine
 * Client-side Google Business Profile checks. Pure functions, no DOM access, so they can be
 * unit-tested in Node and reused by the report page.
 *
 * Scoring rules live in .agents/skills/gbp-audit-rules/SKILL.md. The score is the share of
 * points earned among the checks that could actually be verified: a field Google does not show
 * publicly (for example the owner description) is "unknown" and never costs points.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const STUFFING_RE = /\s[-|–\u2014]\s|\b(best|cheap|top rated|#1|near me)\b/i;
  const DAY = 86400;

  function check(id, label, max, points, status, detail) {
    return { id, label, max, points: status === 'unknown' ? 0 : Math.max(0, Math.min(max, points)), status, detail };
  }

  /** "Mon to Fri 9 AM–6 PM, Sat and Sun Closed" style one-line summary of the hours. */
  function hoursSummary(hours) {
    if (!Array.isArray(hours) || !hours.length) return '';
    const open = hours.filter((h) => !/closed/i.test(h.hours));
    const closed = hours.filter((h) => /closed/i.test(h.hours));
    const same = open.length && open.every((h) => h.hours === open[0].hours);
    if (same) return `${open.length} days ${open[0].hours}${closed.length ? `, closed ${closed.map((h) => h.day.slice(0, 3)).join(', ')}` : ''}`;
    return hours.map((h) => `${h.day.slice(0, 3)} ${h.hours}`).join('; ');
  }

  function daysSince(ts, now) {
    return ts ? Math.floor((now - ts) / DAY) : null;
  }

  /**
   * Returns { score, grade, checks[], verified, total }. Each check has status
   * pass | warn | fail | unknown. "unknown" = not visible publicly or the full profile did not
   * load; it is shown but left out of the score.
   */
  function audit(data = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
    const d = data || {};
    const known = Boolean(d.profileLoaded);
    const cats = Array.isArray(d.categories) ? d.categories : [];
    const reviews = Number(d.numReviews) || 0;
    const rating = parseFloat(d.rating) || 0;
    const checks = [];

    // Ownership: [49] is Google's "Own this business?" prompt (see lib/place-parser.js).
    if (d.claimed === true) checks.push(check('claimed', 'Claimed and verified', 8, 8, 'pass', 'The owner has verified this profile.'));
    else if (d.claimed === false) checks.push(check('claimed', 'Claimed and verified', 8, 0, 'fail', 'Google shows "Own this business?": claim and verify the profile so only the owner can edit it.'));
    else checks.push(check('claimed', 'Claimed and verified', 8, 0, 'unknown', 'Needs the full profile.'));

    checks.push(cats.length
      ? check('primary-category', 'Primary category', 8, 8, 'pass', cats[0])
      : check('primary-category', 'Primary category', 8, 0, 'fail', 'No category detected'));

    // Google allows one primary and up to 9 additional categories
    // (Business Profile Help, "Edit your business category": support.google.com/business/answer/3038177).
    const secondary = Math.max(0, cats.length - 1);
    if (!known && d.categoriesSource !== 'profile') checks.push(check('secondary-categories', 'Secondary categories', 8, 0, 'unknown', 'Full category list not loaded yet'));
    else if (secondary >= 2) checks.push(check('secondary-categories', 'Secondary categories', 8, 8, 'pass', `${secondary} secondary categories (Google allows up to 9)`));
    else if (secondary === 1) checks.push(check('secondary-categories', 'Secondary categories', 8, 5, 'warn', 'Only 1 secondary category. Add more that genuinely match your services (up to 9).'));
    else checks.push(check('secondary-categories', 'Secondary categories', 8, 0, 'fail', 'No secondary categories. Add the ones that match real services (up to 9).'));

    const name = String(d.name || '').trim();
    if (!name) checks.push(check('name', 'Business name', 4, 0, 'fail', 'No name detected'));
    else if (STUFFING_RE.test(name)) checks.push(check('name', 'Business name', 4, 1, 'warn', 'Name may contain extra keywords or separators. Google can suspend keyword-stuffed names.'));
    else checks.push(check('name', 'Business name', 4, 4, 'pass', name));

    checks.push(d.address
      ? check('address', 'Address', 6, 6, 'pass', d.address)
      : check('address', 'Address', 6, 0, known ? 'warn' : 'unknown', known ? 'No public address (fine for service-area businesses)' : 'Not detected on page'));

    checks.push(d.phone
      ? check('phone', 'Phone number', 8, 8, 'pass', d.phone)
      : check('phone', 'Phone number', 8, 0, known ? 'fail' : 'unknown', known ? 'No phone number listed' : 'Not detected on page'));

    const hasSite = /^https?:\/\//i.test(d.website || '');
    checks.push(hasSite
      ? check('website', 'Website', 6, 6, 'pass', d.websiteDomain || d.website)
      : check('website', 'Website', 6, 0, known ? 'fail' : 'unknown', known ? 'No website linked' : 'Not detected on page'));
    if (hasSite) {
      checks.push(/[?&]utm_/i.test(d.website)
        ? check('utm', 'Website link tracking (UTM)', 2, 2, 'pass', 'The profile link carries UTM tags, so its visits show up in analytics.')
        : check('utm', 'Website link tracking (UTM)', 2, 0, 'warn', 'Add utm_source=google&utm_medium=organic&utm_campaign=gbp to the website link to measure profile visits.'));
    }

    const hours = Array.isArray(d.hours) ? d.hours : [];
    if (hours.length) checks.push(check('hours', 'Business hours', 8, 8, 'pass', hoursSummary(hours)));
    else checks.push(check('hours', 'Business hours', 8, 0, known ? 'fail' : 'unknown', known ? 'No business hours on the profile' : 'Needs the full profile'));

    // mergeProfile skips empty lists, so on a loaded profile "missing" means "none".
    const notices = Array.isArray(d.holidayNotices) ? d.holidayNotices : known ? [] : null;
    if (hours.length && notices) {
      checks.push(notices.length
        ? check('holiday-hours', 'Holiday hours', 2, 0, 'warn', `Google warns "${notices.map((n) => n.holiday).join(', ')} might affect these hours": set special hours for ${notices.length === 1 ? 'it' : 'them'}.`)
        : check('holiday-hours', 'Holiday hours', 2, 2, 'pass', 'No unconfirmed holidays coming up.'));
    }

    // Google allows up to 750 characters (Business Profile Help, "Edit your Business Profile").
    // Since Nov 2026 Google does not show owner descriptions publicly, so a missing one is unknown.
    const desc = String(d.description || '');
    if (desc.length >= 250) checks.push(check('description', 'Business description', 6, 6, 'pass', `${desc.length} characters`));
    else if (desc.length > 0) checks.push(check('description', 'Business description', 6, 3, 'warn', `Only ${desc.length} characters. Google allows up to 750.`));
    else checks.push(check('description', 'Business description', 6, 0, 'unknown', 'Google does not show the owner description publicly. Check it in the Business Profile Manager (up to 750 characters).'));

    const photos = typeof d.photoCount === 'number' ? d.photoCount : null;
    if (photos === null) checks.push(check('photos', 'Photos', 8, 0, 'unknown', known ? 'Google did not report a photo count' : 'Needs the full profile'));
    else if (photos >= 10) checks.push(check('photos', 'Photos', 8, 8, 'pass', `${photos.toLocaleString()} photos and videos on Google`));
    else if (photos > 0) checks.push(check('photos', 'Photos', 8, 4, 'warn', `Only ${photos} photos and videos. Add exterior, interior, team and work photos.`));
    else checks.push(check('photos', 'Photos', 8, 0, 'fail', 'No photos on the profile.'));

    // Posts: Google returns the latest ones (up to 10) with their dates.
    const posts = Array.isArray(d.posts) ? d.posts : known ? [] : null;
    if (!known || posts === null) checks.push(check('posts', 'Recent posts', 8, 0, 'unknown', 'Needs the full profile'));
    else if (!posts.length) checks.push(check('posts', 'Recent posts', 8, 1, 'warn', 'No recent posts shown on Google. Post updates or offers at least weekly.'));
    else {
      const age = daysSince(Math.max(...posts.map((p) => p.ts || 0)), nowSeconds);
      const last30 = posts.filter((p) => p.ts && nowSeconds - p.ts <= 30 * DAY).length;
      const detail = `Latest post ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}, ${last30} in the last 30 days.`;
      if (age <= 7) checks.push(check('posts', 'Recent posts', 8, 8, 'pass', detail));
      else if (age <= 30) checks.push(check('posts', 'Recent posts', 8, 5, 'warn', `${detail} Aim for at least one a week.`));
      else checks.push(check('posts', 'Recent posts', 8, 2, 'warn', `${detail} Posting has stopped; restart with weekly updates.`));
    }

    if (reviews >= 100) checks.push(check('reviews', 'Review volume', 8, 8, 'pass', `${reviews.toLocaleString()} reviews`));
    else if (reviews >= 25) checks.push(check('reviews', 'Review volume', 8, 6, 'warn', `${reviews} reviews. Keep asking every customer.`));
    else if (reviews > 0) checks.push(check('reviews', 'Review volume', 8, 3, 'warn', `${reviews} reviews, below most local competitors`));
    else checks.push(check('reviews', 'Review volume', 8, 0, 'fail', 'No reviews detected'));

    if (rating >= 4.5) checks.push(check('rating', 'Star rating', 6, 6, 'pass', `${rating} stars`));
    else if (rating >= 4.0) checks.push(check('rating', 'Star rating', 6, 4, 'warn', `${rating} stars`));
    else if (rating >= 3.5) checks.push(check('rating', 'Star rating', 6, 2, 'warn', `${rating} stars`));
    else if (rating > 0) checks.push(check('rating', 'Star rating', 6, 0, 'fail', `${rating} stars`));
    else checks.push(check('rating', 'Star rating', 6, 0, 'fail', 'No rating'));

    const attrs = Array.isArray(d.attributes) ? d.attributes : [];
    const attrCount = attrs.reduce((n, g) => n + (g.items?.length || 0), 0);
    if (attrCount >= 3) checks.push(check('attributes', 'Attributes', 4, 4, 'pass', `${attrCount} attributes in ${attrs.length} groups`));
    else if (attrCount > 0) checks.push(check('attributes', 'Attributes', 4, 2, 'warn', `${attrCount} attribute(s). Add accessibility, payments, amenities.`));
    else checks.push(check('attributes', 'Attributes', 4, 0, known ? 'warn' : 'unknown', known ? 'No attributes set' : 'Needs the full profile'));

    // Score = earned / verifiable. Checks that could not be verified do not count either way.
    const scored = checks.filter((c) => c.status !== 'unknown');
    const max = scored.reduce((s, c) => s + c.max, 0);
    const earned = scored.reduce((s, c) => s + c.points, 0);
    const score = max ? Math.round((earned / max) * 100) : 0;
    const grade = score >= 85 ? 'Strong' : score >= 65 ? 'Needs work' : 'Weak';
    return { score, grade, checks, completenessScore: score, verified: scored.length, total: checks.length };
  }

  ns.auditEngine = {
    audit,
    hoursSummary,
    calculateCompletenessScore(data) {
      return audit(data).score;
    }
  };
})(window.SphereGmb);
