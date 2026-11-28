/**
 * GBP Sphere: Google SERP Adapter Module
 * Knowledge Panel and Local Pack integration for Google Search.
 *
 * Google's class names on Search rotate often; this adapter leans on the more stable hooks
 * (data-attrid, data-fid, #lrd= review links, /maps/place/ links) and uses class names only as
 * fallbacks.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const KP_WIDGET = 'sgmb-serp-kp';
  const PACK_WIDGET = 'sgmb-local-pack';
  const BUSINESS_SIGNALS = [
    '[data-attrid="kc:/location/location:address"]',
    '[data-attrid*="phone"]',
    '[data-attrid*="hours"]',
    '[data-fid]',
    'a[href*="#lrd="]',
    'a[href*="ludocid="]',
    'a[href*="/maps/place/"]',
    'span.LrzXr'
  ].join(', ');

  function text(el) {
    return ns.utils.cleanText(el?.textContent);
  }

  /** Category from "Mexican restaurant in New York, New York" style subtitles. */
  function categoryFromText(value) {
    const segments = ns.utils.cleanText(value).split(/[·‧•|]/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      if (/^\d+(\.\d+)?$/.test(seg) || /^[$€£₹৳]/.test(seg) || /^\(?\d/.test(seg)) continue;
      if (/^https?:|^www\.|\.(com|org|net)\b/i.test(seg)) continue;
      if (/\b(reviews?|stars?|open|closed|hours|claim|wheelchair|about this)\b/i.test(seg)) continue;
      const cat = seg.replace(/\s+in\s+.+$/, '').trim();
      if (cat.length > 2 && cat.length < 60 && /[a-z]/i.test(cat)) return cat;
    }
    return '';
  }

  /**
   * Google's 2026 knowledge panel puts the title and rating in a fixed-height header with
   * overflow hidden. A widget mounted inside it pushes the name out of view and gets cut off
   * under the photos. After mounting, move the widget just below any ancestor (up to the panel
   * root) that clips it. Class names are not used, so this survives Google's renames.
   */
  function escapeClipping(el, stopAt) {
    if (typeof window.getComputedStyle !== 'function' || typeof el?.getBoundingClientRect !== 'function') return;
    for (let guard = 0; guard < 6; guard++) {
      const er = el.getBoundingClientRect();
      if (!er.height) return;
      let moved = false;
      for (let p = el.parentElement; p && p !== document.body && p !== stopAt?.parentElement; p = p.parentElement) {
        const cs = window.getComputedStyle(p);
        if (!/(hidden|clip)/.test(`${cs.overflowY} ${cs.overflow}`)) continue;
        const pr = p.getBoundingClientRect();
        if (er.bottom > pr.bottom + 1 || p.scrollHeight > p.clientHeight + 2) {
          p.insertAdjacentElement('afterend', el);
          moved = true;
          break;
        }
      }
      if (!moved) return;
    }
  }

  ns.domSerp = {
    escapeClipping,

    /** Primary category visible on the SERP (secondary ones come from the profile lookup). */
    extractCategoriesFromSerpDOM(scope) {
      const root = scope || document;
      try {
        const e5 = root.querySelector('span.E5BaQ');
        const fromE5 = e5 ? categoryFromText(e5.textContent) : '';
        if (fromE5) return [fromE5];

        const subtitles = root.querySelectorAll('[data-attrid="subtitle"], .nwVKo, .YhemCb');
        for (const el of subtitles) {
          const cat = categoryFromText(el.textContent);
          if (cat) return [cat];
        }
      } catch (e) {
        ns.utils.log('extractCategoriesFromSerpDOM error:', e);
      }
      return [];
    },

    /** Locates the business knowledge panel, or null when the page has no business panel. */
    findKpRoot() {
      const title = document.querySelector('#rhs [data-attrid="title"], [data-attrid="title"][role="heading"], [data-attrid="title"]');
      const candidates = [
        title?.closest('.kp-wholepage-osrp, .kp-wholepage, .osrp-blk'),
        document.querySelector('.kp-wholepage-osrp'),
        title?.closest('#rhs'),
        document.querySelector('#rhs')
      ].filter(Boolean);

      // Entity panels (people, films, topics) also live in #rhs; require a local-business signal.
      return candidates.find((c) => c.querySelector(BUSINESS_SIGNALS)) || null;
    },

    /** Reads NAP, rating, and identifiers from the knowledge panel. */
    readKp(root) {
      const nameEl = root.querySelector('[data-attrid="title"][role="heading"], [data-attrid="title"], h2[data-attrid="title"], .SPZz6b span, h2 span');
      const name = text(nameEl) || document.title.replace(/\s*[-–\u2014]\s*Google Search.*$/i, '').trim();

      const ids = ns.cidParser.findIdentifiersIn(root);

      const ratingEl = root.querySelector('span.Aq14fc, span.yi40Hd, [aria-label*="out of 5" i], [aria-label^="Rated" i]');
      let rating = null;
      if (ratingEl) {
        const parsed = ns.utils.parseFirstNumber(ratingEl.getAttribute('aria-label') || ratingEl.textContent);
        if (parsed > 0 && parsed <= 5) rating = parsed;
      }
      // 2026 panel: "59 Google reviews" is an <a role="button" data-fid>; older panels used #lrd links.
      const reviewsEl = root.querySelector('a[data-fid][role="button"], a[href*="#lrd="] span, span.hqzQac a span, .RDAAId')
        || document.querySelector('#rhs a[data-fid][role="button"]');
      const reviewsMatch = text(reviewsEl || root.querySelector('a[href*="#lrd="]')).match(/([\d.,]+[KkMm]?)\s*(?:Google\s+)?reviews?/i);

      const addressEl = root.querySelector('[data-attrid="kc:/location/location:address"] span.LrzXr, [data-attrid="kc:/location/location:address"]');
      const phoneEl = root.querySelector('[data-attrid*="phone"] span.LrzXr, [data-attrid*="phone"] a[href^="tel:"], a[href^="tel:"]');
      const siteLink = root.querySelector('a[data-attrid="visit_official_site"], a.ab_button[href^="http"]')
        || Array.from(root.querySelectorAll('a[href^="http"]')).find((a) => /^website$/i.test(text(a)));

      // Only the Search panel shows these two; Google's place data and Maps do not.
      const socialBox = root.querySelector('[data-attrid="kc:/common/topic:social media presence"]') || document.querySelector('[data-attrid="kc:/common/topic:social media presence"]');
      const socialProfiles = socialBox ? Array.from(socialBox.querySelectorAll('a[href^="http"]')).map((a) => {
        let host = '';
        try { host = new URL(a.href).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
        return { network: text(a) || host, url: ns.utils.safeUrl(a.href) };
      }).filter((s, i, all) => s.url && all.findIndex((x) => x.network === s.network) === i) : null;
      const reviewsBox = root.querySelector('[data-attrid="kc:/location/location:third_party_aggregator_ratings"]') || document.querySelector('[data-attrid="kc:/location/location:third_party_aggregator_ratings"]');
      const thirdPartyReviews = reviewsBox ? Array.from(reviewsBox.querySelectorAll('a[href^="http"]')).map((a) => {
        const t = text(a);
        const m = t.match(/^(.*?)\s*([\d.]+)\s*\/\s*(\d+)\s*([\d,]+)?/);
        return m ? { site: m[1].trim(), rating: `${m[2]}/${m[3]}`, votes: m[4] ? ns.utils.parseFirstNumber(m[4]) : null, url: ns.utils.safeUrl(a.href) } : null;
      }).filter(Boolean) : null;

      return {
        socialProfiles,
        thirdPartyReviews,
        name,
        address: text(addressEl).replace(/^Address:\s*/i, ''),
        phone: text(phoneEl).replace(/^Phone:\s*/i, ''),
        website: ns.utils.safeUrl(siteLink?.href),
        rating,
        numReviews: reviewsMatch ? ns.utils.parseFirstNumber(reviewsMatch[1]) : 0,
        featureId: ids.featureId,
        placeCID: ids.placeCID,
        nameEl
      };
    },

    async processKp() {
      if (ns.categoryUI.isOnRestrictedTab()) return;
      const root = this.findKpRoot();
      if (!root) return;
      const existing = root.querySelector(`.${KP_WIDGET}`);
      if (existing) {
        // The widget grows once secondary categories arrive; re-check it is not clipped.
        escapeClipping(existing, root);
        return;
      }

      const kp = this.readKp(root);
      const domCategories = this.extractCategoriesFromSerpDOM(root);
      const businessData = {
        name: kp.name,
        address: kp.address,
        phone: kp.phone,
        website: kp.website,
        rating: kp.rating,
        numReviews: kp.numReviews,
        featureId: kp.featureId,
        placeCID: kp.placeCID,
        categories: domCategories,
        categoriesSource: 'dom',
        // null = not shown on this page (unknown); [] would mean "panel loaded, none listed".
        socialProfiles: kp.socialProfiles,
        thirdPartyReviews: kp.thirdPartyReviews,
        seenOnSearch: true
      };

      // Mount right after the subtitle / title block.
      const anchor = root.querySelector('[data-attrid="subtitle"], .nwVKo, span.E5BaQ') || kp.nameEl?.parentElement;
      const container = ns.categoryUI.buildContainer(KP_WIDGET);
      if (anchor && anchor !== root) anchor.insertAdjacentElement('afterend', container);
      else root.insertAdjacentElement('afterbegin', container);
      escapeClipping(container, root);
      // Visible to DevTools and tests: what the Search panel offered for the audit sheets.
      container.dataset.sgmbSocial = kp.socialProfiles ? kp.socialProfiles.map((s) => s.network).join(',') || 'none' : 'not-shown';
      container.dataset.sgmbThirdParty = kp.thirdPartyReviews ? kp.thirdPartyReviews.map((s) => s.site).join(',') || 'none' : 'not-shown';
      container._businessData = businessData;

      ns.actionButtons.mountButtons(container, () => container._businessData);
      ns.categoryUI.hydrateCategories(container, businessData);
      await ns.categoryUI.resolveProfile(container, businessData);
    },

    /** Local 3-pack rows. */
    async processLocalPack() {
      const rows = document.querySelectorAll('div.VkpGBb, div[jscontroller][data-cid], div.rllt__details');

      for (const row of rows) {
        // .rllt__details sits inside .VkpGBb; enrich only the outermost row.
        if (row.getAttribute('data-sgmb-spidered') === '1') continue;
        if (row.parentElement?.closest('[data-sgmb-spidered="1"]')) continue;
        if (row.closest('[data-sphere-gmb-root]')) continue;

        const titleEl = row.querySelector('.OSrXXb, .dbg0pd, [role="heading"], .qBF1Pd');
        const name = text(titleEl);
        if (!name) continue;
        row.setAttribute('data-sgmb-spidered', '1');

        const ids = ns.cidParser.findIdentifiersIn(row);
        const ownCid = row.getAttribute('data-cid');
        const ratingEl = row.querySelector('span.yi40Hd, span.Y0A0hc span, [aria-label*="stars" i], [aria-label^="Rated" i]');
        const rating = ratingEl ? ns.utils.parseFirstNumber(ratingEl.getAttribute('aria-label') || ratingEl.textContent) : null;

        const businessData = {
          name,
          rating: rating && rating <= 5 ? rating : null,
          featureId: ids.featureId,
          placeCID: ids.placeCID || (/^\d{15,20}$/.test(ownCid || '') ? ownCid : null),
          categories: [],
          categoriesSource: 'dom',
          sponsored: ns.utils.isSponsored(row) || Boolean(row.querySelector('a[href^="/aclk"]'))
        };
        // Read the details block line by line ("4.9(604) · Insurance agent"); textContent of the
        // whole block runs lines together ("Insurance agentDallas, TX").
        const details = row.querySelector('.rllt__details');
        const lines = details ? Array.from(details.children).map((c) => text(c)).filter((l) => l && l !== name) : [text(row).replace(name, '')];
        const cat = lines.map(categoryFromText).find(Boolean);
        if (cat) businessData.categories = [cat];

        const slot = row.querySelector('.rllt__details') || row;
        const container = ns.categoryUI.createCategoryContainer(slot, PACK_WIDGET);
        if (!container) continue;
        container._businessData = businessData;
        ns.actionButtons.mountButtons(container, () => businessData);
        ns.categoryUI.hydrateCategories(container, businessData);
        ns.categoryUI.resolveProfile(container, businessData);
      }
    }
  };
})(window.SphereGmb);
