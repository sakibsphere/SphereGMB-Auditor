/**
 * GBP Sphere: website check (Entity match + on-page) against sample HTML (jsdom).
 */

const assert = require('assert');
const { JSDOM } = require('jsdom');
const { auditSite } = require('../lib/site-audit.js');

const profile = {
  name: 'Example Dental Studio',
  phone: '(555) 010-2030',
  phoneIntl: '+15550102030',
  address: '42 Main St, Springfield, IL 62701',
  street: '42 Main St',
  zipCode: '62701',
  addressLocality: 'Springfield',
  categories: ['Dentist']
};

const good = `<!DOCTYPE html><html lang="en"><head>
  <title>Dentist in Springfield IL | Example Dental Studio</title>
  <meta name="description" content="Family and cosmetic dentist in Springfield, Illinois. Same-week appointments, most insurance accepted, call today.">
  <meta name="viewport" content="width=device-width">
  <link rel="canonical" href="https://example-dental.test/">
  <meta property="og:title" content="Example Dental Studio"><meta property="og:image" content="https://example-dental.test/og.png">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},{"@type":"Dentist","name":"Example Dental Studio","telephone":"+1 555 010 2030","address":{"streetAddress":"42 Main St","addressLocality":"Springfield","postalCode":"62701"},"openingHours":"Mo-Fr 08:00-17:00","aggregateRating":{"ratingValue":4.9}}]}</script>
</head><body>
  <h1>Your Springfield dentist</h1><h2>Services</h2>
  <p>${'Gentle care for the whole family. '.repeat(60)}</p>
  <p>Example Dental Studio, 42 Main St, Springfield, IL 62701. Call <a href="tel:+15550102030">(555) 010-2030</a>.</p>
  <iframe src="https://www.google.com/maps/embed?pb=x"></iframe>
  <img src="a.jpg" alt="Front desk">
</body></html>`;

const bad = `<!DOCTYPE html><html><head><title>Home</title><meta name="robots" content="noindex"></head>
<body><h1>Welcome</h1><h1>Again</h1><p>Call 555 999 0000</p><img src="a.jpg"><img src="b.jpg"><img src="c.jpg"></body></html>`;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  [PASS] ${name}`);
}

console.log('--- GBP Sphere website check (jsdom) ---');

test('A page that matches the profile passes the entity checks', () => {
  const doc = new JSDOM(good).window.document;
  const r = auditSite(doc, { url: 'https://example-dental.test/', profile, robots: 'User-agent: *\nDisallow: /admin\n', sitemapOk: true });
  const by = (id) => r.checks.find((c) => c.id === id);
  for (const id of ['name', 'phone', 'address', 'title-terms', 'h1-terms', 'schema', 'schema-hours', 'map', 'reviews', 'title', 'meta', 'h1', 'indexable', 'canonical', 'viewport', 'lang', 'alt', 'og', 'https', 'content', 'robots', 'sitemap']) {
    assert.strictEqual(by(id)?.status, 'pass', `${id}: ${by(id)?.status} ${by(id)?.detail}`);
  }
  assert.deepStrictEqual(r.schemaTypes, ['Dentist']);
  assert(r.score >= 95, `score ${r.score}`);
});

test('A thin, mismatched page is flagged', () => {
  const doc = new JSDOM(bad).window.document;
  const r = auditSite(doc, { url: 'http://example-dental.test/', profile, robots: 'User-agent: *\nDisallow: /\n', sitemapOk: false });
  const by = (id) => r.checks.find((c) => c.id === id);
  for (const id of ['name', 'phone', 'address', 'title-terms', 'schema', 'indexable', 'viewport', 'alt', 'https', 'content', 'robots']) {
    assert.strictEqual(by(id)?.status, 'fail', `${id} should fail: ${by(id)?.status}`);
  }
  assert.strictEqual(by('h1').status, 'warn', 'two H1s');
  assert(r.score < 30, `score ${r.score}`);
});

test('Schema that disagrees with the profile is a warning, not a pass', () => {
  const html = good.replace('"telephone":"+1 555 010 2030"', '"telephone":"+1 555 777 8888"');
  const r = auditSite(new JSDOM(html).window.document, { url: 'https://example-dental.test/', profile });
  const schema = r.checks.find((c) => c.id === 'schema');
  assert.strictEqual(schema.status, 'warn');
  assert(/phone differs/.test(schema.detail), schema.detail);
});

console.log(`Website check tests passed (${passed}).`);
