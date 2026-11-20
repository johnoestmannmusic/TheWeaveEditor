// Run with: node --test tests/runtime/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { placeObject, eraseObject, suggestLetter, pickPalette, BOARD_TIMING } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

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

test('a Crane is offered the letter of its unfinished pair, then a new one', () => {
  assert.equal(suggestLetter([], 'Crane'), 'A');
  assert.equal(suggestLetter([lettered('Crane', 'C')], 'Crane'), 'C');
  assert.equal(suggestLetter([lettered('Crane', 'C'), lettered('Crane', 'C')], 'Crane'), 'A');
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

const { createPuzzleGame, hasFinish, crossingCell, startOf, CRANE_MS, cranePose, craneLoad } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const at = (col, row) => ({ col, row });
const game = (...objects) => createPuzzleGame({ objects, palette: {} });
// A Switch's Gates don't change on the press: the Beam it sends out reaches them first - see advanceGateBeams. Anything
// stepping on a Switch and looking for its Gates to have changed lets it land first.
const land = (g) => g.advanceGateBeams(BOARD_TIMING.gateBeamTravelMs);
const obj = (kind, col, row, extra = {}) => ({ kind, col, row, ...extra });
const find = (g, kind) => g.objects.find(o => o.kind === kind);

test('the ship begins on Start, or the default square if there is none', () => {
  assert.deepEqual(game(obj('Start', 2, 3)).start, at(2, 3));
  assert.deepEqual(game().start, at(5, 9));
  assert.deepEqual(game(obj('Start', 2, 3)).shipCell, at(2, 3));
});

test('a ship crossing on to another part comes in on that part\'s Start, wherever it finished the last one', () => {
  let next = { objects: [obj('Start', 7, 9), obj('Finish', 9, 1)] };

  // The ship finished the board from (5, 0) - its reflection was the one on the Finish, off at the far side of a
  // pane - so the ship's own square must not be what decides where the next part picks it up.
  assert.deepEqual(crossingCell({ next, from: at(5, 0), exit: 'Up', onward: true }), at(7, 9));
  // Even standing on the Finish, it comes in on the Start: the two are meant to be across from each other, and the
  // Start is the square a player is meant to begin a board on.
  assert.deepEqual(crossingCell({ next, from: at(4, 0), exit: 'Up', onward: true }), at(7, 9));

  // No Start to come in on: the square across from where it left, as before.
  assert.deepEqual(crossingCell({ next: { objects: [] }, from: at(4, 0), exit: 'Up', onward: true }), at(4, 9));

  // Going back the other way, it is the square across from the Start it left by - the Finish it walked off - and a
  // Start on that board is not where it comes in.
  let back = { objects: [obj('Start', 4, 9), obj('Finish', 7, 0)] };
  assert.deepEqual(crossingCell({ next: back, from: at(7, 9), exit: 'Down', onward: false }), at(7, 0));
});

test('a board\'s Start square reads the same for the game and for a crossing', () => {
  let puzzle = { objects: [obj('Start', 7, 9), obj('Finish', 9, 1)] };
  assert.deepEqual(startOf(puzzle), at(7, 9));
  assert.deepEqual(createPuzzleGame(puzzle).start, at(7, 9), 'the same square the ship begins on');
  assert.equal(startOf({ objects: [] }), null, 'no Start, no square');
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

test('a Switch sends a Beam out, and its Gates change when it lands rather than on the press', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Gate', 2, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }));

  let event = g.shipArrivedAt(at(5, 5));
  assert.deepEqual(event.gateBeam, { from: at(5, 5), to: [at(1, 0), at(2, 0)] }, 'aimed at every Gate with its letter');
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), false, 'and they are still as they were');

  let [landed] = g.advanceGateBeams(BOARD_TIMING.gateBeamTravelMs);
  assert.deepEqual(landed.gateLanded.gates, [{ col: 1, row: 0, open: true }, { col: 2, row: 0, open: true }], 'both of them, together');
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), true);
  assert.equal(g.canEnter(at(2, 1), at(2, 0), 'up'), true);
});

test('a Beam in flight is reported while it flies, and a Switch with no Gates sends none', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }));
  g.shipArrivedAt(at(5, 5));
  assert.deepEqual(g.gateBeams.map(beam => beam.ms), [0]);
  g.advanceGateBeams(BOARD_TIMING.gateBeamTravelMs / 2);
  assert.deepEqual(g.gateBeams.map(beam => beam.ms), [BOARD_TIMING.gateBeamTravelMs / 2]);
  assert.deepEqual(g.advanceGateBeams(BOARD_TIMING.gateBeamTravelMs), [{ gateLanded: { from: at(5, 5), gates: [{ col: 1, row: 0, open: true }] } }], 'landing as it arrives');
  assert.deepEqual(g.gateBeams, [], 'and gone once it has');

  assert.equal(game(obj('Switch', 5, 5, { letter: 'B' })).shipArrivedAt(at(5, 5)), null, 'nothing to aim at');
});

test('a Reset Switch takes any Beam still in flight with it', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }), obj('ResetSwitch', 7, 7));
  g.shipArrivedAt(at(5, 5));
  assert.equal(g.gateBeams.length, 1);
  g.shipArrivedAt(at(7, 7));
  assert.deepEqual(g.gateBeams, [], 'the board is back as it started, so nothing is still on its way to it');
  assert.deepEqual(g.advanceGateBeams(BOARD_TIMING.gateBeamTravelMs), [], 'and nothing lands later');
  assert.equal(find(g, 'Gate').open, false);
});

// ---------- Gems and the Gem Gate ----------

test('a Gem Gate blocks the way until every Gem on the board has been collected', () => {
  let g = game(obj('GemGate', 1, 0), obj('Gem', 5, 5), obj('Gem', 7, 5));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), false, 'shut to begin with');
  g.shipArrivedAt(at(5, 5));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), false, 'still shut with one Gem left');
  g.shipArrivedAt(at(7, 5));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), true, 'open once the last one is collected');
});

test('a board with no Gems never opens its Gem Gate', () => {
  let g = game(obj('GemGate', 1, 0), obj('Switch', 5, 5, { letter: 'A' }));
  g.shipArrivedAt(at(5, 5));
  land(g);
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), false, 'a wall, since there was never anything to collect');
});

test('a Gem is collected by the ship stepping on it, and says where it went', () => {
  let g = game(obj('GemGate', 1, 0), obj('Gem', 5, 5));
  assert.equal(g.objects.filter(o => o.kind === 'Gem').length, 1);
  g.placeShip(at(5, 6));
  let event = g.shipArrivedAt(at(5, 5));
  assert.equal(g.objects.filter(o => o.kind === 'Gem').length, 0, 'gone from the board');
  assert.deepEqual(event.gem, { col: 5, row: 5, to: at(1, 0), last: true }, 'and its shot has somewhere to go');
});

test('a Push Block shoved onto a Gem leaves it there for the ship', () => {
  let g = game(obj('GemGate', 1, 0), obj('Gem', 6, 5), block(5, 5));
  g.placeShip(at(4, 5));
  g.shipArrivedAt(at(5, 5));
  assert.equal(g.objects.filter(o => o.kind === 'Gem').length, 1, 'only the ship collects it');
});

test('a Gem is drawn turning on the spot: full width front on, narrower at the turn, and never quite gone', () => {
  let { look } = artLook();
  let drawn = (phase) => {
    let image = blank();
    renderBoard(image, [obj('Gem', 3, 3)], look, { gemPhase: phase });
    let count = 0;
    for (let y = 3 * TILE_PX; y < 4 * TILE_PX; y++) for (let x = 3 * TILE_PX; x < 4 * TILE_PX; x++) if (pixelAt(image, x, y)[3]) count++;
    return count;
  };
  assert.ok(drawn(0) > drawn(0.25), 'narrower at the turn than front on');
  assert.ok(drawn(0.25) > 0, 'but never gone, which would read as a flicker');
  assert.equal(drawn(0.5), drawn(0), 'and front on again, half way round');
});

test('a Gem is drawn with nothing around it, and a Gem Gate carries a Gem where a Gate carries its letter', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [obj('Gem', 3, 3)], look, { gemPhase: 0 });
  // Just above the tip of the diamond: nothing. Any glow is the drawing's own, painted in the Drawings view.
  assert.equal(pixelAt(image, 3 * TILE_PX + 12, 3 * TILE_PX)[3], 0, 'no halo around it');

  // No letter, so two placed with different ones are drawn the same...
  let one = blank();
  renderBoard(one, [obj('GemGate', 3, 3, { letter: 'A' })], look, {});
  let other = blank();
  renderBoard(other, [obj('GemGate', 3, 3, { letter: 'B' })], look, {});
  assert.equal(tile(one, 3, 3), tile(other, 3, 3), 'a Gem Gate has no letter on it');
  // ...and opening it changes how it's drawn, with nothing else about it changed: a board that has had its Gem Gate
  // on it all along mustn't keep showing the shut one out of its sprite cache.
  let shut = blank();
  renderBoard(shut, [obj('GemGate', 3, 3)], look, {});
  let open = blank();
  renderBoard(open, [obj('GemGate', 3, 3, { open: true })], look, {});
  assert.notEqual(tile(shut, 3, 3), tile(open, 3, 3), 'an open one is drawn open');
});

test('an open Gem Gate is see-through by as much as an open Gate is', () => {
  let { look } = artLook();
  let alphaAt = (object) => {
    let image = blank();
    renderBoard(image, [object], look, {});
    // The top of the ring, which both are drawn with: how much of what's behind them shows through.
    return pixelAt(image, 3 * TILE_PX + 12, 3 * TILE_PX + 2)[3];
  };
  let gate = alphaAt(obj('Gate', 3, 3, { letter: 'A', open: true }));
  assert.ok(gate > 0 && gate < 255, 'an open Gate is part see-through');
  assert.equal(alphaAt(obj('GemGate', 3, 3, { open: true })), gate, 'and an open Gem Gate by the same amount');
  assert.equal(alphaAt(obj('GemGate', 3, 3)), 255, 'while a shut one is solid');
});

test('a Gem on its way to the Gate is drawn between the two squares', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [obj('GemGate', 3, 2)], look, { gemPhase: 0, gemShots: [{ from: at(3, 5), to: at(3, 2), along: 0.5 }] });
  // Half way is a square and a half below the Gate: drawn there, and not on either square it's between.
  assert.ok(rowsDrawn(image, 3).length > 0);
  let between = [];
  for (let y = 3 * TILE_PX + 12; y < 4 * TILE_PX + 12; y++) if (pixelAt(image, 3 * TILE_PX + 12, y)[3]) between.push(y);
  assert.ok(between.length > 0, 'drawn part way there');
});

test('a puzzle has one Gem Gate, so placing a second moves the first', () => {
  let objects = placeObject([obj('GemGate', 1, 1)], obj('GemGate', 6, 6));
  assert.deepEqual(objects.filter(o => o.kind === 'GemGate').map(o => `${o.col},${o.row}`), ['6,6']);
});

test('a Gate blocks until its own Switch opens it', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Gate', 2, 0, { letter: 'B' }), obj('Switch', 5, 5, { letter: 'A' }));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), false);
  g.shipArrivedAt(at(5, 5));
  land(g);
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), true);
  assert.equal(g.canEnter(at(2, 1), at(2, 0), 'up'), false);
});

test('stepping on a Switch again closes its Gates again', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }));
  g.shipArrivedAt(at(5, 5));
  land(g);
  assert.equal(find(g, 'Gate').open, true);
  g.shipArrivedAt(at(5, 5));
  land(g);
  assert.equal(find(g, 'Gate').open, false);
});

test('a Gate can start open, and a Switch flips each Gate from whatever state it\'s in', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A', open: true }), obj('Gate', 2, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }));
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), true);
  assert.equal(g.canEnter(at(2, 1), at(2, 0), 'up'), false);
  g.shipArrivedAt(at(5, 5));
  land(g);
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
  land(g);
  assert.ok(g.objects.filter(o => o.kind === 'Gate').every(o => o.open));
});

