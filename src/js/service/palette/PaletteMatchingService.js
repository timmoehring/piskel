(function () {
  var ns = $.namespace('pskl.service.palette');

  /**
   * Service for matching sprite colors to a target palette.
   */
  ns.PaletteMatchingService = function (piskelController) {
    this.piskelController = piskelController;
  };

  /**
   * Apply palette matching to all frames and layers.
   * @param {pskl.model.Palette} palette - Target palette
   * @param {Object} options - { allLayers: boolean, allFrames: boolean }
   */
  ns.PaletteMatchingService.prototype.matchToPalette = function (palette, options) {
    options = options || {};
    var allLayers = options.allLayers !== false;
    var allFrames = options.allFrames !== false;

    var colors = palette.getColors();
    if (!colors || colors.length === 0) {
      return;
    }

    // Pre-convert palette to RGB components for fast lookup
    var paletteData = this.buildPaletteData_(colors);

    // Global cache across all frames (same colors map to same results)
    var colorCache = {};

    var currentFrameIndex = this.piskelController.getCurrentFrameIndex();
    var layers = allLayers ?
      this.piskelController.getLayers() :
      [this.piskelController.getCurrentLayer()];

    for (var l = 0; l < layers.length; l++) {
      var layer = layers[l];
      var frames = allFrames ?
        layer.getFrames() :
        [layer.getFrameAt(currentFrameIndex)];

      for (var f = 0; f < frames.length; f++) {
        this.matchFrameToPalette_(frames[f], paletteData, colorCache);
      }
    }
  };

  /**
   * Build optimized palette data structure.
   * @private
   */
  ns.PaletteMatchingService.prototype.buildPaletteData_ = function (colors) {
    var data = [];
    for (var i = 0; i < colors.length; i++) {
      var hex = colors[i].replace(/^#/, '');
      var bigint = parseInt(hex, 16);
      data.push({
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
      });
    }
    return data;
  };

  /**
   * Match all pixels in a frame to the nearest palette color.
   * Operates directly on pixel buffer for maximum speed.
   * @private
   */
  ns.PaletteMatchingService.prototype.matchFrameToPalette_ = function (frame, paletteData, colorCache) {
    var pixels = frame.pixels;
    var length = pixels.length;
    var modified = false;

    for (var i = 0; i < length; i++) {
      var colorInt = pixels[i];

      // Skip transparent pixels (alpha = 0)
      var alpha = (colorInt >>> 24) & 0xff;
      if (alpha === 0) {
        continue;
      }

      // Check cache
      var cached = colorCache[colorInt];
      if (cached !== undefined) {
        if (pixels[i] !== cached) {
          pixels[i] = cached;
          modified = true;
        }
        continue;
      }

      // Extract RGB
      var r = colorInt & 0xff;
      var g = (colorInt >> 8) & 0xff;
      var b = (colorInt >> 16) & 0xff;

      // Find nearest palette color (inline for speed)
      var minDist = Infinity;
      var nearestR = paletteData[0].r;
      var nearestG = paletteData[0].g;
      var nearestB = paletteData[0].b;

      for (var p = 0; p < paletteData.length; p++) {
        var pr = paletteData[p].r;
        var pg = paletteData[p].g;
        var pb = paletteData[p].b;

        // Redmean weighted distance (skip sqrt - only comparing)
        var rMean = (r + pr) >> 1;
        var dr = r - pr;
        var dg = g - pg;
        var db = b - pb;
        var dist = ((512 + rMean) * dr * dr >> 8) + 4 * dg * dg + ((767 - rMean) * db * db >> 8);

        if (dist < minDist) {
          minDist = dist;
          nearestR = pr;
          nearestG = pg;
          nearestB = pb;
          if (dist === 0) {
            break; // Exact match
          }
        }
      }

      // Build new color int (preserve alpha)
      var newColorInt = ((alpha << 24) >>> 0) + (nearestB << 16) + (nearestG << 8) + nearestR;

      colorCache[colorInt] = newColorInt;
      if (pixels[i] !== newColorInt) {
        pixels[i] = newColorInt;
        modified = true;
      }
    }

    // Bump version if modified
    if (modified) {
      frame.version++;
    }
  };
})();
