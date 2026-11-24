/**
 * SphereGMB: Google Reviews Scraper & Exporter Module
 * Extracts customer reviews from Google Search and Google Maps reviews dialogs
 * and exports them into an RFC 4180 compliant CSV file.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const REVIEW_ITEM_SELECTORS = [
    '.gws-localreviews__google-review',
    '.bwb7ce[jsname="ShBeI"]',
    '.jftiEf',
    'div[data-review-id]',
    '.WMbnJf'
  ];

  const REVIEW_OPEN_TRIGGERS = [
    // 2026 knowledge panel: "57 Google reviews" is an <a href="#" role="button" data-fid>.
    '#rhs a[data-fid][role="button"]',
    'a.hoX6Hc[data-fid]',
    'a[data-fid][role="button"]',
    'a[href*="#lrd="]',
    'span.hqzQac a',
    'a.z5jxId',
    'a[data-attrid="subtitle"] a',
    'a.score-star',
    'a.fKDtId',
    'a.wUrVib',
    'a.CJq2Qe',
    'div.F7nice a',
    'a[data-async-trigger*="review" i]',
    'a[aria-label*="reviews" i]',
    '[data-sort-by="qualityScore"]',
    'a[href*="reviews"]'
  ];

  ns.reviewScraper = {
    isScraping: false,
    stopRequested: false,

    /**
     * Finds active reviews modal or sidebar container in DOM
     */
    findReviewsModal() {
      // 1. Find the "Write a review" button and traverse to its modal container
      const writeReviewBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        return text === 'write a review' || aria.includes('write a review');
      });

      if (writeReviewBtn) {
        let curr = writeReviewBtn.parentElement;
        while (curr && curr !== document.body) {
          const role = curr.getAttribute('role');
          const ariaModal = curr.getAttribute('aria-modal');
          const tag = curr.tagName.toLowerCase();
          if (role === 'dialog' || ariaModal === 'true' || tag === 'dialog' || curr.classList?.contains('review-dialog-list')) {
            return curr;
          }
          curr = curr.parentElement;
        }
        curr = writeReviewBtn.parentElement;
        while (curr && curr !== document.body) {
          if (curr.scrollHeight > 300 && curr.clientHeight > 200) {
            return curr;
          }
          curr = curr.parentElement;
        }
      }

      // 2. Any visible dialog that actually contains review cards (or the review sort control).
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog'));
      for (const d of dialogs) {
        if (d.closest('[data-sphere-gmb-root], .sgmb-modal-backdrop, .sgmb-modal-overlay')) continue;
        if (d.offsetParent === null && window.getComputedStyle(d).display === 'none') continue;
        if (d.querySelector('.gws-localreviews__google-review, .jftiEf, div[data-review-id], .review-dialog-list, [data-async-context*="review"]') ||
            (/write a review/i.test(d.textContent || '') && /sort by|most relevant|newest/i.test(d.textContent || ''))) {
          return d;
        }
      }

      return null;
    },

    /**
     * Finds the scrollable container inside the reviews modal or Maps panel
     */
    findScrollContainer(modal) {
      if (!modal) {
        return document.querySelector('div.m6QErb.DxyBCb, div.m6QErb[tabindex="0"]');
      }

      // 1. The element that actually scrolls and holds the review cards (Search 2026: .RVCQse).
      const scrolls = (el) => {
        const style = window.getComputedStyle(el);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 5;
      };
      const candidates = Array.from(modal.querySelectorAll('.RVCQse, .review-dialog-list, .gws-localreviews__general-reviews-list, .m6QErb, div, c-wiz'));
      const withCards = candidates.find((el) => scrolls(el) && el.querySelector('.bwb7ce, .gws-localreviews__google-review, .jftiEf, [data-review-id]'));
      if (withCards) return withCards;
      const anyScroller = candidates.find(scrolls);
      if (anyScroller) return anyScroller;

      // 3. Find parent of review cards
      const firstCard = modal.querySelector('.gws-localreviews__google-review, .jftiEf, div[data-review-id], .bwb7ce, .WMbnJf');
      if (firstCard && firstCard.parentElement) {
        return firstCard.parentElement;
      }

      return modal;
    },

    /**
     * Finds all review item elements inside the root container
     */
    findReviewItems(rootEl) {
      if (!rootEl) return [];

      // 1. Match by relative date leaf nodes (Guaranteed across all Google UI versions)
      const dateRegex = /\b\d+\s+(?:day|week|month|year|hour|minute)s?\s+ago\b|\ba\s+(?:day|week|month|year)\s+ago\b/i;
      const cards = new Set();

      const STAR_SEL = '[aria-label*="star" i], [aria-label*="Rated" i]';

      // Search 2026 dialog: one div.bwb7ce per review (owner reply nested inside it).
      const searchCards = Array.from(rootEl.querySelectorAll('div.bwb7ce'))
        .filter((c) => !c.parentElement?.closest('div.bwb7ce'));
      if (searchCards.length > 0) return searchCards;

      // Maps: review cards carry data-review-id, but nested elements repeat it. Keep the outermost.
      const mapsCards = Array.from(rootEl.querySelectorAll('div[data-review-id]'))
        .filter((c) => !c.parentElement?.closest('div[data-review-id]'));
      if (mapsCards.length > 0) return mapsCards;

      const allElements = Array.from(rootEl.querySelectorAll('span, div, time'));
      for (const el of allElements) {
        if (el.children.length === 0 && dateRegex.test(el.textContent || '')) {
          let card = el.parentElement;
          for (let i = 0; i < 7 && card && card !== rootEl; i++) {
            const text = (card.textContent || '').trim();
            if (card.querySelector(STAR_SEL) && text.length > 20) {
              cards.add(card);
              break;
            }
            card = card.parentElement;
          }
        }
      }

      if (cards.size > 0) {
        // An owner reply has its own date; climbing from it can land on a card nested inside
        // (or wrapping) the real one. Keep outermost cards that hold exactly one rating.
        const single = Array.from(cards).filter((c) => c.querySelectorAll(STAR_SEL).length <= 1);
        const outermost = single.filter((c) => !single.some((o) => o !== c && o.contains(c)));
        if (outermost.length > 0) return outermost;
      }

      // 2. Standard Google review selectors
      const standardItems = Array.from(rootEl.querySelectorAll(
        '.gws-localreviews__google-review, ' +
        '.bwb7ce[jsname="ShBeI"], ' +
        '.jftiEf, ' +
        'div[data-review-id], ' +
        '.WMbnJf, ' +
        'div[jscontroller][data-ved]'
      )).filter(el => {
        return el.querySelector('[aria-label*="star" i], [aria-label*="Rated" i], svg, .TSUbDb, .dehysf, .rsqaWe, .wiI7pd');
      });

      if (standardItems.length > 0) return standardItems;

      // 3. Author elements anchor container
      const authorEls = Array.from(rootEl.querySelectorAll('.TSUbDb, a[href*="/contrib/"], .d4r55, a.yC3ZMb, div.Vpc5Fe'));
      for (const a of authorEls) {
        const card = a.closest('div[data-review-id], div[jscontroller], div[role="article"], .gws-localreviews__google-review, div.WMbnJf') || a.parentElement?.parentElement?.parentElement;
        if (card && card !== rootEl && card.contains(a)) {
          cards.add(card);
        }
      }
      if (cards.size > 0) return Array.from(cards);

      // 4. Fallback: all direct review item wrappers
      return Array.from(rootEl.querySelectorAll(REVIEW_ITEM_SELECTORS.join(', ')));
    },

    /**
     * Injects an Export Reviews button directly into Google Search / Maps review modal header
     */
    injectModalExportButton() {
      const modal = this.findReviewsModal();
      if (!modal) return;

      if (modal.querySelector('#sgmb-modal-export-btn')) return;

      const total = this.readTargetCount(modal, null);
      const countStr = total ? ` (${ns.utils.formatNumber(total)})` : '';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'sgmb-modal-export-btn';
      btn.className = 'sgmb-modal-export-btn';
      btn.innerHTML = `${ns.utils.icons.download}<span>Export reviews to CSV${ns.utils.escapeHtml(countStr)}</span>`;
      btn.title = 'Extract all customer reviews with full text and download as CSV';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startExport(this.pendingAuditData || {});
      });

      // Find best placement: next to "Write a review" or near the top
      const writeReviewBtn = Array.from(modal.querySelectorAll('button, a')).find(el =>
        /write a review/i.test(el.textContent || el.getAttribute('aria-label') || '')
      );

      if (writeReviewBtn && writeReviewBtn.parentElement) {
        writeReviewBtn.parentElement.insertBefore(btn, writeReviewBtn);
        return;
      }

      // Fallback: place above reviews list or at modal top
      const headerContainer = modal.querySelector('.m6QErb, .review-dialog-list, div[role="heading"]')?.parentElement || modal.firstElementChild || modal;
      if (headerContainer && typeof headerContainer.insertAdjacentElement === 'function') {
        headerContainer.insertAdjacentElement('afterbegin', btn);
      }
    },

    /**
     * Expands all collapsed review text snippets in the given container
     */
    async expandAllMoreButtons(rootEl) {
      if (!rootEl) return;
      const moreButtons = Array.from(rootEl.querySelectorAll(
        'button.w8nwRe, a.review-more-link, span.review-more-link, .MtCSLb, ' +
        'button[aria-label="See more" i], a[role="button"][aria-expanded="false"], span[role="button"][aria-expanded="false"]'
      ));

      let clickedCount = 0;
      for (const btn of moreButtons) {
        if (btn.offsetParent !== null && !btn.dataset.sgmbExpanded) {
          const txt = (btn.textContent || '').trim().toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          // Only "More"/"See more"/"Read more" text expanders, never menus like "More options".
          if (btn.classList.contains('w8nwRe') || btn.classList.contains('review-more-link') || /^(…\s*)?(more|see more|read more)$/.test(txt) || aria === 'see more') {
            btn.dataset.sgmbExpanded = '1';
            try {
              btn.click();
              clickedCount++;
            } catch (e) {}
          }
        }
      }

      if (clickedCount > 0) {
        // Allow Google DOM microtask to expand and render the full text
        await new Promise((r) => setTimeout(r, 220));
      }
    },

    /**
     * Extracts star rating (1-5) from a review node
     */
    parseRating(reviewEl) {
      // 1. Check aria-labels
      const labelled = reviewEl.querySelector('[aria-label*="star" i], [aria-label*="Rated" i], [role="img"][aria-label*="out of 5" i], .Fam1ne');
      if (labelled) {
        const label = labelled.getAttribute('aria-label') || '';
        const numMatch = label.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) return parseFloat(numMatch[1]);
      }

      // 2. Count gold star SVGs (Search 2026 cards have no star label: 5 svgs in .h3PQJ,
      //    filled #fabb05, empty grey). Restrict to the star row so menu icons aren't counted.
      const starRow = reviewEl.querySelector('.h3PQJ, span.kvMYJc, .k0Ysuc');
      const svgs = starRow ? Array.from(starRow.querySelectorAll('svg')) : [];
      if (svgs.length > 0) {
        const filled = svgs.filter((svg) => {
          const path = svg.querySelector('path');
          const color = path?.getAttribute('fill') || svg.getAttribute('fill') || (path ? window.getComputedStyle(path).fill : '');
          return this.isGold(color);
        }).length;
        return filled || '';
      }

      return '';
    },

    /** True for yellow/gold star fills (#fabb05, #fbbc04, rgb(250,187,5)); false for greys. */
    isGold(color) {
      const c = String(color || '').trim().toLowerCase();
      let r;
      let g;
      let b;
      const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
      if (hex) {
        const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
        [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      } else {
        const rgb = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
        if (!rgb) return /gold|amber|orange|yellow/.test(c);
        [r, g, b] = rgb.slice(1, 4).map(Number);
      }
      return r > 200 && g > 120 && b < 100;
    },

    /**
     * Text of an element with <br> turned into line breaks and whitespace tidied per line.
     * `exclude` removes nested blocks (e.g. the sub-ratings box) before reading.
     */
    textWithBreaks(el, exclude = '') {
      if (!el) return '';
      const copy = el.cloneNode(true);
      if (exclude) copy.querySelectorAll(exclude).forEach((n) => n.remove());
      copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      copy.querySelectorAll('a.FrlmTe, a[role="button"]').forEach((a) => { if (/^more$/i.test(a.textContent.trim())) a.remove(); });
      return copy.textContent
        .split('\n')
        .map((line) => ns.utils.cleanText(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[\s…]*…\s*$/, '')
        .trim();
    },

    /** Google photo URL at original size (lh3 URLs carry the size after the last "="). */
    fullSizePhoto(url) {
      const u = String(url || '');
      if (!/googleusercontent\.com|ggpht\.com/.test(u)) return u;
      return u.replace(/=[^/=]*$/, '') + '=s0';
    },

    /**
     * Parser for the 2026 Google Search reviews dialog card (div.bwb7ce). Reads the hidden
     * full-text copy (no "More" click needed) and splits out the details Google appends inside it.
     */
    parseSearchCard(card) {
      const clean = ns.utils.cleanText;
      const names = card.querySelectorAll('.rhtdWc');
      const metas = card.querySelectorAll('.YE6B9b');
      const fullBlock = card.querySelector('.gbdaZe .d83Iyc') || card.querySelector('.EJ8fFf .d83Iyc') || card.querySelector('.d83Iyc');
      const detailBox = fullBlock?.querySelector('.zMjRQd');

      // Sub-ratings ("Food: 4/5 | Service: 5/5") and Q&A pairs ("Noise level" → "Quiet").
      let subRatings = '';
      const details = [];
      if (detailBox) {
        const ratingSpan = Array.from(detailBox.children).find((c) => c.tagName === 'SPAN' && /\d\/5/.test(c.textContent));
        subRatings = clean(ratingSpan?.textContent).replace(/\s*\|\s*/g, ' | ');
        const divs = Array.from(detailBox.querySelectorAll(':scope > div'));
        for (let i = 0; i + 1 < divs.length; i += 2) {
          const label = clean(divs[i].textContent);
          const value = clean(divs[i + 1].getAttribute('aria-label') || divs[i + 1].textContent);
          if (label && value) details.push(`${label}: ${value}`);
        }
      }

      const visit = Array.from(card.querySelectorAll('.ME0dBc [aria-label]')).map((s) => clean(s.textContent)).filter(Boolean).join(' | ');
      const photos = Array.from(card.querySelectorAll('.qydZOb img, img.SeRB9d')).filter((img, i, all) => all.indexOf(img) === i);
      const meta = clean(metas[0]?.textContent);
      const reviewsOfReviewer = meta.match(/([\d,]+)\s+reviews?/i);
      const photosOfReviewer = meta.match(/([\d,]+)\s+photos?/i);

      // Reaction count sits in the action row, outside the reaction picker popup.
      let likes = 0;
      const actions = card.querySelector('.svzjne');
      if (actions) {
        const copy = actions.cloneNode(true);
        copy.querySelectorAll('[role="dialog"], [role="menu"]').forEach((n) => n.remove());
        // The count is glued to the label text ("Hover to react2"), so no word boundary.
        const n = clean(copy.textContent).replace(/hover to react/i, ' ').match(/(\d+)/);
        likes = n ? parseInt(n[1], 10) : 0;
      }

      const ownerBlock = card.querySelector('.KmCjbd');
      const authorAnchor = card.querySelector('a.yC3ZMb');
      return {
        authorName: clean(names[0]?.textContent) || 'Google User',
        reviewerInfo: meta,
        localGuide: /local guide/i.test(meta),
        reviewerReviewCount: reviewsOfReviewer ? parseInt(reviewsOfReviewer[1].replace(/,/g, ''), 10) : '',
        reviewerPhotoCount: photosOfReviewer ? parseInt(photosOfReviewer[1].replace(/,/g, ''), 10) : '',
        rating: this.parseRating(card),
        dateText: clean(card.querySelector('.m6Mr5d, .y3Ibjb')?.textContent),
        isNew: Boolean(card.querySelector('.M2wKwd')),
        reviewText: this.textWithBreaks(fullBlock, '.zMjRQd'),
        visit,
        subRatings,
        details: details.join('; '),
        photoCount: photos.length,
        photoUrls: photos.map((img) => this.fullSizePhoto(img.getAttribute('src'))).filter(Boolean),
        photoCaptions: photos.map((img) => clean(img.getAttribute('alt'))).filter(Boolean),
        helpfulCount: likes,
        ownerResponse: this.textWithBreaks(ownerBlock),
        ownerResponseDate: ownerBlock && metas[1] ? clean(metas[1].textContent) : '',
        authorUrl: authorAnchor?.href || '',
        reviewId: card.querySelector('[data-review-id]')?.getAttribute('data-review-id') || card.getAttribute('data-id') || ''
      };
    },

    /**
     * Parses a single review item element into structured data
     */
    parseReviewItem(itemEl) {
      if (itemEl.classList?.contains('bwb7ce') && itemEl.querySelector('.rhtdWc')) return this.parseSearchCard(itemEl);

      // Author Name & Link
      let authorName = '';
      const authorEl = itemEl.querySelector('.TSUbDb a, .TSUbDb, a.yC3ZMb div.Vpc5Fe, .d4r55, .WNxFag, a[href*="/contrib/"], [class*="fullname"]');
      if (authorEl && authorEl.textContent.trim()) {
        authorName = authorEl.textContent.trim();
      } else {
        const candidate = itemEl.querySelector('[role="heading"], h3, h4, span.WggEif, div.Vpc5Fe, [class*="author"]');
        if (candidate) authorName = candidate.textContent.trim();
      }
      authorName = (authorName || 'Google User').replace(/\s*\d+\s+reviews?.*$/i, '').trim();

      const authorAnchor = itemEl.querySelector('.TSUbDb a, a.yC3ZMb, a.WNxFag, a[href*="/contrib/"], button.al6Kxe');
      const authorUrl = authorAnchor?.href || (authorAnchor?.getAttribute('data-href') ? `https://www.google.com${authorAnchor.getAttribute('data-href')}` : '');

      // Star Rating
      const rating = this.parseRating(itemEl);

      // Date Text
      const dateEl = itemEl.querySelector('.dehysf, .y3Ibjb, .rsqaWe, time, [aria-label*="ago"], .xRkGif');
      let dateText = dateEl?.textContent?.trim() || '';
      if (!dateText) {
        const dateMatch = (itemEl.textContent || '').match(/(\d+\s+(?:day|week|month|year|hour|minute)s?\s+ago|a\s+(?:day|week|month|year)\s+ago)/i);
        if (dateMatch) dateText = dateMatch[1].trim();
      }

      // Review Text (handles all Google variants)
      const textEl = itemEl.querySelector('.wiI7pd, .MyEned, [data-expandable-section], .OA1nbd, span.review-full-text, .review-snippet, span.full-review');
      let reviewText = textEl?.textContent?.trim() || '';

      const fullTextEl = itemEl.querySelector('span.review-full-text, span.full-review, span[jsname="bN97Pc"]');
      if (fullTextEl && fullTextEl.textContent.trim().length > reviewText.length) {
        reviewText = fullTextEl.textContent.trim();
      }

      if (!reviewText) {
        // Fallback: extract review text directly from itemEl innerText
        let fullCardText = itemEl.innerText || itemEl.textContent || '';
        fullCardText = fullCardText
          .replace(/\n[^\n]*\(Owner\)[\s\S]*$/i, '')
          .replace(/Response from the owner[\s\S]*$/i, '')
          .replace(/Hover to react[\s\S]*$/i, '')
          .replace(/Like\s+\d+.*$/i, '');
        const lines = fullCardText.split('\n').map(s => s.trim()).filter(s => {
          if (!s) return false;
          if (s === authorName) return false;
          if (/^\d+\s+reviews?$/i.test(s)) return false;
          if (/^\d+\s+(?:day|week|month|year)s?\s+ago$/i.test(s)) return false;
          if (/^New$/i.test(s)) return false;
          if (/^[★☆\s]+$/.test(s)) return false;
          if (/^Share$/i.test(s)) return false;
          return true;
        });
        reviewText = lines.join(' ').trim();
      }

      // Clean trailing ellipsis or More button artifacts
      reviewText = reviewText
        .replace(/[\s\u2026.]*More\s*$/i, '')
        .replace(/\s*\.\.\.\s*$/, '')
        .trim();

      // Likes / Helpful count
      const helpfulEl = itemEl.querySelector('button[aria-label*="helpful" i], button[aria-label*="Like" i], .znA2Ne, .GBkF3d');
      const helpfulText = helpfulEl?.textContent?.trim() || '';
      const helpfulCount = ns.utils.parseFirstNumber(helpfulText) || 0;

      // Owner Response
      const responseEl = itemEl.querySelector('.CDe7pd, .wiI7pd[jsname="W5007e"], div.fnOfG, .d6SCc');
      let ownerResponse = responseEl ? responseEl.textContent.replace(/Response from the owner/i, '').trim() : '';
      if (!ownerResponse) {
        const ownerMatch = (itemEl.innerText || itemEl.textContent || '').match(/(?:Response from the owner|\(Owner\))\s*\n*(?:[^\n]+\n+)?([\s\S]*?)(?:Hover to react|Share|$)/i);
        if (ownerMatch && ownerMatch[1]) {
          ownerResponse = ownerMatch[1].replace(/Hover to react|Share/gi, '').trim();
        }
      }

      return {
        authorName,
        rating,
        dateText,
        reviewText,
        helpfulCount,
        ownerResponse,
        authorUrl
      };
    },

    /**
     * Shows a floating progress toast during review scraping
     */
    showToast(message, count = 0, target = 0, onStop = null) {
      if (typeof target === 'function') {
        onStop = target;
        target = 0;
      }

      let toast = document.getElementById('sgmb-review-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sgmb-review-toast';
        toast.className = 'sgmb-review-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
      }

      let statusSubtitle = 'Please wait...';
      if (count > 0 && target > 0) {
        statusSubtitle = `${count} of ${target} reviews extracted`;
      } else if (count > 0) {
        statusSubtitle = `${count} reviews extracted`;
      }

      // Build the toast once and then only update its text, so a focused "Download CSV"
      // button keeps keyboard focus while progress ticks.
      const wantsButton = String(Boolean(onStop));
      if (!toast.querySelector('.sgmb-toast-spinner') || toast.dataset.hasButton !== wantsButton) {
        toast.innerHTML = `
          <div class="sgmb-toast-content">
            <div class="sgmb-toast-spinner"></div>
            <div class="sgmb-toast-text"><strong></strong><span></span></div>
            ${onStop ? '<button id="sgmb-toast-download" class="sgmb-toast-btn" type="button"></button>' : ''}
            <button id="sgmb-toast-close" class="sgmb-toast-close" type="button" title="Close" aria-label="Close">&times;</button>
          </div>`;
        toast.dataset.hasButton = wantsButton;
        toast.querySelector('#sgmb-toast-download')?.addEventListener('click', () => toast._sgmbOnStop?.());
        toast.querySelector('#sgmb-toast-close')?.addEventListener('click', () => this.hideToast());
      }
      toast._sgmbOnStop = onStop;
      const setText = (sel, value) => {
        const el = toast.querySelector(sel);
        if (el && el.textContent !== value) el.textContent = value;
      };
      setText('.sgmb-toast-text strong', message);
      setText('.sgmb-toast-text span', statusSubtitle);
      setText('#sgmb-toast-download', `Download CSV (${count})`);
    },

    /**
     * Hides the toast after `ms`, but waits while the pointer is over it or it has keyboard
     * focus, so people have time to read it (WCAG 2.2.1 Timing adjustable).
     */
    scheduleHide(ms = 5000) {
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        const toast = document.getElementById('sgmb-review-toast');
        if (toast && toast.matches(':hover, :focus-within')) this.scheduleHide(1500);
        else this.hideToast();
      }, ms);
    },

    /** Short confirmation ("Saved …"), shown in the toast and announced to screen readers. */
    notify(message, detail = '') {
      this.showToast(message);
      const toast = document.getElementById('sgmb-review-toast');
      toast?.querySelector('.sgmb-toast-spinner')?.remove();
      const sub = toast?.querySelector('.sgmb-toast-text span');
      if (sub) sub.textContent = detail;
      this.scheduleHide(5000);
    },

    hideToast() {
      const toast = document.getElementById('sgmb-review-toast');
      if (toast) toast.remove();
    },


    /** Builds the reviews CSV (RFC 4180, UTF-8 BOM). */
    reviewsToCsv(businessName, reviews) {
      const columns = [
        ['Business Name', () => businessName],
        ['Reviewer Name', (r) => r.authorName],
        ['Star Rating', (r) => r.rating],
        ['Review Date', (r) => r.dateText],
        ['Review Text', (r) => r.reviewText],
        ['Likes', (r) => r.helpfulCount],
        ['Owner Response', (r) => r.ownerResponse],
        ['Owner Response Date', (r) => r.ownerResponseDate],
        ['Visit', (r) => r.visit],
        ['Sub-ratings', (r) => r.subRatings],
        ['Review Details', (r) => r.details],
        ['Photo Count', (r) => r.photoCount],
        ['Photo URLs', (r) => (r.photoUrls || []).join(' ')],
        ['Photo Captions', (r) => (r.photoCaptions || []).join(' | ')],
        ['Local Guide', (r) => (r.localGuide === undefined ? '' : r.localGuide ? 'yes' : 'no')],
        ['Reviewer Review Count', (r) => r.reviewerReviewCount],
        ['Reviewer Photo Count', (r) => r.reviewerPhotoCount],
        ['Reviewer Info', (r) => r.reviewerInfo],
        ['Reviewer Profile URL', (r) => r.authorUrl],
        ['New', (r) => (r.isNew ? 'yes' : '')],
        ['Review ID', (r) => r.reviewId]
      ];
      const q = (val) => `"${ns.utils.csvSafe(val).replace(/"/g, '""')}"`;
      const rows = [columns.map(([h]) => q(h)).join(',')];
      for (const r of reviews) rows.push(columns.map(([, get]) => q(get(r))).join(','));
      return String.fromCharCode(0xfeff) + rows.join('\r\n');
    },

    exportReviewsToCsv(businessName, reviews) {
      if (!reviews || reviews.length === 0) {
        this.showToast('No reviews found to export.');
        this.scheduleHide(5000);
        return;
      }
      const filename = `reviews-${ns.utils.slug(businessName, 'business')}-${new Date().toISOString().slice(0, 10)}.csv`;
      ns.utils.downloadFile(filename, this.reviewsToCsv(businessName, reviews));
      this.showSummary(filename, this.summarizeReviews(reviews));
    },

    /**
     * Reputation numbers from the exported reviews: average, star distribution,
     * owner-reply rate, and low ratings still without a reply.
     */
    summarizeReviews(reviews) {
      const list = Array.isArray(reviews) ? reviews : [];
      const rated = list.map((r) => Number(r.rating)).filter((n) => n >= 1 && n <= 5);
      const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      rated.forEach((n) => { distribution[Math.round(n)]++; });
      const replied = list.filter((r) => String(r.ownerResponse || '').trim()).length;
      const lowUnanswered = list.filter((r) => Number(r.rating) > 0 && Number(r.rating) <= 2 && !String(r.ownerResponse || '').trim()).length;
      return {
        total: list.length,
        average: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 100) / 100 : null,
        distribution,
        replyRate: list.length ? Math.round((replied / list.length) * 100) : 0,
        withText: list.filter((r) => String(r.reviewText || '').trim()).length,
        lowUnanswered
      };
    },

    /** Final toast: file saved + a compact reputation summary. Stays until closed. */
    showSummary(filename, s) {
      this.showToast(`Saved ${s.total} reviews`, s.total);
      const toast = document.getElementById('sgmb-review-toast');
      const text = toast?.querySelector('.sgmb-toast-text');
      if (!text) return;
      toast.querySelector('.sgmb-toast-spinner')?.remove();
      const max = Math.max(1, ...Object.values(s.distribution));
      const bars = [5, 4, 3, 2, 1].map((star) => `
        <span aria-label="${star} stars">${star}<svg class="sgmb-icon" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="margin-left:2px;vertical-align:-1px"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg></span>
        <span class="sgmb-bar-track"><span class="sgmb-bar-fill" style="width:${Math.round((s.distribution[star] / max) * 100)}%"></span></span>
        <span>${s.distribution[star]}</span>`).join('');
      const summary = document.createElement('div');
      summary.className = 'sgmb-review-summary';
      summary.innerHTML = `
        <div class="sgmb-review-summary-head">
          ${s.average !== null ? `Average ${s.average} · ` : ''}${s.replyRate}% answered by owner${s.lowUnanswered ? ` · ${s.lowUnanswered} low rating(s) unanswered` : ''}
        </div>${bars}`;
      text.querySelector('span').textContent = filename;
      text.appendChild(summary);
    },

    /** Total review count from the dialog header (not from a reviewer's "Local Guide · 45 reviews"). */
    readTargetCount(modal, businessData) {
      const known = Number(businessData?.numReviews) || 0;
      if (known > 0) return known;
      const header = modal?.querySelector('.z5jxId, .jANrlb .fontBodySmall, [aria-label$="reviews" i]');
      const fromHeader = header ? ns.utils.parseFirstNumber(header.getAttribute('aria-label') || header.textContent) : 0;
      if (fromHeader > 0) return fromHeader;
      const head = (modal?.textContent || '').slice(0, 400).match(/([\d,]+)\s+reviews?/i);
      return head ? parseInt(head[1].replace(/,/g, ''), 10) : 0;
    },

    /** Clicks the visible "N reviews" link in the knowledge panel to open Google's reviews dialog. */
    triggerReviewsDialog() {
      for (const sel of REVIEW_OPEN_TRIGGERS) {
        const trigger = Array.from(document.querySelectorAll(sel)).find((t) => t.offsetParent !== null && !t.closest('[data-sphere-gmb-root]'));
        if (trigger) {
          try { trigger.click(); return true; } catch (e) { /* try next */ }
        }
      }
      return false;
    },

    /**
     * Opens the reviews dialog if needed, auto-scrolls it to load every review, and downloads a CSV.
     * On Google Maps it hands off to a Google Search tab instead (Maps' review pane is fragile).
     */
    async startExport(businessData) {
      if (this.isScraping) {
        this.showToast('A review export is already running in this tab.');
        return;
      }

      if (ns.utils.isMaps()) {
        this.showToast(`Opening Google Search reviews for "${businessData?.name || 'this business'}"…`);
        const res = await ns.utils.sendMessage({ type: 'runAuditReview', payload: businessData || {} });
        if (res.error) this.showToast('Extension was updated. Reload this tab, then try again.');
        return;
      }

      this.isScraping = true;
      this.stopRequested = false;
      try {
        await this.scrapeAndExport(businessData || {});
      } catch (err) {
        ns.utils.log('Review export failed:', err);
        this.showToast('Review export stopped because of an error. Check the console for details.');
      } finally {
        this.isScraping = false;
        ns.utils.sendMessage({ type: 'releaseDebugger' });
      }
    },

    async scrapeAndExport(businessData) {
      let modal = this.findReviewsModal();

      if (!modal) {
        this.showToast('Opening reviews dialog…');
        this.triggerReviewsDialog();
        for (let i = 0; i < 16 && !modal; i++) {
          await ns.utils.sleep(500);
          modal = this.findReviewsModal();
          if (!modal && (i === 3 || i === 8)) this.triggerReviewsDialog();
        }
      }

      if (!modal) {
        // No dialog on this page, let the service worker open a Search tab with #lrd for this place.
        if (businessData.featureId || businessData.name) {
          this.showToast('Opening a dedicated review tab…');
          await ns.utils.sendMessage({ type: 'runAuditReview', payload: businessData });
          this.scheduleHide(5000);
        } else {
          this.showToast('Could not find the reviews dialog. Click the "reviews" link on the business panel, then press Export again.');
        }
        return;
      }

      const titleEl = modal.querySelector('.Lhccdd div, [role="heading"], h2, h1');
      const businessName = ns.utils.cleanText(businessData.name)
        || ns.utils.cleanText(titleEl?.textContent)
        || document.title.replace(/\s*[-–\u2014]\s*Google\s+(Search|Maps).*$/i, '').trim()
        || 'business';

      const target = this.readTargetCount(modal, businessData);
      const maxReviews = target > 0 ? Math.min(target, 2000) : 500;
      const scrollContainer = this.findScrollContainer(modal);
      const collected = new Map();

      const collect = () => {
        for (const item of this.findReviewItems(modal)) {
          const rev = this.parseReviewItem(item);
          const key = rev.reviewId || item.getAttribute('data-review-id') || `${rev.authorName}|${rev.dateText}|${rev.rating}|${rev.reviewText.slice(0, 40)}`;
          if (!collected.has(key)) collected.set(key, rev);
        }
      };

      const stop = () => { this.stopRequested = true; };
      let trusted = true; // trusted wheel via chrome.debugger; falls back to assisted scrolling
      const updateProgress = () => {
        const msg = trusted ? 'Extracting Google reviews…' : 'Scroll the reviews list to load more, collecting as you scroll';
        this.showToast(msg, collected.size, target, stop);
        const bannerText = document.querySelector('#sgmb-auto-banner .sgmb-banner-text span');
        if (bannerText) bannerText.textContent = target ? `Extracted ${collected.size} of ${target} reviews…` : `Extracted ${collected.size} reviews…`;
      };

      const cardCount = () => this.findReviewItems(modal).length;
      let stale = 0;

      while (!this.stopRequested && collected.size < maxReviews) {
        await this.expandAllMoreButtons(modal);
        collect();
        updateProgress();
        if (target > 0 && collected.size >= target) break;

        const before = cardCount();
        if (trusted && scrollContainer) {
          // Google loads the next page only when a trusted wheel scrolls the list into its last
          // few hundred pixels. Jump there programmatically (allowed), then send one real wheel
          // so the list actually moves. A wheel at the very bottom moves nothing and is ignored.
          scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight - 300);
          await ns.utils.sleep(150);
          const ok = await this.trustedScroll(scrollContainer);
          if (!ok) {
            trusted = false;
            updateProgress();
          }
        }

        // Wait for Google to append the next page (it loads ~10 reviews per request).
        const waitMs = trusted ? 5000 : 30000;
        let grew = false;
        for (let t = 0; t < waitMs && !this.stopRequested; t += 250) {
          await ns.utils.sleep(250);
          if (cardCount() > before) {
            grew = true;
            break;
          }
        }
        if (grew) {
          stale = 0;
          await ns.utils.sleep(400); // let the batch finish rendering
        } else if (++stale >= (trusted ? 3 : 1)) {
          break;
        }
      }

      await this.expandAllMoreButtons(modal);
      collect();
      await ns.utils.sendMessage({ type: 'releaseDebugger' });
      this.exportReviewsToCsv(businessName, Array.from(collected.values()));
    },

    /**
     * Sends a real mouse-wheel event over the list through the service worker (chrome.debugger).
     * Returns false when trusted input isn't available (permission missing, user cancelled Chrome's
     * debugging bar, or DevTools-style attach refused).
     */
    async trustedScroll(scrollContainer) {
      const rect = scrollContainer.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const x = Math.round(Math.min(window.innerWidth - 5, Math.max(5, rect.left + rect.width / 2)));
      const y = Math.round(Math.min(window.innerHeight - 5, Math.max(5, rect.top + rect.height * 0.6)));
      const res = await ns.utils.sendMessage({ type: 'trustedWheel', payload: { x, y, deltaY: 900 } });
      if (!res || !res.ok) {
        ns.utils.log('Trusted scroll unavailable:', res?.error);
        return false;
      }
      return true;
    }
  };
})(window.SphereGmb);
