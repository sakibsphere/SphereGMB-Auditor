/**
 * SphereGMB: Local SEO & Profile Auditor - Utilities Module
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const ICONS = {
    bolt: '<svg class="sgmb-icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    check: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    cross: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    minus: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"/></svg>',
    download: '<svg class="sgmb-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    external: '<svg class="sgmb-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    // Toolbar set (Lucide-style strokes, drawn inline)
    posts: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M18 6a8 8 0 0 1 0 12"/></svg>',
    photos: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
    reviews: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m12 7 1 2.2 2.4.3-1.8 1.6.5 2.4L12 12.3 9.9 13.5l.5-2.4-1.8-1.6 2.4-.3z"/></svg>',
    gauge: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/></svg>',
    rank: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>',
    questions: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    sphere: '<svg class="sgmb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/></svg>'
  };

  // Profile fields that the service worker can supply. DOM-scraped values win only when the
  // service worker returned nothing for that field.
  const PROFILE_FIELDS = [
    'name', 'featureId', 'placeCID', 'placeId', 'kgmid', 'rating', 'numReviews', 'reviewsUrl',
    'priceLevel', 'address', 'neighborhood', 'street', 'addressLocality', 'zipCode', 'region',
    'country', 'plusCode', 'phone', 'phoneIntl', 'website', 'websiteDomain', 'latitude', 'longitude',
    'timezone', 'description', 'editorialSummary', 'hours', 'attributes', 'mapsUrl',
    'businessProfileId', 'claimed', 'bookingLinks'
  ];

  ns.utils = {
    icons: ICONS,

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    /** Current Google country domain from location.hostname (e.g., 'com', 'co.uk', 'de') */
    getGoogleDomain() {
      const match = window.location.hostname.match(/google\.([a-z.]+)/i);
      return match ? match[1] : 'com';
    },

    isMaps() {
      const loc = window.location || {};
      return (loc.hostname || '').startsWith('maps.google.') || (loc.pathname || '').startsWith('/maps');
    },

    /**
     * False once the extension has been reloaded or removed. Content scripts left behind in
     * open tabs keep running, but every chrome.* call then throws "Extension context invalidated".
     */
    isExtensionAlive() {
      try {
        return Boolean(chrome?.runtime?.id);
      } catch (e) {
        return false;
      }
    },

    /** Promise wrapper around chrome.runtime.sendMessage that never throws. */
    sendMessage(message) {
      return new Promise((resolve) => {
        if (!ns.utils.isExtensionAlive()) {
          resolve({ error: 'extension_reloaded' });
          return;
        }
        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
              return;
            }
            resolve(response || {});
          });
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    },

    /** Copies non-empty profile fields from the service worker result onto businessData. */
    mergeProfile(target, profile) {
      if (!target || !profile || profile.error) return target;
      for (const key of PROFILE_FIELDS) {
        const value = profile[key];
        const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
        if (!empty) target[key] = value;
      }
      if (Array.isArray(profile.categories) && profile.categories.length > 0) {
        target.categories = profile.categories;
        target.categoriesSource = 'profile';
      }
      target.profileLoaded = true;
      return target;
    },

    /** Collapses whitespace and strips invisible direction/format characters Google injects. */
    cleanText(value) {
      return String(value || '')
        .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00A0\uE000-\uF8FF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },

    /** True when a result card / row carries Google's "Sponsored" label (an ad). */
    isSponsored(el) {
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      return Array.from(el.querySelectorAll('span, div, h1')).some((e) => e.childElementCount === 0 && /^Sponsored$/i.test((e.textContent || '').trim()));
    },

    /**
     * CSV formula-injection guard (OWASP): a text cell starting with = + - @ tab or CR would
     * run as a formula in Excel or Sheets, so it gets a leading apostrophe. Numbers pass.
     */
    csvSafe(val) {
      if (val === null || val === undefined) return '';
      const s = String(val);
      return typeof val === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    },

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },

    /** Only http(s) URLs are allowed into href attributes. */
    safeUrl(url) {
      return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
    },

    /** First number in a string: "(1,452 reviews)" -> 1452 */
    parseFirstNumber(str) {
      if (!str) return 0;
      const match = String(str).replace(/[\s,]/g, '').match(/\d+(\.\d+)?/);
      return match ? parseFloat(match[0]) : 0;
    },

    formatNumber(num) {
      if (num === null || num === undefined || isNaN(num)) return '0';
      return Number(num).toLocaleString();
    },

    /** Triggers a browser download of a text file from the page context. */
    downloadFile(filename, content, mime = 'text/csv;charset=utf-8;') {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    slug(value, fallback = 'profile') {
      const s = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
      return s || fallback;
    },

    /**
     * Makes an open drawer behave like a proper modal dialog: focus moves inside, Tab and
     * Shift+Tab stay inside, Escape closes, and focus returns to whatever opened it.
     * Returns a release() function the caller runs when the drawer closes.
     */
    modalize(dialog, onEscape) {
      const opener = document.activeElement;
      const focusables = () => Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      const first = dialog.querySelector('.sgmb-modal-close, .sgmb-close-btn') || focusables()[0] || dialog;
      setTimeout(() => first.focus({ preventScroll: true }), 30);

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onEscape();
          return;
        }
        if (e.key !== 'Tab') return;
        const items = focusables();
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === firstItem || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && (document.activeElement === lastItem || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          firstItem.focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      return () => {
        document.removeEventListener('keydown', onKey, true);
        if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
      };
    },

    /**
     * Marks <html data-sgmb-theme="dark|light"> from the page's actual background, so the widget
     * follows Google's own theme setting (which can differ from the OS setting).
     */
    applyTheme() {
      try {
        // Sample the surface our widgets sit on (Maps' <body> is dark behind the map even in
        // light mode), walking up until a non-transparent background is found.
        const start = document.querySelector('div[role="main"] h1, #rhs, #center_col, #search, [role="main"]') || document.body;
        let bg = '';
        for (let el = start; el; el = el.parentElement) {
          const c = window.getComputedStyle(el).backgroundColor;
          if (c && c !== 'transparent' && !/rgba\(\d+,\s*\d+,\s*\d+,\s*0\)/.test(c)) {
            bg = c;
            break;
          }
        }
        if (!bg) bg = 'rgb(255, 255, 255)';
        const m = String(bg || '').match(/(\d+)\D+(\d+)\D+(\d+)/);
        if (!m) return;
        const luminance = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
        document.documentElement.setAttribute('data-sgmb-theme', luminance < 0.45 ? 'dark' : 'light');
      } catch (e) { /* non-critical */ }
    },

    log(...args) {
      console.log('[SphereGMB]', ...args);
    }
  };
})(window.SphereGmb);
