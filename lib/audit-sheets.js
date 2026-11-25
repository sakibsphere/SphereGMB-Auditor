/**
 * SphereGMB: the three agency audit sheets (Initial GBP Audit, GBP and Competitor Audit,
 * Service List), laid out like the agency template, as data for lib/xlsx-writer.js and CSV.
 *
 * buildAudits(input, selected) -> [{ key, name, sheet, csvRows }]
 *   input: {
 *     business,            // full profile (place parser fields + Search-panel extras)
 *     competitors: [],     // up to 3 profiles, best ranked first
 *     keyword, city,       // the search the competitors come from, the target locality
 *     sites: {},           // domain -> website check summary (see summariseSite)
 *     stored: {},          // featureId -> { media, posts } saved by the Media / Post audits
 *     services: [],        // [{ category, services: [] }] Google's predefined services
 *     suggestions: [],     // category names worth considering (competitors, related)
 *     now                  // seconds, for "days ago"
 *   }
 * Every value comes from Google's public data, the user's own audits or the website check.
 * Fields Google does not publish say so ("Not in public data") instead of guessing.
 */

(function (root) {
  'use strict';

  const DAY = 86400;
  const NOT_PUBLIC = 'Not in public data: check in the Business Profile Manager';
  const SOCIAL = [
    ['facebook', 'Add Facebook', /facebook\.com/i],
    ['youtube', 'Add Youtube', /youtube\.com|youtu\.be/i],
    ['instagram', 'Add Instagram', /instagram\.com/i],
    ['pinterest', 'Add Pinterest', /pinterest\./i],
    ['tiktok', 'Add Tiktok', /tiktok\.com/i],
    ['linkedin', 'Add Linkedin', /linkedin\.com/i],
    ['twitter', 'Add Twitter', /twitter\.com|(^|\/\/)(www\.)?x\.com/i]
  ];
  // Template label -> Google's attribute group name.
  const ATTRIBUTE_ROWS = [
    ['From the business', 'From the business'], ['Accessibility', 'Accessibility'], ['Amenities', 'Amenities'],
    ['Offerings', 'Offerings'], ['Parkings', 'Parking'], ['Payments', 'Payments'], ['Children', 'Children'],
    ['Crowd', 'Crowd'], ['Recycling', 'Recycling'], ['Service options', 'Service options']
  ];
  const STATUS_LIST = ['Not Started', 'In Progress', 'Needs Review', 'Complete', 'N/A'];

  const clean = (v) => String(v === null || v === undefined ? '' : v).trim();
  const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '');
  const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

  function hoursSummary(hours) {
    if (!Array.isArray(hours) || !hours.length) return '';
    const open = hours.filter((h) => !/closed/i.test(h.hours));
    const closed = hours.filter((h) => /closed/i.test(h.hours));
    if (open.length && open.every((h) => h.hours === open[0].hours)) {
      return `${open.length} days ${open[0].hours}${closed.length ? `, closed ${closed.map((h) => h.day.slice(0, 3)).join(', ')}` : ''}`;
    }
    return hours.map((h) => `${h.day.slice(0, 3)} ${h.hours}`).join('; ');
  }

  /** Posts summary from Google's latest posts (or the user's own Post audit). */
  function postFlow(p, stored, now) {
    const posts = Array.isArray(p.posts) ? p.posts.filter((x) => x.ts) : [];
    if (stored && stored.posts && typeof stored.posts.perMonth === 'number') {
      return { text: `${stored.posts.perMonth} per month (Post audit, ${stored.posts.total} posts since ${stored.posts.firstDate || 'n/a'}; latest ${stored.posts.lastDate || 'n/a'})`, ok: true, age: null };
    }
    // Merged profiles drop empty lists, so a loaded profile without "posts" has none.
    if (!posts.length) return { text: Array.isArray(p.posts) || p.profileLoaded ? 'No recent posts shown on Google' : 'Not loaded', ok: false, age: null };
    const latest = Math.max(...posts.map((x) => x.ts));
    const age = Math.floor((now - latest) / DAY);
    const last30 = posts.filter((x) => now - x.ts <= 30 * DAY).length;
    return { text: `${last30} in the last 30 days; latest ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`} (${new Date(latest * 1000).toISOString().slice(0, 10)})`, ok: age <= 7, age, last30 };
  }

  function socialFor(p, site, network) {
    const re = SOCIAL.find((s) => s[0] === network)[2];
    const onGbp = Array.isArray(p.socialProfiles) ? p.socialProfiles.find((s) => re.test(s.url) || new RegExp(network, 'i').test(s.network)) : null;
    const onSite = site && site.socialLinks ? site.socialLinks[network] : '';
    return { onGbp: onGbp ? onGbp.url : '', gbpKnown: Array.isArray(p.socialProfiles) || Boolean(p.seenOnSearch), onSite };
  }

  /** Summary of a website check used by the sheets (computed in the report page). */
  function summariseSite(result, doc) {
    if (!result) return null;
    const by = (id) => (result.checks || []).find((c) => c.id === id);
    const text = doc && doc.body ? doc.body.textContent.replace(/\s+/g, ' ') : '';
    const links = doc ? Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '') : [];
    const socialLinks = {};
    for (const [key, , re] of SOCIAL) {
      const hit = links.find((h) => re.test(h));
      if (hit) socialLinks[key] = hit;
    }
    const form = doc ? Array.from(doc.querySelectorAll('form')).some((f) => f.querySelector('input[type="email"], input[type="tel"], input[name*="email" i], input[name*="phone" i], textarea')) : false;
    return {
      ok: true,
      localBusiness: by('schema') ? by('schema').status !== 'fail' : false,
      phone: by('phone') ? by('phone').status !== 'fail' : /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(text),
      form,
      offer: /\b(free (quote|estimate|consultation)|% off|discount|coupon|special offer|limited[- ]time|offer)\b/i.test(text),
      socialProof: by('reviews') ? by('reviews').status === 'pass' : /\b(reviews?|testimonials?)\b/i.test(text),
      socialLinks,
      score: result.score
    };
  }

  // ---------------------------------------------------------------- Initial GBP Audit

  function initialRows(input) {
    const d = input.business || {};
    const now = input.now || Math.floor(Date.now() / 1000);
    const site = input.sites ? input.sites[domainOf(d.website)] : null;
    const stored = (input.stored || {})[d.featureId] || {};
    const cats = d.categories || [];
    const secondary = cats.slice(1);
    const stuffing = /\s[-|–]\s|\b(best|cheap|top rated|#1|near me)\b/i.test(d.name || '');
    const allServices = (input.services || []).flatMap((s) => s.services);
    const flow = postFlow(d, stored, now);
    const media = stored.media;
    const R = (type, existing, pass, proposed = '', remarks = '', note = '') => ({ type, existing: clean(existing), pass, proposed: clean(proposed), remarks: clean(remarks), note: clean(note) });

    const rows = [
      R('Business Name', d.name, d.name ? !stuffing : false, stuffing ? 'Use the real-world name only, as on signage' : '', stuffing ? 'Name may contain extra keywords or separators; Google can suspend keyword-stuffed names' : 'Matches no keyword-stuffing pattern'),
      R('Business Address', d.address || 'No public address', Boolean(d.address), '', d.address ? '' : 'Fine for service-area businesses; otherwise add the address'),
      R('Business Phone Number', d.phone || 'None', Boolean(d.phone), '', site ? (site.phone ? 'Same number found on the website' : 'Number not found on the website') : ''),
      R('Primary business categories', cats[0] || 'None', Boolean(cats[0]), '', cats[0] ? 'Most important category signal' : 'Set the primary category'),
      R('Add / update secondary business categories', secondary.join('; ') || 'None', secondary.length >= 2, (input.suggestions || []).slice(0, 6).join('; '), `${secondary.length} of 9 additional categories used`),
      R('Business description', d.description ? `${d.description.length} characters` : 'Not shown publicly by Google', d.description ? d.description.length >= 250 : null, 'Up to 750 characters: what you do, who you serve, the city, years in business; no links or phone numbers', d.description ? '' : 'Google hides owner descriptions from the public; check it in the profile'),
      R('Business hours', hoursSummary(d.hours) || 'None', (d.hours || []).length > 0, (d.holidayNotices || []).length ? `Set special hours for ${d.holidayNotices.map((n) => n.holiday).join(', ')}` : '', (d.holidayNotices || []).length ? `Google warns: ${d.holidayNotices.map((n) => n.holiday).join(', ')} might affect these hours` : ''),
      R('Website link (with UTM Tracking Parameters)', d.website || 'None', d.website ? /[?&]utm_/i.test(d.website) : false, d.website && !/[?&]utm_/i.test(d.website) ? `${d.website.split('#')[0]}${d.website.includes('?') ? '&' : '?'}utm_source=google&utm_medium=organic&utm_campaign=gbp` : '', d.website ? (/[?&]utm_/i.test(d.website) ? 'Visits from the profile are trackable in analytics' : 'No UTM tags: profile visits mix with other traffic') : 'No website linked'),
      R('Add Opening Date', NOT_PUBLIC, null, 'Add the opening date in the profile (Info, Opening date)'),
      R('Include additional links (appointment / menu)', (d.bookingLinks || []).map((b) => b.domain).join('; ') || 'None found', (d.bookingLinks || []).length > 0, (d.bookingLinks || []).length ? '' : 'Add an appointment, booking, quote or menu link', ''),
      R('Product', NOT_PUBLIC, null),
      R('Services', NOT_PUBLIC, null, allServices.slice(0, 10).join('; '), allServices.length ? `Google suggests ${allServices.length} predefined services for these categories (see Service List)` : ''),
      R('Logo', d.logoUrl ? 'Profile picture is set' : 'None', Boolean(d.logoUrl), d.logoUrl ? '' : 'Upload a square logo'),
      R('Cover photo', d.photoCount ? 'Set (first photo on the profile)' : 'None', Boolean(d.photoCount), '', 'Confirm the cover represents the business well'),
      R('Upload additional photos (exterior, interior, and team)', `${fmt(d.photoCount) || 0} photos and videos on Google${media ? `; Media audit: ${media.photos} photos, ${media.videos} videos, ${media.ownerCount ?? 'n/a'} by owner` : ''}`, typeof d.photoCount === 'number' ? d.photoCount >= 10 : null, typeof d.photoCount === 'number' && d.photoCount < 10 ? 'Add exterior, interior, team and work photos' : '', media && media.categories ? `Photo groups: ${media.categories.join(', ')}` : 'Run the Media Audit for owner vs customer split'),
      R('#of Q & A', 'Not read by SphereGMB', null, '', 'Check the profile on Google Maps'),
      R('# of GBP Post Flow', flow.text, flow.age === null && !flow.ok ? false : flow.ok, flow.ok ? '' : 'Post at least weekly (offers, updates, events)', ''),
      R('Specify Service Areas', NOT_PUBLIC, null)
    ];
    for (const [network, label] of SOCIAL) {
      const s = socialFor(d, site, network);
      const existing = s.onGbp ? s.onGbp : s.onSite ? `Not on the profile; on the website: ${s.onSite}` : s.gbpKnown ? 'Not on the profile' : 'Not checked (open the business on Google Search)';
      rows.push(R(label, existing, s.onGbp ? true : s.gbpKnown ? false : null, !s.onGbp && s.onSite ? 'Add this profile to the GBP' : '', ''));
    }
    const sectionAttr = rows.length;
    const attrGroups = d.attributes || [];
    const attrRows = ATTRIBUTE_ROWS.map(([label, group]) => {
      const g = attrGroups.find((x) => x.group.toLowerCase() === group.toLowerCase());
      return R(label, g ? g.items.join('; ') : 'Not set (or not offered for this category)', g ? true : null);
    });
    const cro = site
      ? [R('Has Lead Gen Form', site.form ? 'Yes' : 'No', site.form), R('Has Phone Number', site.phone ? 'Yes' : 'No', site.phone), R('Has Offer', site.offer ? 'Yes' : 'No', site.offer), R('Has Social Proofing', site.socialProof ? 'Yes' : 'No', site.socialProof)]
      : ['Has Lead Gen Form', 'Has Phone Number', 'Has Offer', 'Has Social Proofing'].map((l) => R(l, d.website ? 'Run with "Check websites" ticked' : 'No website', null));
    const third = Array.isArray(d.thirdPartyReviews) ? d.thirdPartyReviews : null;
    const prominence = [
      R('Review Count', fmt(d.numReviews) || '0', (d.numReviews || 0) >= 25),
      R('Star Rating', d.rating ? `${d.rating}` : 'None', (d.rating || 0) >= 4.5),
      R('Has Featured 3rd Party Reviews', third ? (third.length ? third.map((t) => `${t.site} ${t.rating}${t.votes ? ` (${fmt(t.votes)})` : ''}`).join('; ') : 'None shown') : 'Not checked (open the business on Google Search)', third ? third.length > 0 : null)
    ];
    return { main: rows, sectionAttr, attrRows, cro, prominence };
  }

  function statusFor(pass) {
    return pass === true ? 'Complete' : pass === false ? 'Not Started' : 'Needs Review';
  }

  function initialSheet(input) {
    const d = input.business || {};
    const { main, attrRows, cro, prominence } = initialRows(input);
    const rows = [];
    const csv = [];
    const merges = ['A1:G1'];
    let alt = 0;
    const title = `Google Business Profile Audit: ${clean(d.name) || 'Business'}`;
    rows.push({ height: 30, cells: [{ v: title, s: 'title' }, ...Array(6).fill({ s: 'title' })] });
    csv.push([title]);
    const head = ['Type', 'Existing Info', 'Pass/Fail', 'Proposed Info', 'Remarks', 'Status', 'Note'];
    rows.push({ height: 25.5, cells: head.map((v) => ({ v, s: 'header' })) });
    csv.push(head);
    const dataRow = (r) => {
      const g = alt++ % 2 === 0 ? 'Grey' : 'White';
      const pf = r.pass === true ? 'Pass' : r.pass === false ? 'Fail' : '';
      rows.push({ height: 32.25, cells: [
        { v: r.type, s: `label${g}` }, { v: r.existing, s: `cell${g}` },
        { v: pf, s: pf === 'Pass' ? `pass${g}` : pf === 'Fail' ? `fail${g}` : `center${g}` },
        { v: r.proposed, s: `cell${g}` }, { v: r.remarks, s: `muted${g}` },
        { v: statusFor(r.pass), s: `center${g}` }, { v: r.note, s: `cell${g}` }
      ] });
      csv.push([r.type, r.existing, pf, r.proposed, r.remarks, statusFor(r.pass), r.note]);
    };
    const section = (label) => {
      const n = rows.length + 1;
      merges.push(`A${n}:G${n}`);
      rows.push({ height: 21.75, cells: [{ v: label, s: 'section' }, ...Array(6).fill({ s: 'section' })] });
      csv.push([label]);
    };
    main.forEach(dataRow);
    section('Add Business Attributes');
    attrRows.forEach(dataRow);
    section('Landing Page CRO Audit');
    cro.forEach(dataRow);
    section('PROMINENCE AUDIT');
    prominence.forEach(dataRow);
    // Dropdowns like the template (Pass/Fail, Status), on every data row.
    const dataRefs = rows.map((r, i) => i).filter((i) => i >= 2 && rows[i].cells[0].s !== 'section').map((i) => i + 1);
    const ranges = (col) => dataRefs.map((n) => `${col}${n}`).join(' ');
    return {
      sheet: {
        name: 'Initial GBP Audit',
        cols: [32, 52, 12, 40, 40, 15, 22],
        rows, merges,
        freeze: { ySplit: 2 },
        validations: [{ sqref: ranges('C'), list: ['Pass', 'Fail'] }, { sqref: ranges('F'), list: STATUS_LIST }]
      },
      csvRows: csv
    };
  }

  // ---------------------------------------------------------- GBP and Competitor Audit

  function competitorSheet(input) {
    const d = input.business || {};
    const list = [d, ...(input.competitors || []).slice(0, 3)];
    while (list.length < 4) list.push(null);
    const now = input.now || Math.floor(Date.now() / 1000);
    const city = clean(input.city || d.addressLocality);
    const cell = (p, fn) => (p ? fn(p, ((input.stored || {})[p.featureId]) || {}, input.sites ? input.sites[domainOf(p.website)] : null) : '');
    const yesNo = (b) => (b === true ? 'Yes' : b === false ? 'No' : 'Not checked');
    const ROWS = [
      ['band', 'BUSINESS INFORMATION'],
      ['row', 'Keyword', () => clean(input.keyword) || 'n/a'],
      ['row', 'Website Link', (p) => p.website || 'None'],
      ['row', 'GBP Link', (p) => (p.placeCID ? `https://maps.google.com/?cid=${p.placeCID}` : p.mapsUrl || '')],
      ['section', 'PROXIMITY AUDIT'],
      ['row', 'Target Locality in Listing Address', (p) => (city ? (String(p.address || '').toLowerCase().includes(city.toLowerCase()) ? 'Yes' : 'No') : 'n/a')],
      ['section', 'RELEVANCE AUDIT'],
      ['row', 'Primary Category', (p) => (p.categories || [])[0] || 'None'],
      ['row', 'Category #2', (p) => (p.categories || [])[1] || 'None'],
      ['row', '# of Images', (p, s) => (typeof p.photoCount === 'number' ? `${fmt(p.photoCount)} (Google total, photos and videos)` : (s.media ? `${s.media.photos} (Media audit)` : 'n/a'))],
      ['row', '# of Videos', (p, s) => (s.media ? `${s.media.videos} (Media audit)` : 'Run the Media Audit')],
      ['row', 'GBP Post Flow (Monthly)', (p, s) => postFlow(p, s, now).text],
      ['row', 'Has LocalBusiness Markup', (p, s, site) => (p.website ? (site ? yesNo(site.localBusiness) : 'Not checked') : 'No website')],
      ['section', 'PROMINENCE AUDIT'],
      ['row', 'Review Count', (p) => fmt(p.numReviews) || '0'],
      ['row', 'Star Rating', (p) => (p.rating ? `${p.rating}` : 'None')],
      ['row', 'Has Featured 3rd Party Reviews', (p) => (Array.isArray(p.thirdPartyReviews) ? (p.thirdPartyReviews.length ? `Yes: ${p.thirdPartyReviews.map((t) => t.site).join(', ')}` : 'No') : 'Not checked')],
      ['row', 'Has Featured Social Profiles', (p) => (Array.isArray(p.socialProfiles) ? (p.socialProfiles.length ? `Yes: ${p.socialProfiles.map((t) => t.network).join(', ')}` : 'No') : 'Not checked')],
      ['section', 'SERVICE'],
      ['row', 'List of Services', () => 'Not in public data'],
      ['row', 'List of Service Areas', () => 'Not in public data'],
      ['section', 'PRODUCT'],
      ['row', '# of Products', () => 'Not in public data'],
      ['section', 'SOCIAL MEDIA'],
      ['row', '# No of Social Media', (p, s, site) => (Array.isArray(p.socialProfiles) ? `${p.socialProfiles.length} on the profile` : site ? `${Object.keys(site.socialLinks || {}).length} linked from the website` : 'Not checked')],
      ['section', 'OTHER PROMOTION'],
      ['row', 'Google Ads', (p) => (domainOf(p.website) ? `Check: https://adstransparency.google.com/?region=anywhere&domain=${domainOf(p.website)}` : 'No website to check')],
      ['section', 'BACKLINKS and Citations'],
      ['row', 'Total Backlinks', (p) => (domainOf(p.website) ? `Check: https://ahrefs.com/backlink-checker/?input=${domainOf(p.website)}&mode=subdomains` : 'No website')],
      ['row', 'Total Referring Domain', (p) => (domainOf(p.website) ? 'Same free checker as above' : 'No website')]
    ];
    const rows = [];
    const csv = [];
    const merges = ['A1:A2', 'B1:B2', 'C1:C2', 'D1:D2', 'E1:E2'];
    const headers = ['GBP & Competitor Audit', clean(d.name) || '[Business Name]', ...[1, 2, 3].map((n) => (list[n] ? `Competitor #${n}: ${list[n].name}` : `Competitor #${n}`))];
    rows.push({ height: 21.75, cells: headers.map((v, i) => ({ v, s: i === 0 ? 'colTitleLeft' : 'colTitle' })) });
    rows.push({ height: 21.75, cells: headers.map((v, i) => ({ s: i === 0 ? 'colTitleLeft' : 'colTitle' })) });
    csv.push(headers);
    let alt = 0;
    const yesNoRefs = [];
    for (const [kind, label, fn] of ROWS) {
      const n = rows.length + 1;
      if (kind === 'band') {
        rows.push({ height: 30, cells: [{ v: label, s: 'band' }, { s: 'band' }, { s: 'band' }, { s: 'band' }, { s: 'band' }] });
        csv.push([label]);
      } else if (kind === 'section') {
        merges.push(`A${n}:E${n}`);
        rows.push({ height: 19.5, cells: [{ v: label, s: 'section' }, ...Array(4).fill({ s: 'section' })] });
        csv.push([label]);
      } else {
        const g = alt++ % 2 === 0 ? 'Grey' : 'White';
        const values = list.map((p) => cell(p, fn));
        rows.push({ height: 31.5, cells: [{ v: label, s: `label${g}10` }, ...values.map((v) => ({ v, s: `cell${g}` }))] });
        csv.push([label, ...values]);
        if (/^Target Locality|^Has /.test(label)) yesNoRefs.push(`B${n}:E${n}`);
      }
    }
    return {
      sheet: {
        name: 'GBP and Competitor Audit',
        cols: [30, 42, 42, 42, 42],
        rows, merges,
        freeze: { xSplit: 1, ySplit: 3 },
        validations: yesNoRefs.length ? [{ sqref: yesNoRefs.join(' '), list: ['Yes', 'No', 'Not checked'] }] : []
      },
      csvRows: csv
    };
  }

  // -------------------------------------------------------------------- Service List

  function serviceSheet(input) {
    const d = input.business || {};
    const groups = (input.services || []).length ? input.services : (d.categories || []).map((c) => ({ category: c, services: [] }));
    const rows = [];
    const csv = [];
    const title = `${clean(d.name) || '[Business Name]'}: Service List (Google's predefined services to review and add)`;
    rows.push({ height: 37.5, cells: [{ v: title, s: 'title13' }, ...Array(6).fill({ s: 'title13' })] });
    csv.push([title]);
    const head = ['Category', 'Service 1', 'Service 2', 'Service 3', 'Service 4', 'Service 5', 'Service 6'];
    rows.push({ height: 21.75, cells: head.map((v) => ({ v, s: 'header11' })) });
    csv.push(head);
    let alt = 0;
    for (const g of groups) {
      const chunks = [];
      for (let i = 0; i < Math.max(1, g.services.length); i += 6) chunks.push(g.services.slice(i, i + 6));
      chunks.forEach((chunk, i) => {
        const style = alt++ % 2 === 0 ? 'cellGrey' : 'cellWhite';
        const label = i === 0 ? g.category : `${g.category} (more)`;
        const vals = [...chunk, ...Array(6 - chunk.length).fill('')];
        if (!g.services.length) vals[0] = 'No predefined services: add custom services';
        rows.push({ height: 31.5, cells: [{ v: label, s: style.replace('cell', 'label') }, ...vals.map((v) => ({ v, s: style }))] });
        csv.push([label, ...vals]);
      });
    }
    return { sheet: { name: 'Service List', cols: [26, 24, 24, 24, 24, 24, 24], rows, merges: ['A1:G1'], freeze: { ySplit: 2 }, validations: [] }, csvRows: csv };
  }

  const BUILDERS = {
    initial: { name: 'Initial GBP Audit', build: initialSheet },
    competitor: { name: 'GBP and Competitor Audit', build: competitorSheet },
    services: { name: 'Service List', build: serviceSheet }
  };

  function buildAudits(input, selected = ['initial', 'competitor', 'services']) {
    return selected.filter((k) => BUILDERS[k]).map((key) => ({ key, name: BUILDERS[key].name, ...BUILDERS[key].build(input) }));
  }

  /** CSV text (UTF-8 BOM, CRLF, formula guard) for one sheet's rows. */
  function toCsv(rows) {
    const safe = (v) => {
      const s = clean(v);
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    };
    return '\uFEFF' + rows.map((r) => r.map((v) => `"${safe(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }

  const api = { buildAudits, toCsv, summariseSite, initialRows, postFlow, hoursSummary, SOCIAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbAuditSheets = api;
})(typeof self !== 'undefined' ? self : globalThis);
