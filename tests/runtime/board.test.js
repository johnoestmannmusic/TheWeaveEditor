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

test('a step refused by the reflection\'s side flashes what stopped it, on the square the ship tried', () => {
  const REFLECT = { id: 'reflect-mimic', name: 'Reflect Mimic', parts: [{ kind: 'Reflect' }] };
  // The pane at 5,5 shows the ship at 2,5 as being at 8,5, with a Wall at 9,5 for it to walk into.
  let play = createBoardPlay({
    puzzle: {
      objects: [obj('Archeton', 5, 5, { archeton: 'reflect-mimic', direction: 'Right' }), obj('Start', 2, 5), obj('Wall', 9, 5)],
      archetons: [REFLECT],
    },
  });
  play.mover.press('left');
  play.mover.release('left');
  run(play, 40);
  assert.deepEqual(play.mover.cell, at(2, 5), 'the ship stays where it is');
  assert.ok(play.refusedFlash, 'and what stopped it flashes');
  assert.deepEqual([play.refusedFlash.col, play.refusedFlash.row], [1, 5], 'on the square it tried to walk into');
  assert.equal(play.refusedFlash.object?.kind, 'Wall');
  let shownFor = play.refusedFlash.ms;
  run(play, 120);
  assert.ok(play.refusedFlash.ms > shownFor, 'holding on into it carries the flash on rather than starting it again');
  run(play, 700);
  assert.equal(play.refusedFlash, null, 'then fades');
});

test('a chained reflection doesn\'t hold the ship back from stepping towards its pane', () => {
  const REFLECT = { id: 'reflect-mimic', name: 'Reflect Mimic', parts: [{ kind: 'Reflect' }] };
  // Two panes lying flat in one column, so the ship at 5,9 is shown at 5,3 and that reflection at 5,1. Stepping up
  // takes the first reflection down and the second up, and there is nothing in the way of either.
  let play = createBoardPlay({
    puzzle: {
      objects: [
        obj('Archeton', 5, 6, { archeton: 'reflect-mimic', direction: 'Down' }),
        obj('Archeton', 5, 2, { archeton: 'reflect-mimic', direction: 'Down' }),
        obj('Start', 5, 9),
      ],
      archetons: [REFLECT],
    },
  });
  play.mover.press('up');
  play.mover.release('up');
  run(play, 40);
  assert.deepEqual(play.mover.cell, at(5, 8), 'the ship steps up');
  run(play, BOARD_TIMING.stepMs);
  assert.equal(play.refusedFlash, null, 'and nothing is refused for it');
  assert.deepEqual(play.game.reflections.map(cell => at(cell.col, cell.row)), [at(5, 4), at(5, 0)], 'both reflections step with it');
});

test('a step nothing refuses shows nothing', () => {
  const REFLECT = { id: 'reflect-mimic', name: 'Reflect Mimic', parts: [{ kind: 'Reflect' }] };
  let play = createBoardPlay({
    puzzle: {
      objects: [obj('Archeton', 5, 5, { archeton: 'reflect-mimic', direction: 'Right' }), obj('Start', 2, 5)],
      archetons: [REFLECT],
    },
  });
  play.mover.press('left');
  play.mover.release('left');
  run(play, 40);
  assert.deepEqual(play.mover.cell, at(1, 5), 'the ship walks on');
  assert.equal(play.refusedFlash, null);
});

test('stepping off a ledge drops the ship down it, and is drawn as a small jump', () => {
  // The high ground at (4, 5), and a ledge facing up at it on the square below.
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 4, 5), obj('Edge', 4, 6, { direction: 'Up' })] } });
  assert.equal(play.shipPosition().t, null, 'standing still, nothing to arc');

  play.mover.press('down');
  play.mover.release('down');
  run(play, 16);
  assert.equal(play.mover.isMoving, true);
  assert.notEqual(play.shipPosition().t, null, 'mid-drop, arced as a jump');

  run(play, BOARD_TIMING.stepMs);
  assert.deepEqual(play.mover.cell, at(4, 6), 'and it lands on the low square');
  assert.equal(play.shipPosition().t, null, 'the arc over');

  play.mover.press('up');
  play.mover.release('up');
  run(play, BOARD_TIMING.stepMs * 2);
  assert.deepEqual(play.mover.cell, at(4, 6), 'and it cannot climb back up the ledge');
  assert.equal(play.shipPosition().t, null, 'a refused step never leaves the ground');
});

