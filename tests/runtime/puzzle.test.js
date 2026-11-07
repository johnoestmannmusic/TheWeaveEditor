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

// ---------- playing ----------

const { createPuzzleGame, hasFinish } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const at = (col, row) => ({ col, row });
const game = (...objects) => createPuzzleGame({ objects, palette: {} });
const obj = (kind, col, row, extra = {}) => ({ kind, col, row, ...extra });
const find = (g, kind) => g.objects.find(o => o.kind === kind);

test('the ship begins on Start, or the default square if there is none', () => {
  assert.deepEqual(game(obj('Start', 2, 3)).start, at(2, 3));
  assert.deepEqual(game().start, at(5, 9));
  assert.deepEqual(game(obj('Start', 2, 3)).shipCell, at(2, 3));
});

test('a Wall blocks the ship, and an empty square does not', () => {
  let g = game(obj('Wall', 3, 3));
  assert.equal(g.canEnter(at(2, 3), at(3, 3), 'right'), false);
  assert.equal(g.canEnter(at(2, 4), at(3, 4), 'right'), true);
});

test('a Stream holds the ship: the only way off is the way it\'s going', () => {
  let g = game(obj('Stream', 3, 3, { direction: 'Right' }));
  assert.equal(g.canEnter(at(3, 3), at(4, 3), 'right'), true);
  assert.equal(g.canEnter(at(3, 3), at(2, 3), 'left'), false);
  assert.equal(g.canEnter(at(3, 3), at(3, 2), 'up'), false);
  assert.equal(g.canEnter(at(3, 3), at(3, 4), 'down'), false);
});

test('a Stream can be stepped onto from behind or the side, but not head-on', () => {
  let g = game(obj('Stream', 3, 3, { direction: 'Right' }));
  assert.equal(g.canEnter(at(2, 3), at(3, 3), 'right'), true);
  assert.equal(g.canEnter(at(3, 2), at(3, 3), 'down'), true);
  assert.equal(g.canEnter(at(3, 4), at(3, 3), 'up'), true);
  assert.equal(g.canEnter(at(4, 3), at(3, 3), 'left'), false);
});

test('a Stream hands the ship on around a corner, but two facing each other hold it', () => {
  let corner = game(obj('Stream', 3, 3, { direction: 'Right' }), obj('Stream', 4, 3, { direction: 'Down' }));
  assert.equal(corner.canEnter(at(3, 3), at(4, 3), 'right'), true);
  assert.equal(corner.canEnter(at(4, 3), at(4, 4), 'down'), true);

  let facing = game(obj('Stream', 3, 3, { direction: 'Right' }), obj('Stream', 4, 3, { direction: 'Left' }));
  assert.equal(facing.canEnter(at(3, 3), at(4, 3), 'right'), false);
});

test('something solid at the end of a Stream holds the ship on it', () => {
  let g = game(obj('Stream', 3, 3, { direction: 'Right' }), obj('Wall', 4, 3));
  assert.equal(g.canEnter(at(3, 3), at(4, 3), 'right'), false);
  assert.equal(g.canEnter(at(3, 3), at(3, 2), 'up'), false);
});

test('a Stream reports which way it carries, in the mover\'s terms', () => {
  let g = game(obj('Stream', 3, 3, { direction: 'Up' }));
  assert.equal(g.carryDirection(at(3, 3)), 'up');
  assert.equal(g.carryDirection(at(4, 3)), null);
});

test('a Gate blocks until its own Switch opens it', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Gate', 2, 0, { letter: 'B' }), obj('Switch', 5, 5, { letter: 'A' }));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), false);
  g.shipArrivedAt(at(5, 5));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), true);
  assert.equal(g.canEnter(at(2, 1), at(2, 0), 'up'), false);
});

test('stepping on a Switch again closes its Gates again', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }));
  g.shipArrivedAt(at(5, 5));
  assert.equal(find(g, 'Gate').open, true);
  g.shipArrivedAt(at(5, 5));
  assert.equal(find(g, 'Gate').open, false);
});

test('a Gate can start open, and a Switch flips each Gate from whatever state it\'s in', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A', open: true }), obj('Gate', 2, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), true);
  assert.equal(g.canEnter(at(2, 1), at(2, 0), 'up'), false);
  g.shipArrivedAt(at(5, 5));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), false);
  assert.equal(g.canEnter(at(2, 1), at(2, 0), 'up'), true);
});

test('switchesActive is false until the last Key is collected, and true with no Keys at all', () => {
  assert.equal(game().switchesActive, true);
  let g = game(obj('Key', 6, 6), obj('Key', 7, 7));
  assert.equal(g.switchesActive, false);
  g.shipArrivedAt(at(6, 6));
  assert.equal(g.switchesActive, false);
  g.shipArrivedAt(at(7, 7));
  assert.equal(g.switchesActive, true);
});

test('a Switch works every Gate with its letter', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Gate', 2, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }));
  g.shipArrivedAt(at(5, 5));
  assert.ok(g.objects.filter(o => o.kind === 'Gate').every(o => o.open));
});

test('Switches do nothing until every Key is collected, then need stepping on again', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }), obj('Key', 6, 6), obj('Key', 7, 7));
  g.shipArrivedAt(at(5, 5));
  assert.equal(find(g, 'Gate').open, false);
  g.shipArrivedAt(at(6, 6));
  g.shipArrivedAt(at(5, 5));
  assert.equal(find(g, 'Gate').open, false);
  g.shipArrivedAt(at(7, 7));
  assert.equal(find(g, 'Gate').open, false);
  g.shipArrivedAt(at(5, 5));
  assert.equal(find(g, 'Gate').open, true);
});

test('a Key disappears once collected, and doesn\'t block the ship', () => {
  let g = game(obj('Key', 6, 6));
  assert.equal(g.canEnter(at(5, 6), at(6, 6), 'right'), true);
  assert.equal(g.shipArrivedAt(at(6, 6)), null);
  assert.equal(find(g, 'Key'), undefined);
});

test('a Teleporter sends the ship to the other with its letter', () => {
  let g = game(obj('Teleporter', 1, 1, { letter: 'A' }), obj('Teleporter', 8, 8, { letter: 'A' }), obj('Teleporter', 4, 4, { letter: 'B' }), obj('Teleporter', 5, 5, { letter: 'B' }));
  assert.deepEqual(g.shipArrivedAt(at(1, 1)), { teleportTo: at(8, 8) });
  assert.deepEqual(g.shipCell, at(8, 8));
  assert.deepEqual(g.shipArrivedAt(at(8, 8)), { teleportTo: at(1, 1) });
});

test('landing on a Teleporter doesn\'t fire it again, because landing isn\'t stepping on', () => {
  let g = game(obj('Teleporter', 1, 1, { letter: 'A' }), obj('Teleporter', 8, 8, { letter: 'A' }));
  g.shipArrivedAt(at(1, 1));
  assert.equal(g.tick(null), null);
  assert.deepEqual(g.shipCell, at(8, 8));
});

test('a Teleporter with no partner, or too many, does nothing', () => {
  assert.equal(game(obj('Teleporter', 1, 1, { letter: 'A' })).shipArrivedAt(at(1, 1)), null);
  let g = game(obj('Teleporter', 1, 1, { letter: 'A' }), obj('Teleporter', 2, 1, { letter: 'A' }), obj('Teleporter', 3, 1, { letter: 'A' }));
  assert.equal(g.shipArrivedAt(at(1, 1)), null);
});

test('Teleporter letters have nothing to do with Gate letters', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Teleporter', 1, 1, { letter: 'A' }), obj('Teleporter', 8, 8, { letter: 'A' }));
  g.shipArrivedAt(at(1, 1));
  assert.equal(find(g, 'Gate').open, false);
});

test('reaching Finish solves the puzzle', () => {
  let g = game(obj('Finish', 3, 3));
  assert.equal(g.isSolved, false);
  assert.deepEqual(g.shipArrivedAt(at(3, 3)), { finished: true });
  assert.equal(g.isSolved, true);
});

test('hasFinish is what decides whether a puzzle can hold anything back', () => {
  assert.equal(hasFinish({ objects: [obj('Finish', 1, 1)] }), true);
  assert.equal(hasFinish({ objects: [obj('Wall', 1, 1)] }), false);
  assert.equal(hasFinish(null), false);
});

const line = (...cols) => cols.map(col => obj('Stream', col, 5, { direction: 'Right' }));

test('an object on a Stream moves along it a square per tick, and stops at the end', () => {
  let g = game(...line(1, 2, 3), obj('Wall', 1, 5));
  g.tick(null);
  assert.deepEqual([find(g, 'Wall').col, find(g, 'Wall').fromCol], [2, 1]);
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 3);
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 3);
  assert.equal(find(g, 'Wall').fromCol, 3);
});

test('a Stream itself stays put, and objects not on one don\'t move', () => {
  let g = game(...line(1, 2), obj('Wall', 8, 8));
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 8);
  assert.deepEqual(g.carryDirection(at(1, 5)), 'right');
});

test('a line of objects moves together, and waits behind anything stopped', () => {
  let g = game(...line(1, 2, 3, 4), obj('Wall', 1, 5), obj('Key', 2, 5), obj('Finish', 4, 5));
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 2);
  assert.equal(find(g, 'Key').col, 3);
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 2);
  assert.equal(find(g, 'Key').col, 3);
  assert.equal(find(g, 'Finish').col, 4);
});

test('a full loop of objects circulates forever', () => {
  let loop = [obj('Stream', 1, 1, { direction: 'Right' }), obj('Stream', 2, 1, { direction: 'Down' }), obj('Stream', 2, 2, { direction: 'Left' }), obj('Stream', 1, 2, { direction: 'Up' })];
  let g = game(...loop, obj('Wall', 1, 1), obj('Key', 2, 1), obj('Finish', 2, 2), obj('Switch', 1, 2, { letter: 'A' }));
  g.tick(null);
  assert.deepEqual([find(g, 'Wall').col, find(g, 'Wall').row], [2, 1]);
  assert.deepEqual([find(g, 'Key').col, find(g, 'Key').row], [2, 2]);
  assert.deepEqual([find(g, 'Finish').col, find(g, 'Finish').row], [1, 2]);
  assert.deepEqual([find(g, 'Switch').col, find(g, 'Switch').row], [1, 1]);
  g.tick(null); g.tick(null); g.tick(null);
  assert.deepEqual([find(g, 'Wall').col, find(g, 'Wall').row], [1, 1]);
});

test('two objects facing each other on Streams can\'t swap', () => {
  let g = game(obj('Stream', 1, 1, { direction: 'Right' }), obj('Stream', 2, 1, { direction: 'Left' }), obj('Wall', 1, 1), obj('Key', 2, 1));
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 1);
  assert.equal(find(g, 'Key').col, 2);
});

test('two objects moving onto one square: the first goes, the other waits', () => {
  let g = game(obj('Stream', 1, 1, { direction: 'Right' }), obj('Stream', 3, 1, { direction: 'Left' }), obj('Stream', 2, 1, { direction: 'Up' }), obj('Wall', 1, 1), obj('Key', 3, 1));
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 2);
  assert.equal(find(g, 'Key').col, 3);
});

test('a solid object waits rather than moving onto the ship, or onto where it\'s heading', () => {
  let g = game(obj('Start', 2, 5), ...line(1, 2, 3), obj('Wall', 1, 5));
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 1);

  let h = game(obj('Start', 5, 5), ...line(1, 2, 3), obj('Wall', 1, 5));
  h.tick(at(2, 5));
  assert.equal(find(h, 'Wall').col, 1);
});

