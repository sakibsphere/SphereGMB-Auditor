#!/usr/bin/env node
/**
 * GBP Sphere MCP server: lets Claude, ChatGPT (Codex), Cursor, VS Code, Gemini CLI or any
 * MCP client audit Google Business Profiles on their own. No dependencies, no API key.
 *
 *   node mcp/server.js                 MCP over stdio (what AI apps start for you)
 *   node mcp/server.js --http [port]   MCP over HTTP at http://127.0.0.1:<port>/mcp plus a
 *                                      plain JSON API at /api/<tool> (default port 8765)
 *
 * The HTTP server listens on 127.0.0.1 only and refuses requests from web pages (Origin
 * check), so a website you visit cannot use it.
 */

'use strict';

const http = require('http');
const core = require('./core.js');

const SERVER_INFO = { name: 'gbp-sphere', title: 'GBP Sphere', version: core.VERSION };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = [
  'GBP Sphere reads public Google Business Profile data from Google Maps (no API key) and audits it.',
  'Start with gbp_audit for "audit / review / score this profile", gbp_profile for raw details, gbp_search to find businesses,',
  'gbp_competitors or gbp_maps_rank for local rankings, gbp_categories for category research and gbp_audit_excel for the agency workbook.',
  'Every tool accepts a Google Maps link, a share link, a CID or plain "name + city" as the business.',
  'When a result has "alternatives", the first Maps match was used: say which business you audited.'
].join(' ');

function toolList() {
  return core.TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.writes, destructiveHint: false, idempotentHint: !t.writes, openWorldHint: t.name !== 'gbp_decode_id' }
  }));
}

