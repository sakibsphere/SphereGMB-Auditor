/**
 * GBP Sphere for AI assistants: the engine behind the MCP server and the local HTTP API.
 *
 * It reuses the extension's own code (lib/ and the audit engine), so an assistant gets the same
 * profile data, 16-check score, competitor benchmark and Excel audit as the report page. Data
 * comes from the same public Google Maps requests the extension makes, without cookies, a
 * Google account or an API key. Nothing is sent anywhere else.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const Parser = require('../lib/place-parser.js');
const Benchmark = require('../lib/benchmark.js');
const Links = require('../lib/report-links.js');
const Categories = require('../lib/category-tools.js');
const Sheets = require('../lib/audit-sheets.js');
const Xlsx = require('../lib/xlsx-writer.js');

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;

/** The audit engine is a content-script module (it hangs off window), so load it in a sandbox. */
const auditEngine = (() => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/modules/audit-engine.js'), 'utf8'), ctx, { filename: 'audit-engine.js' });
  return ctx.window.SphereGmb.auditEngine;
})();

const CATEGORY_SOURCES = {
  categories: 'https://raw.githubusercontent.com/lobstrio/google-business-categories/main/data/google-business-categories.csv',
  services: 'https://raw.githubusercontent.com/jepto/google-business-profile-categories/main/data/category_services.csv'
};
const PROFILE_TTL_MS = 60 * 60 * 1000;
const SEARCH_TTL_MS = 30 * 60 * 1000;
const LIBRARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_GAP_MS = 350; // between requests to Google, so a long task never hammers it
const WORLD_SPAN = 30000000; // metres: a map that shows the whole world

class ToolError extends Error {}

// ---------------------------------------------------------------- network

let lastGoogleCall = 0;
let queue = Promise.resolve();