test('a closed Gate on a Stream waits for the ship, and an open one doesn\'t', () => {
  let g = game(obj('Start', 2, 5), ...line(1, 2, 3), obj('Gate', 1, 5, { letter: 'A' }), obj('Switch', 8, 8, { letter: 'A' }));
  g.tick(null);
  assert.equal(find(g, 'Gate').col, 1);
  g.shipArrivedAt(at(8, 8));
  g.shipArrivedAt(at(2, 5));
  g.tick(null);
  assert.equal(find(g, 'Gate').col, 2);
});

test('something moving under a still ship counts as stepping on it', () => {
  let key = game(obj('Start', 2, 5), ...line(1, 2), obj('Key', 1, 5));
  assert.equal(key.tick(null), null);
  assert.equal(find(key, 'Key'), undefined);

  let finish = game(obj('Start', 2, 5), ...line(1, 2), obj('Finish', 1, 5));
  assert.deepEqual(finish.tick(null), { finished: true });

  let teleporter = game(obj('Start', 2, 5), ...line(1, 2), obj('Teleporter', 1, 5, { letter: 'A' }), obj('Teleporter', 8, 8, { letter: 'A' }));
  assert.deepEqual(teleporter.tick(null), { teleportTo: at(8, 8) });

  let toggle = game(obj('Start', 2, 5), ...line(1, 2), obj('Switch', 1, 5, { letter: 'A' }), obj('Gate', 8, 8, { letter: 'A' }));
  toggle.tick(null);
  assert.equal(find(toggle, 'Gate').open, true);
});

test('something moving under a ship that\'s on its way elsewhere doesn\'t count', () => {
  let g = game(obj('Start', 2, 5), ...line(1, 2), obj('Finish', 1, 5));
  assert.equal(g.tick(at(2, 4)), null);
  assert.equal(g.isSolved, false);
});

test('an object sitting still on a Stream under the ship doesn\'t fire again each tick', () => {
  let g = game(obj('Start', 5, 5), obj('Stream', 2, 5, { direction: 'Right' }), obj('Switch', 2, 5, { letter: 'A' }), obj('Gate', 8, 8, { letter: 'A' }));
  g.shipArrivedAt(at(2, 5));
  assert.equal(find(g, 'Gate').open, true);
  g.tick(null);
  g.tick(null);
  assert.equal(find(g, 'Gate').open, true);
});

test('playing never changes the puzzle it was built from', () => {
  let puzzle = { objects: [obj('Key', 1, 1), obj('Stream', 2, 2, { direction: 'Up' }), obj('Stream', 2, 1, { direction: 'Up' }), obj('Wall', 2, 2)], palette: {} };
  let before = JSON.stringify(puzzle);
  let g = createPuzzleGame(puzzle);
  g.shipArrivedAt(at(1, 1));
  g.tick(null);
  assert.equal(JSON.stringify(puzzle), before);
});

// ---------- pixel art ----------

const { pickTextures, renderBoard, TILE_PX, ART_PX } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

// A 240x240 art of two dithered colour families, plus dark and light, so everything has shades to find.
function makeArt(){
  let data = new Uint8ClampedArray(ART_PX * ART_PX * 4);
  for (let y = 0; y < ART_PX; y++) {
    for (let x = 0; x < ART_PX; x++) {
      let i = (y * ART_PX + x) * 4;
      let dither = (x + y) % 2 === 0 ? 0 : 1;
      let color = x < 120
        ? (y < 120 ? [200 + dither * 20, 90 + dither * 15, 40 + dither * 10] : [60 + dither * 15, 150 + dither * 20, 140 + dither * 20])
        : (y < 120 ? [15, 12, 10] : [235 - dither * 15, 230 - dither * 15, 215 - dither * 15]);
      data.set([...color, 255], i);
    }
  }
  return data;
}

const artLook = () => {
  let art = makeArt();
  let palette = pickPalette(art);
  return { art, look: { palette, textures: pickTextures(art, ART_PX, ART_PX, palette) } };
};

const blank = () => ({ data: new Uint8ClampedArray(ART_PX * ART_PX * 4), width: ART_PX, height: ART_PX });
const pixelAt = (image, x, y) => { let i = (y * ART_PX + x) * 4; return [...image.data.slice(i, i + 4)]; };
const colorsIn = (bytes) => { let set = new Set(); for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 3]) set.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`); return set; };
const tile = (image, col, row) => { let out = []; for (let y = row * TILE_PX; y < (row + 1) * TILE_PX; y++) for (let x = col * TILE_PX; x < (col + 1) * TILE_PX; x++) out.push(...pixelAt(image, x, y)); return out.join(); };

test('a texture has 4 shades and a grain, and every shade is an exact colour from the art', () => {
  let { art, look } = artLook();
  let inArt = colorsIn(art);
  for (const [role, texture] of Object.entries(look.textures)) {
    assert.equal(texture.grain.length, TILE_PX * TILE_PX, role);
    assert.match(texture.grain, /^[0-9a-z]+$/);
    assert.equal(texture.ramp.length, 4, role);
    for (const shade of texture.ramp) assert.ok(inArt.has(toRgb(shade).join(',')), `${role}: ${shade}`);
    assert.equal(texture.ramp[2], look.palette[role], `${role} keeps its own colour as its main shade`);
    let lightness = texture.ramp.map(hex => { let [r, g, b] = toRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; });
    assert.ok(lightness.every((value, i) => i === 0 || value >= lightness[i - 1]), `${role} is darkest first`);
    assert.match(texture.pixels, /^[0-3]{576}$/, `${role} keeps its Standard look's pattern`);
  }
});

test('a colour\'s standard mix draws exactly its Standard look\'s pattern', () => {
  let { look } = artLook();
  let { colors, pixels } = mixTexture(look, standardMix('wall'));
  let hexOf = (c) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  assert.deepEqual(pixels.map(index => hexOf(colors[index])), [...look.textures.wall.pixels].map(digit => look.textures.wall.ramp[digit]));
});

test('art with shades gives a grain that really varies', () => {
  let { look } = artLook();
  assert.ok(Object.values(look.textures).some(t => new Set(t.grain).size > 1));
});

test('the same art always gives the same textures', () => {
  assert.deepEqual(artLook().look.textures, artLook().look.textures);
});

test('art with one colour gives a flat texture, without failing', () => {
  let art = new Uint8ClampedArray(ART_PX * ART_PX * 4);
  for (let i = 0; i < art.length; i += 4) art.set([50, 60, 70, 255], i);
  let palette = pickPalette(art);
  let textures = pickTextures(art, ART_PX, ART_PX, palette);
  assert.deepEqual(textures.wall.ramp, ['#323c46', '#323c46', '#323c46', '#323c46']);
  assert.equal(new Set(textures.wall.grain).size, 1);
});

test('the board has only exact colours and no see-through blends, so it stays pixel art', () => {
  let { art, look } = artLook();
  let allowed = colorsIn(art);
  let image = blank();
  let objects = [
    obj('Wall', 0, 0), obj('Finish', 1, 0), obj('Gate', 2, 0, { letter: 'A' }), obj('Gate', 3, 0, { letter: 'B', open: true }),
    obj('Switch', 4, 0, { letter: 'A' }), obj('Teleporter', 5, 0, { letter: 'W' }), obj('Key', 6, 0), obj('Stream', 7, 0, { direction: 'Up' }),
  ];
  renderBoard(image, objects, look, { timeMs: 300 });
  // Only the open Gate is see-through, by half, so it reads as passable - in its own square, at (3, 0).
  for (let i = 0; i < image.data.length; i += 4) {
    let x = (i / 4) % ART_PX, y = Math.floor(i / 4 / ART_PX);
    let inOpenGate = x >= 3 * 24 && x < 4 * 24 && y < 24;
    assert.ok([0, 255].includes(image.data[i + 3]) || (inOpenGate && image.data[i + 3] === 128));
  }
  for (const color of colorsIn(image.data)) assert.ok(allowed.has(color), color);
});

test('every object gets its own shape, and letters change what\'s drawn', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 0), obj('Finish', 1, 0), obj('Switch', 2, 0, { letter: 'A' }), obj('Teleporter', 3, 0, { letter: 'A' }), obj('Key', 4, 0), obj('Gate', 5, 0, { letter: 'A' }), obj('Gate', 6, 0, { letter: 'B' })], look);
  let tiles = [0, 1, 2, 3, 4, 5, 6].map(col => tile(image, col, 0));
  assert.equal(new Set(tiles).size, tiles.length);
});

test('every letter of the alphabet draws something different', () => {
  let { look } = artLook();
  let seen = new Set();
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    let image = blank();
    renderBoard(image, [obj('Gate', 0, 0, { letter })], look);
    seen.add(tile(image, 0, 0));
  }
  assert.equal(seen.size, 26);
});

test('an open Gate is see-through in the middle, and a closed one isn\'t', () => {
  let { look } = artLook();
  let closed = blank(), open = blank();
  renderBoard(closed, [obj('Gate', 0, 0, { letter: 'I' })], look);
  renderBoard(open, [obj('Gate', 0, 0, { letter: 'I', open: true })], look);
  assert.equal(pixelAt(closed, 8, 11)[3], 255);
  assert.equal(pixelAt(open, 8, 11)[3], 0);
});

test('a Switch looks different while it\'s de-activated', () => {
  let { look } = artLook();
  let on = blank(), off = blank();
  renderBoard(on, [obj('Switch', 0, 0, { letter: 'A' })], look, { switchesActive: true });
  renderBoard(off, [obj('Switch', 0, 0, { letter: 'A' })], look, { switchesActive: false });
  assert.notEqual(tile(on, 0, 0), tile(off, 0, 0));
});

test('whatever\'s on a Stream is drawn on top of it, and Start isn\'t drawn at all', () => {
  let { look } = artLook();
  let withWall = blank(), wallOnly = blank(), start = blank();
  renderBoard(withWall, [obj('Wall', 0, 0), obj('Stream', 0, 0, { direction: 'Up' })], look);
  renderBoard(wallOnly, [obj('Wall', 0, 0)], look);
  assert.deepEqual(pixelAt(withWall, 12, 12), pixelAt(wallOnly, 12, 12));
  renderBoard(start, [obj('Start', 0, 0)], look);
  assert.equal(colorsIn(start.data).size, 0);
});

test('a Stream\'s lines move in the direction it runs', () => {
  let { look } = artLook();
  let lineAt = (timeMs, direction) => {
    let image = blank();
    renderBoard(image, [obj('Stream', 0, 0, { direction })], look, { timeMs });
    let out = [];
    for (let i = 0; i < TILE_PX; i++) {
      let [x, y] = direction === 'Right' || direction === 'Left' ? [i, 12] : [12, i];
      out.push(pixelAt(image, x, y)[3] ? 1 : 0);
    }
    return out.join('');
  };
  let step = 900 / 24;
  let rotateRight = (s) => s[s.length - 1] + s.slice(0, -1);
  let rotateLeft = (s) => s.slice(1) + s[0];
  assert.equal(lineAt(step, 'Right'), rotateRight(lineAt(0, 'Right')));
  assert.equal(lineAt(step, 'Down'), rotateRight(lineAt(0, 'Down')));
  assert.equal(lineAt(step, 'Left'), rotateLeft(lineAt(0, 'Left')));
  assert.equal(lineAt(step, 'Up'), rotateLeft(lineAt(0, 'Up')));
});

test('something gliding on a Stream moves in whole pixels of the art', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [{ kind: 'Wall', col: 2, row: 0, fromCol: 1, fromRow: 0 }], look, { along: 0.5 });
  let leftmost = ART_PX;
  for (let x = 0; x < ART_PX; x++) {
    for (let y = 0; y < TILE_PX; y++) {
      if (pixelAt(image, x, y)[3]) { leftmost = Math.min(leftmost, x); }
    }
  }
  assert.equal(leftmost, 36 + 1); // 1.5 squares across, plus the octagon's one-pixel margin in its square
});

