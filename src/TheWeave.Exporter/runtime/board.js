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
  // How long going from one Teleporter to the other takes: a moment, and a little more for each square it crosses.
  const TELEPORT_MS = 220;
  const TELEPORT_MS_PER_SQUARE = 30;
  const TILE_PX = WeavePuzzle.TILE_PX;
  // How long one cycle of each animation takes, as puzzle.js's renderBoard has them, for telling when a frame would
  // look any different from the last - see frame.
  // How long whatever blocked a step on the reflection's side flashes on the ship's side of the pane.
  const REFUSED_FLASH_MS = 520;
  const STREAM_CYCLE_MS = 900;
  const ROTATOR_CYCLE_MS = 1000;
  const FINISH_ARROW_CYCLE_MS = 1200;
  // A collected Gem's flight to the Gate, how long the Gate rattles for once it's hit, and how long one turn of a Gem
  // on the spot takes.
  const GEM_SHOT_MS = 260;
  const GEM_SHAKE_MS = 240;
  const GEM_SPIN_CYCLE_MS = 1400;
  // How long a Warp Wisp's white flash washes the board out for.
  const WARP_FLASH_MS = 200;
  // A guard's shove: it lunges into the ship's square and back, over SHOVE_MS, as far as SHOVE_LUNGE of the way.
  const SHOVE_MS = 400;
  const SHOVE_LUNGE = 0.6;
  // How long a guard with a Resonance part shakes before it starts sinking into the ground, and then how long that
  // takes - the same sink a matched block does. It shakes for the same second each time a Pulse Tile lights, and harder
  // the more of them are lit, up to RESONANCE_SHAKE_MAX_PX - see puzzleRules.js's resonanceShake.
  const RESONANCE_SHAKE_MS = 1000;
  const RESONANCE_SHAKE_MAX_PX = 4;
  // The red a dying guard and the Pulse Tiles that killed it are washed in, and how much of it they take: the board
  // saying they are one thing, so red rather than a palette colour is deliberate - it reads the same whatever the album
  // art is, as the Gate Beam's yellow does.
  const RESONANCE_RED = { r: 214, g: 44, b: 38 };
  const RESONANCE_TINT = 0.75;
  // How slowly a Warp Wisp drifts up and down about its square, in how many steps of the drift - a step every 100 ms,
  // so the drift is gentle rather than a shimmer.
  const WISP_DRIFT_CYCLE_MS = 2600;
  const WISP_DRIFT_STEPS = 26;
  // A Gem's turn is drawn in steps, so that the sprites it goes through are a handful rather than one a frame.
  const GEM_SPIN_STEPS = 16;
  // How many turns a pulse made of three is: the last Gem in opens the Gate with a burst rather than a single ring.
  const GEM_PULSE_COUNT = 3;
  const GEM_PULSE_GAP_MS = 90;

  // The ship starts out facing into the board, away from whichever edge it starts on: up from the bottom edge, and
  // so on. Up anywhere else, or in a corner.
  function facingInwards(cell){
    let edge = WeavePuzzle.exitDirectionOf(cell);
    return { Up: 'down', Down: 'up', Left: 'right', Right: 'left' }[edge] ?? 'up';
  }

  // One playthrough of a puzzle. game is a board to carry on from as it was left, cell where to put the ship on it
  // (or on a fresh one), and facing which way it faces, if not inwards. hooks are told what's happened, for the
  // caller to act on: onEvent(event) after the board itself has, onJump(from, to) and onLanded(cell) around a jump,
  // onTeleport(from, to) and onTeleported(cell) around a teleport,
  // and onBlocked(from, to, direction) as sokoban.js's mover has it.
  function createBoardPlay({ puzzle, game = null, cell = null, facing = null, hooks = {} }){
    game ??= puzzle ? WeavePuzzle.createPuzzleGame(puzzle) : null;
    // The Archetons that feel a Pulse Tile light: the ones whose definition has a Resonance part, by id.
    let resonantIds = new Set((puzzle?.archetons ?? [])
      .filter(definition => (definition.parts ?? []).some(part => part.kind === 'Resonance'))
      .map(definition => definition.id));

    let startCell = cell ?? (game ? game.start : WeavePuzzle.DEFAULT_START);
    if (cell && game) game.placeShip(cell);

    let play = {
      game,
      mover: null,
      finished: false,
      jump: null, // { from, to, ms, durationMs } while the ship's in the air
      dropping: false, // whether the step underway is a drop off a ledge, drawn as a small jump - see shipPosition
      teleport: null, // { from, to, ms, durationMs } while it's going from one Teleporter to the other
      reset: null, // { before, ms, durationMs } while a Reset Switch's sweep crosses the board
      streamMs: 0,
      rotatorActiveMs: 0,
      rotatorGlideMs: TIMING.rotatorTickMs,
      rotatorClockMs: 0,
      pipeActiveMs: 0,
      pipeTurnMs: null,
      returnMs: null,
      slideMs: null, // how long ago Slide Bugs last slid, for their glide
      swimMs: null, // how long ago Swim Fish last swam, for theirs
      // { col, row, object, ms } while a step is being refused because of something on the reflection's side - a Wall, a
      // shut Gate, an Archeton, a Push Block that wouldn't move: it's drawn on the square the ship tried to walk into, so
      // it's plain where the space is taken - see the renderers and puzzleRules.js's reflectionObstacleInTheWay.
      refusedFlash: null,
      hopMs: null, // how long ago Archetons with a Move Sequence last hopped
      sinking: [],
      hidings: [], // { object, ms } for each thing a Pulse Tile let go of, for its fade out
      dissolving: [], // { object, ms } for each guard that resonated, shaking itself apart
      shove: null, // { from, direction, ms } while a guard lunges and the ship slides away
      resonantMs: null, // how long a guard has been shaking because a Pulse Tile lit, for its rattle
      resonantAmplitude: 1, // how far it shakes, which is harder the more tiles are lit - see RESONANCE_SHAKE_MAX_PX
      pulses: [],
      gateBeams: [], // a Gate Switch's Beams, for as long as they're drawn - see advanceGateBeams
      gemShots: [], // { from, to, ms, last } while a collected Gem is on its way to the Gem Gate
      gemShakeMs: null, // how long ago the Gem Gate was last hit, for its rattle
      gemClockMs: 0, // how long a Gem has been turning on the spot, for its spin
      wispClockMs: 0, // how long a Warp Wisp has been drifting up and down for
      warpFlashMs: null, // how long ago the ship was warped, for the board's white flash
    };

    // A Stream carries the ship along, whatever's being pressed, and an Archeton's laser can push or send it back. A
    // guard's shove is taken without turning the ship: it is thrown back the way it was going, and turning it round to
    // face its own slide reads as it running rather than being shoved - see puzzleRules.js's shoving.
    function carry(){
      if (!game || play.finished || play.jump || play.teleport) return;
      let direction = game.carryDirection(play.mover.cell);
      if (direction) play.mover.queue(direction, { turn: !game.shoving });
    }

    // Acts on what puzzle.js says just happened, then tells the caller.
    function onEvent(event){
      if (!event) return;
      // Stepping onto a Teleporter sends the ship across to the other, spinning and fading as it goes, so it can be
      // followed with the eye - see shipPosition. It only gets there once that's done.
      if (event.teleportTo) {
        let from = play.mover.cell;
        let squares = Math.abs(event.teleportTo.col - from.col) + Math.abs(event.teleportTo.row - from.row);
        play.mover.releaseAll();
        play.teleport = { from, to: event.teleportTo, ms: 0, durationMs: TELEPORT_MS + squares * TELEPORT_MS_PER_SQUARE };
        hooks.onTeleport?.(from, event.teleportTo);
      }
      // A warp is instant: the ship is simply there, with the board flashing white to show it went. Nothing is walked
      // through, so there's no travelling to draw - see renderBoard's warpFlash.
      if (event.warpedTo) {
        play.mover.releaseAll();
        play.mover.teleport(event.warpedTo);
        play.warpFlashMs = 0;
        hooks.onWarp?.(event.warpedTo);
        carry();
      }
      // The crane set the ship down: it is simply there, as a Teleporter's pair would have it.
      if (event.cranedTo && event.ship) {
        play.mover.releaseAll();
        play.mover.teleport(event.cranedTo);
      }
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
      if (event.swam) play.swimMs = 0;
      if (event.hopped) play.hopMs = 0;
      if (event.lit) play.pulses.push({ ...event.lit, ms: 0, revealed: event.revealed ?? [] });
      // Only what's invisible is drawn differently for being unseen, so only that can fade: anything else is on the
      // board either way, and a Pulse Tile is the light rather than one of the things it lights.
      if (event.hid) for (const object of event.hid) if (object.invisible) play.hidings.push({ object, ms: 0 });
      // A Pulse Tile lighting is felt by every guard with a Resonance part: it rattles, harder the more are lit.
      if (event.resonance) {
        play.resonantMs = 0;
        play.resonantAmplitude = Math.min(RESONANCE_SHAKE_MAX_PX, Math.max(1, event.resonance.active));
      }
      if (event.shove) play.shove = { ...event.shove, ms: 0 };
      if (event.dissolved) for (const object of event.dissolved) play.dissolving.push({ object, ms: 0 });
      if (event.gateBeam) play.gateBeams.push({ ...event.gateBeam, ms: 0 });
      // A Gem that has somewhere to go flies there; one collected with no Gem Gate on the board just goes.
      if (event.gem?.to) play.gemShots.push({ from: { col: event.gem.col, row: event.gem.row }, to: event.gem.to, ms: 0, last: event.gem.last });
      if (event.pipesTurned) {
        play.pipeTurnMs = 0;
        play.pipeActiveMs = 0;
      }
      // Everything put back by a Reset Switch: whatever was sinking is back too, so it stops.
      if (event.reset) {
        play.sinking = [];
        play.hidings = [];
        play.dissolving = [];
        play.shove = null;
        play.resonantMs = null;
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
          play.dropping = false;
          game.settlePushes();
          onEvent(game.shipArrivedAt(arrived, { forced: play.mover.stepForced }));
          carry();
        } : undefined,
        // Walking into a Push Block pushes it on ahead, as the step begins - and so does a reflection, so that its block
        // glides along with the ship rather than jumping once the step is over.
        onStepStart: game ? (from, to, direction) => {
          // Stepping off a ledge drops the ship down it, which is drawn as a small jump - see shipPosition.
          play.dropping = game.dropsOffEdge(from, to);
          onEvent(game.pushFrom(from, to, direction));
          onEvent(game.pushForReflections(direction));
        } : undefined,
        onBlocked: (from, to, direction) => {
          // A step refused because a reflection couldn't follow leaves whatever stopped it flashing on the ship's side of
          // the pane, on the square it tried to walk into.
          let refused = game && to ? game.reflectionObstacleInTheWay(from, to, direction) : null;
          // Pressing on into the same thing flashes once and fades, rather than being started again every frame it's held.
          let flashing = play.refusedFlash;
          let sameReason = flashing && flashing.col === to?.col && flashing.row === to?.row && flashing.object === refused?.object;
          if (refused && !sameReason) play.refusedFlash = { col: to.col, row: to.row, object: refused.object, ms: 0, durationMs: REFUSED_FLASH_MS };
          hooks.onBlocked?.(from, to, direction);
        },
      }
    );

    // Whether every claw has what it took properly on the square, and can get on with it. A block pushed onto a Crane
    // is still gliding there with the ship, and one a Stream is carrying still riding that tick, so the claw waits for
    // the picture to say the thing has landed - these are the same alongs frame draws by. The ship is always on its
    // square by then: a claw only takes it as it arrives.
    play.loadsSettled = () => {
      let alongNow = (object) => {
        if (!object || object.fromCol === undefined) return 1;
        if (object.fromCol === object.col && object.fromRow === object.row) return 1;
        if (object.glide === 'push') return play.mover.progress;
        if (object.glide === 'rotator') return play.rotatorGlideMs / TIMING.rotatorTickMs;
        if (object.glide === 'return') return play.returnMs === null ? 1 : play.returnMs / TIMING.stepMs;
        if (object.glide === 'slide') return play.slideMs === null ? 1 : play.slideMs / TIMING.stepMs;
        if (object.glide === 'hop') return play.hopMs === null ? 1 : play.hopMs / TIMING.stepMs;
        if (object.glide === 'swim') return play.swimMs === null ? 1 : play.swimMs / TIMING.stepMs;
        return play.streamMs / TIMING.streamTickMs;
      };
      return (game?.cranes ?? []).every(crane => crane.ship || alongNow(crane.thing) >= 1);
    };

    // What carries on whatever else is happening: blocks sinking, pulses spreading, Pipes swinging round, blocks
    // returning from a Gate.
    play.animate = (dtMs) => {
      for (const sinking of play.sinking) sinking.ms += dtMs;
      play.sinking = play.sinking.filter(sinking => sinking.ms < sinking.glideMs + TIMING.sinkMs);
      for (const pulse of play.pulses) pulse.ms += dtMs;
      play.pulses = play.pulses.filter(pulse => pulse.ms < TIMING.pulseMs);
      // What a Pulse Tile let go of fades out where it was, and is dropped once it is quite gone - or the moment
      // something lights it again.
      for (const hiding of play.hidings) hiding.ms += dtMs;
      play.hidings = play.hidings.filter(hiding => hiding.ms < WeavePuzzle.PULSE_FADE_MS && !hiding.object.revealed);
      // A guard that resonated shakes itself apart, then sinks into the ground - see RESONANCE_SHAKE_MS and frame.
      for (const dying of play.dissolving) dying.ms += dtMs;
      play.dissolving = play.dissolving.filter(dying => dying.ms < RESONANCE_SHAKE_MS + TIMING.sinkMs);
      if (play.shove) {
        play.shove.ms += dtMs;
        if (play.shove.ms >= SHOVE_MS) play.shove = null;
      }
      if (play.resonantMs !== null) {
        play.resonantMs += dtMs;
        if (play.resonantMs >= RESONANCE_SHAKE_MS) play.resonantMs = null;
      }
      for (const beam of play.gateBeams) beam.ms += dtMs;
      play.gateBeams = play.gateBeams.filter(beam => beam.ms < TIMING.gateBeamMs);
      // A Beam that's reached its Gates changes them, which is when the press finally takes effect - see
      // puzzleRules.js's advanceGateBeams.
      for (const event of game?.advanceGateBeams(dtMs) ?? []) onEvent(event);
      // A Crane's claw steps on whatever else is happening, and sets down what it holds half way through - the board is
      // held still meanwhile, see play.step, and the claw waits for what it has taken to be on the square, see
      // play.loadsSettled.
      for (const event of play.loadsSettled() ? game?.advanceCranes(dtMs) ?? [] : []) onEvent(event);
      if (play.pipeTurnMs !== null) play.pipeTurnMs += dtMs;
      if (play.returnMs !== null) play.returnMs += dtMs;
      if (play.slideMs !== null) play.slideMs += dtMs;
      if (play.swimMs !== null) play.swimMs += dtMs;
      if (play.hopMs !== null) play.hopMs += dtMs;
      play.gemClockMs += dtMs;
      play.wispClockMs += dtMs;
      if (play.gemShakeMs !== null) play.gemShakeMs += dtMs;
      if (play.warpFlashMs !== null) play.warpFlashMs += dtMs;
      for (const shot of play.gemShots) shot.ms += dtMs;
      // A Gem that's arrived rattles the Gate and sets off its pulse: one ring, or three when it was the last one, which
      // is the Gate opening - see puzzleRules.js's Gem case, which opens it as the Gem is collected.
      for (const shot of play.gemShots.filter(shot => shot.ms >= GEM_SHOT_MS)) {
        play.gemShakeMs = 0;
        for (let i = 0; i < (shot.last ? GEM_PULSE_COUNT : 1); i++) {
          play.pulses.push({ ...shot.to, ms: -i * GEM_PULSE_GAP_MS, revealed: [] });
        }
        hooks.onGemHit?.(shot.to);
      }
      play.gemShots = play.gemShots.filter(shot => shot.ms < GEM_SHOT_MS);
      if (play.refusedFlash) {
        play.refusedFlash.ms += dtMs;
        if (play.refusedFlash.ms >= play.refusedFlash.durationMs) play.refusedFlash = null;
      }
    };

    // The board being played: the ship moving, and everything that moves by itself. Nothing else moves while the
    // ship's in the air, or while a Reset Switch's sweep crosses the board, so that everything's back in place, and
    // seen to be, before the ship can carry on. Nothing moves at all once it's finished.
    play.step = (dtMs) => {
      if (play.teleport) {
        play.teleport.ms += dtMs;
        if (play.teleport.ms < play.teleport.durationMs) return;
        let { to } = play.teleport;
        play.teleport = null;
        play.mover.teleport(to);
        hooks.onTeleported?.(to);
        carry();
        return;
      }
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
      // A crane's claw holds the board still while it takes something up and sets it down - play.animate steps the
      // claws on - and onEvent puts the mover where the rules set the ship down. A claw that has only just taken hold
      // of something still on its way in doesn't hold the board yet: the step delivering it has to finish first.
      if (game?.cranes.length > 0 && play.loadsSettled()) return;
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

      // Rotator tiles only move while the ship is stopped on their Switch, once it's been there a whole tick - or
      // while a Warp Wisp is drifting over one, which keeps them moving with the ship anywhere, walking included.
      // A move underway when the Switch stops being held still finishes.
      play.rotatorGlideMs = Math.min(TIMING.rotatorTickMs, play.rotatorGlideMs + dtMs);
      if (!((!play.mover.isMoving && game.onRotatorSwitch) || game.wispOnRotatorSwitch)) {
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
    // lands, with how far through the jump it is (t), for a caller that arcs it. Stepping off a ledge is a jump too,
    // just a small one, so it comes back with a t of its own - see onStepStart.
    play.shipPosition = () => {
      // In a claw: lifted where it was, then set down where the claw put it, fading out and back in as it goes - see
      // puzzleRules.js's advanceCranes.
      let clawed = game?.cranes.find(crane => crane.ship) ?? null;
      if (clawed) {
        // The ship's own pose, not the claw's: it sits on its square while the claw comes down, and is only carried
        // while the claw has it.
        let pose = WeavePuzzle.craneLoad(clawed.from, clawed.to, clawed.ms);
        return {
          x: (pose.cell.col + 0.5) * TILE_PX,
          y: (pose.cell.row + 0.5) * TILE_PX - pose.lift * TILE_PX,
          t: null,
          spin: 0,
          opacity: pose.alpha,
        };
      }
      if (play.teleport) {
        let t = Math.min(1, play.teleport.ms / play.teleport.durationMs);
        let centre = (c) => ({ x: (c.col + 0.5) * TILE_PX, y: (c.row + 0.5) * TILE_PX });
        let from = centre(play.teleport.from), to = centre(play.teleport.to);
        // One whole turn on the way, and three-quarters see-through at its middle.
        return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, t: null, spin: t * Math.PI * 2, opacity: 1 - 0.75 * Math.sin(Math.PI * t) };
      }
      if (!play.jump) {
        let dropping = play.dropping && play.mover.isMoving;
        return { ...play.mover.position, t: dropping ? play.mover.progress : null, spin: 0, opacity: 1 };
      }
      let t = Math.min(1, play.jump.ms / play.jump.durationMs);
      let centre = (c) => ({ x: (c.col + 0.5) * TILE_PX, y: (c.row + 0.5) * TILE_PX });
      let from = centre(play.jump.from), to = centre(play.jump.to);
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, t, spin: 0, opacity: 1 };
    };

    // Whenever the ship's standing still next to a Push Block it could push, whichever way it's facing, an arrow on the
    // block's far side, bobbing, says it can be pushed that way - one for each such block. Not while the ship's in the
    // air, the board's being swept by a Reset, or it's finished.
    const PUSH_HINT_BOB_MS = 300;
    play.pushHints = (timeMs) => {
      if (!game || play.mover.isMoving || play.jump || play.teleport || play.reset || play.finished) return [];
      let bob = Math.floor(timeMs / PUSH_HINT_BOB_MS) % 2;
      let at = play.mover.cell;
      let hints = [];
      for (const [direction, way, dc, dr] of [['up', 'Up', 0, -1], ['down', 'Down', 0, 1], ['left', 'Left', -1, 0], ['right', 'Right', 1, 0]]) {
        let next = { col: at.col + dc, row: at.row + dr };
        if (game.canPush(next, direction)) hints.push({ ...next, direction: way, bob });
      }
      return hints;
    };

    // Everything to draw this frame, and the options to draw it with (see puzzle.js's renderBoard), plus a key that
    // only changes when the picture would - so a caller can skip drawing a board that looks just as it did. extra
    // is any options of the caller's own, like push hints, which go into the key too.
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
      // A Warp Wisp drifts on the spot all the while, so a board with one on it is never still either.
      let drifting = (puzzle?.archetons ?? []).some(definition => (definition.parts ?? []).some(part => part.kind === 'Warp')
        && game.objects.some(object => object.kind === 'Archeton' && object.archeton === definition.id));
      let wispStep = Math.floor(play.wispClockMs / (WISP_DRIFT_CYCLE_MS / WISP_DRIFT_STEPS)) % WISP_DRIFT_STEPS;
      if (drifting) key.push('d', wispStep);
      // A Gem turns on the spot all the while, so a board with one on it is never still.
      let gemStep = Math.floor(play.gemClockMs / (GEM_SPIN_CYCLE_MS / GEM_SPIN_STEPS)) % GEM_SPIN_STEPS;
      if (game.objects.some(object => object.kind === 'Gem')) key.push('g', gemStep);
      let gemShots = play.gemShots.map(shot => ({ from: shot.from, to: shot.to, along: Math.min(1, shot.ms / GEM_SHOT_MS) }));
      for (const shot of gemShots) key.push('m', Math.round(shot.along * TILE_PX));
      // Each claw is drawn over the square it is working on, held so far above it: both go in the key, the ship's
      // included, which has no object of its own to fade - see puzzleRules.js's cranePose.
      let cranes = (game.cranes ?? []).map(crane => WeavePuzzle.cranePose(crane.from, crane.to, crane.ms));
      for (const crane of cranes) key.push('n', crane.cell.col, crane.cell.row, Math.round(crane.lift * TILE_PX));
      // The Gate rattles when a Gem hits it, a pixel either side of itself, settling as it goes.
      let gate = play.gemShakeMs === null || play.gemShakeMs >= GEM_SHAKE_MS ? null : game.objects.find(object => object.kind === 'GemGate');
      let shake = gate ? { col: gate.col, row: gate.row, dx: Math.round(Math.sin(play.gemShakeMs / 18) * 2 * (1 - play.gemShakeMs / GEM_SHAKE_MS)) } : null;
      if (shake) key.push('k', shake.dx);
      // A warp's white flash, fading out over its WARP_FLASH_MS.
      let warpFlash = play.warpFlashMs === null || play.warpFlashMs >= WARP_FLASH_MS ? 0 : 1 - play.warpFlashMs / WARP_FLASH_MS;
      if (warpFlash > 0) key.push('w', Math.round(warpFlash * 10));

      // The fade of whatever a Pulse Tile stopped lighting, over PULSE_FADE_MS. In whole pixels, so the key only
      // changes when the picture would.
      let hiding = new Map();
      for (const entry of play.hidings) {
        let fade = 1 - Math.min(1, entry.ms / WeavePuzzle.PULSE_FADE_MS);
        if (fade <= 0) continue;
        key.push('f', Math.round(fade * TILE_PX));
        hiding.set(entry.object, fade);
      }
      let fadedBy = (list) => hiding.size === 0 ? list
        : list.map(thing => hiding.has(thing)
          // A thing a Pulse Tile has just let go of is unseen from the moment the rules say so, so it would be left out
          // of the picture at once and its fade be no fade at all: it's still drawn for as long as the fade lasts.
          ? { ...thing, revealed: true, fade: (thing.fade ?? 1) * hiding.get(thing) } : thing);

      let hideUnreached = (list) => unreached.size === 0 ? list : list.map(thing => unreached.has(thing) ? { ...thing, revealed: false } : thing);
      floors = fadedBy(hideUnreached(floors));
      objects = fadedBy(hideUnreached(objects));

      // Whatever a claw has grabbed is hauled up out of its square and faded, then comes down into the other one out
      // of the fade. It is still until it is grabbed and still again once it is set down - see craneLoad.
      for (const crane of game.cranes ?? []) {
        if (crane.ship) continue;
        let pose = WeavePuzzle.craneLoad(crane.from, crane.to, crane.ms);
        key.push('c', Math.round(pose.alpha * 10), Math.round(pose.lift * TILE_PX));
        objects = objects.map(object => object === crane.thing ? {
          ...object,
          fade: pose.alpha,
          lungeY: -Math.round(pose.lift * TILE_PX),
        } : object);
      }

      // A guard that has just caught the ship lunges into its square and back. It doesn't move on the board, so this
      // is entirely where it's drawn - see renderBoard's lungeX/lungeY.
      if (play.shove) {
        let reach = Math.round(Math.sin(Math.PI * Math.min(1, play.shove.ms / SHOVE_MS)) * TILE_PX * SHOVE_LUNGE);
        let delta = WeavePuzzle.DIRECTION_DELTAS[play.shove.direction];
        key.push('v', reach);
        objects = objects.map(object => object.kind === 'Archeton'
          && object.col === play.shove.from.col && object.row === play.shove.from.row
          ? { ...object, lungeX: delta.x * reach, lungeY: delta.y * reach } : object);
      }

      // A guard that has just felt a Pulse Tile light rattles where it stands, settling over its second, and harder
      // the more of them are lit - see puzzleRules.js's resonanceShake.
      if (play.resonantMs !== null) {
        let settle = 1 - (play.resonantMs / RESONANCE_SHAKE_MS) * 0.5;
        let shake = Math.round(Math.sin(play.resonantMs / 11) * play.resonantAmplitude * settle);
        key.push('y', shake);
        objects = objects.map(object => object.kind === 'Archeton' && resonantIds.has(object.archeton) ? { ...object, shake } : object);
      }

      // A guard's death takes the Pulse Tiles that killed it with it: for as long as it is going, they and it are washed
      // the same red, so that the link the rattle hinted at is plain at the end. See RESONANCE_RED.
      let deathTint = play.dissolving.length > 0 ? { color: RESONANCE_RED, amount: RESONANCE_TINT } : null;
      if (deathTint) {
        key.push('t', Math.round(RESONANCE_TINT * 10));
        objects = objects.map(object => object.kind === 'LanternPulse' ? { ...object, tint: deathTint } : object);
      }

      // A guard that resonated shakes where it stood, then sinks into the ground, shaking and fading as it goes - the
      // same sink a matched block does, over BOARD_TIMING.sinkMs, after RESONANCE_SHAKE_MS of shaking. The rules took it
      // off the board already, so it is drawn here rather than found in game.objects.
      let dissolving = play.dissolving.map(({ object, ms }) => {
        let sink = Math.max(0, Math.min(1, (ms - RESONANCE_SHAKE_MS) / TIMING.sinkMs));
        key.push('x', Math.round(ms / 10), Math.round(sink * TILE_PX));
        return { ...object, sink, fade: 1 - sink, shake: Math.round(Math.sin(ms / 12) * 2), ...(deathTint ? { tint: deathTint } : {}) };
      });

      let options = {
        timeMs,
        rotatorTimeMs: play.rotatorClockMs,
        switchesActive: game.switchesActive,
        along: play.streamMs / TIMING.streamTickMs,
        rotatorAlong: play.rotatorGlideMs / TIMING.rotatorTickMs,
        pushAlong: mover.progress,
        returnAlong: play.returnMs === null ? 1 : Math.min(1, play.returnMs / TIMING.stepMs),
        slideAlong: play.slideMs === null ? 1 : Math.min(1, play.slideMs / TIMING.stepMs),
        swimAlong: play.swimMs === null ? 1 : Math.min(1, play.swimMs / TIMING.stepMs),
        hopAlong: play.hopMs === null ? 1 : Math.min(1, play.hopMs / TIMING.stepMs),
        gemPhase: gemStep / GEM_SPIN_STEPS,
        wispDrift: wispStep / WISP_DRIFT_STEPS,
        gemShots,
        cranes,
        ship: game.shipCell,
        gateShake: shake,
        warpFlash,
        pulses,
        gateBeams: play.gateBeams.map(beam => ({
          from: beam.from,
          to: beam.to,
          ms: beam.ms,
          // How far it's got, how bright it is, and how much the Switch and each Gate are flashing: the Switch from the
          // press, a Gate from the moment the Beam reaches it - see puzzleDrawing.js's drawGateBeam.
          progress: Math.min(1, beam.ms / TIMING.gateBeamTravelMs),
          opacity: 1 - Math.min(1, Math.max(0, beam.ms - (TIMING.gateBeamMs - TIMING.gateFlashMs)) / TIMING.gateFlashMs),
          switchFlash: 1 - Math.min(1, beam.ms / TIMING.gateFlashMs),
          gateFlash: beam.ms < TIMING.gateBeamTravelMs ? 0 : 1 - Math.min(1, (beam.ms - TIMING.gateBeamTravelMs) / TIMING.gateFlashMs),
        })),
        beams: game.beams,
        reaches: game.reaches,
        ...extra,
      };

      // Only what's actually moving or animating goes into the key: anything gliding, in whole pixels, and the
      // phase of any animation the board has.
      let gliding = (glide) => game.objects.some(o => o.glide === glide && o.fromCol !== undefined && (o.fromCol !== o.col || o.fromRow !== o.row));
      for (const [glide, along] of [['stream', options.along], ['rotator', options.rotatorAlong], ['push', options.pushAlong], ['return', options.returnAlong], ['slide', options.slideAlong], ['hop', options.hopAlong], ['swim', options.swimAlong]]) {
        if (gliding(glide)) key.push(glide, Math.round(Math.min(1, along) * TILE_PX));
      }
      let phase = (ms, cycle) => Math.floor((((ms ?? 0) % cycle) / cycle) * TILE_PX);
      if (floors.some(f => f.kind === 'Stream')) key.push('S', phase(timeMs, STREAM_CYCLE_MS));
      if (floors.some(f => f.kind === 'RotatorTile')) key.push('R', phase(play.rotatorClockMs, ROTATOR_CYCLE_MS));
      if (game.objects.some(o => o.kind === 'Finish' && WeavePuzzle.exitDirectionOf(o))) key.push('F', phase(timeMs, FINISH_ARROW_CYCLE_MS) % 8);
      for (const hint of extra.pushHints ?? []) key.push('h', hint.col, hint.row, hint.direction, hint.bob);
      // A Gate Switch's Beam, and the flashes it makes, run in whole pixels - see renderBoard's drawGateBeam.
      for (const beam of play.gateBeams) key.push('g', Math.round(beam.ms));

      return { list: [...floors, ...objects, ...sinking, ...dissolving], options, key: key.join(',') };
    };

    return play;
  }

  return { createBoardPlay, facingInwards, WARP_FLASH_MS };
});
