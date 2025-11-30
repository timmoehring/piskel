#!/usr/bin/env node
/**
 * Export Piskel files to PNG.
 *
 * Usage:
 *   node cli/piskel-to-png.js sprite.piskel
 *   node cli/piskel-to-png.js --scale 4 sprite.piskel
 *   node cli/piskel-to-png.js --frame 0 sprite.piskel
 *
 * Options:
 *   --scale N        Scale factor (default: 1)
 *   --frame N        Export single frame (default: all as spritesheet)
 *   --columns N      Spritesheet columns (default: all frames in one row)
 *   --output, -o     Output directory
 *   --help, -h       Show this help
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ============================================================================
// PNG Utilities
// ============================================================================

function decodePng(base64Data) {
  const base64 = base64Data.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  return PNG.sync.read(buffer);
}

function scalePng(png, scale) {
  if (scale === 1) return png;

  const newWidth = png.width * scale;
  const newHeight = png.height * scale;
  const scaled = new PNG({ width: newWidth, height: newHeight });

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor(x / scale);
      const srcY = Math.floor(y / scale);
      const srcIdx = (png.width * srcY + srcX) << 2;
      const dstIdx = (newWidth * y + x) << 2;
      scaled.data[dstIdx] = png.data[srcIdx];
      scaled.data[dstIdx + 1] = png.data[srcIdx + 1];
      scaled.data[dstIdx + 2] = png.data[srcIdx + 2];
      scaled.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }

  return scaled;
}

// ============================================================================
// Piskel Processing
// ============================================================================

function extractFrames(piskelData) {
  const frames = [];
  const frameWidth = piskelData.piskel.width;
  const frameHeight = piskelData.piskel.height;

  // Process first layer (for simplicity; could merge layers if needed)
  const layerData = JSON.parse(piskelData.piskel.layers[0]);

  for (const chunk of (layerData.chunks || [])) {
    if (!chunk.base64PNG) continue;

    const sheetPng = decodePng(chunk.base64PNG);
    const framesPerRow = Math.floor(sheetPng.width / frameWidth) || 1;

    for (let i = 0; i < chunk.layout.length; i++) {
      const frameIdx = chunk.layout[i][0];
      const srcX = (i % framesPerRow) * frameWidth;
      const srcY = Math.floor(i / framesPerRow) * frameHeight;

      const framePng = new PNG({ width: frameWidth, height: frameHeight });

      for (let y = 0; y < frameHeight; y++) {
        for (let x = 0; x < frameWidth; x++) {
          const srcIdx = (sheetPng.width * (srcY + y) + (srcX + x)) << 2;
          const dstIdx = (frameWidth * y + x) << 2;
          framePng.data[dstIdx] = sheetPng.data[srcIdx];
          framePng.data[dstIdx + 1] = sheetPng.data[srcIdx + 1];
          framePng.data[dstIdx + 2] = sheetPng.data[srcIdx + 2];
          framePng.data[dstIdx + 3] = sheetPng.data[srcIdx + 3];
        }
      }

      frames[frameIdx] = framePng;
    }
  }

  return frames;
}

function createSpritesheet(frames, columns) {
  if (frames.length === 0) return null;

  const frameWidth = frames[0].width;
  const frameHeight = frames[0].height;
  const cols = columns || frames.length;
  const rows = Math.ceil(frames.length / cols);

  const sheet = new PNG({
    width: frameWidth * cols,
    height: frameHeight * rows
  });

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const dstX = col * frameWidth;
    const dstY = row * frameHeight;

    for (let y = 0; y < frameHeight; y++) {
      for (let x = 0; x < frameWidth; x++) {
        const srcIdx = (frameWidth * y + x) << 2;
        const dstIdx = (sheet.width * (dstY + y) + (dstX + x)) << 2;
        sheet.data[dstIdx] = frame.data[srcIdx];
        sheet.data[dstIdx + 1] = frame.data[srcIdx + 1];
        sheet.data[dstIdx + 2] = frame.data[srcIdx + 2];
        sheet.data[dstIdx + 3] = frame.data[srcIdx + 3];
      }
    }
  }

  return sheet;
}

function exportPiskel(inputPath, outputPath, options) {
  const content = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(content);

  const frames = extractFrames(data);

  let outputPng;
  if (options.frame !== null && options.frame !== undefined) {
    // Single frame
    if (options.frame < 0 || options.frame >= frames.length) {
      throw new Error(`Frame ${options.frame} out of range (0-${frames.length - 1})`);
    }
    outputPng = frames[options.frame];
  } else {
    // Spritesheet
    outputPng = createSpritesheet(frames, options.columns);
  }

  if (!outputPng) {
    throw new Error('No frames found');
  }

  // Apply scale
  if (options.scale && options.scale !== 1) {
    outputPng = scalePng(outputPng, options.scale);
  }

  const buffer = PNG.sync.write(outputPng);
  fs.writeFileSync(outputPath, buffer);

  return {
    width: outputPng.width,
    height: outputPng.height,
    frames: frames.length
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage() {
  console.log(`
Export Piskel files to PNG.

Usage:
  piskel-to-png [options] <piskel-files...>

Options:
  --scale N        Scale factor (default: 1)
  --frame N        Export single frame (default: spritesheet)
  --columns N      Spritesheet columns (default: all in one row)
  --output, -o     Output directory
  --help, -h       Show this help

Examples:
  node cli/piskel-to-png.js sprite.piskel
  node cli/piskel-to-png.js --scale 4 sprite.piskel
  node cli/piskel-to-png.js --frame 0 --scale 2 sprite.piskel
  node cli/piskel-to-png.js --columns 4 -o ./export/ *.piskel
`);
}

function parseArgs(args) {
  const result = {
    scale: 1,
    frame: null,
    columns: null,
    output: null,
    files: [],
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--scale') {
      result.scale = parseInt(args[++i]) || 1;
    } else if (arg === '--frame') {
      result.frame = parseInt(args[++i]);
    } else if (arg === '--columns') {
      result.columns = parseInt(args[++i]);
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (!arg.startsWith('-')) {
      result.files.push(arg);
    }
  }

  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.files.length === 0) {
    printUsage();
    process.exit(args.help ? 0 : 1);
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

    let outputFile;
    const basename = path.basename(inputFile, '.piskel');
    const suffix = args.frame !== null ? `-frame${args.frame}` : '';

    if (args.output) {
      outputFile = path.join(args.output, `${basename}${suffix}.png`);
    } else {
      outputFile = path.join(path.dirname(inputFile), `${basename}${suffix}.png`);
    }

    try {
      console.log(`Exporting: ${inputFile}`);
      const result = exportPiskel(inputFile, outputFile, args);
      console.log(`  -> ${outputFile} (${result.width}x${result.height}, ${result.frames} frames)`);
      processed++;
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${processed} exported, ${failed} failed`);
}

main();
