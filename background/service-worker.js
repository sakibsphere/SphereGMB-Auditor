/**
 * SphereGMB: Local SEO & Profile Auditor
 * Manifest V3 service worker: place profile resolution, caching, and audit-tab routing.
 */

/* global SphereGmbPlaceParser, SphereGmbPageSpeed */
importScripts('../lib/place-parser.js', '../lib/pagespeed.js');

const CACHE_PREFIX = 'sgmb_v3_place_';
// v2 entries lack Business Profile ID, claimed status and booking links, so they are dropped.
const LEGACY_CACHE_PREFIXES = ['sgmb_cache_', 'ppc_', 'sgmb_v2_place_'];
const MAX_SAVED_REPORTS = 15;
const MAX_CACHED_PLACES = 800;
const PRUNE_EVERY_WRITES = 40;
let writesSincePrune = 0;
const DEFAULT_CACHE_HOURS = 24;
const ACTIVE_AUDIT_TTL_MS = 2 * 60 * 1000;
const FEATURE_ID_RE = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
const inFlight = new Map();

chrome.runtime.onStartup.addListener(() => { pruneCache({ force: true }).catch(() => {}); });

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get(['enabled', 'auditSettings']);
  const updates = {};
  if (current.enabled === undefined) updates.enabled = true;
  if (!current.auditSettings) {
    updates.auditSettings = { cacheDurationHours: DEFAULT_CACHE_HOURS };
  }
  if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);

  // Drop cache entries written by older versions, then expired ones.
  const legacy = (await storageKeys()).filter((k) => LEGACY_CACHE_PREFIXES.some((p) => k.startsWith(p)));
  if (legacy.length) await chrome.storage.local.remove(legacy);
  await pruneCache({ force: true }).catch(() => {});

  console.log('[SphereGMB] installed/updated:', details.reason);
});

// One handler per message type. Every handler's result (or error) is sent back, so a failure
// never leaves the caller waiting or silently does nothing.
const HANDLERS = {
  getPlaceProfile: (m) => getPlaceProfile(m.payload?.featureId),
  getPreviewPlaceCategories: (m) => getPlaceProfile(m.payload?.featureId), // v1 name, kept for compatibility
  getCacheStats: () => getCacheStatistics(),
  clearCategoryCache: () => clearAllPlaceCache().then(() => ({ success: true })),
  clearAllData: () => clearAllData().then(() => ({ success: true })),
  runAuditReview: (m) => openAuditTab(m.payload, 'review').then(() => ({ success: true })),
  runAuditPhoto: (m) => openAuditTab(m.payload, 'photo').then(() => ({ success: true })),
  runAuditPost: (m) => openAuditTab(m.payload, 'post').then(() => ({ success: true })),
  consumeActiveAudit: (m) => consumeActiveAudit(m.payload?.auditType, m.payload?.nonce),
  downloadMedia: (m) => downloadMedia(m.payload?.files),
  runPageSpeed: (m) => runPageSpeed(m.payload?.url),
  trustedWheel: (m, sender) => trustedWheel(sender.tab?.id, m.payload),
  releaseDebugger: (m, sender) => releaseDebugger(sender.tab?.id).then(() => ({ success: true })),
  openReport: (m) => openReport(m.payload),
  openRankPage: (m) => openRankPage(m.payload)
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  // Only our own content scripts and pages may talk to the service worker.
  if (sender.id !== chrome.runtime.id) return false;
  const handler = HANDLERS[message.type];
  if (!handler) return false; // e.g. rankResult, which the Rank check page handles
  Promise.resolve()
    .then(() => handler(message, sender))
    .then((res) => sendResponse(res === undefined ? { success: true } : res))
    .catch((err) => {
      console.warn(`[SphereGMB] ${message.type} failed:`, err);
      sendResponse({ error: err?.message || 'failed' });
    });
  return true;
});

async function getCacheTtlMs() {
  try {
    const { auditSettings } = await chrome.storage.local.get('auditSettings');
    const hours = Number(auditSettings?.cacheDurationHours) || DEFAULT_CACHE_HOURS;
    return hours * 60 * 60 * 1000;
  } catch (e) {
    return DEFAULT_CACHE_HOURS * 60 * 60 * 1000;
  }
}

