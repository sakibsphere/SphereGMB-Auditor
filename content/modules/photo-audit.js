/**
 * SphereGMB: Media Audit (photos and videos)
 * Opens Google's photo viewer from the Search knowledge panel ("See photos"), walks every
 * category tab, loads every tile and counts photos and videos per category. Photos can be
 * downloaded at original size and videos as MP4. On Maps it opens a Search tab and runs there.
 *
 * Downloads are for auditing your own or your client's profile. Customer photos belong to the
 * people who took them.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const OVERLAY_ID = 'sgmb-photo-audit-overlay';
  const SKIP_LABELS = /^(close|close dialogue|close dialog|previous|next|report photo|share|back)$/i;
  const esc = (v) => ns.utils.escapeHtml(v);
  const sleep = (ms) => ns.utils.sleep(ms);

  function fullSize(url) {
    return ns.reviewScraper.fullSizePhoto(url);
  }

  ns.photoAudit = {
    viewer() {
      return Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => /photos/i.test(d.getAttribute('aria-label') || '') && (d.offsetParent !== null || getComputedStyle(d).position === 'fixed'));
    },

    async openViewer() {
      const btn = Array.from(document.querySelectorAll('#rhs button, #rhs [role="button"], [data-attrid] button'))
        .find((b) => /^see (all )?photos$/i.test(ns.utils.cleanText(b.textContent)));
      if (!btn) return null;
      btn.click();
      // Wait for the category bar, which renders shortly after the first images.
      let v = null;
      for (let i = 0; i < 25; i++) {
        await sleep(400);
        v = this.viewer();
        if (v && v.querySelector('[aria-label^="Change collection to" i]')) return v;
      }
      return v && v.querySelector('img[src*="googleusercontent"]') ? v : null;
    },

    /**
     * The scrollable thumbnail grid. The viewer nests it inside an outer area that also holds the
     * large preview (and barely scrolls), so take the innermost scroller with Google images and
     * the longest scroll range.
     */
    grid(viewer) {
      // Chosen by structure, not by current scroll height (a short category, or a tab in the
      // background, can report no scrollable height): the innermost overflow:auto container
      // holding thumbnails that are not the category tabs' cover images.
      const isThumb = (img) => !img.closest('[aria-label^="Change collection to" i]');
      const scrollers = Array.from(viewer.querySelectorAll('div')).filter((e) => {
        if (!/(auto|scroll)/.test(window.getComputedStyle(e).overflowY)) return false;
        return Array.from(e.querySelectorAll('img[src*="googleusercontent"]')).some(isThumb);
      });
      const innermost = scrollers.filter((s) => !scrollers.some((o) => o !== s && s.contains(o)));
      const found = innermost.sort((a, b) => b.querySelectorAll('img').length - a.querySelectorAll('img').length)[0] || null;
      if (found) this._grid = found;
      return found || (this._grid && this._grid.isConnected && viewer.contains(this._grid) ? this._grid : null);
    },

    /** Scrolls the grid until the tile count holds steady for two checks in a row. */
    async loadAll(viewer) {
      const g = this.grid(viewer);
      if (!g) return;
      let last = -1;
      let steady = 0;
      for (let i = 0; i < 80 && steady < 2; i++) {
        g.scrollTop = g.scrollHeight;
        await sleep(800);
        const n = g.querySelectorAll('img[src*="googleusercontent"]').length;
        if (n === last) steady++;
        else {
          steady = 0;
          last = n;
        }
      }
      g.scrollTop = 0;
    },

    firstTile(viewer) {
      return (this.grid(viewer) || viewer).querySelector('img[src*="googleusercontent"]')?.getAttribute('src') || '';
    },

    /** Clicks a category tab and waits until the grid actually shows that category. */
    async switchCategory(viewer, btn) {
      const before = this.firstTile(viewer);
      btn.click();
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        const pressed = btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-selected') === 'true';
        const changed = this.firstTile(viewer) !== before;
        if (pressed && (changed || i >= 8)) break;
      }
      await sleep(900);
    },

    tiles(viewer) {
      const g = this.grid(viewer) || viewer;
      return Array.from(g.querySelectorAll('img[src*="googleusercontent"]')).filter((img) => !img.closest('[aria-label^="Change collection to" i]')).map((img) => {
        const tile = img.closest('[role="button"]') || img.parentElement;
        const duration = Array.from(tile.querySelectorAll('span, div')).map((e) => ns.utils.cleanText(e.textContent)).find((t) => /^\d{1,2}:\d{2}$/.test(t)) || '';
        return { thumb: img.getAttribute('src'), url: fullSize(img.getAttribute('src')), video: Boolean(duration), duration };
      });
    },

    /** Category tabs ("All", "By owner", "Videos"…): each has aria-label "Change collection to X". */
    categoryButtons(viewer) {
      const labelled = Array.from(viewer.querySelectorAll('[aria-label^="Change collection to" i]'));
      if (labelled.length) return labelled;
      // Fallback for other layouts: short-text buttons outside the thumbnail grid.
      const seen = new Set();
      const grid = this.grid(viewer);
      return Array.from(viewer.querySelectorAll('[role="tab"], [role="button"], button')).filter((b) => {
        const t = ns.utils.cleanText(b.textContent);
        if (!t || t.length > 32 || SKIP_LABELS.test(t) || /^\d{1,2}:\d{2}$/.test(t) || seen.has(t)) return false;
        if (grid && grid.contains(b)) return false;
        seen.add(t);
        return true;
      });
    },

    categoryName(btn) {
      const label = btn.getAttribute('aria-label') || '';
      const m = label.match(/^change collection to (.+)$/i);
      return ns.utils.cleanText(m ? m[1] : btn.textContent);
    },

    async collect(onProgress = () => {}) {
      const viewer = await this.openViewer();
      if (!viewer) return { error: 'no_viewer' };

      const categories = {};
      const videos = new Map();
      const photos = new Map();
      const buttons = this.categoryButtons(viewer);
      for (const btn of buttons) {
        const name = this.categoryName(btn);
        onProgress(`Counting "${name}"…`);
        await this.switchCategory(viewer, btn);
        await this.loadAll(viewer);
        const tiles = this.tiles(viewer);
        categories[name] = { total: tiles.length, videos: tiles.filter((t) => t.video).length };
        tiles.forEach((t) => {
          if (t.video) return;
          if (!photos.has(t.url)) photos.set(t.url, { ...t, category: name });
        });
        if (/video/i.test(name)) categories[name].videos = tiles.length;
        // Video files: the viewer preloads <video> elements for the current category.
        viewer.querySelectorAll('video').forEach((v) => {
          const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
          // The same video appears at several sizes ("...=m18", "...=m22"): count it once.
          if (/googleusercontent\.com/.test(src)) {
            const key = src.split('=')[0];
            if (!videos.has(key)) videos.set(key, { url: src });
          }
        });
      }

      // Close with the viewer's own button; history.back() can step past it and reload the page.
      viewer.querySelector('[aria-label^="Close" i]')?.click();

      const all = categories.All || categories[Object.keys(categories)[0]] || { total: 0, videos: 0 };
      const videoTotal = Object.entries(categories).find(([k]) => /video/i.test(k))?.[1].total ?? all.videos;
      const byOwner = Object.entries(categories).find(([k]) => /owner/i.test(k))?.[1].total;
      // The headline numbers are exactly the unique items found across every tab, i.e. what the
      // download buttons save. Tab totals are kept separately because Google's tabs overlap
      // ("All" can show fewer items than "By owner") and must not be presented as the total.
      return {
        categories,
        photoCount: photos.size,
        videoCount: videos.size,
        videoTabCount: videoTotal || 0,
        allTabCount: all.total || 0,
        ownerCount: byOwner,
        photos: Array.from(photos.values()),
        videos: Array.from(videos.values())
      };
    },

    async show(businessData) {
      const data = businessData || {};
      if (ns.utils.isMaps()) {
        ns.reviewScraper.showToast(`Opening Google Search to count photos for "${data.name || 'this business'}"…`);
        const res = await ns.utils.sendMessage({ type: 'runAuditPhoto', payload: data });
        if (res.error) ns.reviewScraper.showToast('Extension was updated. Reload this tab, then try again.');
        else ns.reviewScraper.scheduleHide(5000);
        return;
      }
      if (this.running) return;
      this.running = true;
      this.renderShell(data);
      try {
        const r = await this.collect((m) => this.setStatus(m));
        this.render(data, r);
      } catch (err) {
        ns.utils.log('Media audit failed:', err);
        this.renderError(data, 'Google\'s photo viewer changed or didn\'t load. Close it if it is open, then try again.');
      } finally {
        this.running = false;
      }
    },

    renderError(data, message) {
      const body = document.querySelector(`#${OVERLAY_ID} [data-body]`);
      const footer = document.querySelector(`#${OVERLAY_ID} [data-footer]`);
      if (!body) return;
      body.innerHTML = `<p class="sgmb-section-desc" style="margin-top:16px" role="alert">${esc(message)}</p>`;
      footer.innerHTML = '<button class="sgmb-btn" data-act="close">Close</button><button class="sgmb-btn sgmb-btn-primary" data-act="retry">Try again</button>';
      footer.querySelector('[data-act="retry"]').addEventListener('click', () => this.show(data));
    },

    renderShell(data) {
      this.close();
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'sgmb-modal-overlay';
      overlay.innerHTML = `
        <div class="sgmb-modal-card" role="dialog" aria-modal="true" aria-label="Media audit">
          <div class="sgmb-modal-header">
            <div class="sgmb-modal-title-group">
              <div class="sgmb-modal-badge">${ns.utils.icons.photos}Media audit</div>
              <h2 class="sgmb-modal-title">${esc(data.name || 'Business profile')}</h2>
              <div class="sgmb-modal-sub">${esc(data.categories?.[0] || '')}</div>
            </div>
            <button class="sgmb-close-btn" data-act="close" aria-label="Close">&times;</button>
          </div>
          <div class="sgmb-modal-body" data-body>
            <p class="sgmb-section-desc" data-status role="status" aria-live="polite">Opening the photo viewer…</p>
            <div class="sgmb-progress is-indeterminate" role="progressbar" aria-label="Working"><span></span></div>
          </div>
          <div class="sgmb-modal-footer" data-footer><button class="sgmb-btn" data-act="close">Close</button></div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('[data-act="close"]')) this.close();
      });
      this._release = ns.utils.modalize(overlay.querySelector('[role="dialog"]'), () => this.close());
    },

    setStatus(msg) {
      const el = document.querySelector(`#${OVERLAY_ID} [data-status]`);
      if (el) el.textContent = msg;
    },

    render(data, r) {
      const body = document.querySelector(`#${OVERLAY_ID} [data-body]`);
      const footer = document.querySelector(`#${OVERLAY_ID} [data-footer]`);
      if (!body) return;
      if (r.error) {
        body.innerHTML = '<p class="sgmb-section-desc" style="margin-top:16px">No "See photos" button on this page. Open the business on Google Search (its knowledge panel) and run the audit again.</p>';
        return;
      }
      const tone = r.photoCount >= 50 ? 'good' : r.photoCount >= 15 ? 'mid' : 'low';
      ns.utils.saveAuditResult(data.featureId, 'media', { photos: r.photoCount, videos: Math.max(r.videoCount, r.videoTabCount), ownerCount: r.ownerCount ?? null, categories: Object.keys(r.categories) });
      // Google's own total (photos and videos) from the profile data, when known.
      const googleTotal = typeof data.photoCount === 'number' ? data.photoCount : null;
      const found = r.photoCount + r.videoCount;
      const customers = googleTotal !== null && typeof r.ownerCount === 'number' ? Math.max(0, googleTotal - r.ownerCount) : null;
      const gapNote = googleTotal !== null && googleTotal > found
        ? `Google reports ${googleTotal.toLocaleString()} items; its photo viewer loaded ${found.toLocaleString()} unique ones. The rest are usually older customer uploads Google no longer shows in the viewer.`
        : '';
      const videoNote = r.videoTabCount > r.videoCount
        ? `The Videos tab lists ${r.videoTabCount}; ${r.videoCount} could be saved as files.`
        : 'Unique, ready to download';
      body.innerHTML = `
        <div class="sgmb-stat-strip">
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">On Google</div><div class="sgmb-metric-val">${googleTotal === null ? '-' : googleTotal.toLocaleString()}</div><div class="sgmb-metric-hint">Google's own total, photos and videos</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Photos found</div><div class="sgmb-metric-val sgmb-tone-text-${tone}">${r.photoCount}</div><div class="sgmb-metric-hint">Unique, ready to download</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Videos found</div><div class="sgmb-metric-val">${r.videoCount}</div><div class="sgmb-metric-hint">${esc(videoNote)}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">From the owner</div><div class="sgmb-metric-val">${r.ownerCount ?? '-'}</div><div class="sgmb-metric-hint">${r.ownerCount === undefined ? 'No "By owner" tab' : customers !== null ? `About ${customers.toLocaleString()} from customers` : '"By owner" tab'}</div></div>
        </div>
        ${gapNote ? `<p class="sgmb-section-desc" style="margin-top:8px">${esc(gapNote)}</p>` : ''}
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">By category</h3>
          <table class="sgmb-table">
            <thead><tr><th>Category</th><th class="sgmb-num">Items</th><th class="sgmb-num">Videos</th></tr></thead>
            <tbody>${Object.entries(r.categories).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="sgmb-num">${v.total}</td><td class="sgmb-num">${v.videos}</td></tr>`).join('')}</tbody>
          </table>
          <p class="sgmb-section-desc" style="margin-top:8px">Items per tab as Google's photo viewer shows them. Tabs overlap (one photo can be in "All", "By owner" and "Exterior"), so they do not add up to the total.</p>
        </div>
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">Photos (${r.photos.length})</h3>
          <div class="sgmb-media-grid">
            ${r.photos.slice(0, 60).map((p, i) => `<a href="${esc(p.url)}" target="_blank" rel="noopener" data-dl="${i}" title="Open original"><img src="${esc(p.thumb)}" alt="" loading="lazy"></a>`).join('')}
          </div>
          ${r.photos.length > 60 ? `<p class="sgmb-section-desc" style="margin-top:8px">Showing 60 of ${r.photos.length}. "Download photos" saves all of them.</p>` : ''}
        </div>
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">What to check</h3>
          <ul class="sgmb-issue-list">
            ${r.photoCount < 20 ? `<li>${ns.utils.icons.alert}<span>Fewer than 20 photos. Add exterior, interior, team and work photos.</span><span></span></li>` : ''}
            ${r.videoCount === 0 ? `<li>${ns.utils.icons.alert}<span>No videos. Short clips (up to 30 seconds) of the space or work help.</span><span></span></li>` : ''}
            ${r.categories.Exterior === undefined ? `<li>${ns.utils.icons.alert}<span>No "Exterior" group yet. Add photos showing the storefront as customers approach.</span><span></span></li>` : ''}
            <li>${ns.utils.icons.check}<span>Google recommends JPG or PNG, 10 KB–5 MB, 720 × 720 px.</span><span></span></li>
          </ul>
        </div>`;

      footer.innerHTML = `
        <button class="sgmb-btn" data-act="close">Close</button>
        <button class="sgmb-btn" data-act="dl-videos" ${r.videos.length ? '' : 'disabled'}>${ns.utils.icons.download}<span>Download videos (${r.videos.length})</span></button>
        <button class="sgmb-btn sgmb-btn-primary" data-act="dl-photos" ${r.photos.length ? '' : 'disabled'}>${ns.utils.icons.download}<span>Download photos (${r.photos.length})</span></button>`;
      footer.querySelector('[data-act="dl-photos"]').addEventListener('click', (e) => this.download(e.currentTarget, data, r.photos, 'photo', 'jpg'));
      footer.querySelector('[data-act="dl-videos"]').addEventListener('click', (e) => this.download(e.currentTarget, data, r.videos, 'video', 'mp4'));
    },

    async download(btn, data, items, kind, ext) {
      const label = btn.querySelector('span');
      btn.disabled = true;
      const folder = `SphereGMB/${ns.utils.slug(data.name, 'business')}`;
      const files = items.map((it, i) => ({ url: it.url, filename: `${folder}/${kind}-${String(i + 1).padStart(3, '0')}.${ext}` }));
      label.textContent = `Saving ${files.length}…`;
      const res = await ns.utils.sendMessage({ type: 'downloadMedia', payload: { files } });
      label.textContent = res.error ? `Download failed: ${res.error}` : `Saved ${res.saved} to Downloads/${folder}`;
    },

    close() {
      document.getElementById(OVERLAY_ID)?.remove();
      if (this._release) this._release();
      this._release = null;
    }
  };
})(window.SphereGmb);
