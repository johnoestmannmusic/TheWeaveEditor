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
