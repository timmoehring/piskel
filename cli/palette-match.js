#!/usr/bin/env node
/**
 * Batch palette matching tool for Piskel files.
 *
 * Usage:
 *   node cli/palette-match.js --palette colors.gpl sprite1.piskel sprite2.piskel
 *   node cli/palette-match.js --palette colors.txt --output ./matched/ *.piskel
 *   node cli/palette-match.js --palette reference.png sprite.piskel
 *
 * Options:
 *   --palette, -p   Palette file (.gpl, .pal, .txt, .png, .jpg)
 *   --output, -o    Output directory (default: overwrites input)
 *   --suffix, -s    Add suffix to output filename (e.g., "-matched")
 *   --help, -h      Show this help
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ============================================================================
// Palette Parsing
// ============================================================================

function parseGplPalette(content) {
  const colors = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('GIMP') || trimmed.startsWith('Name:') || trimmed.startsWith('Columns:')) {
      continue;
    }
    const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/);
    if (match) {
      colors.push({ r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) });
    }
  }
  return colors;
}

function parsePalPalette(buffer) {
  const colors = [];
  // RIFF PAL format or raw RGB
  if (buffer.toString('ascii', 0, 4) === 'RIFF') {
    // RIFF PAL format
    const dataOffset = 24;
    const numColors = buffer.readUInt16LE(22);
    for (let i = 0; i < numColors; i++) {
      const offset = dataOffset + i * 4;
      colors.push({
        r: buffer[offset],
        g: buffer[offset + 1],
        b: buffer[offset + 2]
      });
    }
  } else {
    // Raw RGB triplets
    for (let i = 0; i + 2 < buffer.length; i += 3) {
      colors.push({ r: buffer[i], g: buffer[i + 1], b: buffer[i + 2] });
    }
  }
  return colors;
}

function parseTxtPalette(content) {
  const colors = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') && trimmed.length < 4) {
      continue;
    }
    // Try hex format: #RRGGBB or RRGGBB
    const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
    if (hexMatch) {
      const hex = parseInt(hexMatch[1], 16);
      colors.push({
        r: (hex >> 16) & 255,
        g: (hex >> 8) & 255,
        b: hex & 255
      });
      continue;
    }
    // Try RGB format: R,G,B or R G B
    const rgbMatch = trimmed.match(/^(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (rgbMatch) {
      colors.push({
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3])
      });
    }
  }
  return colors;
}

function parseImagePalette(filePath) {
  return new Promise((resolve, reject) => {
    const colors = new Map();
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function() {
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const idx = (this.width * y + x) << 2;
            const a = this.data[idx + 3];
            if (a > 0) {
              const key = `${this.data[idx]},${this.data[idx + 1]},${this.data[idx + 2]}`;
              if (!colors.has(key)) {
                colors.set(key, {
                  r: this.data[idx],
                  g: this.data[idx + 1],
                  b: this.data[idx + 2]
                });
              }
            }
          }
        }
        resolve(Array.from(colors.values()));
      })
      .on('error', reject);
  });
}

async function loadPalette(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.gpl') {
    return parseGplPalette(fs.readFileSync(filePath, 'utf-8'));
  } else if (ext === '.pal') {
    return parsePalPalette(fs.readFileSync(filePath));
  } else if (ext === '.txt') {
    return parseTxtPalette(fs.readFileSync(filePath, 'utf-8'));
  } else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    return parseImagePalette(filePath);
  } else {
    throw new Error(`Unsupported palette format: ${ext}`);
  }
}

// ============================================================================
// Color Matching (same algorithm as PaletteMatchingService)
// ============================================================================

function colorDistance(r1, g1, b1, r2, g2, b2) {
  // Redmean weighted distance (no sqrt needed for comparison)
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

// ============================================================================
// Piskel Processing
// ============================================================================

function decodePng(base64Data) {
  return new Promise((resolve, reject) => {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    new PNG().parse(buffer, (err, png) => {
      if (err) reject(err);
      else resolve(png);
    });
  });
}

function encodePng(png) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    png.pack()
      .on('data', chunk => chunks.push(chunk))
      .on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve('data:image/png;base64,' + buffer.toString('base64'));
      })
      .on('error', reject);
  });
}

async function matchPngToPalette(base64Data, palette, colorCache) {
  const png = await decodePng(base64Data);
  let modified = false;

  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a === 0) continue;

    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const key = (r << 16) | (g << 8) | b;

    let nearest;
    if (colorCache.has(key)) {
      nearest = colorCache.get(key);
    } else {
      nearest = findNearestColor(r, g, b, palette);
      colorCache.set(key, nearest);
    }

    if (png.data[i] !== nearest.r || png.data[i + 1] !== nearest.g || png.data[i + 2] !== nearest.b) {
      png.data[i] = nearest.r;
      png.data[i + 1] = nearest.g;
      png.data[i + 2] = nearest.b;
      modified = true;
    }
  }

  if (modified) {
    return encodePng(png);
  }
  return base64Data;
}

async function processPiskelFile(inputPath, outputPath, palette) {
  const content = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(content);

  const colorCache = new Map();
  let layersModified = 0;

  for (let i = 0; i < data.piskel.layers.length; i++) {
    const layerData = JSON.parse(data.piskel.layers[i]);

    if (layerData.chunks) {
      for (const chunk of layerData.chunks) {
        if (chunk.base64PNG) {
          chunk.base64PNG = await matchPngToPalette(chunk.base64PNG, palette, colorCache);
        }
      }
    } else if (layerData.base64PNG) {
      layerData.base64PNG = await matchPngToPalette(layerData.base64PNG, palette, colorCache);
    }

    data.piskel.layers[i] = JSON.stringify(layerData);
    layersModified++;
  }

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  return { layersModified, colorsMatched: colorCache.size };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage() {
  console.log(`
Batch palette matching for Piskel files.

Usage:
  piskel-palette-match --palette <file> [options] <piskel-files...>

Options:
  --palette, -p   Palette file (.gpl, .pal, .txt, .png)  [required]
  --output, -o    Output directory (default: overwrite input files)
  --suffix, -s    Add suffix to output filename (e.g., "-matched")
  --help, -h      Show this help

Examples:
  node cli/palette-match.js -p colors.gpl sprite.piskel
  node cli/palette-match.js -p palette.png -o ./output/ *.piskel
  node cli/palette-match.js -p colors.txt -s "-matched" sprite.piskel
`);
}

function parseArgs(args) {
  const result = {
    palette: null,
    output: null,
    suffix: '',
    files: [],
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--palette' || arg === '-p') {
      result.palette = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (arg === '--suffix' || arg === '-s') {
      result.suffix = args[++i];
    } else if (!arg.startsWith('-')) {
      result.files.push(arg);
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.files.length === 0 || !args.palette) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  // Load palette
  console.log(`Loading palette: ${args.palette}`);
  let palette;
  try {
    palette = await loadPalette(args.palette);
  } catch (err) {
    console.error(`Error loading palette: ${err.message}`);
    process.exit(1);
  }
  console.log(`  Found ${palette.length} colors`);

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

    let outputFile;
    if (args.output) {
      const basename = path.basename(inputFile, '.piskel');
      outputFile = path.join(args.output, `${basename}${args.suffix}.piskel`);
    } else if (args.suffix) {
      const dir = path.dirname(inputFile);
      const basename = path.basename(inputFile, '.piskel');
      outputFile = path.join(dir, `${basename}${args.suffix}.piskel`);
    } else {
      outputFile = inputFile;
    }

    try {
      console.log(`Processing: ${inputFile}`);
      const result = await processPiskelFile(inputFile, outputFile, palette);
      console.log(`  -> ${outputFile} (${result.layersModified} layers, ${result.colorsMatched} unique colors)`);
      processed++;
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${processed} processed, ${failed} failed`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
