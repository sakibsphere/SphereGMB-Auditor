/**
 * GBP Sphere: People also ask collector (Google Search results pages only).
 *
 * Options first (depth in levels, what else to collect, country and language), then it opens
 * questions in Google's own "People also ask" box level by level: questions Google shows at
 * first are level 1, questions that appear after opening a level-1 question are level 2, and
 * so on. It also reads the organic results, ads and related searches on the page, and can ask
 * Google Autocomplete for suggestions (optionally expanded A to Z). Exports one CSV.
 *
 * Original implementation: visible SERP markup only (.related-question-pair[data-q] and its
 * [aria-expanded] toggle) plus Google's public suggest endpoint on the same origin. No server.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const OVERLAY_ID = 'sgmb-paa-overlay';
  const AUTO_PARAM = 'sgmbPaa';
  const MAX_QUESTIONS = 120;
  const esc = (v) => ns.utils.escapeHtml(v);
  const sleep = (ms) => ns.utils.sleep(ms);
  const TYPES = ['how', 'what', 'why', 'which', 'when', 'where', 'who', 'can', 'is', 'are', 'does', 'do', 'should', 'will'];
  const COUNTRIES = [['', 'Current'], ['us', 'United States'], ['gb', 'United Kingdom'], ['ca', 'Canada'], ['au', 'Australia'], ['in', 'India'], ['bd', 'Bangladesh'], ['ae', 'United Arab Emirates'], ['de', 'Germany'], ['fr', 'France'], ['es', 'Spain'], ['br', 'Brazil'], ['mx', 'Mexico']];
  const LANGUAGES = [['', 'Current'], ['en', 'English'], ['bn', 'Bengali'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese']];

  function pairs() {
    return Array.from(document.querySelectorAll('.related-question-pair[data-q]'));
  }

  function questionType(q) {
    const first = String(q).trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    return TYPES.includes(first) ? first[0].toUpperCase() + first.slice(1) : 'Other';
  }

  function readPair(pair) {
    const q = pair.getAttribute('data-q');
    const link = Array.from(pair.querySelectorAll('a[href^="http"]')).find((a) => !/\/\/(www\.)?google\.[a-z.]+\//.test(a.href) && (a.querySelector('h3') || a.closest('[data-snhf], .yuRUbf')));
    const anyLink = link || Array.from(pair.querySelectorAll('a[href^="http"]')).find((a) => !/\/\/(www\.)?google\.[a-z.]+\//.test(a.href));
    const text = ns.utils.cleanText((pair.innerText || pair.textContent || '').replace(q, ''))
      // Google adds hidden "[Highlight start]" / "[Highlight end]" markers for screen readers.
      .replace(/\s*\[Highlight (start|end)\]\s*/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^(AI Overview|Featured snippet from the web)\s*/i, '');
    let domain = '';
    try { domain = anyLink ? new URL(anyLink.href).hostname.replace(/^www\./, '') : ''; } catch (e) { /* bad url */ }
    return {
      question: q,
      type: questionType(q),
      answer: text.replace(/\s*(More results|Feedback|Search for:.*)$/i, '').slice(0, 700),
      sourceTitle: ns.utils.cleanText(anyLink?.querySelector('h3')?.textContent || ''),
      sourceUrl: anyLink?.href || '',
      domain,
      aiOverview: /AI Overview/i.test(pair.textContent || '')
    };
  }

  /** Sponsored results at the top and bottom of the page. */
  function readAds() {
    const out = [];
    document.querySelectorAll('#tads [data-text-ad], #bottomads [data-text-ad], #tads .uEierd, #bottomads .uEierd').forEach((ad) => {
      const title = ns.utils.cleanText(ad.querySelector('[role="heading"], h3')?.textContent);
      const a = ad.querySelector('a[href^="http"]');
      if (title && !out.some((o) => o.title === title)) out.push({ title, url: a?.href || '', domain: (a && (() => { try { return new URL(a.href).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })()) || '' });
    });
    return out;
  }

  /** "People also search for" / related searches at the bottom of the page. */
  function readRelated() {
    const seen = new Set();
    return Array.from(document.querySelectorAll('#bres a[href*="/search?"], #botstuff a[href*="/search?"]'))
      .map((a) => ns.utils.cleanText(a.textContent))
      .filter((t) => t && t.length < 120 && !seen.has(t) && seen.add(t));
  }

  ns.paa = {
    running: false,
    items: [],
    extras: { organic: [], ads: [], related: [], autocomplete: [] },

    /** Adds a "Collect questions" button above Google's People also ask box. */
    inject() {
      if (ns.utils.isMaps() || document.querySelector('.sgmb-paa-trigger')) return;
      const first = pairs()[0];
      if (!first) return;
      const box = first.closest('[data-initq]') || first.parentElement?.parentElement;
      if (!box) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sgmb-paa-trigger';
      btn.dataset.sphereGmbRoot = '1';
      btn.innerHTML = `${ns.utils.icons.questions}<span>Collect all questions (GBP Sphere)</span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showOptions();
      }, { capture: true });
      box.insertAdjacentElement('beforebegin', btn);
      this.autoRunOnce();
    },

    /** After "Search again" for another country/language, the new page starts by itself. */
    autoRunOnce() {
      if (this._autoChecked) return;
      this._autoChecked = true;
      const params = new URLSearchParams(window.location.search);
      const raw = params.get(AUTO_PARAM);
      if (!raw) return;
      params.delete(AUTO_PARAM);
      try { history.replaceState(history.state, '', `${window.location.pathname}?${params}${window.location.hash}`); } catch (e) { /* ignore */ }
      let opts = {};
      try { opts = JSON.parse(raw); } catch (e) { opts = {}; }
      // Only a search GBP Sphere itself started (matching one-time code, under 2 minutes old).
      try {
        chrome.storage.local.get('paaAutoRun', ({ paaAutoRun }) => {
          chrome.storage.local.remove('paaAutoRun');
          const ok = paaAutoRun && opts.nonce && paaAutoRun.nonce === opts.nonce && Date.now() - paaAutoRun.ts < 120000;
          if (ok) setTimeout(() => this.collect(opts), 800);
        });
      } catch (e) { /* extension reloaded */ }
    },

    renderShell(bodyHtml, footerHtml) {
      this.close();
      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'sgmb-modal-overlay';
      const query = new URLSearchParams(window.location.search).get('q') || '';
      overlay.innerHTML = `
        <div class="sgmb-modal-card" role="dialog" aria-modal="true" aria-label="People also ask">
          <div class="sgmb-modal-header">
            <div class="sgmb-modal-title-group">
              <div class="sgmb-modal-badge">${ns.utils.icons.questions}People also ask</div>
              <h2 class="sgmb-modal-title">${esc(query)}</h2>
              <div class="sgmb-modal-sub">Questions Google shows for this search, from your current location</div>
            </div>
            <button class="sgmb-close-btn" data-act="close" aria-label="Close">&times;</button>
          </div>
          <div class="sgmb-modal-body" data-body>${bodyHtml}</div>
          <div class="sgmb-modal-footer" data-footer>${footerHtml}</div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('[data-act="close"]')) this.close();
      });
      this._release = ns.utils.modalize(overlay.querySelector('[role="dialog"]'), () => this.close());
      return overlay;
    },

    showOptions() {
      if (this.running) return;
      const saved = this.lastOptions || { levels: 2, organic: true, ads: true, related: true, autocomplete: true, expanded: false };
      const select = (id, list, cur) => `<select class="sgmb-input" id="${id}">${list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      const params = new URLSearchParams(window.location.search);
      const box = (id, label, on) => `<label class="sgmb-opt"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
      const overlay = this.renderShell(`
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">Depth</h3>
          <div class="sgmb-seg" role="radiogroup" aria-label="Levels">
            ${[1, 2, 3, 4].map((n) => `<label class="sgmb-seg-item"><input type="radio" name="sgmb-levels" value="${n}" ${n === saved.levels ? 'checked' : ''}><span>${n} level${n > 1 ? 's' : ''}</span></label>`).join('')}
          </div>
          <p class="sgmb-section-desc">Level 1 is what Google shows first. Each extra level opens every question of the level before, which makes Google add new ones. 3 levels usually gives 40 to 80 questions.</p>
        </div>
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">Also collect</h3>
          <div class="sgmb-opts">
            ${box('sgmb-o-organic', 'Organic results', saved.organic)}
            ${box('sgmb-o-ads', 'Ads', saved.ads)}
            ${box('sgmb-o-related', 'Related searches', saved.related)}
            ${box('sgmb-o-ac', 'Autocomplete', saved.autocomplete)}
            ${box('sgmb-o-exp', 'Expanded autocomplete (A to Z)', saved.expanded)}
          </div>
        </div>
        <div class="sgmb-modal-section">
          <h3 class="sgmb-section-title">Country and language</h3>
          <div class="sgmb-opts">
            <label class="sgmb-field">Country ${select('sgmb-o-gl', COUNTRIES, params.get('gl') || '')}</label>
            <label class="sgmb-field">Language ${select('sgmb-o-hl', LANGUAGES, params.get('hl') || '')}</label>
          </div>
          <p class="sgmb-section-desc">Changing these runs the search again for that market, then collects there.</p>
        </div>`, `
        <button class="sgmb-btn" data-act="close">Cancel</button>
        <button class="sgmb-btn sgmb-btn-primary" data-act="start">${ns.utils.icons.questions}<span>Collect</span></button>`);
      overlay.querySelector('[data-act="start"]').addEventListener('click', () => {
        const val = (id) => overlay.querySelector(`#${id}`);
        const opts = {
          levels: Number(overlay.querySelector('input[name="sgmb-levels"]:checked')?.value || 2),
          organic: val('sgmb-o-organic').checked,
          ads: val('sgmb-o-ads').checked,
          related: val('sgmb-o-related').checked,
          autocomplete: val('sgmb-o-ac').checked,
          expanded: val('sgmb-o-exp').checked
        };
        this.lastOptions = opts;
        const gl = val('sgmb-o-gl').value;
        const hl = val('sgmb-o-hl').value;
        if (gl !== (params.get('gl') || '') || hl !== (params.get('hl') || '')) {
          const next = new URLSearchParams(window.location.search);
          ['gl', 'hl', 'start'].forEach((k) => next.delete(k));
          if (gl) next.set('gl', gl);
          if (hl) next.set('hl', hl);
          const nonce = Math.random().toString(36).slice(2, 12);
          next.set(AUTO_PARAM, JSON.stringify({ ...opts, nonce }));
          const go = () => { window.location.href = `/search?${next}`; };
          try { chrome.storage.local.set({ paaAutoRun: { nonce, ts: Date.now() } }, go); } catch (e) { go(); }
          return;
        }
        this.collect(opts);
      });
    },

    /** Opens questions level by level, then reads everything the options ask for. */
    async collect(opts = {}) {
      if (this.running) return;
      const o = { levels: 2, organic: true, ads: true, related: true, autocomplete: true, expanded: false, ...opts };
      this.lastOptions = o;
      this.running = true;
      this.renderShell(`
        <p class="sgmb-section-desc" data-status role="status" aria-live="polite">Opening questions…</p>
        <div class="sgmb-progress"><span data-bar style="width:5%"></span></div>`, '<button class="sgmb-btn" data-act="close">Close</button>');
      const level = new Map(pairs().map((p) => [p.getAttribute('data-q'), 1]));
      const opened = new Set(pairs().filter((p) => p.querySelector('[aria-expanded="true"]')).map((p) => p.getAttribute('data-q')));
      try {
        for (let L = 1; L < o.levels && pairs().length < MAX_QUESTIONS; L++) {
          const batch = pairs().filter((p) => level.get(p.getAttribute('data-q')) === L && !opened.has(p.getAttribute('data-q')));
          for (const p of batch) {
            if (!this.running || pairs().length >= MAX_QUESTIONS) break;
            opened.add(p.getAttribute('data-q'));
            p.querySelector('[aria-expanded][role="button"]')?.click();
            this.setStatus(`Level ${L + 1}: opening questions, ${pairs().length} found`, Math.min(0.9, pairs().length / (o.levels * 25)));
            await sleep(1300);
            for (const np of pairs()) {
              const q = np.getAttribute('data-q');
              if (!level.has(q)) level.set(q, L + 1);
            }
          }
        }
        // Open the rest so their answers are in the page, then read everything.
        this.setStatus('Reading answers…', 0.92);
        for (const p of pairs()) {
          const q = p.getAttribute('data-q');
          if (!opened.has(q)) {
            opened.add(q);
            p.querySelector('[aria-expanded="false"][role="button"]')?.click();
            await sleep(350);
          }
        }
        await sleep(800);
        this.items = pairs().map((p) => ({ ...readPair(p), level: level.get(p.getAttribute('data-q')) || o.levels }));
        this.extras = {
          organic: o.organic && ns.rankRunner ? ns.rankRunner.readOrganic(document) : [],
          ads: o.ads ? readAds() : [],
          related: o.related ? readRelated() : [],
          autocomplete: o.autocomplete ? await this.autocomplete(o.expanded) : []
        };
        this.render();
      } catch (err) {
        ns.utils.log('People also ask collection failed:', err);
        const body = document.querySelector(`#${OVERLAY_ID} [data-body]`);
        if (body) body.innerHTML = '<p class="sgmb-section-desc" style="margin-top:16px" role="alert">Google\'s "People also ask" box changed or stopped responding. Reload the page and try again.</p>';
      } finally {
        this.running = false;
      }
    },

    /** Google Autocomplete for the query (same origin, no key); A to Z adds 26 lookups. */
    async autocomplete(expanded) {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q') || '';
      if (!q) return [];
      const phrases = [q].concat(expanded ? 'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `${q} ${c}`) : []);
      const out = new Map();
      for (let i = 0; i < phrases.length; i++) {
        this.setStatus(`Autocomplete ${i + 1} of ${phrases.length}`, 0.95);
        try {
          const sp = new URLSearchParams({ client: 'chrome', q: phrases[i], hl: params.get('hl') || 'en' });
          if (params.get('gl')) sp.set('gl', params.get('gl'));
          const res = await fetch(`/complete/search?${sp}`, { credentials: 'omit' });
          if (!res.ok) break;
          const data = JSON.parse(await res.text());
          (data[1] || []).forEach((s) => { if (!out.has(s)) out.set(s, phrases[i]); });
        } catch (e) {
          break;
        }
        await sleep(250);
      }
      return Array.from(out, ([suggestion, seed]) => ({ suggestion, seed }));
    },

    close() {
      this.running = false;
      document.getElementById(OVERLAY_ID)?.remove();
      if (this._release) this._release();
      this._release = null;
    },

    setStatus(msg, ratio) {
      const el = document.querySelector(`#${OVERLAY_ID} [data-status]`);
      if (el) el.textContent = msg;
      const bar = document.querySelector(`#${OVERLAY_ID} [data-bar]`);
      if (bar && ratio) bar.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
    },

    render() {
      const body = document.querySelector(`#${OVERLAY_ID} [data-body]`);
      const footer = document.querySelector(`#${OVERLAY_ID} [data-footer]`);
      if (!body) return;
      const items = this.items || [];
      const x = this.extras;
      if (!items.length && !x.organic.length && !x.autocomplete.length) {
        body.innerHTML = '<p class="sgmb-section-desc" style="margin-top:16px">Google didn\'t show a "People also ask" box for this search. Try a question-style search, for example "how to choose a dentist".</p>';
        footer.innerHTML = '<button class="sgmb-btn" data-act="close">Close</button>';
        return;
      }
      const groups = {};
      items.forEach((it) => { (groups[it.type] = groups[it.type] || []).push(it); });
      const domains = {};
      items.forEach((it) => { if (it.domain) domains[it.domain] = (domains[it.domain] || 0) + 1; });
      const topDomains = Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const levels = Math.max(0, ...items.map((i) => i.level || 1));

      body.innerHTML = `
        <div class="sgmb-stat-strip">
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Questions</div><div class="sgmb-metric-val">${items.length}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Levels</div><div class="sgmb-metric-val">${levels}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Autocomplete</div><div class="sgmb-metric-val">${x.autocomplete.length}</div></div>
        </div>
        ${topDomains.length ? `<div class="sgmb-modal-section"><h3 class="sgmb-section-title">Sites Google quotes most</h3><dl class="sgmb-facts">${topDomains.map(([d, n]) => `<dt>${esc(d)}</dt><dd>${n} answers</dd>`).join('')}</dl></div>` : ''}
        ${Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([type, list]) => `
          <div class="sgmb-modal-section">
            <h3 class="sgmb-section-title">${esc(type)} questions (${list.length})</h3>
            ${list.map((it) => `
              <div class="sgmb-qa-item">
                <div class="sgmb-qa-q">${esc(it.question)} <span class="sgmb-qa-level">L${it.level || 1}</span></div>
                ${it.answer ? `<div class="sgmb-qa-a">${esc(it.answer)}</div>` : ''}
                ${it.sourceUrl ? `<div class="sgmb-qa-src"><a href="${esc(it.sourceUrl)}" target="_blank" rel="noopener">${esc(it.sourceTitle || it.domain)}</a></div>` : ''}
              </div>`).join('')}
          </div>`).join('')}
        ${x.autocomplete.length ? `<div class="sgmb-modal-section"><h3 class="sgmb-section-title">Autocomplete (${x.autocomplete.length})</h3><div class="sgmb-chip-cloud">${x.autocomplete.map((a) => `<span class="sgmb-chip">${esc(a.suggestion)}</span>`).join('')}</div></div>` : ''}
        ${x.related.length ? `<div class="sgmb-modal-section"><h3 class="sgmb-section-title">Related searches (${x.related.length})</h3><div class="sgmb-chip-cloud">${x.related.map((r) => `<span class="sgmb-chip">${esc(r)}</span>`).join('')}</div></div>` : ''}
        ${x.organic.length ? `<div class="sgmb-modal-section"><h3 class="sgmb-section-title">Organic results (${x.organic.length})</h3><table class="sgmb-table"><tbody>${x.organic.map((r) => `<tr><td>${r.position}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a><div class="sgmb-list-hint">${esc(r.domain)}</div></td></tr>`).join('')}</tbody></table></div>` : ''}
        ${x.ads.length ? `<div class="sgmb-modal-section"><h3 class="sgmb-section-title">Ads (${x.ads.length})</h3><table class="sgmb-table"><tbody>${x.ads.map((r) => `<tr><td>${esc(r.title)}<div class="sgmb-list-hint">${esc(r.domain)}</div></td></tr>`).join('')}</tbody></table></div>` : ''}`;

      footer.innerHTML = `
        <button class="sgmb-btn" data-act="more">Change options</button>
        <button class="sgmb-btn" data-act="copy">Copy questions</button>
        <button class="sgmb-btn sgmb-btn-primary" data-act="csv">${ns.utils.icons.download}<span>Download CSV</span></button>`;
      footer.querySelector('[data-act="more"]').addEventListener('click', () => this.showOptions());
      footer.querySelector('[data-act="copy"]').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        navigator.clipboard.writeText(items.map((i) => i.question).join('\n')).then(() => { btn.textContent = 'Copied'; });
      });
      footer.querySelector('[data-act="csv"]').addEventListener('click', () => this.exportCsv());
    },

    toCsv(items, extras = { organic: [], ads: [], related: [], autocomplete: [] }) {
      const head = ['Section', '#', 'Text', 'Type or seed', 'Level', 'Answer', 'Source title', 'Source URL', 'Domain', 'AI Overview'];
      const q = (v) => `"${ns.utils.csvSafe(v).replace(/"/g, '""')}"`;
      const rows = items.map((it, i) => ['People also ask', i + 1, it.question, it.type, it.level || 1, it.answer, it.sourceTitle, it.sourceUrl, it.domain, it.aiOverview ? 'yes' : 'no'])
        .concat((extras.autocomplete || []).map((a, i) => ['Autocomplete', i + 1, a.suggestion, a.seed, '', '', '', '', '', '']))
        .concat((extras.related || []).map((r, i) => ['Related search', i + 1, r, '', '', '', '', '', '', '']))
        .concat((extras.organic || []).map((r) => ['Organic', r.position, r.title, '', '', '', r.title, r.url, r.domain, '']))
        .concat((extras.ads || []).map((r, i) => ['Ad', i + 1, r.title, '', '', '', r.title, r.url, r.domain, '']));
      return String.fromCharCode(0xfeff) + [head.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\r\n');
    },

    exportCsv() {
      const query = new URLSearchParams(window.location.search).get('q') || 'search';
      const file = `people-also-ask-${ns.utils.slug(query, 'search')}-${new Date().toISOString().slice(0, 10)}.csv`;
      ns.utils.downloadFile(file, this.toCsv(this.items || [], this.extras));
      ns.reviewScraper?.notify(`Saved ${(this.items || []).length} questions`, file);
    },

    questionType
  };
})(window.SphereGmb);