test('a puzzle saved before textures still draws, in its plain colours', () => {
  let palette = { wall: '#112233', finish: '#223344', gate: '#334455', switch: '#334455', teleporter: '#445566', stream: '#556677', key: '#667788', outline: '#000000', light: '#ffffff' };
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 0)], { palette });
  assert.deepEqual(pixelAt(image, 12, 12), [0x11, 0x22, 0x33, 255]);
});

// ---------- drawings and mixes ----------

const { standardDrawing, standardMix, mixTexture } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const filled = (paint) => paint.repeat(TILE_PX * TILE_PX);
const drawing = (id, kind, pixels, mix, extra = {}) => ({ id, kind, name: id, pixels, mix, ...extra });
const hexAt = (image, x, y) => '#' + pixelAt(image, x, y).slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');

test('a mix covers each colour\'s percentage of the square, to within a pixel', () => {
  let { look } = artLook();
  let mix = [{ role: 'wall', shade: 2, percent: 60 }, { role: 'teleporter', shade: 2, percent: 25 }, { role: 'outline', shade: 0, percent: 15 }];
  let { colors, pixels } = mixTexture(look, mix);
  assert.equal(colors.length, 3);
  let counts = colors.map((color, index) => pixels.filter(p => p === index).length);
  let wanted = { wall: 0.6, teleporter: 0.25, outline: 0.15 };
  let hexOf = (c) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
  let colorOf = { wall: look.textures.wall.ramp[2], teleporter: look.textures.teleporter.ramp[2], outline: look.palette.outline };
  for (const [role, share] of Object.entries(wanted)) {
    let index = colors.findIndex(c => hexOf(c) === colorOf[role]);
    assert.ok(Math.abs(counts[index] - share * TILE_PX * TILE_PX) <= 1, `${role}: ${counts[index]}`);
  }
});

test('a mix\'s colours come darkest first, laid out in the grain: darker grain, darker colour', () => {
  let { look } = artLook();
  let { colors, pixels } = mixTexture(look, [{ role: 'teleporter', shade: 2, percent: 70 }, { role: 'outline', shade: 0, percent: 30 }]);
  assert.deepEqual([colors[0].r, colors[0].g, colors[0].b], toRgb(look.palette.outline));
  let grain = [...look.textures.teleporter.grain].map(d => parseInt(d, 36));
  for (let a = 0; a < grain.length; a++) {
    for (let b = 0; b < grain.length; b++) if (grain[a] < grain[b]) assert.ok(pixels[a] <= pixels[b]);
  }
});

test('a mix of only the outline and light colours, which have no grain, is flat in its main colour', () => {
  let { look } = artLook();
  let { colors, pixels, main } = mixTexture(look, [{ role: 'light', shade: 0, percent: 70 }, { role: 'outline', shade: 0, percent: 30 }]);
  assert.deepEqual([colors[main].r, colors[main].g, colors[main].b], toRgb(look.palette.light));
  assert.equal(new Set(pixels).size, 1);
});

test('percentages that don\'t add up to 100 are taken in proportion, and an empty mix still draws', () => {
  let { look } = artLook();
  let a = mixTexture(look, [{ role: 'wall', shade: 0, percent: 1 }, { role: 'wall', shade: 3, percent: 3 }]);
  let b = mixTexture(look, [{ role: 'wall', shade: 0, percent: 25 }, { role: 'wall', shade: 3, percent: 75 }]);
  assert.deepEqual(a.pixels, b.pixels);
  assert.equal(mixTexture(look, []).colors.length, 1);
});

test('a Standard drawing is its kind\'s shape, outlined, in its standard mix, and a Gate has an open frame', () => {
  for (const kind of ['Wall', 'Finish', 'Gate', 'Switch', 'Teleporter', 'Key', 'RotatorSwitch', 'Lantern']) {
    let standard = standardDrawing(kind);
    assert.equal(standard.id, kind);
    assert.equal(standard.pixels.length, TILE_PX * TILE_PX);
    assert.match(standard.pixels, /^[.OG]+$/);
    assert.ok(standard.pixels.includes('G') && standard.pixels.includes('O'), kind);
  }
  assert.deepEqual(standardDrawing('Switch').mix, standardMix('gate'));
  let gate = standardDrawing('Gate');
  let middle = 12 * TILE_PX + 12;
  assert.equal(gate.pixels[middle], 'G');
  assert.equal(gate.openPixels[middle], '.');
});

test('a variant draws its own pixels and mix, and only for its own kind', () => {
  let { look } = artLook();
  let drawings = [drawing('w-solid', 'Wall', filled('1'), [{ role: 'key', shade: 2, percent: 100 }])];
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 0, { variant: 'w-solid' }), obj('Wall', 1, 0), obj('Key', 2, 0, { variant: 'w-solid' })], { ...look, drawings });
  assert.equal(hexAt(image, 0, 0), look.palette.key, 'the variant fills its whole square');
  assert.equal(pixelAt(image, 24, 0)[3], 0, 'a Wall with no variant is still the Standard octagon');
  let standardKey = blank();
  renderBoard(standardKey, [obj('Key', 2, 0)], look);
  assert.equal(tile(image, 2, 0), tile(standardKey, 2, 0), 'a Key can\'t use a Wall\'s drawing');
});

test('an unknown variant falls back to Standard', () => {
  let { look } = artLook();
  let a = blank(), b = blank();
  renderBoard(a, [obj('Wall', 0, 0, { variant: 'gone' })], { ...look, drawings: [] });
  renderBoard(b, [obj('Wall', 0, 0)], look);
  assert.equal(tile(a, 0, 0), tile(b, 0, 0));
});

test('a redrawn Standard drawing is used by everything of its kind without a variant', () => {
  let { look } = artLook();
  let drawings = [drawing('Wall', 'Wall', filled('H'), standardMix('wall'))];
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 0), obj('Wall', 1, 0)], { ...look, drawings, depth: 'flat' });
  assert.equal(hexAt(image, 0, 0), look.palette.light);
  assert.equal(hexAt(image, 47, 23), look.palette.light);
});

test('an open Gate draws its drawing\'s open frame, and a de-activated Switch is still checkered over a drawing', () => {
  let { look } = artLook();
  let drawings = [
    drawing('g', 'Gate', filled('3'), standardMix('gate'), { openPixels: filled('.').slice(0, -1) + 'O' }),
    drawing('s', 'Switch', filled('3'), standardMix('gate')),
  ];
  let image = blank();
  renderBoard(image, [obj('Gate', 0, 0, { letter: 'A', variant: 'g', open: true }), obj('Switch', 1, 0, { letter: 'A', variant: 's' })], { ...look, drawings }, { switchesActive: false });
  assert.equal(pixelAt(image, 0, 0)[3], 0);
  assert.equal(hexAt(image, 23, 23), look.palette.outline);
  assert.equal(hexAt(image, 24, 0), look.palette.outline, 'a dimmed pixel');
  assert.notEqual(hexAt(image, 25, 0), look.palette.outline, 'and the one beside it shows the drawing');
});

test('a texture saved before grains still draws, and in exactly its old pattern in its standard mix', () => {
  let palette = { wall: '#808080', outline: '#000000', light: '#ffffff', key: '#ff0000' };
  let pattern = Array.from({ length: TILE_PX * TILE_PX }, (_, i) => (i % 3 === 0 ? '0' : '1')).join('');
  let look = { palette, textures: { wall: { ramp: ['#404040', '#808080'], pixels: pattern } } };
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 0)], look);
  // The octagon's middle, where both shades of the old pattern show.
  assert.equal(hexAt(image, 12, 12), (12 * TILE_PX + 12) % 3 === 0 ? '#404040' : '#808080');
  assert.equal(hexAt(image, 13, 12), (12 * TILE_PX + 13) % 3 === 0 ? '#404040' : '#808080');
  let mixed = mixTexture(look, [{ role: 'wall', shade: 2, percent: 50 }, { role: 'key', shade: 2, percent: 50 }]);
  assert.equal(mixed.colors.length, 2, 'and can still be mixed, its old pattern used as a coarse grain');
  assert.equal(new Set(mixed.pixels).size, 2);
});

// ---------- Rotator Loops ----------

const rotatorLine = (...cols) => cols.map(col => obj('RotatorTile', col, 5, { direction: 'Right' }));

test('an object on a Rotator tile stays put until told to move, then moves along it and stops at the end', () => {
  let g = game(...rotatorLine(1, 2, 3), obj('Wall', 1, 5));
  g.tick(null);
  assert.equal(find(g, 'Wall').col, 1, 'a Stream tick does nothing to it');
  g.tickRotators(null);
  assert.equal(find(g, 'Wall').col, 2);
  assert.equal(find(g, 'Wall').glide, 'rotator');
  g.tickRotators(null);
  g.tickRotators(null);
  assert.equal(find(g, 'Wall').col, 3);
});

test('a Stream tick and a Rotator tick each leave the other\'s objects alone, mid-glide included', () => {
  let h = game(obj('RotatorTile', 1, 1, { direction: 'Right' }), obj('RotatorTile', 2, 1, { direction: 'Right' }), obj('Wall', 1, 1),
    obj('Stream', 1, 3, { direction: 'Right' }), obj('Stream', 2, 3, { direction: 'Right' }), obj('Key', 1, 3));
  h.tickRotators(null);
  assert.deepEqual([find(h, 'Wall').col, find(h, 'Wall').fromCol], [2, 1]);
  h.tick(null);
  assert.deepEqual([find(h, 'Wall').col, find(h, 'Wall').fromCol], [2, 1], 'its glide is left to finish');
  assert.deepEqual([find(h, 'Key').col, find(h, 'Key').fromCol], [2, 1]);
});

test('a loop of Rotator tiles circulates', () => {
  let loop = [obj('RotatorTile', 1, 1, { direction: 'Right' }), obj('RotatorTile', 2, 1, { direction: 'Down' }), obj('RotatorTile', 2, 2, { direction: 'Left' }), obj('RotatorTile', 1, 2, { direction: 'Up' })];
  let g = game(...loop, obj('Wall', 1, 1), obj('Key', 2, 2));
  g.tickRotators(null);
  assert.deepEqual([find(g, 'Wall').col, find(g, 'Wall').row], [2, 1]);
  assert.deepEqual([find(g, 'Key').col, find(g, 'Key').row], [1, 2]);
  g.tickRotators(null); g.tickRotators(null); g.tickRotators(null);
  assert.deepEqual([find(g, 'Wall').col, find(g, 'Wall').row], [1, 1]);
});

test('things don\'t cross from Rotator tiles onto Streams, or the other way', () => {
  let g = game(obj('RotatorTile', 1, 1, { direction: 'Right' }), obj('Stream', 2, 1, { direction: 'Right' }), obj('Stream', 3, 1, { direction: 'Right' }), obj('Wall', 1, 1));
  g.tickRotators(null);
  assert.equal(find(g, 'Wall').col, 1);
  let h = game(obj('Stream', 1, 1, { direction: 'Right' }), obj('RotatorTile', 2, 1, { direction: 'Right' }), obj('Wall', 1, 1));
  h.tick(null);
  assert.equal(find(h, 'Wall').col, 1);
});

test('a Wall on a Rotator tile waits for the ship, and a Key moving under it counts as collected', () => {
  let wall = game(obj('Start', 2, 5), ...rotatorLine(1, 2), obj('Wall', 1, 5));
  wall.tickRotators(null);
  assert.equal(find(wall, 'Wall').col, 1);

  let key = game(obj('Start', 2, 5), ...rotatorLine(1, 2), obj('Key', 1, 5));
  key.tickRotators(null);
  assert.equal(find(key, 'Key'), undefined);
});

