// Run with: node --test tests/runtime/*.test.js
// A board being played (src/TheWeave.Exporter/runtime/board.js), as the game and the Editor's playtest both play it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardPlay, facingInwards, WARP_FLASH_MS } = require('../../src/TheWeave.Exporter/runtime/board.js');
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

test("a board's white flash is washed out to white and spent over WARP_FLASH_MS, which is what a Puzzle Warp's two waits are", () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 2, 5)] } });
  assert.equal(play.frame(0).options.warpFlash, 0, 'nothing to begin with');

  // How a Puzzle Warp's departure washes the board out: the page puts this back to 0, once for each flash, and waits out
  // WARP_FLASH_MS before the next - see trackFocus's flashBoardTwice.
  play.warpFlashMs = 0;
  assert.equal(play.frame(0).options.warpFlash, 1, 'white the moment it is set');
  run(play, WARP_FLASH_MS / 2);
  let half = play.frame(0).options.warpFlash;
  assert.ok(half > 0.4 && half < 0.6, `washed half out at half its time (${half})`);
  run(play, WARP_FLASH_MS);
  assert.equal(play.frame(0).options.warpFlash, 0, 'spent');
});

test('a Warp Wisp over a Rotator Switch runs the Rotators while the ship walks about', () => {
  // A line of Rotator tiles with a Wall on it, and the ship down in the corner: only a Wisp can be holding the
  // Switch, and the ship being in motion is the thing that used to stop the Rotators dead.
  const puzzle = (wisp) => ({
    objects: [
      obj('Start', 1, 9),
      obj('RotatorTile', 1, 5, { direction: 'Right' }),
      obj('RotatorTile', 2, 5, { direction: 'Right' }),
      obj('Wall', 1, 5),
      obj('RotatorSwitch', 5, 5),
      ...(wisp ? [obj('Archeton', 5, 5, { archeton: 'warp-wisp' })] : []),
    ],
    archetons: [{ id: 'warp-wisp', name: 'Warp Wisp', parts: [{ kind: 'Warp' }] }],
  });

  let held = createBoardPlay({ puzzle: puzzle(true) });
  assert.equal(held.game.wispOnRotatorSwitch, true);
  held.mover.press('right');
  run(held, BOARD_TIMING.rotatorTickMs * 2 + 100);
  assert.equal(held.game.objects.find(o => o.kind === 'Wall').col, 2, 'the Wall was carried along');

  let alone = createBoardPlay({ puzzle: puzzle(false) });
  alone.mover.press('right');
  run(alone, BOARD_TIMING.rotatorTickMs * 2 + 100);
  assert.equal(alone.game.objects.find(o => o.kind === 'Wall').col, 1, 'and with no Wisp it stays put');
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

test('a collected Gem flies to the Gem Gate, which rattles and pulses when it lands', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 5, 8), obj('GemGate', 5, 2), obj('Gem', 5, 7)] } });
  play.mover.press('up');
  play.mover.release('up');
  run(play, BOARD_TIMING.stepMs);
  let { options } = play.frame(0, {});
  assert.equal(options.gemShots.length, 1, 'on its way to the Gate');
  assert.ok(options.gemShots[0].along < 1, 'and part way there');
  assert.deepEqual(options.gemShots[0].to, at(5, 2));

  run(play, 280);
  ({ options } = play.frame(0, {}));
  assert.equal(options.gemShots.length, 0, 'arrived');
  assert.ok(options.gateShake, 'the Gate rattles');
  assert.equal(options.pulses.length, 3, 'and it was the last Gem, so it pulses three times');
});

test('a Gem that isn\'t the last one pulses the Gate once, and the Gate stays shut', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 5, 8), obj('GemGate', 5, 2), obj('Gem', 5, 7), obj('Gem', 8, 8)] } });
  play.mover.press('up');
  play.mover.release('up');
  run(play, BOARD_TIMING.stepMs + 280);
  let { options } = play.frame(0, {});
  assert.equal(options.pulses.length, 1, 'a single ring');
  assert.equal(play.game.objects.find(object => object.kind === 'GemGate').open, false, 'still shut');
});

test('a Gem turns on the spot, so a board with one on it is never still', () => {
  let play = createBoardPlay({ puzzle: { objects: [obj('Start', 5, 8), obj('Gem', 2, 2)] } });
  let first = play.frame(0, {}).key;
  run(play, 200);
  assert.notEqual(play.frame(0, {}).key, first, 'the picture changes with the Gem');
  assert.ok(play.frame(0, {}).options.gemPhase >= 0, 'drawn at some point in its turn');
});

test('a warp puts the ship at the Warp Out Square and flashes the board white for 200 ms', () => {
  const WARP_WISP = { id: 'warp-wisp', name: 'Warp Wisp', parts: [{ kind: 'Sequence', moves: ['Right'] }, { kind: 'Warp' }] };
  let play = createBoardPlay({
    puzzle: { archetons: [WARP_WISP], objects: [obj('Start', 5, 8), obj('Archeton', 5, 7, { archeton: 'warp-wisp', letter: 'A' }), obj('WarpOut', 2, 2, { letter: 'A' })] },
  });
  play.mover.press('up');
  play.mover.release('up');
  run(play, BOARD_TIMING.stepMs);
  let { options } = play.frame(0, {});
  assert.deepEqual(play.mover.cell, at(2, 2), 'the ship is at the Warp Out Square');
  assert.ok(options.warpFlash > 0, 'and the board is washed out white');

  run(play, 220);
  assert.equal(play.frame(0, {}).options.warpFlash, 0, 'and the flash is over');
});

