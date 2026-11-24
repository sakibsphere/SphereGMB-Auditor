/**
 * SphereGMB: Unit test suite.
 * Runs the real extension modules in a Node vm sandbox (no browser needed).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}\n         ${err.message}`);
  }
}

/** Loads content modules into a fresh sandbox and returns window.SphereGmb. */
function loadModules(files, windowOverrides = {}) {
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    Blob: class {},
    setTimeout,
    clearTimeout,
    window: { location: { href: 'https://www.google.com/search?q=test', pathname: '/search', hostname: 'www.google.com', hash: '' }, ...windowOverrides },
  };
  sandbox.window.SphereGmb = {};
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'content/modules', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.window.SphereGmb;
}

const { parsePlacePreview, featureIdToCid } = require('../lib/place-parser.js');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/place-preview-tacombi.json'), 'utf8');

console.log('\n--- SphereGMB unit tests ---');

test('manifest: MV3, files exist, content scripts limited to Search and Maps', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.manifest_version, 3);
  assert(fs.existsSync(path.join(ROOT, m.background.service_worker)), 'service worker missing');
  assert.strictEqual(m.background.type, undefined, 'service worker uses importScripts, so it must be a classic worker');
  const cs = m.content_scripts[0];
  [...cs.js, ...cs.css, ...Object.values(m.icons)].forEach((f) => assert(fs.existsSync(path.join(ROOT, f)), `${f} missing`));
  for (const pattern of cs.matches) {
    assert(/\/(search|maps)\*$/.test(pattern) || pattern === 'https://maps.google.com/*', `content script would run outside Search/Maps: ${pattern}`);
  }
  assert.deepStrictEqual(m.host_permissions, ['https://www.google.com/*']);
  const sw = fs.readFileSync(path.join(ROOT, m.background.service_worker), 'utf8');
  const imported = (sw.match(/importScripts\(([^)]+)\)/)[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
  assert(imported.length >= 2, 'service worker should import the shared libs');
  imported.forEach((f) => assert(fs.existsSync(path.join(ROOT, 'background', f)), `importScripts target ${f} missing`));
});

test('Post analytics: dates, cadence, gaps, length, duplicates, policy issues', () => {
  const { parsePostDate, analyzePosts } = require('../lib/post-analytics.js');
  const now = new Date(Date.UTC(2026, 10, 24));
  assert.strictEqual(parsePostDate('Nov 16, 2026', now).toISOString().slice(0, 10), '2026-11-16');
  assert.strictEqual(parsePostDate('3 days ago', now).toISOString().slice(0, 10), '2026-11-21');
  assert.strictEqual(parsePostDate('a week ago', now).toISOString().slice(0, 10), '2026-11-17');
  assert.strictEqual(parsePostDate('22 hours ago', now).toISOString().slice(0, 10), '2026-11-23');
  assert.strictEqual(parsePostDate('yesterday-ish', now), null);

  const long = 'Health insurance quotes in Farmers Branch made simple. ' + 'We compare plans, doctors and prescriptions so you can choose with confidence. '.repeat(6);
  const posts = [
    { dateText: '3 days ago', text: long, cta: 'Call now', images: 1 },
    { dateText: 'Nov 10, 2026', text: long + ' Bonus tip.', cta: 'Learn more', images: 1 },
    { dateText: 'Sep 1, 2026', text: 'Call us at (214) 501-9613 TODAY FOR A FREE QUOTE NOW', cta: '', images: 0 },
    { dateText: 'May 3, 2023', text: 'Medicare enrollment opens soon. Health insurance help for seniors in Farmers Branch with plan comparisons and clear advice.', link: 'https://example.com', images: 1 }
  ];
  const r = analyzePosts(posts, { category: 'Health insurance agency', city: 'Farmers Branch' }, now);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.firstDate, '2023-05-03');
  assert.strictEqual(r.lastDate, '2026-11-21');
  assert.strictEqual(r.daysSinceLast, 3);
  assert.strictEqual(r.lastYear, 3);
  assert.strictEqual(r.longestGapDays, Math.round((Date.UTC(2026, 8, 1) - Date.UTC(2023, 4, 3)) / 86400000));
  assert.strictEqual(r.duplicates, 1, 'second post is a near-duplicate of the first');
  const bad = r.posts[2];
  assert(bad.issues.includes('Phone number in the text (use the Call button instead)'));
  assert(bad.issues.includes('No button or link') && bad.issues.includes('No image') && bad.issues.includes('Short: under 40 words'));
  assert.strictEqual(r.withImagePct, 75);
  assert.strictEqual(r.withCtaPct, 75);
  assert.strictEqual(r.monthly.length, 12);
  assert.strictEqual(r.monthly[11].count, 2, 'two posts in Nov 2026');
  assert(r.score > 0 && r.score <= 100);
  assert.strictEqual(r.perMonth, 0.3, 'oldest post is 3 years old: 3 posts over 12 months');
  // A profile that started posting recently is averaged over its active months, not 12.
  const recent = analyzePosts([
    { dateText: 'Nov 20, 2026', text: long }, { dateText: 'Oct 20, 2026', text: long }, { dateText: 'Sep 24, 2026', text: long }
  ], {}, now);
  assert(recent.perMonth >= 1.5 && recent.perMonth <= 2.2, `perMonth ${recent.perMonth}`);
  assert(recent.perMonthMonths < 3, `window ${recent.perMonthMonths} months`);
  assert.strictEqual(analyzePosts([], {}, now).total, 0);
});