test('the ship walks on and off a Rotator tile freely, even against it, and it doesn\'t carry the ship', () => {
  let g = game(obj('RotatorTile', 3, 3, { direction: 'Right' }));
  assert.equal(g.canEnter(at(4, 3), at(3, 3), 'left'), true);
  assert.equal(g.canEnter(at(3, 3), at(2, 3), 'left'), true);
  assert.equal(g.canEnter(at(3, 3), at(3, 2), 'up'), true);
  assert.equal(g.carryDirection(at(3, 3)), null);
});

test('onRotatorSwitch is only true while the ship is on one, and Keys don\'t hold it back', () => {
  let g = game(obj('RotatorSwitch', 3, 3), obj('Key', 7, 7));
  assert.equal(g.onRotatorSwitch, false);
  assert.equal(g.canEnter(at(2, 3), at(3, 3), 'right'), true);
  g.shipArrivedAt(at(3, 3));
  assert.equal(g.onRotatorSwitch, true);
  g.shipArrivedAt(at(4, 3));
  assert.equal(g.onRotatorSwitch, false);
});

test('a Rotator Switch moving away from under the ship stops the Rotators', () => {
  let g = game(obj('Start', 1, 5), ...rotatorLine(1, 2), obj('RotatorSwitch', 1, 5));
  g.shipArrivedAt(at(1, 5));
  assert.equal(g.onRotatorSwitch, true);
  g.tickRotators(null);
  assert.equal(find(g, 'RotatorSwitch').col, 2);
  assert.deepEqual(g.shipCell, at(1, 5));
  assert.equal(g.onRotatorSwitch, false);
});

// ---------- Lanterns and Invisible ----------

// Every square a Lantern at (5, 5) reveals, as a set of rows of how far it reaches either side.
function revealedBy(lantern = at(5, 5)){
  let everywhere = [];
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
    if (col !== lantern.col || row !== lantern.row) everywhere.push(obj('Wall', col, row, { invisible: true }));
  }
  let g = game(...everywhere, obj('Lantern', lantern.col, lantern.row));
  g.shipArrivedAt(lantern);
  return g;
}

test('a Lantern reveals a circle: 3, 3, 2 and 1 squares to either side, row by row from its own', () => {
  let g = revealedBy();
  let reach = (dy) => g.objects.filter(o => o.kind === 'Wall' && o.row === 5 + dy && o.revealed).map(o => o.col - 5).sort((a, b) => a - b);
  assert.deepEqual(reach(0), [-3, -2, -1, 1, 2, 3]);
  assert.deepEqual(reach(1), [-3, -2, -1, 0, 1, 2, 3]);
  assert.deepEqual(reach(-1), [-3, -2, -1, 0, 1, 2, 3]);
  assert.deepEqual(reach(2), [-2, -1, 0, 1, 2]);
  assert.deepEqual(reach(3), [-1, 0, 1]);
  assert.deepEqual(reach(-3), [-1, 0, 1]);
  assert.deepEqual(reach(4), []);
});

test('nothing is revealed until the Lantern is stepped on, and Keys don\'t hold it back', () => {
  let g = game(obj('Wall', 1, 1, { invisible: true }), obj('Lantern', 2, 1), obj('Key', 9, 9));
  assert.equal(find(g, 'Wall').revealed, false);
  assert.equal(find(g, 'Lantern').lit, false);
  g.shipArrivedAt(at(2, 1));
  assert.equal(find(g, 'Wall').revealed, true);
  assert.equal(find(g, 'Lantern').lit, true);
});

test('a Lantern stays lit when stepped on again', () => {
  let g = game(obj('Lantern', 2, 1));
  g.shipArrivedAt(at(2, 1));
  g.shipArrivedAt(at(2, 2));
  g.shipArrivedAt(at(2, 1));
  assert.equal(find(g, 'Lantern').lit, true);
});

test('a Lantern reveals floor tiles too, and an invisible Lantern reveals itself', () => {
  let g = game(obj('Stream', 1, 1, { direction: 'Up', invisible: true }), obj('RotatorTile', 3, 1, { direction: 'Up', invisible: true }), obj('Lantern', 2, 1, { invisible: true }));
  g.shipArrivedAt(at(2, 1));
  assert.ok(g.floors.every(f => f.revealed));
  assert.equal(find(g, 'Lantern').revealed, true);
});

test('something moving into a lit area is revealed, and stays revealed after moving out', () => {
  let tiles = [];
  for (let col = 0; col < 10; col++) tiles.push(obj('Stream', col, 5, { direction: 'Right' }));
  let g = game(...tiles, obj('Wall', 0, 5, { invisible: true }), obj('Lantern', 5, 6));
  g.shipArrivedAt(at(5, 6));
  assert.equal(find(g, 'Wall').revealed, false, 'too far away to start with');
  for (let i = 0; i < 9; i++) g.tick(at(5, 7));
  assert.equal(find(g, 'Wall').col, 9);
  assert.equal(find(g, 'Wall').revealed, true);
});

test('a Lantern moving under the ship is lit by it', () => {
  let g = game(obj('Start', 2, 5), ...line(1, 2), obj('Lantern', 1, 5));
  g.tick(null);
  assert.equal(find(g, 'Lantern').lit, true);
});

test('invisible things behave exactly the same', () => {
  let g = game(obj('Wall', 1, 0, { invisible: true }), obj('Stream', 3, 3, { direction: 'Right', invisible: true }), obj('Gate', 5, 0, { letter: 'A', invisible: true }), obj('Switch', 6, 6, { letter: 'A', invisible: true }), obj('Finish', 8, 8));
  assert.equal(g.canEnter(at(0, 0), at(1, 0), 'right'), false);
  assert.equal(g.carryDirection(at(3, 3)), 'right');
  assert.equal(g.canEnter(at(3, 3), at(3, 2), 'up'), false);
  assert.equal(g.canEnter(at(4, 0), at(5, 0), 'right'), false);
  g.shipArrivedAt(at(6, 6));
  assert.equal(g.canEnter(at(4, 0), at(5, 0), 'right'), true);
  assert.equal(find(g, 'Gate').revealed, false);
});

test('placing and erasing treat a Rotator tile as floor, like a Stream', () => {
  let rotator = obj('RotatorTile', 1, 1, { direction: 'Up' });
  let board = placeObject([wall(1, 1), stream(1, 1)], rotator);
  assert.deepEqual(board.map(o => o.kind).sort(), ['RotatorTile', 'Wall']);
  assert.deepEqual(eraseObject(board, at(1, 1)).map(o => o.kind), ['RotatorTile']);
  assert.deepEqual(placeObject(board, obj('Key', 1, 1)).map(o => o.kind).sort(), ['Key', 'RotatorTile']);
});

test('the new objects each have their own colours and exact-pixel looks', () => {
  let { art, look } = artLook();
  let allowed = colorsIn(art);
  assert.equal(look.palette.rotator, look.palette.rotatorSwitch);
  for (const role of ['rotator', 'lantern']) assert.ok(look.textures[role].ramp.includes(look.palette[role]));

  let image = blank();
  renderBoard(image, [obj('RotatorTile', 0, 0, { direction: 'Up' }), obj('RotatorSwitch', 1, 0), obj('Lantern', 2, 0), obj('Stream', 3, 0, { direction: 'Up' })], look);
  for (const color of colorsIn(image.data)) assert.ok(allowed.has(color), color);
  let tiles = [0, 1, 2, 3].map(col => tile(image, col, 0));
  assert.equal(new Set(tiles).size, 4);
});

test('a Lantern looks different once lit', () => {
  let { look } = artLook();
  let off = blank(), on = blank();
  renderBoard(off, [obj('Lantern', 0, 0)], look);
  renderBoard(on, [obj('Lantern', 0, 0, { lit: true })], look);
  assert.notEqual(tile(off, 0, 0), tile(on, 0, 0));
});

test('a Rotator tile\'s chevrons only move with its own clock, in the direction it runs', () => {
  let { look } = artLook();
  let middle = (options, direction) => {
    let image = blank();
    renderBoard(image, [obj('RotatorTile', 0, 0, { direction })], look, options);
    let out = [];
    for (let i = 0; i < TILE_PX; i++) {
      let [x, y] = direction === 'Right' || direction === 'Left' ? [i, 11] : [11, i];
      out.push(pixelAt(image, x, y)[3] ? 1 : 0);
    }
    return out.join('');
  };
  assert.equal(middle({ timeMs: 0 }, 'Right'), middle({ timeMs: 300 }, 'Right'), 'a Stream\'s clock does nothing to it');
  let step = 1000 / 24 + 1;
  let rotateRight = (s) => s[s.length - 1] + s.slice(0, -1);
  let rotateLeft = (s) => s.slice(1) + s[0];
  assert.equal(middle({ rotatorTimeMs: step }, 'Right'), rotateRight(middle({ rotatorTimeMs: 0 }, 'Right')));
  assert.equal(middle({ rotatorTimeMs: step }, 'Left'), rotateLeft(middle({ rotatorTimeMs: 0 }, 'Left')));
});

test('something invisible isn\'t drawn until revealed, or shows as a ghost if asked', () => {
  let { look } = artLook();
  let hidden = blank(), shown = blank(), ghost = blank(), revealed = blank();
  renderBoard(hidden, [obj('Wall', 0, 0, { invisible: true })], look);
  assert.equal(colorsIn(hidden.data).size, 0);

  renderBoard(revealed, [obj('Wall', 0, 0, { invisible: true, revealed: true })], look);
  renderBoard(shown, [obj('Wall', 0, 0)], look);
  assert.equal(tile(revealed, 0, 0), tile(shown, 0, 0));

  renderBoard(ghost, [obj('Wall', 0, 0, { invisible: true })], look, { showInvisible: true });
  assert.equal(pixelAt(ghost, 12, 12)[3], 255);
  assert.equal(pixelAt(ghost, 13, 12)[3], 0);
  assert.equal(pixelAt(ghost, 12, 13)[3], 0);
});

test('an object moved by a Rotator tile glides by the Rotator\'s clock, not the Stream\'s', () => {
  let { look } = artLook();
  let leftmost = (options) => {
    let image = blank();
    renderBoard(image, [{ kind: 'Wall', col: 2, row: 0, fromCol: 1, fromRow: 0, glide: 'rotator' }], look, options);
    for (let x = 0; x < ART_PX; x++) for (let y = 0; y < TILE_PX; y++) if (pixelAt(image, x, y)[3]) return x;
  };
  assert.equal(leftmost({ along: 0, rotatorAlong: 0.5 }), 36 + 1);
  assert.equal(leftmost({ along: 0.5, rotatorAlong: 1 }), 48 + 1);
});

// ---------- connected boards ----------

const { exitDirectionOf, entranceFrom, entranceAfter, blockingEntrance } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

test('a square leads off the board only on an edge, not a corner or the middle', () => {
  assert.equal(exitDirectionOf(at(0, 4)), 'Left');
  assert.equal(exitDirectionOf(at(9, 4)), 'Right');
  assert.equal(exitDirectionOf(at(4, 0)), 'Up');
  assert.equal(exitDirectionOf(at(4, 9)), 'Down');
  for (const corner of [at(0, 0), at(9, 0), at(0, 9), at(9, 9)]) assert.equal(exitDirectionOf(corner), null);
  assert.equal(exitDirectionOf(at(4, 4)), null);
});

test('the next board is entered directly across, on the opposite edge', () => {
  assert.deepEqual(entranceFrom(at(0, 4)), at(9, 4));
  assert.deepEqual(entranceFrom(at(9, 2)), at(0, 2));
  assert.deepEqual(entranceFrom(at(3, 0)), at(3, 9));
  assert.deepEqual(entranceFrom(at(6, 9)), at(6, 0));
  assert.equal(entranceFrom(at(0, 0)), null);
});

