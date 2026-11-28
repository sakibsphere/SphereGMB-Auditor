/**
 * GBP Sphere: PageSpeed Insights helpers (Google's free PSI API v5).
 * Shared by the service worker (importScripts) and Node tests (require).
 */

(function (root) {
  'use strict';

  const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

  function buildUrl(siteUrl, apiKey) {
    const params = new URLSearchParams({ url: siteUrl, strategy: 'mobile', category: 'performance' });
    if (apiKey) params.set('key', apiKey);
    return `${ENDPOINT}?${params.toString()}`;
  }

  /** Lighthouse lab metrics + CrUX field verdict from a PSI v5 response. */
  function parsePageSpeed(json) {
    if (!json || typeof json !== 'object') return { error: 'bad_response' };
    if (json.error) {
      const code = json.error.code;
      if (code === 429) return { error: 'quota' };
      if (code === 400 && /key/i.test(json.error.message || '')) return { error: 'bad_key' };
      return { error: 'api_error', message: String(json.error.message || '').slice(0, 200) };
    }
    const lr = json.lighthouseResult;
    const score = lr?.categories?.performance?.score;
    if (typeof score !== 'number') return { error: 'no_score' };
    const audit = (id) => lr.audits?.[id]?.displayValue || '';
    return {
      score: Math.round(score * 100),
      lcp: audit('largest-contentful-paint'),
      cls: audit('cumulative-layout-shift'),
      tbt: audit('total-blocking-time'),
      fcp: audit('first-contentful-paint'),
      fieldCategory: json.loadingExperience?.overall_category || '',
      testedUrl: lr.finalDisplayedUrl || lr.finalUrl || json.id || ''
    };
  }

  const api = { buildUrl, parsePageSpeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbPageSpeed = api;
})(typeof self !== 'undefined' ? self : globalThis);
