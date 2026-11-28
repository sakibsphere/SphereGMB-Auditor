/**
 * GBP Sphere: bulk rank check, search-tab side.
 *
 * The Rank check page (pages/rank.html) opens one Google search per keyword with
 * ?sgmbRank=<jobId>.<index>. In that tab this module waits for the results, reads the
 * positions and posts them back with chrome.runtime.sendMessage. It only reads what the page
 * already shows; it never clicks, scrolls or retries a search. If Google shows its "unusual
 * traffic" page, the job is reported as blocked so the Rank check page stops opening searches.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  const PARAM = 'sgmbRank';
  const FID_RE = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i;

  function clean(v) {
    return String(v || '').replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00A0]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Lower-case words, any script (Bengali, Arabic, Japanese names keep their letters). */
  function normName(v) {
    return clean(v).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function cidFromFid(fid) {
    try { return fid ? BigInt(fid.split(':')[1]).toString() : ''; } catch (e) { return ''; }
  }

  /** Map results (Local Finder or the 3-pack): [{ position, name, featureId, cid, category, sponsored }]. */
  function readLocalRows(doc = document) {
    const rows = Array.from(doc.querySelectorAll('div.VkpGBb'));
    let position = 0;
    return rows.map((row) => {
      const hrefs = Array.from(row.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
      // Some Local Finder variants have no links at all (rows are click handlers), so the
      // "Sponsored" label is the reliable ad marker; the CID is then simply not available.
      const lines = Array.from(row.querySelectorAll('.rllt__details > div')).map((d) => clean(d.textContent));
      const sponsored = hrefs.some((h) => h.startsWith('/aclk')) || lines[0] === 'Sponsored' || /^\s*Sponsored\b/.test(row.innerText || row.textContent || '');
      const title = row.querySelector('.dbg0pd, .OSrXXb, [role="heading"]');
      const nameNode = title?.querySelector('span') || title;
      const name = clean(nameNode?.firstChild?.nodeType === 3 ? nameNode.firstChild.textContent : nameNode?.textContent).replace(/\s*My Ad Cent(er|re)\s*$/i, '');
      const fidMatch = hrefs.map((h) => h.match(FID_RE)).find(Boolean);
      const featureId = fidMatch ? fidMatch[1] : '';
      // "4.7(6.8K) · $20–30 · Mexican": the category is the last part of the rating line.
      const detailLine = lines.find((l) => /^\d(\.\d)?\s*\(/.test(l) && l.includes('·')) || lines.find((l) => l.includes('·') && l !== name) || '';
      const category = clean(detailLine.split('·').pop()).replace(/^\(?[\d.,]+[KkMm]?\)?\s*/, '');
      if (!sponsored) position++;
      const details = lines.filter((l) => l !== 'Sponsored' && l !== name).join(' · ');
      return { position: sponsored ? null : position, name, featureId, cid: cidFromFid(featureId), category, sponsored, details };
    }).filter((r) => r.name);
  }

  /** Web results: [{ position, url, domain, title }] skipping Google's own links and ads. */
  function readOrganic(doc = document) {
    const seen = new Set();
    const out = [];
    for (const h3 of doc.querySelectorAll('#search a h3, #rso a h3')) {
      const a = h3.closest('a');
      const href = a?.href || '';
      if (!/^https?:\/\//.test(href) || /\/\/([a-z0-9-]+\.)*google\.[a-z.]+\//i.test(href)) continue;
      if (a.closest('[data-text-ad], #tads, #bottomads')) continue;
      let domain = '';
      try { domain = new URL(href).hostname.replace(/^www\./, ''); } catch (e) { continue; }
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ position: out.length + 1, url: href, domain, title: clean(h3.textContent) });
    }
    return out;
  }

  /**
   * Finds the target in the rows: CID first, then the exact name, then a listing whose name
   * starts with the target's name as whole words ("Smile Studio" matches "Smile Studio NYC",
   * but "Dental Care" does not match "Bright Dental Care").
   */
  function matchTarget(rows, target = {}) {
    const cid = String(target.cid || '');
    const name = normName(target.name);
    const organic = rows.filter((r) => !r.sponsored);
    const byCid = organic.find((r) => cid && r.cid === cid);
    if (byCid) return byCid;
    // Chains share a name ("Tacombi" has several branches). When the row shows an address or
    // phone, it must agree with the target's; rows without either are accepted on the name.
    const street = normName(target.street);
    const phone = String(target.phone || '').replace(/\D+/g, '');
    const sameBranch = (r) => {
      if (!street && !phone) return true;
      const text = normName(r.details);
      const rowDigits = String(r.details || '').replace(/\D+/g, '');
      if (street && text.includes(street)) return true;
      if (phone.length >= 7 && rowDigits.includes(phone)) return true;
      return !/\d+\s+\p{L}/u.test(String(r.details || '')); // no street address shown at all
    };
    return organic.find((r) => name && normName(r.name) === name && sameBranch(r))
      || organic.find((r) => name && name.length >= 5 && `${normName(r.name)} `.startsWith(`${name} `) && sameBranch(r))
      || null;
  }

  function matchDomain(organic, domain) {
    const d = String(domain || '').toLowerCase().replace(/^www\./, '');
    if (!d) return null;
    return organic.find((r) => r.domain === d || r.domain.endsWith(`.${d}`)) || null;
  }

  function jobFromUrl(loc = window.location) {
    let params = new URLSearchParams(loc.search);
    let blocked = false;
    // Google's "unusual traffic" page keeps the original URL in ?continue=
    if (/^\/sorry\//.test(loc.pathname) && params.get('continue')) {
      try {
        params = new URL(params.get('continue')).searchParams;
        blocked = true;
      } catch (e) { return null; }
    }
    const tag = params.get(PARAM);
    if (!tag || !/^[\w-]+\.\d+$/.test(tag)) return null;
    const [jobId, index] = tag.split('.');
    return { jobId, index: Number(index), keyword: params.get('q') || '', blocked };
  }

  async function waitForResults(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector('div.VkpGBb, #search a h3, #rso a h3')) {
        await ns.utils.sleep(900); // let the rest of the list render
        return true;
      }
      if (document.readyState === 'complete' && Date.now() - start > 6000) return false;
      await ns.utils.sleep(300);
    }
    return false;
  }

  /** The job this tab belongs to when the URL lost its tag: same query, opened seconds ago. */
  function jobFromPending(stored, loc = window.location) {
    const p = stored?.pending;
    if (!stored?.id) return null;
    if (!p || Date.now() - (p.ts || 0) > 45000) return null;
    let params = new URLSearchParams(loc.search);
    let blocked = false;
    if (/^\/sorry\//.test(loc.pathname) && params.get('continue')) {
      try { params = new URL(params.get('continue')).searchParams; blocked = true; } catch (e) { return null; }
    }
    const q = normName(params.get('q'));
    return q && q === normName(p.keyword) ? { jobId: stored.id, index: p.index, keyword: p.keyword, blocked } : null;
  }

  /** Running jobs are stored per id ({ rankJobs: { <id>: { target, pending, ts } } }). */
  function readJobs() {
    return new Promise((resolve) => {
      try { chrome.storage.local.get('rankJobs', (r) => resolve(r.rankJobs || {})); } catch (e) { resolve({}); }
    });
  }

  async function run() {
    const fromUrl = jobFromUrl();
    if (fromUrl) ns.rankRunner.activeJob = true; // keeps the widget scan off in this tab
    const jobs = await readJobs();
    const job = fromUrl || Object.values(jobs).map((j) => jobFromPending(j)).find(Boolean);
    if (!job) return;
    ns.rankRunner.activeJob = true;
    const stored = jobs[job.jobId] || null;
    const send = (result) => ns.utils.sendMessage({ type: 'rankResult', payload: { jobId: job.jobId, index: job.index, keyword: job.keyword, ...result } });
    if (job.blocked || document.querySelector('#captcha-form, form[action*="/sorry/"]')) {
      send({ status: 'blocked' });
      return;
    }
    const target = stored ? stored.target || {} : {};
    const loaded = await waitForResults();
    const local = readLocalRows();
    const organic = readOrganic();
    const hit = matchTarget(local, target);
    const site = matchDomain(organic, target.domain);
    send({
      status: loaded ? 'done' : 'empty',
      localRank: hit ? hit.position : null,
      localCount: local.filter((r) => !r.sponsored).length,
      organicRank: site ? site.position : null,
      organicUrl: site ? site.url : '',
      top: local.filter((r) => !r.sponsored).slice(0, 5).map((r) => ({ name: r.name, category: r.category }))
    });
  }

  ns.rankRunner = { readLocalRows, readOrganic, matchTarget, matchDomain, jobFromUrl, jobFromPending, normName, run, activeJob: false };

  if (typeof document !== 'undefined' && window.location && /(^|\.)google\./.test(window.location.hostname) && !window.__sgmbRankStarted) {
    window.__sgmbRankStarted = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => run(), { once: true });
    else run();
  }
})(window.SphereGmb);
