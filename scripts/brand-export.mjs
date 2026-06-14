#!/usr/bin/env node
/**
 * Brand asset rasterizer: SVG master -> PNG size-set + favicon.ico
 *
 * Usage:
 *   node scripts/brand-export.mjs <input.svg> [outDir] [name]
 *   npm run brand:export -- docs/brand/assets/cz-mark.svg frontend/public/brand cz
 *
 *   # OG/social raster (non-square, 1200x630) from an outlined OG master:
 *   node scripts/brand-export.mjs og <input.svg> <output.png>
 *   npm run brand:export:og   (regenerates frontend/public/og-cycling-zone.png)
 *
 * Requires root devDependencies: sharp, png-to-ico.
 *
 * IMPORTANT: text in the input SVG MUST be converted to vector paths (outlines)
 * first. sharp's SVG backend (librsvg/resvg) does NOT load Google web fonts, so
 * live <text font-family="Bebas Neue"> would render as a system fallback or
 * blank. The master SVGs produced in #481 Phase 2 are outlined for this reason.
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const PNG_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];
const ICO_SIZES = [16, 32, 48];

export async function exportBrand(svgPath, outDir, name) {
  await mkdir(outDir, { recursive: true });
  const svg = await readFile(svgPath);
  const pngBuffers = {};
  for (const size of PNG_SIZES) {
    // Supersample: render the SVG larger than target, then downscale for crisp edges.
    const density = Math.max(72, size * 3);
    const buf = await sharp(svg, { density })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngBuffers[size] = buf;
    await writeFile(path.join(outDir, `${name}-${size}.png`), buf);
  }
  const ico = await pngToIco(ICO_SIZES.map((s) => pngBuffers[s]));
  await writeFile(path.join(outDir, 'favicon.ico'), ico);
  return { pngs: PNG_SIZES, ico: ICO_SIZES, outDir };
}

/**
 * Rasterize a non-square OG/social master (e.g. the 1200x630 og:image) to PNG.
 *
 * Social scrapers (Facebook, LinkedIn, X/Twitter) do NOT render SVG as og:image
 * and require PNG/JPG, so the served og:image must be a raster even though the
 * master is an outlined SVG (#481-F5). The OG master carries its own filled
 * navy canvas, so no transparent background is needed; we supersample via a high
 * render `density` and downscale to the exact target for crisp edges.
 */
export async function exportOg(svgPath, outPath, { width = 1200, height = 630, density = 200, background = '#0e0f15' } = {}) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const svg = await readFile(svgPath);
  await sharp(svg, { density })
    .resize(width, height)
    // Flatten the (already-opaque) navy canvas so the output has no alpha channel:
    // some social scrapers render PNG transparency unreliably (e.g. composited on
    // white). Flat opaque PNG is the safest og:image. Background matches the canvas
    // top colour so this is visually a no-op.
    .flatten({ background })
    .png()
    .toFile(outPath);
  return { width, height, outPath };
}

// CLI entry (only when run directly, not when imported)
const invokedDirectly = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('brand-export.mjs');
if (invokedDirectly) {
  if (process.argv[2] === 'og') {
    const [, , , svgPath = 'frontend/public/og-cycling-zone.svg', outPath = 'frontend/public/og-cycling-zone.png'] = process.argv;
    exportOg(svgPath, outPath)
      .then((r) => console.log(`OK: OG raster ${r.width}x${r.height} -> ${r.outPath}`))
      .catch((e) => { console.error(e); process.exit(1); });
  } else {
    const [, , svgPath, outDir = 'frontend/public/brand', name = 'cz'] = process.argv;
    if (!svgPath) {
      console.error('Usage: node scripts/brand-export.mjs <input.svg> [outDir] [name]');
      console.error('   or: node scripts/brand-export.mjs og <input.svg> <output.png>');
      process.exit(1);
    }
    exportBrand(svgPath, outDir, name)
      .then((r) => console.log(`OK: ${r.pngs.length} PNGs (${r.pngs.join(', ')}) + favicon.ico (${r.ico.join(',')}) -> ${r.outDir}`))
      .catch((e) => { console.error(e); process.exit(1); });
  }
}