test('Switches do nothing until every Key is collected, then need stepping on again', () => {
  let g = game(obj('Gate', 1, 0, { letter: 'A' }), obj('Switch', 5, 5, { letter: 'A' }), obj('Key', 6, 6), obj('Key', 7, 7));
  g.shipArrivedAt(at(5, 5));
  land(g);
  assert.equal(find(g, 'Gate').open, false);
  g.shipArrivedAt(at(6, 6));
  land(g);
  g.shipArrivedAt(at(5, 5));
  land(g);
  assert.equal(find(g, 'Gate').open, false);
  g.shipArrivedAt(at(7, 7));
  land(g);
  assert.equal(find(g, 'Gate').open, false);
  g.shipArrivedAt(at(5, 5));
  land(g);
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
  land(g);
  g.shipArrivedAt(at(2, 5));
  land(g);
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
  land(toggle);
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
  land(g);
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

test('a claw is drawn over the square it is working on, held above it by its lift', () => {
  let { look } = artLook();
  let from = blank(), to = blank(), lifted = blank();
  renderBoard(from, [], look, { cranes: [{ cell: at(0, 0), lift: 0.5 }] });
  renderBoard(to, [], look, { cranes: [{ cell: at(5, 5), lift: 0 }] });
  renderBoard(lifted, [], look, { cranes: [{ cell: at(5, 5), lift: 1 }] });

  let drawn = (image, col, row) => {
    for (let y = row * TILE_PX; y < (row + 1) * TILE_PX; y++) {
      for (let x = col * TILE_PX; x < (col + 1) * TILE_PX; x++) if (pixelAt(image, x, y)[3] > 0) return true;
    }
    return false;
  };
  assert.ok(drawn(from, 0, 0), 'coming down on the square it works on');
  assert.equal(drawn(from, 5, 5), false, 'and nowhere near the other one');
  assert.ok(drawn(to, 5, 5), 'holding on it');
  assert.equal(drawn(to, 0, 0), false, 'with nothing left behind');
  // A lift of one square puts the claw in the square above: that is the haul the fade happens over.
  assert.ok(drawn(lifted, 5, 4), 'a whole square up, it is over the square above');
  assert.equal(drawn(lifted, 5, 5), false, 'and nothing of it is left on its own');
});

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

test('a Lantern Pulse Tile lights what it reaches, and takes the step onto it for free', () => {
  let g = game(obj('LanternPulse', 2, 5, { steps: 3 }), obj('Wall', 2, 6, { invisible: true }));
  assert.equal(find(g, 'Wall').revealed, false, 'nothing is lit until it is stepped on');
  g.placeShip(at(2, 4));
  g.shipArrivedAt(at(2, 5));
  assert.equal(find(g, 'Wall').revealed, true);
  assert.equal(find(g, 'LanternPulse').lit, true);
  assert.equal(find(g, 'LanternPulse').charge, 3, 'the step onto it spends nothing');
});

test('a Pulse Tile\'s count runs down with the ship\'s steps, and what it lit goes back to unseen at 0', () => {
  let g = game(obj('LanternPulse', 2, 5, { steps: 2 }), obj('Wall', 2, 6, { invisible: true }));
  g.placeShip(at(2, 4));
  g.shipArrivedAt(at(2, 5));          // step onto it: 2, and free
  g.shipArrivedAt(at(3, 5));          // the ship's own step: 1
  assert.equal(find(g, 'LanternPulse').charge, 1);
  assert.equal(find(g, 'Wall').revealed, true);
  g.shipArrivedAt(at(3, 4));          // 0 - and nothing covers it any more
  assert.equal(find(g, 'LanternPulse').charge, 0);
  assert.equal(find(g, 'LanternPulse').lit, false);
  assert.equal(find(g, 'Wall').revealed, false);
});

test('a Pulse Tile\'s count runs to 19, and is held between 1 and 19', () => {
  let g = game(obj('LanternPulse', 2, 5, { steps: 25 }));
  g.placeShip(at(2, 4));
  g.shipArrivedAt(at(2, 5));
  assert.equal(find(g, 'LanternPulse').charge, 19, 'no more than a tile can show');

  let none = game(obj('LanternPulse', 2, 5, { steps: 0 }));
  none.placeShip(at(2, 4));
  none.shipArrivedAt(at(2, 5));
  assert.equal(find(none, 'LanternPulse').charge, 1, 'nor fewer than one step of light');
});

test('a forced step doesn\'t spend a Pulse Tile\'s count, and a second tile keeps what the first let go', () => {
  let g = game(
    obj('LanternPulse', 2, 5, { steps: 1 }),
    obj('LanternPulse', 4, 5, { steps: 3 }),
    obj('Wall', 3, 5, { invisible: true }));
  g.placeShip(at(2, 4));
  g.shipArrivedAt(at(2, 5));            // the first tile: 1
  g.shipArrivedAt(at(3, 5));            // spends it
  assert.equal(find(g, 'Wall').revealed, false, 'only the first tile reached it');
  g.shipArrivedAt(at(4, 5));            // the second tile: 3
  assert.equal(find(g, 'Wall').revealed, true);
  g.shipArrivedAt(at(5, 5), { forced: true });
  assert.equal(g.objects.find(o => o.kind === 'LanternPulse' && o.col === 4).charge, 3, 'carried, not walked');
});

test('a lit Lantern keeps what a Pulse Tile ran out of lighting, and a tile re-arms when stepped on again', () => {
  let g = game(obj('Lantern', 2, 5), obj('LanternPulse', 4, 5, { steps: 1 }), obj('Wall', 3, 5, { invisible: true }));
  g.placeShip(at(2, 4));
  g.shipArrivedAt(at(2, 5));            // the Lantern lights for good
  g.placeShip(at(4, 4));
  g.shipArrivedAt(at(4, 5));            // the tile arms to 1
  g.shipArrivedAt(at(3, 5));            // spends it
  assert.equal(find(g, 'LanternPulse').charge, 0);
  assert.equal(find(g, 'Wall').revealed, true, 'the Lantern still reaches it');

  let own = game(obj('LanternPulse', 2, 5, { steps: 1 }), obj('Wall', 2, 6, { invisible: true }));
  own.placeShip(at(2, 4));
  own.shipArrivedAt(at(2, 5));
  own.shipArrivedAt(at(2, 4));          // spent: the Wall goes dark again
  assert.equal(find(own, 'Wall').revealed, false);
  own.shipArrivedAt(at(2, 5));          // and stepping back on puts the count back
  assert.equal(find(own, 'LanternPulse').charge, 1);
  assert.equal(find(own, 'Wall').revealed, true);
});

test('invisible things behave exactly the same', () => {
  let g = game(obj('Wall', 1, 0, { invisible: true }), obj('Stream', 3, 3, { direction: 'Right', invisible: true }), obj('Gate', 5, 0, { letter: 'A', invisible: true }), obj('Switch', 6, 6, { letter: 'A', invisible: true }), obj('Finish', 8, 8));
  assert.equal(g.canEnter(at(0, 0), at(1, 0), 'right'), false);
  assert.equal(g.carryDirection(at(3, 3)), 'right');
  assert.equal(g.canEnter(at(3, 3), at(3, 2), 'up'), false);
  assert.equal(g.canEnter(at(4, 0), at(5, 0), 'right'), false);
  g.shipArrivedAt(at(6, 6));
  land(g);
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
  land(g);
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
  land(g);
  g.shipArrivedAt(at(7, 7)); // so the Switch opens Gate A
  land(g);
  g.shipArrivedAt(at(3, 3)); // the Lantern reveals the Wall and Stream
  land(g);
  assert.deepEqual(blocksIn(g), ['Circle@7,2']);
  assert.equal(g.objects.find(o => o.letter === 'A' && o.kind === 'Gate').open, true);
  assert.equal(find(g, 'Wall').revealed, true);

  let event = g.shipArrivedAt(at(9, 9));
  land(g);
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

test('a Reset Switch leaves Gems already collected collected, and their Gem Gate open', () => {
  let g = game(obj('GemGate', 1, 0), obj('Gem', 5, 5), obj('Gem', 7, 5), obj('Start', 0, 5), reset(9, 9));

  g.shipArrivedAt(at(5, 5)); // one Gem taken
  g.shipArrivedAt(at(9, 9));
  assert.deepEqual(g.objects.filter(o => o.kind === 'Gem').map(o => [o.col, o.row]), [[7, 5]], 'the one still there is back on its square');
  assert.equal(find(g, 'GemGate').open, false, 'and the Gate is still shut with a Gem left');

  g.shipArrivedAt(at(7, 5)); // the last one
  assert.equal(find(g, 'GemGate').open, true);
  g.shipArrivedAt(at(9, 9));
  assert.equal(g.objects.filter(o => o.kind === 'Gem').length, 0, 'no Gem comes back');
  assert.equal(find(g, 'GemGate').open, true, 'so the Gate it opened stays open');
  assert.equal(g.canEnter(at(1, 1), at(1, 0), 'up'), true, 'and the way through is open');
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

test('a Lantern Pulse Tile is a hollow ring in the light paint, and its count shows only once it is lit', () => {
  let drawing = standardDrawing('LanternPulse');
  assert.equal(drawing.pixels.length, TILE_PX * TILE_PX);
  assert.match(drawing.pixels, /^[.H]+$/, 'lines only, in the light paint, so it reads on a dark board');
  assert.deepEqual(drawing.mix, standardMix('lantern'));
  assert.equal(drawing.pixels[12 * TILE_PX + 12], '.', 'hollow in the middle, for the count');

  let { look } = artLook();
  let unlit = blank(), lit = blank();
  renderBoard(unlit, [obj('LanternPulse', 0, 0, { steps: 3 })], look);
  renderBoard(lit, [obj('LanternPulse', 0, 0, { steps: 3, charge: 3, lit: true })], look);
  assert.equal(pixelAt(unlit, 12, 12)[3], 0, 'nothing in the middle of a tile that has not been lit');
  assert.ok(pixelAt(lit, 12, 12)[3] > 0, 'and a count there once it is');

  // The Editor has no playthrough to light one, so it asks for the count anyway.
  let editing = blank();
  renderBoard(editing, [obj('LanternPulse', 0, 0, { steps: 3 })], look, { showCounts: true });
  assert.ok(pixelAt(editing, 12, 12)[3] > 0, 'so an author can see what each tile is set to');
  assert.notDeepEqual(tile(unlit, 0, 0), tile(editing, 0, 0), 'and the count is the only difference');
});

test('a Crane is a corner-bracketed square with room for its letter, and its claw is its own drawing', () => {
  let crane = standardDrawing('Crane');
  assert.equal(crane.pixels.length, TILE_PX * TILE_PX);
  assert.match(crane.pixels, /^[.H]+$/, 'lines only, in the light paint, so it reads on a dark board');
  assert.equal(crane.pixels[12 * TILE_PX + 12], '.', 'clear in the middle, for the letter');
  assert.deepEqual(crane.mix, standardMix('teleporter'));

  let claw = standardDrawing('CraneArm');
  assert.equal(claw.pixels.length, TILE_PX * TILE_PX);
  assert.match(claw.pixels, /^[.H]+$/);
  assert.notEqual(claw.pixels, crane.pixels, 'the claw is a shape, not a frame');
  assert.ok([...claw.pixels].filter((paint) => paint === 'H').length > 40, 'with enough of it drawn to see');

  let { look } = artLook();
  let a = blank(), b = blank();
  renderBoard(a, [obj('Crane', 0, 0, { letter: 'A' })], look);
  renderBoard(b, [obj('Crane', 0, 0, { letter: 'B' })], look);
  assert.notDeepEqual(tile(a, 0, 0), tile(b, 0, 0), 'its letter says which square it pairs with');
});

test('a Pulse Tile shows a count past nine as two digits', () => {
  let { look } = artLook();
  let two = blank(), twelve = blank(), nineteen = blank();
  renderBoard(two, [obj('LanternPulse', 0, 0, { steps: 2, charge: 2, lit: true })], look);
  renderBoard(twelve, [obj('LanternPulse', 0, 0, { steps: 12, charge: 12, lit: true })], look);
  renderBoard(nineteen, [obj('LanternPulse', 0, 0, { steps: 19, charge: 19, lit: true })], look);

  // The digits drawn across the middle of the hollow, either side of its centre.
  let across = (image) => Array.from({ length: TILE_PX }, (_, x) => x)
    .filter((x) => Math.abs(x - 11.5) < 8 && pixelAt(image, x, 11)[3] > 0);
  assert.ok(across(twelve).length > across(two).length, 'two digits take more of the middle than one');
  assert.notDeepEqual(tile(twelve, 0, 0), tile(nineteen, 0, 0), 'and they are not just the same picture');
  assert.ok(across(nineteen).length > 0, 'nineteen is drawn');
});

test('every count from 10 to 19 draws both of its digits', () => {
  let { look } = artLook();
  let image = (steps) => { let one = blank(); renderBoard(one, [obj('LanternPulse', 0, 0, { steps, charge: steps, lit: true })], look); return one; };
  // How wide the count is inside the ring, halo included: a single digit measures 9 to 11 pixels across, a pair 13 or
  // 14, so anything over 12 is both digits drawn. A glyph missing from PIXEL_LETTERS draws nothing at all - 10 once
  // read as a 1, because 0 wasn't in the table.
  let width = (image) => {
    let xs = [];
    for (let y = 7; y < 17; y++) for (let x = 0; x < TILE_PX; x++) {
      if (Math.abs(x - 11.5) < 8 && pixelAt(image, x, y)[3] > 0) xs.push(x);
    }
    return Math.max(...xs) - Math.min(...xs);
  };
  assert.ok(width(image(9)) < 12, 'one digit is one digit wide');
  for (let count = 10; count <= 19; count++) assert.ok(width(image(count)) > 12, `a count of ${count} draws both digits`);
});

test('an object drawn with a tint is washed in that colour, and the cached sprite is left alone', () => {
  let { look } = artLook();
  let pulse = obj('LanternPulse', 0, 0, { steps: 3, charge: 3, lit: true });
  let plain = blank(), washed = blank(), fresh = blank();
  renderBoard(plain, [pulse], look);
  // The red a Resonant Guard and the Pulse Tiles that killed it share - see board.js's RESONANCE_RED.
  renderBoard(washed, [{ ...pulse, tint: { color: { r: 214, g: 44, b: 38 }, amount: 0.6 } }], look);
  renderBoard(fresh, [pulse], look);

  let [r0, g0] = pixelAt(plain, 1, 11), [r1, g1] = pixelAt(washed, 1, 11);
  assert.ok(pixelAt(washed, 1, 11)[3] > 0, 'the ring is still drawn');
  assert.ok(g1 < g0, `washed towards red, so less green: ${g0} -> ${g1}`);
  assert.ok(r1 - g1 > r0 - g0 + 40, `and far redder than green: ${r0 - g0} -> ${r1 - g1}`);
  // Tinting copies the sprite rather than painting it: a sprite is cached and shared with every other tile.
  assert.deepEqual(tile(fresh, 0, 0), tile(plain, 0, 0), 'the next tile drawn is not red too');
});

test('a lit Pulse Tile glows outside its ring only, so its hollow stays hollow', () => {
  let { look } = artLook();
  let lit = blank(), unlit = blank();
  // No count, so the only difference between the two is the glow itself.
  renderBoard(lit, [obj('LanternPulse', 0, 0, { steps: 0, lit: true })], look);
  renderBoard(unlit, [obj('LanternPulse', 0, 0, { steps: 0 })], look);

  let pixels = (image) => Array.from({ length: TILE_PX * TILE_PX }, (_, i) => ({ x: i % TILE_PX, y: Math.floor(i / TILE_PX), a: pixelAt(image, i % TILE_PX, Math.floor(i / TILE_PX))[3] }));
  let inside = (image) => pixels(image).filter((p) => p.a > 0 && Math.hypot(p.x - 11.5, p.y - 11.5) < 8).length;
  let drawn = (image) => pixels(image).filter((p) => p.a > 0).length;

  // glowing() fills whatever isn't drawn, which for a ring is its own middle: the tile then reads as a solid disc with
  // the count sitting on it. The halo belongs outside the ring, where the room is.
  assert.equal(inside(lit), inside(unlit), 'being lit adds nothing inside the ring');
  assert.ok(drawn(lit) > drawn(unlit), 'and adds a halo outside it');
});

test('an object can be drawn rattled where it stands, and lunging past its own square', () => {
  let { look } = artLook();
  let still = blank(), rattled = blank(), lunged = blank();
  renderBoard(still, [obj('Wall', 2, 2)], look);
  renderBoard(rattled, [obj('Wall', 2, 2, { shake: 2 })], look);
  renderBoard(lunged, [obj('Wall', 2, 2, { lungeX: 12 })], look);
  assert.notDeepEqual(tile(rattled, 2, 2), tile(still, 2, 2), 'a Wall moved 2 pixels to the side');
  assert.notDeepEqual(tile(lunged, 2, 2), tile(still, 2, 2), 'and one moved half a square');
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

const GUARD = {
  id: 'resonant-guard', name: 'Resonant Guard',
  parts: [{ kind: 'Detect', range: 1 }, { kind: 'Shove', distance: 3 }, { kind: 'Resonance' }],
};
const guard = (col, row) => obj('Archeton', col, row, { archeton: 'resonant-guard', direction: 'Right' });

test('a Resonant Guard shoves the ship 3 squares back as it comes within 1, and only once as it comes in', () => {
  let g = withArchetons([GUARD], guard(5, 5), obj('Start', 5, 8));
  let caught = g.shipArrivedAt(at(5, 6));
  assert.deepEqual(caught.shove, { from: at(5, 5), direction: 'Down', distance: 3 });
  assert.equal(g.carryDirection(at(5, 6)), 'down', 'the first of its 3');
  g.shipArrivedAt(at(5, 7));
  assert.equal(g.carryDirection(at(5, 7)), 'down');
  g.shipArrivedAt(at(5, 8));
  assert.equal(g.carryDirection(at(5, 8)), 'down', 'the last of its 3');
  g.shipArrivedAt(at(5, 9));
  assert.equal(g.carryDirection(at(5, 9)), null, 'and that is all of them');

  // Coming back in is a new catch - but only after leaving the zone. With a range of 1 the zone is the four squares
  // around the guard, so (5,8) and (5,7) are both outside it and (5,6) is inside.
  g.shipArrivedAt(at(5, 8));
  assert.equal(g.carryDirection(at(5, 8)), null);
  g.shipArrivedAt(at(5, 7));
  g.shipArrivedAt(at(5, 6));            // in again: caught again
  assert.equal(g.carryDirection(at(5, 6)), 'down');
});

test('a shove stops on the last clear square, and a shove with nowhere to go does nothing at all', () => {
  let g = withArchetons([GUARD], guard(5, 5), obj('Wall', 5, 8), obj('Start', 5, 7));
  g.shipArrivedAt(at(5, 6));
  assert.equal(g.carryDirection(at(5, 6)), 'down', 'the first square is clear');
  g.shipArrivedAt(at(5, 7));
  assert.equal(g.carryDirection(at(5, 7)), null, 'the Wall stops it');
  assert.deepEqual(g.shipCell, at(5, 7));

  let walled = withArchetons([GUARD], guard(5, 5), obj('Wall', 5, 7), obj('Start', 5, 6));
  let caught = walled.shipArrivedAt(at(5, 6));
  assert.ok(caught.shove, 'it still lunges');
  assert.equal(walled.carryDirection(at(5, 6)), null, 'but there is nowhere to shove it');
  assert.deepEqual(walled.shipCell, at(5, 6), 'and nothing else happens');
});

test('a guard with Resonance shakes when a Pulse Tile lights, harder with each tile already lit', () => {
  let tiles = () => [obj('LanternPulse', 1, 1, { steps: 3 }), obj('LanternPulse', 3, 3, { steps: 3 }), obj('LanternPulse', 5, 5, { steps: 3 })];
  let g = withArchetons([GUARD], guard(9, 9), ...tiles());
  let lightAt = (col, row) => {
    g.placeShip(at(col, row + 1));
    return g.shipArrivedAt(at(col, row));
  };

  assert.equal(lightAt(1, 1).resonance.active, 1, 'the first tile: one lit');
  assert.equal(lightAt(3, 3).resonance.active, 2, 'the second: harder');
  let all = lightAt(5, 5);
  assert.equal(all.resonance.active, 3);
  assert.ok(all.dissolved, 'and the third is all of them, so the guard gives way');

  // No guard on the board, nothing to feel it.
  let lonely = game(...tiles());
  lonely.placeShip(at(1, 2));
  assert.equal(lonely.shipArrivedAt(at(1, 1)).resonance, undefined);
});

test('when every Lantern Pulse Tile is lit at once, a guard with Resonance dies and is off the board', () => {
  let g = withArchetons([GUARD], guard(9, 9),
    obj('LanternPulse', 1, 1, { steps: 2 }), obj('LanternPulse', 8, 8, { steps: 2 }));
  g.placeShip(at(1, 2));
  g.shipArrivedAt(at(1, 1));           // the first tile lights; the second is not lit yet
  assert.ok(g.objects.some(o => o.kind === 'Archeton'));
  g.placeShip(at(8, 7));
  g.shipArrivedAt(at(8, 8));           // the second lights: all of them, so the guard gives way
  assert.equal(g.objects.some(o => o.kind === 'Archeton'), false);

  let partial = withArchetons([GUARD], guard(9, 9), obj('LanternPulse', 1, 1, { steps: 2 }), obj('LanternPulse', 5, 5, { steps: 2 }));
  partial.placeShip(at(1, 2));
  partial.shipArrivedAt(at(1, 1));
  assert.ok(partial.objects.some(o => o.kind === 'Archeton'), 'one of two is not all of them');

  let none = withArchetons([GUARD], guard(9, 9));
  none.placeShip(at(1, 2));
  none.shipArrivedAt(at(1, 1));
  assert.ok(none.objects.some(o => o.kind === 'Archeton'), 'no Pulse Tiles, nothing to resonate with');
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
  g.shipArrivedAt(at(3, 8));
  let [event] = land(g);
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
  taken.shipArrivedAt(at(3, 8));
  assert.deepEqual(land(taken).filter(event => event.returned), [], 'nothing to send back');
  assert.deepEqual(blocksIn(taken), ['Circle@3,5', 'Star@2,5'], 'with its square taken, it stays in the closed Gate');
});

// ---------- Swim Fish ----------

const SWIM_FISH = { id: 'swim-fish', name: 'Swim Fish', parts: [{ kind: 'Swim' }, { kind: 'Sting' }] };
const swimmer = (col, row, direction = 'Left') => obj('Archeton', col, row, { archeton: 'swim-fish', direction });
const swimmersIn = (g) => g.objects.filter(o => o.archeton === 'swim-fish').map(o => `${o.col},${o.row}`);
const facingOf = (g) => g.objects.find(o => o.archeton === 'swim-fish').direction;

test('a Swim Fish swims a square the way it faces each step the ship takes, and turns round at a wall', () => {
  let g = withArchetons([SWIM_FISH], swimmer(5, 5), obj('Wall', 2, 5));
  g.shipArrivedAt(at(5, 8));
  assert.deepEqual(swimmersIn(g), ['4,5'], 'left, the way it was placed');
  g.shipArrivedAt(at(5, 8));
  assert.deepEqual(swimmersIn(g), ['3,5']);
  // The wall's next: it turns round instead of moving, and swims back the other way.
  g.shipArrivedAt(at(5, 8));
  assert.deepEqual(swimmersIn(g), ['3,5'], 'stopped by the wall');
  assert.equal(facingOf(g), 'Right', 'and turned round');
  g.shipArrivedAt(at(5, 8));
  assert.deepEqual(swimmersIn(g), ['4,5'], 'back the way it came');
});

test('a Swim Fish turns round at the board\'s edge, and swims up and down when it\'s placed facing up or down', () => {
  let edge = withArchetons([SWIM_FISH], swimmer(0, 5, 'Left'));
  edge.shipArrivedAt(at(5, 8));
  assert.deepEqual(swimmersIn(edge), ['0,5'], 'nowhere to go, so it stays');
  assert.equal(facingOf(edge), 'Right');
  edge.shipArrivedAt(at(5, 8));
  assert.deepEqual(swimmersIn(edge), ['1,5']);

  let down = withArchetons([SWIM_FISH], swimmer(5, 2, 'Down'));
  down.shipArrivedAt(at(8, 8));
  assert.deepEqual(swimmersIn(down), ['5,3'], 'down, not across');
});

test('a Swim Fish turns round at a Push Block rather than shoving it', () => {
  let g = withArchetons([SWIM_FISH], swimmer(5, 5), block(3, 5));
  g.shipArrivedAt(at(9, 9));
  g.shipArrivedAt(at(9, 9));
  assert.deepEqual(swimmersIn(g), ['4,5']);
  assert.deepEqual(g.objects.filter(o => o.kind === 'PushBlock').map(o => `${o.col},${o.row}`), ['3,5'], 'the block hasn\'t moved');
  g.shipArrivedAt(at(9, 9));
  assert.equal(facingOf(g), 'Right', 'and it turns round rather than going through it');
});

test('a Swim Fish sets off the Switch it lands on, as a Slide Bug does', () => {
  let g = withArchetons([SWIM_FISH], swimmer(5, 5), obj('Switch', 3, 5, { letter: 'A' }), obj('Gate', 9, 9, { letter: 'A' }));
  g.shipArrivedAt(at(9, 2));
  g.shipArrivedAt(at(9, 2));
  assert.deepEqual(swimmersIn(g), ['3,5'], 'on the Switch');
  assert.equal(find(g, 'Gate').open, false, 'its Beam is on its way');
  land(g);
  assert.equal(find(g, 'Gate').open, true, 'and its Gates change when it lands');
});

test('a Swim Fish swimming into the ship stings it, sending it back the way the fish came', () => {
  let g = withArchetons([SWIM_FISH], swimmer(4, 5, 'Left'));
  g.placeShip(at(3, 5));
  g.shipArrivedAt(at(3, 5));
  assert.deepEqual(swimmersIn(g), ['3,5'], 'onto the ship');
  assert.equal(g.carryDirection(at(3, 5)), 'left', 'and the ship is sent on the way the fish was going');
});

test('a Swim Fish is jumped by a Jump Tile and sent on by a Teleporter, as the ship would be', () => {
  let jumped = withArchetons([SWIM_FISH], swimmer(4, 5, 'Right'), obj('JumpTile', 5, 5, { direction: 'Right' }));
  jumped.shipArrivedAt(at(9, 9));
  assert.deepEqual(swimmersIn(jumped), ['7,5'], 'on over the tile, two squares the way it points');

  let sent = withArchetons([SWIM_FISH], swimmer(4, 5, 'Right'),
    obj('Teleporter', 5, 5, { letter: 'A' }), obj('Teleporter', 8, 8, { letter: 'A' }));
  sent.shipArrivedAt(at(9, 9));
  assert.deepEqual(swimmersIn(sent), ['8,8'], 'out of its pair');
});

test('a Swim Fish that has finished its swim is drawn where it is, not still gliding on the Stream tick', () => {
  let { look } = artLook();
  // Settled on (4, 2), having swum there from (5, 2): its own glide is over, so it belongs on its own square whatever
  // the Stream tick is doing. Falling through to the Stream's along draws it part way between the two, for ever.
  let fish = obj('Archeton', 4, 2, { archeton: 'swim-fish', direction: 'Left', fromCol: 5, fromRow: 2, glide: 'swim' });
  let image = blank();
  renderBoard(image, [fish], look, { swimAlong: 1, along: 0.5 });

  assert.ok(rowsDrawn(image, 4).length > 0, 'drawn on its own square');
  assert.equal(rowsDrawn(image, 5).length, 0, 'and not still part way back towards the one it came from');
});

test('what stands on a square is drawn over the Switch built into it, not under it', () => {
  let { look } = artLook();
  // A Swim Fish on a Switch is what surfaced this, and a Push Block on one is the same rule.
  for (const standing of [obj('Archeton', 4, 4, { archeton: 'swim-fish', direction: 'Left' }), obj('PushBlock', 4, 4)]) {
    let alone = blank();
    renderBoard(alone, [standing], look, {});
    // The Switch comes after it in the list, which is the order that used to win.
    let together = blank();
    renderBoard(together, [standing, obj('Switch', 4, 4, { letter: 'A' })], look, {});

    // The body and the eye: what's standing on the square belongs over what's built into it.
    for (const [x, y] of [[12, 12], [16, 10], [13, 13]]) {
      assert.deepEqual(pixelAt(together, 4 * TILE_PX + x, 4 * TILE_PX + y), pixelAt(alone, 4 * TILE_PX + x, 4 * TILE_PX + y),
        `the ${standing.kind} shows at ${x},${y}`);
    }
  }
});

// ---------- Warp Wisps ----------

// A Wisp that steps one square right each time the ship does, so its move is easy to follow.
const WARP_WISP = { id: 'warp-wisp', name: 'Warp Wisp', parts: [{ kind: 'Sequence', moves: ['Right'] }, { kind: 'Warp' }] };
const wisp = (col, row, letter = 'A') => obj('Archeton', col, row, { archeton: 'warp-wisp', letter });
const warpOut = (col, row, letter = 'A') => obj('WarpOut', col, row, { letter });

test('the ship stepping into a Warp Wisp is sent to its Warp Out Square, and isn\'t hurt', () => {
  let g = withArchetons([WARP_WISP], wisp(5, 5), warpOut(2, 2));
  g.placeShip(at(5, 6));
  let event = g.shipArrivedAt(at(5, 5));
  assert.deepEqual(g.shipCell, at(2, 2), 'warped out');
  assert.deepEqual(event.warpedTo, at(2, 2));
  assert.equal(event.returned, undefined, 'and not sent back the way it came');
});

test('a Warp Wisp that lands on the ship warps it too', () => {
  let g = withArchetons([WARP_WISP], wisp(4, 5), warpOut(2, 2));
  g.placeShip(at(5, 5));
  g.shipArrivedAt(at(5, 5));
  assert.deepEqual(g.shipCell, at(2, 2), 'the Wisp reached it, so it went');
});

test('a Warp Wisp goes over walls and anything else in its way', () => {
  let g = withArchetons([WARP_WISP], wisp(4, 5), obj('Wall', 5, 5), block(6, 5), warpOut(2, 2));
  g.placeShip(at(9, 9));
  g.shipArrivedAt(at(9, 9));
  assert.deepEqual(g.objects.find(o => o.archeton === 'warp-wisp') && { col: g.objects.find(o => o.archeton === 'warp-wisp').col, row: g.objects.find(o => o.archeton === 'warp-wisp').row }, at(5, 5), 'over the wall');
});

test('nothing but the ship can be moved onto a Warp Out Square', () => {
  let g = withArchetons([WARP_WISP], warpOut(6, 5), block(5, 5));
  g.placeShip(at(4, 5));
  g.shipArrivedAt(at(5, 5));
  assert.deepEqual(g.objects.filter(o => o.kind === 'PushBlock').map(o => `${o.col},${o.row}`), ['5,5'], 'the block stays put');
});

// A Wisp that stays where it's put, so a test of the pairing isn't also a test of its patrol.
const STILL_WISP = { id: 'warp-wisp', name: 'Warp Wisp', parts: [{ kind: 'Warp' }] };
const still = (col, row, letter = 'A') => obj('Archeton', col, row, { archeton: 'warp-wisp', letter });

test('each Warp Wisp goes to the Warp Out Square of its own letter, not the first one on the board', () => {
  let g = withArchetons([STILL_WISP], still(5, 5, 'A'), warpOut(2, 2, 'A'), still(8, 7, 'B'), warpOut(9, 9, 'B'));
  g.placeShip(at(5, 6));
  g.shipArrivedAt(at(5, 5));
  assert.deepEqual(g.shipCell, at(2, 2), 'the square placed with it');
  g.placeShip(at(8, 8));
  g.shipArrivedAt(at(8, 7));
  assert.deepEqual(g.shipCell, at(9, 9), 'and the other one its own, not the first square on the board');
});

test('a Warp Wisp with no letter of its own warps nothing, rather than piling onto a square without one', () => {
  let g = withArchetons([STILL_WISP], still(5, 5, null), warpOut(2, 2, null));
  g.placeShip(at(5, 6));
  assert.equal(g.shipArrivedAt(at(5, 5))?.warpedTo, undefined, 'no letter, no pair');
  assert.deepEqual(g.shipCell, at(5, 5));
});

test('a Warp Wisp fades in and out as it drifts, from 90% of solid down to 60%', () => {
  let { look } = artLook();
  look.archetons = [{ id: 'warp-wisp', name: 'Warp Wisp', drawing: 'warp-wisp', parts: [{ kind: 'Warp' }] }];
  // How much of the Wisp is showing, in alpha-weighted colour over its square - so where the drift has it doesn't
  // matter, only how solid it is.
  let showing = (phase) => {
    let image = blank();
    renderBoard(image, [obj('Archeton', 3, 3, { archeton: 'warp-wisp' })], look, { wispDrift: phase });
    let total = 0;
    for (let y = 3 * TILE_PX; y < 4 * TILE_PX; y++) {
      for (let x = 3 * TILE_PX; x < 4 * TILE_PX; x++) {
        let i = (y * image.width + x) * 4;
        total += image.data[i + 3] / 255 * (image.data[i] + image.data[i + 1] + image.data[i + 2]);
      }
    }
    return total;
  };

  let top = showing(0.25); // the top of its drift, at 90% of solid
  let bottom = showing(0.75); // the bottom, at 60%
  assert.ok(top > bottom * 1.3, `fainter at the bottom of its drift (${Math.round(bottom)}) than the top (${Math.round(top)})`);
  assert.ok(bottom > 0, 'and never gone, which would read as a flicker');
});

test('the editor shows which Warp Wisp goes with which Warp Out Square, and gameplay never does', () => {
  let { look } = artLook();
  look.archetons = [{ id: 'warp-wisp', name: 'Warp Wisp', drawing: 'warp-wisp', parts: [{ kind: 'Warp' }] }];
  let paired = [obj('Archeton', 2, 2, { archeton: 'warp-wisp', letter: 'A' }), obj('WarpOut', 6, 2, { letter: 'A' })];
  let loose = [obj('Archeton', 2, 2, { archeton: 'warp-wisp' }), obj('WarpOut', 6, 2)];
  let pixelsOf = (objects, options) => {
    let image = blank();
    renderBoard(image, objects, look, options);
    return [...image.data].join(',');
  };

  assert.notEqual(pixelsOf(paired, { pairLetters: true }), pixelsOf(paired, {}), 'the editor puts the letter on each');
  assert.equal(pixelsOf(paired, {}), pixelsOf(loose, {}), 'and gameplay draws them as if the letters weren\'t there');
  assert.equal(pixelsOf(loose, { pairLetters: true }), pixelsOf(loose, {}), 'with nothing to show, nothing is drawn');
});

test('a Warp Wisp drifts rather than hops: sliding between squares it is drawn where it would stand', () => {
  let { look } = artLook();
  look.archetons = [
    { id: 'warp-wisp', name: 'Warp Wisp', drawing: 'warp-wisp', parts: [{ kind: 'Warp' }] },
    { id: 'jumpbug', name: 'Jump Bug', drawing: 'jumpbug', parts: [{ kind: 'Sequence' }] },
  ];
  let pixelsOf = (objects, options) => {
    let image = blank();
    renderBoard(image, objects, look, options);
    return [...image.data].join(',');
  };

  // Two squares along, half way: on the square between them, and drawn exactly as standing there.
  let sliding = obj('Archeton', 3, 2, { archeton: 'warp-wisp', fromCol: 3, fromRow: 0, glide: 'hop' });
  assert.equal(pixelsOf([sliding], { hopAlong: 0.5, wispDrift: 0.3 }),
    pixelsOf([obj('Archeton', 3, 1, { archeton: 'warp-wisp' })], { wispDrift: 0.3 }), 'a Wisp slides, so it never rises on the way');

  // A Jump Bug doing the same is up in the air, which is what the Wisp has been let out of.
  let hopping = obj('Archeton', 3, 2, { archeton: 'jumpbug', fromCol: 3, fromRow: 0, glide: 'hop' });
  assert.notEqual(pixelsOf([hopping], { hopAlong: 0.5 }), pixelsOf([obj('Archeton', 3, 1, { archeton: 'jumpbug' })], {}), 'a bug does rise');
});

test('erasing a Warp Wisp takes its Warp Out Square with it, and the other way round', () => {
  let objects = [wisp(2, 2, 'A'), warpOut(6, 6, 'A'), wisp(4, 8, 'B'), warpOut(9, 1, 'B')];
  let withoutWisp = eraseObject(objects, at(2, 2)).map(o => `${o.kind}${o.letter}`).sort();
  assert.deepEqual(withoutWisp, ['ArchetonB', 'WarpOutB']);
  let withoutOut = eraseObject(objects, at(9, 1)).map(o => `${o.kind}${o.letter}`).sort();
  assert.deepEqual(withoutOut, ['ArchetonA', 'WarpOutA']);
  // A Gate's letter is nothing to do with a Warp Out Square, so erasing one leaves the other pair alone.
  let withGate = [...objects, obj('Gate', 1, 9, { letter: 'B' }), obj('Switch', 3, 9, { letter: 'B' })];
  assert.equal(eraseObject(withGate, at(1, 9)).length, withGate.length - 1);
});

// A Wisp floats over the board rather than standing on it, so it can be over a Switch without being on it the way the
// ship is - and holding that Switch down is exactly what floating over one should do.
test('a Warp Wisp drifting over a Rotator Switch holds it, wherever the ship is', () => {
  let g = withArchetons([STILL_WISP], still(5, 5), obj('RotatorSwitch', 5, 5), ...rotatorLine(1, 2, 3), obj('Wall', 1, 5));
  assert.equal(g.wispOnRotatorSwitch, true);
  assert.equal(g.onRotatorSwitch, false, 'and the ship is nowhere near it');

  let beside = withArchetons([STILL_WISP], still(5, 5), obj('RotatorSwitch', 4, 5), obj('Start', 1, 9));
  assert.equal(beside.wispOnRotatorSwitch, false, 'one square off, and it holds nothing');
});

test('a Warp Wisp holds a Rotator Switch only while it is over it', () => {
  // Two squares right of its home and back again, so it drifts on over the Switch rather than patrolling one square.
  let drifting = { id: 'warp-wisp', name: 'Warp Wisp', parts: [{ kind: 'Sequence', moves: ['Right', 'Right'] }, { kind: 'Warp' }] };
  let g = withArchetons([drifting], wisp(4, 5, 'A'), warpOut(9, 1, 'A'), obj('RotatorSwitch', 5, 5));
  g.placeShip(at(9, 9));
  assert.equal(g.wispOnRotatorSwitch, false, 'a square short of it');

  g.shipArrivedAt(at(9, 8));
  assert.equal(g.wispOnRotatorSwitch, true, 'now over it, so it holds');

  g.shipArrivedAt(at(9, 7));
  assert.equal(g.wispOnRotatorSwitch, false, 'and drifting on, so it lets go');
});

test('a Warp Wisp with no Warp Out Square of its letter leaves the ship where it is', () => {
  let g = withArchetons([WARP_WISP], wisp(5, 5, 'A'), warpOut(2, 2, 'B'));
  g.placeShip(at(5, 6));
  let event = g.shipArrivedAt(at(5, 5));
  assert.deepEqual(g.shipCell, at(5, 5), 'no pair, so nowhere to go');
  assert.equal(event?.warpedTo, undefined);
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
  land(g);
  assert.equal(find(g, 'Gate').open, true, 'the Switch it slid onto');
  assert.equal(g.canEnter(at(2, 4), at(2, 3), 'up'), false, 'and on the Switch, it\'s the bug that\'s in the way');
  let event = g.shipArrivedAt(at(6, 8));
  land(g);
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
  // One step before the press, so that the slide the press itself causes is the one that puts the bug inside the
  // second Gate - the Gates close a moment after the press, once the Beam lands, not on it.
  g.shipArrivedAt(at(6, 7));
  assert.deepEqual(bugsIn(g), ['2,3'], 'the bug slides into the first Gate');
  g.shipArrivedAt(at(6, 8)); // the Switch closes both
  let [event] = land(g);
  assert.deepEqual(bugsIn(g), ['1,3'], 'back past both closed Gates, to where it was before them');
  assert.ok(event.returned.some(o => o.archeton === 'slide-bug'));
  assert.equal(g.objects.find(o => o.archeton === 'slide-bug').glide, 'return');
});

test('a Gate a Slide Bug closes on the ship sends the ship back, as being hurt does', () => {
  let g = withArchetons([SLIDE_BUG], bug(1, 3), obj('Switch', 2, 3, { letter: 'A' }), obj('Gate', 6, 5, { letter: 'A', open: true }));
  g.placeShip(at(6, 6));
  g.shipArrivedAt(at(6, 5)); // into the open Gate, as the bug slides onto the Switch
  land(g);
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

// ---------- Jumpbugs ----------

const JUMPBUG = { id: 'jumpbug-a', name: 'Jumpbug A', parts: [{ kind: 'Sequence', moves: ['Up', 'Down', 'Down', 'Up', 'Left', 'Right', 'Right', 'Left'] }, { kind: 'Sting' }] };
const jumpbug = (col, row) => obj('Archeton', col, row, { archeton: 'jumpbug-a', direction: 'Right' });
const jumpbugAt = (g) => g.objects.filter(o => o.archeton === 'jumpbug-a').map(o => `${o.col},${o.row}`)[0];

test('a Jumpbug hops round its start, a square for each step the ship takes: up, down, down, up, left, right, right, left', () => {
  let g = withArchetons([JUMPBUG], jumpbug(4, 4));
  let seen = [];
  for (let i = 0; i < 9; i++) {
    let event = g.shipArrivedAt(at(9, i % 2 ? 9 : 8));
    seen.push(jumpbugAt(g));
    if (i === 0) assert.ok(event.hopped);
  }
  assert.deepEqual(seen, ['4,3', '4,4', '4,5', '4,4', '3,4', '4,4', '5,4', '4,4', '4,3'], 'and round again');
  assert.equal(g.objects.find(o => o.archeton === 'jumpbug-a').glide, 'hop');
});

test('a Jumpbug stays put for a move that\'s blocked, and keeps its rhythm', () => {
  let g = withArchetons([JUMPBUG], jumpbug(4, 4), obj('Wall', 4, 3));
  let seen = [];
  for (let i = 0; i < 4; i++) { g.shipArrivedAt(at(9, i % 2 ? 9 : 8)); seen.push(jumpbugAt(g)); }
  assert.deepEqual(seen, ['4,4', '4,4', '4,5', '4,4'], 'up is a Wall, so it waits, then down, down, up as usual');
});

test('a Jumpbug is solid to blocks and beams, but the ship stepping into it is hurt, before it can hop away', () => {
  let g = withArchetons([JUMPBUG], jumpbug(4, 4), block(2, 4));
  assert.equal(g.canPush(at(2, 4), 'right'), true, 'room for the block');
  assert.equal(g.canPush(at(3, 4), 'right'), false);
  let walls = withArchetons([JUMPBUG], jumpbug(4, 4), block(3, 4));
  assert.equal(walls.canPush(at(3, 4), 'right'), false, 'a block can\'t be pushed into it');
  assert.equal(g.canEnter(at(5, 4), at(4, 4), 'left'), true, 'but the ship can step into it');
  let beam = withArchetons([JUMPBUG, { id: 'sentribeam', name: 'S', parts: [{ kind: 'Beam', range: 3, look: 'AllWays' }, { kind: 'Block' }] }],
    jumpbug(4, 4), obj('Archeton', 2, 4, { archeton: 'sentribeam', direction: 'Right' }));
  assert.equal(beam.canEnter(at(5, 5), at(5, 4), 'up'), true, 'and it stops a Sentribeam\'s laser before the square past it');
});

test('stepping into a Jumpbug sends the ship back, and so does it landing on the ship', () => {
  let into = withArchetons([JUMPBUG], jumpbug(4, 4));
  into.shipArrivedAt(at(9, 9));
  assert.equal(jumpbugAt(into), '4,3', 'its first hop, up');
  into.placeShip(at(5, 3));
  into.shipArrivedAt(at(4, 3)); // stepping into it from beside it
  assert.equal(jumpbugAt(into), '4,3', 'it doesn\'t hop away first');
  assert.equal(into.carryDirection(at(4, 3)), 'right', 'back where the ship came from');

  let landed = withArchetons([JUMPBUG], jumpbug(4, 4));
  landed.placeShip(at(5, 3));
  landed.shipArrivedAt(at(4, 3)); // the bug's first hop is up, onto the ship
  assert.equal(jumpbugAt(landed), '4,3');
  assert.equal(landed.carryDirection(at(4, 3)), 'right', 'back to the square it came from');
});

// ---------- Reflect Mimics ----------

const REFLECT_MIMIC = { id: 'reflect-mimic', name: 'Reflect Mimic', parts: [{ kind: 'Reflect' }] };
const mimic = (col, row, direction = 'Right') => obj('Archeton', col, row, { archeton: 'reflect-mimic', direction });
// Just the squares, for comparing: a reflection carries its pane and what it came from as well.
const cells = (g) => g.reflections.map(cell => at(cell.col, cell.row));

test('a Reflect Mimic is solid to the ship, but a Beam is photonic and passes through the glass', () => {
  let g = withArchetons([SENTRIBEAM, REFLECT_MIMIC], eye(1, 5), mimic(2, 5), obj('Start', 3, 5));
  assert.deepEqual(g.beams.map(beam => beam.to), [at(3, 5)], 'the Sentribeam reaches through the glass to the ship');
  assert.equal(g.carryDirection(at(3, 5)), 'right', 'and pushes it, as it would with nothing in between');
  assert.equal(g.canEnter(at(3, 5), at(2, 5), 'left'), false, 'the ship still cannot walk through the glass');
});

test('a Reflect Mimic mirrors the ship as far the other side of itself', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  assert.deepEqual(cells(g), [at(8, 5)], 'equally far the other side, in its own row');

  g.placeShip(at(4, 6));
  assert.deepEqual(cells(g), [], 'not in its row, so nothing');

  g.placeShip(at(6, 5));
  assert.deepEqual(cells(g), [at(4, 5)], 'either side of it');
});

test('a reflection standing on the Finish finishes the board, with the ship nowhere near it', () => {
  // A pane at (6, 0) facing Right shows the ship's reflection across from it, one square the other side: the ship at
  // (5, 0) puts its reflection on the Finish at (7, 0). This is how a board like Glass Wall Gallery - Floor I's lobby
  // gets finished, and why where the ship is at that moment says nothing about where the next board takes it in.
  let g = withArchetons([REFLECT_MIMIC], mimic(6, 0), obj('Start', 5, 9), obj('Finish', 7, 0));
  g.placeShip(at(5, 1));
  assert.equal(g.isSolved, false, 'not yet');

  // One step up: the ship to (5, 0), its reflection to (7, 0) - the Finish.
  let event = g.shipArrivedAt(at(5, 0));

  assert.deepEqual(cells(g), [at(7, 0)], 'the reflection is the one on the Finish');
  assert.equal(g.isSolved, true, 'so the board is finished from there');
  assert.equal(event?.finished, true, 'and the arrival reports it, for the board to move on');
  assert.deepEqual(g.shipCell, at(5, 0), 'still back here, nowhere near an edge');
});

test('a Reflect Mimic facing up or down lies flat, and mirrors rows', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5, 'Up'), obj('Start', 5, 2));
  assert.deepEqual(cells(g), [at(5, 8)]);

  g.placeShip(at(6, 4));
  assert.deepEqual(cells(g), [], 'not in its column, so nothing');
});

test('no reflection is produced off the board, or through anything solid', () => {
  let off = withArchetons([REFLECT_MIMIC], mimic(0, 5), obj('Start', 9, 5));
  assert.deepEqual(cells(off), [], 'its reflection would be off the board');

  for (const between of [wall(3, 5), block(3, 5), obj('Gate', 3, 5, { letter: 'A' })]) {
    let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), between);
    assert.deepEqual(cells(g), [], `a ${between.kind} between them hides the ship`);
  }

  let into = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), wall(8, 5));
  assert.deepEqual(cells(into), [], 'nowhere to stand on the far side');
});

test('a reflection is shown where it would be hurt, and where it can act', () => {
  const STINGER = { id: 'stinger', name: 'Stinger', parts: [{ kind: 'Sting' }] };

  let bug = withArchetons([REFLECT_MIMIC, STINGER], mimic(5, 5), obj('Start', 2, 5), obj('Archeton', 8, 5, { archeton: 'stinger', direction: 'Right' }));
  assert.deepEqual(cells(bug), [at(8, 5)], 'a Sting is somewhere it is hurt, not somewhere it cannot be');

  let closed = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Gate', 8, 5, { letter: 'A' }));
  assert.deepEqual(cells(closed), [at(8, 5)], 'so is a closed Gate');

  let finishing = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Finish', 8, 5));
  assert.deepEqual(cells(finishing), [at(8, 5)], 'a Finish is somewhere it can be, and finish the board from');

  let keys = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Key', 8, 5, { letter: 'A' }));
  assert.deepEqual(cells(keys), [at(8, 5)], 'and a Key is there for it to take');
});

test('a pane sees the ship through an open Gate, and not through a shut one', () => {
  // A flat pane at 5,4, the ship at 5,6, and a Gate in between at 5,5: an open Gate is a doorway, and the ship walks
  // through one and stands in it.
  let shut = withArchetons([REFLECT_MIMIC], mimic(5, 4, 'Down'), obj('Start', 5, 6), obj('Gate', 5, 5, { letter: 'A' }));
  assert.deepEqual(cells(shut), [], 'a shut Gate hides the ship');
  assert.deepEqual(shut.blockedSights.map(sight => sight.blocker), [at(5, 5)], 'and the sight line stops at it, for the drawing');

  let open = withArchetons([REFLECT_MIMIC], mimic(5, 4, 'Down'), obj('Start', 5, 6), obj('Gate', 5, 5, { letter: 'A', open: true }));
  assert.deepEqual(cells(open), [at(5, 2)], 'an open one is a doorway: the pane sees the ship through it');
  assert.deepEqual(open.blockedSights, [], 'and there is nothing to draw in the way');
});

test('the ship standing behind an open Gate is reflected onto the Finish, finishing the board', () => {
  // The shape of Glass Wall Gallery - Floor I's right-hand column: two panes lying flat, open Gates between the ship and
  // the one above it, and the Finish where the second reflection lands.
  let g = withArchetons([REFLECT_MIMIC],
    mimic(5, 6, 'Down'), mimic(5, 2, 'Down'),
    obj('Gate', 5, 7, { letter: 'A', open: true }), obj('Gate', 5, 8, { letter: 'A', open: true }),
    obj('Finish', 5, 1), obj('Start', 5, 9));
  assert.deepEqual(cells(g), [at(5, 3), at(5, 1)], 'the pane sees the ship through the Gates, and the pane above the Finish');

  g.placeShip(at(5, 8));
  let event = g.shipArrivedAt(at(5, 9));
  assert.ok(event?.finished, 'the second reflection steps onto the Finish and the board finishes');
  assert.equal(g.isSolved, true);
});

test('each reflection knows the pane that made it and what it came from, for drawing the glide', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(3, 5), mimic(7, 5), obj('Start', 1, 5));
  let [first, second] = g.reflections;
  const at3 = (pane) => at(pane.col, pane.row);
  assert.deepEqual(at3(first.pane), at(3, 5), 'the near pane made the first');
  assert.equal(first.pane.direction, 'Right', 'and upright, so it mirrors columns');
  assert.deepEqual(first.from, at(1, 5), 'from the ship');
  assert.deepEqual(at3(second.pane), at(7, 5), 'the far pane made the second');
  assert.deepEqual(at(second.from.col, second.from.row), at(5, 5), 'from the first reflection, not the ship');
  assert.deepEqual(at3(second.from.pane), at(3, 5), 'which is how the drawing knows where to mirror from');
});