test('People also ask: question types and CSV', () => {
  const ns = loadModules(['utils.js', 'paa.js']);
  assert.strictEqual(ns.paa.questionType('How do I choose health insurance?'), 'How');
  assert.strictEqual(ns.paa.questionType('Which is the No. 1 health insurance?'), 'Which');
  assert.strictEqual(ns.paa.questionType('Top 3 health insurances?'), 'Other');
  const csv = ns.paa.toCsv(
    [{ question: 'What is "PPO"?', type: 'What', level: 2, answer: 'A plan, with a network', sourceTitle: 'Guide', sourceUrl: 'https://example.com/a', domain: 'example.com', aiOverview: false }],
    { autocomplete: [{ suggestion: 'ppo plans', seed: 'ppo' }], related: ['ppo vs hmo'], organic: [{ position: 1, title: 'PPO guide', url: 'https://example.org/', domain: 'example.org' }], ads: [] }
  );
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines[0], '"Section","#","Text","Type or seed","Level","Answer","Source title","Source URL","Domain","AI Overview"');
  assert.strictEqual(lines[1], '"People also ask","1","What is ""PPO""?","What","2","A plan, with a network","Guide","https://example.com/a","example.com","no"');
  assert.strictEqual(lines.length, 5, 'header + question + autocomplete + related + organic');
  assert(lines[2].startsWith('"Autocomplete","1","ppo plans","ppo"'));
  assert(lines[4].startsWith('"Organic","1","PPO guide"'));
});

