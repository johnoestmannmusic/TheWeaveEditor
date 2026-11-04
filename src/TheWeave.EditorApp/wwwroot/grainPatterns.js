// grainPatterns.js
// John Oestmann
// Patterns for the Drawings view's Generate panel (see puzzleDrawings.js): each one a value per pixel of a
// square, from dark to light, which a balance of colours is then laid out across, each colour covering its
// percentage of the square. Patches of the album art, natural textures and pixel-art dithers. The natural
// ones wrap around at the square's edges, so that they tile seamlessly between neighbouring squares. Knows
// nothing about the DOM, so it can be tested on its own.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WeaveGrains = factory();
})(this, function () {

  const TILE_PX = 24;
  const PIXELS = TILE_PX * TILE_PX;
  const FAMILIES = ['album', 'natural', 'dither'];

  // A repeatable stream of random numbers from 0 to 1, so the same seed always generates the same patterns.
  function randomFrom(seed){
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fieldOf(valueAt){
    let values = new Array(PIXELS);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) values[y * TILE_PX + x] = valueAt(x, y);
    }
    return values;
  }

  // Smooth noise from a grid of random values, cells across the square, wrapping at its edges.
  function noiseOf(random, cells){
    let lattice = Array.from({ length: cells * cells }, random);
    let size = TILE_PX / cells;
    let smooth = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      let gx = x / size, gy = y / size;
      let x0 = Math.floor(gx), y0 = Math.floor(gy);
      let tx = smooth(gx - x0), ty = smooth(gy - y0);
      let at = (cx, cy) => lattice[(cy % cells) * cells + (cx % cells)];
      let top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      let bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      return top * (1 - ty) + bottom * ty;
    };
  }

  // Layers of noise, coarse to fine.
  function layeredNoise(random, layers){
    let noises = layers.map(([cells, weight]) => ({ noise: noiseOf(random, cells), weight }));
    return (x, y) => noises.reduce((sum, { noise, weight }) => sum + noise(x, y) * weight, 0);
  }

  // The classic 4x4 ordered-dither thresholds, from 0 to just under 1.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16);
  const bayerAt = (x, y) => BAYER[(y % 4) * 4 + (x % 4)];

  // Every pattern, by family. Each makes a field of values from a random stream, and the art if it needs it.
  const PATTERNS = [
    { family: 'album', name: 'Album patch', make: albumPatch },

    { family: 'natural', name: 'Clouds', make: (random) => fieldOf(layeredNoise(random, [[3, 0.6], [6, 0.3], [12, 0.1]])) },
    { family: 'natural', name: 'Speckle', make: (random) => {
      let base = noiseOf(random, 6);
      let field = fieldOf((x, y) => base(x, y) * 0.4);
      let specks = 20 + Math.floor(random() * 40);
      for (let i = 0; i < specks; i++) field[Math.floor(random() * PIXELS)] = 0.6 + random() * 0.4;
      return field;
    } },
    { family: 'natural', name: 'Moss', make: (random) => {
      let clumps = layeredNoise(random, [[4, 0.7], [8, 0.3]]);
      let fine = noiseOf(random, 12);
      return fieldOf((x, y) => {
        let t = Math.min(1, Math.max(0, (clumps(x, y) - 0.42) / 0.16));
        return t * t * (3 - 2 * t) + fine(x, y) * 0.25;
      });
    } },
    { family: 'natural', name: 'Veins', make: (random) => {
      let noise = layeredNoise(random, [[3, 0.7], [6, 0.3]]);
      return fieldOf((x, y) => (1 - Math.abs(2 * noise(x, y) - 1)) ** 3);
    } },
    { family: 'natural', name: 'Stones', make: (random) => {
      // Darkest along the cracks between neighbouring stones, wrapping at the edges.
      let points = Array.from({ length: 5 + Math.floor(random() * 6) }, () => ({ x: random() * TILE_PX, y: random() * TILE_PX }));
      let wrapped = (a, b) => Math.min(Math.abs(a - b), TILE_PX - Math.abs(a - b));
      return fieldOf((x, y) => {
        let distances = points.map(p => Math.hypot(wrapped(x + 0.5, p.x), wrapped(y + 0.5, p.y))).sort((a, b) => a - b);
        return distances[1] - distances[0];
      });
    } },

    { family: 'dither', name: 'Checker', make: (random) => {
      let fade = noiseOf(random, 3);
      return fieldOf((x, y) => ((x + y) % 2) + fade(x, y) * 0.01);
    } },
    { family: 'dither', name: 'Dither fade', make: (random) => {
      let angle = Math.floor(random() * 8) * Math.PI / 4;
      let radial = random() < 0.25;
      let along = (x, y) => radial
        ? Math.hypot(x - TILE_PX / 2 + 0.5, y - TILE_PX / 2 + 0.5) / (TILE_PX * 0.7)
        : ((x - TILE_PX / 2) * Math.cos(angle) + (y - TILE_PX / 2) * Math.sin(angle)) / TILE_PX + 0.5;
      return fieldOf((x, y) => along(x, y) + (bayerAt(x, y) - 0.5) * 0.5);
    } },
    { family: 'dither', name: 'Dithered clouds', make: (random) => {
      let noise = layeredNoise(random, [[3, 0.7], [6, 0.3]]);
      return fieldOf((x, y) => noise(x, y) + (bayerAt(x, y) - 0.5) * 0.35);
    } },
  ];

  // The light and dark of a random square of the art, turned or flipped, from the most varied of a few tries.
  function albumPatch(random, art){
    let best = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      let left = Math.floor(random() * (art.width - TILE_PX + 1));
      let top = Math.floor(random() * (art.height - TILE_PX + 1));
      let field = fieldOf((x, y) => {
        let i = ((top + y) * art.width + left + x) * 4;
        return 0.2126 * art.pixels[i] + 0.7152 * art.pixels[i + 1] + 0.0722 * art.pixels[i + 2];
      });
      let mean = field.reduce((sum, v) => sum + v, 0) / PIXELS;
      let spread = field.reduce((sum, v) => sum + (v - mean) ** 2, 0);
      if (!best || spread > best.spread) best = { field, spread };
    }

    let turn = Math.floor(random() * 8);
    return fieldOf((x, y) => {
      let [sx, sy] = turn & 1 ? [y, x] : [x, y];
      if (turn & 2) sx = TILE_PX - 1 - sx;
      if (turn & 4) sy = TILE_PX - 1 - sy;
      return best.field[sy * TILE_PX + sx];
    });
  }

  // A page of candidates from the families wanted, the same every time for the same seed. Album patches are
  // only offered with the art to take them from.
  function candidates({ seed, count, families, art }){
    let wanted = PATTERNS.filter(pattern => families.includes(pattern.family) && (pattern.family !== 'album' || art));
    if (wanted.length === 0) return [];

    let random = randomFrom(seed);
    let offset = Math.floor(random() * wanted.length);
    return Array.from({ length: count }, (_, i) => {
      let pattern = wanted[(offset + i) % wanted.length];
      return { name: pattern.name, family: pattern.family, values: pattern.make(randomFrom(Math.floor(random() * 4294967296)), art) };
    });
  }

  // Breaks ties between pixels of the same value in a scattered order, rather than top to bottom.
  function scatter(index){
    return Math.imul(index + 1, 2654435761) >>> 0;
  }

  // Which of a balance's colours, darkest first, goes on each pixel: the darkest values get the darkest
  // colour, and so on, each covering its share of the square, to within a pixel.
  function bake(values, shares){
    let total = shares.reduce((sum, share) => sum + share, 0);
    let order = values.map((value, index) => index).sort((a, b) => values[a] - values[b] || scatter(a) - scatter(b));
    let colors = new Array(values.length).fill(0);
    let index = 0, reached = shares[0] ?? 0;
    order.forEach((pixel, rank) => {
      while (index < shares.length - 1 && (rank + 0.5) / order.length * total > reached) reached += shares[++index];
      colors[pixel] = index;
    });
    return colors;
  }

  // A drawing's pixels with a baked pattern painted over everything it filled with its mix, as solid colours
  // that can be edited one by one. Its shape, outline and highlights stay as they were.
  function paintInto(paints, colors){
    return [...paints].map((paint, i) => (paint === 'G' || '1234'.includes(paint) ? String(colors[i] + 1) : paint)).join('');
  }

  return { FAMILIES, PATTERNS, candidates, bake, paintInto };
});