test('panes facing each other bounce a reflection between them, as far as the board allows', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(3, 5), mimic(7, 5), obj('Start', 1, 5));
  assert.deepEqual(cells(g).map(cell => cell.col).sort((a, b) => a - b), [5, 9], '1 across 3 is 5, 5 across 7 is 9');
});

test('the reflection sets off a Switch it lands on, as the ship would', () => {
  let gate = obj('Gate', 1, 1, { letter: 'A' });
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Switch', 8, 5, { letter: 'A' }), gate);
  let before = g.objects.find(o => o.kind === 'Gate').open;
  g.placeShip(at(1, 5));
  g.shipArrivedAt(at(2, 5));
  land(g);
  assert.notEqual(g.objects.find(o => o.kind === 'Gate').open, before, 'the reflection stepped on the Switch');
});

test('the reflection sets off a Reset Switch, and the board comes back as it started', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('ResetSwitch', 8, 5));
  g.placeShip(at(1, 5));
  let event = g.shipArrivedAt(at(2, 5));
  assert.ok(event?.reset, 'the reflection set the Reset Switch off');
});

test('the reflection finishes the board, and takes Keys, as the ship would', () => {
  let finish = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Finish', 8, 5));
  finish.placeShip(at(1, 5));
  finish.shipArrivedAt(at(2, 5));
  assert.equal(finish.isSolved, true, 'the reflection reached the Finish');

  let key = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Key', 8, 5, { letter: 'A' }));
  key.placeShip(at(1, 5));
  key.shipArrivedAt(at(2, 5));
  assert.deepEqual(key.objects.filter(o => o.kind === 'Key'), [], 'the reflection took the Key');
});

