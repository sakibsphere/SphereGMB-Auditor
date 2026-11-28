/**
 * GBP Sphere: competitor benchmark and prioritised fix list.
 *
 * benchmark(target, peers) compares one profile with the other businesses in the same search
 * (Maps results list, Local Finder or local pack, up to 20). fixList(audit, bench, target)
 * turns the audit checks and the benchmark gaps into one list ordered High, Medium, Low.
 *
 * Pure functions, no DOM, so the Node tests can load them.
 */

(function (root) {
  'use strict';

  function norm(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function median(values) {
    const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function attrCount(p) {
    return (p.attributes || []).reduce((n, g) => n + ((g && g.items && g.items.length) || 0), 0);
  }

  function sameBusiness(a, b) {
    if (a.featureId && b.featureId) return a.featureId === b.featureId;
    if (a.placeCID && b.placeCID) return String(a.placeCID) === String(b.placeCID);
    return norm(a.name) && norm(a.name) === norm(b.name);
  }

  /** Numbers we compare, per profile. Missing data stays null (not counted as zero). */
  function metricsOf(p) {
    const loaded = Boolean(p.profileLoaded);
    return {
      reviews: typeof p.numReviews === 'number' ? p.numReviews : null,
      rating: typeof p.rating === 'number' ? p.rating : (parseFloat(p.rating) || null),
      categories: loaded || (p.categories || []).length > 1 ? (p.categories || []).length : null,
      attributes: loaded ? attrCount(p) : null,
      description: loaded ? String(p.description || '').length : null
    };
  }

  /**
   * target: the audited profile; peers: other profiles from the same results (target may be
   * among them, it is removed). Returns null when there are fewer than 3 usable peers.
   */
  function benchmark(target = {}, peers = [], { keyword = '' } = {}) {
    const position = peers.findIndex((p) => sameBusiness(p, target));
    const others = peers.filter((p) => p && !sameBusiness(p, target)).slice(0, 20);
    if (others.length < 3) return null;

    const you = metricsOf(target);
    const rows = [
      { key: 'reviews', label: 'Reviews', higherIsBetter: true, digits: 0 },
      { key: 'rating', label: 'Rating', higherIsBetter: true, digits: 1 },
      { key: 'categories', label: 'Categories', higherIsBetter: true, digits: 0 },
      { key: 'attributes', label: 'Attributes', higherIsBetter: true, digits: 0 },
      { key: 'description', label: 'Description length', higherIsBetter: true, digits: 0 }
    ].map((r) => {
      const values = others.map((p) => metricsOf(p)[r.key]);
      const med = median(values);
      const topValues = others.slice(0, 3).map((p) => metricsOf(p)[r.key]).filter((x) => x !== null);
      const top = topValues.length ? topValues.reduce((a, b) => a + b, 0) / topValues.length : null;
      const v = you[r.key];
      let verdict = 'unknown';
      if (v !== null && med !== null) {
        const tolerance = r.key === 'rating' ? 0.1 : Math.max(1, med * 0.1);
        verdict = v > med + tolerance ? 'ahead' : v < med - tolerance ? 'behind' : 'even';
      }
      return { ...r, you: v, median: med, top3: top, samples: values.filter((x) => x !== null).length, verdict };
    }).filter((r) => r.samples >= 3);

    const share = (fn) => {
      const known = others.filter((p) => p.profileLoaded || p.website !== undefined);
      return known.length ? known.filter(fn).length / known.length : null;
    };

    // Categories the competitors use that the target does not.
    const own = new Set((target.categories || []).map(norm));
    const counts = new Map();
    const withCats = others.filter((p) => (p.categories || []).length);
    for (const p of withCats) {
      for (const c of new Set(p.categories)) {
        if (own.has(norm(c))) continue;
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }
    const missingCategories = Array.from(counts, ([name, count]) => ({ name, count, share: count / withCats.length }))
      .filter((c) => c.count >= 2)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 15);

    return {
      keyword,
      peers: others.length,
      position: position >= 0 ? position + 1 : null,
      rows,
      websiteShare: share((p) => /^https?:\/\//.test(p.website || '')),
      descriptionShare: share((p) => String(p.description || '').length > 0),
      missingCategories,
      leaders: others.slice(0, 3).map((p) => ({ name: p.name, reviews: p.numReviews ?? null, rating: p.rating ?? null, categories: (p.categories || []).length }))
    };
  }

  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  const HIGH_CHECKS = new Set(['claimed', 'primary-category', 'phone', 'website', 'hours']);

  /** One ordered list of issues: [{ priority, title, detail, source }]. */
  function fixList(audit, bench, target = {}) {
    const out = [];
    const add = (priority, title, detail, source) => out.push({ priority, title, detail, source });

    for (const c of (audit && audit.checks) || []) {
      if (c.status === 'pass' || c.status === 'unknown') continue;
      let priority = c.status === 'fail' ? (HIGH_CHECKS.has(c.id) ? 'high' : 'medium') : 'low';
      if (c.id === 'reviews' && c.status === 'fail') priority = 'high';
      if (c.id === 'rating' && c.status === 'fail') priority = 'high';
      if (c.id === 'secondary-categories' && c.status === 'fail') priority = 'medium';
      add(priority, c.label, c.detail, 'Profile');
    }

    // An unclaimed profile is already a failed 'claimed' check from the audit engine.
    if (target.claimed === false && !((audit && audit.checks) || []).some((c) => c.id === 'claimed')) add('high', 'Profile is unclaimed', 'Anyone can suggest edits and the owner cannot reply to reviews. Claim and verify it.', 'Profile');

    if (bench) {
      const row = (k) => bench.rows.find((r) => r.key === k);
      const reviews = row('reviews');
      if (reviews && reviews.verdict === 'behind' && reviews.median) {
        const gap = Math.round(reviews.median - (reviews.you || 0));
        add(reviews.you < reviews.median * 0.5 ? 'high' : 'medium', 'Fewer reviews than competitors',
          `${reviews.you ?? 0} reviews against a typical ${Math.round(reviews.median)} in this search: about ${gap} to close the gap.`, 'Competitors');
      }
      const rating = row('rating');
      if (rating && rating.verdict === 'behind' && rating.median) {
        add(rating.median - (rating.you || 0) >= 0.3 ? 'medium' : 'low', 'Lower rating than competitors',
          `${rating.you ?? 'No'} stars against a typical ${rating.median.toFixed(1)}. Reply to reviews and ask happy customers.`, 'Competitors');
      }
      const cats = row('categories');
      if (cats && cats.verdict === 'behind') {
        add('medium', 'Fewer categories than competitors', `${cats.you} against a typical ${Math.round(cats.median)}.`, 'Competitors');
      }
      const attrs = row('attributes');
      if (attrs && attrs.verdict === 'behind') {
        add('low', 'Fewer attributes than competitors', `${attrs.you} against a typical ${Math.round(attrs.median)}.`, 'Competitors');
      }
      for (const c of bench.missingCategories.slice(0, 6)) {
        const pct = Math.round(c.share * 100);
        add(c.share >= 0.5 ? 'high' : c.share >= 0.25 ? 'medium' : 'low', `Consider the category "${c.name}"`,
          `${c.count} of ${bench.peers} competitors in this search use it (${pct}%). Add it only if it describes the business.`, 'Competitors');
      }
    }

    if (/^https?:\/\//i.test(target.website || '') && !/[?&]utm_/i.test(target.website) && !((audit && audit.checks) || []).some((c) => c.id === 'utm')) {
      add('low', 'Website link has no UTM tags', 'Add utm_source=google&utm_medium=organic&utm_campaign=gbp so profile visits show up in analytics.', 'Website');
    }

    return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  const api = { benchmark, fixList, median, sameBusiness };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbBenchmark = api;
})(typeof self !== 'undefined' ? self : globalThis);