test('a puzzle leads on only with exactly one Finish, on an edge', () => {
  assert.deepEqual(entranceAfter({ objects: [obj('Finish', 6, 9)] }), at(6, 0));
  assert.equal(entranceAfter({ objects: [obj('Finish', 6, 9), obj('Finish', 0, 3)] }), null);
  assert.equal(entranceAfter({ objects: [obj('Finish', 6, 6)] }), null);
  assert.equal(entranceAfter(null), null);
});

test('only an object blocks an entrance, not a floor tile or Start', () => {
  assert.equal(blockingEntrance([obj('Stream', 1, 1, { direction: 'Up' }), obj('Start', 1, 1)], at(1, 1)), null);
  assert.equal(blockingEntrance([obj('Wall', 1, 1)], at(1, 1)).kind, 'Wall');
  assert.equal(blockingEntrance([obj('Wall', 2, 1)], at(1, 1)), null);
});

// ---------- Streams and Rotator tiles as drawings ----------

const { ANIMATED_KINDS, renderDrawingLayer } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const flowing = (col, row, direction, extra = {}) => obj('Stream', col, row, { direction, ...extra });
const drawnAt = (image, x, y) => pixelAt(image, x, y)[3] !== 0;

test('a Stream and a Rotator tile each have Standard Still and Flow layers, and a Stream a Bend', () => {
  for (const kind of ANIMATED_KINDS) {
    let standard = standardDrawing(kind);
    for (const layer of ['pixels', 'flowPixels', ...(kind === 'Stream' ? ['bendPixels'] : [])]) assert.match(standard[layer], /^[.OHG1234]{576}$/, `${kind} ${layer}`);
  }
  assert.equal(standardDrawing('RotatorTile').bendPixels, undefined);
});

test('a run of Streams is one channel, with no bank where they meet', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [flowing(0, 0, 'Right'), flowing(1, 0, 'Right')], look);
  let outline = toRgb(look.palette.outline).join();
  for (const x of [23, 24]) {
    assert.ok(drawnAt(image, x, 12), x);
    assert.notEqual(pixelAt(image, x, 12).slice(0, 3).join(), outline, x);
  }
});

test('a Stream bends to open towards one pouring into it from the side, and closes behind', () => {
  let { look } = artLook();
  let image = blank();
  // Pouring down into a Stream flowing right: its left is up, where the water comes in.
  renderBoard(image, [flowing(1, 0, 'Down'), flowing(1, 1, 'Right')], look);
  assert.ok(drawnAt(image, 36, 24), 'open at the top');
  assert.ok(!drawnAt(image, 24, 36), 'closed behind, on the left');
  assert.ok(drawnAt(image, 47, 36), 'and on through to the right');
  // From its right instead: up into a Stream flowing right, from below.
  let other = blank();
  renderBoard(other, [flowing(1, 2, 'Up'), flowing(1, 1, 'Right')], look);
  assert.ok(drawnAt(other, 36, 47) && !drawnAt(other, 36, 24) && !drawnAt(other, 24, 36));
});

test('Streams side by side stay separate', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [flowing(0, 0, 'Right'), flowing(0, 1, 'Right')], look);
  assert.ok(!drawnAt(image, 12, 23) && !drawnAt(image, 12, 24));
});

test('a Stream\'s flow keeps to its channel round a bend, at every moment', () => {
  let { look } = artLook();
  for (let timeMs = 0; timeMs < 900; timeMs += 37) {
    let image = blank();
    renderBoard(image, [flowing(1, 0, 'Down'), flowing(1, 1, 'Right')], look, { timeMs });
    for (let y = 30; y < 42; y++) assert.ok(!drawnAt(image, 24, y) && !drawnAt(image, 25, y), `${timeMs}ms`);
  }
});

test('a Stream\'s Flow only shows on its liquid, and a Rotator tile\'s anywhere', () => {
  let { look } = artLook();
  let flowEverywhere = filled('4');
  let drawings = [
    { ...standardDrawing('Stream'), id: 's', name: 's', flowPixels: flowEverywhere },
    { ...standardDrawing('RotatorTile'), id: 'r', name: 'r', flowPixels: flowEverywhere },
  ];
  let image = blank();
  renderBoard(image, [flowing(0, 0, 'Right', { variant: 's' }), obj('RotatorTile', 1, 0, { direction: 'Right', variant: 'r' })], { ...look, drawings });
  assert.ok(!drawnAt(image, 12, 0), 'outside the Stream\'s channel');
  assert.equal(pixelAt(image, 12, 2)[3], 0);
  assert.ok(drawnAt(image, 24 + 12, 0), 'a Rotator tile\'s flow over nothing');
});

test('a drawing is turned to the way the tile flows, its top on the flow\'s left', () => {
  let { look } = artLook();
  // Still: only the top row painted, which is the flow's left.
  let topRow = 'H'.repeat(24) + '.'.repeat(552);
  let drawings = [{ ...standardDrawing('RotatorTile'), id: 'r', name: 'r', pixels: topRow, flowPixels: filled('.') }];
  let where = (direction) => {
    let image = blank();
    renderBoard(image, [obj('RotatorTile', 0, 0, { direction, variant: 'r' })], { ...look, drawings });
    return [[12, 0], [23, 12], [12, 23], [0, 12]].map(([x, y]) => drawnAt(image, x, y) ? 1 : 0).join('');
  };
  assert.equal(where('Right'), '1000');
  assert.equal(where('Down'), '0100');
  assert.equal(where('Left'), '0010');
  assert.equal(where('Up'), '0001');
});

test('the Drawings view sees a layer on its own, with Flow over Still wherever it\'s painted', () => {
  let { look } = artLook();
  let drawing = { ...standardDrawing('Stream'), flowPixels: filled('H') };
  let image = blank();
  renderDrawingLayer(image, drawing, look, 'flow');
  assert.deepEqual(pixelAt(image, 0, 0).slice(0, 3), toRgb(look.palette.light));
  renderDrawingLayer(image, standardDrawing('Stream'), look, 'bend');
  assert.ok(drawnAt(image, 12, 0) && !drawnAt(image, 0, 12));
});

// ---------- depth ----------

const { RAISED_PX } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const rowsDrawn = (image, col) => { let rows = new Set(); for (let y = 0; y < ART_PX; y++) for (let x = col * TILE_PX; x < (col + 1) * TILE_PX; x++) if (pixelAt(image, x, y)[3]) rows.add(y); return [...rows]; };

test('raised and flat both draw only colours from the art, with no see-through blends', () => {
  let { art, look } = artLook();
  let allowed = colorsIn(art);
  for (const depth of ['raised', 'flat']) {
    let image = blank();
    renderBoard(image, [obj('Wall', 1, 2), obj('Gate', 2, 2, { letter: 'A' }), obj('Gate', 3, 2, { letter: 'B', open: true }), obj('Switch', 4, 2, { letter: 'A' }), obj('Finish', 5, 2), obj('Key', 6, 2), obj('Lantern', 7, 2), obj('Teleporter', 8, 2, { letter: 'T' })], { ...look, depth }, { switchesActive: false });
    // Only the open Gate, at (3, 2), is see-through, by half.
    for (let i = 0; i < image.data.length; i += 4) {
      let x = (i / 4) % ART_PX, y = Math.floor(i / 4 / ART_PX);
      let inOpenGate = x >= 3 * 24 && x < 4 * 24 && y >= 2 * 24 && y < 3 * 24;
      assert.ok([0, 255].includes(image.data[i + 3]) || (inOpenGate && image.data[i + 3] === 128), depth);
    }
    for (const color of colorsIn(image.data)) assert.ok(allowed.has(color), `${depth}: ${color}`);
  }
});

test('a raised Wall rises into the square above, and something stepped onto doesn\'t', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 2), obj('Finish', 1, 2), obj('Gate', 2, 2, { letter: 'A', open: true }), obj('Gate', 3, 2, { letter: 'A' })], { ...look, depth: 'raised' });
  assert.equal(Math.min(...rowsDrawn(image, 0)), 2 * TILE_PX + 1 - RAISED_PX);
  assert.ok(Math.min(...rowsDrawn(image, 1)) >= 2 * TILE_PX, 'a Finish lies flat');
  assert.ok(Math.min(...rowsDrawn(image, 2)) >= 2 * TILE_PX, 'an open Gate lies flat');
  assert.equal(Math.min(...rowsDrawn(image, 3)), 2 * TILE_PX + 1 - RAISED_PX, 'a closed Gate stands up');
});

test('a raised Wall is drawn over whatever\'s in the square above it, whichever order they come in', () => {
  let { look } = artLook();
  let a = blank(), b = blank();
  renderBoard(a, [obj('Key', 0, 1), obj('Wall', 0, 2)], { ...look, depth: 'raised' });
  renderBoard(b, [obj('Wall', 0, 2), obj('Key', 0, 1)], { ...look, depth: 'raised' });
  assert.equal(tile(a, 0, 1), tile(b, 0, 1));
});

test('objects are raised unless the look says flat, and Streams and Rotator tiles stay on the floor', () => {
  let { look } = artLook();
  let draw = (depth, kind) => { let image = blank(); renderBoard(image, [obj(kind, 1, 1, { direction: 'Up' })], depth ? { ...look, depth } : look, { timeMs: 100 }); return image.data.join(); };
  assert.equal(draw(undefined, 'Wall'), draw('raised', 'Wall'));
  assert.notEqual(draw(undefined, 'Wall'), draw('flat', 'Wall'));
  for (const kind of ['Stream', 'RotatorTile']) assert.equal(draw(undefined, kind), draw('flat', kind), kind);
});

test('a ghost of a raised object rises with it', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 2, { invisible: true })], { ...look, depth: 'raised' }, { showInvisible: true });
  assert.ok(Math.min(...rowsDrawn(image, 0)) < 2 * TILE_PX);
});

test('originY moves the whole board down, leaving room above row 0', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [obj('Wall', 0, 0)], { ...look, depth: 'raised' }, { originY: RAISED_PX });
  assert.equal(Math.min(...rowsDrawn(image, 0)), 1);
});

// ---------- Push Blocks ----------

const block = (col, row, symbol = 'Circle') => obj('PushBlock', col, row, { symbol });
const blocksIn = (g) => g.objects.filter(o => o.kind === 'PushBlock').map(o => `${o.symbol}@${o.col},${o.row}`).sort();

test('walking into a Push Block pushes it a square, gliding with the ship', () => {
  let g = game(obj('Start', 1, 5), block(2, 5));
  assert.equal(g.canEnter(at(1, 5), at(2, 5), 'right'), true);
  assert.equal(g.pushFrom(at(1, 5), at(2, 5), 'right'), null);
  let b = find(g, 'PushBlock');
  assert.deepEqual([b.col, b.row, b.fromCol, b.fromRow, b.glide], [3, 5, 2, 5, 'push']);
  g.settlePushes();
  assert.deepEqual([b.fromCol, b.fromRow], [3, 5]);
});

test('a Push Block can be pushed onto a Stream or Rotator tile, but not onto an object, off the board, or against a Stream', () => {
  let g = game(block(2, 5), obj('Stream', 3, 5, { direction: 'Down' }), block(5, 5), obj('Key', 6, 5), block(9, 2),
    block(2, 7), obj('Stream', 3, 7, { direction: 'Left' }), block(5, 7), obj('RotatorTile', 6, 7, { direction: 'Up' }));
  assert.equal(g.canPush(at(2, 5), 'right'), true, 'onto a Stream across it');
  assert.equal(g.canPush(at(5, 5), 'right'), false, 'onto a Key');
  assert.equal(g.canPush(at(9, 2), 'right'), false, 'off the board');
  assert.equal(g.canPush(at(2, 7), 'right'), false, 'against a Stream flowing back');
  assert.equal(g.canPush(at(5, 7), 'right'), true, 'onto a Rotator tile');
  assert.equal(g.canEnter(at(4, 5), at(5, 5), 'right'), false, 'and an unpushable block stops the ship');
});