/** One request to Google at a time with a short gap; retries network errors, 429 and 5xx. */
function googleFetch(url, { timeoutMs = 20000 } = {}) {
  const run = async () => {
    const wait = lastGoogleCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    let lastErr;
    for (const delay of [0, 800, 2000]) {
      if (delay) await sleep(delay);
      lastGoogleCall = Date.now();
      try {
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
        if (res.status === 429 || res.status >= 500) { lastErr = new ToolError(`Google answered HTTP ${res.status}. Wait a minute and try again.`); continue; }
        return { status: res.status, ok: res.ok, url: res.url, text: await res.text() };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof ToolError ? lastErr : new ToolError(`Could not reach Google (${lastErr && lastErr.message}). Check the internet connection.`);
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const cache = new Map();
function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.value;
  const value = Promise.resolve().then(fn).then((v) => v, (err) => { cache.delete(key); throw err; });
  cache.set(key, { ts: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

// ---------------------------------------------------------------- places

const FEATURE_ID_RE = /^0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}$/i;

/** The full public profile for a feature ID (0x…:0x…; 0x0:0x<cid> works for a bare CID). */
function getProfile(featureId) {
  if (!FEATURE_ID_RE.test(featureId || '')) throw new ToolError('That is not a valid Google feature ID.');
  return cached(`place:${featureId.toLowerCase()}`, PROFILE_TTL_MS, async () => {
    const res = await googleFetch(Parser.placeRequestUrl(featureId));
    if (!res.ok) throw new ToolError(`Google answered HTTP ${res.status} for that place.`);
    const profile = Parser.parsePlacePreview(res.text);
    if (!profile || !(profile.name || profile.categories.length)) throw new ToolError('Google returned no profile for that place. Check the link or ID.');
    return { ...profile, profileLoaded: true, categoriesSource: 'profile' };
  });
}

/**
 * Google Maps search. With a point it ranks results as Maps does for someone standing there;
 * without one it searches the whole map, which works when the query names a place
 * ("dentist in Austin TX", "Joe's Pizza Broadway New York").
 */
function searchMaps(query, { lat = null, lng = null, spanMeters = 8000 } = {}) {
  const q = String(query || '').trim().slice(0, 150);
  if (!q) throw new ToolError('Give a search query.');
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const url = hasPoint ? Parser.mapsSearchUrl(q, lat, lng, spanMeters) : Parser.mapsSearchUrl(q, 0, 0, WORLD_SPAN);
  return cached(`search:${url}`, SEARCH_TTL_MS, async () => {
    const res = await googleFetch(url);
    if (!res.ok) throw new ToolError(`Google answered HTTP ${res.status} for that search.`);
    let results = Parser.parseMapsSearch(res.text);
    if (!results.length && !hasPoint) {
      // A single, exact match sometimes only comes back without a map viewport.
      const plain = await googleFetch(`https://www.google.com/search?tbm=map&authuser=0&hl=en&gl=us&q=${encodeURIComponent(q)}`);
      if (plain.ok) results = Parser.parseMapsSearch(plain.text);
    }
    return results.slice(0, 20).map((p) => ({ ...p, profileLoaded: true, categoriesSource: 'profile' }));
  });
}

/** Follows a maps.app.goo.gl share link to the place it stands for. */
async function resolveShortLink(url) {
  const res = await googleFetch(url);
  const fromUrl = Links.parseMapsLink(res.url);
  if (fromUrl && fromUrl.featureId) return fromUrl.featureId;
  const m = res.text.slice(0, 3000000).match(/!1s(0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16})/i) || res.text.match(/[?&](?:cid|ludocid)=(\d{6,20})/i);
  const found = m && Links.parseMapsLink(m[1].startsWith('0x') ? m[1] : `?cid=${m[1]}`);
  if (found && found.featureId) return found.featureId;
  throw new ToolError('Could not follow that share link to a place.');
}

/**
 * Turns anything that names a business into its full profile: a Google Maps link, a share
 * link, a link with cid=, a CID, a feature ID, or plain words ("Tacombi Flatiron New York").
 * Plain words take the first Google Maps result and list the next ones as alternatives.
 */
async function resolvePlace(input) {
  const text = String(input || '').trim();
  if (!text) throw new ToolError('Say which business: a Google Maps link, a CID, or its name and city.');
  const parsed = Links.parseMapsLink(text);
  let featureId = parsed && parsed.featureId;
  if (!featureId && parsed && parsed.shortUrl) featureId = await resolveShortLink(parsed.shortUrl);
  if (featureId) return { profile: await getProfile(featureId), matchedBy: 'id' };

  const results = await searchMaps(text);
  if (!results.length) throw new ToolError(`Google Maps found no business for "${text}". Add the city, or paste the Google Maps link.`);
  const { position, ...first } = results[0]; // eslint-disable-line no-unused-vars
  const profile = merge(first, await getProfile(first.featureId));
  return {
    profile,
    matchedBy: 'search',
    alternatives: results.slice(1, 5).map((p) => ({ name: p.name, address: p.address, featureId: p.featureId }))
  };
}

/** A search row with the full profile laid over it (non-empty profile values win). */
function merge(base, fresh) {
  const out = { ...base };
  for (const [k, v] of Object.entries(fresh || {})) {
    const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
    if (!empty) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- shaping output

/** A compact profile for answers: the fields people ask about, without internal noise. */
function summary(p) {
  if (!p) return null;
  return {
    name: p.name,
    categories: p.categories,
    rating: p.rating,
    reviews: p.numReviews,
    address: p.address,
    city: p.addressLocality || Links.cityOf(p) || '',
    phone: p.phone,
    website: p.website,
    claimed: p.claimed,
    featureId: p.featureId,
    cid: p.placeCID,
    placeId: p.placeId,
    mapsUrl: p.mapsUrl,
    ...(p.position ? { position: p.position } : {})
  };
}

function fullProfile(p) {
  const { profileLoaded, categoriesSource, ...rest } = p; // eslint-disable-line no-unused-vars
  return rest;
}

function hasPoint(p) {
  return Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
}

// ---------------------------------------------------------------- tools

async function toolSearch({ query, near = '', lat, lng, limit = 10 }) {
  let point = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  let nearName = '';
  if (!point && near) {
    const where = (await searchMaps(String(near)))[0];
    if (where && Number.isFinite(where.latitude)) { point = { lat: where.latitude, lng: where.longitude }; nearName = where.name; }
  }
  const results = await searchMaps(query, point ? { lat: point.lat, lng: point.lng } : {});
  return {
    query,
    searchedFrom: point ? { ...point, near: nearName || undefined } : 'whole map',
    count: results.length,
    results: results.slice(0, clamp(limit, 1, 20)).map(summary)
  };
}

async function toolProfile({ place }) {
  const r = await resolvePlace(place);
  return { matchedBy: r.matchedBy, ...(r.alternatives && r.alternatives.length ? { alternatives: r.alternatives } : {}), profile: fullProfile(r.profile) };
}

/** Top Maps results for a keyword searched from the business's own address. */
async function competitorsFor(profile, keyword) {
  const kw = String(keyword || (profile.categories || [])[0] || '').trim();
  if (!kw) throw new ToolError('The profile has no category; pass a keyword to search for competitors.');
  if (!hasPoint(profile)) throw new ToolError('Google did not return a location for this business, so it cannot be compared with nearby competitors.');
  const results = await searchMaps(kw, { lat: profile.latitude, lng: profile.longitude });
  return { keyword: kw, results };
}

async function toolAudit({ place, keyword = '', compare = true }) {
  const { profile, matchedBy, alternatives } = await resolvePlace(place);
  const audit = auditEngine.audit(profile);
  let bench = null;
  let comp = null;
  let compareNote = '';
  if (compare) {
    try {
      comp = await competitorsFor(profile, keyword);
      bench = Benchmark.benchmark(profile, comp.results, { keyword: comp.keyword });
      if (!bench) compareNote = `Fewer than 3 other businesses came up for "${comp.keyword}" near this address.`;
    } catch (err) {
      compareNote = err.message;
    }
  }
  const fixes = Benchmark.fixList(audit, bench, profile);
  return {
    matchedBy,
    ...(alternatives && alternatives.length ? { alternatives } : {}),
    business: summary(profile),
    score: audit.score,
    grade: audit.grade,
    checksVerified: `${audit.verified} of ${audit.total} (checks Google does not show publicly are left out of the score)`,
    checks: audit.checks.map(({ id, label, status, points, max, detail }) => ({ id, label, status, points, max, detail })),
    fixes,
    competitors: bench ? {
      keyword: bench.keyword,
      mapsPosition: bench.position,
      comparedWith: bench.peers,
      metrics: bench.rows.map(({ label, you, median, top3, verdict }) => ({ label, you, median, top3: top3 === null ? null : Math.round(top3 * 10) / 10, verdict })),
      missingCategories: bench.missingCategories,
      leaders: bench.leaders
    } : null,
    ...(compareNote ? { competitorNote: compareNote } : {}),
    notes: [
      'The owner description is no longer shown publicly by Google, so it is checked as unknown.',
      'Rankings change with the searcher\'s location; positions here are from the business\'s own address.'
    ]
  };
}

async function toolCompetitors({ place, keyword = '', limit = 10 }) {
  const { profile } = await resolvePlace(place);
  const comp = await competitorsFor(profile, keyword);
  const position = comp.results.findIndex((p) => Benchmark.sameBusiness(p, profile));
  const bench = Benchmark.benchmark(profile, comp.results, { keyword: comp.keyword });
  return {
    business: summary(profile),
    keyword: comp.keyword,
    searchedFrom: { lat: profile.latitude, lng: profile.longitude },
    businessPosition: position >= 0 ? position + 1 : `not in the top ${comp.results.length}`,
    competitors: comp.results.filter((p) => !Benchmark.sameBusiness(p, profile)).slice(0, clamp(limit, 1, 20)).map(summary),
    missingCategories: bench ? bench.missingCategories : []
  };
}

async function toolMapsRank({ place, keywords = [] }) {
  const { profile } = await resolvePlace(place);
  if (!hasPoint(profile)) throw new ToolError('Google did not return a location for this business.');
  const list = (Array.isArray(keywords) && keywords.length ? keywords : (profile.categories || []).slice(0, 5))
    .map((k) => String(k).trim()).filter(Boolean).slice(0, 15);
  if (!list.length) throw new ToolError('Pass at least one keyword.');
  const rows = [];
  for (const kw of list) {
    const results = await searchMaps(kw, { lat: profile.latitude, lng: profile.longitude });
    const i = results.findIndex((p) => Benchmark.sameBusiness(p, profile));
    rows.push({ keyword: kw, position: i >= 0 ? i + 1 : null, outOf: results.length, top3: results.slice(0, 3).map((p) => p.name) });
  }
  return {
    business: summary(profile),
    searchedFrom: { lat: profile.latitude, lng: profile.longitude, note: 'Google Maps results as seen from the business address; null means not in the top 20.' },
    rankings: rows
  };
}

let libraryPromise = null;
function libraryCacheFile() {
  return path.join(os.tmpdir(), 'gbp-sphere-mcp', 'category-library.json');
}

/** Google's category list (community copy, see README "Category data"), cached for 30 days. */
function loadCategoryLibrary() {
  if (libraryPromise) return libraryPromise;
  libraryPromise = (async () => {
    const file = libraryCacheFile();
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { saved = null; }
    if (saved && saved.lib && Date.now() - saved.ts < LIBRARY_TTL_MS) return saved.lib;
    try {
      const get = async (u, required) => {
        const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) { if (required) throw new Error(`http_${res.status}`); return ''; }
        return res.text();
      };
      const [cats, services] = await Promise.all([get(CATEGORY_SOURCES.categories, true), get(CATEGORY_SOURCES.services, false).catch(() => '')]);
      const lib = Categories.buildLibrary(cats, services);
      if (lib.count < 1000) throw new Error('list_too_small');
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ts: Date.now(), lib })); } catch (e) { /* cache is optional */ }
      return lib;
    } catch (err) {
      if (saved && saved.lib) return saved.lib;
      libraryPromise = null;
      throw new ToolError(`Could not download Google's category list (${err.message}).`);
    }
  })();
  return libraryPromise;
}

async function toolCategories({ place = '', categories = [], query = '' }) {
  const lib = await loadCategoryLibrary();
  if (query) return { query, matches: Categories.searchCategories(lib, query, { limit: 30 }).map((c) => ({ name: c.name, group: c.group })) };
  let profile = null;
  let cats = Array.isArray(categories) ? categories.filter(Boolean) : [];
  if (place) { profile = (await resolvePlace(place)).profile; cats = profile.categories || []; }
  if (!cats.length) throw new ToolError('Pass a business (place), a list of categories, or a query.');
  let fromCompetitors = null;
  if (profile && hasPoint(profile)) {
    try {
      const comp = await competitorsFor(profile, '');
      const co = Categories.coOccurring(comp.results.filter((p) => !Benchmark.sameBusiness(p, profile)), cats, { limit: 15 });
      fromCompetitors = { search: comp.keyword, competitorsSharingACategory: co.peers, categories: co.list };
    } catch (e) { /* comparison is a bonus */ }
  }
  const services = Categories.servicesFor(lib, cats);
  return {
    ...(profile ? { business: summary(profile) } : {}),
    categories: cats.map((c) => ({ name: c, isCurrentGoogleCategory: Boolean(Categories.findCategory(lib, c)) })),
    relatedCategories: Categories.relatedCategories(lib, cats, { limit: 20 }).map((r) => ({ name: r.name, group: r.group, why: r.reasons.join('; ') })),
    ...(fromCompetitors ? { usedByCompetitors: fromCompetitors } : {}),
    googleServices: services,
    keywordIdeas: Categories.keywordSeeds(cats, services.map((s) => s.service), profile ? profile.addressLocality || '' : '', { max: 30 })
  };
}

function toolDecode({ input }) {
  const text = String(input || '').trim();
  const parsed = Links.parseMapsLink(text);
  const placeId = (text.match(/ChIJ[a-zA-Z0-9_-]{20,}/) || [])[0] || null;
  if (!parsed && !placeId) throw new ToolError('No CID, feature ID or Place ID found in that input.');
  if (parsed && parsed.shortUrl) return { shortUrl: parsed.shortUrl, note: 'This is a share link. Use gbp_profile on it to resolve the place.' };
  const featureId = parsed ? parsed.featureId : null;
  const cid = featureId ? Parser.featureIdToCid(featureId) : null;
  return {
    featureId: featureId && !featureId.startsWith('0x0:') ? featureId : null,
    cid,
    placeId,
    mapsUrl: cid ? `https://www.google.com/maps?cid=${cid}` : null,
    reviewsUrl: featureId && !featureId.startsWith('0x0:') ? `https://www.google.com/search?q=reviews#lrd=${featureId},1` : null
  };
}

async function toolLinks({ place }) {
  const { profile } = await resolvePlace(place);
  return { business: summary(profile), groups: Links.buildLinkGroups(profile) };
}

function downloadsFolder() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', '/v', '{374DE290-123F-4565-9164-39C4925E467B}'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = out.match(/REG_SZ\s+(.+)/);
      if (m && fs.existsSync(m[1].trim())) return m[1].trim();
    } catch (e) { /* fall back below */ }
  } else if (process.platform === 'linux') {
    try {
      const d = execFileSync('xdg-user-dir', ['DOWNLOAD'], { encoding: 'utf8', timeout: 5000 }).trim();
      if (d && d !== os.homedir() && fs.existsSync(d)) return d;
    } catch (e) { /* fall back below */ }
  }
  const d = path.join(os.homedir(), 'Downloads');
  return fs.existsSync(d) ? d : os.homedir();
}

