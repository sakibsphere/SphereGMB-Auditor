/**
 * Generate GBP Sphere icons using Playwright and SVG in Amethyst Palette
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SIZES = [16, 32, 48, 64, 128];
const ICONS_DIR = path.resolve(__dirname, '../assets/icons');

function getSvg(size) {
  const strokeWidth = size <= 32 ? Math.max(1.5, size * 0.08) : size * 0.07;
  const radius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  const r1 = size * 0.28;
  const r2 = size * 0.12;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#250A33" stroke="#6C2296" stroke-width="${Math.max(1, size * 0.04)}"/>
      <circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="#9838CE" stroke-width="${strokeWidth}"/>
      <circle cx="${cx}" cy="${cy}" r="${r2}" fill="#F3E4FB"/>
      <circle cx="${cx + r1 * 0.7}" cy="${cy - r1 * 0.7}" r="${Math.max(1.5, size * 0.06)}" fill="#BB74E2"/>
    </svg>
  `;
}

async function generate() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1
    });

    const svg = getSvg(size);
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            * { margin: 0; padding: 0; }
            body { background: transparent; overflow: hidden; }
          </style>
        </head>
        <body>${svg}</body>
      </html>
    `);

    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    await page.screenshot({ path: outPath, omitBackground: true });
    console.log(`[Icon] Generated ${size}x${size} -> ${outPath}`);
    await page.close();
  }

  await browser.close();
  console.log('[Icon Generation Complete]');
}

generate().catch(console.error);
