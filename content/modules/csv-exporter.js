/**
 * SphereGMB: CSV Exporter Module
 * RFC 4180 CSV export of a business profile (UTF-8 with BOM so Excel opens it correctly).
 */

window.SphereGmb = window.SphereGmb || {};

(function (ns) {
  'use strict';

  const COLUMNS = [
    ['business name', (d) => d.name],
    ['primary category', (d) => d.categories?.[0]],
    ['additional categories', (d) => (d.categories || []).slice(1).join('; ')],
    ['address', (d) => d.address],
    ['city', (d) => d.addressLocality],
    ['region', (d) => d.region],
    ['postal code', (d) => d.zipCode],
    ['country', (d) => d.country],
    ['phone', (d) => d.phone],
    ['website', (d) => d.website],
    ['rating', (d) => d.rating],
    ['review count', (d) => d.numReviews],
    ['hours', (d) => (d.hours || []).map((h) => `${h.day}: ${h.hours}`).join(' | ')],
    ['description', (d) => d.description],
    ['attributes', (d) => (d.attributes || []).map((g) => `${g.group}: ${g.items.join(', ')}`).join(' | ')],
    ['latitude', (d) => d.latitude],
    ['longitude', (d) => d.longitude],
    ['plus code', (d) => d.plusCode],
    ['place CID', (d) => d.placeCID],
    ['place ID', (d) => d.placeId],
    ['feature ID', (d) => d.featureId],
    ['KGMID', (d) => d.kgmid],
    ['maps URL', (d) => d.mapsUrl || (d.placeCID ? `https://www.google.com/maps?cid=${d.placeCID}` : '')],
    ['reviews URL', (d) => d.reviewsUrl],
    ['audit score', (d) => ns.auditEngine.calculateCompletenessScore(d)],
    ['exported at', () => new Date().toISOString()]
  ];

  function escapeCsvCell(val) {
    const str = ns.utils.csvSafe(val);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function toCsv(rows) {
    const header = COLUMNS.map(([label]) => escapeCsvCell(label)).join(',');
    const body = rows.map((d) => COLUMNS.map(([, get]) => escapeCsvCell(get(d))).join(','));
    return '\uFEFF' + [header, ...body].join('\r\n');
  }

  ns.csvExporter = {
    escapeCsvCell,
    toCsv,
    columns: COLUMNS.map(([label]) => label),

    /** One CSV with a row per business (Maps results list export). */
    exportList(rows, label) {
      if (!rows || rows.length === 0) return;
      const filename = `${ns.utils.slug(label, 'maps-results')}-${rows.length}-businesses-${new Date().toISOString().slice(0, 10)}.csv`;
      ns.utils.downloadFile(filename, toCsv(rows));
      ns.utils.log(`Exported ${rows.length} businesses to ${filename}`);
      ns.reviewScraper?.notify(`Saved ${rows.length} businesses`, filename);
      return filename;
    },

    exportBusinessProfile(data) {
      if (!data) return;
      const filename = `${ns.utils.slug(data.name, 'gbp-profile')}-profile-${new Date().toISOString().slice(0, 10)}.csv`;
      ns.utils.downloadFile(filename, toCsv([data]));
      ns.reviewScraper?.notify('Profile saved as CSV', filename);
      ns.utils.log('Exported profile CSV for:', data.name);
    }
  };
})(window.SphereGmb);
