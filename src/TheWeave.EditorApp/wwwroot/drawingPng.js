// drawingPng.js
// John Oestmann
// An object drawing as a PNG, for drawing it in other art software and bringing it back: each of the Drawings
// view's paints is a fixed neutral colour (see PNG_KEY), since every album recolours paints its own way, and a
// drawing's layers sit side by side, in the order of the view's tabs. Knows nothing about the DOM, so it can be
// tested on its own - puzzleDrawings.js does the drawing onto and reading from a canvas.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WeaveDrawingPng = factory();
})(this, function () {

  const TILE_PX = 24;

  // Each paint's colour in a PNG: Clear is see-through, Outline black, the mix's colours four greys from dark to
  // light, Light white, and Grain magenta, as it's the one that stands for the album's own texture.
  const PNG_KEY = [
    { paint: '.', label: 'Clear', rgb: null },
    { paint: 'O', label: 'Outline', rgb: [0, 0, 0] },
    { paint: '1', label: 'Colour 1', rgb: [60, 60, 60] },
    { paint: '2', label: 'Colour 2', rgb: [110, 110, 110] },
    { paint: '3', label: 'Colour 3', rgb: [160, 160, 160] },
    { paint: '4', label: 'Colour 4', rgb: [210, 210, 210] },
    { paint: 'H', label: 'Light', rgb: [255, 255, 255] },
    { paint: 'G', label: 'Grain', rgb: [255, 0, 255] },
  ];
  // Anything less opaque than this is Clear.
  const OPAQUE_FROM = 128;

  // The layers a drawing of a kind has, in the Drawings view's order: its Still or only one first, then a Gate's
  // Open frame, a Stream's Bend, and the Flow of a Stream or Rotator tile.
  function layersOf(standard){
    return ['pixels', 'openPixels', 'bendPixels', 'flowPixels'].filter(field => field === 'pixels' || standard[field]);
  }

  function hexOf(rgb){
    return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
  }

  // A drawing as RGBA pixels at one pixel per pixel, its layers side by side. A layer it's never had painted is
  // its kind's Standard one.
  function toImage(drawing, standard){
    let layers = layersOf(standard);
    let width = TILE_PX * layers.length;
    let data = new Uint8ClampedArray(width * TILE_PX * 4);
    layers.forEach((field, layer) => {
      let paints = drawing[field] ?? standard[field];
      for (let i = 0; i < TILE_PX * TILE_PX; i++) {
        let rgb = PNG_KEY.find(entry => entry.paint === paints[i])?.rgb;
        if (!rgb) continue;
        let x = layer * TILE_PX + i % TILE_PX, y = Math.floor(i / TILE_PX);
        data.set([...rgb, 255], (y * width + x) * 4);
      }
    });
    return { data, width, height: TILE_PX };
  }

  // A drawing's layers from RGBA pixels: every layer side by side, or just its first on its own, at one pixel per
  // pixel or any whole number of pixels to each. Each pixel becomes the paint whose colour is nearest, and how many
  // weren't exactly a paint's colour is counted, so that an edit made off the key can be pointed out.
  function fromImage(image, standard){
    let layers = layersOf(standard);
    let scale = image.height / TILE_PX;
    let across = image.width / image.height;
    if (!Number.isInteger(scale) || scale < 1 || !(across === layers.length || across === 1)) {
      let sizes = layers.length > 1 ? `${TILE_PX * layers.length}×${TILE_PX}, with its ${layers.length} layers side by side, or ${TILE_PX}×${TILE_PX} for the first on its own` : `${TILE_PX}×${TILE_PX}`;
      throw new Error(`This image is ${image.width}×${image.height}. A drawing like this one is ${sizes}, or a whole-number enlargement of that.`);
    }

    let inexact = 0;
    let result = {};
    layers.slice(0, across).forEach((field, layer) => {
      let paints = '';
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          // The middle of each enlarged pixel.
          let sx = (layer * TILE_PX + x) * scale + Math.floor(scale / 2);
          let sy = y * scale + Math.floor(scale / 2);
          let i = (sy * image.width + sx) * 4;
          let [r, g, b, a] = image.data.slice(i, i + 4);
          if (a < OPAQUE_FROM) {
            if (a !== 0) inexact++;
            paints += '.';
            continue;
          }
          let best = null;
          for (const entry of PNG_KEY) {
            if (!entry.rgb) continue;
            let distance = (r - entry.rgb[0]) ** 2 + (g - entry.rgb[1]) ** 2 + (b - entry.rgb[2]) ** 2;
            if (!best || distance < best.distance) best = { entry, distance };
          }
          if (best.distance !== 0 || a !== 255) inexact++;
          paints += best.entry.paint;
        }
      }
      result[field] = paints;
    });
    return { layers: result, inexact };
  }

  return { TILE_PX, PNG_KEY, hexOf, layersOf, toImage, fromImage };
});
