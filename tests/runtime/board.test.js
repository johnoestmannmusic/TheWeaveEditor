// Run with: node --test tests/runtime/*.test.js
// A board being played (src/TheWeave.Exporter/runtime/board.js), as the game and the Editor's playtest both play it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardPlay, facingInwards } = require('../../src/TheWeave.Exporter/runtime/board.js');
const { BOARD_TIMING } = require('../../src/TheWeave.Exporter/runtime/puzzle.js');

const obj = (kind, col, row, extra = {}) => ({ kind, col, row, ...extra });
const at = (col, row) => ({ col, row });

// Moves time on in frames, as the game's loop does.
function run(play, ms){
  for (let left = ms; left > 0; left -= 16) {
    play.animate(Math.min(16, left));
    play.step(Math.min(16, left));
  }
}

test('the ship starts facing into the board, away from the edge it starts on', () => {
  assert.equal(facingInwards(at(5, 9)), 'up');
  assert.equal(facingInwards(at(0, 4)), 'right');
  assert.equal(facingInwards(at(4, 4)), 'up');
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 9, 3)] } });
  assert.equal(play.mover.facing, 'left');
});

test('a Stream carries the ship along by itself', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 2, 5), obj('Stream', 2, 5, { direction: 'Right' }), obj('Stream', 3, 5, { direction: 'Right' })] } });
  run(play, BOARD_TIMING.stepMs * 3);
  assert.deepEqual(play.mover.cell, at(4, 5));
});

test('a Jump Tile launches the ship, nothing else moving until it lands', () => {
  let events = [];
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 1, 5), obj('JumpTile', 2, 5, { direction: 'Right' }), obj('Wall', 3, 5)] }, hooks: { onJump: () => events.push('jump'), onLanded: () => events.push('landed') } });
  play.mover.press('right');
  play.mover.release('right');
  run(play, BOARD_TIMING.stepMs + 30);
  assert.ok(play.jump, 'in the air');
  run(play, BOARD_TIMING.jumpMsPerSquare * 2 + 50);
  assert.equal(play.jump, null);
  assert.deepEqual(play.mover.cell, at(4, 5));
  assert.deepEqual(events, ['jump', 'landed']);
});

test('a Reset Switch\'s sweep holds the board still until it\'s done', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 1, 5), obj('ResetSwitch', 2, 5)] } });
  play.mover.press('right');
  play.mover.release('right');
  run(play, BOARD_TIMING.stepMs + 30);
  assert.ok(play.reset);
  play.mover.press('left');
  run(play, 100);
  assert.deepEqual(play.mover.cell, at(2, 5), 'held still');
  run(play, 1000);
  assert.equal(play.reset, null);
});

test('reaching the Finish finishes the board, and nothing moves after', () => {
  let finished = 0;
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 1, 5), obj('Finish', 2, 5)] }, hooks: { onEvent: (e) => { if (e.finished) finished++; } } });
  play.mover.press('right');
  run(play, BOARD_TIMING.stepMs * 4);
  assert.equal(finished, 1);
  assert.equal(play.finished, true);
  assert.deepEqual(play.mover.cell, at(2, 5));
});

test('a frame\'s key stays the same while nothing on the board changes, and changes when something does', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 1, 5), obj('Wall', 4, 4)] } });
  let first = play.frame(0).key;
  run(play, 500);
  assert.equal(play.frame(5000).key, first, 'a still board with nothing animating looks the same');
  play.mover.press('right');
  run(play, 60);
  assert.notEqual(play.frame(5060).key, first, 'the ship moving changes it');
  let flowing = createBoardPlay({ puzzle: { objects: [obj('Start', 1, 5), obj('Stream', 7, 7, { direction: 'Up' })] } });
  assert.notEqual(flowing.frame(0).key, flowing.frame(450).key, 'a Stream keeps flowing');
});

test('every Push Block next to the ship that it could push gets an arrow, whichever way the ship faces', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 4, 5), obj('PushBlock', 5, 5, { symbol: 'Circle' }), obj('PushBlock', 4, 4, { symbol: 'Star' }), obj('PushBlock', 3, 5, { symbol: 'Cross' }), obj('Wall', 2, 5)] } });
  assert.equal(play.mover.facing, 'up');
  let hints = play.pushHints(0).map(h => `${h.direction}@${h.col},${h.row}`).sort();
  assert.deepEqual(hints, ['Right@5,5', 'Up@4,4'], 'the Circle and Star, but not the Cross, with a Wall behind it');
  assert.notEqual(play.frame(0, { pushHints: play.pushHints(0) }).key, play.frame(0).key, 'and they\'re part of what\'s drawn');
});

test('a Teleporter sends the ship across to the other, spinning and fading as it goes, before it gets there', () => {
  let events = [];
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 1, 5), obj('Teleporter', 2, 5, { letter: 'A' }), obj('Teleporter', 7, 2, { letter: 'A' })] }, hooks: { onTeleport: () => events.push('off'), onTeleported: () => events.push('there') } });
  play.mover.press('right');
  play.mover.release('right');
  run(play, BOARD_TIMING.stepMs + 20);
  assert.ok(play.teleport, 'on its way');
  assert.deepEqual(play.mover.cell, at(2, 5), 'still at the first until it arrives');
  let mid = play.teleport.durationMs / 2 - play.teleport.ms;
  run(play, mid);
  let halfway = play.shipPosition();
  assert.ok(halfway.opacity < 0.3, `three-quarters see-through at the middle: ${halfway.opacity}`);
  assert.ok(halfway.spin > 2.5 && halfway.spin < 3.8, 'half a turn round');
  assert.ok(halfway.x > 2.5 * 24 && halfway.x < 7.5 * 24, 'part way across');
  assert.deepEqual(play.pushHints(0), [], 'no hints while it\'s going');
  run(play, play.teleport.durationMs);
  assert.equal(play.teleport, null);
  assert.deepEqual(play.mover.cell, at(7, 2));
  assert.deepEqual([play.shipPosition().opacity, play.shipPosition().spin], [1, 0]);
  assert.deepEqual(events, ['off', 'there']);
});