test('two blocks of a symbol pushed side by side sink, and only those', () => {
  let g = game(block(2, 5, 'Star'), block(4, 5, 'Star'), block(4, 6, 'Square'), block(6, 6, 'Star'));
  let event = g.pushFrom(at(1, 5), at(2, 5), 'right');
  assert.deepEqual(event.sank.map(o => o.symbol), ['Star', 'Star']);
  assert.deepEqual(blocksIn(g), ['Square@4,6', 'Star@6,6']);
});

test('diagonals and different symbols don\'t sink, and a whole group sinks together', () => {
  let g = game(block(2, 2, 'Cross'), block(3, 3, 'Cross'), block(5, 5, 'Triangle'), block(6, 5, 'Square'));
  assert.equal(g.pushFrom(at(0, 0), at(9, 9), 'right'), null);
  let group = game(block(2, 5, 'Circle'), block(4, 5, 'Circle'), block(4, 4, 'Circle'), block(4, 3, 'Square'));
  let event = group.pushFrom(at(1, 5), at(2, 5), 'right');
  assert.equal(event.sank.length, 3);
  assert.deepEqual(blocksIn(group), ['Square@4,3']);
});

test('blocks carried together by a Stream sink too', () => {
  let g = game(block(2, 5, 'Star'), obj('Stream', 2, 5, { direction: 'Right' }), obj('Stream', 3, 5, { direction: 'Right' }), block(4, 5, 'Star'));
  let event = g.tick(null);
  assert.equal(event.sank.length, 2);
  assert.deepEqual(blocksIn(g), []);
});

// ---------- Jump Tiles ----------

const jump = (col, row, direction = 'Right') => obj('JumpTile', col, row, { direction });

test('a Jump Tile launches the ship 2 squares, over whatever\'s in between', () => {
  let g = game(jump(2, 5), obj('Wall', 3, 5));
  assert.equal(g.canEnter(at(1, 5), at(2, 5), 'right'), true);
  assert.deepEqual(g.shipArrivedAt(at(2, 5)), { jumpTo: at(4, 5) });
  assert.deepEqual(g.shipCell, at(4, 5));
});

test('it lands just 1 square on if it can\'t land 2, and not at all if it can\'t land either', () => {
  assert.deepEqual(game(jump(2, 5), obj('Wall', 4, 5)).shipArrivedAt(at(2, 5)), { jumpTo: at(3, 5) });
  assert.deepEqual(game(jump(8, 5)).shipArrivedAt(at(8, 5)), { jumpTo: at(9, 5) });
  assert.equal(game(jump(9, 5)).shipArrivedAt(at(9, 5)), null);
  assert.equal(game(jump(2, 5), block(3, 5), obj('Wall', 4, 5)).shipArrivedAt(at(2, 5)), null);
});

test('landing works like arriving: on a Switch it flips its Gates, on another Jump Tile it jumps again', () => {
  let g = game(jump(2, 5), obj('Switch', 4, 5, { letter: 'A' }), obj('Gate', 0, 0, { letter: 'A' }));
  let landing = g.shipArrivedAt(at(2, 5)).jumpTo;
  g.shipArrivedAt(landing, { jumped: true });
  assert.equal(find(g, 'Gate').open, true);
  let chain = game(jump(1, 5), jump(3, 5));
  assert.deepEqual(chain.shipArrivedAt(at(1, 5)), { jumpTo: at(3, 5) });
  assert.deepEqual(chain.shipArrivedAt(at(3, 5), { jumped: true }), { jumpTo: at(5, 5) });
});

test('two Jump Tiles facing each other stop after 8 jumps in a row', () => {
  let g = game(jump(2, 5, 'Right'), jump(4, 5, 'Left'));
  let cell = at(2, 5), jumps = 0, event = g.shipArrivedAt(cell);
  while (event?.jumpTo && jumps < 50) {
    jumps++;
    event = g.shipArrivedAt(event.jumpTo, { jumped: true });
  }
  assert.equal(jumps, 8);
  assert.equal(g.shipArrivedAt(at(2, 5))?.jumpTo !== undefined, true, 'and walking on again starts afresh');
});

// ---------- drawing Push Blocks and Jump Tiles ----------

const { SYMBOLS } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

test('a Push Block and a Jump Tile get their own palette colours, from the art', () => {
  let { art, look } = artLook();
  let inArt = colorsIn(art);
  for (const role of ['block', 'jump']) {
    assert.ok(inArt.has(toRgb(look.palette[role]).join(',')), role);
    assert.equal(look.textures[role].ramp.length, 4, role);
  }
});

test('every symbol draws differently, in the light colour, on a raised block, all in the art\'s own colours', () => {
  let { art, look } = artLook();
  let allowed = colorsIn(art);
  let tiles = Object.keys(SYMBOLS).map((symbol, i) => {
    let image = blank();
    renderBoard(image, [obj('PushBlock', i, 2, { symbol })], look);
    for (const color of colorsIn(image.data)) assert.ok(allowed.has(color), `${symbol}: ${color}`);
    // Its 9x9 box, lifted with the block's raised face.
    let count = (rgb) => { let n = 0; for (let y = 7; y < 16; y++) for (let x = 7; x < 16; x++) if (pixelAt(image, i * 24 + x, 2 * 24 + y - RAISED_PX).slice(0, 3).join() === rgb) n++; return n; };
    let body = pixelAt(image, i * 24 + 10, 2 * 24 + 3 - RAISED_PX).slice(0, 3).join();
    let symbolColour = [toRgb(look.palette.light).join(), toRgb(look.palette.outline).join()].find(rgb => rgb !== body && count(rgb) >= 12);
    assert.ok(symbolColour, `${symbol} is drawn in the light colour, or the dark on a block too light for it, standing out from the block`);
    return tile(image, i, 2);
  });
  assert.equal(new Set(tiles).size, Object.keys(SYMBOLS).length);
  let image = blank();
  renderBoard(image, [obj('PushBlock', 0, 2, { symbol: 'Star' })], look);
  assert.ok(rowsDrawn(image, 0).includes(2 * 24 - 1), 'and it stands up into the square above, as a Wall does');
});

test('a Jump Tile is turned to point the way it launches', () => {
  let { look } = artLook();
  // Flat, since depth always lights the top-left whichever way the tile points.
  let draw = (direction) => { let image = blank(); renderBoard(image, [obj('JumpTile', 1, 1, { direction })], { ...look, depth: 'flat' }); return image; };
  let right = draw('Right'), left = draw('Left'), down = draw('Down');
  let column = (image, x) => { let out = []; for (let y = 24; y < 48; y++) out.push(pixelAt(image, x, y).join()); return out.join('|'); };
  assert.notEqual(tile(right, 1, 1), tile(left, 1, 1));
  assert.notEqual(tile(right, 1, 1), tile(down, 1, 1));
  // Turned round, its middle row reads backwards.
  let row = (image, y) => { let out = []; for (let x = 24; x < 48; x++) out.push(pixelAt(image, x, y).join()); return out; };
  assert.deepEqual(row(left, 35).reverse(), row(right, 36));
  assert.ok(column(down, 36).length > 0);
});

test('a pushed block glides with pushAlong, and a sinking one disappears into its square', () => {
  let { look } = artLook();
  let half = blank(), sunk = blank(), whole = blank();
  renderBoard(half, [obj('PushBlock', 3, 2, { symbol: 'Circle', fromCol: 2, fromRow: 2, glide: 'push' })], look, { pushAlong: 0.5, along: 0 });
  let left = Math.min(...[...Array(240).keys()].filter(x => pixelAt(half, x, 60)[3]));
  assert.equal(left, 2 * 24 + 12 + 1);
  renderBoard(whole, [obj('PushBlock', 2, 2, { symbol: 'Circle' })], look);
  renderBoard(sunk, [obj('PushBlock', 2, 2, { symbol: 'Circle', sink: 0.5 })], look);
  assert.ok(Math.max(...rowsDrawn(sunk, 2)) < 3 * 24, 'never below its square');
  assert.ok(Math.min(...rowsDrawn(sunk, 2)) >= 2 * 24 + 12 - RAISED_PX, 'and half of it gone');
});

test('the push hint is an arrow just past the block, pointing the way it would go, and bobs', () => {
  let { look } = artLook();
  let light = toRgb(look.palette.light).join();
  let hasLightIn = (image, x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (pixelAt(image, x, y).slice(0, 3).join() === light) return true; return false; };
  let draw = (direction, bob = 0) => { let image = blank(); renderBoard(image, [], look, { pushHint: { col: 4, row: 4, direction, bob } }); return image; };
  assert.ok(hasLightIn(draw('Right'), 5 * 24, 4 * 24, 5 * 24 + 12, 5 * 24));
  assert.ok(hasLightIn(draw('Left'), 4 * 24 - 12, 4 * 24, 4 * 24, 5 * 24));
  assert.ok(hasLightIn(draw('Down'), 4 * 24, 5 * 24, 5 * 24, 5 * 24 + 12));
  assert.ok(hasLightIn(draw('Up'), 4 * 24, 4 * 24 - 12, 5 * 24, 4 * 24));
  assert.notEqual(draw('Right', 0).data.join(), draw('Right', 1).data.join());
});

// ---------- Reset Switches ----------

const { resetSweepAt, resetSweepMs, RESET_FADE_MS, RESET_SWEEP_STEP_MS } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const reset = (col, row) => obj('ResetSwitch', col, row);

test('a Reset Switch puts every object back as it started, and leaves the ship where it is', () => {
  let g = game(obj('Start', 1, 5), block(2, 5, 'Star'), block(4, 5, 'Star'), block(6, 2, 'Circle'),
    obj('Key', 8, 8), obj('Switch', 7, 7, { letter: 'A' }), obj('Gate', 0, 0, { letter: 'A' }), obj('Gate', 0, 1, { letter: 'B', open: true }),
    obj('Lantern', 3, 3), obj('Wall', 4, 3, { invisible: true }), obj('Stream', 3, 4, { direction: 'Down', invisible: true }), reset(9, 9));

  g.pushFrom(at(1, 5), at(2, 5), 'right'); // the Stars meet and sink
  g.pushFrom(at(5, 2), at(6, 2), 'right'); // the Circle moves along
  g.shipArrivedAt(at(8, 8)); // the Key's collected
  g.shipArrivedAt(at(7, 7)); // so the Switch opens Gate A
  g.shipArrivedAt(at(3, 3)); // the Lantern reveals the Wall and Stream
  assert.deepEqual(blocksIn(g), ['Circle@7,2']);
  assert.equal(g.objects.find(o => o.letter === 'A' && o.kind === 'Gate').open, true);
  assert.equal(find(g, 'Wall').revealed, true);

  let event = g.shipArrivedAt(at(9, 9));
  assert.deepEqual(blocksIn(g), ['Circle@6,2', 'Star@2,5', 'Star@4,5']);
  assert.ok(find(g, 'Key'), 'the Key is back');
  assert.equal(g.switchesActive, false, 'so Switches wait for it again');
  assert.equal(g.objects.find(o => o.letter === 'A' && o.kind === 'Gate').open, false);
  assert.equal(g.objects.find(o => o.letter === 'B').open, true, 'a Gate that started open is open again');
  assert.equal(find(g, 'Lantern').lit, false);
  assert.equal(find(g, 'Wall').revealed, false, 'and what it revealed is hidden again');
  assert.equal(g.floors[0].revealed, false);
  assert.deepEqual(g.shipCell, at(9, 9));
  assert.deepEqual(event.reset.filter(o => o.kind === 'PushBlock').map(o => `${o.symbol}@${o.col},${o.row}`), ['Circle@7,2'], 'and it says what was there before');
});