test('category tools: CSV, lookup, related categories, services, keywords', () => {
  const CT = require('../lib/category-tools.js');
  const cats = [
    'gcid,category,group,in_us,us_businesses,world_businesses,other_names',
    'gcid:dentist,Dentist,Health & Medical,True,90000,400000,',
    'gcid:cosmetic_dentist,Cosmetic dentist,Health & Medical,True,9000,30000,',
    'gcid:pediatric_dentist,Pediatric dentist,Health & Medical,True,8000,20000,',
    'gcid:dental_clinic,Dental clinic,Health & Medical,True,50000,300000,"Dental office"',
    'gcid:bakery,Bakery,Food & Drink,True,60000,500000,',
    'gcid:car_wash,"Car wash, self service",Automotive,True,100,200,'
  ].join('\n');
  const services = 'gcid,category,service_type_id,service\ngcid:dentist,Dentist,job_type_id:x,Fillings\ngcid:dentist,Dentist,job_type_id:y,Dental implants';
  const lib = CT.buildLibrary(cats, services);
  assert.strictEqual(lib.count, 6);
  assert.strictEqual(lib.categories[5].name, 'Car wash, self service', 'quoted CSV field with a comma');
  assert.strictEqual(CT.findCategory(lib, 'dental office').id, 'gcid:dental_clinic', 'alternate names match');
  assert.strictEqual(CT.findCategory(lib, 'Tooth shop'), null);
  const related = CT.relatedCategories(lib, ['Dentist']).map((r) => r.name);
  assert(related.includes('Pediatric dentist') && related.includes('Dental clinic'), `related: ${related}`);
  assert(!related.includes('Bakery') && !related.includes('Dentist'));
  assert.deepStrictEqual(CT.servicesFor(lib, ['Dentist']).map((s) => s.service), ['Fillings', 'Dental implants']);
  assert.deepStrictEqual(CT.keywordSeeds(['Dentist'], [], 'Austin'), ['dentist', 'dentist near me', 'dentist austin']);
  assert.deepStrictEqual(CT.withLocation(['dentist', 'dentist austin', ''], 'Austin'), ['dentist Austin', 'dentist austin']);
  const peers = CT.coOccurring([{ categories: ['Dentist', 'Dental clinic'] }, { categories: ['Dentist', 'Dental clinic', 'Orthodontist'] }, { categories: ['Bakery'] }], ['Dentist']);
  assert.strictEqual(peers.peers, 2);
  assert.deepStrictEqual(peers.list[0], { name: 'Dental clinic', count: 2 });
  assert.strictEqual(CT.searchCategories(lib, 'dent')[0].name, 'Dentist');
});

