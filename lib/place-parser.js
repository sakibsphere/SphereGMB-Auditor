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
   * Upcoming holidays Google flags on the hours ("Thanksgiving might affect these hours"):
   * the owner has not confirmed special hours for them.
   */
  function parseHolidayNotices(raw) {
    const days = at(raw, 0);
    if (!Array.isArray(days)) return [];
    const out = [];
    for (const d of days) {
      const note = at(d, 6);
      const holiday = str(at(note, 1));
      if (holiday && /might affect/i.test(str(at(note, 0))) && !out.some((o) => o.holiday === holiday)) {
        const date = at(d, 2);
        out.push({ holiday, day: str(at(d, 0)), date: Array.isArray(date) ? date.join('-') : '' });
      }
    }
    return out;
  }

  /**
   * The latest posts Google shows on the profile (up to 10): date, text, button, images.
   * [2][0] is the creation time in seconds; [1][0] holds the text in parts.
   */
  function parsePosts(raw) {
    const list = at(raw, 1);
    if (!Array.isArray(list)) return [];
    return list.map((post) => {
      const parts = at(post, 1, 0);
      // Text parts (type 1) and inline links (type 2) together, as the post shows them.
      const text = Array.isArray(parts) ? parts.map((x) => (typeof at(x, 0) === 'string' ? x[0] : '')).join('').trim() : '';
      const ts = num(at(post, 2, 0));
      return {
        date: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '',
        ts: ts || 0,
        ago: str(at(post, 12)),
        text: text.slice(0, 1500),
        cta: str(at(post, 4, 2)),
        images: Array.isArray(at(post, 5)) ? post[5].length : 0
      };
    }).filter((x) => x.ts || x.text);
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
    const posts = parsePosts(at(p, 122));
    const description = str(at(p, 154, 0, 0));

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
      description,
      // Google stopped showing owner descriptions publicly (Nov 2026): absent is "unknown", not "none".
      descriptionPublic: Boolean(description),
      editorialSummary: str(at(p, 32, 1, 1)) || str(at(p, 32, 0, 1)),
      hours: parseHours(at(p, 203)),
      holidayNotices: parseHolidayNotices(at(p, 203)),
      attributes: parseAttributes(at(p, 100)),
      // Google's own total of photos and videos on the profile ("84 Photos").
      photoCount: num(at(p, 37, 1)),
      // The business's profile picture (logo) as Google shows it on posts and the panel.
      logoUrl: str(at(p, 157)),
      posts,
      // The number Google uses for the location in the Business Profile Manager.
      locationId: str(at(p, 122, 1, 0, 7)),
      // Business Profile ID (the numeric ID shown in the owner's dashboard).
      businessProfileId: str(at(p, 181, 5)) || str(at(p, 227, 0, 5)),
      // [49] carries Google's "Own this business?" prompt, which only unclaimed profiles show.
      claimed: Array.isArray(p) && p.length > 49 ? !at(p, 49) : null,
      bookingLinks: parseBookingLinks(at(p, 75)),
      mapsUrl: featureId ? `https://www.google.com/maps?cid=${featureIdToCid(featureId)}` : '',
    };

    return profile;
  }

  /**
   * Feature groups Google Maps itself sends with a place request (copied from Maps' own
   * request, minus location, search text and session). Without them Google leaves out the
   * weekly hours for about half of all places, the photo total and the posts.
   */
  const PLACE_FLAGS = '!12m4!2m3!1i360!2i120!4i8!13m57!2m2!1i203!2i100!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2!1i408!2i240!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2!2b1!9b0!15m8!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20!15m112!1m29!4e2!13m9!2b1!3b1!4b1!6i1!8b1!9b1!14b1!20b1!25b1!18m17!3b1!4b1!5b1!6b1!9b1!13b1!14b1!17b1!20b1!21b1!22b1!30b1!32b1!33m1!1b1!34b1!36e2!10m1!8e3!11m1!3e1!17b1!20m2!1e3!1e6!24b1!25b1!26b1!27b1!29b1!30m1!2b1!36b1!37b1!39m3!2m2!2i1!3i1!43b1!52b1!54m1!1b1!55b1!56m1!1b1!61m2!1m1!1e1!65m5!3m4!1m3!1m2!1i224!2i298!72m22!1m8!2b1!5b1!7b1!12m4!1b1!2b1!4m1!1e1!4b1!8m10!1m6!4m1!1e1!4m1!1e3!4m1!1e4!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts!6m1!1e1!9b1!89b1!90m2!1m1!1e2!98m4!1b1!2b1!3b1!6b0!103b1!113b1!114m3!1b1!2m1!1b1!117b1!122m1!1b1!126b1!127b1!128m1!1b1!21m0!22m2!1e81!8e4!29m0!30m6!3b1!6m1!2b1!7m1!2b1!9b1!34m5!7b1!10b1!14b1!15m1!1b0';

  /** The place request URL for a feature ID, with the feature groups above. */
  function placeRequestUrl(featureId) {
    return `https://www.google.com/maps/preview/place?authuser=0&hl=en&gl=us&pb=!1m2!1s${encodeURIComponent(featureId)}!2s${PLACE_FLAGS}`;
  }

  /**
   * A Google Maps search pinned to a point: the same request Maps makes when you search with
   * the map centred on that spot, so results rank as they would for someone standing there.
   * `span` is the height of the visible map in metres (about a neighbourhood to a small city).
   */
  function mapsSearchUrl(query, lat, lng, span = 8000) {
    const pb = `!4m8!1m3!1d${Math.round(span)}!2d${Number(lng).toFixed(7)}!3d${Number(lat).toFixed(7)}!3m2!1i1024!2i768!4f13.1!7i20!8i0!10b1`;
    return `https://www.google.com/search?tbm=map&authuser=0&hl=en&gl=us&q=${encodeURIComponent(query)}&pb=${pb}`;
  }

  /** Reads a Maps search response into ranked profiles (position 1 = first result). */
  function parseMapsSearch(input) {
    let data = input;
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input.replace(/\/\*""\*\/\s*$/, '').replace(XSSI_PREFIX, '').trim());
      } catch (e) {
        return [];
      }
    }
    const rows = at(data, 0, 1);
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const p = at(row, 14);
      if (!Array.isArray(p)) continue;
      const wrap = [];
      wrap[6] = p;
      const prof = parsePlacePreview(wrap);
      if (!prof || !prof.name || !prof.featureId || seen.has(prof.featureId)) continue;
      seen.add(prof.featureId);
      out.push({ ...prof, position: out.length + 1 });
    }
    return out;
  }

  const api = { parsePlacePreview, parseMapsSearch, mapsSearchUrl, featureIdToCid, unwrapGoogleUrl, placeRequestUrl, PLACE_FLAGS, at };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SphereGmbPlaceParser = api;
})(typeof self !== 'undefined' ? self : globalThis);
