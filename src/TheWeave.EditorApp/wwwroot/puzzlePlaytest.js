// puzzlePlaytest.js
// John Oestmann
// Playing the puzzle being edited, right there on the Puzzle Editor's board. The rules, the drawing and the ship's
// movement are the game's own (puzzle.js and sokoban.js), at the game's own timings (puzzle.js's BOARD_TIMING),
// and this is a simpler version of the exported site's board loop (see main.js's updateBoardGame, onBoardEvent and
// drawBoardObjects): no jump arc, contrails, crossing between boards or sound. It never changes the project.

const PLAYTEST_KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};
// The ship's picture points up, so it's turned this far for each way it can face.
const PLAYTEST_SHIP_TURNS = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

function startPlaytest() {
  if (!puzzleEditor || puzzleEditor.playtest || puzzleEditor.drawings) return;
  if (!findNode(puzzleEditor.pageId, puzzleEditor.nodeId)?.puzzle) return;

  puzzleEditor.painting = null;
  puzzleEditor.playtest = buildPlaytest();
  document.getElementById('puzzle-editor').classList.add('playtesting');
  const button = document.getElementById('pe-playtest');
  button.textContent = 'Stop';
  button.blur();
  document.getElementById('pe-playtest-hint').hidden = false;
  document.getElementById('pe-playtest-solved').hidden = true;
}

function stopPlaytest() {
  if (!puzzleEditor?.playtest) return;
  puzzleEditor.playtest = null;
  document.getElementById('puzzle-editor').classList.remove('playtesting');
  document.getElementById('pe-playtest').textContent = 'Playtest';
  document.getElementById('pe-playtest-hint').hidden = true;
  document.getElementById('pe-playtest-solved').hidden = true;
}

function restartPlaytest() {
  if (!puzzleEditor?.playtest) return;
  puzzleEditor.playtest = buildPlaytest();
  document.getElementById('pe-playtest-solved').hidden = true;
}

// A fresh playthrough of the puzzle as it's laid out now. The ship faces into the board, away from whichever edge
// it starts on, as in the game.
function buildPlaytest() {
  const objects = puzzleEditor.objects;
  const timing = WeavePuzzle.BOARD_TIMING;
  const game = WeavePuzzle.createPuzzleGame({ objects });
  const edge = WeavePuzzle.exitDirectionOf(game.start);
  const facing = { Up: 'down', Down: 'up', Left: 'right', Right: 'left' }[edge] ?? 'up';

  const play = {
    objects,
    game,
    mover: null,
    lastMs: null,
    streamMs: 0,
    rotatorActiveMs: 0,
    rotatorGlideMs: timing.rotatorTickMs,
    rotatorClockMs: 0,
    pipeActiveMs: 0,
    pipeTurnMs: null,
    sinking: [],
    pulses: [],
    jump: null,
    reset: null,
    solved: false,
  };

  play.mover = WeaveSokoban.createMover(
    WeaveSokoban.createGrid({
      columns: WeavePuzzle.BOARD_SIZE,
      rows: WeavePuzzle.BOARD_SIZE,
      cellWidth: PUZZLE_TILE_PX,
      cellHeight: PUZZLE_TILE_PX,
    }),
    {
      cell: game.start,
      stepMs: timing.stepMs,
      facing,
      canEnter: game.canEnter,
      onArrive: (cell) => {
        game.settlePushes();
        onPlaytestEvent(play, game.shipArrivedAt(cell));
        carryPlaytestShip(play);
      },
      onStepStart: (from, to, direction) => onPlaytestEvent(play, game.pushFrom(from, to, direction)),
    }
  );
  return play;
}

// A Stream carries the ship along, whatever's being pressed.
function carryPlaytestShip(play) {
  if (play.solved || play.jump) return;
  const carry = play.game.carryDirection(play.mover.cell);
  if (carry) play.mover.queue(carry);
}