test('report links: built from IDs, missing inputs are left out, values encoded', () => {
  const { buildLinkGroups, domainOf, cityOf } = require('../lib/report-links.js');
  const groups = buildLinkGroups({
    name: 'A & B Cafe', address: '1 Main St, Springfield, IL 62701', addressLocality: 'Springfield',
    placeId: 'ChIJabc', placeCID: '123456789012345678', kgmid: '/g/11xyz', categories: ['Cafe'],
    website: 'https://www.example.com/menu', phone: '(555) 010-0000', latitude: 39.8, longitude: -89.6
  });
  const all = groups.flatMap((g) => g.links);
  const byLabel = (l) => all.find((x) => x.label === l)?.url;
  assert.strictEqual(byLabel('Review list'), 'https://search.google.com/local/reviews?placeid=ChIJabc');
  assert.strictEqual(byLabel('Review request link'), 'https://search.google.com/local/writereview?placeid=ChIJabc');
  assert.strictEqual(byLabel('Maps link with CID'), 'https://maps.google.com/?cid=123456789012345678');
  assert.strictEqual(byLabel('robots.txt'), 'https://www.example.com/robots.txt');
  assert(byLabel('Indexed pages: past week').endsWith('site%3Aexample.com&tbs=qdr:w'));
  assert(byLabel('Yelp').includes('find_desc=A%20%26%20B%20Cafe'), 'names are URL-encoded');
  assert(all.every((l) => /^https:\/\//.test(l.url)), 'only https links');
  const bare = buildLinkGroups({ name: 'No Site Shop' }).flatMap((g) => g.links).map((l) => l.label);
  assert(!bare.includes('Review list') && !bare.includes('robots.txt'), 'links needing missing IDs are omitted');
  assert.strictEqual(domainOf('javascript:alert(1)'), '');
  assert.strictEqual(cityOf({ address: '1 Main St, Springfield, IL 62701' }), 'Springfield');
});

test('regression: review fixes (CSV formulas, /url? website, non-Latin, strict name match)', () => {
  const ns = loadModules(['utils.js', 'rank-runner.js']);
  assert.strictEqual(ns.utils.csvSafe('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.strictEqual(ns.utils.csvSafe('@SUM(A1)'), '\'@SUM(A1)');
  assert.strictEqual(ns.utils.csvSafe('Great food'), 'Great food');
  assert.strictEqual(ns.utils.csvSafe(-5), '-5', 'numbers are not touched');
  const { unwrapGoogleUrl } = require('../lib/place-parser.js');
  assert.strictEqual(unwrapGoogleUrl('/url?q=https://www.example.com/%3Futm_source%3Dgmb&opi=1&sa=U'), 'https://www.example.com/?utm_source=gmb');
  assert.strictEqual(unwrapGoogleUrl('https://www.example.com/'), 'https://www.example.com/');
  assert.strictEqual(unwrapGoogleUrl('/url?q=javascript:alert(1)'), '', 'only http(s) targets');
  const CT = require('../lib/category-tools.js');
  assert.deepStrictEqual(CT.withLocation(['dentist', 'dentist ঢাকা'], 'ঢাকা'), ['dentist ঢাকা', 'dentist ঢাকা'], 'non-Latin location is appended and detected');
  const rows = [{ position: 1, name: 'Bright Dental Care', sponsored: false }, { position: 2, name: 'স্মাইল ডেন্টাল', sponsored: false }];
  assert.strictEqual(ns.rankRunner.matchTarget(rows, { name: 'Dental Care' }), null, 'no match in the middle of another name');
  assert.strictEqual(ns.rankRunner.matchTarget(rows, { name: 'স্মাইল ডেন্টাল' }).position, 2, 'Bengali names match');
});

test('benchmark: medians, missing categories, prioritised fix list', () => {
  const { benchmark, fixList } = require('../lib/benchmark.js');
  const peer = (name, reviews, rating, cats, extra = {}) => ({ name, numReviews: reviews, rating, categories: cats, profileLoaded: true, attributes: [{ group: 'g', items: ['a', 'b'] }], description: 'x'.repeat(300), website: 'https://p.example', ...extra });
  const target = { name: 'Target Dental', featureId: '0x1:0x9', numReviews: 40, rating: 4.1, categories: ['Dentist'], profileLoaded: true, attributes: [], description: '', website: 'https://t.example/', claimed: false };
  const peers = [
    peer('Alpha', 500, 4.8, ['Dentist', 'Cosmetic dentist', 'Dental clinic']),
    { ...target },
    peer('Beta', 300, 4.7, ['Dentist', 'Cosmetic dentist']),
    peer('Gamma', 200, 4.6, ['Dentist', 'Dental clinic']),
    peer('Delta', 100, 4.5, ['Dentist', 'Cosmetic dentist', 'Orthodontist'])
  ];
  const b = benchmark(target, peers, { keyword: 'dentist' });
  assert.strictEqual(b.peers, 4, 'target removed from peers');
  assert.strictEqual(b.position, 2, 'target position in the list');
  const reviews = b.rows.find((r) => r.key === 'reviews');
  assert.strictEqual(reviews.median, 250);
  assert.strictEqual(reviews.verdict, 'behind');
  assert.deepStrictEqual(b.missingCategories.map((c) => [c.name, c.count]), [['Cosmetic dentist', 3], ['Dental clinic', 2]]);
  assert.strictEqual(benchmark(target, peers.slice(0, 2)), null, 'fewer than 3 peers: no benchmark');

  const audit = { checks: [{ id: 'description', label: 'Business description', status: 'fail', detail: 'none' }, { id: 'name', label: 'Business name', status: 'pass', detail: '' }] };
  const fixes = fixList(audit, b, target);
  assert.strictEqual(fixes[0].priority, 'high');
  assert(fixes.some((f) => f.title === 'Profile is unclaimed' && f.priority === 'high'));
  assert(fixes.some((f) => f.title === 'Fewer reviews than competitors' && f.priority === 'high'), '40 vs 250 is under half the median');
  assert(fixes.some((f) => /Cosmetic dentist/.test(f.title) && f.priority === 'high'), '3 of 4 competitors use it');
  assert(fixes.some((f) => f.title === 'Website link has no UTM tags' && f.priority === 'low'));
  const order = fixes.map((f) => ({ high: 0, medium: 1, low: 2 }[f.priority]));
  assert.deepStrictEqual(order, [...order].sort((x, y) => x - y), 'sorted High, Medium, Low');
});

test('rank runner: job tag parsing, CAPTCHA page, target matching', () => {
  const ns = loadModules(['utils.js', 'rank-runner.js']);
  const rr = ns.rankRunner;
  const job = rr.jobFromUrl({ pathname: '/search', search: '?q=dentist+austin&tbm=lcl&sgmbRank=jabc.3' });
  assert.strictEqual(job.jobId, 'jabc');
  assert.strictEqual(job.index, 3);
  assert.strictEqual(job.keyword, 'dentist austin');
  assert.strictEqual(job.blocked, false);
  const sorry = rr.jobFromUrl({ pathname: '/sorry/index', search: `?continue=${encodeURIComponent('https://www.google.com/search?q=x&sgmbRank=jabc.4')}` });
  assert.strictEqual(sorry.blocked, true);
  assert.strictEqual(sorry.index, 4);
  assert.strictEqual(rr.jobFromUrl({ pathname: '/search', search: '?q=x&sgmbRank=bad' }), null);
  // Tag stripped by a redirect: the pending job is matched by its query instead.
  const stored = { id: 'jabc', pending: { index: 2, keyword: 'Dentist Austin', ts: Date.now() } };
  assert.strictEqual(rr.jobFromPending(stored, { pathname: '/search', search: '?q=dentist+austin&udm=local' }).index, 2);
  assert.strictEqual(rr.jobFromPending(stored, { pathname: '/search', search: '?q=plumber' }), null, 'other searches are left alone');
  assert.strictEqual(rr.jobFromPending({ ...stored, pending: { ...stored.pending, ts: 0 } }, { pathname: '/search', search: '?q=dentist+austin' }), null, 'stale jobs expire');
  const rows = [
    { position: null, name: 'Ad Dental', cid: '1', sponsored: true },
    { position: 1, name: 'Smile Studio', cid: '111', sponsored: false },
    { position: 2, name: 'Bright Teeth Dental Care', cid: '222', sponsored: false }
  ];
  assert.strictEqual(rr.matchTarget(rows, { cid: '222' }).position, 2);
  assert.strictEqual(rr.matchTarget(rows, { name: 'smile studio' }).position, 1);
  assert.strictEqual(rr.matchTarget(rows, { name: 'Bright Teeth' }).position, 2, 'partial name');
  assert.strictEqual(rr.matchTarget(rows, { name: 'Ad Dental' }), null, 'ads never count');
  assert.strictEqual(rr.matchDomain([{ position: 4, domain: 'blog.example.com' }], 'www.example.com').position, 4);
});

test('PageSpeed parser: metrics, quota and key errors', () => {
  const { parsePageSpeed, buildUrl } = require('../lib/pagespeed.js');
  const ok = parsePageSpeed({
    id: 'https://example.com/',
    loadingExperience: { overall_category: 'AVERAGE' },
    lighthouseResult: {
      finalDisplayedUrl: 'https://example.com/',
      categories: { performance: { score: 0.47 } },
      audits: {
        'largest-contentful-paint': { displayValue: '4.1 s' },
        'cumulative-layout-shift': { displayValue: '0.02' },
        'total-blocking-time': { displayValue: '380 ms' },
        'first-contentful-paint': { displayValue: '2.0 s' }
      }
    }
  });
  assert.deepStrictEqual([ok.score, ok.lcp, ok.cls, ok.fieldCategory], [47, '4.1 s', '0.02', 'AVERAGE']);
  assert.strictEqual(parsePageSpeed({ error: { code: 429, message: 'Quota exceeded' } }).error, 'quota');
  assert.strictEqual(parsePageSpeed({ error: { code: 400, message: 'API key not valid' } }).error, 'bad_key');
  assert(buildUrl('https://a.com/x?y=1', 'K').includes('url=https%3A%2F%2Fa.com%2Fx%3Fy%3D1') && buildUrl('https://a.com', '').indexOf('key=') === -1);
});

test('place parser: full profile from a real preview/place response', () => {
  const p = parsePlacePreview(fixture);
  assert.strictEqual(p.name, 'Tacombi');
  assert.deepStrictEqual(p.categories, ['Mexican restaurant', 'Burrito restaurant', 'Restaurant', 'Taco restaurant']);
  assert.strictEqual(p.featureId, '0x89c259a903a8074d:0x85e2e7637cfe73a5');
  assert.strictEqual(p.placeCID, '9647527766265852837');
  assert.strictEqual(p.placeId, 'ChIJTQeoA6lZwokRpXP-fGPn4oU');
  assert.strictEqual(p.kgmid, '/g/11f3nl0y7n');
  assert.strictEqual(p.rating, 4.5);
  assert.strictEqual(p.numReviews, 2867);
  assert.strictEqual(p.phone, '(212) 967-5555');
  assert.strictEqual(p.address, '23 W 33rd St, New York, NY 10001');
  assert.strictEqual(p.addressLocality, 'New York');
  assert.strictEqual(p.zipCode, '10001');
  assert.strictEqual(p.websiteDomain, 'tacombi.com');
  assert.strictEqual(p.hours.length, 7);
  assert.strictEqual(p.hours[0].day, 'Thursday');
  assert(p.description.length > 100, 'owner description expected');
  assert(p.latitude > 40 && p.longitude < -73);
});

test('place parser: Business Profile ID, claimed status, booking links', () => {
  // Shapes copied from a live response (Nov 2026), values replaced.
  const p = [];
  p[10] = '0x1:0x2';
  p[11] = 'Example Place';
  p[49] = null;
  p[75] = [[[1, null, [[['booking.example', null, ['https://img.example/x.png', 'Booking', [80, 80]], 1], [null, null, ['https://booking.example/r/1', ['/url?q=x']]]]]]]];
  p[181] = [null, null, null, null, null, '1234567890123456789', '98765432109876543210'];
  p[230] = null;
  const parsed = parsePlacePreview([null, null, null, null, null, null, p]);
  assert.strictEqual(parsed.businessProfileId, '1234567890123456789');
  assert.strictEqual(parsed.claimed, true, 'no "Own this business?" block means claimed');
  assert.deepStrictEqual(parsed.bookingLinks, [{ domain: 'booking.example', url: 'https://booking.example/r/1' }]);
  p[49] = [['Own this business?']];
  p[181] = null;
  p[227] = [['0x1:0x2', null, null, '/g/1', 'ChIJ', '555', '666']];
  const unclaimed = parsePlacePreview([null, null, null, null, null, null, p]);
  assert.strictEqual(unclaimed.claimed, false);
  assert.strictEqual(unclaimed.businessProfileId, '555', 'falls back to [227][0][5]');
});

test('place parser: tolerates garbage and empty payloads', () => {
  assert.strictEqual(parsePlacePreview('not json'), null);
  assert.strictEqual(parsePlacePreview(")]}'\n[]"), null);
  const sparse = parsePlacePreview(")]}'\n" + JSON.stringify([null, null, null, null, null, null, []]));
  assert.deepStrictEqual(sparse.categories, []);
  assert.strictEqual(sparse.phone, '');
});

test('CID decoding: feature ID, cid= and ludocid= links', () => {
  const ns = loadModules(['utils.js', 'cid-parser.js']);
  assert.strictEqual(featureIdToCid('0x89c259af12345678:0x1b2c3d4e5f6a7b8c'), '1958007344816880524');
  assert.strictEqual(ns.cidParser.parsePlaceCID('https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x89c259af12345678:0x1b2c3d4e5f6a7b8c'), '1958007344816880524');
  assert.strictEqual(ns.cidParser.parsePlaceCID('https://maps.google.com/?cid=9647527766265852837'), '9647527766265852837');
  assert.strictEqual(ns.cidParser.parsePlaceCID('https://www.google.com/search?q=x&ludocid=9647527766265852837&lsig=AB'), '9647527766265852837');
  assert.strictEqual(ns.cidParser.parsePlaceCID('cid=0x1'), null);
});

test('audit engine: complete profile scores 100, gaps are reported', () => {
  const ns = loadModules(['utils.js', 'audit-engine.js']);
  const full = { ...parsePlacePreview(fixture), profileLoaded: true, categoriesSource: 'profile', rating: 4.8, numReviews: 2867 };
  full.description = 'x'.repeat(300);
  full.attributes = [{ group: 'Service options', items: ['Dine-in', 'Takeout', 'Delivery'] }];
  const r = ns.auditEngine.audit(full);
  assert.strictEqual(r.score, 100, JSON.stringify(r.checks.filter((c) => c.points < c.max)));

  const thin = ns.auditEngine.audit({ name: 'Best Cheap Plumber - Dallas', categories: ['Plumber'], profileLoaded: true, categoriesSource: 'profile' });
  assert(thin.score < 40, `thin profile scored ${thin.score}`);
  assert.strictEqual(thin.checks.find((c) => c.id === 'name').status, 'warn', 'keyword-stuffed name should warn');
  assert.strictEqual(thin.checks.find((c) => c.id === 'phone').status, 'fail');

  const notLoaded = ns.auditEngine.audit({ name: 'X', categories: ['Plumber'] });
  assert.strictEqual(notLoaded.checks.find((c) => c.id === 'hours').status, 'unknown', 'unloaded fields must not be marked as failures');
});

test('profile CSV: escaping, BOM, one column per field', () => {
  const ns = loadModules(['utils.js', 'audit-engine.js', 'csv-exporter.js']);
  assert.strictEqual(ns.csvExporter.escapeCsvCell('Smith, Jones & Co.'), '"Smith, Jones & Co."');
  assert.strictEqual(ns.csvExporter.escapeCsvCell('Quote "Special"'), '"Quote ""Special"""');
  assert.strictEqual(ns.csvExporter.escapeCsvCell(null), '');
  const csv = ns.csvExporter.toCsv([parsePlacePreview(fixture)]);
  assert.strictEqual(csv.charCodeAt(0), 0xfeff, 'BOM required for Excel');
  const [header, row] = csv.slice(1).split('\r\n');
  assert.strictEqual(header.split(',').length, ns.csvExporter.columns.length);
  assert(row.startsWith('Tacombi,Mexican restaurant,Burrito restaurant; Restaurant; Taco restaurant'));
});

test('reviews CSV: quotes and multi-line text survive', () => {
  const ns = loadModules(['utils.js', 'review-scraper.js']);
  const csv = ns.reviewScraper.reviewsToCsv('Cafe "One"', [
    { authorName: 'Jane', rating: 5, dateText: '2 weeks ago', reviewText: 'Great,\n"best" coffee', helpfulCount: 3, ownerResponse: '', authorUrl: '' }
  ]);
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines.length, 2);
  assert(lines[1].startsWith('"Cafe ""One""","Jane","5","2 weeks ago","Great,\n""best"" coffee"'));
});

test('regression: no test-fixture data hardcoded in shipped code', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'content/modules'))) {
    const src = fs.readFileSync(path.join(ROOT, 'content/modules', f), 'utf8');
    assert(!/Wilkerson/i.test(src), `${f} still references the Wilkerson test business`);
    assert(!/\|\|\s*57\b/.test(src), `${f} still falls back to the hardcoded 57 review count`);
    assert(!/\|\|\s*85\b/.test(src), `${f} still falls back to a hardcoded 85 score`);
  }
});

test('regression: review export always releases its lock', () => {
  const src = fs.readFileSync(path.join(ROOT, 'content/modules/review-scraper.js'), 'utf8');
  assert(/finally\s*\{\s*this\.isScraping = false;/.test(src), 'startExport must reset isScraping in finally');
  assert(!/const businessName[^\n]*\n[\s\S]*?businessName\s*=\s/.test(src.slice(src.indexOf('scrapeAndExport'))), 'businessName must not be reassigned after const');
});

console.log(`\nResults: ${passed}/${total} tests passed.\n`);
if (passed !== total) process.exit(1);
