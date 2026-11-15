// puzzlePlaytest.js
// John Oestmann
// Playing the puzzle being edited, right there on the Puzzle Editor's board. The board is played exactly as the
// game plays it, by the same board.js (WeaveBoard), so this only has the Editor's own parts: starting and stopping,
// the keys, the Solved label and the ship. There's no jump arc, contrails, crossing between boards or sound. It
// never changes the project.

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
  puzzleEditor.drawnBoard = null; // the playtest drew over it - see drawPuzzleBoard
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

// A fresh playthrough of the puzzle as it's laid out now - see board.js. The ship faces into the board, away from
// whichever edge it starts on, as in the game.
function buildPlaytest() {
  const objects = puzzleEditor.objects;
  const play = WeaveBoard.createBoardPlay({
    puzzle: { objects, archetons: project.archetons ?? [] },
    hooks: {
      onEvent: (event) => {
        if (event.finished) document.getElementById('pe-playtest-solved').hidden = false;
      },
    },
  });
  return { objects, play, lastMs: null, drawnKey: null };
}

// A lighter, slightly orange copy of the ship, for a Reflect Mimic's reflection: the ship's own picture with an orange
// wash over it, drawn at 40% opacity. Made once, when first asked for, and kept.
function reflectionSprite() {
  if (puzzleEditor.reflectionImage !== undefined || !puzzleEditor.shipImage) return puzzleEditor.reflectionImage;
  const canvas = document.createElement('canvas');
  canvas.width = PUZZLE_SHIP_WIDTH;
  canvas.height = PUZZLE_SHIP_HEIGHT;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(puzzleEditor.shipImage, 0, 0, PUZZLE_SHIP_WIDTH, PUZZLE_SHIP_HEIGHT);
  context.globalCompositeOperation = 'source-atop';
  context.fillStyle = 'rgba(255, 170, 90, 0.65)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return puzzleEditor.reflectionImage = canvas;
}

// The board as it's being played, then the ship and its reflections, only drawn again when they'd look any different.
function drawPlaytest(context, look, timeMs) {
  const playtest = puzzleEditor.playtest;
  const { play } = playtest;
  const dtMs = playtest.lastMs === null ? 0 : Math.min(50, timeMs - playtest.lastMs);
  playtest.lastMs = timeMs;
  play.animate(dtMs);
  play.step(dtMs);

  const { list, options, key } = play.frame(timeMs, { pushHints: play.finished ? [] : play.pushHints(timeMs) });
  const ship = play.shipPosition();
  const reflections = play.game.reflections;
  const drawnKey = `${key}|${Math.round(ship.x)},${Math.round(ship.y)},${play.mover.facing},${ship.spin.toFixed(2)},${ship.opacity.toFixed(2)}|${reflections.map((cell) => cell.col + ',' + cell.row).join(';')}|${look === playtest.look}`;
  if (drawnKey === playtest.drawnKey) return;
  playtest.drawnKey = drawnKey;
  playtest.look = look;

  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  puzzleEditor.image ??= context.createImageData(PUZZLE_ART_PX, PUZZLE_ART_PX);
  WeavePuzzle.renderBoard(puzzleEditor.image, list, look, options);
  context.putImageData(puzzleEditor.image, 0, 0);

  if (!puzzleEditor.shipImage) return;
  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(Math.round(ship.x), Math.round(ship.y));
  context.rotate((PLAYTEST_SHIP_TURNS[play.mover.facing] ?? 0) + ship.spin);
  context.globalAlpha = ship.opacity;
  context.drawImage(puzzleEditor.shipImage, -PUZZLE_SHIP_WIDTH / 2, -PUZZLE_SHIP_HEIGHT / 2, PUZZLE_SHIP_WIDTH, PUZZLE_SHIP_HEIGHT);
  context.restore();

  // What any Reflect Mimic shows of the ship: the same picture, tinted and see-through, drawn where its pane mirrors
  // where the ship is being drawn - so it glides with it rather than jumping between squares.
  const reflection = reflectionSprite();
  if (!reflection) return;
  for (const cell of reflections) {
    const mirrored = WeavePuzzle.reflectionPosition(cell, ship, PUZZLE_TILE_PX);
    context.save();
    context.imageSmoothingEnabled = false;
    context.translate(Math.round(mirrored.x), Math.round(mirrored.y));
    context.rotate(PLAYTEST_SHIP_TURNS[WeavePuzzle.reflectionFacing(cell, play.mover.facing)] ?? 0);
    context.globalAlpha = 0.4;
    context.drawImage(reflection, -PUZZLE_SHIP_WIDTH / 2, -PUZZLE_SHIP_HEIGHT / 2, PUZZLE_SHIP_WIDTH, PUZZLE_SHIP_HEIGHT);
    context.restore();
  }
}

document.getElementById('pe-playtest').addEventListener('click', () => {
  if (puzzleEditor?.playtest) stopPlaytest();
  else startPlaytest();
});

document.addEventListener('keydown', (e) => {
  const play = puzzleEditor?.playtest?.play;
  if (!play) return;
  const direction = PLAYTEST_KEYS[e.key];
  if (direction) {
    e.preventDefault();
    if (!play.finished && !play.jump) play.mover.press(direction);
  } else if (e.key === 'x' || e.key === 'X') {
    e.preventDefault();
    restartPlaytest();
  }
});

document.addEventListener('keyup', (e) => {
  const direction = PLAYTEST_KEYS[e.key];
  if (direction) puzzleEditor?.playtest?.play.mover.release(direction);
});

window.addEventListener('blur', () => puzzleEditor?.playtest?.play.mover.releaseAll());
