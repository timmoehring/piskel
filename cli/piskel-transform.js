#!/usr/bin/env node
/**
 * Transform Piskel files: resize, crop to content, etc.
 *
 * Usage:
 *   node cli/piskel-transform.js --resize 64x64 sprite.piskel
 *   node cli/piskel-transform.js --crop sprite.piskel
 *   node cli/piskel-transform.js --scale 2 sprite.piskel
 *
 * Options:
 *   --resize WxH     Resize to exact dimensions (e.g., 32x32)
 *   --scale N        Scale by factor (e.g., 2 = double size)
 *   --crop           Crop to content (remove transparent borders)
 *   --output, -o     Output directory
 *   --suffix, -s     Add suffix to filename
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

function encodePng(png) {
  const buffer = PNG.sync.write(png);
  return 'data:image/png;base64,' + buffer.toString('base64');
}

// ============================================================================
// Transform Operations
// ============================================================================

function findContentBounds(png) {
  let minX = png.width, minY = png.height, maxX = 0, maxY = 0;
  let hasContent = false;

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      if (png.data[idx + 3] > 0) { // non-transparent
        hasContent = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!hasContent) {
    return { x: 0, y: 0, width: png.width, height: png.height };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
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

  // Nearest-neighbor scaling (pixel-perfect for pixel art)
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
// Piskel Processing
// ============================================================================

function transformPiskel(inputPath, outputPath, options) {
  const content = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(content);

  let newWidth = data.piskel.width;
  let newHeight = data.piskel.height;
  let cropBounds = null;

  // First pass: determine crop bounds if needed (must be consistent across all frames)
  if (options.crop) {
    let globalMinX = Infinity, globalMinY = Infinity;
    let globalMaxX = 0, globalMaxY = 0;

    for (const layerStr of data.piskel.layers) {
      const layerData = JSON.parse(layerStr);
      for (const chunk of (layerData.chunks || [])) {
        if (chunk.base64PNG) {
          const png = decodePng(chunk.base64PNG);
          // For spritesheets, we need frame dimensions
          const frameWidth = data.piskel.width;
          const frameHeight = data.piskel.height;
          const framesPerRow = Math.floor(png.width / frameWidth);

          for (let i = 0; i < chunk.layout.length; i++) {
            const frameX = (i % framesPerRow) * frameWidth;
            const frameY = Math.floor(i / framesPerRow) * frameHeight;

            for (let y = 0; y < frameHeight; y++) {
              for (let x = 0; x < frameWidth; x++) {
                const idx = (png.width * (frameY + y) + (frameX + x)) << 2;
                if (png.data[idx + 3] > 0) {
                  globalMinX = Math.min(globalMinX, x);
                  globalMinY = Math.min(globalMinY, y);
                  globalMaxX = Math.max(globalMaxX, x);
                  globalMaxY = Math.max(globalMaxY, y);
                }
              }
            }
          }
        }
      }
    }

    if (globalMinX <= globalMaxX && globalMinY <= globalMaxY) {
      cropBounds = {
        x: globalMinX,
        y: globalMinY,
        width: globalMaxX - globalMinX + 1,
        height: globalMaxY - globalMinY + 1
      };
      newWidth = cropBounds.width;
      newHeight = cropBounds.height;
    }
  }

  // Apply resize/scale
  if (options.resize) {
    const [w, h] = options.resize.split('x').map(Number);
    newWidth = w;
    newHeight = h;
  } else if (options.scale) {
    newWidth = Math.round((cropBounds ? cropBounds.width : data.piskel.width) * options.scale);
    newHeight = Math.round((cropBounds ? cropBounds.height : data.piskel.height) * options.scale);
  }

  // Transform each layer
  for (let i = 0; i < data.piskel.layers.length; i++) {
    const layerData = JSON.parse(data.piskel.layers[i]);

    for (const chunk of (layerData.chunks || [])) {
      if (chunk.base64PNG) {
        let png = decodePng(chunk.base64PNG);
        const frameWidth = data.piskel.width;
        const frameHeight = data.piskel.height;
        const framesPerRow = Math.floor(png.width / frameWidth) || 1;
        const numFrames = chunk.layout.length;

        // Create new spritesheet
        const newSheet = new PNG({
          width: newWidth * numFrames,
          height: newHeight
        });

        for (let f = 0; f < numFrames; f++) {
          const srcFrameX = (f % framesPerRow) * frameWidth;
          const srcFrameY = Math.floor(f / framesPerRow) * frameHeight;

          // Extract frame
          let framePng = new PNG({ width: frameWidth, height: frameHeight });
          for (let y = 0; y < frameHeight; y++) {
            for (let x = 0; x < frameWidth; x++) {
              const srcIdx = (png.width * (srcFrameY + y) + (srcFrameX + x)) << 2;
              const dstIdx = (frameWidth * y + x) << 2;
              framePng.data[dstIdx] = png.data[srcIdx];
              framePng.data[dstIdx + 1] = png.data[srcIdx + 1];
              framePng.data[dstIdx + 2] = png.data[srcIdx + 2];
              framePng.data[dstIdx + 3] = png.data[srcIdx + 3];
            }
          }

          // Crop if needed
          if (cropBounds) {
            framePng = cropPng(framePng, cropBounds);
          }

          // Resize if needed
          if (framePng.width !== newWidth || framePng.height !== newHeight) {
            framePng = resizePng(framePng, newWidth, newHeight);
          }

          // Copy to new spritesheet
          const dstFrameX = f * newWidth;
          for (let y = 0; y < newHeight; y++) {
            for (let x = 0; x < newWidth; x++) {
              const srcIdx = (newWidth * y + x) << 2;
              const dstIdx = (newSheet.width * y + (dstFrameX + x)) << 2;
              newSheet.data[dstIdx] = framePng.data[srcIdx];
              newSheet.data[dstIdx + 1] = framePng.data[srcIdx + 1];
              newSheet.data[dstIdx + 2] = framePng.data[srcIdx + 2];
              newSheet.data[dstIdx + 3] = framePng.data[srcIdx + 3];
            }
          }
        }

        chunk.base64PNG = encodePng(newSheet);
        // Update layout to linear
        chunk.layout = chunk.layout.map((_, idx) => [idx]);
      }
    }

    data.piskel.layers[i] = JSON.stringify(layerData);
  }

  // Update dimensions
  data.piskel.width = newWidth;
  data.piskel.height = newHeight;

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  return { width: newWidth, height: newHeight };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage() {
  console.log(`
Transform Piskel files: resize, crop, scale.

Usage:
  piskel-transform [options] <piskel-files...>

Options:
  --resize WxH     Resize to exact dimensions (e.g., 32x32)
  --scale N        Scale by factor (e.g., 2 = double size)
  --crop           Crop to content (remove transparent borders)
  --output, -o     Output directory
  --suffix, -s     Add suffix to filename (e.g., "-small")
  --help, -h       Show this help

Examples:
  node cli/piskel-transform.js --crop sprite.piskel
  node cli/piskel-transform.js --resize 16x16 sprite.piskel
  node cli/piskel-transform.js --scale 2 -s "-2x" sprite.piskel
  node cli/piskel-transform.js --crop --resize 32x32 -o ./out/ *.piskel
`);
}

function parseArgs(args) {
  const result = {
    resize: null,
    scale: null,
    crop: false,
    output: null,
    suffix: '',
    files: [],
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--resize') {
      result.resize = args[++i];
    } else if (arg === '--scale') {
      result.scale = parseFloat(args[++i]);
    } else if (arg === '--crop') {
      result.crop = true;
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

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.files.length === 0) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (!args.resize && !args.scale && !args.crop) {
    console.error('Error: At least one transform option required (--resize, --scale, or --crop)');
    process.exit(1);
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
      const result = transformPiskel(inputFile, outputFile, args);
      console.log(`  -> ${outputFile} (${result.width}x${result.height})`);
      processed++;
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${processed} processed, ${failed} failed`);
}

main();