/**
 * Resolves the full public profile for a feature ID. Results are cached, and concurrent
 * requests for the same place share one network call (a results list can ask for the same
 * place several times while the page settles).
 */
async function getPlaceProfile(featureId) {
  if (!featureId || !FEATURE_ID_RE.test(featureId)) {
    return { categories: [], error: 'invalid_feature_id' };
  }
  if (inFlight.has(featureId)) return inFlight.get(featureId);

  const task = (async () => {
    const cacheKey = CACHE_PREFIX + featureId;
    const ttl = await getCacheTtlMs();
    try {
      const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
      if (cached && Date.now() - cached.ts < ttl) return cached.data;
    } catch (e) {
      console.warn('[SphereGMB] cache read failed:', e);
    }

    // Feature IDs are global, so always resolve against google.com (the only host permission).
    const url = `https://www.google.com/maps/preview/place?authuser=0&hl=en&gl=us&pb=!1m2!1s${encodeURIComponent(featureId)}!2s`;
    const response = await fetchWithRetry(url);
    if (!response.ok) return { categories: [], error: `http_${response.status}` };

    const profile = SphereGmbPlaceParser.parsePlacePreview(await response.text());
    if (!profile) return { categories: [], error: 'unparseable_response' };

    if (profile.name || profile.categories.length) {
      // A full or failing cache must never break the lookup itself.
      try {
        await chrome.storage.local.set({ [cacheKey]: { data: profile, ts: Date.now() } });
        if (++writesSincePrune >= PRUNE_EVERY_WRITES) pruneCache().catch(() => {});
      } catch (e) {
        console.warn('[SphereGMB] cache write failed, pruning:', e);
        pruneCache({ force: true }).catch(() => {});
      }
    }
    return profile;
  })();

  inFlight.set(featureId, task);
  try {
    return await task;
  } catch (err) {
    console.warn(`[SphereGMB] profile lookup failed for ${featureId}:`, err);
    return { categories: [], error: err.message };
  } finally {
    inFlight.delete(featureId);
  }
}

/** All storage keys without reading every value (getKeys is Chrome 130+; older falls back). */
async function storageKeys() {
  if (typeof chrome.storage.local.getKeys === 'function') return chrome.storage.local.getKeys();
  return Object.keys(await chrome.storage.local.get(null));
}

async function getCacheStatistics() {
  try {
    const keys = await storageKeys();
    const { savedReports = [] } = await chrome.storage.local.get('savedReports');
    let bytes = null;
    try { bytes = await chrome.storage.local.getBytesInUse(null); } catch (e) { bytes = null; }
    return { cachedPlacesCount: keys.filter((k) => k.startsWith(CACHE_PREFIX)).length, reportsCount: savedReports.length, bytesInUse: bytes };
  } catch (e) {
    return { cachedPlacesCount: 0 };
  }
}

async function clearAllPlaceCache() {
  const keys = (await storageKeys()).filter((k) => k.startsWith(CACHE_PREFIX) || LEGACY_CACHE_PREFIXES.some((p) => k.startsWith(p)));
  if (keys.length) await chrome.storage.local.remove(keys);
}

/** "Clear saved data" in the popup: places, reports, rank history, category list. Settings stay. */
async function clearAllData() {
  await clearAllPlaceCache();
  await chrome.storage.local.remove(['savedReports', 'rankHistory', 'categoryLibrary', 'lastBusiness', 'rankJobs', 'rankDraft', 'activeAudit']);
}

/**
 * Keeps the profile cache bounded: expired entries go, and if more than MAX_CACHED_PLACES
 * remain, the oldest go too. Runs on start-up, on install and every PRUNE_EVERY_WRITES writes.
 */