test('a reflection another pane reflects sets things off in the same way', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(3, 5), mimic(7, 5), obj('Start', 1, 5), obj('ResetSwitch', 9, 5));
  g.placeShip(at(0, 5));
  let event = g.shipArrivedAt(at(1, 5));
  assert.deepEqual(cells(g).map(cell => cell.col).sort((a, b) => a - b), [5, 9], 'the second reflection is on the Reset Switch');
  assert.ok(event?.reset, 'and it set it off');
});

test('the reflection shoves a Push Block on ahead, as the ship would', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), block(8, 5));
  g.placeShip(at(1, 5));
  g.shipArrivedAt(at(2, 5));
  assert.deepEqual(g.objects.filter(o => o.kind === 'PushBlock').map(o => at(o.col, o.row)), [at(7, 5)], 'shoved the way the pane mirrors the ship\'s step');
  assert.deepEqual(cells(g).map(cell => cell.col), [8], 'and the reflection goes where the block was');
});

// ---------- Puzzle Warps ----------

// What the exporter puts on a warp square once it has resolved where it leads - see PageRenderer's WithWarpTarget.
const WARP_TO = { page: 'ouros.html', node: 'salanth-town-gardens', x: 120, y: 240 };
const puzzleWarp = (col, row, warp = WARP_TO) => obj('PuzzleWarp', col, row, { targetNodeId: warp.node, warp });

