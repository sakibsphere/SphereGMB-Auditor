/**
 * SphereGMB: link builder for the full report page.
 *
 * Turns a parsed profile into grouped research links: Google Maps views, other map apps and
 * directories, and free website / brand audit tools. Every link is a plain public URL that the
 * user opens themselves; nothing here calls a paid API or needs a key.
 *
 * DOM-free and dependency-free so the Node tests can load it.
 */

(function (root) {
  'use strict';

  const enc = encodeURIComponent;

  function clean(v) {
    return String(v === null || v === undefined ? '' : v).trim();
  }

  /** Hostname without "www." for a website URL, or '' when the URL is not http(s). */
  function domainOf(url) {
    try {
      const u = new URL(clean(url));
      return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./i, '') : '';
    } catch (e) {
      return '';
    }
  }

  function originOf(url) {
    try {
      const u = new URL(clean(url));
      return /^https?:$/.test(u.protocol) ? u.origin : '';
    } catch (e) {
      return '';
    }
  }

  /** City guess: addressLocality from the profile, else the second-to-last address part. */
  function cityOf(d) {
    if (clean(d.addressLocality)) return clean(d.addressLocality);
    const parts = clean(d.address).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) return parts[parts.length - 2].replace(/\s+[A-Z]{2}\s*\d[\w -]*$/, '').trim();
    return parts.length === 2 ? parts[1].replace(/\s*\d[\w -]*$/, '').trim() : '';
  }

  function link(label, url, note = '') {
    return url ? { label, url, note } : null;
  }

  /**
   * Returns [{ id, title, desc, links: [{ label, url, note }] }]. Links whose input is missing
   * (no Place ID, no website, no coordinates) are left out rather than shown broken.
   */
  function buildLinkGroups(data = {}) {
    const d = data || {};
    const name = clean(d.name);
    const address = clean(d.address);
    const placeId = clean(d.placeId);
    const cid = clean(d.placeCID);
    const kgmid = clean(d.kgmid);
    const category = clean((d.categories || [])[0]);
    const domain = domainOf(d.website);
    const origin = originOf(d.website);
    const hasLL = typeof d.latitude === 'number' && typeof d.longitude === 'number';
    const ll = hasLL ? `${d.latitude},${d.longitude}` : '';
    const city = cityOf(d);
    const nameAddr = [name, address].filter(Boolean).join(' ');
    const nameCity = [name, city].filter(Boolean).join(' ');

    const google = [
      link('Review list', placeId && `https://search.google.com/local/reviews?placeid=${enc(placeId)}`, 'All reviews in one page'),
      link('Review request link', placeId && `https://search.google.com/local/writereview?placeid=${enc(placeId)}`, 'Send to customers, opens the review form'),
      link('Knowledge panel', kgmid && `https://www.google.com/search?kgmid=${enc(kgmid)}`, 'The profile on Google Search'),
      link('Maps link with Place ID', placeId && `https://www.google.com/maps/place/?q=place_id:${enc(placeId)}`),
      link('Maps link with CID', cid && `https://maps.google.com/?cid=${enc(cid)}`),
      link('Directions', (hasLL || placeId) && `https://www.google.com/maps/dir/?api=1&destination=${enc(ll || nameAddr)}${placeId ? `&destination_place_id=${enc(placeId)}` : ''}`),
      link('Other profiles at this address', address && `https://www.google.com/maps/search/${enc(address)}`, 'Spot duplicates or co-located businesses'),
      link('Profiles using this website', domain && `https://www.google.com/maps/search/${enc(domain)}`, 'Other listings that link the same domain'),
      link('Nearby competitors (Maps)', category && (hasLL ? `https://www.google.com/maps/search/${enc(category)}/@${d.latitude},${d.longitude},14z` : `https://www.google.com/maps/search/${enc([category, city].filter(Boolean).join(' '))}`), `"${category}" around this location`),
      link('Local Finder results', category && `https://www.google.com/search?q=${enc([category, city].filter(Boolean).join(' '))}&tbm=lcl&hl=en`, 'The full list behind the 3-pack')
    ].filter(Boolean);

    const directories = [
      link('Apple Maps: business', name && `https://maps.apple.com/?q=${enc(name)}${hasLL ? `&ll=${ll}` : `&address=${enc(address)}`}`),
      link('Apple Maps: directions', (hasLL || address) && `https://maps.apple.com/?daddr=${enc(ll || address)}`),
      link('Apple Maps: competitors', category && hasLL && `https://maps.apple.com/?q=${enc(category)}&sll=${ll}`),
      link('Bing Maps: business', nameAddr && `https://www.bing.com/maps?q=${enc(nameAddr)}`),
      link('Bing Maps: directions', hasLL && `https://www.bing.com/maps?rtp=~pos.${d.latitude}_${d.longitude}_${enc(name)}`),
      link('Bing Maps: competitors', category && hasLL && `https://www.bing.com/maps?q=${enc(category)}&cp=${d.latitude}~${d.longitude}&lvl=14`),
      link('HERE WeGo', nameCity && `https://wego.here.com/search/${enc(nameCity)}${hasLL ? `?map=${d.latitude},${d.longitude},16` : ''}`),
      link('OpenStreetMap', nameAddr && `https://www.openstreetmap.org/search?query=${enc(nameAddr)}${hasLL ? `#map=18/${d.latitude}/${d.longitude}` : ''}`),
      link('Waze', hasLL && `https://www.waze.com/ul?ll=${enc(ll)}&navigate=yes`),
      link('Facebook places', nameCity && `https://www.facebook.com/search/places/?q=${enc(nameCity)}`),
      link('Yelp', name && `https://www.yelp.com/search?find_desc=${enc(name)}&find_loc=${enc(address || city)}`),
      link('Foursquare', name && `https://foursquare.com/explore?q=${enc(name)}${city ? `&near=${enc(city)}` : ''}`)
    ].filter(Boolean);

    const site = (q, tbs) => `https://www.google.com/search?q=${enc(q)}${tbs ? `&tbs=${tbs}` : ''}`;
    const audit = [
      link('Google Ads Transparency', domain && `https://adstransparency.google.com/?region=anywhere&domain=${enc(domain)}`, 'Is the business running Google ads?'),
      link('Meta Ad Library', name && `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${enc(name)}&search_type=keyword_unordered`, 'Facebook and Instagram ads'),
      link('Google Trends: primary category', category && `https://trends.google.com/trends/explore?q=${enc(category)}`),
      link('Indexed pages: all time', domain && site(`site:${domain}`)),
      link('Indexed pages: past week', domain && site(`site:${domain}`, 'qdr:w')),
      link('Indexed pages: past month', domain && site(`site:${domain}`, 'qdr:m')),
      link('Indexed pages: past 6 months', domain && site(`site:${domain}`, 'qdr:m6')),
      link('Brand mentions on other sites', name && site(`"${name}"${domain ? ` -site:${domain}` : ''}`)),
      link('Phone number citations', clean(d.phone) && site(`"${clean(d.phone)}"${domain ? ` -site:${domain}` : ''}`), 'NAP consistency check'),
      link('PageSpeed Insights', origin && `https://pagespeed.web.dev/analysis?url=${enc(clean(d.website))}`),
      link('Rich Results Test', origin && `https://search.google.com/test/rich-results?url=${enc(clean(d.website))}`, 'LocalBusiness schema'),
      link('Schema Markup Validator', origin && `https://validator.schema.org/#url=${enc(clean(d.website))}`),
      link('robots.txt', origin && `${origin}/robots.txt`),
      link('sitemap.xml', origin && `${origin}/sitemap.xml`),
      link('Open Graph preview', origin && `https://www.opengraph.xyz/url/${enc(clean(d.website))}`),
      link('WHOIS (ICANN)', domain && `https://lookup.icann.org/en/lookup?name=${enc(domain)}`),
      link('BuiltWith', domain && `https://builtwith.com/${enc(domain)}`, 'Website technology'),
      link('Wayback Machine', domain && `https://web.archive.org/web/*/${enc(domain)}`),
      link('Backlink checker (free)', domain && `https://ahrefs.com/backlink-checker/?input=${enc(domain)}&mode=subdomains`),
      link('SSL test', domain && `https://www.ssllabs.com/ssltest/analyze.html?d=${enc(domain)}`),
      link('Safe Browsing status', domain && `https://transparencyreport.google.com/safe-browsing/search?url=${enc(domain)}`)
    ].filter(Boolean);

    return [
      { id: 'google', title: 'Google Maps links', desc: 'Direct links built from this profile\'s IDs.', links: google },
      { id: 'directories', title: 'Other maps and directories', desc: 'Check the listing is consistent everywhere customers look.', links: directories },
      { id: 'audit', title: 'Website and brand audit links', desc: domain ? `Free tools, opened for ${domain}.` : 'No website is linked, so only brand checks are available.', links: audit }
    ].filter((g) => g.links.length);
  }

  /**
   * Reads what a user pastes to name a business: a Google Maps place link, a link with cid= or
   * ludocid=, a bare CID or a feature ID. Returns { featureId }, { shortUrl } for share links
   * (maps.app.goo.gl, which need a redirect to resolve) or null.
   * A CID alone works as the feature ID 0x0:0x<cid in hex>: Google answers with the full place.
   */
  function parseMapsLink(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    let text = raw;
    try { text = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (e) { /* keep it as typed */ }
    // In a /maps/place/ link the place is the last "!1s0x…:0x…" of the data block.
    const ids = [...text.matchAll(/(?:!1s|ftid=|^)(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})\b/gi)];
    const loose = ids.length ? ids[ids.length - 1] : text.match(/(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})\b/i);
    if (loose) return { featureId: `${loose[1]}:${loose[2]}`.toLowerCase() };
    const cid = text.match(/[?&#](?:cid|ludocid)=(\d{1,20})\b/i) || text.match(/^(\d{6,20})$/);
    if (cid) {
      try {
        const n = BigInt(cid[1]);
        return n > 0n && n < 18446744073709551616n ? { featureId: `0x0:0x${n.toString(16)}` } : null;
      } catch (e) {
        return null;
      }
    }
    if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\/[\w-]+/i.test(raw)) return { shortUrl: raw.split('#')[0] };
    return null;
  }

  const api = { buildLinkGroups, domainOf, originOf, cityOf, parseMapsLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbReportLinks = api;
})(typeof self !== 'undefined' ? self : globalThis);
