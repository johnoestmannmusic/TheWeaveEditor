// Run with: node --test tests/runtime/*.test.js
// The Drawings view's PNG files (src/TheWeave.EditorApp/wwwroot/drawingPng.js), tested here beside the runtime's
// since they're plain JS with no DOM either.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PNG_KEY, layersOf, toImage, fromImage } = require('../../src/TheWeave.EditorApp/wwwroot/drawingPng.js');
const { standardDrawing } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const PIXELS = 24 * 24;
const every = '.OHG1234'.repeat(PIXELS / 8);

// An image enlarged by a whole number, every pixel copied that many times each way.
function enlarge(image, scale){
  let width = image.width * scale, height = image.height * scale;
  let data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let from = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
      data.set(image.data.slice(from, from + 4), (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

test('every paint has its own colour in the key, and Clear is see-through', () => {
  assert.deepEqual(PNG_KEY.map(entry => entry.paint).sort(), [...'.1234GHO'].sort());
  let colours = PNG_KEY.filter(entry => entry.rgb).map(entry => entry.rgb.join());
  assert.equal(new Set(colours).size, colours.length);
  assert.equal(PNG_KEY.find(entry => entry.paint === '.').rgb, null);
});

test('a drawing\'s layers go side by side, in the Drawings view\'s order', () => {
  assert.deepEqual(layersOf(standardDrawing('Wall')), ['pixels']);
  assert.deepEqual(layersOf(standardDrawing('Gate')), ['pixels', 'openPixels']);
  assert.deepEqual(layersOf(standardDrawing('Stream')), ['pixels', 'bendPixels', 'flowPixels']);
  assert.deepEqual(layersOf(standardDrawing('RotatorTile')), ['pixels', 'flowPixels']);
  let image = toImage(standardDrawing('Stream'), standardDrawing('Stream'));
  assert.equal(image.width, 72);
  assert.equal(image.height, 24);
});

test('every paint survives a PNG and back, exactly', () => {
  let standard = standardDrawing('Stream');
  let drawing = { ...standard, pixels: every, bendPixels: [...every].reverse().join(''), flowPixels: every.slice(3) + every.slice(0, 3) };
  let { layers, inexact } = fromImage(toImage(drawing, standard), standard);
  assert.equal(inexact, 0);
  assert.deepEqual(layers, { pixels: drawing.pixels, bendPixels: drawing.bendPixels, flowPixels: drawing.flowPixels });
});

test('an enlarged PNG comes back the same, whatever whole number it\'s enlarged by', () => {
  let standard = standardDrawing('Gate');
  let image = toImage({ ...standard, pixels: every }, standard);
  for (const scale of [2, 3, 8]) {
    let { layers, inexact } = fromImage(enlarge(image, scale), standard);
    assert.equal(inexact, 0, `${scale}x`);
    assert.equal(layers.pixels, every, `${scale}x`);
    assert.equal(layers.openPixels, standard.openPixels, `${scale}x`);
  }
});

test('a single layer on its own fills just the first', () => {
  let standard = standardDrawing('Gate');
  let single = toImage({ ...standardDrawing('Wall'), pixels: every }, standardDrawing('Wall'));
  let { layers } = fromImage(enlarge(single, 4), standard);
  assert.deepEqual(Object.keys(layers), ['pixels']);
  assert.equal(layers.pixels, every);
});

test('colours off the key become the nearest paint, and are counted', () => {
  let standard = standardDrawing('Wall');
  let image = toImage({ ...standard, pixels: '3'.repeat(PIXELS) }, standard);
  image.data.set([170, 150, 160, 255], 0); // a little off Colour 3's grey
  image.data.set([250, 20, 240, 255], 4); // nearly Grain's magenta
  image.data.set([0, 0, 0, 40], 8); // faintly there: Clear
  let { layers, inexact } = fromImage(image, standard);
  assert.equal(layers.pixels.slice(0, 4), '3G.3');
  assert.equal(inexact, 3);
});

test('an image of any other size is turned away, saying what it should be', () => {
  let standard = standardDrawing('Stream');
  for (const [width, height] of [[48, 24], [24, 20], [100, 50], [72, 30]]) {
    let image = { data: new Uint8ClampedArray(width * height * 4), width, height };
    assert.throws(() => fromImage(image, standard), /72×24/, `${width}x${height}`);
  }
});
