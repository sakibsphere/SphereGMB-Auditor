/**
 * SphereGMB: DOM Integration Test
 * Simulates Google Search knowledge panel, Maps place panel and reviews dialog DOM,
 * verifies category chip rendering and 2-tier action buttons functionality.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Simple DOM environment simulation
class MockElement {
  constructor(tag, className = '') {
    this.tagName = tag.toUpperCase();
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.eventListeners = {};
    this._textContent = '';
    this._innerHTML = '';
  }

  get id() {
    return this.attributes['id'] || this._id || '';
  }

  set id(val) {
    this.attributes['id'] = val;
    this._id = val;
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join(' ');
  }

  set textContent(val) {
    this._textContent = val;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = val;
    this._textContent = val.replace(/<[^>]+>/g, '');
    // parse basic tags for children lookup
    if (val.includes('sgmb-categories-line')) {
      const line = new MockElement('div', 'sgmb-categories-line');
      const chips = new MockElement('span', 'sgmb-chips-container');
      line.appendChild(chips);
      this.appendChild(line);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(node) {
    let cur = node;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx > 0 ? this.parentElement.children[idx - 1] : null;
  }

  append(...nodes) {
    nodes.forEach((n) => this.appendChild(n));
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  insertAdjacentElement(position, element) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const idx = parent.children.indexOf(this);
    if (position === 'afterend') {
      if (idx !== -1) {
        parent.children.splice(idx + 1, 0, element);
        element.parentElement = parent;
      } else {
        parent.appendChild(element);
      }
    } else if (position === 'beforebegin') {
      if (idx !== -1) {
        parent.children.splice(idx, 0, element);
        element.parentElement = parent;
      }
    }
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  insertBefore(newNode, refNode) {
    const idx = this.children.indexOf(refNode);
    if (idx !== -1) {
      this.children.splice(idx, 0, newNode);
      newNode.parentElement = this;
    } else {
      this.appendChild(newNode);
    }
    return newNode;
  }

  matches(selector) {
    if (!selector) return false;
    selector = selector.trim();
    if (selector.includes(',')) {
      return selector.split(',').some((part) => this.matches(part));
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return (this.className || '').split(/\s+/).includes(cls);
    }
    if (selector.startsWith('#')) {
      return this.attributes['id'] === selector.slice(1);
    }
    if (selector.includes('[')) {
      const idx = selector.indexOf('[');
      if (idx > 0) {
        const tag = selector.slice(0, idx);
        if (this.tagName !== tag.toUpperCase()) return false;
        selector = selector.slice(idx);
      }
      const attrBlocks = selector.match(/\[[^\]]+\]/g) || [];
      for (const block of attrBlocks) {
        const content = block.slice(1, -1);
        if (content.includes('^=')) {
          const [k, v] = content.split('^=').map(s => s.replace(/["']/g, ''));
          const val = this.getAttribute(k) || '';
          if (!val.toLowerCase().startsWith(v.toLowerCase())) return false;
        } else if (content.includes('*=')) {
          const [k, v] = content.split('*=').map(s => s.replace(/["']/g, ''));
          const val = this.getAttribute(k) || '';
          if (!val.toLowerCase().includes(v.toLowerCase())) return false;
        } else if (content.includes('=')) {
          const [k, v] = content.split('=').map(s => s.replace(/["']/g, ''));
          if (this.getAttribute(k) !== v) return false;
        } else {
          if (!this.hasAttribute(content)) return false;
        }
      }
      return true;
    }
    if (selector.includes('.')) {
      const idx = selector.indexOf('.');
      const tag = selector.slice(0, idx);
      const cls = selector.slice(idx + 1);
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      return (this.className || '').split(/\s+/).includes(cls);
    }
    return this.tagName === selector.toUpperCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (!selector) return [];
    selector = selector.trim();

    if (selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim());
      const all = [];
      for (const part of parts) {
        const res = this.querySelectorAll(part);
        for (const item of res) {
          if (!all.includes(item)) all.push(item);
        }
      }
      return all;
    }

    if (selector.includes(' ')) {
      const [parentSel, ...childParts] = selector.split(/\s+/);
      const childSel = childParts.join(' ');
      const parents = this.querySelectorAll(parentSel);
      const allChildren = [];
      for (const p of parents) {
        const found = p.querySelectorAll(childSel);
        for (const f of found) {
          if (!allChildren.includes(f)) allChildren.push(f);
        }
      }
      return allChildren;
    }

    const results = [];
    const check = (el) => {
      if (el.matches(selector)) results.push(el);
      for (const child of el.children) {
        check(child);
      }
    };

    for (const child of this.children) {
      check(child);
    }
    return results;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches(selector)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  addEventListener(event, handler) {
    this.eventListeners[event] = this.eventListeners[event] || [];
    this.eventListeners[event].push(handler);
  }

  click() {
    const handlers = this.eventListeners['click'] || [];
    for (const h of handlers) {
      h({
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {}
      });
    }
  }
}

// Setup global mock window and document
const tick = () => new Promise((r) => setTimeout(r, 0));
global.window = { location: { href: 'https://www.google.com/search?q=Northside+Insurance+Agency', pathname: '/search', hostname: 'www.google.com', hash: '' } };
global.document = new MockElement('document');
global.document.body = new MockElement('body');
global.document.appendChild(global.document.body);
global.document.createElement = (tag) => new MockElement(tag);
global.document.getElementById = (id) => global.document.querySelector(`#${id}`);
global.document.title = 'Northside Insurance Agency - Google Search';
global.Blob = class {};
global.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };

let sentMessages = [];
global.chrome = {
  runtime: {
    id: 'test-extension',
    lastError: undefined,
    sendMessage(msg, cb) {
      sentMessages.push(msg);
      if (typeof cb === 'function') cb({ categories: [] });
    }
  }
};

const modules = [
  'utils.js', 'cid-parser.js', 'api.js', 'category-ui.js', 'audit-modal.js', 'audit-engine.js',
  'csv-exporter.js', 'post-audit.js', 'photo-audit.js', 'review-scraper.js',
  'action-buttons.js', 'paa.js', 'dom-serp.js', 'dom-maps.js'
];
for (const mod of modules) {
  eval(fs.readFileSync(path.join(__dirname, '../content/modules', mod), 'utf8'));
}
const ns = window.SphereGmb;

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`  [PASS] ${msg}`);
}

console.log('--- SphereGMB DOM integration (Google Search knowledge panel) ---');

// Knowledge panel mock: #rhs > title, subtitle, address
const kp = new MockElement('div', 'kp-header');
kp.id = 'rhs';
const titleWrap = new MockElement('div', 'SPZz6b');
const h2 = new MockElement('h2');
h2.setAttribute('data-attrid', 'title');
h2.textContent = 'Northside Insurance Agency';
titleWrap.appendChild(h2);
kp.appendChild(titleWrap);
const subtitle = new MockElement('div', 'nwVKo');
subtitle.setAttribute('data-attrid', 'subtitle');
subtitle.textContent = '5.0 · 57 reviews · Health insurance agency in Dallas, TX';
kp.appendChild(subtitle);
const addrBlock = new MockElement('div');
addrBlock.setAttribute('data-attrid', 'kc:/location/location:address');
const addr = new MockElement('span', 'LrzXr');
addr.textContent = '100 Main St, Dallas, TX 75201';
addrBlock.appendChild(addr);
kp.appendChild(addrBlock);
global.document.body.appendChild(kp);

(async () => {
  const cats = ns.domSerp.extractCategoriesFromSerpDOM(kp);
  assert.deepStrictEqual(cats, ['Health insurance agency']);
  pass('Primary category read from the SERP subtitle');

  // An entity panel without business signals must be ignored.
  const entity = new MockElement('div');
  assert.strictEqual(entity.querySelector('span.LrzXr'), null);
  assert(ns.domSerp.findKpRoot() === kp, 'business KP should be detected');
  pass('Knowledge panel with a local-business signal is detected');

  await ns.domSerp.processKp();
  const container = kp.querySelector('.sgmb-categories-container');
  assert(container, 'widget must be mounted in the KP');
  assert.strictEqual(container._businessData.address, '100 Main St, Dallas, TX 75201');
  pass('Widget mounted in the KP with address captured');

  await ns.domSerp.processKp();
  assert.strictEqual(kp.querySelectorAll('.sgmb-categories-container').length, 1);
  pass('Repeated scans do not duplicate the widget');

  const row1 = container.querySelector('.sgmb-btn-row-1');
  const row2 = container.querySelector('.sgmb-btn-row-2');
  assert.deepStrictEqual(row1.children.map((b) => b.textContent), ['Export', 'Post Audit', 'Photo Audit', 'Review Audit']);
  assert.deepStrictEqual(row2.children.map((b) => b.textContent), ['Dashboard', 'SERP Checker']);
  pass('Two-row toolbar: Export, Post Audit, Photo Audit, Review Audit / Dashboard, SERP Checker');

  ns.categoryUI.hydrateCategories(container, {
    categories: ['Health insurance agency', 'Dental insurance agency', 'Life insurance agency'],
    categoriesSource: 'profile'
  });
  const chips = container.querySelector('.sgmb-chips-container').innerHTML;
  assert(chips.includes('Dental insurance agency') && chips.includes('Life insurance agency'));
  assert(chips.includes('sgmb-icon') && !chips.includes('⚡'), 'primary chip must use the SVG bolt, not an emoji');
  pass('Secondary categories rendered; primary marked with SVG icon');

  // Photo / Post audits open the in-page dialog only, no surprise extra tab.
  let photoShown = false;
  let postShown = false;
  ns.photoAudit.show = () => { photoShown = true; };
  ns.postAudit.show = () => { postShown = true; };
  sentMessages = [];
  row1.children[1].click();
  row1.children[2].click();
  await tick();
  assert(postShown && photoShown, 'audit dialogs should open');
  assert(!sentMessages.some((m) => m.type === 'runAuditPhoto' || m.type === 'runAuditPost'), 'no new tab may be opened by the toolbar');
  pass('Post/Photo Audit open in-page without spawning a tab');

  let reviewStarted = null;
  ns.reviewScraper.startExport = (data) => { reviewStarted = data; };
  row1.children[3].click();
  await tick();
  assert(reviewStarted && reviewStarted.query.includes('Northside Insurance Agency'));
  pass('Review Audit on Search scrapes in place');

  sentMessages = [];
  row2.children[0].click();
  await tick();
  const reportMsg = sentMessages.find((m) => m.type === 'openReport');
  assert(reportMsg, 'Dashboard asks the service worker to open the report page');
  const dashboardResult = reportMsg.payload.audit;
  assert(dashboardResult && Array.isArray(dashboardResult.checks) && typeof dashboardResult.score === 'number');
  assert.strictEqual(reportMsg.payload.data.name, 'Northside Insurance Agency');
  assert(!JSON.stringify(reportMsg.payload.data).includes('MockElement'), 'payload is plain data, no DOM nodes');
  pass('Dashboard opens the full report with a computed audit (score + checks)');

  sentMessages = [];
  row2.children[1].click();
  await tick();
  assert(sentMessages.some((m) => m.type === 'openRankPage' && m.payload.name === 'Northside Insurance Agency'));
  pass('SERP Checker opens the bulk rank check for this business');

  ns.categoryUI.hydrateCategories(container, { ...container._businessData, categories: ['Health insurance agency'], categoriesSource: 'profile' }, { final: true });
  assert(container.querySelector('.sgmb-find-more'), '"Find more" is offered next to the categories');
  pass('"Find more" link next to the categories');

  // Local pack row, 2026 markup: no data-cid; feature ID only in the Directions link;
  // details block is one child element per line.
  const packRow = new MockElement('div', 'VkpGBb');
  const packDetails = new MockElement('div', 'rllt__details');
  const packName = new MockElement('div', 'OSrXXb');
  packName.textContent = 'Westside Insurance Group';
  const packLine = new MockElement('div');
  packLine.textContent = '4.9(604) · Insurance agent';
  const packCity = new MockElement('div');
  packCity.textContent = 'Dallas, TX, United States';
  packDetails.append(packName, packLine, packCity);
  const dirLink = new MockElement('a', 'yYlJEf');
  dirLink.setAttribute('href', '/maps/dir//Westside+Insurance+Group/data=!4m6!4m5!1m1!4e2!1m2!1m1!1s0x864c27a2843fcff3:0x43e238de8d5a1530?sa=X');
  packRow.append(packDetails, dirLink);
  global.document.body.appendChild(packRow);
  await ns.domSerp.processLocalPack();
  const packWidget = packRow.querySelector('.sgmb-local-pack');
  assert(packWidget, 'local pack row gets a widget');
  assert.strictEqual(packWidget._businessData.featureId, '0x864c27a2843fcff3:0x43e238de8d5a1530', 'feature ID from the Directions link');
  assert.deepStrictEqual(packWidget._businessData.categories.slice(0, 1), ['Insurance agent']);
  await ns.domSerp.processLocalPack();
  assert.strictEqual(packRow.querySelectorAll('.sgmb-local-pack').length, 1);
  pass('Local pack row: feature ID from Directions link, category from its own line, no duplicate');

  console.log('\n--- Google Maps place panel ---');
  global.window.location = {
    href: 'https://www.google.com/maps/place/Northside+Insurance+Agency/data=!4m2!3m1!1s0x864c27f7f2d3d5ab:0x7a1b2c3d4e5f6071?hl=en',
    pathname: '/maps/place/Northside+Insurance+Agency/data=!4m2!3m1!1s0x864c27f7f2d3d5ab:0x7a1b2c3d4e5f6071',
    hostname: 'www.google.com',
    hash: ''
  };
  const main = new MockElement('div');
  main.setAttribute('role', 'main');
  const header = new MockElement('div', 'TIHn2');
  const tAiQdd = new MockElement('div', 'tAiQdd');
  const h1 = new MockElement('h1', 'DUwDvf');
  h1.textContent = 'Northside Insurance Agency';
  tAiQdd.appendChild(h1);
  header.appendChild(tAiQdd);
  main.appendChild(header);
  global.document.body.appendChild(main);

  await ns.domMaps.processMapsPlace();
  const mapsWidget = main.querySelector('.sgmb-maps-place');
  assert(mapsWidget, 'place widget must mount');
  assert.strictEqual(mapsWidget.parentElement, header, 'widget sits in the header column');
  assert.strictEqual(header.children[header.children.indexOf(tAiQdd) + 1], mapsWidget, 'widget is row 2, directly after .tAiQdd');
  assert.strictEqual(mapsWidget._businessData.featureId, '0x864c27f7f2d3d5ab:0x7a1b2c3d4e5f6071');
  pass('Maps widget mounted after .tAiQdd with feature ID from the URL');

  await ns.domMaps.processMapsPlace();
  assert.strictEqual(main.querySelectorAll('.sgmb-maps-place').length, 1);
  pass('Maps rescans keep a single place widget');

  h1.textContent = 'Southside Dental';
  global.window.location.href = 'https://www.google.com/maps/place/Southside+Dental/data=!4m2!3m1!1s0x864c27f7f2d3d5ab:0x1111111111111111';
  global.window.location.pathname = '/maps/place/Southside+Dental/data=!4m2!3m1!1s0x864c27f7f2d3d5ab:0x1111111111111111';
  await ns.domMaps.processMapsPlace();
  const swapped = main.querySelector('.sgmb-maps-place');
  assert.strictEqual(swapped._businessData.name, 'Southside Dental', 'navigating to another place must rebuild the widget');
  pass('Navigating to another place rebuilds the widget (no stale data)');

  sentMessages = [];
  swapped.querySelector('.sgmb-btn-row-1').children[3].click();
  await tick();
  const reviewMsg = sentMessages.find((m) => m.type === 'runAuditReview');
  assert(reviewMsg && reviewMsg.payload.query.includes('Southside Dental'));
  pass('Review Audit on Maps hands off to a Google Search tab');

  // Cards inside the place panel ("People also search for") must not get toolbars.
  const nearby = new MockElement('div', 'Nv2PK');
  nearby.setAttribute('role', 'article');
  main.appendChild(nearby);
  await ns.domMaps.processMapsSearch();
  assert.strictEqual(nearby.querySelector('.sgmb-categories-container'), null);
  pass('Nearby-place cards inside a place panel are left alone');

  // Results feed: card widget + "Export list" bar above the feed
  global.window.location = { href: 'https://www.google.com/maps/search/insurance+agency/@32.9,-96.8,14z', pathname: '/maps/search/insurance+agency/@32.9,-96.8,14z', hostname: 'www.google.com', hash: '' };
  const listPane = new MockElement('div');
  const feed = new MockElement('div');
  feed.setAttribute('role', 'feed');
  const feedCard = new MockElement('div', 'Nv2PK');
  feedCard.setAttribute('role', 'article');
  const feedName = new MockElement('div', 'qBF1Pd');
  feedName.textContent = 'Eastside Insurance';
  feedCard.appendChild(feedName);
  feed.appendChild(feedCard);
  listPane.appendChild(feed);
  global.document.body.appendChild(listPane);
  await ns.domMaps.processMapsSearch();
  assert(feedCard.querySelector('.sgmb-maps-card'), 'feed card gets a widget');
  const bar = listPane.querySelector('.sgmb-list-bar');
  assert(bar && listPane.children.indexOf(bar) === listPane.children.indexOf(feed) - 1, 'Export list bar sits directly above the feed');
  assert(bar.querySelector('.sgmb-list-label').textContent === 'Export list (1)');
  pass('Results feed shows an "Export list (1)" bar above the list');

  console.log('\n--- Google Search reviews dialog ---');
  global.window.location = { href: 'https://www.google.com/search?q=x', pathname: '/search', hostname: 'www.google.com', hash: '' };
  const dialog = new MockElement('div');
  dialog.setAttribute('role', 'dialog');
  const dialogHeader = new MockElement('div');
  const writeBtn = new MockElement('button');
  writeBtn.textContent = 'Write a review';
  dialogHeader.appendChild(writeBtn);
  const count = new MockElement('span');
  count.textContent = '5.0 57 reviews';
  dialogHeader.appendChild(count);
  dialog.appendChild(dialogHeader);
  const card = new MockElement('div', 'gws-localreviews__google-review');
  const author = new MockElement('div', 'TSUbDb');
  author.textContent = 'Rikki R.';
  card.appendChild(author);
  const body = new MockElement('div', 'wiI7pd');
  body.textContent = 'Fast, friendly service.';
  card.appendChild(body);
  dialog.appendChild(card);
  global.document.body.appendChild(dialog);

  const found = ns.reviewScraper.findReviewsModal();
  assert(found === dialog);
  assert(ns.reviewScraper.findReviewItems(found).length === 1);
  pass('Reviews dialog and review card detected');

  ns.reviewScraper.injectModalExportButton();
  const exportBtn = dialog.querySelector('#sgmb-modal-export-btn');
  assert(exportBtn && exportBtn.innerHTML.includes('(57)'));
  pass('Export button injected into the dialog with the review total');

  console.log(`\nAll DOM integration tests passed (${passed}).`);
})().catch((err) => {
  console.error('  [FAIL]', err.message);
  process.exit(1);
});
