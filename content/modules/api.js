/**
 * GBP Sphere: API Client Module
 * Asks the service worker for a place's full public profile (categories, NAP, hours, etc.).
 */

window.SphereGmb = window.SphereGmb || {};

(function(ns) {
  'use strict';

  // A Maps results feed can hold 20+ cards; keep lookups gentle so Google doesn't throttle us.
  const MAX_CONCURRENT = 3;
  let active = 0;
  const queue = [];

  function acquire() {
    if (active < MAX_CONCURRENT) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function release() {
    const next = queue.shift();
    if (next) next();
    else active--;
  }

  ns.api = {
    async fetchPlaceProfile(featureId) {
      if (!featureId) return { categories: [], error: 'no_feature_id' };
      await acquire();
      try {
        const response = await ns.utils.sendMessage({ type: 'getPlaceProfile', payload: { featureId } });
        if (response.error) ns.utils.log('Profile lookup failed:', response.error);
        return response;
      } finally {
        release();
      }
    },

    // v1 name, kept so external callers keep working.
    fetchPlaceCategories(featureId) {
      return this.fetchPlaceProfile(featureId);
    }
  };
})(window.SphereGmb);
