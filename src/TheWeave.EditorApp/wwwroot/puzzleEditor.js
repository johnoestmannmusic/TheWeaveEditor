// puzzleEditor.js
// The Puzzle Editor screen: a track's album art with its 10x10 Sokoban board over it, for placing a
// puzzle's objects on. Like the rest of the UI, nothing here is the real copy of the puzzle - every
// edit goes to the C# side, and comes back in the next project-state (see syncPuzzleEditor), which is
// also how undo and redo reach this screen. What objects look like and how they can be placed lives in
// runtime/puzzle.js, shared with the exported site.

const PUZZLE_TOOLS = [
  { kind: 'Wall', label: 'Wall', hint: 'Blocks the way. Drag to paint.', paints: true },
  { kind: 'Finish', label: 'Finish', hint: 'Reaching this solves the puzzle.' },
  { kind: 'Gate', label: 'Gate', hint: 'Blocks the way until a Switch with its letter opens it.', letter: true },
  { kind: 'Switch', label: 'Switch', hint: 'Stepping on this opens or closes every Gate with its letter.', letter: true },
  { kind: 'Teleporter', label: 'Teleporter', hint: 'Jumps to the other Teleporter with its letter. Place them in pairs.', letter: true },
  { kind: 'Stream', label: 'Stream', hint: 'Carries the ship and anything on it, and can\'t be walked against. Drag to paint.', paints: true, direction: true },
  { kind: 'Key', label: 'Key', hint: 'If there are any, all must be collected before Switches do anything.' },
  { kind: 'Start', label: 'Start', hint: 'Where the ship begins. There\'s only one.' },
  { kind: 'Erase', label: 'Erase', hint: 'Removes the top thing on a square. Drag to paint, or right-click with any tool.', paints: true },
];

const PUZZLE_DIRECTIONS = [
  { name: 'Up', label: '↑' },
  { name: 'Left', label: '←' },
  { name: 'Down', label: '↓' },
  { name: 'Right', label: '→' },
];

const PUZZLE_ART_PX = 240;
const PUZZLE_TILE_PX = PUZZLE_ART_PX / WeavePuzzle.BOARD_SIZE;
const PUZZLE_PALETTE_ROLES = ['wall', 'finish', 'gate', 'teleporter', 'stream', 'key', 'outline', 'light'];

// While the screen is open: which track, what's chosen in the tools, and a working copy of the board,
// ahead of the saved one while a drag is still painting. Null while closed.
let puzzleEditor = null;

function openPuzzleEditor(pageId, nodeId) {
  puzzleEditor = {
    pageId,
    nodeId,
    tool: 'Wall',
    letter: 'A',
    letterChosen: false, // whether the letter is the user's own choice, rather than one suggested
    direction: 'Right',
    objects: [],
    palette: null,
    painting: null, // { erasing, last } during a drag
    tile: PUZZLE_TILE_PX,
    shipImage: null,
  };

  document.getElementById('puzzle-editor').hidden = false;
  document.getElementById('pe-title').textContent = `Puzzle: ${findNode(pageId, nodeId).card.headingText || nodeId}`;

  const shipImage = new Image();
  shipImage.onload = () => { if (puzzleEditor) puzzleEditor.shipImage = shipImage; };
  shipImage.src = toFileUrl(contentRoot, `${project.assets.imgRoot}/ui/pilot-ship.png`);

  renderPuzzleTools();
  syncPuzzleEditor();
  layoutPuzzleBoard();
  send('load-puzzle-art', { pageId, nodeId });
  requestAnimationFrame(drawPuzzleBoard);
}

function closePuzzleEditor() {
  puzzleEditor = null;
  document.getElementById('puzzle-editor').hidden = true;
  document.getElementById('pe-art').removeAttribute('src');
}

// Brings the screen back in step with the saved project, after an edit, an undo, or a rejected edit.
function syncPuzzleEditor() {
  if (!puzzleEditor) return;

  const node = findNode(puzzleEditor.pageId, puzzleEditor.nodeId);
  if (!node) {
    closePuzzleEditor();
    return;
  }

  // A new puzzle shows its ship in the default place, and that's saved along with the first edit to it.
  puzzleEditor.objects = node.puzzle?.objects
    ?? [{ kind: 'Start', col: WeavePuzzle.DEFAULT_START.col, row: WeavePuzzle.DEFAULT_START.row }];
  if (node.puzzle?.palette && Object.keys(node.puzzle.palette).length > 0 && !puzzleEditor.palette)
    puzzleEditor.palette = node.puzzle.palette;

  renderPuzzleProblems();
  updateSuggestedLetter();
}

