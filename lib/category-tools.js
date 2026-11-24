/**
 * SphereGMB: category library and keyword helpers.
 *
 * The extension does not ship a copy of Google's category list. When the user opens the
 * category tools, the service worker downloads two public community datasets into this
 * browser (see README, "Category data"), and these pure functions work on them:
 *
 *   - parseCsv / buildLibrary: compact the CSVs into { categories, services }
 *   - findCategory: is a name a current Google category (by name or alternate name)?
 *   - relatedCategories: real categories close to the business's own, scored by shared
 *     words, shared main noun and industry group (original heuristic, no AI)
 *   - coOccurring: categories that competitors with the same category also use
 *   - keywordSeeds: search phrases built from categories, services and the city
 *
 * DOM-free so the Node tests can load it.
 */

(function (root) {
  'use strict';

  // Words too common to say two categories are related on their own.
  const GENERIC = new Set([
    'service', 'services', 'store', 'shop', 'company', 'center', 'centre', 'agency', 'contractor',
    'supplier', 'dealer', 'office', 'and', 'of', 'the', 'for', 'a', 'an', 'in', 'or', 'with', 'place',
    'business', 'establishment', 'organization', 'association', 'consultant', 'wholesaler',
    'manufacturer', 'repair', 'school', 'club', 'restaurant', 'shop', 'station'
  ]);

  /** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const s = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field);
        if (row.some((f) => f !== '')) rows.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
    return rows;
  }

  function toObjects(rows) {
    const [head, ...body] = rows;
    if (!head) return [];
    return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()])));
  }

  /**
   * categoriesCsv columns: gcid, category, group, in_us, us_businesses, world_businesses, other_names
   * servicesCsv columns:   gcid, category, service_type_id, service
   */
  function buildLibrary(categoriesCsv, servicesCsv = '') {
    const categories = toObjects(parseCsv(categoriesCsv))
      .filter((r) => r.gcid && r.category)
      .map((r) => ({
        id: r.gcid,
        name: r.category,
        group: r.group || '',
        us: Number(r.us_businesses) || 0,
        world: Number(r.world_businesses) || 0,
        alt: r.other_names ? r.other_names.split(/\s*[;|]\s*/).filter(Boolean) : []
      }));
    const services = {};
    for (const r of toObjects(parseCsv(servicesCsv))) {
      if (!r.gcid || !r.service) continue;
      (services[r.gcid] = services[r.gcid] || []).push(r.service);
    }
    return { categories, services, count: categories.length };
  }

  function norm(v) {
    return String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Crude stem so dentist/dental and plumber/plumbing meet: strip a suffix, keep 4+ chars. */
  function stem(t) {
    const base = t.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1');
    const cut = base.replace(/(ing|ist|ists|er|ers|al|ian|ics|ic|ry|ery|y)$/, '');
    return cut.length >= 4 ? cut : base;
  }

  function tokens(v) {
    return norm(v).split(' ').filter((t) => t && !GENERIC.has(t)).map(stem);
  }

  /** Main noun: last word ("Cosmetic dentist" -> dentist, "Mexican restaurant" -> restaurant). */
  function head(v) {
    const t = norm(v).split(' ').filter((x) => x && !['and', 'of', 'the', 'for'].includes(x));
    return t.length ? stem(t[t.length - 1]) : '';
  }

  function findCategory(lib, name) {
    const n = norm(name);
    if (!lib || !n) return null;
    return lib.categories.find((c) => norm(c.name) === n) || lib.categories.find((c) => c.alt.some((a) => norm(a) === n)) || null;
  }

  /**
   * Real Google categories related to `businessCategories`, best first.
   * Returns [{ id, name, group, us, score, reasons[] }].
   */
  function relatedCategories(lib, businessCategories, { limit = 40 } = {}) {
    if (!lib || !Array.isArray(lib.categories)) return [];
    const own = (businessCategories || []).map((c) => findCategory(lib, c) || { name: c, group: '' });
    const ownNames = new Set(own.map((c) => norm(c.name)));
    const ownTokens = new Set(own.flatMap((c) => tokens(c.name)));
    const ownHeads = new Set(own.map((c) => head(c.name)).filter(Boolean));
    const groups = new Set(own.map((c) => c.group).filter(Boolean));
    const primaryGroup = own[0]?.group || '';

    const out = [];
    for (const c of lib.categories) {
      if (ownNames.has(norm(c.name))) continue;
      const t = tokens(c.name);
      const shared = t.filter((x) => ownTokens.has(x));
      const h = head(c.name);
      const sameHead = ownHeads.has(h);
      // Sharing only the main noun is weak evidence ("Mexican restaurant" and "Chinese
      // restaurant" are different businesses): such a candidate must also share a specific
      // word, or be the bare noun itself ("Restaurant"), or (for specific nouns such as
      // "dentist") sit in the same industry group, and it scores lower than a shared word.
      const genericHead = GENERIC.has(norm(c.name).split(' ').pop());
      const bare = t.length <= 1 && norm(c.name).split(' ').length <= 1;
      const headOnly = sameHead && !shared.filter((x) => x !== h).length;
      if (!shared.length && !sameHead) continue;
      if (headOnly && genericHead && !bare) continue;
      if (headOnly && !genericHead && c.group !== primaryGroup) continue;
      const reasons = [];
      let score = 0;
      if (sameHead) { score += headOnly ? 3 : 6; reasons.push('same type of business'); }
      // The main noun is already counted above; only other shared words add here.
      const specific = [...new Set(shared.filter((x) => x !== h))];
      if (specific.length) { score += 3 * specific.length; reasons.push(`shares "${specific.join(', ')}"`); }
      if (c.group && c.group === primaryGroup) { score += 2; reasons.push(c.group); }
      else if (c.group && groups.has(c.group)) score += 1;
      else if (primaryGroup && c.group && c.group !== primaryGroup) score -= 2;
      score += Math.log10(c.us + 1) * 0.6;
      if (score >= 4) out.push({ id: c.id, name: c.name, group: c.group, us: c.us, score: Math.round(score * 10) / 10, reasons });
    }
    return out.sort((a, b) => b.score - a.score || b.us - a.us).slice(0, limit);
  }

  /**
   * Categories used by other profiles that share at least one category with the business.
   * profiles: [{ name, categories[] }] (e.g. the extension's own profile cache).
   */
  function coOccurring(profiles, businessCategories, { limit = 25 } = {}) {
    const own = new Set((businessCategories || []).map(norm));
    const counts = new Map();
    let peers = 0;
    for (const p of profiles || []) {
      const cats = (p.categories || []).map(String);
      if (!cats.some((c) => own.has(norm(c)))) continue;
      peers++;
      for (const c of new Set(cats)) {
        if (own.has(norm(c))) continue;
        counts.set(c, (counts.get(c) || 0) + 1);
      }
    }
    const list = Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit);
    return { peers, list };
  }

  /** Google's predefined services for the given categories, de-duplicated. */
  function servicesFor(lib, businessCategories) {
    const seen = new Set();
    const out = [];
    for (const name of businessCategories || []) {
      const cat = findCategory(lib, name);
      for (const s of (cat && lib.services[cat.id]) || []) {
        const k = norm(s);
        if (!seen.has(k)) { seen.add(k); out.push({ service: s, category: cat.name }); }
      }
    }
    return out;
  }

  /**
   * Search phrases to research: each category / service on its own, "near me", and with the
   * city. De-duplicated, lower-case, order kept (most important first).
   */
  function keywordSeeds(categories, services = [], city = '', { max = 60 } = {}) {
    const out = [];
    const add = (v) => {
      const k = norm(v);
      if (k && !out.includes(k)) out.push(k);
    };
    for (const c of categories || []) {
      add(c);
      add(`${c} near me`);
      if (city) add(`${c} ${city}`);
    }
    for (const s of services || []) {
      add(s);
      if (city) add(`${s} ${city}`);
    }
    return out.slice(0, max);
  }

  /**
   * Appends the location to every keyword that does not already contain it. Non-Latin
   * locations (norm() strips them to '') are compared as plain lower-case text instead.
   */
  function withLocation(keywords, location) {
    const loc = String(location || '').trim();
    const contains = (k) => {
      const nl = norm(loc);
      return nl ? norm(k).includes(nl) : String(k).toLowerCase().includes(loc.toLowerCase());
    };
    return (keywords || []).map((k) => String(k).trim()).filter(Boolean)
      .map((k) => (!loc || contains(k) ? k : `${k} ${loc}`));
  }

  /** Search the whole library by text (name or alternate name), most used first. */
  function searchCategories(lib, query, { limit = 30 } = {}) {
    const q = norm(query);
    if (!lib || q.length < 2) return [];
    const words = q.split(' ');
    return lib.categories
      .filter((c) => { const n = norm(`${c.name} ${c.alt.join(' ')}`); return words.every((w) => n.includes(w)); })
      .sort((a, b) => (norm(a.name).startsWith(q) ? -1 : 0) - (norm(b.name).startsWith(q) ? -1 : 0) || b.us - a.us)
      .slice(0, limit);
  }

  const api = { parseCsv, buildLibrary, findCategory, relatedCategories, searchCategories, coOccurring, servicesFor, keywordSeeds, withLocation, norm, head };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbCategoryTools = api;
})(typeof self !== 'undefined' ? self : globalThis);
