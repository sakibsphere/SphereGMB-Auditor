/**
 * Builds dist/sphere-gmb-v<version>.zip with only the files Chrome needs.
 * Dependency-free zip writer (deflate via zlib) so `npm run package` works on any OS.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'background', 'content', 'lib', 'pages', 'popup', 'assets'];
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const out = path.join(ROOT, 'dist', `sphere-gmb-v${version}.zip`);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function collect(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel}`);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((name) => collect(path.join(rel, name)));
}

const files = INCLUDE.flatMap(collect).map((f) => f.split(path.sep).join('/')).sort();

/**
 * Every file the extension loads must be in the zip: manifest scripts, styles and icons, the
 * service worker's importScripts, and local src/href in the popup and extension pages.
 * (A missing folder here once would have shipped a zip without the report pages.)
 */
function referencedFiles() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const refs = new Set([m.background.service_worker, m.action.default_popup, ...Object.values(m.icons), ...Object.values(m.action.default_icon || {})]);
  m.content_scripts.forEach((c) => [...(c.js || []), ...(c.css || [])].forEach((f) => refs.add(f)));
  const sw = fs.readFileSync(path.join(ROOT, m.background.service_worker), 'utf8');
  for (const [, list] of sw.matchAll(/importScripts\(([^)]*)\)/g)) {
    for (const [, rel] of list.matchAll(/'([^']+)'/g)) refs.add(path.posix.join(path.posix.dirname(m.background.service_worker), rel));
  }
  const pages = [m.action.default_popup, ...fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => `pages/${f}`)];
  for (const page of pages) {
    refs.add(page);
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const [, rel] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) refs.add(path.posix.join(path.posix.dirname(page), rel));
  }
  return Array.from(refs).map((r) => path.posix.normalize(r));
}
const missing = referencedFiles().filter((r) => !files.includes(r));
if (missing.length) {
  console.error(`Package is missing files the extension loads:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
const locals = [];
const centrals = [];
let offset = 0;

for (const name of files) {
  const data = fs.readFileSync(path.join(ROOT, name));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + packed.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`Wrote ${path.relative(ROOT, out)} (${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
