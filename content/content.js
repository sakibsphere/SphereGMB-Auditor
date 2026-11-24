/**
 * SphereGMB: Content Script Entry Point
 * Scans Google Search / Maps for business profiles, watches SPA navigation, and runs the
 * automated audit workflows that the service worker opens in new tabs.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const WORKFLOW_PARAM = 'sphereGmbAudit';
  let mutationObserver = null;
  let urlWatcher = null;
  let scanTimer = null;
  let isEnabled = true;
  let initialized = false;
  let workflowStarted = false;
  let rankChecked = false;
  let lastUrl = window.location.href;

  async function runAuditor() {
    if (!isEnabled || isRankTab()) return;
    if (!ns.utils.isExtensionAlive()) {
      // The extension was reloaded or removed; this copy of the script is orphaned.
      uninitialize();
      return;
    }
    try {
      ns.utils.applyTheme();
      if (ns.utils.isMaps()) {
        await ns.domMaps.processMapsPlace();
        await ns.domMaps.processMapsSearch();
      } else {
        await ns.domSerp.processKp();
        await ns.domSerp.processLocalPack();
        ns.paa.inject();
      }
      // Cheap gate: only look for a reviews dialog when a dialog exists.
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) {
        ns.reviewScraper.injectModalExportButton();
      }
    } catch (err) {
      ns.utils.log('Error during scan cycle:', err);
    }
  }

  /** Debounced scan: Google mutates the DOM constantly, so coalesce bursts into one pass. */
  function scheduleScan(delay = 400) {
    if (!isEnabled || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      runAuditor();
    }, delay);
  }

  function showAuditBanner(title, status) {
    let banner = document.getElementById('sgmb-auto-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sgmb-auto-banner';
      banner.className = 'sgmb-audit-banner';
      banner.setAttribute('role', 'status');
      document.body.appendChild(banner);
    }
    banner.innerHTML = `
      <div class="sgmb-banner-text">
        <strong>${ns.utils.escapeHtml(title)}</strong>
        <span>${ns.utils.escapeHtml(status)}</span>
      </div>
      <button class="sgmb-toast-close" type="button" aria-label="Close">&times;</button>
    `;
    banner.querySelector('.sgmb-toast-close')?.addEventListener('click', () => banner.remove());
    return banner;
  }

  function hideAuditBanner(delay = 0) {
    setTimeout(() => document.getElementById('sgmb-auto-banner')?.remove(), delay);
  }

  /**
   * Business data for an automated tab: only the payload the service worker stored for this
   * exact tab (matched by the one-time code in the URL). A crafted link gets nothing.
   */
  async function resolveWorkflowData(auditType, nonce) {
    const stored = await ns.utils.sendMessage({ type: 'consumeActiveAudit', payload: { auditType, nonce } });
    return stored && stored.name ? stored : null;
  }

  /** Rank-check search tabs only report positions; no widgets, no profile lookups. */
  function isRankTab() {
    return /[?&]sgmbRank=/.test(window.location.search) || Boolean(ns.rankRunner?.activeJob);
  }

  /**
   * Runs once per page load for tabs opened with ?sphereGmbAudit=review|photo|post.
   * The parameter is removed from the URL so later SPA navigation can't re-trigger it.
   */
  async function runWorkflowOnce() {
    if (workflowStarted) return;
    const params = new URLSearchParams(window.location.search);
    const auditType = params.get(WORKFLOW_PARAM);
    if (!auditType) return;
    workflowStarted = true;
    const nonce = params.get('sgmbNonce') || '';

    params.delete(WORKFLOW_PARAM);
    params.delete('sgmbNonce');
    const cleanUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    try { history.replaceState(history.state, '', cleanUrl); } catch (e) { /* cross-origin guard */ }
    lastUrl = window.location.href;

    const data = await resolveWorkflowData(auditType, nonce);
    if (!data) return; // not a tab SphereGMB opened, or the payload expired
    if (auditType === 'review') {
      showAuditBanner('SphereGMB review export', 'Opening reviews…');
      ns.reviewScraper.pendingAuditData = data;
      await ns.utils.sleep(1500);
      await ns.reviewScraper.startExport(data);
      showAuditBanner('Review export finished', `Reviews for ${data.name || 'this business'} were saved as CSV.`);
      hideAuditBanner(6000);
    } else if (auditType === 'photo' || auditType === 'post') {
      await ns.utils.sleep(2500);
      await runAuditor();
      if (auditType === 'photo') ns.photoAudit.show(data);
      else ns.postAudit.show(data);
    }
  }

  /** Result banner for the "SERP Checker" button (?sgmbRankCid / ?sgmbRankName). */
  function runRankCheckOnce() {
    if (rankChecked || ns.utils.isMaps()) return;
    const params = new URLSearchParams(window.location.search);
    const cid = params.get('sgmbRankCid');
    const name = (params.get('sgmbRankName') || '').toLowerCase();
    if (!cid && !name) return;
    rankChecked = true;

    const rows = Array.from(document.querySelectorAll('.sgmb-local-pack')).map((c) => c._businessData).filter(Boolean);
    const index = rows.findIndex((b) => (cid && b.placeCID === cid) || (name && (b.name || '').toLowerCase() === name));
    const keyword = params.get('q') || '';
    if (index >= 0) {
      showAuditBanner(`Ranked #${index + 1} in the local pack`, `For “${keyword}” from your current location.`);
    } else if (rows.length) {
      showAuditBanner('Not in the local pack', `${rows.length} businesses shown for “${keyword}”. Open “More places” to check deeper positions.`);
    } else {
      showAuditBanner('No local pack on this page', `Google did not show map results for “${keyword}”.`);
    }
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    ns.utils.log('Content engine started');

    runWorkflowOnce();
    runAuditor();
    // Google streams panels in after document_idle; a few staged passes catch late content.
    [800, 2000, 4000].forEach((ms) => setTimeout(runAuditor, ms));
    setTimeout(runRankCheckOnce, 4500);

    urlWatcher = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        scheduleScan(150);
      }
    }, 700);

    if (document.body) {
      mutationObserver = new MutationObserver(() => scheduleScan());
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function uninitialize() {
    initialized = false;
    if (mutationObserver) mutationObserver.disconnect();
    mutationObserver = null;
    if (urlWatcher) clearInterval(urlWatcher);
    urlWatcher = null;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;

    document.querySelectorAll('[data-sphere-gmb-root="1"], #sgmb-modal-export-btn').forEach((el) => el.remove());
    document.querySelectorAll('[data-sgmb-spidered]').forEach((el) => el.removeAttribute('data-sgmb-spidered'));
    hideAuditBanner();
    ns.reviewScraper?.hideToast();
  }

  function start() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
  }

  try {
    chrome.storage.local.get(['enabled'], (result) => {
      isEnabled = result.enabled !== false;
      if (isEnabled) start();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || changes.enabled === undefined) return;
      isEnabled = changes.enabled.newValue !== false;
      if (isEnabled) start();
      else uninitialize();
    });
  } catch (e) {
    start();
  }
})(window.SphereGmb);
