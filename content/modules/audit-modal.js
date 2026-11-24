/**
 * SphereGMB: In-Page Profile Audit Dashboard
 * Tabbed dialog: audit checklist, category breakdown, and the full public profile data.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const STATUS_LABEL = { pass: 'Pass', warn: 'Improve', fail: 'Missing', unknown: 'Not checked' };

  let modalBackdrop = null;
  let releaseFocus = null;

  const esc = (v) => ns.utils.escapeHtml(v);

  function row(label, valueHtml) {
    return `<div class="sgmb-nap-item"><span class="sgmb-nap-label">${esc(label)}</span><span class="sgmb-nap-value">${valueHtml}</span></div>`;
  }

  function textOr(value, fallback = 'Not listed') {
    const v = value === null || value === undefined ? '' : String(value).trim();
    return v ? esc(v) : `<span class="sgmb-muted">${esc(fallback)}</span>`;
  }

  function buildReportText(d, result) {
    const lines = [
      `SphereGMB audit: ${d.name || 'Unknown business'}`,
      `Score: ${result.score}/100 (${result.grade})`,
      `Address: ${d.address || 'n/a'}`,
      `Phone: ${d.phone || 'n/a'}`,
      `Website: ${d.website || 'n/a'}`,
      `Rating: ${d.rating || 'n/a'} (${d.numReviews || 0} reviews)`,
      `Primary category: ${d.categories?.[0] || 'n/a'}`,
      `Secondary categories: ${(d.categories || []).slice(1).join(', ') || 'none'}`,
      `Place CID: ${d.placeCID || 'n/a'} | Place ID: ${d.placeId || 'n/a'} | KGMID: ${d.kgmid || 'n/a'}`,
      '',
      'Checks:'
    ];
    for (const c of result.checks) lines.push(`- [${STATUS_LABEL[c.status]}] ${c.label}: ${c.detail} (${c.points}/${c.max})`);
    return lines.join('\n');
  }

  ns.auditModal = {
    show(businessData, auditResult) {
      this.close();
      const data = businessData || {};
      const result = auditResult && Array.isArray(auditResult.checks) ? auditResult : ns.auditEngine.audit(data);

      modalBackdrop = document.createElement('div');
      modalBackdrop.className = 'sgmb-modal-backdrop';
      const modal = document.createElement('div');
      modal.className = 'sgmb-modal-dialog';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', `Profile audit for ${data.name || 'business'}`);
      modal.innerHTML = this.renderContent(data, result);

      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) this.close();
      });

      modalBackdrop.appendChild(modal);
      document.body.appendChild(modalBackdrop);
      this.attachListeners(modal, data, result);
      releaseFocus = ns.utils.modalize(modal, () => this.close());
    },

    close() {
      if (modalBackdrop?.parentElement) modalBackdrop.parentElement.removeChild(modalBackdrop);
      modalBackdrop = null;
      if (releaseFocus) releaseFocus();
      releaseFocus = null;
    },

    renderContent(d, result) {
      const categories = d.categories || [];
      const score = result.score;
      const tone = score >= 85 ? 'good' : score >= 65 ? 'mid' : 'low';
      const rating = d.rating ? `${d.rating}` : '-';
      const reviews = d.numReviews ? `${ns.utils.formatNumber(d.numReviews)} reviews` : 'No reviews';
      const website = ns.utils.safeUrl(d.website);
      const unknownCount = result.checks.filter((c) => c.status === 'unknown').length;

      const checksHtml = result.checks.map((c) => `
        <div class="sgmb-check-item sgmb-check-${c.status}">
          <span class="sgmb-check-status">${{ pass: ns.utils.icons.check, warn: ns.utils.icons.alert, fail: ns.utils.icons.cross, unknown: ns.utils.icons.minus }[c.status]}</span>
          <div class="sgmb-check-content">
            <strong>${esc(c.label)} <span class="sgmb-check-points">${c.points}/${c.max}</span></strong>
            <p>${esc(c.detail)}</p>
          </div>
          <span class="sgmb-check-tag">${STATUS_LABEL[c.status]}</span>
        </div>`).join('');

      const categoryRows = categories.length
        ? categories.map((c, i) => `
          <div class="sgmb-cat-row ${i === 0 ? 'sgmb-cat-primary-row' : ''}">
            <div class="sgmb-cat-role">${i === 0 ? 'Primary' : `Secondary ${i}`}</div>
            <div class="sgmb-cat-name">${esc(c)}</div>
          </div>`).join('')
        : '<p class="sgmb-section-desc">No categories could be read for this profile.</p>';

      const hoursHtml = (d.hours || []).length
        ? d.hours.map((h) => row(h.day, esc(h.hours))).join('')
        : row('Hours', textOr('', 'Not listed'));

      const attributesHtml = (d.attributes || []).length
        ? d.attributes.map((g) => row(g.group, esc(g.items.join(', ')))).join('')
        : row('Attributes', textOr('', 'None set'));

      return `
        <div class="sgmb-modal-header">
          <div class="sgmb-modal-title-wrap">
            <div class="sgmb-modal-brand-badge">${ns.utils.icons.sphere}Profile audit</div>
            <h2 class="sgmb-modal-title">${esc(d.name || 'Business profile')}</h2>
            <div class="sgmb-modal-subtitle">${textOr(d.address, 'Address not listed')}</div>
          </div>
          <button class="sgmb-modal-close" aria-label="Close dialog">${CLOSE_SVG}</button>
        </div>

        <div class="sgmb-modal-tabs" role="tablist" aria-label="Audit sections">
          <button class="sgmb-tab-btn active" data-tab="overview" role="tab" id="sgmb-tab-overview" aria-controls="sgmb-pane-overview" aria-selected="true" tabindex="0">Audit</button>
          <button class="sgmb-tab-btn" data-tab="categories" role="tab" id="sgmb-tab-categories" aria-controls="sgmb-pane-categories" aria-selected="false" tabindex="-1">Categories (${categories.length})</button>
          <button class="sgmb-tab-btn" data-tab="nap" role="tab" id="sgmb-tab-nap" aria-controls="sgmb-pane-nap" aria-selected="false" tabindex="-1">Profile data</button>
        </div>

        <div class="sgmb-modal-body">
          <div class="sgmb-tab-content active" data-pane="overview" role="tabpanel" id="sgmb-pane-overview" aria-labelledby="sgmb-tab-overview">
            <div class="sgmb-score-block sgmb-kpi-hero sgmb-tone-${tone}">
              <div class="sgmb-kpi-val">${score}<small>/100</small></div>
              <div class="sgmb-score-grade">${esc(result.grade)} profile, ${result.checks.filter((c) => c.status === 'pass').length} of ${result.checks.length} checks passed</div>
              <div class="sgmb-score-meter" role="img" aria-label="One segment per check">
                ${result.checks.map((c) => `<span class="is-${c.status}" title="${esc(c.label)}: ${STATUS_LABEL[c.status]}"></span>`).join('')}
              </div>
            </div>
            <div class="sgmb-modal-section">
              <dl class="sgmb-facts">
                <dt>Rating</dt><dd>${esc(rating)} from ${esc(reviews.toLowerCase())}</dd>
                <dt>Categories</dt><dd>${categories.length ? `${esc(categories[0])}${categories.length > 1 ? ` and ${categories.length - 1} more` : ''}` : textOr('')}</dd>
                <dt>Place CID</dt><dd>${textOr(d.placeCID, 'Unknown')}</dd>
                <dt>KGMID</dt><dd>${textOr(d.kgmid, 'Unknown')}</dd>
              </dl>
            </div>
            ${unknownCount ? `<p class="sgmb-section-desc">${unknownCount} check(s) could not run because the full profile did not load. Reload the page to retry.</p>` : ''}
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">Checklist</h3>
              <div class="sgmb-checklist">${checksHtml}</div>
            </div>
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">Website speed (mobile)</h3>
              ${website
                ? `<p class="sgmb-section-desc">Runs Google PageSpeed Insights on ${esc(d.websiteDomain || website)}. Takes 20–60 seconds.</p>
                   <div class="sgmb-psi" data-psi>
                     <button class="sgmb-btn sgmb-btn-secondary" data-act="psi">Check website speed</button>
                   </div>`
                : '<p class="sgmb-section-desc">No website linked, so there is nothing to test.</p>'}
            </div>
          </div>

          <div class="sgmb-tab-content" data-pane="categories" role="tabpanel" id="sgmb-pane-categories" aria-labelledby="sgmb-tab-categories" hidden>
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">All GBP categories</h3>
              <p class="sgmb-section-desc">Google shows only the primary category publicly. The secondary ones below come from the profile's own data.</p>
              <div class="sgmb-category-table">${categoryRows}</div>
            </div>
          </div>

          <div class="sgmb-tab-content" data-pane="nap" role="tabpanel" id="sgmb-pane-nap" aria-labelledby="sgmb-tab-nap" hidden>
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">Name, address, phone</h3>
              <div class="sgmb-nap-list">
                ${row('Name', textOr(d.name))}
                ${row('Address', textOr(d.address))}
                ${row('Phone', textOr(d.phone))}
                ${row('Website', website ? `<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">${esc(d.websiteDomain || website)}</a>` : textOr(''))}
                ${row('Plus code', textOr(d.plusCode))}
                ${row('Coordinates', d.latitude ? esc(`${d.latitude}, ${d.longitude}`) : textOr(''))}
              </div>
            </div>
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">Description</h3>
              <p class="sgmb-section-desc">${textOr(d.description, 'No owner-written description')}</p>
            </div>
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">Hours</h3>
              <div class="sgmb-nap-list">${hoursHtml}</div>
            </div>
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">Attributes</h3>
              <div class="sgmb-nap-list">${attributesHtml}</div>
            </div>
            <div class="sgmb-modal-section">
              <h3 class="sgmb-section-title">Identifiers</h3>
              <div class="sgmb-nap-list">
                ${row('Place CID', textOr(d.placeCID))}
                ${row('Place ID', textOr(d.placeId))}
                ${row('Feature ID', textOr(d.featureId))}
                ${row('KGMID', textOr(d.kgmid))}
              </div>
            </div>
          </div>
        </div>

        <div class="sgmb-modal-footer">
          <button class="sgmb-btn sgmb-btn-secondary" data-act="copy">${COPY_SVG}<span>Copy report</span></button>
          <button class="sgmb-btn sgmb-btn-secondary" data-act="reviews">${ns.utils.icons.download}<span>Export reviews</span></button>
          <button class="sgmb-btn sgmb-btn-primary" data-act="csv">${ns.utils.icons.download}<span>Profile CSV</span></button>
        </div>
      `;
    },

    attachListeners(modal, data, result) {
      modal.querySelector('.sgmb-modal-close')?.addEventListener('click', () => this.close());

      const tabBtns = Array.from(modal.querySelectorAll('.sgmb-tab-btn'));
      const selectTab = (btn, focus = false) => {
        tabBtns.forEach((b) => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', String(on));
          b.setAttribute('tabindex', on ? '0' : '-1');
        });
        modal.querySelectorAll('.sgmb-tab-content').forEach((tc) => {
          const on = tc.getAttribute('data-pane') === btn.getAttribute('data-tab');
          tc.classList.toggle('active', on);
          tc.hidden = !on;
        });
        if (focus) btn.focus();
      };
      tabBtns.forEach((btn, i) => {
        btn.addEventListener('click', () => selectTab(btn));
        // WAI-ARIA tabs pattern: arrow keys move between tabs, Home/End jump to the ends.
        btn.addEventListener('keydown', (e) => {
          const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabBtns.length - 1 }[e.key];
          if (next === undefined) return;
          e.preventDefault();
          selectTab(tabBtns[(next + tabBtns.length) % tabBtns.length], true);
        });
      });

      const copyBtn = modal.querySelector('[data-act="copy"]');
      copyBtn?.addEventListener('click', () => {
        navigator.clipboard.writeText(buildReportText(data, result)).then(() => {
          const label = copyBtn.querySelector('span');
          if (!label) return;
          label.textContent = 'Copied';
          setTimeout(() => { label.textContent = 'Copy report'; }, 1800);
        });
      });

      modal.querySelector('[data-act="reviews"]')?.addEventListener('click', () => {
        this.close();
        if (ns.utils.isMaps()) {
          ns.utils.sendMessage({ type: 'runAuditReview', payload: data });
        } else {
          ns.reviewScraper.startExport(data);
        }
      });

      modal.querySelector('[data-act="csv"]')?.addEventListener('click', () => ns.csvExporter.exportBusinessProfile(data));

      const psiBtn = modal.querySelector('[data-act="psi"]');
      psiBtn?.addEventListener('click', async () => {
        const box = modal.querySelector('[data-psi]');
        psiBtn.disabled = true;
        psiBtn.textContent = 'Testing…';
        const res = await ns.utils.sendMessage({ type: 'runPageSpeed', payload: { url: data.website } });
        box.innerHTML = this.renderPageSpeed(res);
      });
    },

    /** Result block for the PageSpeed check. */
    renderPageSpeed(res) {
      const errors = {
        quota: 'Google\'s shared free quota is used up for today. Add your own free PageSpeed API key in the SphereGMB popup → Settings, then try again.',
        bad_key: 'Google rejected the PageSpeed API key saved in Settings. Check it and try again.',
        timeout: 'PageSpeed Insights did not answer within 90 seconds. Try again later.',
        no_website: 'No website linked.',
        extension_reloaded: 'The extension was updated. Reload this tab and try again.'
      };
      if (!res || res.error) {
        return `<p class="sgmb-section-desc">${esc(errors[res?.error] || `PageSpeed check failed${res?.message ? `: ${res.message}` : '.'}`)}</p>`;
      }
      const tone = res.score >= 90 ? 'good' : res.score >= 50 ? 'mid' : 'low';
      const field = { FAST: 'Fast', AVERAGE: 'Needs improvement', SLOW: 'Slow' }[res.fieldCategory] || 'Not enough real-user data';
      return `
        <div class="sgmb-stat-strip sgmb-psi-grid">
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Performance</div><div class="sgmb-metric-val sgmb-tone-text-${tone}">${res.score}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">LCP</div><div class="sgmb-metric-val">${esc(res.lcp || '-')}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">CLS</div><div class="sgmb-metric-val">${esc(res.cls || '-')}</div></div>
          <div class="sgmb-metric-card"><div class="sgmb-metric-label">Real users</div><div class="sgmb-metric-val" style="font-size:14px">${esc(field)}</div></div>
        </div>
        <p class="sgmb-section-desc">Lab test on a mid-range phone. LCP under 2.5 s and CLS under 0.1 are Google's "good" thresholds.</p>`;
    }
  };
})(window.SphereGmb);
