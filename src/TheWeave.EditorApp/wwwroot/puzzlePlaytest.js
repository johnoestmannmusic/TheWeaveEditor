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

// The board as it's being played, then the ship, only drawn again when either would look any different.
function drawPlaytest(context, look, timeMs) {
  const playtest = puzzleEditor.playtest;
  const { play } = playtest;
  const dtMs = playtest.lastMs === null ? 0 : Math.min(50, timeMs - playtest.lastMs);
  playtest.lastMs = timeMs;
  play.animate(dtMs);
  play.step(dtMs);

  const { list, options, key } = play.frame(timeMs);
  const ship = play.shipPosition();
  const drawnKey = `${key}|${Math.round(ship.x)},${Math.round(ship.y)},${play.mover.facing}|${look === playtest.look}`;
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
  context.rotate(PLAYTEST_SHIP_TURNS[play.mover.facing] ?? 0);
  context.drawImage(puzzleEditor.shipImage, -PUZZLE_SHIP_WIDTH / 2, -PUZZLE_SHIP_HEIGHT / 2, PUZZLE_SHIP_WIDTH, PUZZLE_SHIP_HEIGHT);
  context.restore();
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
