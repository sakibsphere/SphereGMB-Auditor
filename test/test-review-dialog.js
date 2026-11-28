/**
 * GBP Sphere: Review dialog test against real (anonymised) Google Search markup.
 * Runs the real review-scraper module in jsdom.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const card = fs.readFileSync(path.join(__dirname, 'fixtures/search-review-card-2026.html'), 'utf8');

// Second card: 3 stars (two grey), no owner reply, different id.
const threeStar = card
  .replace(/review-1/g, 'review-2')
  .replace('Reviewer 1', 'Reviewer 2')
  .replace(/(<path fill=")#fabb05(" d="M0 0"><\/path><\/svg><\/div><span class="y3Ibjb">)/, '$1#dadce0$2')
  .replace(/(<svg[^>]*><path fill=")#fabb05("[^<]*<\/path><\/svg>)(<svg[^>]*><path fill="#dadce0")/, '$1#dadce0$2$3')
  .replace(/<div class="PdaDLc">[\s\S]*?<div class="KmCjbd">[\s\S]*?<\/div><\/div>/, '');

const html = `<!doctype html><body>
  <div class="xOR97e" role="dialog">
    <div class="L3AQye review-dialog-body">
      <div>Sample Business 5.0 57 reviews <button>Write a review</button></div>
      <div class="RVCQse"><div class="OG9A1">${card}${threeStar}</div></div>
    </div>
  </div></body>`;

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://www.google.com/search?q=x' });
const { window } = dom;
window.SphereGmb = {};
for (const f of ['utils.js', 'review-scraper.js']) {
  window.eval(fs.readFileSync(path.join(__dirname, '../content/modules', f), 'utf8'));
}
const scraper = window.SphereGmb.reviewScraper;

let passed = 0;
const pass = (m) => { passed++; console.log(`  [PASS] ${m}`); };
console.log('--- Google Search reviews dialog (2026 markup) ---');

const dialog = window.document.querySelector('.xOR97e');
const items = scraper.findReviewItems(dialog);
assert.strictEqual(items.length, 2, `expected 2 review cards, got ${items.length}`);
pass('One item per review card (owner reply and reaction popup not counted separately)');

const r1 = scraper.parseReviewItem(items[0]);
assert.strictEqual(r1.authorName, 'Reviewer 1');
assert.strictEqual(r1.rating, 5);
assert.strictEqual(r1.dateText, '6 days ago');
assert.strictEqual(r1.reviewText, 'Short review 1 text that was cut off and here is the full remainder of the review.');
assert.strictEqual(r1.ownerResponse, 'Thank you for the review 1.');
assert.strictEqual(r1.ownerResponseDate, '6 days ago');
assert.strictEqual(r1.reviewerInfo, '1 review');
assert.strictEqual(r1.reviewId, 'review-1');
assert(r1.authorUrl.includes('/maps/contrib/'));
pass('Full text (not the truncated copy), rating, date, owner reply and IDs parsed');

const r2 = scraper.parseReviewItem(items[1]);
assert.strictEqual(r2.rating, 3, `gold-vs-grey star count, got ${r2.rating}`);
assert.strictEqual(r2.ownerResponse, '');
pass('Star rating counts only gold stars (3 of 5)');

// Restaurant card: paragraphs, sub-ratings, Q&A details, visit info, photos, likes, owner reply.
const restaurantHtml = fs.readFileSync(path.join(__dirname, 'fixtures/search-review-card-restaurant-2026.html'), 'utf8');
const holder = window.document.createElement('div');
holder.innerHTML = restaurantHtml;
const rr = scraper.parseReviewItem(holder.querySelector('.bwb7ce'));
assert.strictEqual(rr.reviewText, 'Paragraph 1 of the review text.\n\nParagraph 2 of the review text.', `review text: ${JSON.stringify(rr.reviewText)}`);
assert(!/Food|Group size|Noise/.test(rr.reviewText), 'sub-ratings and Q&A must not leak into the review text');
assert.strictEqual(rr.subRatings, 'Food: 5/5 | Service: 4/5 | Atmosphere: 5/5');
assert.strictEqual(rr.details, 'Group size: 1 person; Noise level: Quiet, easy to talk');
assert.strictEqual(rr.visit, 'Lunch | $20–30');
assert.strictEqual(rr.rating, 4);
assert.strictEqual(rr.photoCount, 3);
assert.deepStrictEqual(rr.photoUrls[0], 'https://lh3.googleusercontent.com/grass-cs/SAMPLE0=s0', 'photo URL upgraded to original size');
assert.deepStrictEqual([...rr.photoCaptions], ['dish 1', 'dish 2', 'dish 3']);
assert.strictEqual(rr.localGuide, true);
assert.strictEqual(rr.reviewerReviewCount, 31);
assert.strictEqual(rr.reviewerPhotoCount, 19);
assert.strictEqual(rr.isNew, true);
assert.strictEqual(rr.helpfulCount, 2);
assert.strictEqual(rr.ownerResponse, 'Thanks for visiting us.\n\nSee you again soon.');
assert.strictEqual(rr.ownerResponseDate, '3 weeks ago');
pass('Restaurant review: paragraphs kept, sub-ratings/Q&A/visit/photos/likes parsed separately');

assert.strictEqual(scraper.isGold('#fabb05'), true);
assert.strictEqual(scraper.isGold('rgb(251, 188, 4)'), true);
assert.strictEqual(scraper.isGold('#dadce0'), false);
assert.strictEqual(scraper.isGold('#f1f3f4'), false, 'light grey must not count as a filled star');
pass('Gold detection rejects light greys that the old regex counted');

assert.strictEqual(scraper.readTargetCount(dialog, null), 57);
pass('Total review count read from the dialog header');

const found = scraper.findReviewsModal();
assert.strictEqual(found, dialog, 'the reaction popup inside a card must not be mistaken for the reviews dialog');
pass('Reviews dialog detected (not the nested reaction popup)');

const csv = scraper.reviewsToCsv('Sample Business', [r1, r2]);
const header = csv.slice(1).split('\r\n')[0];
assert(header.includes('"Owner Response Date"') && header.includes('"Review ID"'));
pass('CSV includes owner response date and review ID columns');

const summary = scraper.summarizeReviews([
  { rating: 5, ownerResponse: 'Thanks', reviewText: 'Great' },
  { rating: 4, ownerResponse: '', reviewText: '' },
  { rating: 1, ownerResponse: '', reviewText: 'Bad' },
  { rating: 2, ownerResponse: 'Sorry', reviewText: 'Meh' }
]);
assert.strictEqual(summary.total, 4);
assert.strictEqual(summary.average, 3);
assert.deepStrictEqual({ ...summary.distribution }, { 1: 1, 2: 1, 3: 0, 4: 1, 5: 1 });
assert.strictEqual(summary.replyRate, 50);
assert.strictEqual(summary.lowUnanswered, 1, 'only the 1-star without a reply counts');
assert.strictEqual(summary.withText, 3);
pass('Review summary: average, distribution, reply rate, unanswered low ratings');

// --- Pagination: simulate Google's rule (next page only when a trusted wheel moves the list
// into its last ~300px) and check the scraper collects every review, not just the first page.
(async () => {
  const doc = window.document;
  const list = doc.querySelector('.OG9A1');
  const sc = doc.querySelector('.RVCQse');
  sc.style.overflowY = 'auto';
  const total = 59;
  const cardHeight = 413; // ~4134px per 10 reviews, as measured live
  const max = () => list.children.length * cardHeight - 378;
  let top = 0;
  Object.defineProperty(sc, 'scrollHeight', { get: () => list.children.length * cardHeight });
  Object.defineProperty(sc, 'clientHeight', { get: () => 378 });
  Object.defineProperty(sc, 'scrollTop', { get: () => top, set: (v) => { top = Math.max(0, Math.min(max(), v)); } });
  sc.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 378 });

  // Start with page 1 (10 cards) built from the real card markup.
  list.innerHTML = '';
  const addCards = (n) => {
    const start = list.children.length;
    for (let i = start; i < Math.min(total, start + n); i++) {
      list.insertAdjacentHTML('beforeend', card.replace(/review-1/g, `review-${i + 1}`).replace('Reviewer 1', `Reviewer ${i + 1}`));
    }
  };
  addCards(10);

  scraper.trustedScroll = async (container) => {
    const before = container.scrollTop;
    container.scrollTop = before + 900;
    const moved = container.scrollTop !== before;
    if (moved && max() - container.scrollTop <= 300) setTimeout(() => addCards(10), 300);
    return true;
  };
  let exported = null;
  window.SphereGmb.utils.sendMessage = async () => ({});
  window.SphereGmb.utils.downloadFile = (name, csv) => { exported = csv; };

  await scraper.startExport({ name: 'Sample Business', numReviews: total });
  const rows = exported ? exported.slice(1).split('\r\n').length - 1 : 0;
  assert.strictEqual(rows, total, `exported ${rows} of ${total} reviews`);
  pass(`Pagination: all ${total} reviews collected (old loop stopped after the first pages)`);

  console.log(`\nReview dialog tests passed (${passed}).`);
})().catch((err) => {
  console.error('  [FAIL]', err.message);
  process.exit(1);
});
