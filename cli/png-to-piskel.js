#!/usr/bin/env node
/**
 * Batch convert PNG images to Piskel files.
 *
 * Usage:
 *   node cli/png-to-piskel.js image1.png image2.png
 *   node cli/png-to-piskel.js --output ./sprites/ *.png
 *   node cli/png-to-piskel.js --palette colors.gpl --name "My Sprite" image.png
 *
 * Options:
 *   --output, -o    Output directory (default: same as input)
 *   --name, -n      Sprite name (default: filename)
 *   --palette, -p   Apply palette matching after import
 *   --fps, -f       Frames per second (default: 12)
 *   --help, -h      Show this help
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ============================================================================
// Piskel File Generation
// ============================================================================

function createPiskelFile(imageData, options) {
  const { width, height, name, fps } = options;

  // Create base64 PNG from image data
  const png = new PNG({ width, height });
  png.data = imageData;

  const chunks = [];
  const pngBuffer = PNG.sync.write(png);
  const base64PNG = 'data:image/png;base64,' + pngBuffer.toString('base64');

  // Create layer data
  const layerData = {
    name: 'Layer 1',
    opacity: 1,
    frameCount: 1,
    chunks: [{
      layout: [[0]],
      base64PNG: base64PNG
    }]
  };

  // Create piskel structure
  const piskelData = {
    modelVersion: 2,
    piskel: {
      name: name,
      description: '',
      fps: fps,
      height: height,
      width: width,
      layers: [JSON.stringify(layerData)],
      hiddenFrames: []
    }
  };

  return JSON.stringify(piskelData, null, 2);
}

// ============================================================================
// Palette Matching (same as palette-match.js)
// ============================================================================

function parseGplPalette(content) {
  const colors = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('GIMP') ||
        trimmed.startsWith('Name:') || trimmed.startsWith('Columns:')) {
      continue;
    }
    const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/);
    if (match) {
      colors.push({ r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) });
    }
  }
  return colors;
}

function parseTxtPalette(content) {
  const colors = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || (trimmed.startsWith('#') && trimmed.length < 4)) {
      continue;
    }
    const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
    if (hexMatch) {
      const hex = parseInt(hexMatch[1], 16);
      colors.push({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 });
      continue;
    }
    const rgbMatch = trimmed.match(/^(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (rgbMatch) {
      colors.push({ r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) });
    }
  }
  return colors;
}

function loadPalette(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf-8');

  if (ext === '.gpl') {
    return parseGplPalette(content);
  } else if (ext === '.txt') {
    return parseTxtPalette(content);
  } else {
    throw new Error(`Unsupported palette format: ${ext}`);
  }
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rMean = (r1 + r2) >> 1;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return ((512 + rMean) * dr * dr >> 8) + 4 * dg * dg + ((767 - rMean) * db * db >> 8);
}

function findNearestColor(r, g, b, palette) {
  let minDist = Infinity;
  let nearest = palette[0];
  for (const color of palette) {
    const dist = colorDistance(r, g, b, color.r, color.g, color.b);
    if (dist < minDist) {
      minDist = dist;
      nearest = color;
      if (dist === 0) break;
    }
  }
  return nearest;
}

function applyPaletteToImageData(imageData, palette) {
  const colorCache = new Map();

  for (let i = 0; i < imageData.length; i += 4) {
    const a = imageData[i + 3];
    if (a === 0) continue;

    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const key = (r << 16) | (g << 8) | b;

    let nearest;
    if (colorCache.has(key)) {
      nearest = colorCache.get(key);
    } else {
      nearest = findNearestColor(r, g, b, palette);
      colorCache.set(key, nearest);
    }

    imageData[i] = nearest.r;
    imageData[i + 1] = nearest.g;
    imageData[i + 2] = nearest.b;
  }

  return imageData;
}

// ============================================================================
// PNG Processing
// ============================================================================

function loadPng(filePath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function() {
        resolve({
          width: this.width,
          height: this.height,
          data: this.data
        });
      })
      .on('error', reject);
  });
}

async function convertPngToPiskel(inputPath, outputPath, options) {
  const png = await loadPng(inputPath);

  let imageData = png.data;

  // Apply palette matching if specified
  if (options.palette) {
    imageData = applyPaletteToImageData(imageData, options.palette);
  }

  const piskelContent = createPiskelFile(imageData, {
    width: png.width,
    height: png.height,
    name: options.name || path.basename(inputPath, path.extname(inputPath)),
    fps: options.fps
  });

  fs.writeFileSync(outputPath, piskelContent);

  return { width: png.width, height: png.height };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage() {
  console.log(`
Batch convert PNG images to Piskel files.

Usage:
  png-to-piskel [options] <png-files...>

Options:
  --output, -o    Output directory (default: same as input file)
  --name, -n      Sprite name (default: input filename)
  --palette, -p   Apply palette matching during import (.gpl, .txt)
  --fps, -f       Frames per second (default: 12)
  --help, -h      Show this help

Examples:
  node cli/png-to-piskel.js sprite.png
  node cli/png-to-piskel.js -o ./sprites/ *.png
  node cli/png-to-piskel.js -p colors.gpl -n "Hero" hero.png
`);
}

function parseArgs(args) {
  const result = {
    output: null,
    name: null,
    palette: null,
    fps: 12,
    files: [],
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (arg === '--name' || arg === '-n') {
      result.name = args[++i];
    } else if (arg === '--palette' || arg === '-p') {
      result.palette = args[++i];
    } else if (arg === '--fps' || arg === '-f') {
      result.fps = parseInt(args[++i]) || 12;
    } else if (!arg.startsWith('-')) {
      result.files.push(arg);
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.files.length === 0) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  // Load palette if specified
  let palette = null;
  if (args.palette) {
    console.log(`Loading palette: ${args.palette}`);
    try {
      palette = loadPalette(args.palette);
      console.log(`  Found ${palette.length} colors`);
    } catch (err) {
      console.error(`Error loading palette: ${err.message}`);
      process.exit(1);
    }
  }

  // Create output directory if specified
  if (args.output && !fs.existsSync(args.output)) {
    fs.mkdirSync(args.output, { recursive: true });
  }

  // Process each file
  let processed = 0;
  let failed = 0;

  for (const inputFile of args.files) {
    if (!fs.existsSync(inputFile)) {
      console.error(`File not found: ${inputFile}`);
      failed++;
      continue;
    }

    const ext = path.extname(inputFile).toLowerCase();
    if (ext !== '.png') {
      console.error(`Skipping non-PNG file: ${inputFile}`);
      failed++;
      continue;
    }

    let outputFile;
    if (args.output) {
      const basename = path.basename(inputFile, '.png');
      outputFile = path.join(args.output, `${basename}.piskel`);
    } else {
      outputFile = inputFile.replace(/\.png$/i, '.piskel');
    }

    try {
      console.log(`Converting: ${inputFile}`);
      const result = await convertPngToPiskel(inputFile, outputFile, {
        name: args.name,
        fps: args.fps,
        palette: palette
      });
      console.log(`  -> ${outputFile} (${result.width}x${result.height})`);
      processed++;
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${processed} converted, ${failed} failed`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
