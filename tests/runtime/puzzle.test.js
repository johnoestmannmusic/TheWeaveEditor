// Run with: node --test tests/runtime/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { placeObject, eraseObject, suggestLetter, pickPalette } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const wall = (col, row) => ({ kind: 'Wall', col, row });
const stream = (col, row, direction = 'Up') => ({ kind: 'Stream', col, row, direction });
const lettered = (kind, letter, col = 0, row = 0) => ({ kind, letter, col, row });

// RGBA bytes for a list of [r, g, b, howMany].
function pixelsOf(...runs){
  let bytes = [];
  for (const [r, g, b, count] of runs) {
    for (let i = 0; i < count; i++) bytes.push(r, g, b, 255);
  }
  return Uint8ClampedArray.from(bytes);
}

const toRgb = (hex) => { let v = parseInt(hex.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };

test('placing an object replaces the object on that square, but keeps a Stream under it', () => {
  let board = placeObject([wall(1, 1), stream(1, 1)], { kind: 'Key', col: 1, row: 1 });
  assert.deepEqual(board.map(o => o.kind).sort(), ['Key', 'Stream']);
});

test('placing a Stream replaces a Stream, but keeps the object on it', () => {
  let board = placeObject([wall(1, 1), stream(1, 1, 'Up')], stream(1, 1, 'Left'));
  assert.equal(board.length, 2);
  assert.equal(board.find(o => o.kind === 'Stream').direction, 'Left');
  assert.ok(board.some(o => o.kind === 'Wall'));
});

test('there is only ever one Start, wherever it is placed', () => {
  let board = placeObject([{ kind: 'Start', col: 5, row: 9 }], { kind: 'Start', col: 2, row: 2 });
  assert.deepEqual(board, [{ kind: 'Start', col: 2, row: 2 }]);
});

test('Start can\'t be replaced or erased, but can be moved onto an object, and sit on a Stream', () => {
  let start = { kind: 'Start', col: 5, row: 9 };
  assert.deepEqual(placeObject([start], wall(5, 9)), [start]);
  assert.deepEqual(eraseObject([start], { col: 5, row: 9 }), [start]);
  assert.deepEqual(placeObject([start, wall(1, 1)], { kind: 'Start', col: 1, row: 1 }), [{ kind: 'Start', col: 1, row: 1 }]);
  assert.equal(placeObject([start], stream(5, 9)).length, 2);
  assert.deepEqual(eraseObject([start, stream(5, 9)], { col: 5, row: 9 }), [start]);
});

test('placing leaves the original board alone', () => {
  let original = [wall(1, 1)];
  placeObject(original, wall(1, 1));
  assert.equal(original.length, 1);
});

test('erasing takes the object first, then the Stream it was on, and ignores an empty square', () => {
  let board = eraseObject([stream(1, 1), wall(1, 1)], { col: 1, row: 1 });
  assert.deepEqual(board.map(o => o.kind), ['Stream']);
  board = eraseObject(board, { col: 1, row: 1 });
  assert.deepEqual(board, []);
  assert.deepEqual(eraseObject([wall(2, 2)], { col: 1, row: 1 }), [wall(2, 2)]);
});

test('a Teleporter is offered the letter of its unfinished pair, then a new one', () => {
  assert.equal(suggestLetter([], 'Teleporter'), 'A');
  assert.equal(suggestLetter([lettered('Teleporter', 'A')], 'Teleporter'), 'A');
  assert.equal(suggestLetter([lettered('Teleporter', 'A'), lettered('Teleporter', 'A')], 'Teleporter'), 'B');
});

test('a Switch is offered its Gate\'s letter, and a Gate its Switch\'s', () => {
  assert.equal(suggestLetter([lettered('Gate', 'A')], 'Switch'), 'A');
  assert.equal(suggestLetter([lettered('Switch', 'C')], 'Gate'), 'C');
  assert.equal(suggestLetter([lettered('Gate', 'A'), lettered('Switch', 'A')], 'Gate'), 'B');
});

test('Teleporter letters are separate from Gate and Switch letters', () => {
  assert.equal(suggestLetter([lettered('Gate', 'A'), lettered('Switch', 'A')], 'Teleporter'), 'A');
});

test('every colour in a palette is an exact colour from the art', () => {
  let art = [[200, 30, 30, 300], [30, 200, 30, 300], [30, 30, 200, 300], [230, 230, 60, 300], [20, 20, 20, 300], [240, 240, 240, 300], [150, 110, 80, 300], [90, 170, 170, 300]];
  let palette = pickPalette(pixelsOf(...art));
  let inArt = new Set(art.map(([r, g, b]) => `${r},${g},${b}`));
  for (const [role, hex] of Object.entries(palette)) {
    assert.ok(inArt.has(toRgb(hex).join(',')), `${role} is ${hex}`);
  }
});

test('a colourful palette gives the main objects different colours', () => {
  let palette = pickPalette(pixelsOf([200, 30, 30, 300], [30, 200, 30, 300], [30, 30, 200, 300], [230, 230, 60, 300], [20, 20, 20, 300], [240, 240, 240, 300], [150, 110, 80, 300], [90, 170, 170, 300]));
  let main = [palette.wall, palette.finish, palette.gate, palette.teleporter, palette.stream, palette.key];
  assert.equal(new Set(main).size, main.length, main.join(' '));
  assert.equal(palette.gate, palette.switch);
});

test('the outline is the art\'s darkest colour, and the light colour its lightest', () => {
  let palette = pickPalette(pixelsOf([120, 40, 40, 500], [20, 10, 10, 500], [240, 220, 200, 500]));
  assert.equal(palette.outline, '#140a0a');
  assert.equal(palette.light, '#f0dcc8');
});

test('art with a single colour still gives a complete palette', () => {
  let palette = pickPalette(pixelsOf([50, 60, 70, 100]));
  for (const role of ['wall', 'finish', 'gate', 'switch', 'teleporter', 'stream', 'key', 'outline', 'light']) {
    assert.equal(palette[role], '#323c46', role);
  }
});

test('a speck of colour too small to matter isn\'t chosen', () => {
  let palette = pickPalette(pixelsOf([120, 120, 120, 20000], [200, 200, 200, 20000], [255, 0, 255, 1]));
  assert.ok(!Object.values(palette).includes('#ff00ff'));
});

test('transparent pixels are ignored, and fully transparent art is still handled', () => {
  let bytes = Uint8ClampedArray.from([10, 200, 10, 255, 255, 0, 0, 0]);
  assert.equal(pickPalette(bytes).finish, '#0ac80a');
  assert.equal(pickPalette(Uint8ClampedArray.from([255, 0, 0, 0])).finish, '#000000');
});
