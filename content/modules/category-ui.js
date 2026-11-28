/**
 * GBP Sphere: In-Page Category & Action Widget
 * Renders the Categories line; action-buttons.js adds the toolbar underneath.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const PLACEHOLDER_HTML = `
    <div class="sgmb-categories-line">
      <span class="sgmb-label-wrap"><b>Categories:</b></span>
      <span class="sgmb-chips-container">
        <span class="sgmb-chip sgmb-chip-loading">Loading categories…</span>
      </span>
    </div>
  `;

  ns.categoryUI = {
    /** True while a Google reviews dialog covers the page (no new widgets then). */
    isOnRestrictedTab() {
      if (window.location.hash.toLowerCase().includes('lrd=')) return true;
      const reviewsModal = document.querySelector('[aria-label="Reviews"][role="dialog"], c-wiz.review-dialog-body');
      return Boolean(reviewsModal && reviewsModal.offsetParent !== null);
    },

    /** Builds a detached widget container in its placeholder state. */
    buildContainer(className = '') {
      const container = document.createElement('div');
      container.className = `sgmb-categories-container ${className}`.trim();
      container.dataset.sphereGmbRoot = '1';
      container.innerHTML = PLACEHOLDER_HTML;
      return container;
    },

    /** Creates and appends a widget inside parent, reusing one that is already there. */
    createCategoryContainer(parent, className = '') {
      if (!parent) return null;
      const existing = parent.querySelector('[data-sphere-gmb-root="1"]');
      if (existing) return existing;
      const container = this.buildContainer(className);
      parent.appendChild(container);
      return container;
    },

    /** Renders category chips. Primary category is first and gets the bolt marker. */
    hydrateCategories(container, businessData, { final = false } = {}) {
      const chipsContainer = container?.querySelector('.sgmb-chips-container');
      if (!chipsContainer) return;

      const categories = businessData?.categories || [];
      if (categories.length === 0) {
        if (final) chipsContainer.innerHTML = '<span class="sgmb-chip sgmb-chip-empty">Categories unavailable</span>';
        return;
      }

      const chips = categories.map((cat, index) => {
        const isPrimary = index === 0;
        const cls = isPrimary ? 'sgmb-chip sgmb-chip-primary' : 'sgmb-chip sgmb-chip-secondary';
        const title = isPrimary ? 'Primary GBP category' : 'Secondary GBP category';
        const bolt = isPrimary ? ns.utils.icons.bolt : '';
        return `<span class="${cls}" title="${title}">${bolt}${ns.utils.escapeHtml(cat)}</span>`;
      });

      // Only the primary category is visible on the page until the full profile arrives.
      if (businessData.categoriesSource !== 'profile' && !final) {
        chips.push('<span class="sgmb-chip sgmb-chip-loading">Checking secondary…</span>');
      }
      chipsContainer.innerHTML = chips.join(' ');
      if (final) this.renderFindMore(container, businessData);
      if (final && businessData.profileLoaded) this.renderScorePill(container, businessData);
    },

    /** "Find more" link after the chips: related real categories, services and keywords. */
    renderFindMore(container, businessData) {
      const chipsContainer = container.querySelector('.sgmb-chips-container');
      if (!chipsContainer || !(businessData.categories || []).length || chipsContainer.querySelector('.sgmb-find-more')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sgmb-find-more';
      btn.title = 'Related Google categories, predefined services and keyword ideas';
      btn.innerHTML = `${ns.utils.icons.rank}<span>Find more</span>`;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const data = await ns.actionButtons.ensureProfile(container._businessData || businessData);
        ns.actionButtons.openReport(data, 'categories');
      }, { capture: true });
      chipsContainer.appendChild(btn);
    },

    /** Completeness score next to the categories; opens the audit drawer. */
    renderScorePill(container, businessData) {
      const line = container.querySelector('.sgmb-categories-line');
      if (!line || !ns.auditEngine) return;
      const score = ns.auditEngine.calculateCompletenessScore(businessData);
      let pill = line.querySelector('.sgmb-score-pill');
      if (!pill) {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          container.querySelector('[data-action="dashboard"]')?.click();
        }, { capture: true });
        line.appendChild(pill);
      }
      pill.className = `sgmb-score-pill ${score >= 85 ? 'is-good' : score >= 65 ? 'is-mid' : 'is-low'}`;
      pill.title = `Profile completeness ${score} of 100, open the full report`;
      pill.setAttribute('aria-label', pill.title);
      pill.innerHTML = `${score}<small>/100</small>`;
    },

    /**
     * Fetches the full profile for businessData.featureId, merges it, and re-renders.
     * Safe to call repeatedly: concurrent calls for one container are collapsed.
     */
    async resolveProfile(container, businessData) {
      if (!container || container._sgmbResolving) return;
      if (!businessData.featureId) {
        this.hydrateCategories(container, businessData, { final: true });
        return;
      }
      container._sgmbResolving = true;
      try {
        const profile = await ns.api.fetchPlaceProfile(businessData.featureId);
        ns.utils.mergeProfile(businessData, profile);
      } finally {
        container._sgmbResolving = false;
        this.hydrateCategories(container, businessData, { final: true });
      }
    }
  };
})(window.SphereGmb);