test('a Puzzle Warp is walked onto, and says where it leads when the ship stands on it', () => {
  let g = game(obj('Start', 1, 5), puzzleWarp(3, 5));
  assert.equal(g.canEnter(at(2, 5), at(3, 5), 'right'), true, 'the ship walks onto it');
  assert.deepEqual(g.shipArrivedAt(at(3, 5)), { puzzleWarp: WARP_TO });
  assert.deepEqual(g.shipCell, at(3, 5), 'and stands there until the page takes it away');
});

test('a Puzzle Warp the exporter could not resolve leads nowhere', () => {
  let g = game(obj('Start', 1, 5), obj('PuzzleWarp', 3, 5, { targetNodeId: 'not-on-any-map' }));
  assert.equal(g.shipArrivedAt(at(3, 5)), null, 'nothing happens at all');
  assert.deepEqual(g.shipCell, at(3, 5));
});

test('a reflection arriving on a Puzzle Warp does not warp the player', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), puzzleWarp(8, 5));
  g.placeShip(at(1, 5));
  let event = g.shipArrivedAt(at(2, 5));
  assert.deepEqual(cells(g), [at(8, 5)], 'the reflection is standing on the warp square');
  assert.equal(event?.puzzleWarp, undefined, 'and the player stays where the ship is');
});

