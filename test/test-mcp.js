/**
 * GBP Sphere MCP server: protocol and tool tests, offline. fetch() is replaced by a stub that
 * serves the anonymised place fixture, so nothing here talks to Google.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/place-preview-tacombi.json'), 'utf8');
const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  if (/\/maps\/preview\/place/.test(url)) return { ok: true, status: 200, url: String(url), text: async () => `)]}'\n${fixture}` };
  return { ok: true, status: 200, url: String(url), text: async () => ")]}'\n[]" };
};

const { handle, toolList } = require('../mcp/server.js');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const rpc = (id, method, params) => handle({ jsonrpc: '2.0', id, method, params });
const callText = async (name, args) => {
  const r = await rpc(9, 'tools/call', { name, arguments: args });
  return { isError: Boolean(r.result.isError), text: r.result.content[0].text };
};

test('initialize: negotiates the protocol version and lists tools capability', async () => {
  const r = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.strictEqual(r.result.protocolVersion, '2025-03-26');
  assert.strictEqual(r.result.serverInfo.name, 'gbp-sphere');
  assert(r.result.capabilities.tools);
  const future = await rpc(2, 'initialize', { protocolVersion: '2099-01-01' });
  assert.strictEqual(future.result.protocolVersion, '2025-06-18');
});

test('notifications get no reply; unknown methods and tools are JSON-RPC errors', async () => {
  assert.strictEqual(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.strictEqual((await rpc(3, 'nope/nope')).error.code, -32601);
  assert.strictEqual((await rpc(4, 'tools/call', { name: 'nope' })).error.code, -32602);
  assert.strictEqual((await handle({ id: 5 })).error.code, -32600);
});

test('tools/list: every tool has a description, an object schema and annotations', async () => {
  const { tools } = (await rpc(6, 'tools/list')).result;
  assert(tools.length >= 9);
  for (const t of tools) {
    assert(/^gbp_[a-z_]+$/.test(t.name), t.name);
    assert(t.description.length > 40, `${t.name} description`);
    assert.strictEqual(t.inputSchema.type, 'object');
    assert(t.annotations && typeof t.annotations.readOnlyHint === 'boolean');
    for (const req of t.inputSchema.required || []) assert(t.inputSchema.properties[req], `${t.name}.${req}`);
  }
  assert.strictEqual(toolList().find((t) => t.name === 'gbp_audit_excel').annotations.readOnlyHint, false);
});

test('gbp_decode_id: feature ID and CID both ways, no network', async () => {
  const before = requests.length;
  const r = JSON.parse((await callText('gbp_decode_id', { input: 'https://www.google.com/maps/place/X/data=!4m10!1m2!2m1!1sdentist!3m6!1s0x1:0x2!8m2!3d1!4d2!1s0x89c259af12345678:0x1b2c3d4e5f6a7b8c' })).text);
  assert.strictEqual(r.featureId, '0x89c259af12345678:0x1b2c3d4e5f6a7b8c');
  assert.strictEqual(r.cid, '1958007344816880524');
  const c = JSON.parse((await callText('gbp_decode_id', { input: 'https://maps.google.com/?cid=1958007344816880524' })).text);
  assert.strictEqual(c.cid, '1958007344816880524');
  assert.strictEqual(c.featureId, null);
  assert.strictEqual(requests.length, before);
});

test('gbp_profile and gbp_audit: a CID is resolved through the place request', async () => {
  const p = JSON.parse((await callText('gbp_profile', { place: '1958007344816880524' })).text);
  assert.strictEqual(p.matchedBy, 'id');
  assert.strictEqual(p.profile.name, 'Tacombi');
  assert(!('profileLoaded' in p.profile));
  assert(requests.some((u) => u.includes('/maps/preview/place') && u.includes(encodeURIComponent('0x0:0x1b2c3d4e5f6a7b8c'))));
  const a = JSON.parse((await callText('gbp_audit', { place: '1958007344816880524', compare: false })).text);
  assert(a.score > 0 && a.score <= 100);
  assert(['Strong', 'Needs work', 'Weak'].includes(a.grade));
  assert(a.checks.length >= 12 && a.checks.every((c) => ['pass', 'warn', 'fail', 'unknown'].includes(c.status)));
  assert(Array.isArray(a.fixes));
});

test('gbp_audit_excel: writes a real .xlsx (zip) into the chosen folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbp-mcp-test-'));
  try {
    const r = JSON.parse((await callText('gbp_audit_excel', { place: '1958007344816880524', audits: ['initial'], output_dir: dir })).text);
    assert(r.file.startsWith(dir) && r.file.endsWith('.xlsx'));
    const bytes = fs.readFileSync(r.file);
    assert.strictEqual(bytes.slice(0, 2).toString(), 'PK');
    assert.strictEqual(r.sheets.length, 1);
    assert(r.sheets[0].pass + r.sheets[0].fail > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tool errors come back as isError results with a plain message', async () => {
  const missing = await callText('gbp_audit', {});
  assert(missing.isError && /Missing "place"/.test(missing.text));
  const none = await callText('gbp_profile', { place: 'no such business anywhere' });
  assert(none.isError && /found no business/.test(none.text));
});

test('only Google and the category list hosts are ever contacted', () => {
  for (const u of requests) assert(/^https:\/\/(www\.google\.com|raw\.githubusercontent\.com)\//.test(u), u);
});

(async () => {
  console.log('--- GBP Sphere MCP server (offline) ---');
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  [PASS] ${t.name}`);
    } catch (err) {
      console.error(`  [FAIL] ${t.name}\n    ${err && err.stack}`);
      process.exitCode = 1;
    }
  }
  console.log(`MCP tests passed (${passed}/${tests.length}).`);
})();
