#!/usr/bin/env node
/**
 * Sprite pipeline: PNG → Piskel with palette, crop, and resize.
 *
 * Usage:
 *   node cli/sprite-pipeline.js --palette colors.gpl --size 32x32 hero.png
 *   node cli/sprite-pipeline.js -p colors.gpl -s 64x64 --crop *.png
 *
 * Options:
 *   --palette, -p   Palette file (.gpl, .txt, .png)
 *   --size, -s      Final size (e.g., 32x32)
 *   --crop          Crop to content before resizing
 *   --output, -o    Output directory
 *   --help, -h      Show this help
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ============================================================================
// Palette Loading & Matching
// ============================================================================

function parseGplPalette(content) {
  const colors = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('GIMP') ||
        trimmed.startsWith('Name:') || trimmed.startsWith('Columns:')) continue;
    const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/);
    if (match) colors.push({ r: +match[1], g: +match[2], b: +match[3] });
  }
  return colors;
}

function parseTxtPalette(content) {
  const colors = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
    if (hexMatch) {
      const hex = parseInt(hexMatch[1], 16);
      colors.push({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 });
      continue;
    }
    const rgbMatch = trimmed.match(/^(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (rgbMatch) colors.push({ r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] });
  }
  return colors;
}

function parseImagePalette(filePath) {
  const buffer = fs.readFileSync(filePath);
  const png = PNG.sync.read(buffer);
  const colors = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] > 0) {
      const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
      if (!colors.has(key)) {
        colors.set(key, { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] });
      }
    }
  }
  return Array.from(colors.values());
}

function loadPalette(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gpl') return parseGplPalette(fs.readFileSync(filePath, 'utf-8'));
  if (ext === '.txt') return parseTxtPalette(fs.readFileSync(filePath, 'utf-8'));
  if (ext === '.png' || ext === '.jpg') return parseImagePalette(filePath);
  throw new Error(`Unsupported palette format: ${ext}`);
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rMean = (r1 + r2) >> 1;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return ((512 + rMean) * dr * dr >> 8) + 4 * dg * dg + ((767 - rMean) * db * db >> 8);
}

function applyPalette(png, palette) {
  const cache = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    const key = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    let nearest = cache.get(key);
    if (!nearest) {
      let minDist = Infinity;
      for (const c of palette) {
        const d = colorDistance(png.data[i], png.data[i + 1], png.data[i + 2], c.r, c.g, c.b);
        if (d < minDist) { minDist = d; nearest = c; if (d === 0) break; }
      }
      cache.set(key, nearest);
    }
    png.data[i] = nearest.r;
    png.data[i + 1] = nearest.g;
    png.data[i + 2] = nearest.b;
  }
}

// ============================================================================
// Image Transforms
// ============================================================================

function findContentBounds(png) {
  let minX = png.width, minY = png.height, maxX = 0, maxY = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[((png.width * y + x) << 2) + 3] > 0) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  if (minX > maxX) return { x: 0, y: 0, width: png.width, height: png.height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function cropPng(png, bounds) {
  const cropped = new PNG({ width: bounds.width, height: bounds.height });
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const srcIdx = (png.width * (y + bounds.y) + (x + bounds.x)) << 2;
      const dstIdx = (bounds.width * y + x) << 2;
      cropped.data[dstIdx] = png.data[srcIdx];
      cropped.data[dstIdx + 1] = png.data[srcIdx + 1];
      cropped.data[dstIdx + 2] = png.data[srcIdx + 2];
      cropped.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return cropped;
}

function resizePng(png, newWidth, newHeight) {
  const resized = new PNG({ width: newWidth, height: newHeight });
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor(x * png.width / newWidth);
      const srcY = Math.floor(y * png.height / newHeight);
      const srcIdx = (png.width * srcY + srcX) << 2;
      const dstIdx = (newWidth * y + x) << 2;
      resized.data[dstIdx] = png.data[srcIdx];
      resized.data[dstIdx + 1] = png.data[srcIdx + 1];
      resized.data[dstIdx + 2] = png.data[srcIdx + 2];
      resized.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return resized;
}

// ============================================================================
// Piskel Creation
// ============================================================================

function createPiskel(png, name) {
  const buffer = PNG.sync.write(png);
  const base64PNG = 'data:image/png;base64,' + buffer.toString('base64');

  return JSON.stringify({
    modelVersion: 2,
    piskel: {
      name: name,
      description: '',
      fps: 12,
      height: png.height,
      width: png.width,
      layers: [JSON.stringify({
        name: 'Layer 1',
        opacity: 1,
        frameCount: 1,
        chunks: [{ layout: [[0]], base64PNG }]
      })],
      hiddenFrames: []
    }
  }, null, 2);
}

// ============================================================================
// Pipeline
// ============================================================================

function processPng(inputPath, outputPath, options) {
  // Load PNG
  const buffer = fs.readFileSync(inputPath);
  let png = PNG.sync.read(buffer);
  const originalSize = `${png.width}x${png.height}`;

  // Apply palette
  if (options.palette) {
    applyPalette(png, options.palette);
  }

  // Crop to content
  if (options.crop) {
    const bounds = findContentBounds(png);
    png = cropPng(png, bounds);
  }

  // Resize
  if (options.size) {
    const [w, h] = options.size.split('x').map(Number);
    png = resizePng(png, w, h);
  }

  // Create Piskel
  const name = path.basename(inputPath, path.extname(inputPath));
  const piskelContent = createPiskel(png, name);
  fs.writeFileSync(outputPath, piskelContent);

  return { originalSize, finalSize: `${png.width}x${png.height}` };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage() {
  console.log(`
Sprite pipeline: PNG → Piskel with palette, crop, and resize.

Usage:
  sprite-pipeline [options] <png-files...>

Options:
  --palette, -p   Palette file (.gpl, .txt, .png)
  --size, -s      Final size (e.g., 32x32)
  --crop          Crop to content before resizing
  --output, -o    Output directory
  --help, -h      Show this help

Examples:
  node cli/sprite-pipeline.js -p colors.gpl -s 32x32 hero.png
  node cli/sprite-pipeline.js -p palette.png --crop -s 64x64 -o ./sprites/ *.png
`);
}

function parseArgs(args) {
  const result = { palette: null, size: null, crop: false, output: null, files: [], help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--palette' || arg === '-p') result.palette = args[++i];
    else if (arg === '--size' || arg === '-s') result.size = args[++i];
    else if (arg === '--crop') result.crop = true;
    else if (arg === '--output' || arg === '-o') result.output = args[++i];
    else if (!arg.startsWith('-')) result.files.push(arg);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.files.length === 0) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  // Load palette once
  let palette = null;
  if (args.palette) {
    console.log(`Loading palette: ${args.palette}`);
    palette = loadPalette(args.palette);
    console.log(`  ${palette.length} colors`);
  }

  if (args.output && !fs.existsSync(args.output)) {
    fs.mkdirSync(args.output, { recursive: true });
  }

  let processed = 0, failed = 0;

  for (const inputFile of args.files) {
    if (!fs.existsSync(inputFile)) {
      console.error(`File not found: ${inputFile}`);
      failed++;
      continue;
    }

    const basename = path.basename(inputFile, path.extname(inputFile));
    const outputFile = args.output
      ? path.join(args.output, `${basename}.piskel`)
      : inputFile.replace(/\.[^.]+$/, '.piskel');

    try {
      console.log(`Processing: ${inputFile}`);
      const result = processPng(inputFile, outputFile, { palette, size: args.size, crop: args.crop });
      console.log(`  ${result.originalSize} → ${result.finalSize} → ${outputFile}`);
      processed++;
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${processed} processed, ${failed} failed`);
}

main();
