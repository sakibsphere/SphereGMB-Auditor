/**
 * GBP Sphere: Google Maps Adapter Module
 * Mounts the widget into the open place panel and into search-result feed cards.
 */

window.SphereGmb = window.SphereGmb || {};

(function (ns) {
  'use strict';

  const PLACE_WIDGET = 'sgmb-maps-place';
  const CARD_WIDGET = 'sgmb-maps-card';

  function attr(el, name) {
    return el ? el.getAttribute(name) || '' : '';
  }

  /** Reads the visible NAP + rating values from an open place panel. */
  function readPlacePanel(main, h1) {
    const clean = ns.utils.cleanText;
    const ratingBlock = main.querySelector('div.F7nice');
    const ratingText = clean(main.querySelector('div.F7nice span[aria-hidden="true"]')?.textContent);
    const rating = parseFloat(ratingText);
    const countMatch = clean(ratingBlock?.textContent).match(/\(([\d.,\s]+)\)/);

    const addressBtn = main.querySelector('button[data-item-id="address"]');
    const phoneBtn = main.querySelector('button[data-item-id^="phone"]');
    const websiteEl = main.querySelector('a[data-item-id="authority"]');
    const categoryBtn = main.querySelector('button.DkEaL');

    return {
      name: clean(h1.textContent),
      rating: !isNaN(rating) && rating <= 5 ? rating : null,
      numReviews: countMatch ? ns.utils.parseFirstNumber(countMatch[1]) : 0,
      address: clean(attr(addressBtn, 'aria-label').replace(/^Address:\s*/i, '')) || clean(addressBtn?.textContent),
      phone: clean(attr(phoneBtn, 'aria-label').replace(/^Phone:\s*/i, '')) || clean(phoneBtn?.textContent),
      website: ns.utils.safeUrl(attr(websiteEl, 'href')),
      primaryCategory: clean(categoryBtn?.textContent)
    };
  }

  /** Category text from a results-feed card, e.g. "4.5(2,867) · $$ Mexican restaurant · Floor 1". */
  function readCardCategory(card) {
    const text = ns.utils.cleanText(card.querySelector('.W4Efsb')?.textContent || card.textContent);
    for (const raw of text.split(/[·‧•]/)) {
      const seg = raw.replace(/^[\s$€£¥₹৳₩₺]+/, '').trim();
      if (seg.length > 2 && seg.length < 45 && !/\d/.test(seg) && !/^(open|closed|opens|closes|website|directions|dine-in|takeout|delivery)\b/i.test(seg)) {
        return seg;
      }
    }
    return '';
  }

  /** Row 2 under the header block (.tAiQdd), spanning the panel width. */
  function mountPlaceWidget(tAiQdd, h1, container) {
    const header = h1.closest('.TIHn2');
    if (tAiQdd) tAiQdd.insertAdjacentElement('afterend', container);
    else if (header) header.appendChild(container);
    else h1.parentElement.insertAdjacentElement('afterend', container);
  }

  /** Search term from /maps/search/<term>/… for file names. */
  function listLabel() {
    const m = window.location.pathname.match(/\/maps\/search\/([^/@]+)/);
    try {
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : 'maps-results';
    } catch (e) {
      return 'maps-results';
    }
  }

  /** "Export list" bar above the results feed. */
  function ensureListBar(feed) {
    const cardCount = feed.querySelectorAll('.sgmb-maps-card').length;
    let bar = document.querySelector('.sgmb-list-bar');
    if (bar && bar.nextElementSibling !== feed) {
      bar.remove();
      bar = null;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sgmb-list-bar';
      bar.dataset.sphereGmbRoot = '1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sgmb-action-btn sgmb-list-export';
      const icon = document.createElement('span');
      icon.className = 'sgmb-list-icon';
      icon.innerHTML = ns.utils.icons.download;
      const text = document.createElement('span');
      text.className = 'sgmb-list-label';
      btn.append(icon, text);
      const hint = document.createElement('span');
      hint.className = 'sgmb-list-hint';
      hint.textContent = 'Scroll the list to load more results first';
      bar.append(btn, hint);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exportFeed(feed, btn);
      }, { capture: true });
      feed.insertAdjacentElement('beforebegin', bar);
    }
    const label = bar.querySelector('.sgmb-list-label');
    const next = `Export list (${cardCount})`;
    // Writing the same text again is still a DOM mutation, which would trigger another scan.
    if (!bar.dataset.busy && label.textContent !== next) label.textContent = next;
  }

  async function exportFeed(feed, btn) {
    const bar = btn.closest('.sgmb-list-bar');
    if (bar.dataset.busy) return;
    bar.dataset.busy = '1';
    const label = btn.querySelector('.sgmb-list-label');
    try {
      const rows = Array.from(feed.querySelectorAll('.sgmb-maps-card')).map((c) => c._businessData).filter(Boolean);
      let done = 0;
      await Promise.all(rows.map(async (row) => {
        if (row.featureId && !row.profileLoaded) {
          ns.utils.mergeProfile(row, await ns.api.fetchPlaceProfile(row.featureId));
        }
        done++;
        label.textContent = `Loading profiles ${done}/${rows.length}…`;
      }));
      const file = ns.csvExporter.exportList(rows, listLabel());
      label.textContent = file ? `Saved ${rows.length} businesses` : 'Nothing to export';
    } finally {
      setTimeout(() => {
        delete bar.dataset.busy;
        ensureListBar(feed);
      }, 2500);
    }
  }

  ns.domMaps = {
    ensureListBar,

    /** Widget for the open place panel (one per page). */
    async processMapsPlace() {
      if (!ns.utils.isMaps()) return;

      // A results list also has an <h1> ("Results"), so the generic fallback is only trusted on
      // /maps/place/ URLs.
      const onPlaceUrl = window.location.pathname.includes('/maps/place/');
      const h1 = document.querySelector('div[role="main"] h1.DUwDvf') || (onPlaceUrl ? document.querySelector('div[role="main"] h1') : null);
      const main = h1?.closest('div[role="main"]');

      // Remove place widgets that are no longer inside the open place panel (e.g. mounted
      // during page load, or left behind after closing the panel).
      document.querySelectorAll(`.${PLACE_WIDGET}`).forEach((w) => {
        if (!main || !main.contains(w)) w.remove();
      });
      if (!h1 || !main) return;

      const dom = readPlacePanel(main, h1);
      if (!dom.name) return;

      // The URL only carries the place's feature ID once Maps has finished navigating.
      const urlFeatureId = onPlaceUrl ? ns.cidParser.parseFeatureId(decodeURIComponent(window.location.href)) : null;

      const tAiQdd = main.querySelector('.tAiQdd');
      let container = main.querySelector(`.${PLACE_WIDGET}`);

      if (container) {
        const bd = container._businessData || {};
        const switchedPlace = (urlFeatureId && bd.featureId && urlFeatureId !== bd.featureId) || (bd.domName && bd.domName !== dom.name);
        if (switchedPlace) {
          container.remove();
          container = null;
        }
      }

      if (container) {
        // Same place: keep it in row 2 under the header if Maps re-rendered around it.
        if (tAiQdd && container.previousElementSibling !== tAiQdd) tAiQdd.insertAdjacentElement('afterend', container);
        const bd = container._businessData;
        if (!bd.featureId && urlFeatureId) {
          bd.featureId = urlFeatureId;
          container.dataset.sgmbFid = urlFeatureId;
          bd.placeCID = ns.cidParser.parsePlaceCID(urlFeatureId);
          ns.categoryUI.resolveProfile(container, bd);
        }
        return;
      }

      const businessData = {
        name: dom.name,
        domName: dom.name,
        address: dom.address,
        phone: dom.phone,
        website: dom.website,
        rating: dom.rating,
        numReviews: dom.numReviews,
        featureId: urlFeatureId,
        placeCID: urlFeatureId ? ns.cidParser.parsePlaceCID(urlFeatureId) : null,
        categories: dom.primaryCategory ? [dom.primaryCategory] : [],
        categoriesSource: 'dom'
      };

      container = ns.categoryUI.buildContainer(PLACE_WIDGET);
      // Visible to DevTools and tests (content-script JS properties are not visible to the page).
      container.dataset.sgmbName = dom.name;
      if (urlFeatureId) container.dataset.sgmbFid = urlFeatureId;
      mountPlaceWidget(tAiQdd, h1, container);
      container._businessData = businessData;

      ns.actionButtons.mountButtons(container, () => container._businessData);
      ns.categoryUI.hydrateCategories(container, businessData);
      if (businessData.featureId) await ns.categoryUI.resolveProfile(container, businessData);
    },

    /** Widgets for cards in the search results feed (left sidebar list). */
    async processMapsSearch() {
      if (!ns.utils.isMaps()) return;

      // Only cards in the results feed. Place panels also contain Nv2PK cards
      // ("People also search for"), which must not get a toolbar.
      const cards = document.querySelectorAll('div[role="feed"] div.Nv2PK, div[role="feed"] div[role="article"]');

      for (const card of cards) {
        if (card.getAttribute('data-sgmb-spidered') === '1') continue;
        if (card.parentElement?.closest('[data-sgmb-spidered="1"]')) continue;

        const name = ns.utils.cleanText(card.querySelector('.qBF1Pd, .fontHeadlineSmall')?.textContent || attr(card, 'aria-label'));
        if (!name) continue;
        card.setAttribute('data-sgmb-spidered', '1');

        const href = attr(card.querySelector('a.hfpxzc, a[href*="/maps/place/"]'), 'href');
        const featureId = ns.cidParser.parseFeatureId(decodeURIComponent(href));
        const ratingEl = card.querySelector('span.MW4etd');
        const reviewsEl = card.querySelector('span.UY7F9');
        const category = readCardCategory(card);

        const businessData = {
          name,
          rating: ratingEl ? parseFloat(ratingEl.textContent) || null : null,
          numReviews: reviewsEl ? ns.utils.parseFirstNumber(reviewsEl.textContent) : 0,
          featureId,
          placeCID: featureId ? ns.cidParser.parsePlaceCID(featureId) : null,
          categories: category ? [category] : [],
          categoriesSource: 'dom',
          // Ads are not competitors in the organic results (benchmark and list position skip them).
          sponsored: ns.utils.isSponsored(card)
        };

        const container = ns.categoryUI.createCategoryContainer(card, CARD_WIDGET);
        if (!container) continue;
        container._businessData = businessData;
        ns.actionButtons.mountButtons(container, () => businessData);
        ns.categoryUI.hydrateCategories(container, businessData);
        ns.categoryUI.resolveProfile(container, businessData);
      }

      const feed = document.querySelector('div[role="feed"]');
      if (feed && feed.querySelector('.sgmb-maps-card')) ensureListBar(feed);
      else document.querySelector('.sgmb-list-bar')?.remove();
    }
  };
})(window.SphereGmb);
