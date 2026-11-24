/**
 * SphereGMB: Post Audit
 * Reads every Google post ("Updates") of the business from Google Search, expands each one to
 * its full text, and analyses cadence, length, calls to action and content issues
 * (lib/post-analytics.js). On Maps it opens a Search tab and runs there.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const OVERLAY_ID = 'sgmb-post-audit-overlay';
  const AGE_OR_DATE = /^((\d+|a|an)\s+(minute|hour|day|week|month|year)s?\s+ago|[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4})$/;
  const esc = (v) => ns.utils.escapeHtml(v);
  const sleep = (ms) => ns.utils.sleep(ms);

  function scrollableAncestor(el) {
    for (let c = el?.parentElement; c && c !== document.body; c = c.parentElement) {
      const s = window.getComputedStyle(c);
      if (/(auto|scroll)/.test(s.overflowY) && c.scrollHeight > c.clientHeight + 5) return c;
    }
    return null;
  }

  function dateLeaves(root) {
    return Array.from(root.querySelectorAll('.aYexud, span, div')).filter((e) => e.children.length === 0 && AGE_OR_DATE.test(ns.utils.cleanText(e.textContent)));
  }

  ns.postAudit = {
    /** Opens Google's Updates view from the knowledge panel. Returns the scroll panel or null. */
    async openUpdatesView() {
      const section = document.querySelector('[data-attrid="kc:/local:posts"]');
      if (!section) return null;
      const viewAll = Array.from(section.querySelectorAll('a, [role="button"]')).find((e) => /view all|see all|more updates/i.test(ns.utils.cleanText(e.textContent)));
      if (!viewAll) return null;
      viewAll.click();
      for (let i = 0; i < 24; i++) {
        await sleep(400);
        const leaf = document.querySelector('.aYexud');
        const panel = leaf && scrollableAncestor(leaf);
        if (panel) return panel;
      }
      return null;
    },

    /** Scrolls the Updates view until no new posts load, expands "More", and parses every post. */
    async collectPosts(onProgress = () => {}) {
      const panel = await this.openUpdatesView();
      if (!panel) return { error: 'no_posts_view' };

      let last = -1;
      let stable = 0;
      for (let i = 0; i < 80 && stable < 3; i++) {
        panel.scrollTop = panel.scrollHeight;
        await sleep(900);
        const n = panel.querySelectorAll('.aYexud').length || dateLeaves(panel).length;
        onProgress(`Loading posts… ${n}`);
        if (n === last) stable++;
        else {
          stable = 0;
          last = n;
        }
      }

      // Expand truncated posts so word counts use the full text.
      const mores = Array.from(panel.querySelectorAll('.qTVDcf')).filter((m) => /^more$/i.test(ns.utils.cleanText(m.textContent)));
      for (let i = 0; i < mores.length; i++) {
        try { mores[i].click(); } catch (e) { /* detached */ }
        if (i % 20 === 19) {
          onProgress(`Expanding posts… ${i + 1}/${mores.length}`);
          await sleep(300);
        }
      }
      await sleep(800);

      const seen = new Set();
      const posts = [];
      for (const leaf of panel.querySelectorAll('.aYexud')) {
        let card = leaf;
        for (let i = 0; i < 8 && card && !card.classList.contains('Qj68Ed'); i++) card = card.parentElement;
        if (!card || seen.has(card)) continue;
        seen.add(card);
        const textEl = card.querySelector('.A5yTVb');
        const text = ns.reviewScraper.textWithBreaks(textEl).replace(/\s*\(Original\)\s*$/i, '');
        const anchors = Array.from(card.querySelectorAll('a'));
        const button = anchors.map((a) => ns.utils.cleanText(a.textContent)).find((t) => t && !/^more$/i.test(t) && !/^https?:/i.test(t) && t.length < 30) || '';
        const link = anchors.map((a) => a.getAttribute('href') || '').find((h) => /^https?:\/\//.test(h) && !/google\.[a-z.]+\//.test(h)) || '';
        const images = Math.max(0, card.querySelectorAll('img').length - 1); // first image is the profile logo
        posts.push({ dateText: ns.utils.cleanText(leaf.textContent), text, cta: button, link, images });
      }

      // Leave the Updates view with its own close button. (history.back() can step past the
      // view and reload the search page.)
      this.closeView(panel);
      return { posts };
    },

    closeView(panel) {
      for (let c = panel; c && c !== document.body; c = c.parentElement) {
        const btn = c.querySelector(':scope > * [aria-label="Close" i], :scope > [aria-label="Close" i]');
        if (btn) {
          btn.click();
          return;
        }
      }
    },

    async show(businessData) {
      const data = businessData || {};
      if (ns.utils.isMaps()) {
        ns.reviewScraper.showToast(`Opening Google Search to read all posts for "${data.name || 'this business'}"…`);
        const res = await ns.utils.sendMessage({ type: 'runAuditPost', payload: data });
        if (res.error) ns.reviewScraper.showToast('Extension was updated. Reload this tab, then try again.');
        else ns.reviewScraper.scheduleHide(5000);
        return;
      }

      if (this.running) return;
      this.running = true;
      this.renderShell(data, 'Reading posts from the Updates view…');
      try {
        const result = await this.collectPosts((msg) => this.setStatus(msg));
        if (result.error || !result.posts.length) {
          this.renderBody(data, null, 'No posts found. Google shows posts in the business panel under "From the business" or "Updates"; this profile may not have any.');
          return;
        }
        const city = data.addressLocality || (data.address || '').split(',').slice(-2, -1)[0]?.trim() || '';
        const report = window.SphereGmbPosts.analyzePosts(result.posts, { category: data.categories?.[0] || '', city });
        this.lastReport = report;
        this.renderBody(data, report);
      } catch (err) {
        ns.utils.log('Post audit failed:', err);
        this.renderError(data, 'Google\'s Updates view changed or didn\'t load. Close it if it is open, then try again.');
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

    renderShell(data, status) {
      this.close();
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'sgmb-modal-overlay';
      overlay.innerHTML = `
        <div class="sgmb-modal-card" role="dialog" aria-modal="true" aria-label="Post audit">
          <div class="sgmb-modal-header">
            <div class="sgmb-modal-title-group">
              <div class="sgmb-modal-badge">${ns.utils.icons.posts}Post audit</div>
              <h2 class="sgmb-modal-title">${esc(data.name || 'Business profile')}</h2>
              <div class="sgmb-modal-sub">${esc(data.categories?.[0] || '')}</div>
            </div>
            <button class="sgmb-close-btn" data-act="close" aria-label="Close">&times;</button>
          </div>
          <div class="sgmb-modal-body" data-body>
            <p class="sgmb-section-desc" data-status role="status" aria-live="polite">${esc(status)}</p>
            <div class="sgmb-progress is-indeterminate" role="progressbar" aria-label="Working"><span></span></div>
          </div>
          <div class="sgmb-modal-footer" data-footer>
            <button class="sgmb-btn" data-act="close">Close</button>
          </div>
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

    renderBody(data, r, emptyMessage = '') {
      const body = document.querySelector(`#${OVERLAY_ID} [data-body]`);
      const footer = document.querySelector(`#${OVERLAY_ID} [data-footer]`);
      if (!body) return;
      if (!r) {
        body.innerHTML = `<p class="sgmb-section-desc" style="margin-top:16px">${esc(emptyMessage)}</p>`;
        return;
      }
      const tone = r.score >= 80 ? 'good' : r.score >= 55 ? 'mid' : 'low';
      const maxMonth = Math.max(1, ...r.monthly.map((m) => m.count));
      const since = r.daysSinceLast === 0 ? 'today' : r.daysSinceLast === 1 ? 'yesterday' : `${r.daysSinceLast} days ago`;
      body.innerHTML = `
        <div class="sgmb-score-block sgmb-kpi-hero sgmb-tone-${tone}">
          <div class="sgmb-kpi-val">${r.score}<small>/100</small></div>
          <div class="sgmb-score-grade">${esc(r.grade)} posting, ${r.total} posts since ${esc(r.firstDate)}</div>
          <div class="sgmb-score-meter">${r.monthly.map((m) => `<span class="${m.count ? 'is-pass' : ''}" title="${m.month}: ${m.count} posts"></span>`).join('')}</div>
        </div>
        <div class="sgmb-stat-strip">
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Last post</div><div class="sgmb-metric-val">${esc(since)}</div><div class="sgmb-metric-hint">${esc(r.lastDate)}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Per month</div><div class="sgmb-metric-val">${r.perMonth}</div><div class="sgmb-metric-hint">${r.perMonthMonths && r.perMonthMonths < 12 ? `Average since the first post (${Math.round(r.perMonthMonths)} months)` : 'Average over 12 months'}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Average length</div><div class="sgmb-metric-val">${r.avgWords}</div><div class="sgmb-metric-hint">words (median ${r.medianWords})</div></div>
        </div>
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">Cadence</h3>
          <dl class="sgmb-facts">
            <dt>First post</dt><dd>${esc(r.firstDate)}</dd>
            <dt>Latest post</dt><dd>${esc(r.lastDate)}</dd>
            <dt>Last 12 months</dt><dd>${r.lastYear} posts</dd>
            <dt>Typical gap</dt><dd>${r.medianGapDays} days</dd>
            <dt>Longest gap</dt><dd>${r.longestGapDays} days</dd>
          </dl>
          <div class="sgmb-bars" style="margin-top:12px">
            ${r.monthly.map((m) => `<span>${esc(m.month)}</span><span class="sgmb-bar-track"><span class="sgmb-bar-fill" style="width:${Math.round((m.count / maxMonth) * 100)}%"></span></span><span>${m.count}</span>`).join('')}
          </div>
        </div>
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">Content</h3>
          <dl class="sgmb-facts">
            <dt>With an image</dt><dd>${r.withImagePct}%</dd>
            <dt>With a button or link</dt><dd>${r.withCtaPct}%</dd>
            <dt>Mentions the service</dt><dd>${r.mentionsCategoryPct}%</dd>
            <dt>Mentions the city</dt><dd>${r.mentionsCityPct}%</dd>
            <dt>Reading ease</dt><dd>${r.avgReadingEase === null ? '-' : `${r.avgReadingEase} (60+ reads easily)`}</dd>
            <dt>Near-duplicates</dt><dd>${r.duplicates}</dd>
            <dt>Buttons used</dt><dd>${Object.entries(r.ctaMix).map(([k, v]) => `${esc(k)} ${v}`).join(', ')}</dd>
          </dl>
        </div>
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">Issues across posts</h3>
          ${r.issues.length ? `<ul class="sgmb-issue-list">${r.issues.map((i) => `<li>${ns.utils.icons.alert}<span>${esc(i.issue)}</span><span class="sgmb-issue-count">${i.count}</span></li>`).join('')}</ul>` : '<p class="sgmb-section-desc">No issues found.</p>'}
        </div>
        <div class="sgmb-modal-section" data-ai></div>`;

      footer.innerHTML = `
        <button class="sgmb-btn" data-act="close">Close</button>
        <button class="sgmb-btn sgmb-btn-primary" data-act="csv">${ns.utils.icons.download}<span>Posts CSV</span></button>`;
      footer.querySelector('[data-act="csv"]').addEventListener('click', () => this.exportCsv(data, r));
      this.offerOnDeviceAi(data, r);
    },

    exportCsv(data, r) {
      const head = ['Date', 'Date (as shown)', 'Words', 'Characters', 'Reading ease', 'Button', 'Link', 'Images', 'Mentions service', 'Mentions city', 'Issues', 'Text'];
      const q = (v) => `"${ns.utils.csvSafe(v).replace(/"/g, '""')}"`;
      const rows = [head.map(q).join(',')].concat(r.posts.map((p) => [p.date, p.dateText, p.words, p.chars, p.readingEase, p.cta, p.link, p.images, p.mentionsCategory ? 'yes' : 'no', p.mentionsCity ? 'yes' : 'no', p.issues.join('; '), p.text].map(q).join(',')));
      const file = `posts-${ns.utils.slug(data.name, 'business')}-${new Date().toISOString().slice(0, 10)}.csv`;
      ns.utils.downloadFile(file, String.fromCharCode(0xfeff) + rows.join('\r\n'));
      ns.reviewScraper.notify(`Saved ${r.posts.length} posts`, file);
    },

    /**
     * Optional suggestions from Chrome's built-in, on-device model (Gemini Nano via the Prompt
     * API). Free and local; shown only when the browser exposes it.
     */
    async offerOnDeviceAi(data, r) {
      const box = document.querySelector(`#${OVERLAY_ID} [data-ai]`);
      const LM = window.LanguageModel;
      if (!box || !LM || typeof LM.create !== 'function') {
        if (box) box.remove();
        return;
      }
      try {
        const availability = typeof LM.availability === 'function' ? await LM.availability() : 'available';
        if (availability === 'unavailable') {
          box.remove();
          return;
        }
      } catch (e) {
        box.remove();
        return;
      }
      box.innerHTML = `
        <h3 class="sgmb-section-title">On-device AI review</h3>
        <p class="sgmb-section-desc">Uses the AI model built into Chrome. Nothing leaves your computer.</p>
        <button class="sgmb-btn" data-act="ai">Get suggestions for the next posts</button>
        <div data-ai-out class="sgmb-section-desc" style="white-space:pre-wrap;margin-top:10px"></div>`;
      box.querySelector('[data-act="ai"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const out = box.querySelector('[data-ai-out]');
        btn.disabled = true;
        btn.textContent = 'Thinking…';
        try {
          const session = await LM.create();
          const samples = r.posts.slice(0, 5).map((p, i) => `Post ${i + 1} (${p.date}, ${p.words} words): ${p.text.slice(0, 600)}`).join('\n\n');
          const prompt = `You review Google Business Profile posts for a ${data.categories?.[0] || 'local business'}${data.addressLocality ? ` in ${data.addressLocality}` : ''}.\nStats: ${r.total} posts, ${r.perMonth} per month, median ${r.medianWords} words, ${r.withImagePct}% with images, ${r.withCtaPct}% with a button.\nRecent posts:\n${samples}\n\nGive 5 short, specific suggestions to improve the next posts, then 3 post topic ideas. Plain text, no markdown.`;
          out.textContent = await session.prompt(prompt);
          session.destroy?.();
        } catch (err) {
          out.textContent = `The on-device model could not run: ${err.message}`;
        } finally {
          btn.disabled = false;
          btn.textContent = 'Get suggestions for the next posts';
        }
      });
    },

    close() {
      document.getElementById(OVERLAY_ID)?.remove();
      if (this._release) this._release();
      this._release = null;
    }
  };
})(window.SphereGmb);