async function runTool(name, args) {
  try {
    const result = await core.callTool(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] };
  } catch (err) {
    const msg = err instanceof core.ToolError ? err.message : `Something went wrong: ${err && err.message}`;
    if (!(err instanceof core.ToolError)) process.stderr.write(`[gbp-sphere] ${name} failed: ${err && err.stack}\n`);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

/** Handles one JSON-RPC message. Returns the response object, or null for notifications. */
async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid request' } };
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } });
  const params = msg.params || {};

  switch (msg.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: toolList() });
    case 'tools/call': {
      if (!core.TOOLS.some((t) => t.name === params.name)) return fail(-32602, `Unknown tool: ${params.name}`);
      return reply(await runTool(params.name, params.arguments || {}));
    }
    case 'resources/list':
      return reply({ resources: [] });
    case 'prompts/list':
      return reply({ prompts: [] });
    default:
      if (msg.method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// ---------------------------------------------------------------- stdio transport

function startStdio() {
  let buffer = '';
  const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  const onLine = async (raw) => {
    // Some shells put a byte-order mark in front of piped text.
    const line = raw.replace(/^\uFEFF/, '');
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    const out = (await Promise.all(batch.map(handle))).filter(Boolean);
    if (out.length) send(Array.isArray(msg) ? out : out[0]);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      onLine(line).catch((err) => process.stderr.write(`[gbp-sphere] ${err && err.stack}\n`));
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stderr.write(`[gbp-sphere] MCP server v${core.VERSION} ready on stdio\n`);
}

// ---------------------------------------------------------------- HTTP transport

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function json(res, status, body, extra = {}) {
  const text = JSON.stringify(body, null, 1);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}

function readBody(req, limit = 1000000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Query-string values as tool arguments: numbers, booleans and comma lists where the schema says so. */
function argsFromQuery(tool, params) {
  const out = {};
  const props = tool.inputSchema.properties || {};
  for (const [k, v] of params) {
    const type = props[k] && props[k].type;
    if (type === 'number' || type === 'integer') out[k] = Number(v);
    else if (type === 'boolean') out[k] = !/^(0|false|no)$/i.test(v);
    else if (type === 'array') out[k] = v.split(',').map((s) => s.trim()).filter(Boolean);
    else out[k] = v;
  }
  return out;
}

function openApi(port) {
  return {
    openapi: '3.1.0',
    info: { title: 'GBP Sphere local API', version: core.VERSION, description: 'Google Business Profile data, audits and local rankings. Runs on this computer.' },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    paths: Object.fromEntries(core.TOOLS.map((t) => [`/api/${t.name}`, {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        requestBody: { required: true, content: { 'application/json': { schema: t.inputSchema } } },
        responses: { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    }]))
  };
}

function startHttp(port) {
  const server = http.createServer(async (req, res) => {
    // Browsers send Origin on cross-site requests: refuse anything that is not this computer.
    const origin = req.headers.origin;
    if (origin && !LOCAL_ORIGIN.test(origin)) return json(res, 403, { error: 'Requests from web pages are not allowed.' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/mcp') {
        if (req.method === 'GET') return json(res, 405, { error: 'This server answers POST requests with JSON (no event stream).' }, { Allow: 'POST' });
        if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' }, { Allow: 'POST' });
        let msg;
        try { msg = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
        const batch = Array.isArray(msg) ? msg : [msg];
        const out = (await Promise.all(batch.map(handle))).filter(Boolean);
        if (!out.length) { res.writeHead(202); return res.end(); }
        return json(res, 200, Array.isArray(msg) ? out : out[0]);
      }
      if (url.pathname === '/' || url.pathname === '/api') {
        return json(res, 200, {
          name: 'GBP Sphere local API', version: core.VERSION,
          mcp: `http://127.0.0.1:${port}/mcp`, openapi: `http://127.0.0.1:${port}/openapi.json`,
          tools: core.TOOLS.map((t) => ({ name: t.name, endpoint: `/api/${t.name}`, description: t.description, params: t.inputSchema.properties, required: t.inputSchema.required || [] })),
          example: `http://127.0.0.1:${port}/api/gbp_audit?place=${encodeURIComponent('Tacombi Flatiron New York')}`
        });
      }
      if (url.pathname === '/openapi.json') return json(res, 200, openApi(port));
      const m = url.pathname.match(/^\/api\/([a-z_]+)$/);
      if (m) {
        const tool = core.TOOLS.find((t) => t.name === m[1]);
        if (!tool) return json(res, 404, { error: `Unknown tool: ${m[1]}` });
        let args;
        if (req.method === 'POST') {
          try { args = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return json(res, 400, { error: 'The body must be JSON.' }); }
        } else if (req.method === 'GET') {
          args = argsFromQuery(tool, url.searchParams);
        } else {
          return json(res, 405, { error: 'Use GET or POST' }, { Allow: 'GET, POST' });
        }
        try {
          return json(res, 200, await core.callTool(tool.name, args));
        } catch (err) {
          const known = err instanceof core.ToolError;
          if (!known) process.stderr.write(`[gbp-sphere] ${tool.name} failed: ${err && err.stack}\n`);
          return json(res, known ? 400 : 500, { error: known ? err.message : 'Something went wrong.' });
        }
      }
      return json(res, 404, { error: 'Not found. Try / for the list of tools.' });
    } catch (err) {
      process.stderr.write(`[gbp-sphere] ${err && err.stack}\n`);
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong.' });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`[gbp-sphere] v${core.VERSION} listening on http://127.0.0.1:${port}  (MCP: /mcp, API: /api/<tool>, list: /)\n`);
  });
  return server;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('GBP Sphere MCP server\n\n  node mcp/server.js               MCP over stdio\n  node mcp/server.js --http [port]  MCP at /mcp and JSON API at /api/<tool> on 127.0.0.1 (default 8765)\n');
  } else if (argv.includes('--http')) {
    const next = argv[argv.indexOf('--http') + 1];
    const port = Number(next) > 0 ? Number(next) : Number(process.env.GBP_SPHERE_PORT) || 8765;
    startHttp(port);
  } else {
    startStdio();
  }
}

module.exports = { handle, startHttp, toolList };
