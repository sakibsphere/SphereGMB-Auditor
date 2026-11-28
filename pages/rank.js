/**
 * GBP Sphere: bulk rank check (extension page).
 *
 * Opens one Google search per keyword in a background tab (?sgmbRank=<job>.<index>), waits for
 * content/modules/rank-runner.js in that tab to report the positions, closes the tab and pauses
 * before the next search. Stops for good if Google shows its "unusual traffic" page.
 */

/* global SgmbPage, SphereGmbCategoryTools */
(function () {
  'use strict';

  const { ICONS, esc, copyText, downloadText, toCsv, slug, sleep } = SgmbPage;
  const CT = SphereGmbCategoryTools;
  const MAX_KEYWORDS = 30;
  const RESULT_TIMEOUT_MS = 30000;
  const $ = (id) => document.getElementById(id);

  let business = {};
  let prefilledName = '';
  let running = false;
  let stopRequested = false;
  let results = [];
  let previous = {};
  let currentTabId = null;
  let mode = 'local';
  const waiters = new Map();

  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; });

  /* Results posted by the search tabs. */
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'rankResult' || !msg.payload) return false;
    const key = `${msg.payload.jobId}.${msg.payload.index}`;
    const w = waiters.get(key);
    if (w) {
      waiters.delete(key);
      w(msg.payload);
    }
    return false;
  });

  function keywords() {
    return $('kw').value.split(/\r?\n/).map((k) => k.trim()).filter(Boolean)
      .filter((k, i, all) => all.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i);
  }

  /** Keywords as they will be searched: location added, then de-duplicated, then capped. */
  function finalKeywords() {
    const list = $('use-loc').checked ? CT.withLocation(keywords(), $('loc').value) : keywords();
    const seen = new Set();
    return list.filter((k) => { const key = k.toLowerCase().replace(/\s+/g, ' '); return !seen.has(key) && seen.add(key); }).slice(0, MAX_KEYWORDS);
  }

  function updatePreview() {
    const all = keywords();
    const list = finalKeywords();
    const over = all.length > MAX_KEYWORDS ? ` Only the first ${MAX_KEYWORDS} will run.` : '';
    $('loc-preview').textContent = list.length
      ? `${list.length} search${list.length === 1 ? '' : 'es'}, for example "${list[0]}".${over}`
      : 'Add at least one keyword.';
    $('loc').disabled = !$('use-loc').checked;
  }

  function searchUrl(keyword, jobId, index) {
    const p = new URLSearchParams({ q: keyword, hl: 'en' });
    // udm=local is the Local Finder; the older tbm=lcl redirects there and drops unknown params.
    if ($('mode').value === 'local') p.set('udm', 'local');
    p.set('sgmbRank', `${jobId}.${index}`);
    return `https://www.google.com/search?${p}`;
  }

  function posBadge(pos, found) {
    if (!found) return '<span class="pos pos-none">n/a</span>';
    if (!pos) return '<span class="pos pos-none" title="Not in the results that loaded">None</span>';
    return `<span class="pos ${pos <= 3 ? 'pos-top' : pos <= 10 ? 'pos-mid' : 'pos-none'}">${pos}</span>`;
  }

  function changeCell(r) {
    const before = previous[r.keyword.toLowerCase()];
    if (!r.done || before === undefined || r.localRank === null && before === null) return '<span class="muted">-</span>';
    if (before === null) return '<span class="badge badge-good">New</span>';
    if (r.localRank === null) return '<span class="badge badge-bad">Lost</span>';
    const d = before - r.localRank;
    if (!d) return '<span class="muted">Same</span>';
    return d > 0 ? `<span class="badge badge-good">Up ${d}</span>` : `<span class="badge badge-bad">Down ${-d}</span>`;
  }

  function renderRows() {
    $('results-section').hidden = !results.length;
    $('rows').innerHTML = results.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${esc(r.keyword)}</td>
        <td>${r.status === 'pending' ? '<span class="muted">Waiting</span>' : r.status === 'running' ? '<span class="muted">Searching…</span>' : r.status === 'done' ? posBadge(r.localRank, true) : `<span class="badge badge-mid">${esc(r.statusLabel || r.status)}</span>`}</td>
        <td>${changeCell(r)}</td>
        <td>${r.done && business.domain && mode === 'web' ? posBadge(r.organicRank, true) : '<span class="muted" title="Website positions are read in the Web results mode">-</span>'}</td>
        <td>${r.top?.length ? `${esc(r.top[0].name)}<div class="hint">${esc(r.top[0].category || '')}</div>` : ''}</td>
        <td><a class="icon-btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open the search for ${esc(r.keyword)}">${ICONS.external}</a></td>
      </tr>`).join('');
    const done = results.filter((r) => r.done);
    const top3 = done.filter((r) => r.localRank && r.localRank <= 3).length;
    const top10 = done.filter((r) => r.localRank && r.localRank <= 10).length;
    $('summary').textContent = done.length
      ? `${done.length} of ${results.length} checked. In the top 3 for ${top3}, top 10 for ${top10}, not found for ${done.filter((r) => !r.localRank).length}.`
      : `${results.length} keywords queued.`;
    document.querySelectorAll('[data-act="copy"], [data-act="csv"]').forEach((b) => { b.disabled = !done.length; });
  }

  function waitForResult(key) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(key);
        resolve({ status: 'timeout' });
      }, RESULT_TIMEOUT_MS);
      waiters.set(key, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  async function run(startAt = 0) {
    if (running) return;
    const list = finalKeywords();
    if (!list.length) {
      $('status').textContent = 'Add at least one keyword first.';
      $('kw').focus();
      return;
    }
    // The hidden street and phone belong to the prefilled business only.
    if ($('t-name').value.trim() !== prefilledName) { delete business.street; delete business.phone; }
    business = {
      ...business,
      name: $('t-name').value.trim(),
      cid: $('t-cid').value.trim(),
      domain: $('t-domain').value.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    };
    if (!business.name && !business.cid) {
      $('status').textContent = 'Enter the business name (or its CID) so it can be found in the results.';
      $('t-name').focus();
      return;
    }
    const jobId = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    mode = $('mode').value;
    await saveJob(jobId, { target: business });
    const { rankHistory = {} } = await SgmbPage.storageGet('rankHistory');
    const historyKey = `${(business.cid || business.name).toLowerCase()}|${mode}`;
    previous = rankHistory[historyKey] || {};

    if (startAt === 0) {
      results = list.map((keyword) => ({ keyword, status: 'pending', done: false, url: '' }));
    }
    running = true;
    stopRequested = false;
    toggleRunning(true);
    renderRows();
    const delay = Number($('delay').value) * 1000;

    for (let i = startAt; i < results.length; i++) {
      if (stopRequested) break;
      const r = results[i];
      r.url = searchUrl(r.keyword, jobId, i);
      r.status = 'running';
      renderRows();
      $('status').textContent = `Searching "${r.keyword}" (${i + 1} of ${results.length})`;
      $('progress').firstElementChild.style.width = `${Math.round((i / results.length) * 100)}%`;

      let tab = null;
      try {
        // Fallback for the search tab if Google ever strips ?sgmbRank from the URL.
        await saveJob(jobId, { target: business, pending: { index: i, keyword: r.keyword, ts: Date.now() } });
        tab = await chrome.tabs.create({ url: r.url, active: false });
        currentTabId = tab.id;
      } catch (e) {
        r.status = 'error';
        r.statusLabel = 'Could not open tab';
        continue;
      }
      const res = await waitForResult(`${jobId}.${i}`);
      try { if (tab?.id) await chrome.tabs.remove(tab.id); } catch (e) { /* closed by the user */ }
      currentTabId = null;

      if (res.status === 'blocked') {
        r.status = 'blocked';
        r.statusLabel = 'Google check';
        renderRows();
        $('status').innerHTML = '';
        $('status').append('Google showed a "verify you\'re human" page. Open google.com in a normal tab and finish it yourself, wait a few minutes, then ');
        const resume = document.createElement('button');
        resume.className = 'btn';
        resume.type = 'button';
        resume.textContent = 'Resume';
        resume.addEventListener('click', () => { r.status = 'pending'; run(i); });
        $('status').append(resume);
        running = false;
        toggleRunning(false);
        return;
      }
      // "empty" means the results never rendered: unknown, not "not found", and not saved.
      r.done = res.status === 'done';
      r.status = r.done ? 'done' : res.status;
      r.statusLabel = { timeout: 'No answer', empty: 'Results did not load' }[res.status] || '';
      r.localRank = res.localRank ?? null;
      r.organicRank = res.organicRank ?? null;
      r.top = res.top || [];
      renderRows();
      if (i < results.length - 1 && !stopRequested) await sleep(delay);
    }

    running = false;
    toggleRunning(false);
    $('progress').firstElementChild.style.width = '100%';
    const done = results.filter((r) => r.done);
    $('status').textContent = stopRequested ? `Stopped after ${done.length} searches.` : `Finished: ${done.length} searches.`;
    await removeJob(jobId);
    // Remember positions (per business and mode) so the next run can show the change.
    const snapshot = { ...previous };
    for (const r of done) snapshot[r.keyword.toLowerCase()] = r.localRank;
    rankHistory[historyKey] = snapshot;
    const keys = Object.keys(rankHistory);
    if (keys.length > 50) delete rankHistory[keys[0]];
    await chrome.storage.local.set({ rankHistory });
  }

  /** Jobs are stored per id so two Rank check pages can run without mixing targets. */
  async function saveJob(id, job) {
    const { rankJobs = {} } = await SgmbPage.storageGet('rankJobs');
    const now = Date.now();
    for (const [k, v] of Object.entries(rankJobs)) if (now - (v.ts || 0) > 2 * 60 * 60 * 1000) delete rankJobs[k];
    rankJobs[id] = { ...job, id, ts: now };
    await chrome.storage.local.set({ rankJobs });
  }

  async function removeJob(id) {
    const { rankJobs = {} } = await SgmbPage.storageGet('rankJobs');
    delete rankJobs[id];
    await chrome.storage.local.set({ rankJobs });
  }

  // Closing this page mid-run must not leave a background search tab behind.
  window.addEventListener('pagehide', () => {
    if (currentTabId) chrome.tabs.remove(currentTabId).catch(() => {});
  });

  function toggleRunning(on) {
    document.querySelector('[data-act="start"]').hidden = on;
    document.querySelector('[data-act="stop"]').hidden = !on;
    $('progress').hidden = !on;
    ['kw', 't-name', 't-cid', 't-domain', 'loc', 'use-loc', 'mode', 'delay'].forEach((id) => { $(id).disabled = on; });
    if (!on) updatePreview();
  }

  function resultsCsv() {
    return toCsv(['Keyword', 'Map rank', 'Website rank', 'Top result', 'Top result category', 'Search URL'],
      results.filter((r) => r.done).map((r) => [r.keyword, r.localRank || 'Not found', business.domain && mode === 'web' ? (r.organicRank || 'Not found') : '', r.top?.[0]?.name || '', r.top?.[0]?.category || '', r.url]));
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'start') run(0);
    else if (act === 'stop') { stopRequested = true; $('status').textContent = 'Stopping after this search…'; }
    else if (act === 'clear-kw') { $('kw').value = ''; updatePreview(); }
    else if (act === 'add-cats') {
      const cats = (business.categories || []).map((c) => c.toLowerCase());
      $('kw').value = [...new Set(keywords().concat(cats))].join('\n');
      updatePreview();
    } else if (act === 'copy') {
      copyText(results.filter((r) => r.done).map((r) => `${r.keyword}\t${r.localRank || 'not found'}`).join('\n'), el);
    } else if (act === 'csv') downloadText(`rank-check-${slug(business.name || business.cid)}-${new Date().toISOString().slice(0, 10)}.csv`, resultsCsv());
  });
  ['kw', 'loc', 'use-loc'].forEach((id) => $(id).addEventListener('input', updatePreview));
  $('use-loc').addEventListener('change', updatePreview);

  async function init() {
    const { lastBusiness, rankDraft, rankPrefs } = await SgmbPage.storageGet(['lastBusiness', 'rankDraft', 'rankPrefs']);
    business = lastBusiness || {};
    prefilledName = business.name || '';
    $('t-name').value = business.name || '';
    $('t-cid').value = business.cid || '';
    $('t-domain').value = business.domain || '';
    $('loc').value = (rankDraft && rankDraft.location) || business.city || '';
    if (rankPrefs) {
      if (rankPrefs.mode) $('mode').value = rankPrefs.mode;
      if (rankPrefs.delay) $('delay').value = String(rankPrefs.delay);
    }
    const fresh = rankDraft && Date.now() - (rankDraft.ts || 0) < 10 * 60 * 1000;
    const draftKw = fresh && Array.isArray(rankDraft.keywords) && rankDraft.keywords.length ? rankDraft.keywords : null;
    $('kw').value = (draftKw || (business.categories || []).map((c) => c.toLowerCase())).join('\n');
    if (fresh && typeof rankDraft.useLocation === 'boolean') $('use-loc').checked = rankDraft.useLocation;
    if (rankDraft) await chrome.storage.local.remove('rankDraft');
    updatePreview();
    ['mode', 'delay'].forEach((id) => $(id).addEventListener('change', () => chrome.storage.local.set({ rankPrefs: { mode: $('mode').value, delay: Number($('delay').value) } })));
    if (fresh && rankDraft.autostart) run(0);
  }

  init();
})();
