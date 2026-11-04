// Run with: node --test tests/runtime/*.test.js
// The Editor's pattern generators (src/TheWeave.EditorApp/wwwroot/grainPatterns.js), tested here beside the
// runtime's since they're plain JS with no DOM either.
const test = require('node:test');
const assert = require('node:assert/strict');
const { FAMILIES, PATTERNS, candidates, bake, paintInto } = require('../../src/TheWeave.EditorApp/wwwroot/grainPatterns.js');

const PIXELS = 24 * 24;

// A 240x240 art with a soft diagonal ramp and a dithered band, so every patch has something in it.
function makeArt(){
  let pixels = new Uint8ClampedArray(240 * 240 * 4);
  for (let y = 0; y < 240; y++) {
    for (let x = 0; x < 240; x++) {
      let v = (x + y) % 256;
      if (y > 100 && y < 140 && (x + y) % 2) v = 255 - v;
      pixels.set([v, v, v, 255], (y * 240 + x) * 4);
    }
  }
  return { pixels, width: 240, height: 240 };
}

test('every family has patterns, and each makes a full square that isn\'t flat', () => {
  for (const family of FAMILIES) assert.ok(PATTERNS.some(p => p.family === family), family);
  let page = candidates({ seed: 7, count: PATTERNS.length * 2, families: FAMILIES, art: makeArt() });
  assert.deepEqual(new Set(page.map(c => c.name)), new Set(PATTERNS.map(p => p.name)));
  for (const candidate of page) {
    assert.equal(candidate.values.length, PIXELS, candidate.name);
    assert.ok(candidate.values.every(Number.isFinite), candidate.name);
    assert.ok(new Set(candidate.values).size > 1, `${candidate.name} isn't flat`);
  }
});

test('the same seed gives the same page, and the next seed a different one', () => {
  let options = { count: 8, families: FAMILIES, art: makeArt() };
  assert.deepEqual(candidates({ ...options, seed: 3 }), candidates({ ...options, seed: 3 }));
  assert.notDeepEqual(candidates({ ...options, seed: 3 }), candidates({ ...options, seed: 4 }));
});

test('only the families asked for, and no album patches without the art', () => {
  let natural = candidates({ seed: 1, count: 8, families: ['natural'], art: makeArt() });
  assert.ok(natural.length === 8 && natural.every(c => c.family === 'natural'));
  assert.ok(candidates({ seed: 1, count: 8, families: FAMILIES, art: null }).every(c => c.family !== 'album'));
  assert.deepEqual(candidates({ seed: 1, count: 8, families: ['album'], art: null }), []);
});

test('a baked pattern gives each colour its share of the square, to within a pixel, darkest values darkest', () => {
  for (const candidate of candidates({ seed: 11, count: 9, families: FAMILIES, art: makeArt() })) {
    let shares = [10, 35, 40, 15];
    let colors = bake(candidate.values, shares);
    shares.forEach((share, index) => {
      let count = colors.filter(c => c === index).length;
      assert.ok(Math.abs(count - share / 100 * PIXELS) <= 1, `${candidate.name}: colour ${index} has ${count}`);
    });
    for (let a = 0; a < PIXELS; a += 7) {
      for (let b = 0; b < PIXELS; b += 5) if (candidate.values[a] < candidate.values[b]) assert.ok(colors[a] <= colors[b], candidate.name);
    }
  }
});

test('shares are taken in proportion, and one colour covers everything', () => {
  let values = candidates({ seed: 2, count: 1, families: ['natural'] })[0].values;
  assert.deepEqual(bake(values, [1, 3]), bake(values, [25, 75]));
  assert.ok(bake(values, [100]).every(c => c === 0));
});

test('a checker split half and half between two colours is a true checkerboard', () => {
  let checker = candidates({ seed: 5, count: 9, families: ['dither'] }).find(c => c.name === 'Checker');
  let colors = bake(checker.values, [50, 50]);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) assert.equal(colors[y * 24 + x], (x + y) % 2);
});

test('natural patterns wrap around, so neighbouring squares meet without a seam', () => {
  for (const candidate of candidates({ seed: 9, count: 10, families: ['natural'] }).filter(c => c.name !== 'Speckle')) {
    let v = candidate.values;
    let range = Math.max(...v) - Math.min(...v);
    let jump = (a, b) => Math.abs(v[a] - v[b]) / range;
    let inside = 0, across = 0;
    for (let y = 0; y < 24; y++) {
      inside = Math.max(inside, jump(y * 24 + 11, y * 24 + 12));
      across = Math.max(across, jump(y * 24 + 23, y * 24));
    }
    assert.ok(across <= Math.max(inside * 2, 0.35), `${candidate.name}: ${across.toFixed(2)} across the edge, ${inside.toFixed(2)} inside`);
  }
});

test('painting a pattern in replaces only what the mix filled, keeping the shape, outline and highlights', () => {
  let paints = ('..OOGG1234HH').repeat(48);
  let colors = Array.from({ length: PIXELS }, (_, i) => i % 3);
  let painted = paintInto(paints, colors);
  [...paints].forEach((paint, i) => {
    if ('G1234'.includes(paint)) assert.equal(painted[i], String(colors[i] + 1));
    else assert.equal(painted[i], paint);
  });
});