test('a Puzzle Warp is drawn as a plain square outline, with nothing inside it', () => {
  let { look } = artLook();
  let image = blank();
  renderBoard(image, [obj('PuzzleWarp', 3, 3)], look);
  let light = toRgb(look.palette.light).join();
  let at3 = (u, v) => pixelAt(image, 3 * 24 + u, 3 * 24 + v);
  assert.equal(at3(3, 12).slice(0, 3).join(), light, 'its left edge');
  assert.equal(at3(20, 12).slice(0, 3).join(), light, 'and its right');
  assert.equal(at3(12, 3).slice(0, 3).join(), light, 'and its top');
  assert.equal(at3(12, 20).slice(0, 3).join(), light, 'and its bottom');
  assert.equal(at3(12, 12)[3], 0, 'with nothing in the middle');
  assert.equal(standardDrawing('PuzzleWarp').mix[0].role, 'teleporter', 'and is coloured as a teleport');
});

test("a drawing's opacity is how see-through it is on the board", () => {
  let { look } = artLook();
  let alphas = (image) => {
    let found = [];
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) found.push(pixelAt(image, 3 * 24 + x, 3 * 24 + y)[3]);
    return found;
  };

  // The Puzzle Warp's Standard drawing is half see-through, so a warp reads as a way through.
  let warped = blank();
  renderBoard(warped, [obj('PuzzleWarp', 3, 3, { targetNodeId: 'here' })], look);
  assert.ok(alphas(warped).includes(128), 'the warp is painted at 50%, and nothing else');

  // Anything else is solid, unless its drawing says otherwise.
  let solid = blank();
  renderBoard(solid, [obj('Wall', 3, 3)], look);
  assert.ok(alphas(solid).includes(255), 'a Wall is painted solid');
  assert.ok(!alphas(solid).includes(128), 'and not at all see-through');
});

test('a Push Block on the mirror\'s square stops a reflection forming at all', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), block(8, 5));
  assert.deepEqual(cells(g), [], 'the block is where the ship would be mirrored, so there is nothing to see');
  assert.deepEqual(g.objects.filter(o => o.kind === 'PushBlock').map(o => at(o.col, o.row)), [at(8, 5)], 'and it hasn\'t been touched');
});

test('a reflection that can\'t follow the ship is gone until it can', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Wall', 8, 5));
  g.placeShip(at(1, 5));
  assert.deepEqual(cells(g).map(cell => cell.col), [9], 'at rest, the pane shows it');
  g.shipArrivedAt(at(2, 5));
  assert.deepEqual(cells(g), [], 'a Wall where its next step would go leaves nothing to see');

  let further = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Wall', 7, 5));
  further.placeShip(at(1, 5));
  further.shipArrivedAt(at(2, 5));
  assert.deepEqual(cells(further).map(cell => cell.col), [8], 'one in the way further off is fine while there is room');
  further.shipArrivedAt(at(3, 5));
  assert.deepEqual(cells(further), [], 'until the step would go through it');

  let upcoming = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 3, 5), obj('Wall', 7, 5));
  upcoming.placeShip(at(2, 5));
  assert.deepEqual(cells(upcoming).map(cell => cell.col), [8]);
});

test('the ship is carried off and its reflection stays where the pane shows it', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Teleporter', 8, 5, { letter: 'A' }), obj('Teleporter', 0, 0, { letter: 'A' }));
  g.placeShip(at(1, 5));
  g.shipArrivedAt(at(2, 5));
  assert.deepEqual(g.shipCell, at(2, 5), 'the ship stayed where it walked to: a Teleporter carries what stands on it');
  assert.deepEqual(cells(g).map(cell => cell.col), [8], 'and the reflection is still on the Teleporter, where the pane shows it');
});

test('being hurt through the reflection sends the ship back where it came from', () => {
  const STINGER = { id: 'stinger', name: 'Stinger', parts: [{ kind: 'Sting' }] };
  let stung = withArchetons([REFLECT_MIMIC, STINGER], mimic(5, 5), obj('Start', 2, 5), obj('Archeton', 8, 5, { archeton: 'stinger', direction: 'Right' }));
  stung.placeShip(at(1, 5));
  stung.shipArrivedAt(at(2, 5));
  assert.equal(stung.carryDirection(at(2, 5)), 'left', 'a Sting on the reflection sends the ship back');

  let shut = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Gate', 8, 5, { letter: 'A' }));
  shut.placeShip(at(1, 5));
  shut.shipArrivedAt(at(2, 5));
  assert.equal(shut.carryDirection(at(2, 5)), 'left', 'so does a closed Gate');

  let clear = withArchetons([REFLECT_MIMIC, STINGER], mimic(5, 5), obj('Start', 2, 5));
  clear.placeShip(at(1, 5));
  clear.shipArrivedAt(at(2, 5));
  assert.equal(clear.carryDirection(at(2, 5)), null, 'nothing hurting it, nothing happens');
});

test('a reflection is drawn at its pane\'s mirror of where the ship is drawn, so it glides with it', () => {
  const { reflectionPosition } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  let [reflection] = g.reflections;
  assert.deepEqual(reflectionPosition(reflection, { x: 2.5 * TILE_PX, y: 5.5 * TILE_PX }, TILE_PX),
    { x: 8.5 * TILE_PX, y: 5.5 * TILE_PX }, 'the middle of the mirrored square');

  assert.deepEqual(reflectionPosition(reflection, { x: 2.0 * TILE_PX, y: 5.5 * TILE_PX }, TILE_PX),
    { x: 9.0 * TILE_PX, y: 5.5 * TILE_PX }, 'mid-step, it moves the other way with the ship');

  let flat = withArchetons([REFLECT_MIMIC], mimic(5, 5, 'Up'), obj('Start', 5, 2));
  assert.deepEqual(reflectionPosition(flat.reflections[0], { x: 5.5 * TILE_PX, y: 2.5 * TILE_PX }, TILE_PX),
    { x: 5.5 * TILE_PX, y: 8.5 * TILE_PX }, 'a pane lying flat mirrors rows instead');

  let chain = withArchetons([REFLECT_MIMIC], mimic(3, 5), mimic(7, 5), obj('Start', 1, 5));
  let second = chain.reflections.find(reflection => reflection.col === 9);
  assert.deepEqual(reflectionPosition(second, { x: 1.5 * TILE_PX, y: 5.5 * TILE_PX }, TILE_PX),
    { x: 9.5 * TILE_PX, y: 5.5 * TILE_PX }, 'a chained reflection mirrors the one it was made from');
});

test('a reflection faces back at the ship, and the way it walks along the pane', () => {
  const { reflectionFacing } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

  let upright = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  let reflection = upright.reflections[0];
  assert.equal(reflectionFacing(reflection, 'left'), 'right', 'facing the pane, it faces back');
  assert.equal(reflectionFacing(reflection, 'right'), 'left');
  assert.equal(reflectionFacing(reflection, 'up'), 'up', 'walking along the pane, the same way the ship does');
  assert.equal(reflectionFacing(reflection, 'down'), 'down');

  let flat = withArchetons([REFLECT_MIMIC], mimic(5, 5, 'Up'), obj('Start', 5, 2));
  let lying = flat.reflections[0];
  assert.equal(reflectionFacing(lying, 'up'), 'down', 'a pane lying flat mirrors up and down instead');
  assert.equal(reflectionFacing(lying, 'left'), 'left');

  let chain = withArchetons([REFLECT_MIMIC], mimic(3, 5), mimic(7, 5), obj('Start', 1, 5));
  let second = chain.reflections.find(reflection => reflection.col === 9);
  assert.equal(reflectionFacing(second, 'left'), 'left', 'mirrored through two upright panes, it faces the way the ship does');
  assert.equal(reflectionFacing(second, 'up'), 'up');
});

test('a reflection standing on a switch that keeps working counts as the ship standing there', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('PipeSwitch', 8, 5));
  assert.equal(g.onPipeSwitch, true, 'the reflection is on the Pipe Switch, so the Pipes keep turning');
  g.placeShip(at(2, 8));
  assert.equal(g.onPipeSwitch, false, 'out of the pane\'s line, nothing stands on it');

  let rotator = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('RotatorSwitch', 8, 5));
  assert.equal(rotator.onRotatorSwitch, true, 'and a Rotator Loop Switch the same');
});

test('the ship can\'t step where its reflection couldn\'t follow', () => {
  // 2 across the pane at 5 is 8: stepping back to 1 sends the reflection to 9, and there's a Wall there.
  let walled = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Wall', 9, 5));
  assert.deepEqual(cells(walled).map(cell => cell.col), [8], 'the pane shows the reflection where it has room');
  assert.equal(walled.canEnter(at(2, 5), at(1, 5), 'left'), false, 'a Wall in the reflection\'s way is a Wall in the ship\'s');
  assert.equal(walled.canEnter(at(2, 5), at(3, 5), 'right'), true, 'and stepping the other way is still open');

  // A Push Block the reflection could shove is fine; one it couldn't is the same as a Wall. Stepping the other way,
  // the reflection goes from 8 to 7, where the block is.
  let pushable = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), block(7, 5));
  assert.equal(pushable.canEnter(at(2, 5), at(3, 5), 'right'), true, 'the reflection shoves the block on ahead');
  let blocked = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), block(7, 5), obj('Wall', 6, 5));
  assert.equal(blocked.canEnter(at(2, 5), at(3, 5), 'right'), false, 'and a block with nowhere to go stops it as a Wall would');
});

test('a chained reflection that couldn\'t follow stops the ship, and one that leaves the board doesn\'t', () => {
  // Two upright panes at 3 and 7, so the ship at 1 is shown at 5 across the first and at 9 across the second, and a
  // Wall at 8: stepping left takes the second reflection onto it, and stepping right off the board.
  let g = withArchetons([REFLECT_MIMIC], mimic(3, 5), mimic(7, 5), obj('Start', 1, 5), obj('Wall', 8, 5));
  assert.deepEqual(cells(g).map(cell => cell.col).sort((a, b) => a - b), [5, 9], 'a reflection each');
  assert.equal(g.canEnter(at(1, 5), at(0, 5), 'left'), false, 'a Wall in the second reflection\'s way stops the ship');
  assert.equal(g.canEnter(at(1, 5), at(2, 5), 'right'), true, 'the board\'s edge isn\'t a Wall: the second would just go');

  g.placeShip(at(2, 5));
  assert.deepEqual(cells(g).map(cell => cell.col), [4], 'the first steps with the ship, the second has no board left');
  g.placeShip(at(1, 5));
  assert.deepEqual(cells(g).map(cell => cell.col).sort((a, b) => a - b), [5, 9], 'and it\'s back once there\'s board for it');
});

test('a chained reflection steps the way the reflection it shows steps, not the way the ship does', () => {
  // Two panes lying flat in one column, one above the other: the ship at 9 is shown at 3, and that reflection at 1.
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 6, 'Down'), mimic(5, 2, 'Down'), obj('Start', 5, 9));
  assert.deepEqual(cells(g), [at(5, 3), at(5, 1)], 'a reflection each, one pane above the other');

  // Two flips of a row puts the second reflection back in step with the ship, so stepping up takes it up: the pane
  // below it is not somewhere it steps into, and nothing about the step is the ship's to be refused for.
  assert.equal(g.canEnter(at(5, 9), at(5, 8), 'up'), true, 'the ship steps up');
  assert.equal(g.reflectionObstacleInTheWay(at(5, 9), at(5, 8), 'up'), null, 'and nothing is flashed for the reflection');
  g.shipArrivedAt(at(5, 8));
  assert.deepEqual(cells(g), [at(5, 4), at(5, 0)], 'the first reflection steps down with it, and the second up');
});

test('a reflection that would step off the board goes rather than stopping the ship', () => {
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  g.placeShip(at(1, 5));
  assert.deepEqual(cells(g).map(cell => cell.col), [9], 'shown across the pane');
  assert.equal(g.canEnter(at(1, 5), at(0, 5), 'left'), true, 'stepping towards the edge is the ship\'s to make');
  assert.equal(g.reflectionObstacleInTheWay(at(1, 5), at(0, 5), 'left'), null, 'and nothing is flashed for it');

  g.shipArrivedAt(at(0, 5));
  assert.deepEqual(cells(g), [], 'the reflection goes, with nothing left to show it on');
  assert.equal(g.canEnter(at(0, 5), at(1, 5), 'right'), true, 'and the ship can come back');
  g.shipArrivedAt(at(1, 5));
  assert.deepEqual(cells(g).map(cell => cell.col), [9], 'the reflection returning with it');
});

