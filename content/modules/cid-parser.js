/**
 * GBP Sphere: CID & Identifier Decoder Module
 * Formulaic conversion of hexadecimal Google Feature IDs to 64-bit BigInt Place CIDs.
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  ns.cidParser = {
    /**
     * Extracts hexadecimal Google Feature ID (format: 0x...:0x...)
     */
    parseFeatureId(input) {
      if (!input || typeof input !== 'string') return null;
      const regex = /0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/g;
      const matches = input.match(regex);
      return matches && matches.length > 0 ? matches[0] : null;
    },

    /**
     * Converts a Feature ID to a 64-bit integer Place CID.
     * Google encodes the CID in the second 64-bit hex segment.
     */
    parsePlaceCID(input) {
      if (!input) return null;
      const str = String(input);

      // 1. Prioritize hex Feature ID (0x...:0x...) to prevent 'cid=0x...' matching single digit '0'
      const featureId = this.parseFeatureId(str);
      if (featureId) {
        try {
          const parts = featureId.split(':');
          if (parts.length >= 2 && parts[1]) {
            const hexPart = parts[1].trim();
            const bigIntValue = BigInt(hexPart);
            return bigIntValue.toString();
          }
        } catch (err) {
          ns.utils?.log?.('Error converting hex Feature ID to BigInt CID:', err);
        }
      }

      // 2. Direct decimal Place CID in query string: cid=… (Maps) or ludocid=… (Search links)
      const urlCidMatch = str.match(/[?&#](?:ludo)?cid=(\d{15,20})(?:[^\d]|$)/i) || str.match(/\b(?:ludo)?cid=(\d{15,20})\b/i);
      if (urlCidMatch && urlCidMatch[1]) {
        return urlCidMatch[1];
      }

      // 3. Raw decimal CID string (15-20 digits)
      const trimmed = str.trim();
      if (/^\d{15,20}$/.test(trimmed)) {
        return trimmed;
      }

      return null;
    },

    /**
     * Extracts Google Place ID (ChIJ...) if present
     */
    extractPlaceId(input) {
      if (!input || typeof input !== 'string') return null;
      const match = input.match(/ChIJ[a-zA-Z0-9_-]{20,}/);
      return match ? match[0] : null;
    },

    /**
     * Searches an element subtree for a place feature ID. Google Search exposes it through
     * data-fid / data-feature-id attributes and #lrd= review links; Maps uses /maps/place/ links.
     */
    findIdentifiersIn(root) {
      const result = { featureId: null, placeCID: null };
      if (!root || typeof root.querySelector !== 'function') return result;

      const attrNode = root.querySelector('[data-fid], [data-feature-id], [data-place-id-hex]');
      if (attrNode) {
        const raw = attrNode.getAttribute('data-fid') || attrNode.getAttribute('data-feature-id') || attrNode.getAttribute('data-place-id-hex');
        result.featureId = this.parseFeatureId(raw);
      }
      // The CID is the second half of the feature ID; deriving it avoids picking up a cid= link
      // that belongs to another business in the same panel ("People also search for").
      if (result.featureId) result.placeCID = this.parsePlaceCID(result.featureId);

      // 2026 local pack rows carry the ID only in the Directions link: /maps/dir//…!1s0x…:0x…
      const links = root.querySelectorAll('a[href*="#lrd="], a[href*="/maps/place/"], a[href*="/maps/dir/"], a[href*="ludocid="], a[href*="cid="], a[data-url*="/maps/place/"]');
      for (const link of links) {
        const href = link.getAttribute('href') || link.getAttribute('data-url') || '';
        if (!result.featureId) result.featureId = this.parseFeatureId(href);
        if (!result.placeCID) result.placeCID = this.parsePlaceCID(href);
        if (result.featureId && result.placeCID) break;
      }

      const cidNode = !result.placeCID && root.querySelector('[data-cid]');
      if (cidNode && /^\d{15,20}$/.test(cidNode.getAttribute('data-cid') || '')) {
        result.placeCID = cidNode.getAttribute('data-cid');
      }
      if (!result.placeCID && result.featureId) result.placeCID = this.parsePlaceCID(result.featureId);
      return result;
    },

    /**
     * Decodes any arbitrary input (URL, feature ID, or raw CID) into full identifier metadata
     */
    decodeAny(input) {
      if (!input || typeof input !== 'string') return null;
      const clean = input.trim();
      const featureId = this.parseFeatureId(clean);
      const placeCID = this.parsePlaceCID(clean);
      const placeId = this.extractPlaceId(clean);

      return {
        input: clean,
        featureId,
        placeCID,
        placeId,
        mapsUrl: placeCID ? `https://www.google.com/maps?cid=${placeCID}` : null
      };
    }
  };
})(window.SphereGmb);