// The art comes as a data URL, which unlike a file:// image lets a canvas read its pixels for the colours.
function receivePuzzleArt(message) {
  if (!puzzleEditor || message.nodeId !== puzzleEditor.nodeId) return;

  const art = document.getElementById('pe-art');
  art.onload = () => {
    if (!puzzleEditor || message.nodeId !== puzzleEditor.nodeId) return;

    const reader = document.createElement('canvas');
    reader.width = art.naturalWidth;
    reader.height = art.naturalHeight;
    const context = reader.getContext('2d', { willReadFrequently: true });
    context.drawImage(art, 0, 0);
    puzzleEditor.palette = WeavePuzzle.pickPalette(context.getImageData(0, 0, reader.width, reader.height).data);
    renderPuzzlePalette();

    // Keeps a saved puzzle's colours up to date with its art. This does nothing to the project if they
    // already were, so opening a puzzle doesn't count as an edit.
    const node = findNode(puzzleEditor.pageId, puzzleEditor.nodeId);
    const saved = node?.puzzle;
    if (saved && (saved.paletteSource !== node.card.coverImagePath || JSON.stringify(saved.palette) !== JSON.stringify(puzzleEditor.palette)))
      savePuzzle(puzzleEditor.objects);
  };
  art.src = message.dataUrl;
}

function savePuzzle(objects) {
  const { pageId, nodeId, palette } = puzzleEditor;
  puzzleEditor.objects = objects;
  send('update-puzzle', {
    pageId,
    nodeId,
    puzzle: { objects, palette: palette ?? {}, paletteSource: findNode(pageId, nodeId).card.coverImagePath },
  });
}

// ---------- tools ----------

function renderPuzzleTools() {
  const buttons = document.getElementById('pe-tool-buttons');
  buttons.replaceChildren(...PUZZLE_TOOLS.map((tool) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tool = tool.kind;
    button.textContent = tool.label;
    button.addEventListener('click', () => choosePuzzleTool(tool.kind));
    return button;
  }));

  const letter = document.getElementById('pe-letter');
  letter.replaceChildren(...WeavePuzzle.LETTERS.map((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    return option;
  }));

  const directions = document.getElementById('pe-directions');
  directions.replaceChildren(...PUZZLE_DIRECTIONS.map(({ name, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.direction = name;
    button.title = name;
    button.textContent = label;
    button.addEventListener('click', () => {
      puzzleEditor.direction = name;
      showPuzzleTool();
    });
    return button;
  }));

  showPuzzleTool();
}

function choosePuzzleTool(kind) {
  puzzleEditor.tool = kind;
  puzzleEditor.letterChosen = false;
  updateSuggestedLetter();
  showPuzzleTool();
}

function currentPuzzleTool() {
  return PUZZLE_TOOLS.find((tool) => tool.kind === puzzleEditor.tool);
}

function updateSuggestedLetter() {
  if (!currentPuzzleTool().letter || puzzleEditor.letterChosen) return;
  puzzleEditor.letter = WeavePuzzle.suggestLetter(puzzleEditor.objects, puzzleEditor.tool);
  document.getElementById('pe-letter').value = puzzleEditor.letter;
}

function showPuzzleTool() {
  const tool = currentPuzzleTool();

  for (const button of document.querySelectorAll('#pe-tool-buttons button'))
    button.classList.toggle('active', button.dataset.tool === tool.kind);
  for (const button of document.querySelectorAll('#pe-directions button'))
    button.classList.toggle('active', button.dataset.direction === puzzleEditor.direction);

  document.getElementById('pe-letter-row').hidden = !tool.letter;
  document.getElementById('pe-direction-row').hidden = !tool.direction;
  document.getElementById('pe-letter').value = puzzleEditor.letter;
  document.getElementById('pe-tool-hint').textContent = tool.hint;
}

function renderPuzzlePalette() {
  const list = document.getElementById('pe-palette');
  const palette = puzzleEditor.palette;
  list.replaceChildren(...PUZZLE_PALETTE_ROLES.map((role) => {
    const row = document.createElement('div');
    row.className = 'pe-swatch-row';
    const swatch = document.createElement('span');
    swatch.className = 'pe-swatch';
    swatch.style.background = palette[role];
    row.append(swatch, role === 'gate' ? 'gate + switch' : role);
    return row;
  }));
}

// The project's problems that are about this puzzle - see ProjectValidator's CheckPuzzle.
function renderPuzzleProblems() {
  const prefix = `Puzzle on '${puzzleEditor.nodeId}': `;
  const problems = validationIssues
    .filter((issue) => issue.includes(prefix))
    .map((issue) => issue.slice(issue.indexOf(prefix) + prefix.length));

  const list = document.getElementById('pe-problems');
  if (problems.length === 0) {
    const none = document.createElement('li');
    none.className = 'muted';
    none.textContent = findNode(puzzleEditor.pageId, puzzleEditor.nodeId)?.puzzle ? 'None.' : 'Nothing placed yet.';
    list.replaceChildren(none);
    return;
  }
  list.replaceChildren(...problems.map((problem) => {
    const item = document.createElement('li');
    item.textContent = problem;
    return item;
  }));
}