test('a Beam pushes the ship even where its reflection couldn\'t follow, and the reflection goes', () => {
  // The ship at 2 is shown at 8, with a Wall at 7 in the way of the step towards the pane.
  let g = withArchetons([SENTRIBEAM, REFLECT_MIMIC], eye(1, 5), mimic(5, 5), obj('Start', 2, 5), obj('Wall', 7, 5));
  assert.deepEqual(cells(g).map(cell => cell.col), [8], 'the pane shows the reflection where it has room');
  assert.equal(g.canEnter(at(2, 5), at(3, 5), 'right'), false, 'the ship can\'t walk into the Wall its reflection would');
  assert.equal(g.carryDirection(at(2, 5)), 'right', 'but the Beam pushes it anyway: being pushed is not a step');
  g.placeShip(at(3, 5));
  assert.deepEqual(cells(g), [], 'and the reflection, with the Wall where it would be shown, is gone');
});

test('a reflection\'s push starts with the ship\'s step, so the block glides along with it', () => {
  // The ship at 1 is shown at 9, a step left of which is the block at 8.
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), block(8, 5));
  g.placeShip(at(1, 5));
  g.pushForReflections('right');
  let pushed = g.objects.find(o => o.kind === 'PushBlock');
  assert.deepEqual([pushed.col, pushed.row, pushed.fromCol, pushed.fromRow, pushed.glide], [7, 5, 8, 5, 'push'], 'shoved as the step begins, and set gliding');
  g.shipArrivedAt(at(2, 5));
  assert.deepEqual([pushed.col, pushed.row], [7, 5], 'and the arrival doesn\'t shove it again');
  assert.deepEqual(cells(g).map(cell => cell.col), [8], 'the reflection ends up where the block was');
});

test('whatever blocked the step from the reflection\'s side is reported, for the flash', () => {
  // The ship at 1 is shown at 9: stepping right sends the reflection left, onto the square at 8.
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), block(8, 5), obj('Wall', 7, 5));
  g.placeShip(at(1, 5));
  assert.equal(g.canEnter(at(1, 5), at(2, 5), 'right'), false, 'a block that won\'t go stops the ship');
  let stopper = g.reflectionObstacleInTheWay(at(1, 5), at(2, 5), 'right');
  assert.equal(stopper?.object?.kind, 'PushBlock', 'and the block is what\'s reported');
  assert.deepEqual([stopper.object.col, stopper.object.row], [8, 5], 'on the reflection\'s side of the pane');

  let walled = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Wall', 8, 5));
  walled.placeShip(at(1, 5));
  assert.equal(walled.canEnter(at(1, 5), at(2, 5), 'right'), false, 'a Wall does as well');
  assert.equal(walled.reflectionObstacleInTheWay(at(1, 5), at(2, 5), 'right')?.object?.kind, 'Wall', 'and a Wall is what\'s reported');

  let shut = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Gate', 8, 5, { letter: 'A' }));
  shut.placeShip(at(1, 5));
  assert.equal(shut.reflectionObstacleInTheWay(at(1, 5), at(2, 5), 'right')?.object?.kind, 'Gate', 'so is a shut Gate');

  // The board's edge refuses nothing: a reflection with nowhere to be shown is gone, not in the way.
  let edged = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  edged.placeShip(at(1, 5));
  assert.equal(edged.canEnter(at(1, 5), at(0, 5), 'left'), true, 'the ship steps off towards the edge');
  assert.equal(edged.reflectionObstacleInTheWay(at(1, 5), at(0, 5), 'left'), null, 'and there is nothing to flash');

  const STINGER = { id: 'stinger', name: 'Stinger', parts: [{ kind: 'Sting' }] };
  let stung = withArchetons([REFLECT_MIMIC, STINGER], mimic(5, 5), obj('Start', 2, 5), obj('Archeton', 8, 5, { archeton: 'stinger', direction: 'Right' }));
  stung.placeShip(at(1, 5));
  assert.equal(stung.canEnter(at(1, 5), at(2, 5), 'right'), true, 'a Stinging Archeton doesn\'t refuse the step, it hurts');
  assert.equal(stung.reflectionObstacleInTheWay(at(1, 5), at(2, 5), 'right'), null, 'so there\'s nothing to flash');

  let open = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  open.placeShip(at(1, 5));
  assert.equal(open.canEnter(at(1, 5), at(2, 5), 'right'), true, 'a step nothing refuses');
  assert.equal(open.reflectionObstacleInTheWay(at(1, 5), at(2, 5), 'right'), null, 'has nothing to flash');

  // A Wall on the ship's own side refuses the step by itself, so the reflection isn't the reason and there's nothing to
  // put on the ship's side of the pane.
  let own = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Wall', 2, 5));
  own.placeShip(at(1, 5));
  assert.equal(own.canEnter(at(1, 5), at(2, 5), 'right'), false, 'the ship can\'t step into its own Wall');
  assert.equal(own.reflectionObstacleInTheWay(at(1, 5), at(2, 5), 'right'), null, 'and nothing is flashed for it');
});

test('a Push Block drawn on its own gives the flash its shape, with nothing behind it', () => {
  let { look } = artLook();
  let alone = blank();
  renderBoard(alone, [block(0, 0)], look);
  let painted = 0;
  for (let i = 3; i < alone.data.length; i += 4) if (alone.data[i] > 0) painted++;
  assert.ok(painted > 0, 'the block draws');
  assert.ok(painted < ART_PX * ART_PX, 'and only it does, so the flash shows a block rather than a whole square');
});

test('the line of sight runs from the ship to its reflection, wherever both are being drawn', () => {
  const { reflectionSightLine } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');
  let g = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  let ship = { x: 2.5 * TILE_PX, y: 5.5 * TILE_PX };
  assert.deepEqual(reflectionSightLine(g.reflections[0], ship, TILE_PX), { from: ship, to: { x: 8.5 * TILE_PX, y: 5.5 * TILE_PX } }, '2 across the pane at 5 is 8');

  let chain = withArchetons([REFLECT_MIMIC], mimic(3, 5), mimic(7, 5), obj('Start', 1, 5));
  let second = chain.reflections.find(reflection => reflection.col === 9);
  let line = reflectionSightLine(second, { x: 1.5 * TILE_PX, y: 5.5 * TILE_PX }, TILE_PX);
  assert.deepEqual(line.from, { x: 5.5 * TILE_PX, y: 5.5 * TILE_PX }, 'from the reflection it was made from, not the ship');
  assert.deepEqual(line.to, { x: 9.5 * TILE_PX, y: 5.5 * TILE_PX });
});

test('a pane whose sight is blocked is reported, so the line can stop where it does', () => {
  let clear = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5));
  assert.deepEqual(clear.blockedSights, [], 'nothing in the way, nothing to report');

  let blocked = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 5), obj('Wall', 4, 5));
  assert.deepEqual(cells(blocked), [], 'with a Wall between, the pane shows nothing');
  let [sight] = blocked.blockedSights;
  assert.deepEqual(at(sight.pane.col, sight.pane.row), at(5, 5), 'the pane is reported');
  assert.deepEqual(at(sight.blocker.col, sight.blocker.row), at(4, 5), 'and the Wall that stops the sight');

  let outOfLine = withArchetons([REFLECT_MIMIC], mimic(5, 5), obj('Start', 2, 4));
  assert.deepEqual(outOfLine.blockedSights, [], 'a pane the ship isn\'t in line with has no sight to block');
});

// ---------- Edges ----------

// An Edge is along one side of its square, and its direction is the side it's on - which is also the way the higher
// ground is. So the ship can drop off it that way, and can't climb back up it.
const edge = (col, row, direction) => obj('Edge', col, row, { direction });

test('a ledge refuses the step up it, and lets the ship drop off it the other way', () => {
  // The ship is on the high ground at (4, 5), and (4, 6) is the low ground below, with a ledge facing up at it.
  let g = game(obj('Start', 4, 5), edge(4, 6, 'Up'));
  assert.equal(g.canEnter(at(4, 5), at(4, 6), 'down'), true, 'dropping off the ledge is a step like any other');
  assert.equal(g.canEnter(at(4, 6), at(4, 5), 'up'), false, 'climbing back up it is refused');
  assert.equal(g.canEnter(at(4, 6), at(5, 6), 'right'), true, 'and it only refuses that one way out of its square');
});

test('a ledge is not solid: the ship can stand on it and walk about its square', () => {
  let g = game(obj('Start', 4, 6), edge(4, 6, 'Up'), edge(4, 6, 'Left'));
  assert.deepEqual(at(g.shipCell.col, g.shipCell.row), at(4, 6));
  assert.equal(g.canEnter(at(4, 6), at(5, 6), 'right'), true);
  assert.equal(g.canEnter(at(4, 6), at(4, 7), 'down'), true);
  assert.equal(g.canEnter(at(4, 6), at(3, 6), 'left'), false, 'and a square can hold one on each of its sides');
});

test('a ledge is only a ledge from its low side: a Beam stops at it one way and goes over the other', () => {
  let archetons = [{ id: 'beamer', name: 'Beamer', parts: [{ kind: 'Beam', look: 'Facing', range: 3 }] }];
  let beamer = (col, row, direction) => obj('Archeton', col, row, { archeton: 'beamer', direction });
  let reaches = (g) => g.reaches.map(cell => `${cell.col},${cell.row}`).sort();

  // Facing up from the low ground, at the ledge: stopped by its face.
  let below = createPuzzleGame({ objects: [beamer(4, 6, 'Up'), edge(4, 6, 'Up')], palette: {}, archetons });
  assert.deepEqual(reaches(below), [], 'the ledge stops the beam at its own square');

  // Facing down onto the same ledge from above it: over the top.
  let above = createPuzzleGame({ objects: [beamer(4, 3, 'Down'), edge(4, 6, 'Up')], palette: {}, archetons });
  assert.deepEqual(reaches(above), ['4,4', '4,5', '4,6'], 'a beam from the high side passes over it');
});

test('a ledge hides what is beyond it from its low side, and not from its high side', () => {
  // A ledge at (5, 5) facing right: the high ground is (6, 5), and the low ground (4, 5).
  let fromBelow = createPuzzleGame({ objects: [mimic(6, 5), edge(5, 5, 'Right'), obj('Start', 4, 5)], palette: {}, archetons: [REFLECT_MIMIC] });
  assert.deepEqual(cells(fromBelow), [], 'the ship below the ledge is hidden by it');
  assert.equal(fromBelow.blockedSights.length, 1, 'and the pane reports what is in the way');
  assert.deepEqual(at(fromBelow.blockedSights[0].blocker.col, fromBelow.blockedSights[0].blocker.row), at(5, 5), 'the ledge itself');

  let fromAbove = createPuzzleGame({ objects: [mimic(4, 5), edge(5, 5, 'Right'), obj('Start', 6, 5)], palette: {}, archetons: [REFLECT_MIMIC] });
  assert.deepEqual(cells(fromAbove), [at(2, 5)], 'from the high side the pane sees over the ledge');
  assert.deepEqual(fromAbove.blockedSights, []);
});

test('a Push Block is shoved off a ledge, but not up one', () => {
  let down = game(obj('Start', 4, 5), obj('PushBlock', 4, 6, { symbol: 'Circle' }), edge(4, 7, 'Up'));
  assert.equal(down.canEnter(at(4, 5), at(4, 6), 'down'), true, 'pushed onto the ledge square');
  assert.equal(down.canEnter(at(4, 6), at(4, 7), 'down'), true, 'and on off it');

  let up = game(obj('Start', 4, 8), obj('PushBlock', 4, 7, { symbol: 'Circle' }), edge(4, 7, 'Up'));
  assert.equal(up.canEnter(at(4, 8), at(4, 7), 'up'), false, 'but a block will not go up one');
});

test('a square holds an Edge on each of its sides, and erasing takes the side chosen', () => {
  let board = placeObject([edge(1, 1, 'Up')], edge(1, 1, 'Left'));
  assert.deepEqual(board.map(o => o.direction).sort(), ['Left', 'Up']);
  board = placeObject(board, edge(1, 1, 'Up'));
  assert.equal(board.filter(o => o.kind === 'Edge').length, 2, 'placing one already there replaces it');
  assert.deepEqual(eraseObject(board, at(1, 1), 'Up').map(o => o.direction), ['Left']);
  assert.deepEqual(eraseObject(board, at(1, 1)).length, 1, 'and without a side, one of them goes');
  // An Edge is along a side rather than on the square, so it sits under a floor tile rather than taking its place.
  let onStream = placeObject([stream(2, 2)], edge(2, 2, 'Up'));
  assert.deepEqual(onStream.map(o => o.kind).sort(), ['Edge', 'Stream']);
});

test('the ledge at the foot of a step is drawn raised, and the others flat', () => {
  let { look } = artLook();
  let rowsFor = (direction) => {
    let image = blank();
    renderBoard(image, [edge(1, 2, direction)], look);
    return rowsDrawn(image, 1);
  };
  // The one the higher ground is above shows its face to the way the board is seen from, so it stands up like a Wall.
  assert.equal(Math.min(...rowsFor('Up')), 2 * TILE_PX - RAISED_PX);
  assert.ok(Math.min(...rowsFor('Down')) >= 2 * TILE_PX, 'the others lie flat, in their own square');
  // And a ledge is a strip along its square's side, not a block filling it.
  let image = blank();
  renderBoard(image, [edge(1, 2, 'Down')], { ...look, depth: 'flat' });
  assert.equal(pixelAt(image, 1 * TILE_PX + 12, 2 * TILE_PX + 2)[3], 0, 'nothing drawn away from the ledge');
  assert.equal(pixelAt(image, 1 * TILE_PX + 12, 2 * TILE_PX + 22)[3], 255, 'and the ledge itself drawn');
});