async function pruneCache({ force = false } = {}) {
  const keys = (await storageKeys()).filter((k) => k.startsWith(CACHE_PREFIX));
  if (!force && keys.length < 50) return;
  writesSincePrune = 0;
  const ttl = await getCacheTtlMs();
  const entries = await chrome.storage.local.get(keys);
  const now = Date.now();
  const live = [];
  const drop = [];
  for (const k of keys) {
    const ts = entries[k]?.ts || 0;
    if (now - ts > ttl) drop.push(k);
    else live.push([k, ts]);
  }
  const limit = force ? Math.floor(MAX_CACHED_PLACES / 2) : MAX_CACHED_PLACES;
  if (live.length > limit) {
    live.sort((a, b) => a[1] - b[1]);
    drop.push(...live.slice(0, live.length - limit).map(([k]) => k));
  }
  if (drop.length) await chrome.storage.local.remove(drop);
}

function cleanName(name) {
  return String(name || '').replace(/[-–\u2014]\s*Google\s+(Search|Maps).*$/i, '').trim();
}

/**
 * Opens a Google Search tab that the content script recognises as an automated audit.
 * The payload is stored with a timestamp and consumed exactly once by the new tab.
 */
async function openAuditTab(payload = {}, auditType) {
  const name = cleanName(payload.name);
  const address = String(payload.address || payload.addressLocality || '').trim();
  const featureId = FEATURE_ID_RE.test(payload.featureId || '') ? payload.featureId : '';
  const query = payload.query || [name, address].filter(Boolean).join(' ') || name;

  const nonce = Math.random().toString(36).slice(2, 12);
  await chrome.storage.local.set({
    activeAudit: { ...payload, auditType, name, address, query, featureId, nonce, ts: Date.now() },
  });

  let url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&sphereGmbAudit=${auditType}&sgmbNonce=${nonce}`;
  // #lrd makes Google Search open the reviews dialog for this exact place.
  if (auditType === 'review' && featureId) url += `#lrd=${featureId},1,,,`;
  await chrome.tabs.create({ url });
}

/**
 * Hands the stored payload to the tab this worker opened. The nonce in that tab's URL must
 * match, so a link someone else crafted with ?sphereGmbAudit= can never start an audit.
 */
async function consumeActiveAudit(auditType, nonce) {
  const { activeAudit } = await chrome.storage.local.get('activeAudit');
  if (!activeAudit || !nonce || activeAudit.nonce !== nonce) return null;
  await chrome.storage.local.remove('activeAudit');
  const fresh = Date.now() - (activeAudit.ts || 0) < ACTIVE_AUDIT_TTL_MS;
  if (!fresh || (auditType && activeAudit.auditType !== auditType)) return null;
  return activeAudit;
}

/**
 * Saves a profile snapshot (plus its audit) and opens the full report page for it. The last
 * MAX_SAVED_REPORTS snapshots are kept so a report tab survives a reload or browser restart.
 */
async function openReport({ data, audit, section, peers, keyword } = {}) {
  if (!data || typeof data !== 'object') return { error: 'no_data' };
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { savedReports = [] } = await chrome.storage.local.get('savedReports');
  const competitors = Array.isArray(peers) ? peers.slice(0, 21) : [];
  const next = [{ id, ts: Date.now(), name: String(data.name || ''), data, audit: audit || null, peers: competitors, keyword: String(keyword || '').slice(0, 200) }]
    .concat(savedReports.filter((r) => r && r.id))
    .slice(0, MAX_SAVED_REPORTS);
  try {
    await chrome.storage.local.set({ savedReports: next, lastBusiness: rankTargetFrom(data) });
  } catch (e) {
    // Storage full: free the profile cache and keep fewer reports rather than failing.
    await pruneCache({ force: true }).catch(() => {});
    await chrome.storage.local.set({ savedReports: next.slice(0, 5), lastBusiness: rankTargetFrom(data) });
  }
  const hash = /^[a-z-]+$/.test(section || '') ? `#${section}` : '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(`pages/report.html?id=${id}${hash}`) });
  return { success: true, id };
}

/** The fields the Rank check page needs to recognise a business in results. */
function rankTargetFrom(data = {}) {
  let domain = '';
  try { domain = data.website ? new URL(data.website).hostname.replace(/^www\./, '') : ''; } catch (e) { domain = ''; }
  return {
    name: cleanName(data.name),
    cid: String(data.placeCID || ''),
    domain,
    categories: Array.isArray(data.categories) ? data.categories.slice(0, 10) : [],
    city: String(data.addressLocality || ''),
    // Street number + first word ("23 W") and phone digits tell a chain's branches apart.
    street: (String(data.street || data.address || '').split(',')[0].match(/^\s*(\d+[a-z]?\s+\S+)/i) || [])[1] || '',
    phone: String(data.phoneIntl || data.phone || '').replace(/\D+/g, '').slice(-9),
    ts: Date.now()
  };
}

