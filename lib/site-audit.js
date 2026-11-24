/**
 * SphereGMB: website check ("does the website back up the profile?").
 *
 * auditSite(doc, { url, profile, robots, sitemapOk }) reads a parsed HTML document (DOMParser,
 * so no page scripts run) and returns checks in two groups:
 *   - Entity match: name, phone and address on the page, category and city in title / H1 / URL,
 *     LocalBusiness schema that agrees with the profile, hours, map, reviews.
 *   - On-page: title, meta description, headings, canonical, indexing, viewport, language,
 *     images without alt text, Open Graph, HTTPS, content length, robots.txt and sitemap.
 *
 * Works on whatever HTML the server returns; sites that build their content with JavaScript
 * only can look emptier than they are, and the result says so.
 */

(function (root) {
  'use strict';

  function norm(v) {
    return String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function digits(v) {
    return String(v || '').replace(/\D+/g, '');
  }

  function check(group, id, label, status, detail) {
    return { group, id, label, status, detail };
  }

  /** Every JSON-LD object on the page, flattened (@graph and arrays included). */
  function jsonLd(doc) {
    const out = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      out.push(node);
      if (node['@graph']) walk(node['@graph']);
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try { walk(JSON.parse(s.textContent)); } catch (e) { /* invalid JSON-LD is reported below */ }
    });
    return out;
  }

  const BUSINESS_TYPE_RE = /(LocalBusiness|Organization|Store|Restaurant|Dentist|Physician|Attorney|LegalService|Plumber|Electrician|HVACBusiness|RoofingContractor|HomeAndConstructionBusiness|AutoRepair|AutomotiveBusiness|BeautySalon|HairSalon|DaySpa|HealthClub|MedicalBusiness|MedicalClinic|Hotel|LodgingBusiness|FoodEstablishment|CafeOrCoffeeShop|Bakery|BarOrPub|RealEstateAgent|InsuranceAgency|FinancialService|AccountingService|ProfessionalService|EmergencyService|ChildCare|Library|SportsActivityLocation|EntertainmentBusiness|TravelAgency|MovingCompany|HousePainter|Locksmith|GeneralContractor|Notary|VeterinaryCare|Optician|Pharmacy)$/;

  function typesOf(node) {
    const t = node['@type'];
    return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String);
  }

  function addressText(a) {
    if (!a) return '';
    if (typeof a === 'string') return a;
    return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(' ');
  }

  /** Street number + first street word, and the postal code, from the profile address. */
  function addressKeys(profile) {
    const street = profile.street || String(profile.address || '').split(',')[0] || '';
    const m = norm(street).match(/^(\d+[a-z]?)\s+([a-z0-9]+)/);
    return { streetKey: m ? `${m[1]} ${m[2]}` : '', zip: String(profile.zipCode || '').trim() };
  }

  function auditSite(doc, { url = '', profile = {}, robots = null, sitemapOk = null, finalUrl = '' } = {}) {
    const checks = [];
    const E = 'Entity match';
    const P = 'On-page';
    const pageUrl = finalUrl || url;
    const body = doc.body;
    const text = norm(body ? body.textContent : '');
    const words = text ? text.split(' ').length : 0;
    const title = String(doc.querySelector('title')?.textContent || '').trim();
    const h1s = Array.from(doc.querySelectorAll('h1')).map((h) => String(h.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const metaDesc = String(doc.querySelector('meta[name="description" i]')?.getAttribute('content') || '').trim();
    const nodes = jsonLd(doc);
    const business = nodes.find((n) => typesOf(n).some((t) => BUSINESS_TYPE_RE.test(t)));
    const telLinks = Array.from(doc.querySelectorAll('a[href^="tel:"]')).map((a) => digits(a.getAttribute('href')));
    const city = norm(profile.addressLocality || '');
    const category = norm((profile.categories || [])[0] || '');
    const categoryHead = category.split(' ').pop() || '';
    let path = '';
    try { path = norm(decodeURIComponent(new URL(pageUrl).pathname)); } catch (e) { path = ''; }

    // ---------- Entity match ----------
    const name = norm(profile.name);
    if (name) {
      const short = name.split(' ').slice(0, 3).join(' ');
      const found = text.includes(name) || (short.length >= 5 && text.includes(short)) || norm(title).includes(short);
      checks.push(check(E, 'name', 'Business name on the page', found ? 'pass' : 'fail', found ? 'Found in the page text or title.' : `"${profile.name}" does not appear on the page.`));
    }

    const phone = digits(profile.phoneIntl || profile.phone);
    if (phone.length >= 7) {
      const last = phone.slice(-9);
      const inText = digits(body ? body.textContent : '').includes(last);
      const inTel = telLinks.some((t) => t.endsWith(last));
      const status = inText || inTel ? 'pass' : 'fail';
      checks.push(check(E, 'phone', 'Phone number matches the profile', status,
        status === 'pass' ? (inTel ? 'Found, with a tap-to-call link.' : 'Found in the text. Add a tel: link so phones can call in one tap.') : `${profile.phone || profile.phoneIntl} is not on the page. A different number weakens the match.`));
      if (status === 'pass' && !inTel) checks[checks.length - 1].status = 'warn';
    }

    const { streetKey, zip } = addressKeys(profile);
    if (streetKey || zip) {
      const hasStreet = streetKey && text.includes(streetKey);
      const hasZip = zip && text.includes(norm(zip));
      checks.push(check(E, 'address', 'Address matches the profile', hasStreet ? 'pass' : hasZip ? 'warn' : 'fail',
        hasStreet ? 'Street address found on the page.' : hasZip ? 'Only the postal code was found; show the full address as on the profile.' : 'The profile address is not on the page.'));
    }

    if (category || city) {
      const t = norm(title);
      const inTitleCat = category && (t.includes(category) || (categoryHead.length > 3 && t.includes(categoryHead)));
      const inTitleCity = city && t.includes(city);
      checks.push(check(E, 'title-terms', 'Category and city in the title', inTitleCat && (inTitleCity || !city) ? 'pass' : inTitleCat || inTitleCity ? 'warn' : 'fail',
        `Title: "${title || 'none'}". ${inTitleCat ? 'Has' : 'Missing'} the category${city ? `, ${inTitleCity ? 'has' : 'missing'} the city` : ''}.`));
      const h = norm(h1s.join(' '));
      const inH1 = (category && (h.includes(category) || (categoryHead.length > 3 && h.includes(categoryHead)))) || (city && h.includes(city));
      checks.push(check(E, 'h1-terms', 'Category or city in the main heading', inH1 ? 'pass' : h1s.length ? 'warn' : 'fail',
        h1s.length ? `H1: "${h1s[0].slice(0, 90)}"` : 'The page has no H1 heading.'));
      const inUrl = (categoryHead.length > 3 && path.includes(categoryHead)) || (city && path.includes(city));
      checks.push(check(E, 'url-terms', 'Category or city in the URL', inUrl ? 'pass' : path ? 'info' : 'info',
        inUrl ? 'The URL path names the service or city.' : 'Home pages often have no path; for a location page, include the city or service in the URL.'));
    }

    if (business) {
      const issues = [];
      const sName = norm(business.name);
      if (name && sName && !(sName.includes(name.split(' ')[0]))) issues.push('name differs');
      const sPhone = digits(business.telephone);
      if (phone.length >= 7 && sPhone && !sPhone.endsWith(phone.slice(-9))) issues.push('phone differs');
      const sAddr = norm(addressText(business.address));
      if (streetKey && sAddr && !sAddr.includes(streetKey)) issues.push('address differs');
      if (!business.address) issues.push('no address');
      checks.push(check(E, 'schema', 'LocalBusiness schema', issues.length ? 'warn' : 'pass',
        `${typesOf(business).join(', ')} found${issues.length ? `, but ${issues.join(', ')} from the profile` : ' and it agrees with the profile'}.`));
      const hours = business.openingHoursSpecification || business.openingHours;
      checks.push(check(E, 'schema-hours', 'Opening hours in schema', hours ? 'pass' : 'warn', hours ? 'Opening hours are marked up.' : 'Add openingHoursSpecification so Google can match the profile hours.'));
    } else {
      const invalid = doc.querySelectorAll('script[type="application/ld+json"]').length > nodes.length && !nodes.length;
      checks.push(check(E, 'schema', 'LocalBusiness schema', 'fail', invalid ? 'JSON-LD is present but could not be parsed.' : 'No LocalBusiness (or subtype) structured data found.'));
    }

    const hasMap = Boolean(doc.querySelector('iframe[src*="google.com/maps"], iframe[src*="maps.google"], a[href*="google.com/maps"], a[href*="goo.gl/maps"], a[href*="maps.app.goo.gl"]'));
    checks.push(check(E, 'map', 'Map or directions link', hasMap ? 'pass' : 'warn', hasMap ? 'Links to or embeds Google Maps.' : 'Embed the Google map or link to the profile for directions.'));
    const hasReviews = Boolean(business && business.aggregateRating) || /\b(reviews?|testimonials?)\b/.test(text);
    checks.push(check(E, 'reviews', 'Reviews or testimonials', hasReviews ? 'pass' : 'warn', hasReviews ? 'The page shows reviews or testimonials.' : 'Show a few customer reviews to support the profile.'));

    // ---------- On-page ----------
    const tl = title.length;
    checks.push(check(P, 'title', 'Title tag', !tl ? 'fail' : tl < 30 || tl > 65 ? 'warn' : 'pass', tl ? `${tl} characters (aim for 30 to 65).` : 'Missing.'));
    const ml = metaDesc.length;
    checks.push(check(P, 'meta', 'Meta description', !ml ? 'fail' : ml < 70 || ml > 160 ? 'warn' : 'pass', ml ? `${ml} characters (aim for 70 to 160).` : 'Missing.'));
    checks.push(check(P, 'h1', 'One H1 heading', h1s.length === 1 ? 'pass' : h1s.length ? 'warn' : 'fail', `${h1s.length} H1 heading${h1s.length === 1 ? '' : 's'}, ${doc.querySelectorAll('h2').length} H2.`));
    const robotsMeta = String(doc.querySelector('meta[name="robots" i]')?.getAttribute('content') || '').toLowerCase();
    checks.push(check(P, 'indexable', 'Page can be indexed', /noindex/.test(robotsMeta) ? 'fail' : 'pass', /noindex/.test(robotsMeta) ? 'meta robots says noindex: Google will drop this page.' : 'No noindex tag.'));
    const canonical = doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') || '';
    checks.push(check(P, 'canonical', 'Canonical URL', canonical ? 'pass' : 'warn', canonical ? canonical.slice(0, 100) : 'No canonical link.'));
    checks.push(check(P, 'viewport', 'Mobile viewport', doc.querySelector('meta[name="viewport" i]') ? 'pass' : 'fail', doc.querySelector('meta[name="viewport" i]') ? 'Set.' : 'Missing: the page will look tiny on phones.'));
    checks.push(check(P, 'lang', 'Page language', doc.documentElement.getAttribute('lang') ? 'pass' : 'warn', doc.documentElement.getAttribute('lang') || 'No lang attribute on <html>.'));
    const imgs = Array.from(doc.querySelectorAll('img'));
    const noAlt = imgs.filter((i) => !i.hasAttribute('alt')).length;
    checks.push(check(P, 'alt', 'Images have alt text', noAlt === 0 ? 'pass' : noAlt <= 2 ? 'warn' : 'fail', `${imgs.length} images, ${noAlt} without alt text.`));
    const og = doc.querySelector('meta[property="og:title"]') && doc.querySelector('meta[property="og:image"]');
    checks.push(check(P, 'og', 'Open Graph for sharing', og ? 'pass' : 'warn', og ? 'og:title and og:image set.' : 'Add og:title and og:image for link previews.'));
    checks.push(check(P, 'https', 'HTTPS', /^https:/i.test(pageUrl) ? 'pass' : 'fail', /^https:/i.test(pageUrl) ? 'Secure.' : 'The page is served over plain HTTP.'));
    checks.push(check(P, 'content', 'Amount of text', words >= 300 ? 'pass' : words >= 120 ? 'warn' : 'fail', `About ${words} words${words < 120 ? ' (or the content loads with JavaScript, which this check cannot see)' : ''}.`));
    if (robots !== null) {
      const blocksAll = /user-agent:\s*\*[^]*?disallow:\s*\/\s*(\n|$)/i.test(robots);
      checks.push(check(P, 'robots', 'robots.txt', robots === '' ? 'warn' : blocksAll ? 'fail' : 'pass', robots === '' ? 'No robots.txt found.' : blocksAll ? 'robots.txt blocks every crawler from the whole site.' : 'Found and does not block the site.'));
    }
    if (sitemapOk !== null) checks.push(check(P, 'sitemap', 'XML sitemap', sitemapOk ? 'pass' : 'warn', sitemapOk ? 'Sitemap found.' : 'No sitemap at /sitemap.xml or in robots.txt.'));

    const scored = checks.filter((c) => c.status !== 'info');
    const score = scored.length ? Math.round((scored.reduce((n, c) => n + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0) / scored.length) * 100) : 0;
    return { checks, score, title, words, url: pageUrl, schemaTypes: business ? typesOf(business) : [] };
  }

  const api = { auditSite, jsonLd, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbSiteAudit = api;
})(typeof self !== 'undefined' ? self : globalThis);