test('it works whatever Keys are left, and each object keeps its own index, before and after', () => {
  let g = game(obj('Key', 2, 2), block(4, 4), reset(6, 6));
  g.pushFrom(at(3, 4), at(4, 4), 'right');
  let before = g.objects.map(o => o.index);
  let event = g.shipArrivedAt(at(6, 6));
  assert.ok(event.reset);
  assert.deepEqual(g.objects.map(o => o.index), before);
  assert.deepEqual([find(g, 'PushBlock').col, find(g, 'PushBlock').fromCol], [4, 4], 'back where it started, not gliding');
});

test('the sweep goes from the top-left corner to the bottom-right, each object fading out and then back in', () => {
  let before = [{ ...obj('Key', 0, 0), index: 0 }, { ...obj('Key', 9, 9), index: 1 }, { ...obj('Wall', 5, 5), index: 2 }];
  let after = before.map(o => ({ ...o }));
  // Whichever's showing: the one leaving comes first, and the one arriving last.
  let fadeOf = (ms, col, leaving) => { let showing = resetSweepAt(before, after, ms).filter(o => o.col === col && o.kind === 'Key'); return showing.at(leaving ? 0 : -1)?.fade; };
  let corner = 18 * RESET_SWEEP_STEP_MS;

  assert.equal(fadeOf(RESET_FADE_MS / 2, 0, true), 0.5, 'the top-left one is half gone');
  assert.equal(fadeOf(RESET_FADE_MS / 2, 9, true), 1, 'while the bottom-right one is untouched');
  assert.equal(fadeOf(RESET_FADE_MS * 1.5, 0, false), 0.5, 'then the top-left one is half back');
  assert.equal(fadeOf(corner + RESET_FADE_MS / 2, 9, true), 0.5, 'the sweep reaches the bottom-right last');
  assert.equal(resetSweepMs(before, after), corner + 2 * RESET_FADE_MS);
  for (const ms of [0, 50, corner, corner + 150]) assert.deepEqual(resetSweepAt(before, after, ms).filter(o => o.kind === 'Wall').map(o => o.fade), [undefined], 'Walls just stay');
  assert.deepEqual(resetSweepAt(before, after, resetSweepMs(before, after)).map(o => o.fade ?? 1), [1, 1, 1], 'and at the end it\'s just the board as it starts');
});

test('something going back fades in once the sweep reaches where it starts, and it\'s faded out from where it was', () => {
  let moved = { ...block(8, 8), index: 0 };
  let started = { ...block(1, 1), index: 0 };
  let sunk = { ...obj('Key', 0, 1), index: 1 };
  let atMs = (ms) => resetSweepAt([moved], [started, sunk], ms);
  let fadingIn = (ms) => atMs(ms).find(o => o.col === 1 && o.row === 1)?.fade ?? 0;
  assert.equal(fadingIn(16 * RESET_SWEEP_STEP_MS + RESET_FADE_MS - 1), 0, 'not before it\'s gone from where it was');
  assert.ok(fadingIn(16 * RESET_SWEEP_STEP_MS + RESET_FADE_MS + 50) > 0);
  assert.ok(atMs(RESET_SWEEP_STEP_MS + RESET_FADE_MS + 50).some(o => o.kind === 'Key' && o.fade > 0), 'and one that was gone just fades in');
});

test('a faded object is laid over what\'s under it, partly see-through', () => {
  let { look } = artLook();
  let full = blank(), half = blank(), none = blank();
  let floor = obj('Stream', 2, 2, { direction: 'Right' });
  renderBoard(full, [obj('ResetSwitch', 2, 2)], look);
  renderBoard(half, [floor, obj('ResetSwitch', 2, 2, { fade: 0.5 })], look);
  renderBoard(none, [floor, obj('ResetSwitch', 2, 2, { fade: 0 })], look);
  let onStream = blank();
  renderBoard(onStream, [floor], look);
  let x = 2 * 24 + 12, y = 2 * 24 + 4;
  assert.deepEqual(pixelAt(none, x, y), pixelAt(onStream, x, y), 'nothing of it at 0');
  let [r] = pixelAt(half, x, y), [fullR] = pixelAt(full, x, y), [streamR] = pixelAt(onStream, x, y);
  assert.ok(Math.abs(r - (fullR + streamR) / 2) <= 1, `halfway between, at 0.5: ${r} from ${fullR} and ${streamR}`);
  let alone = blank();
  renderBoard(alone, [obj('ResetSwitch', 2, 2, { fade: 0.5 })], look);
  assert.equal(pixelAt(alone, x, y)[3], 128, 'and half see-through over nothing');
  assert.deepEqual(pixelAt(alone, x, y).slice(0, 3), pixelAt(full, x, y).slice(0, 3));
});

test('a Reset Switch gets its own palette colour, and is a pad with arrows, unlike a Jump Tile', () => {
  let { art, look } = artLook();
  assert.ok(colorsIn(art).has(toRgb(look.palette.reset).join(',')));
  assert.equal(look.textures.reset.ramp.length, 4);
  let drawing = standardDrawing('ResetSwitch');
  assert.equal(drawing.pixels.length, 24 * 24);
  assert.equal(drawing.mix[0].role, 'reset');
  assert.notEqual(drawing.pixels, standardDrawing('JumpTile').pixels);
  // Turned half round it's the same arrows, since they chase each other round. Its darker edges are left out,
  // since those are always below.
  let shape = drawing.pixels.replace(/1/g, '2');
  assert.equal([...shape].reverse().join(''), shape);
});

// ---------- Archetons ----------

const SENTRIBEAM = { id: 'sentribeam', name: 'Sentribeam', parts: [{ kind: 'Beam', range: 2, look: 'AllWays', blockedByBlocks: true }, { kind: 'Push' }] };
const withArchetons = (archetons, ...objects) => createPuzzleGame({ objects, palette: {}, archetons });
const eye = (col, row, extra = {}) => obj('Archeton', col, row, { archeton: 'sentribeam', direction: 'Right', ...extra });

test('a Sentribeam pushes the ship away along its beam, any of 4 ways, up to 2 squares', () => {
  let g = withArchetons([SENTRIBEAM], eye(5, 5), obj('Start', 5, 7));
  assert.equal(g.carryDirection(at(5, 7)), 'down', '2 squares below, pushed down');
  assert.deepEqual(g.beams, [{ from: at(5, 5), to: at(5, 7), archeton: 'sentribeam' }]);
  g.placeShip(at(5, 8));
  assert.equal(g.carryDirection(at(5, 8)), null, 'out of reach at 3');
  assert.deepEqual(g.beams, []);
  g.placeShip(at(4, 5));
  assert.equal(g.carryDirection(at(4, 5)), 'left');
  g.placeShip(at(5, 3));
  assert.equal(g.carryDirection(at(5, 3)), 'up');
  g.placeShip(at(6, 6));
  assert.equal(g.carryDirection(at(6, 6)), null, 'not diagonally');
});

test('Walls, closed Gates and Push Blocks stop the beam, and it can\'t push into anything solid', () => {
  for (const blocker of [obj('Wall', 5, 6), obj('Gate', 5, 6, { letter: 'A' }), block(5, 6)]) {
    let g = withArchetons([SENTRIBEAM], eye(5, 5), blocker);
    g.placeShip(at(5, 7));
    assert.equal(g.carryDirection(at(5, 7)), null, blocker.kind);
  }
  let open = withArchetons([SENTRIBEAM], eye(5, 5), obj('Gate', 5, 6, { letter: 'A', open: true }));
  open.placeShip(at(5, 7));
  assert.equal(open.carryDirection(at(5, 7)), 'down', 'but not an open Gate');
  let notBlocks = withArchetons([{ ...SENTRIBEAM, parts: [{ kind: 'Beam', range: 2, look: 'AllWays', blockedByBlocks: false }, { kind: 'Push' }] }], eye(5, 5), block(5, 6));
  notBlocks.placeShip(at(5, 7));
  assert.equal(notBlocks.carryDirection(at(5, 7)), 'down', 'unless it says Push Blocks don\'t');
  let wallBehind = withArchetons([SENTRIBEAM], eye(5, 5), obj('Wall', 5, 8));
  wallBehind.placeShip(at(5, 7));
  assert.equal(wallBehind.carryDirection(at(5, 7)), null, 'nowhere to be pushed');
  assert.equal(wallBehind.beams.length, 1, 'though the laser still hits');
});

test('an Archeton is solid, one looking the way it faces only looks that way, and one with no Push only sees', () => {
  let g = withArchetons([SENTRIBEAM], eye(5, 5));
  assert.equal(g.canEnter(at(4, 5), at(5, 5), 'right'), false);
  let facing = withArchetons([{ ...SENTRIBEAM, parts: [{ kind: 'Beam', range: 3, look: 'Facing' }, { kind: 'Push' }] }], eye(5, 5, { direction: 'Up' }));
  facing.placeShip(at(5, 2));
  assert.equal(facing.carryDirection(at(5, 2)), 'up');
  facing.placeShip(at(5, 7));
  assert.equal(facing.carryDirection(at(5, 7)), null);
  let watcher = withArchetons([{ ...SENTRIBEAM, parts: [{ kind: 'Beam', range: 2, look: 'AllWays' }] }], eye(5, 5));
  watcher.placeShip(at(5, 6));
  assert.equal(watcher.carryDirection(at(5, 6)), null);
  assert.equal(watcher.beams.length, 1);
});

test('a Sentribeam\'s reach is every square its beam gets to, stopping at whatever blocks it', () => {
  let g = withArchetons([SENTRIBEAM], eye(5, 5), obj('Wall', 5, 6), block(4, 5));
  g.placeShip(at(0, 0));
  let reached = g.reaches.map(c => `${c.col},${c.row}`).sort();
  assert.deepEqual(reached, ['5,3', '5,4', '6,5', '7,5']);
});

test('a Beam with a Block keeps the ship out of its reach, showing its laser once the ship is one square off it', () => {
  let blocker = { id: 'sentribeam', name: 'Sentribeam', parts: [{ kind: 'Beam', range: 2, look: 'AllWays', blockedByBlocks: true }, { kind: 'Block' }] };
  let g = withArchetons([blocker], eye(5, 5));
  g.placeShip(at(5, 8));
  assert.deepEqual(g.beams, [{ from: at(5, 5), to: at(5, 7), archeton: 'sentribeam' }], 'one off its reach, the laser shows across it');
  assert.equal(g.canEnter(at(5, 8), at(5, 7), 'up'), false, 'and the ship can\'t step in');
  assert.equal(g.carryDirection(at(5, 8)), null, 'nor is it pushed');
  g.placeShip(at(2, 8));
  assert.deepEqual(g.beams, [], 'further off, it doesn\'t show');
  assert.equal(g.canEnter(at(4, 8), at(4, 7), 'up'), true, 'and squares beside the reach are fine');
});

test('a Beam\'s reach is only outlined if it says so', () => {
  let unmarked = { id: 'sentribeam', name: 'Sentribeam', parts: [{ kind: 'Beam', range: 2, look: 'AllWays', showReach: false }, { kind: 'Block' }] };
  let g = withArchetons([unmarked], eye(5, 5));
  assert.deepEqual(g.reaches, []);
});

test('a laser is drawn a little see-through, from its own drawing, a square at a time along the beam', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [], { ...look, archetons: [] }, { beams: [{ from: at(1, 1), to: at(3, 1), archeton: 'sentribeam' }] });
  let row = 24 + 11;
  for (const x of [2 * 24 + 5, 3 * 24 + 18]) assert.ok(pixelAt(image, x, row)[3] > 150 && pixelAt(image, x, row)[3] < 255, `see-through at ${x}`);
  assert.equal(pixelAt(image, 24 + 12, row)[3], 0, 'not over the Archeton\'s own square');
});

