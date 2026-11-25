/**
 * SphereGMB: helpers shared by the extension's own pages (report, rank check).
 * Loaded after lib/category-tools.js.
 */

/* global SphereGmbCategoryTools */
(function (root) {
  'use strict';

  const CATEGORY_SOURCES = {
    categories: 'https://raw.githubusercontent.com/lobstrio/google-business-categories/main/data/google-business-categories.csv',
    services: 'https://raw.githubusercontent.com/jepto/google-business-profile-categories/main/data/category_services.csv'
  };
  const LIBRARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  const svg = (body, size = 16) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    sphere: '<svg class="ico" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>',
    copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', 14),
    check: svg('<polyline points="20 6 9 17 4 12"/>', 14),
    alert: svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', 14),
    cross: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 14),
    minus: svg('<line x1="6" y1="12" x2="18" y2="12"/>', 14),
    external: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', 13),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>', 14),
    print: svg('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>', 14),
    star: '<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
    plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 14),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', 14),
    rank: svg('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>', 14),
    shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>', 14),
    pin: svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', 14),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="1"/>', 14),
    play: svg('<polygon points="6 4 20 12 6 20 6 4"/>', 14)
  };

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function safeUrl(url) {
    return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /** Copies text and briefly swaps the button label to "Copied". */
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(String(text));
      if (btn) {
        // Buttons with a visible label ([data-label]) show "Copied"; icon-only ones swap aria-label.
        const label = btn.querySelector('[data-label]');
        const before = btn.getAttribute('aria-label');
        if (label) label.textContent = 'Copied';
        if (before) btn.setAttribute('aria-label', 'Copied');
        btn.classList.add('is-done');
        setTimeout(() => {
          btn.classList.remove('is-done');
          if (label) label.textContent = label.dataset.label;
          if (before) btn.setAttribute('aria-label', before);
        }, 1500);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** CSV formula-injection guard: see csvSafe in content/modules/utils.js. */
  function csvSafe(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return typeof val === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  }

  function toCsv(head, rows) {
    const q = (v) => `"${csvSafe(v).replace(/"/g, '""')}"`;
    return '\uFEFF' + [head.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\r\n');
  }

  function slug(v, fallback = 'report') {
    const s = String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    return s || fallback;
  }

  async function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  /**
   * Google's category list, downloaded once into this browser and refreshed monthly.
   * Returns { lib, ts, fromCache } or throws when offline and nothing is cached.
   */
  async function loadCategoryLibrary({ refresh = false } = {}) {
    const { categoryLibrary } = await storageGet('categoryLibrary');
    if (categoryLibrary?.lib && !refresh && Date.now() - categoryLibrary.ts < LIBRARY_TTL_MS) {
      return { ...categoryLibrary, fromCache: true };
    }
    try {
      const [cats, services] = await Promise.all([
        fetch(CATEGORY_SOURCES.categories, { credentials: 'omit', cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`http_${r.status}`); return r.text(); }),
        fetch(CATEGORY_SOURCES.services, { credentials: 'omit', cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')).catch(() => '')
      ]);
      const lib = SphereGmbCategoryTools.buildLibrary(cats, services);
      if (lib.count < 1000) throw new Error('list_too_small');
      const entry = { lib, ts: Date.now() };
      await chrome.storage.local.set({ categoryLibrary: entry });
      return { ...entry, fromCache: false };
    } catch (err) {
      if (categoryLibrary?.lib) return { ...categoryLibrary, fromCache: true, stale: true };
      throw err;
    }
  }

  /** Profiles in the extension's own cache (places the user has looked at). */
  async function cachedProfiles() {
    // Read only the cache keys, not every stored value (the category list alone is ~700 KB).
    const keys = typeof chrome.storage.local.getKeys === 'function'
      ? (await chrome.storage.local.getKeys()).filter((k) => k.startsWith('sgmb_v4_place_'))
      : Object.keys(await storageGet(null)).filter((k) => k.startsWith('sgmb_v4_place_'));
    if (!keys.length) return [];
    const entries = await storageGet(keys);
    return keys.map((k) => entries[k]?.data).filter((p) => p && p.categories);
  }

  /**
   * Google Autocomplete suggestions for one phrase (free, no key). Called only when the user
   * clicks, a few phrases at a time with a pause between requests.
   */
  async function suggest(phrase, { hl = 'en', gl = '' } = {}) {
    const params = new URLSearchParams({ client: 'chrome', q: phrase, hl });
    if (gl) params.set('gl', gl);
    const res = await fetch(`https://www.google.com/complete/search?${params}`, { credentials: 'omit' });
    if (res.status === 429) throw new Error('rate_limited');
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = JSON.parse(await res.text());
    return Array.isArray(data?.[1]) ? data[1].map(String) : [];
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** WAI-ARIA tabs: click, arrows, Home/End. */
  function wireTabs(tabs, onSelect) {
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const pane = document.getElementById(t.getAttribute('aria-controls'));
        if (pane) pane.hidden = !on;
      });
      if (focus) tab.focus();
      if (onSelect) onSelect(tab);
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (n === undefined) return;
        e.preventDefault();
        select(tabs[(n + tabs.length) % tabs.length], true);
      });
    });
    return select;
  }

  root.SgmbPage = { ICONS, esc, safeUrl, fmt, copyText, downloadText, toCsv, slug, storageGet, loadCategoryLibrary, cachedProfiles, suggest, sleep, wireTabs, CATEGORY_SOURCES };
})(globalThis);
