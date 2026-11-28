/**
 * GBP Sphere: full profile report (extension page).
 *
 * Opened by the Dashboard button with ?id=<snapshot>. Shows every public field of the profile,
 * its IDs, real Google categories related to it, a keyword finder, the audit checklist and
 * grouped research links. Everything runs in this page; the only network calls are the ones
 * the user starts (category list download, Google suggestions, PageSpeed).
 */

/* global SgmbPage, SphereGmbCategoryTools, SphereGmbReportLinks, SphereGmbBenchmark, SphereGmbSiteAudit, SphereGmbPageSpeed, SphereGmbAuditSheets, SphereGmbXlsx */
(function () {
  'use strict';

  const { ICONS, esc, safeUrl, fmt, copyText, downloadText, toCsv, slug, sleep } = SgmbPage;
  const CT = SphereGmbCategoryTools;
  const STATUS_LABEL = { pass: 'Pass', warn: 'Improve', fail: 'Missing', unknown: 'Not checked' };
  const STATUS_ICON = { pass: ICONS.check, warn: ICONS.alert, fail: ICONS.cross, unknown: ICONS.minus };
  const SECTION_FOR_GROUP = { google: 'google', directories: 'directories', audit: 'website' };

  let data = {};
  let audit = null;
  let library = null;
  let bench = null;
  let benchSource = '';
  let fixes = [];
  let snapshot = {};
  let cachePeers = [];
  let customComps = [];
  let localPeers = []; // Google Maps results searched from the business's address
  let localKeyword = '';
  let lastAudits = null;
  const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  const PRIORITY_BADGE = { high: 'badge-bad', medium: 'badge-mid', low: '' };
  const keywordState = { results: new Map(), selected: new Set() };

  function fillIcons(rootEl = document) {
    rootEl.querySelectorAll('[data-icon]').forEach((el) => {
      if (!el.dataset.filled && ICONS[el.dataset.icon]) {
        el.innerHTML = ICONS[el.dataset.icon];
        el.dataset.filled = '1';
      }
    });
  }

  function value(v, fallback = 'Not listed') {
    const s = v === null || v === undefined ? '' : String(v).trim();
    return s ? esc(s) : `<span class="empty">${esc(fallback)}</span>`;
  }

  function copyBtn(text, label) {
    if (!text) return '<span></span>';
    return `<button class="icon-btn" type="button" data-copy="${esc(text)}" aria-label="Copy ${esc(label)}" title="Copy">${ICONS.copy}</button>`;
  }

  function kv(label, html, copy = '') {
    return `<div class="kv-row"><div class="kv-label">${esc(label)}</div><div class="kv-value">${html}</div>${copyBtn(copy, label)}</div>`;
  }

  function city() {
    return SphereGmbReportLinks.cityOf(data);
  }

  /* ---------- Render ---------- */

  function renderHero() {
    const score = audit?.score ?? 0;
    const r = 52;
    const c = 2 * Math.PI * r;
    const tone = score >= 85 ? 'good' : score >= 65 ? 'mid' : 'bad';
    const claimed = data.claimed === true ? '<span class="badge badge-good">' + ICONS.shield + ' Claimed</span>'
      : data.claimed === false ? '<span class="badge badge-bad">Unclaimed</span>' : '';
    const primary = (data.categories || [])[0];
    return `
      <section class="hero" id="overview" aria-labelledby="biz-name">
        <div>
          <span class="eyebrow">${ICONS.pin} Google Business Profile</span>
          <h1 id="biz-name">${esc(data.name || 'Business profile')}</h1>
          <div class="hero-meta">
            ${primary ? `<span class="badge badge-accent">${esc(primary)}</span>` : ''}
            ${claimed}
            ${data.rating ? `<span class="stars">${ICONS.star}${esc(data.rating)}<span class="muted" style="font-weight:400">(${fmt(data.numReviews)} reviews)</span></span>` : ''}
            ${data.address ? `<span>${esc(data.address)}</span>` : ''}
          </div>
        </div>
        <div class="score-ring" role="img" aria-label="Profile completeness ${score} out of 100, ${esc(audit?.grade || '')}">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="track" cx="60" cy="60" r="${r}" fill="none" stroke-width="10"/>
            <circle class="value" cx="60" cy="60" r="${r}" fill="none" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" data-offset="${(c * (1 - score / 100)).toFixed(1)}"
              style="stroke: var(--${tone === 'bad' ? 'bad' : tone === 'mid' ? 'mid' : 'accent'})"/>
          </svg>
          <div class="label"><strong>${score}</strong><span>${esc(audit?.grade || '')}</span></div>
        </div>
      </section>
      <dl class="stats">
        <div class="stat"><dt>Rating</dt><dd>${data.rating ? `${esc(data.rating)} / 5` : 'None'}</dd></div>
        <div class="stat"><dt>Reviews</dt><dd>${fmt(data.numReviews)}</dd></div>
        <div class="stat"><dt>Categories</dt><dd>${(data.categories || []).length}</dd></div>
        <div class="stat"><dt>Checks passed</dt><dd>${audit ? `${audit.checks.filter((x) => x.status === 'pass').length} of ${audit.checks.filter((x) => x.status !== 'unknown').length}` : 'n/a'}</dd></div>
      </dl>`;
  }

  function renderFixes() {
    const counts = { high: 0, medium: 0, low: 0 };
    fixes.forEach((f) => { counts[f.priority]++; });
    return `
      <section class="section" id="fixes" aria-labelledby="h-fixes">
        <div class="section-head">
          <div><h2 id="h-fixes">Fix list</h2><p class="section-desc">${fixes.length ? `${counts.high} high, ${counts.medium} medium and ${counts.low} low priority, from the audit${bench ? ' and the competitor comparison' : ''}. Start at the top.` : 'Nothing to fix: every check passed.'}</p></div>
          <button class="btn no-print" type="button" data-act="sheets"><span data-icon="copy"></span><span data-label="Copy for Google Sheets">Copy for Google Sheets</span></button>
        </div>
        ${fixes.length ? `<ol class="fixes">${fixes.map((f) => `
          <li class="fix fix-${f.priority}">
            <span class="badge ${PRIORITY_BADGE[f.priority]}">${PRIORITY_LABEL[f.priority]}</span>
            <div><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div>
            <span class="fix-area">${esc(f.source)}</span>
          </li>`).join('')}</ol>` : ''}
      </section>`;
  }

  function renderCompetitors() {
    if (!bench) {
      return `
        <section class="section" id="competitors" aria-labelledby="h-comp">
          <div class="section-head"><div><h2 id="h-comp">Competitors</h2></div></div>
          <p class="note">To compare this profile with its competitors, search the keyword on Google Maps (for example "${esc(((data.categories || [])[0] || 'dentist').toLowerCase())} ${esc(city())}"), let the results load, then open <strong>Dashboard</strong> on this business from that list. Or use <a href="#auditsheets">Find competitors around this business</a> in Audit reports.</p>
        </section>`;
    }
    const fmtVal = (v, digits) => (v === null || v === undefined ? 'n/a' : digits ? Number(v).toFixed(digits) : fmt(Math.round(v)));
    const verdict = { ahead: '<span class="badge badge-good">Ahead</span>', behind: '<span class="badge badge-bad">Behind</span>', even: '<span class="badge">About the same</span>', unknown: '<span class="muted">n/a</span>' };
    const from = benchSource === 'cache'
      ? `${bench.peers} businesses with the same primary category that you opened before`
      : benchSource === 'local'
        ? `the other ${bench.peers} top Google Maps results for "${esc(bench.keyword)}", searched from this business's address`
        : `the other ${bench.peers} businesses in "${esc(bench.keyword || 'this search')}"`;
    const pos = bench.position
      ? `. This profile is <strong>#${bench.position}</strong> in that list`
      : benchSource === 'local' ? `. This profile is <strong>not in the top ${localPeers.length}</strong> there` : '';
    return `
      <section class="section" id="competitors" aria-labelledby="h-comp">
        <div class="section-head">
          <div><h2 id="h-comp">Competitors</h2><p class="section-desc">Compared with ${from}${pos}.</p></div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th scope="col">Signal</th><th scope="col">This profile</th><th scope="col">Typical competitor</th><th scope="col">Top 3 average</th><th scope="col">Verdict</th></tr></thead>
            <tbody>${bench.rows.map((r) => `
              <tr><td>${esc(r.label)}</td><td class="num"><strong>${fmtVal(r.you, r.digits)}</strong></td><td class="num">${fmtVal(r.median, r.digits)}</td><td class="num">${fmtVal(r.top3, r.digits)}</td><td>${verdict[r.verdict]}</td></tr>`).join('')}
              ${bench.websiteShare !== null ? `<tr><td>Has a website</td><td>${data.website ? 'Yes' : 'No'}</td><td colspan="2">${Math.round(bench.websiteShare * 100)}% of competitors</td><td></td></tr>` : ''}
            </tbody>
          </table>
        </div>
        <div class="cols-2">
          <div>
            <h3>Categories competitors use that this profile does not</h3>
            ${bench.missingCategories.length ? `<div class="list">${bench.missingCategories.map((c) => `
              <div class="list-row"><div>${esc(c.name)}</div><span class="num">${c.count} of ${bench.peers}</span>${copyBtn(c.name, c.name)}</div>`).join('')}</div>
              <p class="hint" style="margin-top:8px">Add a category only if it truly describes the business; wrong categories can hurt rankings.</p>`
              : '<p class="muted">None: this profile already covers the categories its competitors share.</p>'}
          </div>
          <div>
            <h3>Leaders${benchSource === 'cache' ? ' (most reviews)' : ' in this search'}</h3>
            <div class="list">${bench.leaders.map((l, i) => `
              <div class="list-row"><div><strong>${i + 1}.</strong> ${esc(l.name)}<div class="why">${l.categories} categories</div></div><span class="num">${l.rating ?? 'n/a'} stars</span><span class="num">${fmt(l.reviews)} reviews</span></div>`).join('')}</div>
          </div>
        </div>
      </section>`;
  }

  function renderSiteCheckShell() {
    const site = safeUrl(data.website);
    return `
      <section class="section" id="sitecheck" aria-labelledby="h-site">
        <div class="section-head">
          <div><h2 id="h-site">Website check</h2><p class="section-desc">Does the website back up the profile? Checks name, phone, address, category and city, LocalBusiness schema and the basic on-page SEO of the linked page.</p></div>
        </div>
        <div id="site-box">
          ${site ? `<p class="hint" style="margin-bottom:10px">Chrome asks once for permission to read ${esc(SphereGmbReportLinks.domainOf(site))}. Only that site, only when you click; you can remove it later in the extension's settings.</p>
            <button class="btn btn-primary" type="button" data-act="site"><span data-icon="search"></span><span>Check the website</span></button>`
            : '<p class="muted">No website is linked to this profile, so there is nothing to check.</p>'}
        </div>
      </section>`;
  }

  /* ---------- Audit reports (agency sheets: Initial, Competitor, Service List) ---------- */

  const MAX_CUSTOM_COMPETITORS = 3;
  const customKey = () => `sgmb_comp_${data.featureId || slug(data.name)}`;

  function competitorPool() {
    const others = (list) => list.filter((p) => !SphereGmbBenchmark.sameBusiness(p, data));
    if (customComps.length) return { list: customComps, source: 'custom' };
    if (localPeers.length) return { list: others(localPeers).slice(0, 3), source: 'local' };
    const fromSearch = others(Array.isArray(snapshot.peers) ? snapshot.peers : []);
    if (fromSearch.length) return { list: fromSearch.slice(0, 3), source: 'search' };
    return { list: others(cachePeers).slice(0, 3), source: cachePeers.length ? 'cache' : '' };
  }

  function auditKeyword() {
    if (localPeers.length && !customComps.length) return localKeyword;
    return snapshot.keyword || [((data.categories || [])[0] || '').toLowerCase(), city()].filter(Boolean).join(' ');
  }

  function competitorNote(pool = competitorPool()) {
    if (!pool.list.length) return 'needs competitors: search them below or add your own';
    const names = pool.list.map((p) => esc(p.name || 'Unnamed business')).join(', ');
    if (pool.source === 'custom') return `against ${names} (your list)`;
    if (pool.source === 'local') return `against ${names} (top Google Maps results for "${esc(localKeyword)}" around this business)`;
    return `against ${names}${pool.source === 'cache' ? ' (businesses you opened before with the same category)' : ` (top results for "${esc(auditKeyword())}")`}`;
  }

  const hasPoint = () => Number.isFinite(data.latitude) && Number.isFinite(data.longitude);
  // The primary category: opened from a single profile, the saved keyword is often just its name.
  const defaultSearchKeyword = () => String((data.categories || [])[0] || '').toLowerCase().trim();

  /** Google Maps search for the keyword, from the business's own address (no IP or VPN needed). */
  async function searchLocal(keyword, timeoutMs = 12000) {
    if (!keyword || !hasPoint()) return { results: [] };
    const ask = chrome.runtime.sendMessage({ type: 'localSearch', payload: { query: keyword, lat: data.latitude, lng: data.longitude } });
    const res = await Promise.race([ask, sleep(timeoutMs).then(() => ({ results: [], error: 'timeout' }))]);
    return res && Array.isArray(res.results) ? res : { results: [], error: res?.error || 'failed' };
  }

  function localStatusText() {
    const me = localPeers.find((p) => SphereGmbBenchmark.sameBusiness(p, data));
    return me ? `This business is #${me.position} on Google Maps for "${localKeyword}" around its address.` : `This business is not in the top ${localPeers.length} on Google Maps for "${localKeyword}" around its address.`;
  }

  function applyLocalResults(keyword, results) {
    // Search results carry the full category and attribute lists (checked against profile lookups).
    localPeers = results.map((p) => ({ ...p, profileLoaded: true }));
    localKeyword = keyword;
    const b = SphereGmbBenchmark.benchmark(data, localPeers, { keyword });
    if (b) {
      bench = b;
      benchSource = 'local';
      fixes = SphereGmbBenchmark.fixList(audit, bench, data);
    }
  }

  /** "Find top 3" in the Audit reports section: search again with the typed keyword. */
  async function runCompetitorSearch(btn) {
    const input = document.getElementById('comp-kw');
    const status = document.getElementById('comp-search-status');
    const keyword = input.value.trim().slice(0, 120);
    if (!keyword) { status.textContent = 'Type a keyword, for example the main service or category.'; input.focus(); return; }
    btn.disabled = true;
    status.classList.remove('status-bad');
    status.textContent = `Searching Google Maps for "${keyword}" from this business's address…`;
    try {
      const res = await searchLocal(keyword);
      if (res.results.length < 2) {
        status.classList.add('status-bad');
        status.textContent = res.error ? `Google did not answer (${res.error}). Try again in a minute.` : `No businesses found for "${keyword}" around this address. Try a broader keyword.`;
        return;
      }
      applyLocalResults(keyword, res.results);
      status.textContent = `${localStatusText()}${customComps.length ? ' Your own list below still takes priority; remove it to use these.' : ''}`;
      const old = document.getElementById('competitors');
      if (old) { old.outerHTML = renderCompetitors(); fillIcons(document.getElementById('competitors')); }
      refreshCustomComps();
    } finally {
      btn.disabled = false;
    }
  }

  function customListHtml() {
    return customComps.map((c, i) => `
      <li class="comp-item">
        <span class="comp-num">${i + 1}</span>
        <span class="comp-body"><strong>${esc(c.name || 'Unnamed business')}</strong>
          <small>${esc([(c.categories || [])[0], c.rating ? `${c.rating} stars` : '', c.numReviews ? `${fmt(c.numReviews)} reviews` : '', c.address].filter(Boolean).join(' · '))}</small></span>
        <button class="icon-btn" type="button" data-act="comp-remove" data-index="${i}" aria-label="Remove ${esc(c.name || 'this competitor')}"><span data-icon="cross"></span></button>
      </li>`).join('');
  }

  /** Re-renders the custom list and the competitor option after the list changes. */
  function refreshCustomComps() {
    const list = document.getElementById('comp-list');
    if (!list) return;
    list.innerHTML = customListHtml();
    fillIcons(list);
    const pool = competitorPool();
    const box = document.querySelector('input[name="audit-kind"][value="competitor"]');
    if (box) {
      const wasDisabled = box.disabled;
      box.disabled = pool.list.length === 0;
      if (box.disabled) box.checked = false;
      else if (wasDisabled || pool.source === 'custom') box.checked = true;
      box.closest('.audit-opt').querySelector('small').innerHTML = competitorNote(pool);
    }
    const full = customComps.length >= MAX_CUSTOM_COMPETITORS;
    document.getElementById('comp-link').disabled = full;
    document.querySelector('[data-act="comp-add"]').disabled = full;
  }

  async function saveCustomComps() {
    try {
      if (customComps.length) await chrome.storage.local.set({ [customKey()]: customComps });
      else await chrome.storage.local.remove(customKey());
    } catch (e) { /* the list still works for this visit */ }
  }

  /** Follows a maps.app.goo.gl share link to the place link it stands for. */
  async function resolveShortLink(url) {
    const res = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const fromUrl = SphereGmbReportLinks.parseMapsLink(res.url);
    if (fromUrl && fromUrl.featureId) return fromUrl.featureId;
    // A consent or app page can sit in between: the place link is still in the page.
    const body = (await res.text()).slice(0, 3000000);
    const m = body.match(/!1s(0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16})/i) || body.match(/[?&](?:cid|ludocid)=(\d{6,20})/i);
    const found = m && SphereGmbReportLinks.parseMapsLink(m[1].startsWith('0x') ? m[1] : `?cid=${m[1]}`);
    return found && found.featureId ? found.featureId : '';
  }

  async function addCustomComp(btn) {
    const input = document.getElementById('comp-link');
    const status = document.getElementById('comp-status');
    const say = (msg, bad = false) => { status.textContent = msg; status.classList.toggle('status-bad', bad); };
    if (customComps.length >= MAX_CUSTOM_COMPETITORS) { say(`You can compare up to ${MAX_CUSTOM_COMPETITORS} competitors. Remove one first.`, true); return; }
    const parsed = SphereGmbReportLinks.parseMapsLink(input.value);
    if (!parsed) {
      say('That does not look like a Google Maps link. Open the business on Google Maps and copy the address bar, or use Share > Copy link.', true);
      input.focus();
      return;
    }
    let granted = true;
    if (parsed.shortUrl) {
      // Straight from the click, so Chrome treats it as a user gesture.
      try { granted = await chrome.permissions.request({ origins: ['https://maps.app.goo.gl/*'] }); } catch (e) { granted = false; }
      if (!granted) { say('Share links need permission to read maps.app.goo.gl. Or open the link and paste the full address bar link instead.', true); return; }
    }
    btn.disabled = true;
    input.disabled = true;
    try {
      say('Looking up the business on Google…');
      const featureId = parsed.featureId || (await resolveShortLink(parsed.shortUrl));
      if (!featureId) { say('Could not find a business behind that link. Paste the full Google Maps link instead.', true); return; }
      const profile = await chrome.runtime.sendMessage({ type: 'getPlaceProfile', payload: { featureId } });
      if (!profile || profile.error || !profile.name) { say('Google did not return a business for that link. Check it and try again.', true); return; }
      const realId = profile.featureId || featureId;
      if (realId === data.featureId || SphereGmbBenchmark.sameBusiness(profile, data)) { say('That is the business you are auditing. Add a competitor instead.', true); return; }
      if (customComps.some((c) => c.featureId === realId)) { say(`${profile.name} is already on the list.`, true); return; }
      customComps.push({ ...profile, featureId: realId, profileLoaded: true });
      input.value = '';
      say(`Added ${profile.name}.`);
      await saveCustomComps();
    } catch (err) {
      say(`Could not add it: ${err.message}`, true);
    } finally {
      btn.disabled = false;
      input.disabled = false;
      refreshCustomComps();
    }
  }

  function removeCustomComp(index) {
    const [gone] = customComps.splice(index, 1);
    const status = document.getElementById('comp-status');
    if (gone && status) { status.textContent = `Removed ${gone.name || 'the competitor'}.`; status.classList.remove('status-bad'); }
    saveCustomComps();
    refreshCustomComps();
    document.getElementById('comp-link')?.focus();
  }

  function renderAuditSheetsShell() {
    const pool = competitorPool();
    const compNote = competitorNote(pool);
    const opt = (value, label, hint, checked = true, disabled = false) => `
      <label class="audit-opt"><input type="checkbox" name="audit-kind" value="${value}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span><strong>${label}</strong><small>${hint}</small></span></label>`;
    const full = customComps.length >= MAX_CUSTOM_COMPETITORS;
    return `
      <section class="section" id="auditsheets" aria-labelledby="h-sheets">
        <div class="section-head"><div><h2 id="h-sheets">Audit reports</h2><p class="section-desc">Run the agency audits and download them: Excel with one sheet per audit (the agency template layout) or CSV.</p></div></div>
        <fieldset class="audit-picker">
          <legend class="sr-only">Audits to run</legend>
          ${opt('initial', 'Initial GBP Audit', 'Every profile item with existing info, pass or fail, proposed fix and status')}
          ${opt('competitor', 'GBP and Competitor Audit', compNote, pool.list.length > 0, pool.list.length === 0)}
          ${opt('services', 'Service List', "Google's predefined services for each category, ready to add")}
        </fieldset>
        <div class="comp-custom">
          ${hasPoint() ? `
          <label class="field-label" for="comp-kw">Find competitors around this business</label>
          <p class="hint">Searches Google Maps for the keyword as if you were standing at this business's address, then takes the top 3 other businesses. No VPN or location changer needed.</p>
          <div class="comp-add">
            <input id="comp-kw" class="input" type="text" autocomplete="off" maxlength="120" value="${esc(localKeyword || defaultSearchKeyword())}" placeholder="for example: ${esc(defaultSearchKeyword() || 'dentist')}">
            <button class="btn" type="button" data-act="comp-search"><span data-icon="search"></span><span>Find top 3</span></button>
          </div>
          <p class="status" id="comp-search-status" role="status" aria-live="polite">${localPeers.length ? esc(localStatusText()) : ''}</p>
          <hr class="comp-sep">` : ''}
          <label class="field-label" for="comp-link">Or add your own competitors (up to ${MAX_CUSTOM_COMPETITORS})</label>
          <p class="hint">Paste a Google Maps link (the address bar or a Share link), a link with cid= or a CID. Your list replaces the top results in the GBP and Competitor Audit and is saved for this business.</p>
          <div class="comp-add">
            <input id="comp-link" class="input" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://www.google.com/maps/place/... or https://maps.app.goo.gl/..." ${full ? 'disabled' : ''}>
            <button class="btn" type="button" data-act="comp-add" ${full ? 'disabled' : ''}><span data-icon="plus"></span><span>Add</span></button>
          </div>
          <p class="status" id="comp-status" role="status" aria-live="polite"></p>
          <ol class="comp-list" id="comp-list">${customListHtml()}</ol>
        </div>
        <label class="switch" style="margin-top:12px"><input type="checkbox" id="audit-sites" ${data.website ? '' : 'disabled'}> Also check the websites (LocalBusiness markup, lead form, phone, offer, reviews). Chrome asks once for each site.</label>
        <div class="row" style="margin-top:14px">
          <button class="btn btn-primary" type="button" data-act="audit-run"><span data-icon="play"></span><span>Run audit</span></button>
          <span class="status" id="audit-status" role="status" aria-live="polite"></span>
        </div>
        <div class="progress" id="audit-progress" hidden><span></span></div>
        <div id="audit-out"></div>
      </section>`;
  }

  async function profileFor(p) {
    if (!p || !p.featureId) return { ...p };
    try {
      const fresh = await chrome.runtime.sendMessage({ type: 'getPlaceProfile', payload: { featureId: p.featureId } });
      const merged = { ...p };
      if (fresh && !fresh.error) {
        for (const [k, v] of Object.entries(fresh)) {
          const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
          if (!empty) merged[k] = v;
        }
        merged.profileLoaded = true;
      }
      return merged;
    } catch (e) {
      return { ...p };
    }
  }

  async function siteSummary(url) {
    try {
      const res = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString((await res.text()).slice(0, 3000000), 'text/html');
      return SphereGmbAuditSheets.summariseSite(SphereGmbSiteAudit.auditSite(doc, { url, finalUrl: res.url, profile: data }), doc);
    } catch (e) {
      return null;
    }
  }

  async function runAudits(btn) {
    const selected = Array.from(document.querySelectorAll('input[name="audit-kind"]:checked')).map((i) => i.value);
    const status = document.getElementById('audit-status');
    if (!selected.length) { status.textContent = 'Tick at least one audit.'; return; }
    const pool = competitorPool();
    const wantSites = document.getElementById('audit-sites').checked;
    const targets = [data, ...(selected.includes('competitor') ? pool.list : [])];
    let granted = false;
    if (wantSites) {
      // Straight from the click, so Chrome treats it as a user gesture.
      const hosts = [...new Set(targets.map((p) => SphereGmbReportLinks.domainOf(p.website)).filter(Boolean))];
      try { granted = hosts.length ? await chrome.permissions.request({ origins: hosts.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]) }) : false; } catch (e) { granted = false; }
    }
    btn.disabled = true;
    const bar = document.getElementById('audit-progress');
    bar.hidden = false;
    const step = (msg, ratio) => { status.textContent = msg; bar.firstElementChild.style.width = `${Math.round(ratio * 100)}%`; };
    try {
      step('Refreshing the profile from Google…', 0.1);
      const business = await profileFor(data);
      let competitors = [];
      if (selected.includes('competitor')) {
        step('Loading the competitors…', 0.3);
        competitors = await Promise.all(pool.list.map(profileFor));
      }
      step('Reading saved Media and Post audit results…', 0.45);
      const ids = [business, ...competitors].map((p) => p.featureId).filter(Boolean);
      const raw = ids.length ? await SgmbPage.storageGet(ids.map((id) => `sgmb_audit_${id}`)) : {};
      const stored = Object.fromEntries(ids.map((id) => [id, raw[`sgmb_audit_${id}`] || {}]));
      step("Loading Google's category and service list…", 0.55);
      let services = [];
      let suggestions = (bench ? bench.missingCategories.map((c) => c.name) : []);
      try {
        const lib = (await SgmbPage.loadCategoryLibrary()).lib;
        services = (business.categories || []).map((c) => {
          const cat = CT.findCategory(lib, c);
          return { category: c, services: (cat && lib.services[cat.id]) || [] };
        });
        suggestions = [...new Set([...suggestions, ...CT.relatedCategories(lib, business.categories || [], { limit: 8 }).map((r) => r.name)])];
      } catch (e) { /* offline: the Service List shows the categories only */ }
      const sites = {};
      if (wantSites && granted) {
        const withSite = targets.filter((p) => p.website);
        for (let i = 0; i < withSite.length; i++) {
          step(`Checking website ${i + 1} of ${withSite.length}…`, 0.6 + (0.3 * i) / withSite.length);
          const summary = await siteSummary(withSite[i].website);
          if (summary) sites[SphereGmbReportLinks.domainOf(withSite[i].website)] = summary;
        }
      }
      step('Building the sheets…', 0.95);
      lastAudits = {
        business,
        list: SphereGmbAuditSheets.buildAudits({
          business, competitors, keyword: auditKeyword(), city: business.addressLocality || city(),
          sites, stored, services, suggestions, now: Math.floor(Date.now() / 1000)
        }, selected)
      };
      renderAuditResults(wantSites && !granted);
      status.textContent = `Done: ${lastAudits.list.map((a) => a.name).join(', ')}.`;
    } catch (err) {
      status.textContent = `The audit stopped: ${err.message}`;
    } finally {
      btn.disabled = false;
      bar.hidden = true;
    }
  }

  function renderAuditResults(sitesDeclined) {
    const out = document.getElementById('audit-out');
    const cellHtml = (v) => (v === 'Pass' ? '<span class="badge badge-good">Pass</span>' : v === 'Fail' ? '<span class="badge badge-bad">Fail</span>' : esc(v));
    out.innerHTML = `
      ${sitesDeclined ? '<p class="note note-warn" style="margin-top:14px">Website access was not given, so the website rows say "not checked".</p>' : ''}
      <div class="row" style="margin:16px 0 6px">
        <button class="btn btn-primary" type="button" data-act="audit-xlsx"><span data-icon="download"></span><span>Download Excel</span></button>
        <button class="btn" type="button" data-act="audit-csv"><span data-icon="download"></span><span>${lastAudits.list.length > 1 ? `Download CSV (${lastAudits.list.length} files)` : 'Download CSV'}</span></button>
      </div>
      ${lastAudits.list.map((a) => {
        const body = a.csvRows.slice(1);
        const fails = body.filter((r) => r[2] === 'Fail').length;
        const passes = body.filter((r) => r[2] === 'Pass').length;
        return `
          <details class="audit-preview" ${lastAudits.list.length === 1 ? 'open' : ''}>
            <summary><strong>${esc(a.name)}</strong> <span class="muted">${a.key === 'initial' ? `${passes} pass, ${fails} fail` : `${body.length} rows`}</span></summary>
            <div class="table-wrap"><table class="data"><tbody>${a.csvRows.map((r, i) => `<tr>${r.map((v) => (i === 0 || r.length === 1 ? `<th scope="col">${esc(v)}</th>` : `<td>${cellHtml(v)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>
          </details>`;
      }).join('')}`;
    fillIcons(out);
  }

  function auditFileBase() {
    return `gbp-audit-${slug(lastAudits.business.name)}-${new Date().toISOString().slice(0, 10)}`;
  }

  function downloadAuditXlsx() {
    if (!lastAudits) return;
    const bytes = SphereGmbXlsx.buildXlsx(lastAudits.list.map((a) => a.sheet));
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${auditFileBase()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadAuditCsv() {
    if (!lastAudits) return;
    for (const a of lastAudits.list) {
      downloadText(`${auditFileBase()}-${a.key}.csv`, SphereGmbAuditSheets.toCsv(a.csvRows));
      await sleep(400); // browsers drop rapid back-to-back downloads
    }
  }

  function renderInfo() {
    const site = safeUrl(data.website);
    const ll = typeof data.latitude === 'number' ? `${data.latitude}, ${data.longitude}` : '';
    const status = data.claimed === true ? '<span class="badge badge-good">Claimed</span> <span class="muted">The owner has verified this profile</span>'
      : data.claimed === false ? '<span class="badge badge-bad">Unclaimed</span> <span class="muted">Google shows "Own this business?"</span>'
        : '<span class="empty">Unknown</span>';
    const booking = (data.bookingLinks || []).map((b) => `<a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener noreferrer">${esc(b.domain)}</a>`).join(', ');
    return `
      <section class="section" id="info" aria-labelledby="h-info">
        <div class="section-head"><div><h2 id="h-info">Business information</h2><p class="section-desc">Everything Google shows publicly for this profile. Use the copy buttons for citations and audits.</p></div></div>
        <div class="kv">
          ${kv('Business name', value(data.name), data.name)}
          ${kv('Current address', value(data.address), data.address)}
          ${kv('Website', site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(SphereGmbReportLinks.domainOf(site) || site)}</a>${/[?&]utm_/i.test(site) ? ' <span class="badge badge-good" title="The profile link carries UTM tags, so its visits show up separately in analytics">UTM tracked</span>' : ' <span class="badge badge-mid" title="Add utm_source=google&amp;utm_medium=organic&amp;utm_campaign=gbp to see profile visits in analytics">No UTM tags</span>'}` : value(''), site)}
          ${kv('Phone', value(data.phone), data.phone)}
          ${kv('International phone', value(data.phoneIntl), data.phoneIntl)}
          ${kv('Business status', status)}
          ${kv('Latitude, longitude', value(ll), ll)}
          ${kv('Plus code', value(data.plusCode), data.plusCode)}
          ${kv('Time zone', value(data.timezone), data.timezone)}
          ${kv('Total reviews', value(data.numReviews ? fmt(data.numReviews) : ''), data.numReviews ? String(data.numReviews) : '')}
          ${kv('Review rating', value(data.rating), data.rating ? String(data.rating) : '')}
          ${kv('Price level', value(data.priceLevel))}
          ${kv('Booking and order links', booking || value('', 'None linked'))}
          ${kv('Business Profile ID', `<span class="mono">${value(data.businessProfileId, 'Not available')}</span>`, data.businessProfileId)}
          ${kv('Place ID', `<span class="mono">${value(data.placeId, 'Not available')}</span>`, data.placeId)}
          ${kv('Knowledge panel ID (KGMID)', `<span class="mono">${value(data.kgmid, 'Not available')}</span>`, data.kgmid)}
          ${kv('CID', `<span class="mono">${value(data.placeCID, 'Not available')}</span>`, data.placeCID)}
          ${kv('Feature ID', `<span class="mono">${value(data.featureId, 'Not available')}</span>`, data.featureId)}
        </div>
      </section>`;
  }

  function renderCategoriesShell() {
    const cats = data.categories || [];
    return `
      <section class="section" id="categories" aria-labelledby="h-cats">
        <div class="section-head">
          <div><h2 id="h-cats">Categories</h2><p class="section-desc">The profile's categories, checked against Google's current category list, plus real categories worth considering.</p></div>
          <button class="btn no-print" type="button" data-act="copy-cats"><span data-icon="copy"></span><span data-label="Copy categories">Copy categories</span></button>
        </div>
        <div class="list" id="own-cats">
          ${cats.length ? cats.map((c, i) => `
            <div class="list-row" data-cat="${esc(c)}">
              <div><strong>${esc(c)}</strong> <span class="badge ${i === 0 ? 'badge-accent' : ''}">${i === 0 ? 'Primary' : `Secondary ${i}`}</span></div>
              <span class="why" data-valid>Checking…</span>
              ${copyBtn(c, c)}
            </div>`).join('') : '<p class="empty-state">No categories could be read for this profile.</p>'}
        </div>
        <div id="cat-tools"><p class="status" role="status">Loading Google's category list…</p></div>
      </section>`;
  }

  function renderAudit() {
    if (!audit) return '';
    return `
      <section class="section" id="audit" aria-labelledby="h-audit">
        <div class="section-head"><div><h2 id="h-audit">Audit checklist</h2><p class="section-desc">${audit.score} of 100 points, ${esc(audit.grade.toLowerCase())} profile.</p></div></div>
        <div class="checks">
          ${audit.checks.map((x) => `
            <div class="check check-${x.status}">
              <span class="check-ico">${STATUS_ICON[x.status]}</span>
              <div><strong>${esc(x.label)}</strong> <span class="badge">${STATUS_LABEL[x.status]}</span><p>${esc(x.detail)}</p></div>
              <span class="check-points">${x.points}/${x.max}</span>
            </div>`).join('')}
        </div>
      </section>`;
  }

  function renderLinks() {
    return SphereGmbReportLinks.buildLinkGroups(data).map((g) => `
      <section class="section" id="${SECTION_FOR_GROUP[g.id]}" aria-labelledby="h-links-${g.id}">
        <div class="section-head"><div><h2 id="h-links-${g.id}">${esc(g.title)}</h2><p class="section-desc">${esc(g.desc)}</p></div></div>
        <div class="link-grid">
          ${g.links.map((l) => `
            <a class="link-row" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
              <span>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ''}</span>${ICONS.external}
            </a>`).join('')}
        </div>
      </section>`).join('');
  }

  function renderDetails() {
    const hours = (data.hours || []).map((h) => kv(h.day, esc(h.hours))).join('') || kv('Hours', value('', 'Not listed'));
    const attrs = (data.attributes || []).map((g) => kv(g.group, esc(g.items.join(', ')))).join('') || kv('Attributes', value('', 'None set'));
    const site = safeUrl(data.website);
    return `
      <section class="section" id="details" aria-labelledby="h-details">
        <div class="section-head"><div><h2 id="h-details">Hours, attributes and description</h2></div></div>
        <h3>Description</h3>
        <p class="${data.description ? '' : 'muted'}" style="max-width:72ch">${value(data.description, 'No owner-written description. Google allows up to 750 characters.')}</p>
        ${data.editorialSummary ? `<p class="muted" style="margin-top:8px">Google's summary: ${esc(data.editorialSummary)}</p>` : ''}
        <h3>Opening hours</h3><div class="kv">${hours}</div>
        <h3>Attributes</h3><div class="kv">${attrs}</div>
        <h3>Website speed</h3>
        <div id="speed">
          ${site ? `<p class="section-desc" style="margin-bottom:10px">Free, no API key: loads ${esc(SphereGmbReportLinks.domainOf(site))} in a small window for a few seconds and reads Chrome's own timing (load time, Largest Contentful Paint, layout shift, page weight). Chrome asks once to read the site.</p>
            <button class="btn btn-primary" type="button" data-act="speed">Measure speed in this browser</button>` : '<p class="muted">No website linked, so there is nothing to test.</p>'}
        </div>
        ${site ? `<div id="psi" style="margin-top:14px">
          <p class="hint" style="margin-bottom:8px">Google's lab test (mobile, PageSpeed Insights). Uses Google's shared free quota, or your own free key from the popup's Settings.</p>
          <button class="btn" type="button" data-act="psi">Run Google PageSpeed test</button>
        </div>` : ''}
      </section>`;
  }

  function render() {
    const main = document.getElementById('main');
    main.innerHTML = renderHero() + renderAuditSheetsShell() + renderFixes() + renderCompetitors() + renderInfo() + renderCategoriesShell() + renderKeywordsShell() + renderAudit() + renderSiteCheckShell() + renderLinks() + renderDetails()
      + `<footer class="footer">Snapshot taken ${esc(new Date(window.__sgmbTs || Date.now()).toLocaleString())}. Public data read from Google by GBP Sphere in your browser. Category list: community data from lobstr.io and Jepto (see README).</footer>`;
    document.title = `${data.name || 'Profile'} | GBP Sphere report`;
    document.getElementById('actions').hidden = false;
    document.getElementById('nav').hidden = false;
    fillIcons();
    requestAnimationFrame(() => {
      const ring = document.querySelector('.score-ring .value');
      if (ring) ring.style.strokeDashoffset = ring.dataset.offset;
    });
  }

  /* ---------- Categories (needs the library) ---------- */

  async function initCategoryTools(refresh = false) {
    const box = document.getElementById('cat-tools');
    if (!box) return;
    box.innerHTML = '<p class="status" role="status">Loading Google\'s category list…</p>';
    let res;
    try {
      res = await SgmbPage.loadCategoryLibrary({ refresh });
    } catch (err) {
      box.innerHTML = `<div class="note note-warn" role="alert"><strong>Couldn't download the category list.</strong> Check your connection and <button class="btn" type="button" data-act="cats-retry" style="margin-left:6px">Try again</button></div>`;
      document.querySelectorAll('[data-valid]').forEach((el) => { el.textContent = ''; });
      return;
    }
    library = res.lib;
    const own = data.categories || [];

    document.querySelectorAll('#own-cats [data-cat]').forEach((row) => {
      const found = CT.findCategory(library, row.dataset.cat);
      const el = row.querySelector('[data-valid]');
      el.innerHTML = found
        ? `<span class="badge badge-good">${ICONS.check} Google category</span> <span class="num">${esc(found.group)}</span>`
        : '<span class="badge badge-mid">Not in the current list</span> <span class="num">Renamed, removed or a local label</span>';
    });

    const related = CT.relatedCategories(library, own, { limit: 30 });
    const services = CT.servicesFor(library, own);
    const peers = CT.coOccurring(await SgmbPage.cachedProfiles(), own, { limit: 15 });

    box.innerHTML = `
      <div class="cols-2">
        <div>
          <h3>Related Google categories <span class="muted" style="font-weight:400">(${related.length})</span></h3>
          ${related.length ? `<div class="list" id="related-list">${related.map((r, i) => `
            <div class="list-row" ${i >= 12 ? 'hidden' : ''}>
              <div>${esc(r.name)}<div class="why">${esc(r.reasons.join(' · '))}</div></div>
              <span class="num" title="Businesses in the US using it">${r.us ? `${fmt(r.us)} US` : ''}</span>
              ${copyBtn(r.name, r.name)}
            </div>`).join('')}</div>
            ${related.length > 12 ? `<button class="btn" type="button" data-act="rel-all" style="margin-top:10px">Show ${related.length - 12} more</button>` : ''}` : '<p class="muted">No close matches in the list.</p>'}
        </div>
        <div>
          <h3>Used by similar businesses you viewed</h3>
          ${peers.peers ? `<p class="section-desc" style="margin-bottom:8px">From ${peers.peers} profile${peers.peers === 1 ? '' : 's'} with a shared category that GBP Sphere has loaded in this browser.</p>
            <div class="list">${peers.list.map((p) => `
              <div class="list-row"><div>${esc(p.name)}</div><span class="num">${p.count} of ${peers.peers}</span>${copyBtn(p.name, p.name)}</div>`).join('') || '<p class="muted">They use the same categories as this profile.</p>'}</div>`
            : '<p class="muted">Open a few competitors on Google Search or Maps (for example the local pack for the primary category), then reload this report. Their categories show up here.</p>'}
          <h3>Google's predefined services <span class="muted" style="font-weight:400">(${services.length})</span></h3>
          ${services.length ? `<div class="chips">${services.slice(0, 60).map((s) => `<span class="chip" title="${esc(s.category)}">${esc(s.service)}</span>`).join('')}</div>
            <div class="row" style="margin-top:10px"><button class="btn" type="button" data-act="copy-services"><span data-icon="copy"></span><span data-label="Copy services">Copy services</span></button></div>`
            : '<p class="muted">Google has no predefined services for these categories. Add custom services in the profile editor.</p>'}
        </div>
      </div>
      <h3>Search all ${fmt(library.count)} Google categories</h3>
      <div class="field" style="max-width:520px">
        <label for="cat-search" class="sr-only">Search categories</label>
        <input id="cat-search" class="input" type="search" placeholder="For example: dental, roofing, bakery" autocomplete="off">
      </div>
      <div class="list" id="cat-search-results" style="margin-top:8px"></div>
      <p class="hint" style="margin-top:14px">List updated ${esc(new Date(res.ts).toLocaleDateString())}${res.stale ? ' (offline copy)' : ''}. Source: community lists from lobstr.io and Jepto, downloaded into this browser. <button class="btn" type="button" data-act="cats-refresh" style="min-height:28px;margin-left:6px">Refresh list</button></p>`;
    fillIcons(box);

    box.querySelector('[data-act="rel-all"]')?.addEventListener('click', (e) => {
      box.querySelectorAll('#related-list .list-row[hidden]').forEach((el) => { el.hidden = false; });
      e.currentTarget.remove();
    });
    box.querySelector('[data-act="copy-services"]')?.addEventListener('click', (e) => copyText(services.map((s) => s.service).join('\n'), e.currentTarget));
    const search = box.querySelector('#cat-search');
    const out = box.querySelector('#cat-search-results');
    let t = null;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const hits = CT.searchCategories(library, search.value, { limit: 25 });
        out.innerHTML = search.value.trim().length < 2 ? '' : hits.length
          ? hits.map((c) => `<div class="list-row"><div>${esc(c.name)}<div class="why">${esc(c.group)}</div></div><span class="num">${c.us ? `${fmt(c.us)} US` : ''}</span>${copyBtn(c.name, c.name)}</div>`).join('')
          : '<p class="muted" style="padding:10px 0">No Google category matches that.</p>';
      }, 150);
    });

    // "Refresh list" must not wipe keyword results the user already collected.
    if (!document.querySelector('#kw-seeds [data-seed]')) initKeywordSeeds(services);
  }

  /* ---------- Keyword finder ---------- */

  function renderKeywordsShell() {
    return `
      <section class="section" id="keywords" aria-labelledby="h-kw">
        <div class="section-head"><div><h2 id="h-kw">Keyword finder</h2><p class="section-desc">Real searches people type, from Google's own suggestions, built from the categories and services. Free, no key.</p></div></div>
        <div id="kw-seeds"><p class="status">Waiting for the category list…</p></div>
      </section>`;
  }

  function initKeywordSeeds(services) {
    const box = document.getElementById('kw-seeds');
    if (!box) return;
    const seeds = CT.keywordSeeds(data.categories || [], services.slice(0, 12).map((s) => s.service), '', { max: 30 });
    const selected = new Set(seeds.slice(0, 6));
    box.innerHTML = `
      <p class="field-label" id="seed-label">Seed phrases <span class="hint">(pick up to 10)</span></p>
      <div class="chips" role="group" aria-labelledby="seed-label" id="seed-chips">
        ${seeds.map((s) => `<button class="chip" type="button" aria-pressed="${selected.has(s)}" data-seed="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <div class="row" style="margin-top:14px">
        <div class="field" style="flex:1;min-width:220px"><label for="kw-custom">Add your own seed</label><input id="kw-custom" class="input" placeholder="e.g. emergency dentist" autocomplete="off"></div>
        <div class="field" style="flex:1;min-width:180px"><label for="kw-loc">Location (optional)</label><input id="kw-loc" class="input" value="${esc(city())}" autocomplete="off"></div>
      </div>
      <div class="row" style="margin-top:12px">
        <label class="switch"><input type="checkbox" id="kw-az"> Expand the first seed with A to Z (26 extra lookups)</label>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" type="button" data-act="kw-run"><span data-icon="search"></span><span>Find keywords</span></button>
        <span class="status" id="kw-status" role="status" aria-live="polite"></span>
      </div>
      <div class="progress" hidden id="kw-progress"><span></span></div>
      <div id="kw-results"></div>`;
    fillIcons(box);
    box.querySelectorAll('[data-seed]').forEach((chip) => chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      if (on && box.querySelectorAll('[data-seed][aria-pressed="true"]').length >= 10) return;
      chip.setAttribute('aria-pressed', String(on));
    }));
    const selectedCount = () => box.querySelectorAll('[data-seed][aria-pressed="true"]').length;
    box.querySelector('#kw-custom').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      // Keep the typed text as is (norm() would drop non-Latin letters), just tidy spaces.
      const s = e.target.value.trim().toLowerCase().replace(/\s+/g, ' ');
      e.target.value = '';
      if (box.querySelector(`[data-seed="${CSS.escape(s)}"]`)) return;
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.dataset.seed = s;
      chip.textContent = s;
      chip.setAttribute('aria-pressed', String(selectedCount() < 10));
      chip.addEventListener('click', () => {
        const on = chip.getAttribute('aria-pressed') !== 'true';
        if (on && selectedCount() >= 10) return;
        chip.setAttribute('aria-pressed', String(on));
      });
      box.querySelector('#seed-chips').prepend(chip);
    });
    box.querySelector('[data-act="kw-run"]').addEventListener('click', runKeywords);
  }

  async function runKeywords(e) {
    const btn = e.currentTarget;
    const box = document.getElementById('kw-seeds');
    const seeds = Array.from(box.querySelectorAll('[data-seed][aria-pressed="true"]')).map((c) => c.dataset.seed).slice(0, 10);
    const loc = box.querySelector('#kw-loc').value.trim();
    const custom = box.querySelector('#kw-custom').value.trim().toLowerCase();
    if (custom && !seeds.includes(custom)) seeds.unshift(custom);
    seeds.splice(10);
    if (!seeds.length) {
      box.querySelector('#kw-status').textContent = 'Pick at least one seed phrase.';
      return;
    }
    const phrases = [];
    for (const s of seeds) {
      phrases.push({ seed: s, q: s });
      if (loc) phrases.push({ seed: s, q: `${s} ${loc.toLowerCase()}` });
    }
    if (box.querySelector('#kw-az').checked) {
      for (const ch of 'abcdefghijklmnopqrstuvwxyz') phrases.push({ seed: seeds[0], q: `${seeds[0]} ${ch}` });
    }
    btn.disabled = true;
    const status = box.querySelector('#kw-status');
    const bar = box.querySelector('#kw-progress');
    bar.hidden = false;
    keywordState.results = new Map();
    let failed = 0;
    for (let i = 0; i < phrases.length; i++) {
      const p = phrases[i];
      status.textContent = `Asking Google for "${p.q}" (${i + 1} of ${phrases.length})`;
      bar.firstElementChild.style.width = `${Math.round(((i + 1) / phrases.length) * 100)}%`;
      try {
        for (const s of await SgmbPage.suggest(p.q)) {
          if (!keywordState.results.has(s)) keywordState.results.set(s, p.seed);
        }
      } catch (err) {
        failed++;
        if (err.message === 'rate_limited') {
          status.textContent = 'Google asked us to slow down. Showing what was collected so far.';
          break;
        }
      }
      await sleep(350);
    }
    bar.hidden = true;
    btn.disabled = false;
    if (!status.textContent.startsWith('Google asked')) {
      status.textContent = `${keywordState.results.size} keywords found${failed ? `, ${failed} lookups failed` : ''}.`;
    }
    keywordState.selected = new Set(Array.from(keywordState.results.keys()).slice(0, 10));
    renderKeywordResults();
  }

  function renderKeywordResults() {
    const out = document.getElementById('kw-results');
    const rows = Array.from(keywordState.results.entries());
    if (!rows.length) {
      out.innerHTML = '<p class="muted" style="padding:12px 0">Google returned no suggestions. Try shorter seeds.</p>';
      return;
    }
    out.innerHTML = `
      <div class="row" style="margin:14px 0 8px;justify-content:space-between">
        <span class="hint">Tick keywords to send them to the rank checker.</span>
        <span class="row">
          <button class="btn" type="button" data-act="kw-copy"><span data-icon="copy"></span><span data-label="Copy all">Copy all</span></button>
          <button class="btn" type="button" data-act="kw-csv"><span data-icon="download"></span><span>CSV</span></button>
          <button class="btn btn-primary" type="button" data-act="kw-rank"><span data-icon="rank"></span><span>Check rankings (<span data-count>${keywordState.selected.size}</span>)</span></button>
        </span>
      </div>
      <div class="kw-grid">${rows.map(([k, seed], i) => `
        <label class="kw-item" title="From: ${esc(seed)}" ${i >= 48 ? 'hidden' : ''}><input type="checkbox" value="${esc(k)}" ${keywordState.selected.has(k) ? 'checked' : ''}><span>${esc(k)}</span></label>`).join('')}</div>
      ${rows.length > 48 ? `<button class="btn" type="button" data-act="kw-all" style="margin-top:10px">Show all ${rows.length} keywords</button>` : ''}`;
    fillIcons(out);
    out.querySelector('[data-act="kw-all"]')?.addEventListener('click', (e) => {
      out.querySelectorAll('.kw-item[hidden]').forEach((el) => { el.hidden = false; });
      e.currentTarget.remove();
    });
    out.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) keywordState.selected.add(cb.value);
      else keywordState.selected.delete(cb.value);
      out.querySelector('[data-count]').textContent = keywordState.selected.size;
    }));
    out.querySelector('[data-act="kw-copy"]').addEventListener('click', (e) => copyText(rows.map((r) => r[0]).join('\n'), e.currentTarget));
    out.querySelector('[data-act="kw-csv"]').addEventListener('click', () => downloadText(`keywords-${slug(data.name)}.csv`, toCsv(['Keyword', 'Seed'], rows)));
    out.querySelector('[data-act="kw-rank"]').addEventListener('click', () => openRankCheck(Array.from(keywordState.selected)));
  }

  async function openRankCheck(keywords) {
    await chrome.storage.local.set({ rankDraft: { keywords: keywords || [], ts: Date.now() } });
    chrome.runtime.sendMessage({ type: 'openRankPage', payload: data });
  }

  /* ---------- Actions ---------- */

  function reportText() {
    const lines = [
      `GBP Sphere report: ${data.name || 'Unknown business'}`,
      audit ? `Score: ${audit.score}/100 (${audit.grade})` : '',
      `Address: ${data.address || 'n/a'}`,
      `Phone: ${data.phone || 'n/a'}`,
      `Website: ${data.website || 'n/a'}`,
      `Status: ${data.claimed === true ? 'Claimed' : data.claimed === false ? 'Unclaimed' : 'Unknown'}`,
      `Rating: ${data.rating || 'n/a'} (${data.numReviews || 0} reviews)`,
      `Primary category: ${(data.categories || [])[0] || 'n/a'}`,
      `Secondary categories: ${(data.categories || []).slice(1).join(', ') || 'none'}`,
      `Business Profile ID: ${data.businessProfileId || 'n/a'}`,
      `Place ID: ${data.placeId || 'n/a'} | CID: ${data.placeCID || 'n/a'} | KGMID: ${data.kgmid || 'n/a'}`
    ].filter(Boolean);
    if (audit) {
      lines.push('', 'Checks:');
      for (const c of audit.checks) lines.push(`- [${STATUS_LABEL[c.status]}] ${c.label}: ${c.detail} (${c.points}/${c.max})`);
    }
    return lines.join('\n');
  }

  function profileCsv() {
    const rows = [
      ['Name', data.name], ['Address', data.address], ['Phone', data.phone], ['Website', data.website],
      ['Status', data.claimed === true ? 'Claimed' : data.claimed === false ? 'Unclaimed' : ''],
      ['Rating', data.rating], ['Reviews', data.numReviews], ['Primary category', (data.categories || [])[0]],
      ['Secondary categories', (data.categories || []).slice(1).join('; ')], ['Latitude', data.latitude], ['Longitude', data.longitude],
      ['Plus code', data.plusCode], ['Business Profile ID', data.businessProfileId], ['Place ID', data.placeId], ['CID', data.placeCID],
      ['KGMID', data.kgmid], ['Feature ID', data.featureId], ['Description', data.description],
      ['Hours', (data.hours || []).map((h) => `${h.day}: ${h.hours}`).join('; ')],
      ['Attributes', (data.attributes || []).map((g) => `${g.group}: ${g.items.join(', ')}`).join('; ')],
      ['Audit score', audit?.score]
    ];
    return toCsv(['Field', 'Value'], rows);
  }

  /**
   * Runs inside the measured page (chrome.scripting). Reads Chrome's own performance entries:
   * navigation timing, Largest Contentful Paint and layout shifts (buffered), resources.
   */
  function collectPageMetrics() {
    return new Promise((resolve) => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const res = performance.getEntriesByType('resource');
      let lcp = 0;
      let cls = 0;
      try {
        new PerformanceObserver((list) => { for (const e of list.getEntries()) lcp = Math.max(lcp, e.renderTime || e.loadTime || e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      } catch (e) { /* older Chrome */ }
      setTimeout(() => {
        const bytes = (nav.transferSize || 0) + res.reduce((n, r) => n + (r.transferSize || 0), 0);
        resolve({
          ttfb: Math.round(nav.responseStart || 0),
          dcl: Math.round(nav.domContentLoadedEventEnd || 0),
          load: Math.round(nav.loadEventEnd || 0),
          lcp: Math.round(lcp),
          cls: Math.round(cls * 1000) / 1000,
          requests: res.length + 1,
          kb: Math.round(bytes / 1024),
          url: location.href,
          visible: document.visibilityState
        });
      }, 1200);
    });
  }

  async function runSpeed(btn) {
    const site = safeUrl(data.website);
    const host = SphereGmbReportLinks.domainOf(site);
    const box = document.getElementById('speed');
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [`*://${host}/*`, `*://*.${host}/*`] });
    } catch (e) { granted = false; }
    if (!granted) {
      box.insertAdjacentHTML('beforeend', '<p class="note note-warn" role="alert" style="margin-top:10px">Permission was not given, so the page could not be measured.</p>');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Measuring…';
    let win = null;
    try {
      // A small unfocused window keeps the page visible, so Chrome records paint timings
      // (background tabs do not report Largest Contentful Paint).
      win = await chrome.windows.create({ url: site, focused: false, type: 'popup', width: 480, height: 820 });
      const tabId = win.tabs[0].id;
      await new Promise((resolve) => {
        const done = () => { chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(timer); resolve(); };
        const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') setTimeout(done, 2500); };
        const timer = setTimeout(done, 30000);
        chrome.tabs.onUpdated.addListener(onUpd);
      });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageMetrics });
      renderSpeed(result);
    } catch (err) {
      box.innerHTML = `<p class="note note-warn" role="alert">${esc(/Cannot access|permission/i.test(err.message) ? 'The site redirected to another domain, so it could not be measured. Try the Google PageSpeed test below.' : `Could not measure the page: ${err.message}`)}</p><button class="btn" type="button" data-act="speed" style="margin-top:10px">Try again</button>`;
    } finally {
      if (win) chrome.windows.remove(win.id).catch(() => {});
    }
  }

  function renderSpeed(m) {
    // Core Web Vitals thresholds (web.dev/articles/vitals): LCP good <= 2.5 s, poor > 4 s;
    // CLS good <= 0.1, poor > 0.25; TTFB good <= 0.8 s, poor > 1.8 s (web.dev/articles/ttfb).
    const rate = (v, good, poor) => (v <= good ? 'good' : v <= poor ? 'mid' : 'bad');
    const word = { good: 'Good', mid: 'Needs improvement', bad: 'Poor' };
    const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
    const lcpTone = m.lcp ? rate(m.lcp, 2500, 4000) : null;
    const clsTone = rate(m.cls, 0.1, 0.25);
    const ttfbTone = rate(m.ttfb, 800, 1800);
    const box = document.getElementById('speed');
    box.innerHTML = `
      <dl class="stats" style="border-top:1px solid var(--line)">
        <div class="stat"><dt>Largest Contentful Paint</dt><dd>${m.lcp ? `${sec(m.lcp)} <span class="badge badge-${lcpTone}">${word[lcpTone]}</span>` : 'n/a'}</dd></div>
        <div class="stat"><dt>Layout shift (CLS)</dt><dd>${m.cls} <span class="badge badge-${clsTone}">${word[clsTone]}</span></dd></div>
        <div class="stat"><dt>Server response (TTFB)</dt><dd>${sec(m.ttfb)} <span class="badge badge-${ttfbTone}">${word[ttfbTone]}</span></dd></div>
        <div class="stat"><dt>Fully loaded</dt><dd>${sec(m.load || m.dcl)}</dd></div>
      </dl>
      <p class="hint" style="margin-top:8px">Page weight ${fmt(m.kb)} KB in ${m.requests} requests. Measured once on your connection and computer (desktop browser), so numbers vary between runs; Google's lab test below simulates a mid-range phone. Thresholds: Google's Core Web Vitals (LCP up to 2.5 s and CLS up to 0.1 are "good").</p>
      <button class="btn" type="button" data-act="speed" style="margin-top:10px">Measure again</button>`;
  }

  async function runPsi(btn) {
    const box = document.getElementById('psi');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    // Run from this page, not the service worker: Chrome stops a worker whose fetch takes over
    // 30 seconds, and PageSpeed often needs 20 to 60.
    let res;
    try {
      const { psiApiKey } = await SgmbPage.storageGet('psiApiKey');
      const response = await fetch(SphereGmbPageSpeed.buildUrl(data.website, psiApiKey || ''), { credentials: 'omit', signal: AbortSignal.timeout(90000) });
      res = SphereGmbPageSpeed.parsePageSpeed(await response.json());
    } catch (err) {
      res = { error: err.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
    const errors = {
      quota: 'Google\'s shared free quota is used up for today. Add your own free PageSpeed API key in the GBP Sphere popup, Settings tab, then try again.',
      bad_key: 'Google rejected the PageSpeed API key saved in Settings.',
      timeout: 'PageSpeed Insights did not answer within 90 seconds. Try again later.',
      no_website: 'No website linked.'
    };
    if (!res || res.error) {
      box.innerHTML = `<p class="note note-warn" role="alert">${esc(errors[res?.error] || 'The PageSpeed check failed. Try again later.')}</p>`;
      return;
    }
    const tone = res.score >= 90 ? 'good' : res.score >= 50 ? 'mid' : 'bad';
    const field = { FAST: 'Fast', AVERAGE: 'Needs improvement', SLOW: 'Slow' }[res.fieldCategory] || 'Not enough real-user data';
    box.innerHTML = `
      <dl class="stats" style="border-top:1px solid var(--line)">
        <div class="stat"><dt>Performance</dt><dd><span class="badge badge-${tone}" style="font-size:16px">${res.score}</span></dd></div>
        <div class="stat"><dt>LCP</dt><dd>${esc(res.lcp || 'n/a')}</dd></div>
        <div class="stat"><dt>CLS</dt><dd>${esc(res.cls || 'n/a')}</dd></div>
        <div class="stat"><dt>Real users</dt><dd style="font-size:15px">${esc(field)}</dd></div>
      </dl>
      <p class="hint" style="margin-top:8px">Lab test on a mid-range phone. LCP under 2.5 s and CLS under 0.1 are Google's "good" thresholds.</p>`;
  }

  /** Fix list + checklist as tab-separated rows: pastes straight into Google Sheets or Excel. */
  function sheetsText() {
    const cell = (v) => String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
    const lines = [['Priority', 'Issue', 'Detail', 'Area'].join('\t')];
    fixes.forEach((f) => lines.push([PRIORITY_LABEL[f.priority], f.title, f.detail, f.source].map(cell).join('\t')));
    if (audit) {
      lines.push('', ['Check', 'Status', 'Detail', 'Points'].join('\t'));
      audit.checks.forEach((c) => lines.push([c.label, STATUS_LABEL[c.status], c.detail, `${c.points}/${c.max}`].map(cell).join('\t')));
    }
    return `${data.name || 'Business'}\tGBP Sphere audit\t${new Date().toLocaleDateString()}\n${lines.join('\n')}`;
  }

  async function fetchText(url, ms = 15000) {
    const res = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(ms) });
    return { res, text: res.ok ? (await res.text()).slice(0, 3000000) : '' };
  }

  async function runSiteCheck(btn) {
    const site = safeUrl(data.website);
    const host = SphereGmbReportLinks.domainOf(site);
    const box = document.getElementById('site-box');
    let granted = false;
    try {
      // Must run straight from the click so Chrome treats it as a user gesture.
      granted = await chrome.permissions.request({ origins: [`*://${host}/*`, `*://*.${host}/*`] });
    } catch (e) {
      granted = false;
    }
    if (!granted) {
      box.insertAdjacentHTML('beforeend', '<p class="note note-warn" role="alert" style="margin-top:12px">Permission was not given, so the website could not be read. Click again and choose Allow to run the check.</p>');
      return;
    }
    btn.disabled = true;
    box.insertAdjacentHTML('beforeend', '<p class="status" role="status" id="site-status" style="margin-top:10px">Reading the page…</p>');
    try {
      const { res, text } = await fetchText(site, 20000);
      if (!res.ok) throw new Error(`The website answered with HTTP ${res.status}.`);
      if (!/html/i.test(res.headers.get('content-type') || 'text/html')) throw new Error('The link does not lead to a web page.');
      const doc = new DOMParser().parseFromString(text, 'text/html'); // inert: no scripts, no requests
      const origin = new URL(res.url || site).origin;
      document.getElementById('site-status').textContent = 'Checking robots.txt and the sitemap…';
      let robots = '';
      let sitemapOk = false;
      try {
        const r = await fetchText(`${origin}/robots.txt`, 8000);
        robots = r.res.ok && !/<html/i.test(r.text.slice(0, 300)) ? r.text : '';
      } catch (e) { robots = ''; }
      if (/^\s*sitemap:/im.test(robots)) sitemapOk = true;
      else {
        try {
          const s = await fetchText(`${origin}/sitemap.xml`, 8000);
          sitemapOk = s.res.ok && /<(urlset|sitemapindex)/i.test(s.text.slice(0, 2000));
        } catch (e) { sitemapOk = false; }
      }
      const result = SphereGmbSiteAudit.auditSite(doc, { url: site, finalUrl: res.url, profile: data, robots, sitemapOk });
      if (/noindex/i.test(res.headers.get('x-robots-tag') || '')) {
        result.checks.push({ group: 'On-page', id: 'x-robots', label: 'X-Robots-Tag header', status: 'fail', detail: 'The server sends noindex: Google will drop this page.' });
      }
      renderSiteResult(result, res.url !== site ? res.url : '');
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'The website did not answer within 20 seconds.' : /Failed to fetch/i.test(err.message) ? 'The website could not be reached, or it redirects to another domain. Open it in a tab to check.' : err.message;
      box.innerHTML = `<p class="note note-warn" role="alert">${esc(msg)}</p><button class="btn" type="button" data-act="site" style="margin-top:10px">Try again</button>`;
    }
  }

  function renderSiteResult(r, redirectedTo) {
    const box = document.getElementById('site-box');
    const icon = { pass: ICONS.check, warn: ICONS.alert, fail: ICONS.cross, info: ICONS.minus };
    const label = { pass: 'Pass', warn: 'Improve', fail: 'Fix', info: 'Note' };
    const cls = { pass: 'check-pass', warn: 'check-warn', fail: 'check-fail', info: 'check-unknown' };
    const group = (name) => r.checks.filter((c) => c.group === name);
    const tone = r.score >= 80 ? 'good' : r.score >= 55 ? 'mid' : 'bad';
    box.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <p><span class="badge badge-${tone}" style="font-size:15px">${r.score} / 100</span> <span class="muted">${esc(SphereGmbReportLinks.domainOf(r.url))}${redirectedTo ? ' (after a redirect)' : ''}, about ${fmt(r.words)} words</span></p>
        <button class="btn no-print" type="button" data-act="site">Run again</button>
      </div>
      ${['Entity match', 'On-page'].map((g) => `
        <h3>${g === 'Entity match' ? 'Does the site match the profile?' : 'On-page basics'}</h3>
        <div class="checks">${group(g).map((c) => `
          <div class="check ${cls[c.status]}">
            <span class="check-ico">${icon[c.status]}</span>
            <div><strong>${esc(c.label)}</strong> <span class="badge">${label[c.status]}</span><p>${esc(c.detail)}</p></div>
            <span></span>
          </div>`).join('')}</div>`).join('')}
      <p class="hint" style="margin-top:10px">Read from the HTML the server sends. Content that a site builds with JavaScript after loading is not visible to this check.</p>`;
  }

  function wireActions() {
    document.addEventListener('click', (e) => {
      const copy = e.target.closest('[data-copy]');
      if (copy) { copyText(copy.dataset.copy, copy); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      const el = e.target.closest('[data-act]');
      if (!act) return;
      if (act === 'copy') copyText(reportText(), el);
      else if (act === 'csv') downloadText(`gbp-${slug(data.name)}.csv`, profileCsv());
      else if (act === 'print') window.print();
      else if (act === 'rank') openRankCheck(null);
      else if (act === 'copy-cats') copyText((data.categories || []).join('\n'), el);
      else if (act === 'cats-retry') initCategoryTools();
      else if (act === 'cats-refresh') initCategoryTools(true);
      else if (act === 'psi') runPsi(el);
      else if (act === 'sheets') copyText(sheetsText(), el);
      else if (act === 'site') runSiteCheck(el);
      else if (act === 'audit-run') runAudits(el);
      else if (act === 'speed') runSpeed(el);
      else if (act === 'audit-xlsx') downloadAuditXlsx();
      else if (act === 'audit-csv') downloadAuditCsv();
      else if (act === 'comp-add') addCustomComp(el);
      else if (act === 'comp-search') runCompetitorSearch(el);
      else if (act === 'comp-remove') removeCustomComp(Number(el.dataset.index));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const target = { 'comp-link': 'comp-add', 'comp-kw': 'comp-search' }[e.target.id];
      if (target) {
        e.preventDefault();
        document.querySelector(`[data-act="${target}"]`)?.click();
      }
    });
  }

  /** Highlights the side-nav link of the section in view. */
  function wireScrollSpy() {
    const links = Array.from(document.querySelectorAll('.side-nav a'));
    const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute('aria-current'));
        const a = byId.get(en.target.id);
        if (a) {
          a.setAttribute('aria-current', 'true');
          a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
    }, { rootMargin: '-80px 0px -65% 0px' });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /**
   * Competitors from the search the Dashboard was opened from. Opened from a single profile,
   * Google Maps is searched for the primary category from the business's own address. Last
   * resort: profiles with the same primary category that GBP Sphere has cached (no position).
   */
  async function buildBenchmark(snap) {
    const BM = SphereGmbBenchmark;
    bench = BM.benchmark(data, Array.isArray(snap.peers) ? snap.peers : [], { keyword: snap.keyword || '' });
    benchSource = bench ? 'search' : '';
    if (!bench && hasPoint() && defaultSearchKeyword()) {
      try {
        const res = await searchLocal(defaultSearchKeyword(), 8000);
        if (res.results.length >= 2) applyLocalResults(defaultSearchKeyword(), res.results);
      } catch (e) { /* fall back to cached profiles below */ }
    }
    if (!bench && (data.categories || [])[0]) {
      const primary = CT.norm(data.categories[0]);
      const cached = (await SgmbPage.cachedProfiles())
        .filter((p) => CT.norm((p.categories || [])[0]) === primary)
        .map((p) => ({ ...p, profileLoaded: true }))
        .sort((a, b) => (b.numReviews || 0) - (a.numReviews || 0));
      cachePeers = cached;
      bench = BM.benchmark(data, cached);
      if (bench) {
        bench.position = null;
        benchSource = 'cache';
      }
    }
    fixes = BM.fixList(audit, bench, data);
  }

  async function init() {
    fillIcons();
    const id = new URLSearchParams(location.search).get('id');
    const { savedReports = [] } = await SgmbPage.storageGet('savedReports');
    const snap = savedReports.find((r) => r.id === id) || (!id && savedReports[0]);
    if (!snap) {
      document.getElementById('main').innerHTML = '<div class="empty-state"><h1 style="font-size:22px;margin-bottom:8px">Report not found</h1><p>This report is no longer saved. Open a business on Google Search or Maps and click <strong>Dashboard</strong> to make a new one.</p></div>';
      return;
    }
    snapshot = snap;
    data = snap.data || {};
    audit = snap.audit && Array.isArray(snap.audit.checks) ? snap.audit : null;
    window.__sgmbTs = snap.ts;
    await buildBenchmark(snap);
    try {
      const saved = (await SgmbPage.storageGet(customKey()))[customKey()];
      customComps = Array.isArray(saved) ? saved.slice(0, MAX_CUSTOM_COMPETITORS) : [];
    } catch (e) { customComps = []; }
    render();
    wireActions();
    wireScrollSpy();
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    initCategoryTools();
  }

  init();
})();
