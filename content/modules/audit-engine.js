/**
 * SphereGMB: Audit Engine
 * Client-side Google Business Profile completeness checks. Pure functions, no DOM access,
 * so they can be unit-tested in Node.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const STUFFING_RE = /\s[-|–\u2014]\s|\b(best|cheap|top rated|#1|near me)\b/i;

  function check(id, label, max, points, status, detail) {
    return { id, label, max, points: Math.max(0, Math.min(max, points)), status, detail };
  }

  /**
   * Returns { score, grade, checks[] }. Each check has status pass | warn | fail | unknown.
   * "unknown" means the field needs the full profile lookup, which hasn't succeeded.
   */
  function audit(data = {}) {
    const d = data || {};
    const known = Boolean(d.profileLoaded);
    const cats = Array.isArray(d.categories) ? d.categories : [];
    const reviews = Number(d.numReviews) || 0;
    const rating = parseFloat(d.rating) || 0;
    const checks = [];

    checks.push(cats.length
      ? check('primary-category', 'Primary category', 10, 10, 'pass', cats[0])
      : check('primary-category', 'Primary category', 10, 0, 'fail', 'No category detected'));

    const secondary = Math.max(0, cats.length - 1);
    if (!known && d.categoriesSource !== 'profile') {
      checks.push(check('secondary-categories', 'Secondary categories', 10, 0, 'unknown', 'Full category list not loaded yet'));
    } else if (secondary >= 2) {
      checks.push(check('secondary-categories', 'Secondary categories', 10, 10, 'pass', `${secondary} secondary categories`));
    } else if (secondary === 1) {
      checks.push(check('secondary-categories', 'Secondary categories', 10, 6, 'warn', 'Only 1 secondary category. Add more that genuinely match your services'));
    } else {
      checks.push(check('secondary-categories', 'Secondary categories', 10, 0, 'fail', 'No secondary categories'));
    }

    const name = String(d.name || '').trim();
    if (!name) checks.push(check('name', 'Business name', 5, 0, 'fail', 'No name detected'));
    else if (STUFFING_RE.test(name)) checks.push(check('name', 'Business name', 5, 2, 'warn', 'Name may contain extra keywords or separators. Google can suspend keyword-stuffed names'));
    else checks.push(check('name', 'Business name', 5, 5, 'pass', name));

    checks.push(d.address
      ? check('address', 'Address', 10, 10, 'pass', d.address)
      : check('address', 'Address', 10, 0, known ? 'warn' : 'unknown', known ? 'No public address (fine for service-area businesses)' : 'Not detected on page'));

    checks.push(d.phone
      ? check('phone', 'Phone number', 10, 10, 'pass', d.phone)
      : check('phone', 'Phone number', 10, 0, known ? 'fail' : 'unknown', known ? 'No phone number listed' : 'Not detected on page'));

    checks.push(/^https?:\/\//i.test(d.website || '')
      ? check('website', 'Website', 10, 10, 'pass', d.websiteDomain || d.website)
      : check('website', 'Website', 10, 0, known ? 'fail' : 'unknown', known ? 'No website linked' : 'Not detected on page'));

    const hours = Array.isArray(d.hours) ? d.hours : [];
    if (hours.length) checks.push(check('hours', 'Opening hours', 10, 10, 'pass', `${hours.length} days listed`));
    else checks.push(check('hours', 'Opening hours', 10, 0, known ? 'fail' : 'unknown', known ? 'No opening hours listed' : 'Needs full profile'));

    const desc = String(d.description || '');
    if (desc.length >= 250) checks.push(check('description', 'Business description', 10, 10, 'pass', `${desc.length} characters`));
    else if (desc.length > 0) checks.push(check('description', 'Business description', 10, 5, 'warn', `Only ${desc.length} characters. Google allows up to 750`));
    else checks.push(check('description', 'Business description', 10, 0, known ? 'fail' : 'unknown', known ? 'No owner-written description' : 'Needs full profile'));

    if (reviews >= 100) checks.push(check('reviews', 'Review volume', 10, 10, 'pass', `${reviews.toLocaleString()} reviews`));
    else if (reviews >= 25) checks.push(check('reviews', 'Review volume', 10, 7, 'warn', `${reviews} reviews. Keep asking every customer`));
    else if (reviews > 0) checks.push(check('reviews', 'Review volume', 10, 3, 'warn', `${reviews} reviews, below most local competitors`));
    else checks.push(check('reviews', 'Review volume', 10, 0, 'fail', 'No reviews detected'));

    if (rating >= 4.5) checks.push(check('rating', 'Star rating', 10, 10, 'pass', `${rating} stars`));
    else if (rating >= 4.0) checks.push(check('rating', 'Star rating', 10, 7, 'warn', `${rating} stars`));
    else if (rating >= 3.5) checks.push(check('rating', 'Star rating', 10, 4, 'warn', `${rating} stars`));
    else if (rating > 0) checks.push(check('rating', 'Star rating', 10, 0, 'fail', `${rating} stars`));
    else checks.push(check('rating', 'Star rating', 10, 0, 'fail', 'No rating'));

    const attrs = Array.isArray(d.attributes) ? d.attributes : [];
    const attrCount = attrs.reduce((n, g) => n + (g.items?.length || 0), 0);
    if (attrCount >= 3) checks.push(check('attributes', 'Attributes', 5, 5, 'pass', `${attrCount} attributes set`));
    else if (attrCount > 0) checks.push(check('attributes', 'Attributes', 5, 3, 'warn', `${attrCount} attribute(s). Add accessibility, payments, amenities`));
    else checks.push(check('attributes', 'Attributes', 5, 0, known ? 'warn' : 'unknown', known ? 'No attributes set' : 'Needs full profile'));

    const score = checks.reduce((sum, c) => sum + c.points, 0);
    const grade = score >= 85 ? 'Strong' : score >= 65 ? 'Needs work' : 'Weak';
    return { score, grade, checks, completenessScore: score };
  }

  ns.auditEngine = {
    audit,
    calculateCompletenessScore(data) {
      return audit(data).score;
    }
  };
})(window.SphereGmb);