/** Opens the Rank check page prefilled with this business's categories and city. */
async function openRankPage(data) {
  if (data && typeof data === 'object' && (data.name || data.placeCID)) {
    await chrome.storage.local.set({ lastBusiness: rankTargetFrom(data) });
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('pages/rank.html?from=business') });
  return { success: true };
}

/*
 * Trusted scrolling for review export.
 *
 * Google Search's reviews dialog only loads the next page of reviews on a real (trusted)
 * mouse-wheel event; scrollTop changes and synthetic WheelEvents from a content script are
 * ignored. chrome.debugger can dispatch trusted input to the user's own tab. Chrome shows a
 * "started debugging this browser" bar while attached; we detach as soon as the export ends.
 */
const attachedTabs = new Set();

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

async function trustedWheel(tabId, { x, y, deltaY = 700 } = {}) {
  if (!tabId || typeof x !== 'number' || typeof y !== 'number') return { ok: false, error: 'bad_request' };
  try {
    if (!attachedTabs.has(tabId)) {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
      } catch (e) {
        // The worker restarted and forgot it was already attached: that is fine, carry on.
        if (!/already attached/i.test(e.message || '')) throw e;
      }
      attachedTabs.add(tabId);
    }
    const target = { tabId };
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
    return { ok: true };
  } catch (err) {
    attachedTabs.delete(tabId);
    return { ok: false, error: err.message };
  }
}

async function releaseDebugger(tabId) {
  if (!tabId) return;
  // Always try to detach: after a worker restart the in-memory set is empty but the bar may be up.
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {
    // Already detached (user pressed Cancel on Chrome's debugging bar, or the tab closed).
  }
}

chrome.tabs.onRemoved.addListener((tabId) => attachedTabs.delete(tabId));

/**
 * Mobile performance check of the business website via Google PageSpeed Insights (free).
 * Uses the user's own API key from Settings when set; the keyless quota is shared and often
 * exhausted. Only http(s) URLs are sent, and only when the user clicks the button.
 */
async function runPageSpeed(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { error: 'no_website' };
  try {
    const { psiApiKey } = await chrome.storage.local.get('psiApiKey');
    const response = await fetch(SphereGmbPageSpeed.buildUrl(url, psiApiKey || ''), {
      credentials: 'omit',
      signal: AbortSignal.timeout(90000)
    });
    const result = SphereGmbPageSpeed.parsePageSpeed(await response.json());
    return { ...result, usedKey: Boolean(psiApiKey) };
  } catch (err) {
    return { error: err.name === 'TimeoutError' ? 'timeout' : 'network', message: err.message };
  }
}

/**
 * Saves Google-hosted photos/videos into Downloads/SphereGMB/<business>/ (photo audit).
 * Only googleusercontent / ggpht URLs are accepted.
 */
async function downloadMedia(files) {
  let saved = 0;
  let failed = 0;
  for (const f of (files || []).slice(0, 1000)) {
    if (!/^https:\/\/[^/]*\.(googleusercontent|ggpht)\.com\//.test(String(f.url || ''))) {
      failed++;
      continue;
    }
    try {
      await chrome.downloads.download({ url: f.url, filename: String(f.filename || '').replace(/[^\w/.-]+/g, '_'), conflictAction: 'uniquify', saveAs: false });
      saved++;
    } catch (e) {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return { saved, failed };
}

/**
 * fetch() with a timeout and two retries (0.8 s, then 2 s) on network errors, 429 and 5xx.
 * Other 4xx responses are returned as-is so the caller can report them.
 */
async function fetchWithRetry(url, { tries = 3, timeoutMs = 10000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt === 1 ? 800 : 2000));
    try {
      const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`http_${response.status}`);
      if (attempt === tries - 1) return response;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
