/**
 * GBP Sphere: Action Buttons Component
 * Two-row toolbar under the categories line:
 * - Row 1: [ Export ] [ Post Audit ] [ Media Audit ] [ Review Audit ]
 * - Row 2: [ Dashboard ] [ SERP Checker ]
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  /** Makes sure the full profile has been fetched before an action that needs it. */
  async function ensureProfile(data) {
    if (data && data.featureId && !data.profileLoaded) {
      const profile = await ns.api.fetchPlaceProfile(data.featureId);
      ns.utils.mergeProfile(data, profile);
    }
    return data || {};
  }

  /** Google Search URL for the primary category in the business's city, used for rank checks. */
  function buildRankCheckUrl(data) {
    const keyword = data.categories?.[0] || data.name || '';
    const city = data.addressLocality || (data.address || '').split(',').slice(-2, -1)[0]?.trim() || '';
    const params = new URLSearchParams({ q: [keyword, city].filter(Boolean).join(' '), hl: 'en', num: '20' });
    if (data.placeCID) params.set('sgmbRankCid', data.placeCID);
    if (data.name) params.set('sgmbRankName', data.name);
    return `https://www.google.com/search?${params.toString()}`;
  }

  /** Copy of the business data without DOM references (safe to send to the service worker). */
  function plainData(data) {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
      else if (Array.isArray(v) || (typeof v === 'object' && !(typeof Node !== 'undefined' && v instanceof Node))) {
        try { out[k] = JSON.parse(JSON.stringify(v)); } catch (e) { /* skip */ }
      }
    }
    return out;
  }

  /** The search behind the current results: Maps /maps/search/<q>/ or Search ?q=. */
  function currentKeyword() {
    try {
      const m = window.location.pathname.match(/\/maps\/search\/([^/@]+)/);
      if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
      return new URLSearchParams(window.location.search).get('q') || '';
    } catch (e) {
      return '';
    }
  }

  /** Only the fields the benchmark needs, so a saved report stays small. */
  function slimPeer(p) {
    return {
      name: p.name || '', featureId: p.featureId || '', placeCID: p.placeCID || '',
      categories: (p.categories || []).slice(0, 12), rating: typeof p.rating === 'number' ? p.rating : null,
      numReviews: typeof p.numReviews === 'number' ? p.numReviews : null, website: p.website || '',
      description: String(p.description || '').slice(0, 800), attributes: p.attributes || [],
      claimed: typeof p.claimed === 'boolean' ? p.claimed : null, profileLoaded: Boolean(p.profileLoaded)
    };
  }

  /**
   * Businesses from the same search on this page, in result order: the Maps results feed, or
   * the local pack / Local Finder rows on Search. Profiles not loaded yet are fetched (the
   * service worker caches them), with a time limit so the report never waits long.
   */
  async function collectPeers() {
    const rows = Array.from(document.querySelectorAll('div[role="feed"] .sgmb-maps-card, .sgmb-local-pack'))
      .map((c) => c._businessData).filter((p) => p && p.name && !p.sponsored).slice(0, 21);
    if (rows.length < 3) return { keyword: currentKeyword(), peers: [] };
    const load = Promise.all(rows.map(async (p) => {
      if (p.featureId && !p.profileLoaded) ns.utils.mergeProfile(p, await ns.api.fetchPlaceProfile(p.featureId));
    }));
    await Promise.race([load, ns.utils.sleep(6000)]);
    return { keyword: currentKeyword(), peers: rows.map(slimPeer) };
  }

  /** Opens the full report page; falls back to the in-page drawer if the extension was reloaded. */
  async function openReport(data, section = '') {
    const plain = plainData(data);
    const { keyword, peers } = await collectPeers();
    const res = await ns.utils.sendMessage({ type: 'openReport', payload: { data: plain, audit: ns.auditEngine.audit(plain), section, peers, keyword } });
    if (res.error) ns.auditModal.show(data, ns.auditEngine.audit(data));
  }

  ns.actionButtons = {
    buildRankCheckUrl,
    openReport,
    plainData,
    ensureProfile,
    collectPeers,
    slimPeer,

    mountButtons(parentContainer, businessDataResolver) {
      if (!parentContainer || parentContainer.querySelector('.sgmb-btn-wrapper')) return;

      const getData = () => (typeof businessDataResolver === 'function' ? businessDataResolver() : businessDataResolver) || {};

      const wrapper = document.createElement('div');
      wrapper.className = 'sgmb-btn-wrapper';
      const row1 = document.createElement('div');
      row1.className = 'sgmb-btn-row-1';
      const row2 = document.createElement('div');
      row2.className = 'sgmb-btn-row-2';

      const exportBtn = this.createButton('Export', 'sgmb-btn-export', async () => {
        const data = await ensureProfile(getData());
        ns.csvExporter.exportBusinessProfile(data);
      }, 'Download this profile (NAP, categories, hours, IDs, audit score) as CSV', 'download');

      const postAuditBtn = this.createButton('Post Audit', 'sgmb-btn-post-audit', async () => {
        ns.postAudit.show(await ensureProfile(getData()));
      }, 'Audit every Google post: count, dates, length, calls to action', 'posts');

      const photoAuditBtn = this.createButton('Media Audit', 'sgmb-btn-photo-audit', async () => {
        ns.photoAudit.show(await ensureProfile(getData()));
      }, 'Count photos and videos by category and download them', 'photos');

      const reviewAuditBtn = this.createButton('Review Audit', 'sgmb-btn-review-audit', () => {
        const data = getData();
        const name = ns.utils.cleanText((data.name || '').replace(/[-–\u2014]\s*Google\s+(Search|Maps).*$/i, ''));
        const address = ns.utils.cleanText(data.address);
        const payload = { ...data, name, address, query: [name, address].filter(Boolean).join(' ') };

        if (ns.utils.isMaps()) {
          // Maps review panes are fragile to automate; Google Search's #lrd dialog is stable.
          ns.reviewScraper.showToast(`Opening Google Search reviews for "${name}"…`);
          ns.utils.sendMessage({ type: 'runAuditReview', payload }).then((res) => {
            if (res.error) ns.reviewScraper.showToast('Extension was updated. Reload this tab, then try again.');
            else ns.reviewScraper.scheduleHide(5000);
          });
          return;
        }
        ns.reviewScraper.startExport(payload);
      }, 'Export every Google review with full text, replies and details', 'reviews');

      const dashboardBtn = this.createButton('Dashboard', 'sgmb-btn-full sgmb-btn-dashboard', async () => {
        await openReport(await ensureProfile(getData()));
      }, 'Open the full profile report: every field, IDs, links, categories and the audit', 'gauge');

      const serpCheckerBtn = this.createButton('SERP Checker', 'sgmb-btn-full sgmb-btn-serp', async () => {
        const data = await ensureProfile(getData());
        const res = await ns.utils.sendMessage({ type: 'openRankPage', payload: plainData(data) });
        // Extension was reloaded under this tab: fall back to a single search.
        if (res.error) window.open(buildRankCheckUrl(data), '_blank', 'noopener');
      }, 'Check where this business ranks for all its categories and your own keywords', 'rank');

      row1.append(exportBtn, postAuditBtn, photoAuditBtn, reviewAuditBtn);
      row2.append(dashboardBtn, serpCheckerBtn);
      wrapper.append(row1, row2);
      parentContainer.appendChild(wrapper);
    },

    /**
     * Button that swallows its events so Google's own click handlers (card navigation,
     * map panning) don't fire underneath it.
     */
    createButton(text, extraClass, onClick, title = '', icon = '') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sgmb-action-btn ${extraClass || ''}`.trim();
      if (icon && ns.utils.icons[icon]) btn.innerHTML = `${ns.utils.icons[icon]}${ns.utils.escapeHtml(text)}`;
      else btn.textContent = text;
      btn.setAttribute('data-action', text.toLowerCase().replace(/\s+/g, '-'));
      if (title) btn.setAttribute('title', title);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        // One run at a time: a second click while the action is working is ignored.
        if (btn.getAttribute('aria-busy') === 'true') return;
        btn.setAttribute('aria-busy', 'true');
        Promise.resolve()
          .then(() => onClick(e))
          .catch((err) => {
            ns.utils.log(`"${text}" action failed:`, err);
            ns.reviewScraper?.notify(`${text} didn't finish`, 'Reload the page and try again. Details are in the console.');
          })
          .finally(() => btn.removeAttribute('aria-busy'));
      }, { capture: true });

      btn.addEventListener('mousedown', (e) => e.stopPropagation(), { capture: true });
      btn.addEventListener('mouseup', (e) => e.stopPropagation(), { capture: true });
      return btn;
    }
  };
})(window.SphereGmb);