// Acts on what puzzle.js says just happened, as main.js's onBoardEvent does.
function onPlaytestEvent(play, event) {
  if (!event) return;
  const timing = WeavePuzzle.BOARD_TIMING;

  if (event.teleportTo) play.mover.teleport(event.teleportTo);
  const glideOf = (object) => {
    if (object.fromCol === undefined || (object.fromCol === object.col && object.fromRow === object.row)) return 0;
    return object.glide === 'push' ? timing.stepMs : object.glide === 'rotator' ? timing.rotatorTickMs : timing.streamTickMs;
  };
  const glideMs = Math.max(0, ...(event.sank ?? []).map(glideOf));
  for (const object of event.sank ?? []) play.sinking.push({ object, ms: 0, glideMs });
  if (event.jumpTo) {
    const from = play.mover.cell;
    const squares = Math.abs(event.jumpTo.col - from.col) + Math.abs(event.jumpTo.row - from.row);
    play.mover.releaseAll();
    play.jump = { from, to: event.jumpTo, ms: 0, durationMs: squares * timing.jumpMsPerSquare };
  }
  if (event.reset) {
    play.sinking = [];
    play.reset = { before: event.reset, ms: 0, durationMs: WeavePuzzle.resetSweepMs(event.reset, play.game.objects) };
  }
  if (event.pipesTurned) {
    play.pipeTurnMs = 0;
    play.pipeActiveMs = 0;
  }
  if (event.lit) play.pulses.push({ ...event.lit, ms: 0, revealed: event.revealed ?? [] });
  if (event.finished) {
    play.solved = true;
    play.mover.releaseAll();
    document.getElementById('pe-playtest-solved').hidden = false;
  }
}

function updatePlaytest(play, dtMs) {
  const timing = WeavePuzzle.BOARD_TIMING;
  const { game, mover } = play;

  for (const sinking of play.sinking) sinking.ms += dtMs;
  play.sinking = play.sinking.filter((sinking) => sinking.ms < sinking.glideMs + timing.sinkMs);
  for (const pulse of play.pulses) pulse.ms += dtMs;
  play.pulses = play.pulses.filter((pulse) => pulse.ms < timing.pulseMs);
  if (play.pipeTurnMs !== null) play.pipeTurnMs += dtMs;
  if (play.solved) return;

  // Nothing else moves while the ship's in the air, or while a Reset Switch's sweep crosses the board.
  if (play.jump) {
    play.jump.ms += dtMs;
    if (play.jump.ms < play.jump.durationMs) return;
    const { to } = play.jump;
    play.jump = null;
    mover.teleport(to);
    onPlaytestEvent(play, game.shipArrivedAt(to, { jumped: true }));
    carryPlaytestShip(play);
    return;
  }
  if (play.reset) {
    play.reset.ms += dtMs;
    if (play.reset.ms >= play.reset.durationMs) play.reset = null;
    return;
  }

  mover.update(dtMs);
  if (play.solved) return;
  if (!mover.isMoving) carryPlaytestShip(play);

  play.streamMs += dtMs;
  while (play.streamMs >= timing.streamTickMs && !play.solved) {
    play.streamMs -= timing.streamTickMs;
    onPlaytestEvent(play, game.tick(mover.isMoving ? mover.cell : null));
  }

  play.rotatorGlideMs = Math.min(timing.rotatorTickMs, play.rotatorGlideMs + dtMs);
  if (mover.isMoving || !game.onRotatorSwitch) {
    play.rotatorActiveMs = 0;
  } else {
    play.rotatorActiveMs += dtMs;
    play.rotatorClockMs += dtMs;
    if (play.rotatorActiveMs >= timing.rotatorTickMs) {
      play.rotatorActiveMs -= timing.rotatorTickMs;
      play.rotatorGlideMs = 0;
      onPlaytestEvent(play, game.tickRotators(null));
    }
  }

  if (mover.isMoving || !game.onPipeSwitch) {
    play.pipeActiveMs = 0;
  } else {
    play.pipeActiveMs += dtMs;
    if (play.pipeActiveMs >= timing.pipeTickMs) onPlaytestEvent(play, game.turnPipes());
  }
}

