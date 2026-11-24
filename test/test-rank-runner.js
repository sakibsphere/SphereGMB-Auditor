/**
 * SphereGMB: rank runner against Local Finder / web results markup (jsdom).
 * Markup shape copied from a live Local Finder page (Nov 2026), names and IDs anonymised.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const row = (name, { ad = false, fid = '', cat = 'Dentist' } = {}) => `
  <div class="VkpGBb">
    <div class="cXedhc"><div class="uMdZh"><div class="rllt__details">
      ${ad ? '<div>Sponsored</div>' : ''}
      <div class="dbg0pd" role="heading"><span class="OSrXXb">${name}</span>${ad ? '<span>My Ad Center</span>' : ''}</div>
      <div>4.8(120) · ${cat}</div>
      <div>1 Example Ave · (555) 010-0000</div>
    </div></div></div>
    ${ad ? '<a href="/aclk?sa=L&amp;ai=x">Website</a>' : `<a href="/maps/dir//${encodeURIComponent(name)}/data=!4m6!4m5!1m1!4e2!1m2!1m1!1s${fid}">Directions</a>`}
  </div>`;

const html = `<!DOCTYPE html><html><body>
  <div id="search">
    ${row('Sponsored Smiles', { ad: true })}
    ${row('First Dental Studio', { fid: '0x1:0xa' })}
    ${row('Second Family Dentistry', { fid: '0x2:0xb', cat: 'Cosmetic dentist' })}
    ${row('Third Tooth Care', { fid: '0x3:0xc' })}
    <div class="MjjYud"><a href="https://www.example-dental.com/"><h3>Example Dental</h3></a></div>
    <div class="MjjYud"><a href="https://maps.google.com/x"><h3>Google link</h3></a></div>
    <div class="MjjYud"><a href="https://blog.other.org/post"><h3>Other</h3></a></div>
  </div>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://www.google.com/search?q=dentist&tbm=lcl', runScripts: 'outside-only' });
const sandboxWindow = dom.window;
sandboxWindow.SphereGmb = {};
sandboxWindow.__sgmbRankStarted = true; // load the module without auto-running a job
for (const f of ['utils.js', 'rank-runner.js']) {
  sandboxWindow.eval(fs.readFileSync(path.join(__dirname, '../content/modules', f), 'utf8'));
}
const rr = sandboxWindow.SphereGmb.rankRunner;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  [PASS] ${name}`);
}

console.log('--- SphereGMB rank runner (jsdom) ---');

test('Local Finder rows: ads skipped in positions, names cleaned, CID from the Directions link', () => {
  const rows = rr.readLocalRows(sandboxWindow.document);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0].sponsored, true);
  assert.strictEqual(rows[0].position, null);
  assert.strictEqual(rows[0].name, 'Sponsored Smiles', '"My Ad Center" is not part of the name');
  assert.deepStrictEqual(Array.from(rows.slice(1), (r) => r.position), [1, 2, 3]);
  assert.strictEqual(rows[2].name, 'Second Family Dentistry');
  assert.strictEqual(rows[2].featureId, '0x2:0xb');
  assert.strictEqual(rows[2].cid, '11');
  assert.strictEqual(rows[2].category, 'Cosmetic dentist');
});

test('Target found by CID and by name; the ad never matches', () => {
  const rows = rr.readLocalRows(sandboxWindow.document);
  assert.strictEqual(rr.matchTarget(rows, { cid: '12' }).position, 3);
  assert.strictEqual(rr.matchTarget(rows, { name: 'second family dentistry' }).position, 2);
  assert.strictEqual(rr.matchTarget(rows, { name: 'Sponsored Smiles' }), null);
});

test('Organic results skip Google links and keep order', () => {
  const organic = rr.readOrganic(sandboxWindow.document);
  assert.deepStrictEqual(Array.from(organic, (o) => o.domain), ['example-dental.com', 'blog.other.org']);
  assert.strictEqual(rr.matchDomain(organic, 'other.org').position, 2);
});

test('Link-less Local Finder variant: "Sponsored" label, "My Ad Centre", price in the rating line', () => {
  const doc = new JSDOM(`<div>
    <div class="VkpGBb"><div class="rllt__details"><div>Sponsored</div><div class="dbg0pd" role="heading"><span>Big Venue</span><span>My Ad Centre</span></div><div>3.8(17K) · Casino</div></div></div>
    <div class="VkpGBb"><div class="rllt__details"><div class="dbg0pd" role="heading"><span>Corner Taqueria</span></div><div>4.7(6.8K) · $20–30 · Mexican</div><div>1 Example St</div></div></div>
  </div>`).window.document;
  const rows = rr.readLocalRows(doc);
  assert.strictEqual(rows[0].sponsored, true);
  assert.strictEqual(rows[0].name, 'Big Venue');
  assert.strictEqual(rows[1].position, 1);
  assert.strictEqual(rows[1].category, 'Mexican');
  assert.strictEqual(rows[1].cid, '', 'no CID when the row has no links');
  assert.strictEqual(rr.matchTarget(rows, { name: 'Corner Taqueria', cid: '999' }).position, 1, 'name still matches when CID is unknown');
});

test('Chain branches with the same name: the street address decides', () => {
  const doc = new JSDOM(`<div>
    <div class="VkpGBb"><div class="rllt__details"><div class="dbg0pd" role="heading"><span>Chain Tacos</span></div><div>4.5(900) · Mexican</div><div>41 W 23rd St · (555) 010-1111</div></div></div>
    <div class="VkpGBb"><div class="rllt__details"><div class="dbg0pd" role="heading"><span>Chain Tacos</span></div><div>4.4(2K) · Mexican</div><div>23 W 33rd St · (555) 010-2222</div></div></div>
  </div>`).window.document;
  const rows = rr.readLocalRows(doc);
  assert.strictEqual(rr.matchTarget(rows, { name: 'Chain Tacos', street: '23 W' }).position, 2, 'the branch at 23 W 33rd St');
  assert.strictEqual(rr.matchTarget(rows, { name: 'Chain Tacos', phone: '550102222' }).position, 2, 'or the matching phone');
  assert.strictEqual(rr.matchTarget(rows, { name: 'Chain Tacos', street: '99 E' }), null, 'another branch is not a hit');
  assert.strictEqual(rr.matchTarget(rows, { name: 'Chain Tacos' }).position, 1, 'no address known: first name match');
});

console.log(`Rank runner tests passed (${passed}).`);