test('pushing a shielding block out of a Block\'s beam sends the ship back to the square it came from', () => {
  let blocker = { id: 'sentribeam', name: 'Sentribeam', parts: [{ kind: 'Beam', range: 2, look: 'AllWays', blockedByBlocks: true }, { kind: 'Block' }] };
  let g = withArchetons([blocker], eye(5, 5), block(6, 5), obj('Start', 6, 6));
  assert.equal(g.canEnter(at(6, 6), at(6, 5), 'up'), true, 'the block shields the square, so the ship can push it');
  g.pushFrom(at(6, 6), at(6, 5), 'up');
  g.settlePushes();
  g.shipArrivedAt(at(6, 5));
  assert.equal(g.carryDirection(at(6, 5)), 'down', 'with the block gone, the laser sends it back');
  assert.equal(find(g, 'PushBlock').row, 4, 'and the block stays where it was pushed');
});

test('a Push Block can be pushed onto an open Gate, sits in it, and can be pushed on out', () => {
  let g = game(block(2, 5), obj('Gate', 3, 5, { letter: 'A', open: true }), obj('Gate', 3, 7, { letter: 'B' }), block(2, 7), obj('Wall', 3, 6));
  assert.equal(g.canPush(at(2, 5), 'right'), true, 'onto an open Gate');
  assert.equal(g.canPush(at(2, 7), 'right'), false, 'but not a closed one');
  g.pushFrom(at(1, 5), at(2, 5), 'right');
  g.settlePushes();
  assert.deepEqual(blocksIn(g), ['Circle@2,7', 'Circle@3,5']);
  assert.equal(g.canEnter(at(2, 5), at(3, 5), 'right'), true, 'the ship pushes it on from there');
  assert.equal(g.canEnter(at(3, 4), at(3, 5), 'down'), false, 'and it\'s solid, even in the open Gate, where it can\'t be pushed');
  g.pushFrom(at(2, 5), at(3, 5), 'right');
  assert.deepEqual(blocksIn(g), ['Circle@2,7', 'Circle@4,5']);
});

test('a Gate closing on a Push Block sends it back to the square it was pushed from, unless that\'s taken', () => {
  let g = game(block(2, 5), obj('Gate', 3, 5, { letter: 'A', open: true }), obj('Switch', 3, 8, { letter: 'A' }));
  g.pushFrom(at(1, 5), at(2, 5), 'right');
  g.settlePushes();
  let event = g.shipArrivedAt(at(3, 8));
  assert.deepEqual(blocksIn(g), ['Circle@2,5'], 'back where it came from');
  assert.equal(event.returned.length, 1);
  assert.equal(find(g, 'PushBlock').glide, 'return');
  assert.equal(find(g, 'Gate').open, false);

  let taken = game(block(2, 5), obj('Gate', 3, 5, { letter: 'A', open: true }), obj('Switch', 3, 8, { letter: 'A' }), block(2, 3, 'Star'));
  taken.pushFrom(at(1, 5), at(2, 5), 'right');
  taken.settlePushes();
  taken.pushFrom(at(2, 2), at(2, 3), 'down'); // the Star into (2, 4)
  taken.settlePushes();
  taken.pushFrom(at(2, 3), at(2, 4), 'down'); // and on into (2, 5), where the Circle came from
  taken.settlePushes();
  assert.equal(taken.shipArrivedAt(at(3, 8)), null);
  assert.deepEqual(blocksIn(taken), ['Circle@3,5', 'Star@2,5'], 'with its square taken, it stays in the closed Gate');
});

// ---------- Slide Bugs ----------

const SLIDE_BUG = { id: 'slide-bug', name: 'Slide Bug', parts: [{ kind: 'Slide' }] };
const bug = (col, row, direction = 'Right') => obj('Archeton', col, row, { archeton: 'slide-bug', direction });
const bugsIn = (g) => g.objects.filter(o => o.archeton === 'slide-bug').map(o => `${o.col},${o.row}`);

test('a Slide Bug follows the ship along its row a square for each step, and a turned one along its column', () => {
  let g = withArchetons([SLIDE_BUG], bug(1, 3), bug(7, 1, 'Up'));
  let event = g.shipArrivedAt(at(5, 6));
  assert.deepEqual(bugsIn(g), ['2,3', '7,2'], 'one square each, towards the ship\'s column and row');
  assert.equal(event.slid.length, 2);
  assert.equal(g.objects.find(o => o.direction === 'Right').glide, 'slide');
  for (let i = 0; i < 5; i++) g.shipArrivedAt(at(5, 6));
  assert.deepEqual(bugsIn(g), ['5,3', '7,6'], 'and waits in line with it');
});

test('anything solid stops a Slide Bug, and so does the board\'s edge, and it\'s solid itself', () => {
  let g = withArchetons([SLIDE_BUG], bug(1, 3), obj('Wall', 3, 3), bug(8, 5), block(6, 5));
  for (let i = 0; i < 4; i++) g.shipArrivedAt(at(4, 8));
  assert.deepEqual(bugsIn(g), ['2,3', '7,5'], 'up against the Wall and the Push Block');
  let edge = withArchetons([SLIDE_BUG], bug(8, 2));
  edge.shipArrivedAt(at(9, 9));
  edge.shipArrivedAt(at(9, 9));
  assert.deepEqual(bugsIn(edge), ['9,2']);
  assert.equal(edge.canEnter(at(9, 3), at(9, 2), 'up'), false, 'the ship can\'t step into it');
});

test('a Slide Bug passes over a Switch, flipping its Gates, and lights a Lantern, and is what counts on that square', () => {
  let g = withArchetons([SLIDE_BUG], bug(1, 3), obj('Switch', 2, 3, { letter: 'A' }), obj('Gate', 0, 0, { letter: 'A' }), obj('Lantern', 3, 3), obj('Wall', 3, 6, { invisible: true }));
  g.shipArrivedAt(at(6, 8));
  assert.equal(find(g, 'Gate').open, true, 'the Switch it slid onto');
  assert.equal(g.canEnter(at(2, 4), at(2, 3), 'up'), false, 'and on the Switch, it\'s the bug that\'s in the way');
  let event = g.shipArrivedAt(at(6, 8));
  assert.equal(find(g, 'Lantern').lit, true);
  assert.ok(event.lit, 'with its pulse');
});

test('a Reset puts a Slide Bug back where it started', () => {
  let g = withArchetons([SLIDE_BUG], bug(1, 3), obj('ResetSwitch', 6, 8));
  g.shipArrivedAt(at(6, 7));
  g.shipArrivedAt(at(6, 7));
  assert.deepEqual(bugsIn(g), ['3,3']);
  g.shipArrivedAt(at(6, 8));
  assert.deepEqual(bugsIn(g), ['1,3'], 'reset by the ship, then not moved again till its next step');
});

test('a Slide Bug sliding into the ship hurts it, sending it back to the square it came from', () => {
  let g = withArchetons([SLIDE_BUG], bug(6, 3));
  g.placeShip(at(4, 4));
  g.shipArrivedAt(at(5, 4)); // beside its row, so the bug comes alongside
  g.shipArrivedAt(at(5, 3)); // then into its row, right in front of it
  assert.deepEqual(bugsIn(g), ['5,3'], 'it slides into the ship');
  assert.equal(g.carryDirection(at(5, 3)), 'down', 'and the ship is sent back down, where it came from');
  g.shipArrivedAt(at(5, 4));
  assert.deepEqual(bugsIn(g), ['5,3'], 'and isn\'t followed straight away as it gets back');
  g.shipArrivedAt(at(4, 4));
  assert.deepEqual(bugsIn(g), ['4,3'], 'then the bug carries on as before');
});

test('a Slide Bug won\'t hurt a ship that couldn\'t be sent anywhere', () => {
  let boxed = withArchetons([SLIDE_BUG], bug(6, 3), obj('Wall', 4, 3), obj('Wall', 5, 2), obj('Wall', 5, 4));
  boxed.shipArrivedAt(at(5, 3));
  assert.deepEqual(bugsIn(boxed), ['6,3'], 'boxed in, the bug waits beside it');
});

test('a Gate closing on a Slide Bug passes it back the way it came, past any other Gates closing with it', () => {
  // Two open Gates in the bug's row, with the ship's Switch down below, ahead of where the bug will be.
  let g = withArchetons([SLIDE_BUG], bug(1, 3), obj('Gate', 2, 3, { letter: 'A', open: true }), obj('Gate', 3, 3, { letter: 'A', open: true }), obj('Switch', 6, 8, { letter: 'A' }));
  g.shipArrivedAt(at(6, 7));
  g.shipArrivedAt(at(6, 7));
  assert.deepEqual(bugsIn(g), ['3,3'], 'the bug slides into the second Gate');
  let event = g.shipArrivedAt(at(6, 8)); // the Switch closes both
  assert.deepEqual(bugsIn(g), ['1,3'], 'back past both closed Gates, to where it was before them');
  assert.ok(event.returned.some(o => o.archeton === 'slide-bug'));
  assert.equal(g.objects.find(o => o.archeton === 'slide-bug').glide, 'return');
});

test('a Gate a Slide Bug closes on the ship sends the ship back, as being hurt does', () => {
  let g = withArchetons([SLIDE_BUG], bug(1, 3), obj('Switch', 2, 3, { letter: 'A' }), obj('Gate', 6, 5, { letter: 'A', open: true }));
  g.placeShip(at(6, 6));
  g.shipArrivedAt(at(6, 5)); // into the open Gate, as the bug slides onto the Switch
  assert.equal(find(g, 'Gate').open, false);
  assert.equal(g.carryDirection(at(6, 5)), 'down', 'back where it came from');
});

test('an open Gate is drawn half see-through, and a closed one solid', () => {
  let { look } = artLook();
  let draw = (open) => { let image = blank(); renderBoard(image, [obj('Gate', 2, 2, { letter: 'A', open })], look); return image; };
  let alphas = (image) => { let set = new Set(); for (let y = 48; y < 72; y++) for (let x = 48; x < 72; x++) { let a = pixelAt(image, x, y)[3]; if (a) set.add(a); } return [...set]; };
  assert.deepEqual(alphas(draw(false)), [255]);
  assert.deepEqual(alphas(draw(true)), [128]);
});

test('a Slide Bug that\'s got where it\'s going stays still, however another bug keeps sliding', () => {
  let g = withArchetons([SLIDE_BUG], bug(4, 3), bug(0, 1));
  g.shipArrivedAt(at(5, 7));
  for (let i = 0; i < 3; i++) {
    g.shipArrivedAt(at(5, i % 2 ? 7 : 6)); // up and down, across their lines
    let still = g.objects.find(o => o.archeton === 'slide-bug' && o.row === 3);
    assert.deepEqual([still.col, still.fromCol], [5, 5], 'not drawn sliding into its square again');
  }
});

test('stepping onto a Pipe Switch turns the Pipes straight away, and a Slide Bug sliding onto one does too', () => {
  let g = game(obj('PipeSwitch', 2, 5), obj('Pipe', 5, 5, { direction: 'Right' }));
  let event = g.shipArrivedAt(at(2, 5));
  assert.deepEqual(event, { pipesTurned: true });
  assert.equal(g.floors[0].direction, 'Up');
  let slid = withArchetons([SLIDE_BUG], bug(1, 3), obj('PipeSwitch', 2, 3), obj('Pipe', 7, 7, { direction: 'Right' }));
  assert.ok(slid.shipArrivedAt(at(6, 8)).pipesTurned);
  assert.equal(slid.floors[0].direction, 'Up');
});
