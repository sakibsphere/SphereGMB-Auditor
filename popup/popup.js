/**
 * SphereGMB: Popup Logic
 * Tabs (WAI-ARIA pattern), on/off switch, recent reports, bulk rank check, CID decoder,
 * saved-data management, PageSpeed key.
 */

/* global SphereGmbCategoryTools */

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('enabledToggle');
  const statusState = document.getElementById('statusState');
  const navTabs = Array.from(document.querySelectorAll('.nav-tab'));

  const decoderInput = document.getElementById('decoderInput');
  const decodeBtn = document.getElementById('decodeBtn');
  const decoderResults = document.getElementById('decoderResults');
  const resCid = document.getElementById('resCid');
  const resFeatureId = document.getElementById('resFeatureId');
  const resMapsLink = document.getElementById('resMapsLink');

  const cacheCountLabel = document.getElementById('cacheCountLabel');
  const clearCacheBtn = document.getElementById('clearCacheBtn');

  // 1. Tabs: click, Arrow keys, Home/End
  function selectTab(tab, focus = false) {
    navTabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.setAttribute('tabindex', on ? '0' : '-1');
      const pane = document.getElementById(t.getAttribute('data-tab'));
      if (pane) {
        pane.classList.toggle('active', on);
        pane.hidden = !on;
      }
    });
    if (focus) tab.focus();
    if (tab.getAttribute('data-tab') === 'tab-settings') refreshCacheStats();
  }
  navTabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: navTabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      selectTab(navTabs[(next + navTabs.length) % navTabs.length], true);
    });
  });

  // 2. On/off switch
  function updateStatusUi(isEnabled) {
    toggle.checked = isEnabled;
    statusState.textContent = isEnabled ? 'Active on Search and Maps' : 'Paused, nothing is added to Google pages';
    statusState.classList.toggle('disabled', !isEnabled);
  }
  chrome.storage.local.get('enabled', (res) => updateStatusUi(res.enabled !== false));
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.storage.local.set({ enabled: isEnabled }, () => updateStatusUi(isEnabled));
  });

  // 3. CID decoder
  function decode() {
    const inputVal = (decoderInput.value || '').trim();
    if (!inputVal) {
      decoderInput.setAttribute('aria-invalid', 'true');
      resCid.textContent = 'Paste a Google Maps link, a feature ID or a CID first';
      resFeatureId.textContent = '-';
      resMapsLink.hidden = true;
      decoderResults.hidden = false;
      return;
    }

    // Feature ID first, so "cid=0x…" can't match a stray leading zero.
    const featureMatch = inputVal.match(/0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/);
    const featureId = featureMatch ? featureMatch[0] : null;
    let cid = null;
    if (featureId) {
      try {
        cid = BigInt(featureId.split(':')[1]).toString();
      } catch (e) {
        cid = null;
      }
    }
    if (!cid) {
      const urlCidMatch = inputVal.match(/[?&#](?:ludo)?cid=(\d{15,20})(?:[^\d]|$)/i) || inputVal.match(/\b(?:ludo)?cid=(\d{15,20})\b/i);
      if (urlCidMatch && urlCidMatch[1]) cid = urlCidMatch[1];
      else if (/^\d{15,20}$/.test(inputVal)) cid = inputVal;
    }

    decoderInput.setAttribute('aria-invalid', String(!(cid || featureId)));
    if (cid || featureId) {
      resCid.textContent = cid || 'Could not be worked out from this input';
      resFeatureId.textContent = featureId || 'Not in this input';
      resMapsLink.hidden = !cid;
      if (cid) resMapsLink.href = `https://www.google.com/maps?cid=${cid}`;
    } else {
      resCid.textContent = 'No CID or feature ID found in that input';
      resFeatureId.textContent = '-';
      resMapsLink.hidden = true;
    }
    decoderResults.hidden = false;
  }
  decodeBtn.addEventListener('click', decode);
  decoderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') decode();
  });

  // 4. Saved place data (profile cache)
  function refreshCacheStats() {
    chrome.runtime.sendMessage({ type: 'getCacheStats' }, (res) => {
      const count = res?.cachedPlacesCount || 0;
      const reports = res?.reportsCount || 0;
      const mb = typeof res?.bytesInUse === 'number' ? `, ${(res.bytesInUse / 1048576).toFixed(1)} MB` : '';
      cacheCountLabel.textContent = `${count} place profiles cached, ${reports} reports${mb}`;
    });
  }
  // Clears places, reports, rank history and the downloaded category list; settings stay.
  clearCacheBtn.addEventListener('click', () => {
    clearCacheBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'clearAllData' }, () => {
      refreshCacheStats();
      clearCacheBtn.textContent = 'Cleared';
      setTimeout(() => {
        clearCacheBtn.textContent = 'Clear saved data';
        clearCacheBtn.disabled = false;
      }, 1500);
    });
  });
  refreshCacheStats();

  // 5. Optional PageSpeed Insights API key (stored locally only), validated inline
  const psiKeyInput = document.getElementById('psiKeyInput');
  const psiKeySave = document.getElementById('psiKeySave');
  const psiKeyStatus = document.getElementById('psiKeyStatus');
  const KEY_RE = /^AIza[0-9A-Za-z_-]{35}$/;

  chrome.storage.local.get('psiApiKey', ({ psiApiKey }) => {
    psiKeyStatus.textContent = psiApiKey ? 'A key is saved.' : 'No key saved, using the shared quota.';
  });

  psiKeyInput.addEventListener('input', () => {
    const key = psiKeyInput.value.trim();
    const bad = key.length > 0 && !KEY_RE.test(key);
    psiKeyInput.setAttribute('aria-invalid', String(bad));
    psiKeyStatus.textContent = bad ? 'This doesn\'t look like a Google API key (it should start with "AIza" and be 39 characters).' : '';
  });

  psiKeySave.addEventListener('click', () => {
    const key = (psiKeyInput.value || '').trim();
    if (key && !KEY_RE.test(key)) {
      psiKeyInput.setAttribute('aria-invalid', 'true');
      psiKeyStatus.textContent = 'Not saved: Google API keys start with "AIza" and are 39 characters long.';
      psiKeyInput.focus();
      return;
    }
    const done = () => {
      psiKeyInput.value = '';
      psiKeyInput.setAttribute('aria-invalid', 'false');
      psiKeyStatus.textContent = key ? 'Key saved.' : 'Key removed, using the shared quota.';
    };
    if (key) chrome.storage.local.set({ psiApiKey: key }, done);
    else chrome.storage.local.remove('psiApiKey', done);
  });

  // 6. Recent reports (last three Dashboard snapshots)
  chrome.storage.local.get('savedReports', ({ savedReports = [] }) => {
    const list = document.getElementById('recentList');
    const recent = savedReports.filter((r) => r && r.id).slice(0, 3);
    document.getElementById('recentSection').hidden = !recent.length;
    recent.forEach((r) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = chrome.runtime.getURL(`pages/report.html?id=${encodeURIComponent(r.id)}`);
      a.target = '_blank';
      a.className = 'recent-link';
      a.textContent = r.name || 'Business profile';
      const when = document.createElement('span');
      when.className = 'recent-when';
      when.textContent = new Date(r.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      a.appendChild(when);
      li.appendChild(a);
      list.appendChild(li);
    });
  });

  // 7. Rank check: keywords (categories by default) with an optional location on each
  const rankName = document.getElementById('rankName');
  const rankKeywords = document.getElementById('rankKeywords');
  const rankUseLoc = document.getElementById('rankUseLoc');
  const rankLoc = document.getElementById('rankLoc');
  const rankPreview = document.getElementById('rankPreview');
  const rankTarget = document.getElementById('rankTarget');
  let lastBusiness = null;

  const rankList = () => rankKeywords.value.split(/\r?\n/).map((k) => k.trim()).filter(Boolean).slice(0, 30);
  function updateRankPreview() {
    rankLoc.disabled = !rankUseLoc.checked;
    const list = rankUseLoc.checked ? SphereGmbCategoryTools.withLocation(rankList(), rankLoc.value) : rankList();
    rankPreview.textContent = list.length ? `${list.length} searches, e.g. "${list[0]}"` : 'Add at least one keyword.';
  }
  chrome.storage.local.get('lastBusiness', (res) => {
    lastBusiness = res.lastBusiness || null;
    if (lastBusiness) {
      rankTarget.textContent = 'Filled in from the last business you opened. Change anything you like.';
      rankName.value = lastBusiness.name || '';
      rankKeywords.value = (lastBusiness.categories || []).map((c) => c.toLowerCase()).join('\n');
      rankLoc.value = lastBusiness.city || '';
    }
    updateRankPreview();
  });
  [rankKeywords, rankLoc].forEach((el) => el.addEventListener('input', updateRankPreview));
  rankUseLoc.addEventListener('change', updateRankPreview);

  async function openRank(autostart) {
    if (autostart && !rankList().length) {
      rankKeywords.setAttribute('aria-invalid', 'true');
      rankKeywords.focus();
      return;
    }
    const same = lastBusiness && rankName.value.trim() === lastBusiness.name;
    const target = same ? lastBusiness : { name: rankName.value.trim(), cid: '', domain: '', categories: [], city: rankLoc.value.trim() };
    await chrome.storage.local.set({
      lastBusiness: { ...target, ts: Date.now() },
      rankDraft: { keywords: rankList(), useLocation: rankUseLoc.checked, location: rankLoc.value.trim(), autostart: autostart && Boolean(rankName.value.trim()), ts: Date.now() }
    });
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/rank.html') });
  }
  document.getElementById('rankStart').addEventListener('click', () => openRank(true));
  document.getElementById('rankOpen').addEventListener('click', () => openRank(false));
});
