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

    // Convert palette colors to RGB arrays for faster lookup
    var paletteRgb = colors.map(this.hexToRgb_.bind(this));

    var currentFrameIndex = this.piskelController.getCurrentFrameIndex();
    var layers = allLayers ?
      this.piskelController.getLayers() :
      [this.piskelController.getCurrentLayer()];

    layers.forEach(function (layer) {
      var frames = allFrames ?
        layer.getFrames() :
        [layer.getFrameAt(currentFrameIndex)];

      frames.forEach(function (frame) {
        this.matchFrameToPalette_(frame, paletteRgb);
      }.bind(this));
    }.bind(this));
  };

  /**
   * Match all pixels in a frame to the nearest palette color.
   * @private
   */
  ns.PaletteMatchingService.prototype.matchFrameToPalette_ = function (frame, paletteRgb) {
    var colorCache = {};

    frame.forEachPixel(function (colorInt, col, row) {
      // Skip transparent pixels
      var alpha = (colorInt >> 24 >>> 0) & 0xff;
      if (alpha === 0) {
        return;
      }

      // Check cache first
      if (typeof colorCache[colorInt] !== 'undefined') {
        frame.setPixel(col, row, colorCache[colorInt]);
        return;
      }

      // Extract RGB from int
      var r = colorInt & 0xff;
      var g = (colorInt >> 8) & 0xff;
      var b = (colorInt >> 16) & 0xff;

      // Find nearest palette color
      var nearestColor = this.findNearestColor_([r, g, b], paletteRgb);

      // Convert back to int (preserve original alpha)
      var newColorInt = (alpha << 24 >>> 0) + (nearestColor[2] << 16) + (nearestColor[1] << 8) + nearestColor[0];

      colorCache[colorInt] = newColorInt;
      frame.setPixel(col, row, newColorInt);
    }.bind(this));
  };

  /**
   * Find the nearest color in the palette using weighted Euclidean distance.
   * Uses the "redmean" formula for better perceptual accuracy.
   * @private
   */
  ns.PaletteMatchingService.prototype.findNearestColor_ = function (rgb, paletteRgb) {
    var minDistance = Infinity;
    var nearest = paletteRgb[0];

    for (var i = 0; i < paletteRgb.length; i++) {
      var distance = this.colorDistance_(rgb, paletteRgb[i]);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = paletteRgb[i];
      }
    }

    return nearest;
  };

  /**
   * Calculate perceptual color distance using the redmean formula.
   * This is a fast approximation that accounts for human color perception.
   * @private
   */
  ns.PaletteMatchingService.prototype.colorDistance_ = function (c1, c2) {
    var rMean = (c1[0] + c2[0]) / 2;
    var dr = c1[0] - c2[0];
    var dg = c1[1] - c2[1];
    var db = c1[2] - c2[2];

    // Weighted Euclidean distance (redmean formula)
    return Math.sqrt(
      (2 + rMean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rMean) / 256) * db * db
    );
  };

  /**
   * Convert hex color string to RGB array.
   * @private
   */
  ns.PaletteMatchingService.prototype.hexToRgb_ = function (hex) {
    // Remove # if present
    hex = hex.replace(/^#/, '');

    // Parse hex
    var bigint = parseInt(hex, 16);
    return [
      (bigint >> 16) & 255,
      (bigint >> 8) & 255,
      bigint & 255
    ];
  };
})();