function slug(v) {
  return String(v || 'business').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'business';
}

async function toolExcel({ place, keyword = '', competitors = [], audits = ['initial', 'competitor', 'services'], output_dir = '' }) {
  const selected = (Array.isArray(audits) && audits.length ? audits : ['initial', 'competitor', 'services'])
    .filter((a) => ['initial', 'competitor', 'services'].includes(a));
  if (!selected.length) throw new ToolError('audits can be "initial", "competitor" and/or "services".');
  const { profile } = await resolvePlace(place);

  let comps = [];
  let kw = String(keyword || '').trim();
  if (selected.includes('competitor')) {
    if (Array.isArray(competitors) && competitors.length) {
      for (const c of competitors.slice(0, 3)) comps.push((await resolvePlace(c)).profile);
    } else {
      const found = await competitorsFor(profile, kw);
      kw = found.keyword;
      const top = found.results.filter((p) => !Benchmark.sameBusiness(p, profile)).slice(0, 3);
      for (const c of top) comps.push(merge(c, await getProfile(c.featureId)));
    }
  }

  let services = (profile.categories || []).map((c) => ({ category: c, services: [] }));
  let suggestions = [];
  try {
    const lib = await loadCategoryLibrary();
    services = (profile.categories || []).map((c) => {
      const cat = Categories.findCategory(lib, c);
      return { category: c, services: (cat && lib.services[cat.id]) || [] };
    });
    suggestions = Categories.relatedCategories(lib, profile.categories || [], { limit: 8 }).map((r) => r.name);
  } catch (e) { /* offline: the Service List shows the categories only */ }
  if (comps.length) {
    const bench = Benchmark.benchmark(profile, comps.length >= 3 ? comps : [], { keyword: kw });
    if (bench) suggestions = [...new Set([...bench.missingCategories.map((c) => c.name), ...suggestions])];
  }

  const list = Sheets.buildAudits({
    business: profile, competitors: comps, keyword: kw || (profile.categories || [])[0] || '',
    city: profile.addressLocality || Links.cityOf(profile) || '', sites: {}, stored: {}, services, suggestions,
    now: Math.floor(Date.now() / 1000)
  }, selected);

  const dir = output_dir ? path.resolve(String(output_dir)) : path.join(downloadsFolder(), 'GBP-Sphere');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `gbp-audit-${slug(profile.name)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  fs.writeFileSync(file, Buffer.from(Xlsx.buildXlsx(list.map((a) => a.sheet))));

  return {
    file,
    business: summary(profile),
    competitors: comps.map(summary),
    sheets: list.map((a) => {
      const body = a.csvRows.slice(1);
      return {
        name: a.name,
        rows: body.length,
        ...(a.key === 'initial' ? { pass: body.filter((r) => r[2] === 'Pass').length, fail: body.filter((r) => r[2] === 'Fail').length } : {}),
        preview: a.csvRows.slice(0, 40)
      };
    }),
    note: 'Website rows say "not checked": the website check runs in the browser extension. Media and post counts come from the profile.'
  };
}

function clamp(n, lo, hi) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : hi;
}

// ---------------------------------------------------------------- tool catalogue

const PLACE = { type: 'string', description: 'The business: a Google Maps link (address bar or maps.app.goo.gl share link), a link with cid=, a CID, a feature ID (0x…:0x…), or its name and city ("Tacombi Flatiron New York").' };

const TOOLS = [
  {
    name: 'gbp_search',
    title: 'Search Google Maps',
    description: 'Search Google Maps for businesses and get the ranked results (name, categories, rating, reviews, address, phone, website, IDs). Put the city in the query, or pass "near" (a city or address) or lat/lng to rank results as someone standing there would see them.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'What to search, e.g. "dentist in Austin TX" or "pizza".' },
      near: { type: 'string', description: 'Optional place to search from, e.g. "Brooklyn, NY".' },
      lat: { type: 'number' }, lng: { type: 'number' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
    }, required: ['query'] },
    run: toolSearch
  },
  {
    name: 'gbp_profile',
    title: 'Get a Business Profile',
    description: 'Get the full public Google Business Profile: categories (primary first), rating, review count, address parts, phone, website, hours, holiday-hours warnings, attributes, photo count, latest posts, claimed status, booking links, coordinates and all IDs (CID, feature ID, Place ID, KG ID).',
    inputSchema: { type: 'object', properties: { place: PLACE }, required: ['place'] },
    run: toolProfile
  },
  {
    name: 'gbp_audit',
    title: 'Audit a Business Profile',
    description: 'Run the GBP Sphere 16-check profile audit: score out of 100, grade, every check with pass/warn/fail/unknown and why, a prioritised fix list, and a benchmark against the top Google Maps results for the primary category (or a keyword) searched from the business address, with its Maps position and categories competitors use that it does not.',
    inputSchema: { type: 'object', properties: {
      place: PLACE,
      keyword: { type: 'string', description: 'Optional search to compare with, e.g. "emergency plumber". Defaults to the primary category.' },
      compare: { type: 'boolean', default: true, description: 'Set false to skip the competitor comparison.' }
    }, required: ['place'] },
    run: toolAudit
  },
  {
    name: 'gbp_competitors',
    title: 'Find local competitors',
    description: 'Find the businesses that rank on Google Maps for a keyword (default: the primary category) from this business\'s own address, with the business\'s position and the categories competitors use that it does not.',
    inputSchema: { type: 'object', properties: {
      place: PLACE,
      keyword: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
    }, required: ['place'] },
    run: toolCompetitors
  },
  {
    name: 'gbp_maps_rank',
    title: 'Check Google Maps rankings',
    description: 'Check where the business ranks on Google Maps (top 20) for up to 15 keywords, searched from its own address. Defaults to its categories.',
    inputSchema: { type: 'object', properties: {
      place: PLACE,
      keywords: { type: 'array', items: { type: 'string' }, maxItems: 15 }
    }, required: ['place'] },
    run: toolMapsRank
  },
  {
    name: 'gbp_categories',
    title: 'Category research',
    description: 'Category research against Google\'s current category list: checks the business\'s categories are real, suggests related categories, categories nearby competitors use, Google\'s predefined services per category and keyword ideas. Pass a business, a list of categories, or a query to search the list.',
    inputSchema: { type: 'object', properties: {
      place: PLACE,
      categories: { type: 'array', items: { type: 'string' } },
      query: { type: 'string', description: 'Search Google\'s category list, e.g. "plumb".' }
    } },
    run: toolCategories
  },
  {
    name: 'gbp_audit_excel',
    title: 'Build the Excel audit',
    description: 'Build the agency audit workbook (.xlsx) and save it on this computer (default: Downloads/GBP-Sphere): Initial GBP Audit, GBP and Competitor Audit (against the top 3 Maps results from the business address, or up to 3 competitors you name) and Service List. Returns the file path and a preview of every sheet.',
    inputSchema: { type: 'object', properties: {
      place: PLACE,
      keyword: { type: 'string', description: 'Search used to find competitors. Defaults to the primary category.' },
      competitors: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Optional competitors (links, CIDs or names) instead of the top Maps results.' },
      audits: { type: 'array', items: { type: 'string', enum: ['initial', 'competitor', 'services'] } },
      output_dir: { type: 'string', description: 'Optional folder to save into.' }
    }, required: ['place'] },
    run: toolExcel,
    writes: true
  },
  {
    name: 'gbp_research_links',
    title: 'Research links',
    description: 'Ready-made research links for the business: Google Maps views (reviews, photos, directions), other map apps and directories, and free website and brand audit tools.',
    inputSchema: { type: 'object', properties: { place: PLACE }, required: ['place'] },
    run: toolLinks
  },
  {
    name: 'gbp_decode_id',
    title: 'Decode a Google place ID',
    description: 'Decode a Google Maps link, feature ID or CID into the CID, feature ID, Place ID and the Maps and reviews links. Works offline.',
    inputSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
    run: toolDecode
  }
];

async function callTool(name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool: ${name}`);
  const input = args && typeof args === 'object' ? args : {};
  for (const req of tool.inputSchema.required || []) {
    if (input[req] === undefined || input[req] === null || input[req] === '') throw new ToolError(`Missing "${req}".`);
  }
  return tool.run(input);
}

module.exports = { VERSION, TOOLS, callTool, ToolError, resolvePlace, getProfile, searchMaps, auditEngine, downloadsFolder, _cache: cache };