// ---------- the board ----------

// The largest whole-number scale of the art that fits, so that it stays as crisp as it is in the game.
function layoutPuzzleBoard() {
  if (!puzzleEditor) return;

  const stage = document.getElementById('pe-stage');
  const scale = Math.max(1, Math.floor(Math.min(stage.clientWidth, stage.clientHeight) / PUZZLE_ART_PX));
  const tile = PUZZLE_TILE_PX * scale;
  puzzleEditor.tile = tile;

  const board = document.getElementById('pe-board');
  board.style.width = `${tile * WeavePuzzle.BOARD_SIZE}px`;
  board.style.height = `${tile * WeavePuzzle.BOARD_SIZE}px`;
  board.style.setProperty('--pe-tile', `${tile}px`);
  board.style.setProperty('--pe-line', `${scale}px`);

  const canvas = document.getElementById('pe-canvas');
  canvas.width = tile * WeavePuzzle.BOARD_SIZE;
  canvas.height = tile * WeavePuzzle.BOARD_SIZE;
}

// Redrawn every frame while open, because Streams are always moving.
function drawPuzzleBoard(timeMs) {
  if (!puzzleEditor) return;

  const canvas = document.getElementById('pe-canvas');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (puzzleEditor.palette) {
    WeavePuzzle.drawObjects(context, puzzleEditor.objects, puzzleEditor.palette, puzzleEditor.tile, {
      timeMs,
      shipImage: puzzleEditor.shipImage,
    });
  }

  requestAnimationFrame(drawPuzzleBoard);
}

function puzzleCellAt(e) {
  const box = document.getElementById('pe-canvas').getBoundingClientRect();
  const col = Math.floor((e.clientX - box.left) / puzzleEditor.tile);
  const row = Math.floor((e.clientY - box.top) / puzzleEditor.tile);
  const size = WeavePuzzle.BOARD_SIZE;
  return col >= 0 && col < size && row >= 0 && row < size ? { col, row } : null;
}

function buildPuzzleObject(cell) {
  const tool = currentPuzzleTool();
  return {
    kind: tool.kind,
    col: cell.col,
    row: cell.row,
    ...(tool.letter ? { letter: puzzleEditor.letter } : {}),
    ...(tool.direction ? { direction: puzzleEditor.direction } : {}),
  };
}

function applyPuzzleTool(cell, erasing) {
  puzzleEditor.objects = erasing
    ? WeavePuzzle.eraseObject(puzzleEditor.objects, cell)
    : WeavePuzzle.placeObject(puzzleEditor.objects, buildPuzzleObject(cell));
}

const puzzleCanvas = document.getElementById('pe-canvas');

puzzleCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

puzzleCanvas.addEventListener('pointerdown', (e) => {
  const cell = puzzleCellAt(e);
  if (!puzzleEditor || !cell || (e.button !== 0 && e.button !== 2)) return;

  const erasing = e.button === 2 || puzzleEditor.tool === 'Erase';
  const tool = currentPuzzleTool();

  puzzleCanvas.setPointerCapture(e.pointerId);
  // Only tools that make sense in a line paint, so that a slipped click can't scatter a Gate's letter around.
  puzzleEditor.painting = { erasing, paints: erasing || !!tool.paints, last: cell };
  applyPuzzleTool(cell, erasing);
});

puzzleCanvas.addEventListener('pointermove', (e) => {
  const painting = puzzleEditor?.painting;
  if (!painting?.paints) return;

  const cell = puzzleCellAt(e);
  if (!cell || (cell.col === painting.last.col && cell.row === painting.last.row)) return;

  painting.last = cell;
  applyPuzzleTool(cell, painting.erasing);
});

// A whole drag is one edit, so that it's also one undo.
function finishPuzzlePainting() {
  if (!puzzleEditor?.painting) return;
  puzzleEditor.painting = null;
  savePuzzle(puzzleEditor.objects);
}

puzzleCanvas.addEventListener('pointerup', finishPuzzlePainting);
puzzleCanvas.addEventListener('pointercancel', finishPuzzlePainting);

document.getElementById('pe-letter').addEventListener('change', (e) => {
  puzzleEditor.letter = e.target.value;
  puzzleEditor.letterChosen = true;
});

document.getElementById('pe-close').addEventListener('click', closePuzzleEditor);

document.getElementById('pe-clear').addEventListener('click', () => {
  const { pageId, nodeId } = puzzleEditor;
  puzzleEditor.painting = null;
  if (findNode(pageId, nodeId)?.puzzle) send('update-puzzle', { pageId, nodeId, puzzle: null });
});

document.addEventListener('keydown', (e) => {
  if (puzzleEditor && e.key === 'Escape') closePuzzleEditor();
});

window.addEventListener('resize', layoutPuzzleBoard);
