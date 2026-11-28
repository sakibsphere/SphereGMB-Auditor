/**
 * Syntax-checks every shipped script and validates manifest references.
 * The extension is plain JavaScript (no TypeScript build), so this is the "type-check" gate:
 * it catches parse errors and missing files before Chrome does.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = new Set([
  manifest.background.service_worker,
  ...fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.js')).map((f) => `pages/${f}`),
  'popup/popup.js',
  'mcp/core.js',
  'mcp/server.js',
  ...manifest.content_scripts.flatMap((c) => c.js)
]);

let failed = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`missing: ${rel}`);
    failed++;
    continue;
  }
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
  } catch (err) {
    console.error(`syntax error in ${rel}:\n${err.stderr}`);
    failed++;
  }
}

// Every local src/href in the popup and the extension pages must exist.
const htmlPages = [manifest.action.default_popup, ...fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => `pages/${f}`)];
for (const page of htmlPages) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const ref of html.match(/(?:src|href)="([^"#:]+)"/g) || []) {
    const target = ref.replace(/^(?:src|href)="|"$/g, '');
    if (!fs.existsSync(path.join(ROOT, path.dirname(page), target))) {
      console.error(`${page} references missing file: ${target}`);
      failed++;
    }
  }
}

if (failed) {
  console.error(`\n${failed} problem(s) found.`);
  process.exit(1);
}
console.log(`Syntax OK for ${files.size} scripts; manifest, popup and page references resolve.`);
