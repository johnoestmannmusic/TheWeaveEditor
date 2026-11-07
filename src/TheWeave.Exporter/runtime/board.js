// board.js
// John Oestmann
// A puzzle board being played, as both the exported site's Track Focus (main.js) and the Editor's playtest
// (puzzlePlaytest.js) play it: the rules (puzzle.js's createPuzzleGame), the ship's movement (sokoban.js's mover),
// and everything that happens over time - Streams and Rotator tiles ticking, Pipes turning, jumps, blocks sinking,
// a Reset Switch's sweep, a Lantern's pulse, blocks returning from a closing Gate - and what to draw each frame.
// Knows nothing about the page: each caller draws the board, the ship and anything else of its own.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated into every exported
// site's jsx/board.js, and linked into the Editor, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./puzzle.js'), require('./sokoban.js'));
  else root.WeaveBoard = factory(root.WeavePuzzle, root.WeaveSokoban);
})(this, function (WeavePuzzle, WeaveSokoban) {

  const TIMING = WeavePuzzle.BOARD_TIMING;
  const TILE_PX = WeavePuzzle.TILE_PX;
  // How long one cycle of each animation takes, as puzzle.js's renderBoard has them, for telling when a frame would
  // look any different from the last - see frame.
  const STREAM_CYCLE_MS = 900;
  const ROTATOR_CYCLE_MS = 1000;
  const FINISH_ARROW_CYCLE_MS = 1200;

  // The ship starts out facing into the board, away from whichever edge it starts on: up from the bottom edge, and
  // so on. Up anywhere else, or in a corner.
  function facingInwards(cell){
    let edge = WeavePuzzle.exitDirectionOf(cell);
    return { Up: 'down', Down: 'up', Left: 'right', Right: 'left' }[edge] ?? 'up';
  }

  // One playthrough of a puzzle. game is a board to carry on from as it was left, cell where to put the ship on it
  // (or on a fresh one), and facing which way it faces, if not inwards. hooks are told what's happened, for the
  // caller to act on: onEvent(event) after the board itself has, onJump(from, to) and onLanded(cell) around a jump,
  // and onBlocked(cell, direction) as sokoban.js's mover has it.
  function createBoardPlay({ puzzle, game = null, cell = null, facing = null, hooks = {} }){
    game ??= puzzle ? WeavePuzzle.createPuzzleGame(puzzle) : null;
    let startCell = cell ?? (game ? game.start : WeavePuzzle.DEFAULT_START);
    if (cell && game) game.placeShip(cell);

    let play = {
      game,
      mover: null,
      finished: false,
      jump: null, // { from, to, ms, durationMs } while the ship's in the air
      reset: null, // { before, ms, durationMs } while a Reset Switch's sweep crosses the board
      streamMs: 0,
      rotatorActiveMs: 0,
      rotatorGlideMs: TIMING.rotatorTickMs,
      rotatorClockMs: 0,
      pipeActiveMs: 0,
      pipeTurnMs: null,
      returnMs: null,
      slideMs: null, // how long ago Slide Bugs last slid, for their glide
      sinking: [],
      pulses: [],
    };

    // A Stream carries the ship along, whatever's being pressed, and an Archeton's laser can push or send it back.
    function carry(){
      if (!game || play.finished || play.jump) return;
      let direction = game.carryDirection(play.mover.cell);
      if (direction) play.mover.queue(direction);
    }

    // Acts on what puzzle.js says just happened, then tells the caller.
    function onEvent(event){
      if (!event) return;
      if (event.teleportTo) play.mover.teleport(event.teleportTo);
      // Push Blocks that matched sink together, once whichever of them is moving has finished gliding into place.
      let glideOf = (object) => {
        if (object.fromCol === undefined || (object.fromCol === object.col && object.fromRow === object.row)) return 0;
        return object.glide === 'push' ? TIMING.stepMs : object.glide === 'rotator' ? TIMING.rotatorTickMs : TIMING.streamTickMs;
      };
      let glideMs = Math.max(0, ...(event.sank ?? []).map(glideOf));
      for (const object of event.sank ?? []) play.sinking.push({ object, ms: 0, glideMs });
      if (event.jumpTo) {
        let from = play.mover.cell;
        let squares = Math.abs(event.jumpTo.col - from.col) + Math.abs(event.jumpTo.row - from.row);
        play.mover.releaseAll();
        play.jump = { from, to: event.jumpTo, ms: 0, durationMs: squares * TIMING.jumpMsPerSquare };
        hooks.onJump?.(from, event.jumpTo);
      }
      if (event.returned) play.returnMs = 0;
      if (event.slid) play.slideMs = 0;
      if (event.lit) play.pulses.push({ ...event.lit, ms: 0, revealed: event.revealed ?? [] });
      if (event.pipesTurned) {
        play.pipeTurnMs = 0;
        play.pipeActiveMs = 0;
      }
      // Everything put back by a Reset Switch: whatever was sinking is back too, so it stops.
      if (event.reset) {
        play.sinking = [];
        play.reset = { before: event.reset, ms: 0, durationMs: WeavePuzzle.resetSweepMs(event.reset, game.objects) };
      }
      if (event.finished) {
        play.finished = true;
        play.mover.releaseAll();
      }
      hooks.onEvent?.(event);
    }

    play.mover = WeaveSokoban.createMover(
      WeaveSokoban.createGrid({ columns: WeavePuzzle.BOARD_SIZE, rows: WeavePuzzle.BOARD_SIZE, cellWidth: TILE_PX, cellHeight: TILE_PX }),
      {
        cell: startCell,
        stepMs: TIMING.stepMs,
        facing: facing ?? facingInwards(startCell),
        canEnter: game ? game.canEnter : undefined,
        onArrive: game ? (arrived) => {
          game.settlePushes();
          onEvent(game.shipArrivedAt(arrived));
          carry();
        } : undefined,
        // Walking into a Push Block pushes it on ahead, as the step begins.
        onStepStart: game ? (from, to, direction) => onEvent(game.pushFrom(from, to, direction)) : undefined,
        onBlocked: (blockedCell, direction) => hooks.onBlocked?.(blockedCell, direction),
      }
    );

    // What carries on whatever else is happening: blocks sinking, pulses spreading, Pipes swinging round, blocks
    // returning from a Gate.
    play.animate = (dtMs) => {
      for (const sinking of play.sinking) sinking.ms += dtMs;
      play.sinking = play.sinking.filter(sinking => sinking.ms < sinking.glideMs + TIMING.sinkMs);
      for (const pulse of play.pulses) pulse.ms += dtMs;
      play.pulses = play.pulses.filter(pulse => pulse.ms < TIMING.pulseMs);
      if (play.pipeTurnMs !== null) play.pipeTurnMs += dtMs;
      if (play.returnMs !== null) play.returnMs += dtMs;
      if (play.slideMs !== null) play.slideMs += dtMs;
    };

    // The board being played: the ship moving, and everything that moves by itself. Nothing else moves while the
    // ship's in the air, or while a Reset Switch's sweep crosses the board, so that everything's back in place, and
    // seen to be, before the ship can carry on. Nothing moves at all once it's finished.
    play.step = (dtMs) => {
      if (play.jump) {
        play.jump.ms += dtMs;
        if (play.jump.ms < play.jump.durationMs) return;
        let { to } = play.jump;
        play.jump = null;
        play.mover.teleport(to);
        hooks.onLanded?.(to);
        onEvent(game.shipArrivedAt(to, { jumped: true }));
        carry();
        return;
      }
      if (play.reset) {
        play.reset.ms += dtMs;
        if (play.reset.ms >= play.reset.durationMs) play.reset = null;
        return;
      }
      if (play.finished || !game) return;

      play.mover.update(dtMs);
      if (play.finished) return;
      // For a ship that's come to rest on a Stream: pushing against something, say, or after a restart. Reaching
      // one on the way is handled as it arrives, so that it never pauses.
      if (!play.mover.isMoving) carry();

      play.streamMs += dtMs;
      while (play.streamMs >= TIMING.streamTickMs && !play.finished) {
        play.streamMs -= TIMING.streamTickMs;
        onEvent(game.tick(play.mover.isMoving ? play.mover.cell : null));
      }

      // Rotator tiles only move while the ship is stopped on their Switch, once it's been there a whole tick. A move
      // underway when it leaves still finishes.
      play.rotatorGlideMs = Math.min(TIMING.rotatorTickMs, play.rotatorGlideMs + dtMs);
      if (play.mover.isMoving || !game.onRotatorSwitch) {
        play.rotatorActiveMs = 0;
      } else {
        play.rotatorActiveMs += dtMs;
        play.rotatorClockMs += dtMs;
        if (play.rotatorActiveMs >= TIMING.rotatorTickMs && !play.finished) {
          play.rotatorActiveMs -= TIMING.rotatorTickMs;
          play.rotatorGlideMs = 0;
          onEvent(game.tickRotators(null));
        }
      }

      // Pipes turn as the ship arrives on a Pipe Switch, then again each second it stays there.
      if (play.mover.isMoving || !game.onPipeSwitch) {
        play.pipeActiveMs = 0;
      } else {
        play.pipeActiveMs += dtMs;
        if (play.pipeActiveMs >= TIMING.pipeTickMs && !play.finished) onEvent(game.turnPipes());
      }
    };

    // Where the ship is drawn: gliding between squares, or in a jump, a straight line from where it left to where it
    // lands, with how far through the jump it is (t), for a caller that arcs it.
    play.shipPosition = () => {
      if (!play.jump) return { ...play.mover.position, t: null };
      let t = Math.min(1, play.jump.ms / play.jump.durationMs);
      let centre = (c) => ({ x: (c.col + 0.5) * TILE_PX, y: (c.row + 0.5) * TILE_PX });
      let from = centre(play.jump.from), to = centre(play.jump.to);
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, t };
    };

    // Everything to draw this frame, and the options to draw it with (see puzzle.js's renderBoard), plus a key that
    // only changes when the picture would - so a caller can skip drawing a board that looks just as it did. extra
    // is any options of the caller's own, like a push hint, which go into the key too.
    play.frame = (timeMs, extra = {}) => {
      let objects = play.reset ? WeavePuzzle.resetSweepAt(play.reset.before, game.objects, play.reset.ms) : game.objects;
      let floors = game.floors;
      let mover = play.mover;
      let key = [game.version, mover.isMoving ? Math.round(mover.progress * TILE_PX) : -1, mover.cell.col, mover.cell.row];

      // Each sinking block finishes its glide first, from wherever it was gliding from, then sinks into its square.
      let sinking = play.sinking.map(({ object, ms, glideMs }) => {
        let glided = glideMs === 0 ? 1 : Math.min(1, ms / glideMs);
        let fromCol = object.fromCol ?? object.col, fromRow = object.fromRow ?? object.row;
        let sink = Math.max(0, Math.min(1, (ms - glideMs) / TIMING.sinkMs));
        key.push(Math.round(glided * TILE_PX), Math.round(sink * TILE_PX));
        return { ...object, col: fromCol + (object.col - fromCol) * glided, row: fromRow + (object.row - fromRow) * glided, fromCol: undefined, fromRow: undefined, sink };
      });
      if (play.reset) key.push('r', Math.round(play.reset.ms / 10));

      // The Rotator Switch the ship's standing on turns clockwise, for as long as the Rotator tiles are moving.
      if (game.onRotatorSwitch && !mover.isMoving) {
        let at = mover.cell;
        let spin = WeavePuzzle.spinAt(play.rotatorClockMs);
        key.push('s', spin);
        objects = objects.map(object => object.kind === 'RotatorSwitch' && object.col === at.col && object.row === at.row ? { ...object, spin } : object);
      }
      // Pipes that have just turned swing round anticlockwise into place.
      if (play.pipeTurnMs !== null && play.pipeTurnMs < TIMING.pipeTurnMs) {
        let spin = Math.round((1 - play.pipeTurnMs / TIMING.pipeTurnMs) * WeavePuzzle.SPIN_STEPS / 4);
        key.push('p', spin);
        floors = floors.map(floor => floor.kind === 'Pipe' && spin > 0 ? { ...floor, spin } : floor);
      }
      // Whatever a Lantern's pulse hasn't reached yet stays hidden until it does.
      let pulses = play.pulses.map(pulse => ({ col: pulse.col, row: pulse.row, radius: pulse.ms / TIMING.pulseMs * WeavePuzzle.PULSE_REACH_PX }));
      let unreached = new Set();
      play.pulses.forEach((pulse, i) => {
        key.push('l', Math.round(pulses[i].radius));
        for (const thing of pulse.revealed) {
          if (Math.hypot(thing.col - pulse.col, thing.row - pulse.row) * TILE_PX > pulses[i].radius) unreached.add(thing);
        }
      });
      let hideUnreached = (list) => unreached.size === 0 ? list : list.map(thing => unreached.has(thing) ? { ...thing, revealed: false } : thing);
      floors = hideUnreached(floors);
      objects = hideUnreached(objects);

      let options = {
        timeMs,
        rotatorTimeMs: play.rotatorClockMs,
        switchesActive: game.switchesActive,
        along: play.streamMs / TIMING.streamTickMs,
        rotatorAlong: play.rotatorGlideMs / TIMING.rotatorTickMs,
        pushAlong: mover.progress,
        returnAlong: play.returnMs === null ? 1 : Math.min(1, play.returnMs / TIMING.stepMs),
        slideAlong: play.slideMs === null ? 1 : Math.min(1, play.slideMs / TIMING.stepMs),
        pulses,
        beams: game.beams,
        reaches: game.reaches,
        ...extra,
      };

      // Only what's actually moving or animating goes into the key: anything gliding, in whole pixels, and the
      // phase of any animation the board has.
      let gliding = (glide) => game.objects.some(o => o.glide === glide && o.fromCol !== undefined && (o.fromCol !== o.col || o.fromRow !== o.row));
      for (const [glide, along] of [['stream', options.along], ['rotator', options.rotatorAlong], ['push', options.pushAlong], ['return', options.returnAlong], ['slide', options.slideAlong]]) {
        if (gliding(glide)) key.push(glide, Math.round(Math.min(1, along) * TILE_PX));
      }
      let phase = (ms, cycle) => Math.floor((((ms ?? 0) % cycle) / cycle) * TILE_PX);
      if (floors.some(f => f.kind === 'Stream')) key.push('S', phase(timeMs, STREAM_CYCLE_MS));
      if (floors.some(f => f.kind === 'RotatorTile')) key.push('R', phase(play.rotatorClockMs, ROTATOR_CYCLE_MS));
      if (game.objects.some(o => o.kind === 'Finish' && WeavePuzzle.exitDirectionOf(o))) key.push('F', phase(timeMs, FINISH_ARROW_CYCLE_MS) % 8);
      if (extra.pushHint) key.push('h', extra.pushHint.col, extra.pushHint.row, extra.pushHint.direction, extra.pushHint.bob);

      return { list: [...floors, ...objects, ...sinking], options, key: key.join(',') };
    };

    return play;
  }

  return { createBoardPlay, facingInwards };
});