test('a step along the flat is not drawn as a jump', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 4, 5)] } });
  play.mover.press('down');
  play.mover.release('down');
  run(play, 16);
  assert.equal(play.mover.isMoving, true);
  assert.equal(play.shipPosition().t, null, 'a plain step glides, it does not arc');
});

test('a Push Block shoved off a ledge falls, so it can be drawn hopping down it', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 4, 5), obj('PushBlock', 4, 6, { symbol: 'Circle' }), obj('Edge', 4, 7, { direction: 'Up' })] } });
  let block = () => play.game.objects.find(object => object.kind === 'PushBlock');

  play.mover.press('down');
  play.mover.release('down');
  run(play, 16);
  assert.equal(block().falls, true, 'off the ledge at (4, 7)');

  run(play, BOARD_TIMING.stepMs);
  assert.deepEqual(at(block().col, block().row), at(4, 7), 'it goes off it');
  assert.equal(block().falls, false, 'and once it has landed it is simply where it is');
});

test('a Push Block shoved along the flat does not fall', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 4, 5), obj('PushBlock', 4, 6, { symbol: 'Circle' })] } });
  play.mover.press('down');
  play.mover.release('down');
  run(play, 16);
  assert.equal(play.game.objects.find(object => object.kind === 'PushBlock').falls, false);
});

test('a Switch press sends a Beam out, and its Gates change when it lands rather than on the press', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 4, 5), obj('Switch', 4, 6, { letter: 'A' }), obj('Gate', 4, 8, { letter: 'A' })] } });
  let gate = () => play.game.objects.find(object => object.kind === 'Gate');

  play.mover.press('down');
  play.mover.release('down');
  run(play, BOARD_TIMING.stepMs);
  assert.equal(gate().open, false, 'still shut while the Beam is on its way');
  assert.equal(play.gateBeams.length, 1, 'and the Beam is there to be drawn');
  assert.deepEqual(play.gateBeams[0].to, [at(4, 8)], 'aimed at the Gate');

  run(play, BOARD_TIMING.gateBeamTravelMs);
  assert.equal(gate().open, true, 'open once it lands');
  let { options } = play.frame(0, {});
  assert.ok(options.gateBeams[0].gateFlash > 0.9, 'and the Gate flashes as it does');
  assert.ok(options.gateBeams[0].switchFlash > 0 && options.gateBeams[0].switchFlash < 1, 'while the Switch is on its way back down');

  // Drawn for about a second, then gone.
  run(play, BOARD_TIMING.gateBeamMs);
  assert.deepEqual(play.gateBeams, [], 'and the Beam is taken down after it');
});

test('a Swim Fish swims a square each step the ship takes, drawn gliding as it goes', () => {
  const SWIM_FISH = { id: 'swim-fish', name: 'Swim Fish', parts: [{ kind: 'Swim' }, { kind: 'Sting' }] };
  let play = createBoardPlay({
    puzzle: { archetons: [SWIM_FISH], objects: [obj('Start', 5, 8), obj('Archeton', 5, 5, { archeton: 'swim-fish', direction: 'Left' })] },
  });
  let fish = () => play.game.objects.find(object => object.archeton === 'swim-fish');

  play.mover.press('up');
  play.mover.release('up');
  run(play, BOARD_TIMING.stepMs);
  assert.equal(fish().col, 4, 'swum a square the way it was placed');
  assert.equal(fish().glide, 'swim', 'gliding, not snapping');
  let { options } = play.frame(0, {});
  assert.ok(options.swimAlong < 1, 'and drawn part way there');
});