// The board as it's being played, as main.js's drawBoardObjects draws it, then the ship.
function drawPlaytest(context, look, timeMs) {
  const play = puzzleEditor.playtest;
  const timing = WeavePuzzle.BOARD_TIMING;
  const dtMs = play.lastMs === null ? 0 : Math.min(50, timeMs - play.lastMs);
  play.lastMs = timeMs;
  updatePlaytest(play, dtMs);

  const { game, mover } = play;
  const sinking = play.sinking.map(({ object, ms, glideMs }) => {
    const glided = glideMs === 0 ? 1 : Math.min(1, ms / glideMs);
    const fromCol = object.fromCol ?? object.col, fromRow = object.fromRow ?? object.row;
    return {
      ...object,
      col: fromCol + (object.col - fromCol) * glided,
      row: fromRow + (object.row - fromRow) * glided,
      fromCol: undefined,
      fromRow: undefined,
      sink: Math.max(0, Math.min(1, (ms - glideMs) / timing.sinkMs)),
    };
  });

  let objects = play.reset ? WeavePuzzle.resetSweepAt(play.reset.before, game.objects, play.reset.ms) : game.objects;
  if (game.onRotatorSwitch && !mover.isMoving) {
    const cell = mover.cell;
    const spin = WeavePuzzle.spinAt(play.rotatorClockMs);
    objects = objects.map((object) => object.kind === 'RotatorSwitch' && object.col === cell.col && object.row === cell.row ? { ...object, spin } : object);
  }
  let floors = game.floors;
  if (play.pipeTurnMs !== null && play.pipeTurnMs < timing.pipeTurnMs) {
    const spin = Math.round((1 - play.pipeTurnMs / timing.pipeTurnMs) * WeavePuzzle.SPIN_STEPS / 4);
    floors = floors.map((floor) => floor.kind === 'Pipe' && spin > 0 ? { ...floor, spin } : floor);
  }
  const pulses = play.pulses.map((pulse) => ({ col: pulse.col, row: pulse.row, radius: pulse.ms / timing.pulseMs * WeavePuzzle.PULSE_REACH_PX }));
  const unreached = new Set();
  play.pulses.forEach((pulse, i) => {
    for (const thing of pulse.revealed) {
      if (Math.hypot(thing.col - pulse.col, thing.row - pulse.row) * PUZZLE_TILE_PX > pulses[i].radius) unreached.add(thing);
    }
  });
  const hideUnreached = (list) => unreached.size === 0 ? list : list.map((thing) => unreached.has(thing) ? { ...thing, revealed: false } : thing);

  puzzleEditor.image ??= context.createImageData(PUZZLE_ART_PX, PUZZLE_ART_PX);
  WeavePuzzle.renderBoard(puzzleEditor.image, [...hideUnreached(floors), ...hideUnreached(objects), ...sinking], look, {
    timeMs,
    rotatorTimeMs: play.rotatorClockMs,
    switchesActive: game.switchesActive,
    along: play.streamMs / timing.streamTickMs,
    rotatorAlong: play.rotatorGlideMs / timing.rotatorTickMs,
    pushAlong: mover.progress,
    pulses,
  });
  context.putImageData(puzzleEditor.image, 0, 0);

  if (!puzzleEditor.shipImage) return;
  let position = mover.position;
  if (play.jump) {
    const t = Math.min(1, play.jump.ms / play.jump.durationMs);
    const centre = (cell) => ({ x: (cell.col + 0.5) * PUZZLE_TILE_PX, y: (cell.row + 0.5) * PUZZLE_TILE_PX });
    const from = centre(play.jump.from), to = centre(play.jump.to);
    position = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(Math.round(position.x), Math.round(position.y));
  context.rotate(PLAYTEST_SHIP_TURNS[mover.facing] ?? 0);
  context.drawImage(puzzleEditor.shipImage, -PUZZLE_SHIP_WIDTH / 2, -PUZZLE_SHIP_HEIGHT / 2, PUZZLE_SHIP_WIDTH, PUZZLE_SHIP_HEIGHT);
  context.restore();
}

document.getElementById('pe-playtest').addEventListener('click', () => {
  if (puzzleEditor?.playtest) stopPlaytest();
  else startPlaytest();
});

document.addEventListener('keydown', (e) => {
  const play = puzzleEditor?.playtest;
  if (!play) return;
  const direction = PLAYTEST_KEYS[e.key];
  if (direction) {
    e.preventDefault();
    if (!play.solved && !play.jump) play.mover.press(direction);
  } else if (e.key === 'x' || e.key === 'X') {
    e.preventDefault();
    restartPlaytest();
  }
});

document.addEventListener('keyup', (e) => {
  const direction = PLAYTEST_KEYS[e.key];
  if (direction) puzzleEditor?.playtest?.mover.release(direction);
});

window.addEventListener('blur', () => puzzleEditor?.playtest?.mover.releaseAll());
