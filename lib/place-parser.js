/**
 * SphereGMB: Place preview parser.
 *
 * Parses the JSON returned by Google Maps' internal `/maps/preview/place` endpoint into a
 * flat business profile. Shared by the service worker (via importScripts) and the Node test
 * suite (via require), so it must stay dependency-free and DOM-free.
 *
 * Field positions were mapped against live responses (Nov 2026). Google can move them at any
 * time; every read is defensive and a missing field simply comes back empty.
 */

(function (root) {
  'use strict';

  const XSSI_PREFIX = /^\)\]\}'\s*\n?/;
  const FEATURE_ID_RE = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

  /** Safe nested read: at(obj, 6, 13, 0) */
  function at(obj, ...path) {
    let cur = obj;
    for (const key of path) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[key];
    }
    return cur;
  }

  function str(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** Converts a hex feature ID (0x…:0x…) to the decimal Place CID. */
  function featureIdToCid(featureId) {
    if (!featureId || !FEATURE_ID_RE.test(featureId)) return '';
    try {
      return BigInt(featureId.split(':')[1]).toString();
    } catch (e) {
      return '';
    }
  }

  function parseHours(raw) {
    const days = at(raw, 0);
    if (!Array.isArray(days)) return [];
    return days
      .map((d) => {
        const day = str(at(d, 0));
        const slots = Array.isArray(at(d, 3)) ? d[3].map((s) => str(at(s, 0))).filter(Boolean) : [];
        return day ? { day, hours: slots.join(', ') || 'Closed' } : null;
      })
      .filter(Boolean);
  }

  function parseAttributes(raw) {
    const groups = at(raw, 1);
    if (!Array.isArray(groups)) return [];
    return groups
      .map((g) => {
        const group = str(at(g, 1));
        const items = Array.isArray(at(g, 2)) ? g[2].map((i) => str(at(i, 1))).filter(Boolean) : [];
        return group && items.length ? { group, items } : null;
      })
      .filter(Boolean);
  }

  /** Google sometimes wraps outbound links as /url?q=<target>&...; return the real target. */
  function unwrapGoogleUrl(value) {
    const s = str(value);
    if (!/^(https?:\/\/www\.google\.[a-z.]+)?\/url\?/i.test(s)) return s;
    try {
      const target = new URL(s, 'https://www.google.com').searchParams.get('q') || new URL(s, 'https://www.google.com').searchParams.get('url') || '';
      return /^https?:\/\//i.test(target) ? target : '';
    } catch (e) {
      return '';
    }
  }

  /** Booking / ordering providers Google links on the profile (Resy, OpenTable, Google reserve). */
  function parseBookingLinks(raw) {
    const providers = at(raw, 0, 0, 2);
    if (!Array.isArray(providers)) return [];
    const out = [];
    for (const prov of providers) {
      const domain = str(at(prov, 0, 0));
      const url = unwrapGoogleUrl(at(prov, 1, 2, 0));
      if (domain && /^https?:\/\//i.test(url) && !out.some((o) => o.domain === domain)) out.push({ domain, url });
    }
    return out;
  }

  /**
   * Parses raw response text (or an already-parsed array) into a profile object.
   * Returns null when the payload is not a place response.
   */
  function parsePlacePreview(input) {
    let data = input;
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input.replace(XSSI_PREFIX, '').trim());
      } catch (e) {
        return null;
      }
    }
    const p = at(data, 6);
    if (!Array.isArray(p)) return null;

    const featureId = str(at(p, 10));
    const name = str(at(p, 11));
    const categories = Array.isArray(at(p, 13)) ? p[13].map(str).filter(Boolean) : [];
    const phoneBlock = at(p, 178, 0);

    const profile = {
      name,
      featureId,
      placeCID: featureIdToCid(featureId),
      placeId: str(at(p, 78)),
      kgmid: str(at(p, 89)),
      categories,
      rating: num(at(p, 4, 7)),
      numReviews: num(at(p, 4, 8)),
      reviewsUrl: str(at(p, 4, 3, 0)),
      priceLevel: str(at(p, 4, 2)),
      address: str(at(p, 39)) || str(at(p, 18)).replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*`), ''),
      neighborhood: str(at(p, 183, 1, 0)),
      street: str(at(p, 183, 1, 1)),
      addressLocality: str(at(p, 183, 1, 3)),
      zipCode: str(at(p, 183, 1, 4)),
      region: str(at(p, 183, 1, 5)),
      country: str(at(p, 183, 1, 6)),
      plusCode: str(at(p, 183, 2, 2, 0)),
      phone: str(at(phoneBlock, 0)),
      phoneIntl: str(at(phoneBlock, 3)),
      website: unwrapGoogleUrl(at(p, 7, 0)),
      websiteDomain: str(at(p, 7, 1)),
      latitude: num(at(p, 9, 2)),
      longitude: num(at(p, 9, 3)),
      timezone: str(at(p, 30)),
      description: str(at(p, 154, 0, 0)),
      editorialSummary: str(at(p, 32, 1, 1)) || str(at(p, 32, 0, 1)),
      hours: parseHours(at(p, 203)),
      attributes: parseAttributes(at(p, 100)),
      // Business Profile ID (the numeric ID shown in the owner's dashboard).
      businessProfileId: str(at(p, 181, 5)) || str(at(p, 227, 0, 5)),
      // [49] carries Google's "Own this business?" prompt, which only unclaimed profiles show.
      claimed: Array.isArray(p) && p.length > 49 ? !at(p, 49) : null,
      bookingLinks: parseBookingLinks(at(p, 75)),
      mapsUrl: featureId ? `https://www.google.com/maps?cid=${featureIdToCid(featureId)}` : '',
    };

    return profile;
  }

  const api = { parsePlacePreview, featureIdToCid, unwrapGoogleUrl, at };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SphereGmbPlaceParser = api;
})(typeof self !== 'undefined' ? self : globalThis);
