/**
 * GBP Sphere: Google Posts analytics (pure, DOM-free).
 * Shared by the content script (post audit) and Node tests.
 *
 * Input: posts as read from Google's "Updates" view: { dateText, text, cta, link, images }.
 * Output: per-post checks plus profile-level stats (cadence, gaps, length, readability,
 * calls to action, keyword use, near-duplicates) and a 0–100 posting score.
 *
 * Guideline sources used for issues:
 * - Post text limit 1,500 characters (Google Business Profile Help, "Create posts").
 * - Google's post content policy discourages phone numbers in the post text; use the Call button.
 */

(function (root) {
  'use strict';

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const DAY = 24 * 60 * 60 * 1000;
  const MAX_CHARS = 1500;

  /** "Nov 16, 2026" | "16 Nov 2026" | "3 days ago" | "a week ago" | "22 hours ago" → Date */
  function parsePostDate(text, now = new Date()) {
    const t = String(text || '').trim().toLowerCase();
    let m = t.match(/^([a-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/);
    if (m && m[1] in MONTHS) return new Date(Date.UTC(+m[3], MONTHS[m[1]], +m[2]));
    m = t.match(/^(\d{1,2}) ([a-z]{3})[a-z]*\.? (\d{4})$/);
    if (m && m[2] in MONTHS) return new Date(Date.UTC(+m[3], MONTHS[m[2]], +m[1]));
    m = t.match(/^(\d+|a|an) (minute|hour|day|week|month|year)s? ago$/);
    if (m) {
      const n = /^an?$/.test(m[1]) ? 1 : parseInt(m[1], 10);
      const unit = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25 }[m[2]];
      return new Date(now.getTime() - n * unit * DAY);
    }
    return null;
  }

  function words(text) {
    return String(text || '').toLowerCase().match(/[a-z0-9À-ɏ']+/g) || [];
  }

  function syllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  /** Flesch reading ease (0–100, higher = easier). English-oriented. */
  function readingEase(text) {
    const w = words(text);
    if (w.length < 5) return null;
    const sentences = Math.max(1, (String(text).match(/[.!?]+(\s|$)/g) || []).length);
    const syl = w.reduce((n, x) => n + syllables(x), 0);
    return Math.round(206.835 - 1.015 * (w.length / sentences) - 84.6 * (syl / w.length));
  }

  function shingles(text, size = 3) {
    const w = words(text);
    const set = new Set();
    for (let i = 0; i + size <= w.length; i++) set.add(w.slice(i, i + size).join(' '));
    return set;
  }

  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  }

  const PHONE_RE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

  function analyzePost(post, ctx = {}) {
    const text = String(post.text || '');
    const w = words(text);
    const lower = text.toLowerCase();
    const category = String(ctx.category || '').toLowerCase();
    const city = String(ctx.city || '').toLowerCase();
    const issues = [];

    if (w.length < 40) issues.push('Short: under 40 words');
    if (text.length > MAX_CHARS) issues.push(`Over Google's ${MAX_CHARS}-character limit`);
    if (!post.cta && !post.link) issues.push('No button or link');
    if (!post.images) issues.push('No image');
    if (PHONE_RE.test(text)) issues.push('Phone number in the text (use the Call button instead)');
    const capsWords = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
    if (w.length && capsWords / w.length > 0.15) issues.push('Too much ALL CAPS');
    if ((text.match(/#\w+/g) || []).length > 5) issues.push('More than 5 hashtags');
    const mentionsCategory = Boolean(category) && category.split(/\s+/).filter((x) => x.length > 3).some((x) => lower.includes(x));
    const mentionsCity = Boolean(city) && lower.includes(city);
    if (category && !mentionsCategory) issues.push('Does not mention the main service');
    if (city && !mentionsCity) issues.push('Does not mention the city');

    return {
      words: w.length,
      chars: text.length,
      readingEase: readingEase(text),
      hasCta: Boolean(post.cta),
      hasLink: Boolean(post.link),
      hasImage: Boolean(post.images),
      mentionsCategory,
      mentionsCity,
      issues
    };
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  function isoDay(d) {
    return d ? d.toISOString().slice(0, 10) : '';
  }

  /**
   * @param {Array<{dateText:string,text:string,cta?:string,link?:string,images?:number}>} posts newest first
   * @param {{category?:string, city?:string}} ctx
   * @param {Date} now
   */
  function analyzePosts(posts, ctx = {}, now = new Date()) {
    const items = (posts || []).map((p) => {
      const date = parsePostDate(p.dateText, now);
      return { ...p, date, iso: isoDay(date), analysis: analyzePost(p, ctx) };
    });
    const dated = items.filter((p) => p.date).sort((a, b) => b.date - a.date);
    const total = items.length;
    if (!total) {
      return { total: 0, posts: [], issues: [], score: 0, monthly: [], grade: 'No posts' };
    }

    const newest = dated[0]?.date || null;
    const oldest = dated[dated.length - 1]?.date || null;
    const gaps = [];
    for (let i = 0; i + 1 < dated.length; i++) gaps.push(Math.round((dated[i].date - dated[i + 1].date) / DAY));
    const yearAgo = new Date(now.getTime() - 365 * DAY);
    const lastYear = dated.filter((p) => p.date >= yearAgo).length;

    // Posts per calendar month for the last 12 months (oldest → newest).
    const monthly = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 7);
      monthly.push({ month: key, count: dated.filter((p) => p.iso.startsWith(key)).length });
    }

    // Near-duplicates: posts sharing ≥ 60% of 3-word phrases with an earlier one.
    const sh = items.map((p) => shingles(p.text));
    let duplicates = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (jaccard(sh[i], sh[j]) >= 0.6) {
          items[j].analysis.issues.push('Near-duplicate of another post');
          duplicates++;
          break;
        }
      }
    }

    const a = items.map((p) => p.analysis);
    const pct = (n) => Math.round((n / total) * 100);
    const wordCounts = a.map((x) => x.words);
    const ease = a.map((x) => x.readingEase).filter((x) => x !== null);
    const ctaMix = {};
    items.forEach((p) => {
      const key = p.cta ? p.cta : p.link ? 'Link only' : 'None';
      ctaMix[key] = (ctaMix[key] || 0) + 1;
    });
    const issueCounts = {};
    a.forEach((x) => x.issues.forEach((i) => { issueCounts[i] = (issueCounts[i] || 0) + 1; }));
    const issues = Object.entries(issueCounts).map(([issue, count]) => ({ issue, count })).sort((x, y) => y.count - x.count);

    const daysSinceLast = newest ? Math.max(0, Math.floor((now - newest) / DAY)) : null;
    // Average over the months the profile has actually been posting (at most the last 12):
    // 30 posts since August is about 8 a month, not 2.5.
    const windowStart = oldest ? Math.max(oldest, now - 365 * DAY) : now - 365 * DAY;
    const activeMonths = Math.min(12, Math.max(1, (now - windowStart) / (30.44 * DAY)));
    const perMonth = Math.round((lastYear / activeMonths) * 10) / 10;
    const stats = {
      total,
      firstDate: isoDay(oldest),
      lastDate: isoDay(newest),
      daysSinceLast,
      spanDays: newest && oldest ? Math.round((newest - oldest) / DAY) : 0,
      lastYear,
      perMonth,
      perMonthMonths: Math.round(activeMonths * 10) / 10,
      medianGapDays: median(gaps),
      longestGapDays: gaps.length ? Math.max(...gaps) : 0,
      avgWords: Math.round(wordCounts.reduce((s, x) => s + x, 0) / total),
      medianWords: median(wordCounts),
      avgReadingEase: ease.length ? Math.round(ease.reduce((s, x) => s + x, 0) / ease.length) : null,
      withImagePct: pct(a.filter((x) => x.hasImage).length),
      withCtaPct: pct(a.filter((x) => x.hasCta || x.hasLink).length),
      mentionsCategoryPct: pct(a.filter((x) => x.mentionsCategory).length),
      mentionsCityPct: pct(a.filter((x) => x.mentionsCity).length),
      duplicates,
      ctaMix
    };

    // Posting score: cadence 40, content 40, consistency 20.
    let score = 0;
    score += daysSinceLast === null ? 0 : daysSinceLast <= 7 ? 20 : daysSinceLast <= 30 ? 12 : daysSinceLast <= 90 ? 5 : 0;
    score += perMonth >= 4 ? 20 : perMonth >= 2 ? 14 : perMonth >= 1 ? 8 : perMonth > 0 ? 3 : 0;
    score += Math.min(10, Math.round(stats.withImagePct / 10));
    score += Math.min(10, Math.round(stats.withCtaPct / 10));
    score += stats.medianWords >= 80 ? 10 : stats.medianWords >= 40 ? 6 : 2;
    score += Math.min(10, Math.round(((stats.mentionsCategoryPct + (ctx.city ? stats.mentionsCityPct : stats.mentionsCategoryPct)) / 2) / 10));
    score += duplicates === 0 ? 10 : duplicates / total < 0.1 ? 6 : 2;
    score += stats.longestGapDays <= 30 ? 10 : stats.longestGapDays <= 90 ? 5 : 0;
    score = Math.max(0, Math.min(100, score));

    return {
      ...stats,
      score,
      grade: score >= 80 ? 'Strong' : score >= 55 ? 'Needs work' : 'Weak',
      monthly,
      issues,
      posts: items.map((p) => ({ dateText: p.dateText, date: p.iso, text: p.text, cta: p.cta || '', link: p.link || '', images: p.images || 0, ...p.analysis }))
    };
  }

  const api = { parsePostDate, analyzePost, analyzePosts, readingEase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbPosts = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
