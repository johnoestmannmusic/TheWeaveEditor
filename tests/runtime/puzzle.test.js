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

test('a Stream can\'t be walked against, on it or onto it head-on, but can be walked along or across', () => {
  let g = game(obj('Stream', 3, 3, { direction: 'Right' }));
  assert.equal(g.canEnter(at(3, 3), at(2, 3), 'left'), false);
  assert.equal(g.canEnter(at(4, 3), at(3, 3), 'left'), false);
  assert.equal(g.canEnter(at(2, 3), at(3, 3), 'right'), true);
  assert.equal(g.canEnter(at(3, 3), at(4, 3), 'right'), true);
  assert.equal(g.canEnter(at(3, 2), at(3, 3), 'down'), true);
  assert.equal(g.canEnter(at(3, 3), at(3, 4), 'down'), true);
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
