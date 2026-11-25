/**
 * SphereGMB: minimal .xlsx writer (no library, no network).
 *
 * buildXlsx(sheets) returns a Uint8Array of a real Excel workbook. Each sheet:
 *   { name, cols: [widths], rows: [{ height, cells: [{ v, s }] }], merges: ['A1:G1'],
 *     freeze: { xSplit, ySplit }, validations: [{ sqref, list: ['Pass', 'Fail'] }] }
 * `s` is a style key from STYLES below. Styles copy the agency audit template: Roboto,
 * dark purple (#351C75) title and section bands, lavender (#B4A7D6) header row, light grey
 * (#F3F3F3) and white rows with thin borders, no gridlines.
 *
 * Files are stored without compression (valid zip, method 0), which keeps the writer tiny.
 */

(function (root) {
  'use strict';

  const PURPLE = 'FF351C75';
  const LAVENDER = 'FFB4A7D6';
  const GREY = 'FFF3F3F3';
  const WHITE = 'FFFFFFFF';

  // Fonts: [bold, size, colour]
  const FONTS = [
    [false, 10, 'FF000000'], // 0 default
    [true, 14, 'FFFFFFFF'], // 1 title
    [true, 13, 'FFFFFFFF'], // 2 title 13
    [true, 12, 'FFFFFFFF'], // 3 white 12
    [true, 12, 'FF000000'], // 4 header 12
    [true, 11, 'FF000000'], // 5 header 11 / label 11
    [true, 11, 'FFFFFFFF'], // 6 section
    [true, 10, 'FF000000'], // 7 label 10
    [false, 10, 'FF1F1F1F'], // 8 value
    [true, 10, 'FF1E7B4F'], // 9 pass
    [true, 10, 'FFB4234A'], // 10 fail
    [false, 10, 'FF5F5468'] // 11 muted value
  ];
  const FILLS = ['none', 'gray125', PURPLE, LAVENDER, GREY, WHITE];

  // Style key -> [fontIndex, fillIndex, border(0 none | 1 thin all | 2 thin left/top/bottom), horizontal, wrap]
  const STYLE_DEFS = {
    default: [0, 0, 0, 'general', false],
    title: [1, 2, 0, 'center', false],
    title13: [2, 2, 2, 'center', false],
    colTitle: [3, 2, 1, 'center', true],
    colTitleLeft: [3, 2, 1, 'left', true],
    header: [4, 3, 1, 'center', true],
    header11: [5, 3, 1, 'center', true],
    band: [5, 3, 1, 'left', true],
    section: [6, 2, 2, 'left', false],
    labelGrey: [5, 4, 1, 'left', true],
    labelWhite: [5, 5, 1, 'left', true],
    labelGrey10: [7, 4, 1, 'left', true],
    labelWhite10: [7, 5, 1, 'left', true],
    cellGrey: [8, 4, 1, 'left', true],
    cellWhite: [8, 5, 1, 'left', true],
    mutedGrey: [11, 4, 1, 'left', true],
    mutedWhite: [11, 5, 1, 'left', true],
    centerGrey: [8, 4, 1, 'center', true],
    centerWhite: [8, 5, 1, 'center', true],
    passGrey: [9, 4, 1, 'center', true],
    passWhite: [9, 5, 1, 'center', true],
    failGrey: [10, 4, 1, 'center', true],
    failWhite: [10, 5, 1, 'center', true]
  };
  const STYLE_KEYS = Object.keys(STYLE_DEFS);

  function xml(v) {
    return String(v === null || v === undefined ? '' : v)
      // XML 1.0 forbids these control characters; page text sometimes contains them.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  function stylesXml() {
    const fonts = FONTS.map(([b, sz, rgb]) => `<font>${b ? '<b/>' : ''}<sz val="${sz}"/><color rgb="${rgb}"/><name val="Roboto"/></font>`).join('');
    const fills = FILLS.map((f) => (f === 'none' || f === 'gray125' ? `<fill><patternFill patternType="${f}"/></fill>` : `<fill><patternFill patternType="solid"><fgColor rgb="${f}"/><bgColor indexed="64"/></patternFill></fill>`)).join('');
    const thin = '<color rgb="FF000000"/>';
    const borders = [
      '<border><left/><right/><top/><bottom/><diagonal/></border>',
      `<border><left style="thin">${thin}</left><right style="thin">${thin}</right><top style="thin">${thin}</top><bottom style="thin">${thin}</bottom><diagonal/></border>`,
      `<border><left style="thin">${thin}</left><right/><top style="thin">${thin}</top><bottom style="thin">${thin}</bottom><diagonal/></border>`
    ].join('');
    const xfs = STYLE_KEYS.map((k) => {
      const [font, fill, border, horizontal, wrap] = STYLE_DEFS[k];
      return `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${horizontal}" vertical="center"${wrap ? ' wrapText="1"' : ''}/></xf>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${FONTS.length}">${fonts}</fonts><fills count="${FILLS.length}">${fills}</fills><borders count="3">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${STYLE_KEYS.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  function sheetXml(sheet) {
    const cols = (sheet.cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    let pane = '';
    if (sheet.freeze && (sheet.freeze.xSplit || sheet.freeze.ySplit)) {
      const x = sheet.freeze.xSplit || 0;
      const y = sheet.freeze.ySplit || 0;
      const active = x && y ? 'bottomRight' : y ? 'bottomLeft' : 'topRight';
      pane = `<pane${x ? ` xSplit="${x}"` : ''}${y ? ` ySplit="${y}"` : ''} topLeftCell="${colName(x)}${y + 1}" activePane="${active}" state="frozen"/>`;
    }
    const rows = (sheet.rows || []).map((row, r) => {
      const cells = (row.cells || []).map((c, ci) => {
        if (c === null || c === undefined) return '';
        const ref = `${colName(ci)}${r + 1}`;
        const s = Math.max(0, STYLE_KEYS.indexOf(c.s || 'default'));
        if (c.v === null || c.v === undefined || c.v === '') return `<c r="${ref}" s="${s}"/>`;
        if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
        return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}"${row.height ? ` ht="${row.height}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    const dv = (sheet.validations || []).length
      ? `<dataValidations count="${sheet.validations.length}">${sheet.validations.map((v) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>"${xml(v.list.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData>${merges}${dv}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
  }

  /** Excel sheet names: max 31 chars, no []:*?/\ */
  function safeSheetName(name, used) {
    let base = String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let n = 2;
    let out = base;
    while (used.has(out.toLowerCase())) out = `${base.slice(0, 28)} ${n++}`;
    used.add(out.toLowerCase());
    return out;
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Stored (uncompressed) zip of [{ name, data: Uint8Array }]. */
  function zip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, f.data.length, true);
      local.setUint32(22, f.data.length, true);
      local.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(local.buffer), name, f.data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, f.data.length, true);
      cen.setUint32(24, f.data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + f.data.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
    let p = 0;
    for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }

  function buildXlsx(sheets) {
    const enc = new TextEncoder();
    const used = new Set();
    const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }));
    const files = [
      { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${named.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', text: stylesXml() },
      ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) }))
    ];
    return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
  }

  const api = { buildXlsx, colName, STYLE_KEYS, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SphereGmbXlsx = api;
})(typeof self !== 'undefined' ? self : globalThis);