test('a Warp Wisp drifts on the spot, so a board with one on it is never still', () => {
  const WARP_WISP = { id: 'warp-wisp', name: 'Warp Wisp', parts: [{ kind: 'Sequence', moves: ['Right'] }, { kind: 'Warp' }] };
  let play = createBoardPlay({
    puzzle: { archetons: [WARP_WISP], objects: [obj('Start', 5, 8), obj('Archeton', 5, 5, { archeton: 'warp-wisp', letter: 'A' })] },
  });
  let first = play.frame(0, {});
  run(play, 120);
  let later = play.frame(0, {});
  assert.notEqual(later.options.wispDrift, first.options.wispDrift, 'it has moved on');
  assert.notEqual(later.key, first.key, 'so the board redraws itself');
});

test('a Pulse Tile counts down on the ship\'s own steps and not on the ones a Stream takes for it', () => {
  let charges = [];
  let play = createBoardPlay({ puzzle: { objects: [
    obj('Start', 1, 5),
    obj('LanternPulse', 2, 5, { steps: 3 }),
    obj('Stream', 2, 5, { direction: 'Right' }),
    obj('Stream', 3, 5, { direction: 'Right' }),
  ] }, hooks: { onEvent: () => charges.push(tile().charge) } });
  const tile = () => play.game.objects.find((o) => o.kind === 'LanternPulse');
  play.mover.press('right');
  play.mover.release('right');
  run(play, BOARD_TIMING.stepMs + 30);
  assert.deepEqual(charges, [3], 'the step onto it is free');
  run(play, BOARD_TIMING.stepMs * 2 + 60);
  assert.notDeepEqual(play.mover.cell, at(2, 5), 'the Stream carried it on');
  assert.equal(tile().charge, 3, 'a carried step spends nothing');
});

test('what a Pulse Tile stops lighting fades out over PULSE_FADE_MS', () => {
  let play = createBoardPlay({ puzzle: { objects: [
    obj('Start', 1, 5),
    obj('LanternPulse', 2, 5, { steps: 1 }),
    obj('Wall', 2, 6, { invisible: true }),
  ] } });
  play.mover.press('right');
  play.mover.release('right');
  run(play, BOARD_TIMING.stepMs + 30);
  play.mover.press('left');
  play.mover.release('left');
  run(play, BOARD_TIMING.stepMs + 30);          // spent: the Wall starts fading
  let fading = play.frame(0, {}).list.find((o) => o.kind === 'Wall');
  assert.ok(fading && fading.fade > 0 && fading.fade < 1, `fading, not gone: ${fading?.fade}`);
  run(play, 400);
  let gone = play.frame(0, {}).list.find((o) => o.kind === 'Wall');
  // It stays on the board - an unrevealed object is simply not drawn - so what has ended is its fade.
  assert.equal(gone?.fade, undefined, 'and then it is fading no more, and the renderer leaves it out');
});

const GUARD = { id: 'resonant-guard', name: 'Resonant Guard', parts: [{ kind: 'Detect', range: 1 }, { kind: 'Shove', distance: 3 }, { kind: 'Resonance' }] };

test('a guard that catches the ship is drawn lunging into its square', () => {
  let play = createBoardPlay({ puzzle: { archetons: [GUARD], objects: [
    obj('Start', 5, 7),
    obj('Archeton', 5, 5, { archeton: 'resonant-guard', direction: 'Down' }),
  ] } });
  play.mover.press('up');
  play.mover.release('up');
  run(play, BOARD_TIMING.stepMs + 20);
  let lunging = play.frame(0, {}).list.find((o) => o.kind === 'Archeton');
  // The guard is shoved from, so it leans down into the square the ship was in - see puzzleRules.js's wayFrom.
  assert.ok(lunging.lungeY > 0, `lunging into the ship's square: ${lunging.lungeY}`);
});

test('a guard that resonates is drawn shaking and sinking, then is not drawn at all', () => {
  let play = createBoardPlay({ puzzle: { archetons: [GUARD], objects: [
    obj('Start', 8, 9),
    obj('LanternPulse', 9, 9, { steps: 2 }),
    obj('Archeton', 5, 5, { archeton: 'resonant-guard', direction: 'Down' }),
  ] } });
  play.mover.press('right');
  play.mover.release('right');
  run(play, BOARD_TIMING.stepMs + 20);          // stepping on the only Pulse Tile lights it: the guard gives way
  let shaking = play.frame(0, {}).list.find((o) => o.kind === 'Archeton');
  assert.ok(shaking, 'still drawn while it shakes');
  assert.equal(shaking.sink, 0, 'and not sinking yet');
  run(play, 1200);
  let sinking = play.frame(0, {}).list.find((o) => o.kind === 'Archeton');
  assert.ok(sinking && sinking.sink > 0 && sinking.sink < 1, `sinking: ${sinking?.sink}`);
  run(play, 400);
  assert.equal(play.frame(0, {}).list.some((o) => o.kind === 'Archeton'), false, 'and gone once it has sunk');
});

test('a guard\'s shove throws the ship back without turning it round', () => {
  const GUARD = { id: 'resonant-guard', name: 'Resonant Guard', parts: [{ kind: 'Detect', range: 1 }, { kind: 'Shove', distance: 3 }, { kind: 'Resonance' }] };
  let play = createBoardPlay({ puzzle: { objects: [
    obj('Start', 5, 7),
    obj('Archeton', 5, 5, { archeton: 'resonant-guard', direction: 'Down' }),
  ], archetons: [GUARD] } });
  play.mover.press('up');
  play.mover.release('up');
  run(play, BOARD_TIMING.stepMs + 20);          // caught on (5,6)
  run(play, BOARD_TIMING.stepMs * 3 + 60);      // and shoved 3 squares back down
  assert.deepEqual(play.mover.cell, at(5, 9));
  assert.equal(play.mover.facing, 'up', 'it slid back without turning round');
});