test('an Edge is turned to the side of the square it is on, so a run of them joins up', () => {
  let { look } = artLook();
  let draw = (direction) => { let image = blank(); renderBoard(image, [edge(1, 1, direction)], { ...look, depth: 'flat' }); return image; };
  // Drawn with its ledge on the right, and turned: the same pixels, one way round or another.
  let column = (image, x) => { let out = []; for (let y = TILE_PX; y < 2 * TILE_PX; y++) out.push(pixelAt(image, x, y).join()); return out.join('|'); };
  let row = (image, y) => { let out = []; for (let x = TILE_PX; x < 2 * TILE_PX; x++) out.push(pixelAt(image, x, y).join()); return out; };
  assert.ok(row(draw('Up'), TILE_PX).some(pixel => pixel.endsWith(',255')), 'facing up, the ledge runs along the top');
  assert.ok(row(draw('Down'), 2 * TILE_PX - 1).some(pixel => pixel.endsWith(',255')), 'facing down, along the bottom');
  assert.ok(column(draw('Left'), TILE_PX).length > 0);
  assert.notEqual(tile(draw('Up'), 1, 1), tile(draw('Down'), 1, 1));
});

test('a Push Block shoved off a ledge leaps down it, growing towards the middle as the ship does', () => {
  let { look } = artLook();
  // How wide the block is drawn, in pixels: only it is on the board, so its edges are the image's.
  let width = (falls, pushAlong) => {
    let image = blank();
    renderBoard(image, [obj('PushBlock', 3, 2, { symbol: 'Circle', fromCol: 2, fromRow: 2, glide: 'push', falls })], look, { pushAlong, along: 0 });
    let left = Infinity, right = -Infinity;
    for (let x = 0; x < TILE_PX * 6; x++) {
      for (let y = 0; y < TILE_PX * 3; y++) {
        if (pixelAt(image, x, y)[3] === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    return right - left + 1;
  };
  assert.ok(width(true, 0.5) > width(false, 0.5), 'mid-leap, so drawn bigger than the glide alone would');
  assert.equal(width(true, 1), width(false, 1), 'and its own size again once it has landed');
});

// ---------- Gate Beams ----------

// The brightest pixel in a square, as the renderer leaves it - for a Beam's crackle, which wanders a pixel either side
// of true, and for a flash, which only lights what's already drawn.
function brightestIn(image, col, row){
  let best = [0, 0, 0, 0];
  for (let y = row * TILE_PX; y < (row + 1) * TILE_PX; y++) {
    for (let x = col * TILE_PX; x < (col + 1) * TILE_PX; x++) {
      let pixel = pixelAt(image, x, y);
      if (pixel[3] > best[3] || (pixel[3] === best[3] && pixel[0] + pixel[1] > best[0] + best[1])) best = pixel;
    }
  }
  return best;
}

test('a Gate Beam is drawn yellow from the Switch towards its Gates, as far as it has got', () => {
  let { look } = artLook();
  let drawn = (progress) => {
    let image = blank();
    renderBoard(image, [], look, { gateBeams: [{ from: at(1, 4), to: [at(6, 4)], ms: 0, progress, opacity: 1, switchFlash: 0, gateFlash: 0 }] });
    return image;
  };
  let lit = brightestIn(drawn(1), 3, 4);
  assert.ok(lit[3] > 200, 'lit where the Beam has got to');
  assert.ok(lit[0] > 200 && lit[1] > 180 && lit[2] < 120, `yellow, not a palette colour: ${lit}`);

  assert.equal(brightestIn(drawn(0.3), 5, 4)[3], 0, 'and dark where it has not reached yet');
  assert.ok(brightestIn(drawn(0.3), 2, 4)[3] > 200, 'but lit behind the head');
});

test('the Switch flashes as it fires, and a Gate flashes as the Beam reaches it', () => {
  let { look } = artLook();
  let drawn = (flash) => {
    let image = blank();
    renderBoard(image, [obj('Switch', 1, 4, { letter: 'A' }), obj('Gate', 6, 4, { letter: 'A', open: true })], look, {
      // No line, so that only the flashes are in the picture: the Beam starts on the Switch's own square.
      gateBeams: [{ from: at(1, 4), to: [at(6, 4)], ms: 0, progress: 0, opacity: 0, ...flash }],
    });
    return image;
  };
  let plain = { switchFlash: 0, gateFlash: 0 };
  let firing = drawn({ switchFlash: 1, gateFlash: 0 });
  assert.ok(brightestIn(firing, 1, 4)[2] < brightestIn(drawn(plain), 1, 4)[2], 'the Switch lights up as it fires, going yellow');
  assert.deepEqual(brightestIn(firing, 6, 4), brightestIn(drawn(plain), 6, 4), 'but the Gate does not, until the Beam reaches it');

  let landed = drawn({ switchFlash: 0, gateFlash: 1 });
  assert.ok(brightestIn(landed, 6, 4)[2] < brightestIn(drawn(plain), 6, 4)[2], 'then the Gate lights up too');
});

// ---------- Move Cranes ----------

const craneAt = (col, row, letter = 'A') => obj('Crane', col, row, { letter });
test('a crane comes down for 300ms, rests, hauls its load up into a fade, then does the reverse on the far square', () => {
  let from = at(2, 2), to = at(7, 7);
  let pose = (ms) => cranePose(from, to, ms);

  // Down onto it, over 300ms.
  assert.deepEqual(pose(0), { cell: from, lift: 1, alpha: 1 });
  assert.deepEqual(pose(150), { cell: from, lift: 0.5, alpha: 1 });
  // Resting on it, for 200.
  assert.deepEqual(pose(300), { cell: from, lift: 0, alpha: 1 });
  assert.deepEqual(pose(499), { cell: from, lift: 0, alpha: 1 });
  // Hauling it up into the fade, over 200: half up is half gone.
  assert.deepEqual(pose(600), { cell: from, lift: 0.5, alpha: 0.5 });
  // Set down at the end of the first half, where the fade has just taken it out at one square and not yet brought it in
  // at the other.
  assert.deepEqual(pose(CRANE_PICKUP_MS), { cell: to, lift: 1, alpha: 0 });
  // The reverse: down out of the fade, rest, and up again.
  assert.deepEqual(pose(800), { cell: to, lift: 0.5, alpha: 0.5 });
  assert.deepEqual(pose(900), { cell: to, lift: 0, alpha: 1 });
  assert.deepEqual(pose(1250), { cell: to, lift: 0.5, alpha: 1 });
  assert.deepEqual(pose(1400), { cell: to, lift: 1, alpha: 1 });

  assert.equal(CRANE_PICKUP_MS, 700, '300 down, 200 resting, 200 up');
  assert.equal(CRANE_MS, 1400, 'and the same again on the other side');
});

test('a crane moves and fades what it has taken only while the claw has it', () => {
  let from = at(2, 2), to = at(7, 7);
  let load = (ms) => craneLoad(from, to, ms);

  // Untouched while the claw comes down on it and rests: on its own square, and solid.
  assert.deepEqual(load(0), { cell: from, lift: 0, alpha: 1 });
  assert.deepEqual(load(299), { cell: from, lift: 0, alpha: 1 });
  assert.deepEqual(load(499), { cell: from, lift: 0, alpha: 1 });
  // Grabbed at 500, and only then moving: up with the claw, fading as it goes.
  assert.deepEqual(load(600), { cell: from, lift: 0.5, alpha: 0.5 });
  let hauled = load(699);
  assert.equal(hauled.cell, from);
  assert.ok(hauled.lift > CRANE_LIFT * 0.99 && hauled.alpha < 0.01, `all but up and all but gone: ${hauled.lift}, ${hauled.alpha}`);
  // In the claw right across the landing, where it is out of sight at one square and not yet in at the other.
  assert.deepEqual(load(CRANE_PICKUP_MS), { cell: to, lift: 1, alpha: 0 });
  assert.deepEqual(load(800), { cell: to, lift: 0.5, alpha: 0.5 });
  // Set down at 900, and there it stays while the empty claw lifts away.
  assert.deepEqual(load(900), { cell: to, lift: 0, alpha: 1 });
  assert.deepEqual(load(1250), { cell: to, lift: 0, alpha: 1 });
  assert.deepEqual(load(CRANE_MS), { cell: to, lift: 0, alpha: 1 });

  // The claw itself keeps moving the whole time - it is the one doing the work.
  assert.deepEqual(cranePose(from, to, 0).lift, 1);
  assert.deepEqual(cranePose(from, to, CRANE_MS).lift, 1);
});

// The barrel carries only CRANE_MS, which is the one board.js draws by; where in a pickup the thing lands is the
// rules' own half of it.
const { CRANE_PICKUP_MS, CRANE_LIFT } = require('../../src/TheWeave.Exporter/runtime/puzzleRules.js');

test('a Crane takes the ship up and sets it down on the other Crane square', () => {
  let g = game(craneAt(2, 5), craneAt(6, 3), obj('Start', 2, 6));
  // The barrel carries only the one constant board.js draws by: a name missing from puzzle.js's allow-list would
  // leave this undefined, and every pickup would land on the frame it started.
  assert.equal(CRANE_MS, CRANE_PICKUP_MS * 2);
  let caught = g.shipArrivedAt(at(2, 5));
  assert.deepEqual(caught.crane, { from: at(2, 5), to: at(6, 3) });
  assert.deepEqual(g.shipCell, at(2, 5), 'still where it stepped on, until the claw has it');
  assert.equal(g.canEnter(at(2, 5), at(2, 6), 'down'), false, 'and it can go nowhere while it is held');
  assert.equal(g.carryDirection(at(2, 5)), null);

  let landed = g.advanceCranes(CRANE_MS / 2);
  assert.deepEqual(landed, [{ cranedTo: at(6, 3), ship: true }]);
  assert.deepEqual(g.shipCell, at(6, 3));
  // The square it is set down on does not fire: a crane takes what arrives, and nothing arrived a second time.
  assert.equal(g.canEnter(at(6, 3), at(6, 4), 'down'), true, 'and it is free to walk on');
  g.advanceCranes(CRANE_MS);
  assert.deepEqual(g.cranes, [], 'the claw is gone once the pickup has played');
});

test('a Crane with no partner, or with no letter, does nothing at all', () => {
  let lonely = game(craneAt(2, 5), obj('Start', 2, 6));
  assert.equal(lonely.shipArrivedAt(at(2, 5))?.crane, undefined);

  let letterless = game(obj('Crane', 2, 5), obj('Crane', 6, 5), obj('Start', 2, 6));
  assert.equal(letterless.shipArrivedAt(at(2, 5))?.crane, undefined, 'two letterless cranes would pair with each other');
});

test('a Push Block pushed onto a Crane is set down on the other Crane square', () => {
  let g = game(craneAt(4, 5), craneAt(7, 8), obj('PushBlock', 3, 5, { symbol: 'Circle' }), obj('Start', 2, 5));
  g.pushFrom(at(2, 5), at(3, 5), 'right');
  let block = find(g, 'PushBlock');
  assert.deepEqual({ col: block.col, row: block.row }, at(4, 5), 'on the crane, in its claw');
  g.advanceCranes(CRANE_PICKUP_MS);
  assert.deepEqual({ col: block.col, row: block.row }, at(7, 8));
  assert.equal(block.glide, null, 'and not drawn gliding there');
});

test('a Stream carrying something onto a Crane cranes it, and a held block stays put for a tick', () => {
  let g = game(craneAt(4, 5), craneAt(8, 5), obj('PushBlock', 3, 5, { symbol: 'Circle' }),
    obj('Stream', 3, 5, { direction: 'Right' }), obj('Stream', 4, 5, { direction: 'Right' }));
  g.tick(null);
  let block = find(g, 'PushBlock');
  assert.deepEqual({ col: block.col, row: block.row }, at(4, 5));
  g.tick(null);
  assert.deepEqual({ col: block.col, row: block.row }, at(4, 5), 'the claw has hold of it');
  g.advanceCranes(CRANE_PICKUP_MS);
  assert.deepEqual({ col: block.col, row: block.row }, at(8, 5));
});

test('an Archeton craned to another Crane goes on patrolling from there', () => {
  // Two moves, so that a route still counted from the bug's old home - or from the beat it had got to - lands
  // somewhere else: a one-move sequence is at the start of itself again however far it has walked.
  let hopper = { id: 'hopper', name: 'Hopper', parts: [{ kind: 'Sequence', moves: ['Right', 'Left'] }] };
  let g = withArchetons([hopper],
    obj('Archeton', 3, 5, { archeton: 'hopper', direction: 'Right' }),
    craneAt(4, 5), craneAt(4, 8), obj('Start', 1, 9));

  g.shipArrivedAt(at(1, 8));                       // its beat: right, onto the crane
  assert.deepEqual({ col: find(g, 'Archeton').col, row: find(g, 'Archeton').row }, at(4, 5));
  g.advanceCranes(CRANE_PICKUP_MS);
  assert.deepEqual({ col: find(g, 'Archeton').col, row: find(g, 'Archeton').row }, at(4, 8));

  g.shipArrivedAt(at(1, 9));                       // its next beat, counted from where it was put down
  assert.deepEqual({ col: find(g, 'Archeton').col, row: find(g, 'Archeton').row }, at(5, 8), 'not back at 5,5');
});
