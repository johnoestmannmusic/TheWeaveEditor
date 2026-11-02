// puzzleEditor.js
// The Puzzle Editor screen: a track's album art with its 10x10 Sokoban board over it, for placing a
// puzzle's objects on. Like the rest of the UI, nothing here is the real copy of the puzzle - every
// edit goes to the C# side, and comes back in the next project-state (see syncPuzzleEditor), which is
// also how undo and redo reach this screen. What objects look like and how they can be placed lives in
// runtime/puzzle.js, shared with the exported site.

const PUZZLE_TOOLS = [
  { kind: 'Wall', label: 'Wall', hint: 'Blocks the way. Drag to paint.', paints: true, canHide: true },
  { kind: 'Finish', label: 'Finish', hint: 'Reaching this solves the puzzle.' },
  { kind: 'Gate', label: 'Gate', hint: 'Blocks the way while closed. A Switch with its letter flips it between closed and open.', letter: true, gateState: true, canHide: true },
  { kind: 'Switch', label: 'Switch', hint: 'Stepping on this opens or closes every Gate with its letter.', letter: true, canHide: true },
  { kind: 'Teleporter', label: 'Teleporter', hint: 'Jumps to the other Teleporter with its letter. Place them in pairs.', letter: true, canHide: true },
  { kind: 'Stream', label: 'Stream', hint: 'Carries the ship and anything on it, and holds the ship until it\'s pushed off onto a non-Stream square. Drag to paint.', paints: true, direction: true, canHide: true },
  { kind: 'Key', label: 'Key', hint: 'If there are any, all must be collected before Switches do anything.', canHide: true },
  { kind: 'RotatorTile', label: 'Rotator Tile', hint: 'Moves anything on it along to the next Rotator Tile, once per second, while the ship is on a Rotator Switch. The ship can walk on it freely. Drag to paint.', paints: true, direction: true, canHide: true },
  { kind: 'RotatorSwitch', label: 'Rotator Switch', hint: 'While the ship is on this, Rotator Tiles move.', canHide: true },
  { kind: 'Lantern', label: 'Lantern', hint: 'Stepping on this lights it for good, revealing invisible things within 3 squares, in a circle.', canHide: true },
  { kind: 'Start', label: 'Start', hint: 'Where the ship begins. There\'s only one.' },
  { kind: 'Erase', label: 'Erase', hint: 'Removes the top thing on a square. Drag to paint.', paints: true },
];

const PUZZLE_DIRECTIONS = [
  { name: 'Up', label: '↑' },
  { name: 'Left', label: '←' },
  { name: 'Down', label: '↓' },
  { name: 'Right', label: '→' },
];

const PUZZLE_ART_PX = WeavePuzzle.ART_PX;
const PUZZLE_TILE_PX = WeavePuzzle.TILE_PX;
// img/ui/pilot-ship.png's own size, which is what the ship is drawn at against the art.
const PUZZLE_SHIP_WIDTH = 12;
const PUZZLE_SHIP_HEIGHT = 16;
const PUZZLE_PALETTE_ROLES = ['wall', 'finish', 'gate', 'teleporter', 'stream', 'key', 'rotator', 'lantern', 'outline', 'light'];

// How this part connects to the parts either side of it: the part played just before, if it's this one's
// parent and this is its first child, and the part played just after - see puzzle.js's connected boards.
function puzzleNeighbours(pageId, nodeId) {
  const node = findNode(pageId, nodeId);
  const findPrevious = (nodes) => {
    for (const candidate of nodes) {
      if (candidate.children?.[0]?.id === nodeId) return candidate;
      const found = findPrevious(candidate.children ?? []);
      if (found) return found;
    }
    return null;
  };
  const previous = findPrevious(findPage(pageId).nodes);
  const next = node?.children?.[0] ?? null;
  return {
    previous,
    next,
    // This part's Finish has to lead on to the next part's board.
    leadsOn: !!next?.puzzle,
    // Where this part's ship comes in, if the part before leads on to it.
    entrance: WeavePuzzle.entranceAfter(previous?.puzzle),
  };
}

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
    gateOpen: false,
    invisible: false,
    objects: [],
    palette: null,
    textures: null,
    look: null, // both of those, as puzzle.js's renderBoard wants them
    image: null, // the art-sized pixels drawn onto the board's canvas - see drawPuzzleBoard
    painting: null, // { erasing, last } during a drag
    tile: PUZZLE_TILE_PX,
    shipImage: null,
  };

  document.getElementById('puzzle-editor').hidden = false;
  document.querySelector('main').classList.add('behind-puzzle-editor');
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
  document.querySelector('main').classList.remove('behind-puzzle-editor');
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

  // A new puzzle shows its ship where it'll begin, which is saved along with the first edit to it.
  puzzleEditor.neighbours = puzzleNeighbours(puzzleEditor.pageId, puzzleEditor.nodeId);
  const startAt = puzzleEditor.neighbours.entrance ?? WeavePuzzle.DEFAULT_START;
  puzzleEditor.objects = node.puzzle?.objects ?? [{ kind: 'Start', col: startAt.col, row: startAt.row }];
  if (puzzleEditor.neighbours.entrance && puzzleEditor.tool === 'Start') puzzleEditor.tool = 'Wall';
  showPuzzleTool();
  if (node.puzzle?.palette && Object.keys(node.puzzle.palette).length > 0 && !puzzleEditor.palette) {
    puzzleEditor.palette = node.puzzle.palette;
    puzzleEditor.textures = node.puzzle.textures ?? null;
    puzzleEditor.look = { palette: puzzleEditor.palette, textures: puzzleEditor.textures };
  }

  renderPuzzleProblems();

  // A Gate keeps its letter, since several sharing one is common. The others look for what they need next.
  if (puzzleEditor.tool !== 'Gate') updateSuggestedLetter();
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
    const pixels = context.getImageData(0, 0, reader.width, reader.height).data;
    puzzleEditor.palette = WeavePuzzle.pickPalette(pixels);
    puzzleEditor.textures = WeavePuzzle.pickTextures(pixels, reader.width, reader.height, puzzleEditor.palette);
    puzzleEditor.look = { palette: puzzleEditor.palette, textures: puzzleEditor.textures };
    renderPuzzlePalette();

    // Keeps a saved puzzle's colours and textures up to date with its art. This does nothing to the project
    // if they already were, so opening a puzzle doesn't count as an edit.
    const node = findNode(puzzleEditor.pageId, puzzleEditor.nodeId);
    const saved = node?.puzzle;
    if (saved && (saved.paletteSource !== node.card.coverImagePath
        || JSON.stringify(saved.palette) !== JSON.stringify(puzzleEditor.palette)
        || JSON.stringify(saved.textures) !== JSON.stringify(puzzleEditor.textures)
        || startOutOfStep(saved.objects)))
      savePuzzle(lineUpStart(puzzleEditor.objects));
  };
  art.src = message.dataUrl;
}

function savePuzzle(objects) {
  const { pageId, nodeId, palette, textures } = puzzleEditor;
  puzzleEditor.objects = objects;
  send('update-puzzle', {
    pageId,
    nodeId,
    puzzle: { objects, palette: palette ?? {}, textures: textures ?? {}, paletteSource: findNode(pageId, nodeId).card.coverImagePath },
  });
}

// Whether a following part's Start isn't where the ship comes in from the part before, and could be.
function startOutOfStep(objects) {
  const entrance = puzzleEditor.neighbours?.entrance;
  if (!entrance || WeavePuzzle.blockingEntrance(objects, entrance)) return false;
  const start = objects.find((object) => object.kind === 'Start');
  return !start || start.col !== entrance.col || start.row !== entrance.row;
}

function lineUpStart(objects) {
  if (!startOutOfStep(objects)) return objects;
  const entrance = puzzleEditor.neighbours.entrance;
  return WeavePuzzle.placeObject(objects, { kind: 'Start', col: entrance.col, row: entrance.row });
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

  const letters = document.getElementById('pe-letters');
  letters.replaceChildren(...WeavePuzzle.LETTERS.map((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.letter = value;
    button.textContent = value;
    button.addEventListener('click', () => {
      puzzleEditor.letter = value;
      puzzleEditor.letterChosen = true;
      showPuzzleTool();
    });
    return button;
  }));

  const visibilities = document.getElementById('pe-visibilities');
  visibilities.replaceChildren(...[{ label: 'Visible', invisible: false }, { label: 'Invisible', invisible: true }].map(({ label, invisible }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.invisible = invisible;
    button.textContent = label;
    button.addEventListener('click', () => {
      puzzleEditor.invisible = invisible;
      showPuzzleTool();
    });
    return button;
  }));

  const gateStates = document.getElementById('pe-gate-states');
  gateStates.replaceChildren(...[{ label: 'Closed', open: false }, { label: 'Open', open: true }].map(({ label, open }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.open = open;
    button.textContent = label;
    button.addEventListener('click', () => {
      puzzleEditor.gateOpen = open;
      showPuzzleTool();
    });
    return button;
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
  if (kind === 'Start' && puzzleEditor.neighbours?.entrance) return;
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
  showPuzzleTool();
}

function showPuzzleTool() {
  const tool = currentPuzzleTool();

  const { previous, next, leadsOn, entrance } = puzzleEditor.neighbours ?? {};
  for (const button of document.querySelectorAll('#pe-tool-buttons button')) {
    button.classList.toggle('active', button.dataset.tool === tool.kind);
    const fixed = button.dataset.tool === 'Start' && !!entrance;
    button.disabled = fixed;
    button.title = fixed ? `The ship comes in here from '${previous.card.headingText}'.` : '';
  }
  for (const button of document.querySelectorAll('#pe-directions button'))
    button.classList.toggle('active', button.dataset.direction === puzzleEditor.direction);

  for (const button of document.querySelectorAll('#pe-letters button'))
    button.classList.toggle('active', button.dataset.letter === puzzleEditor.letter);
  for (const button of document.querySelectorAll('#pe-gate-states button'))
    button.classList.toggle('active', (button.dataset.open === 'true') === puzzleEditor.gateOpen);

  for (const button of document.querySelectorAll('#pe-visibilities button'))
    button.classList.toggle('active', (button.dataset.invisible === 'true') === puzzleEditor.invisible);

  document.getElementById('pe-visibility-row').hidden = !tool.canHide;
  document.getElementById('pe-letter-row').hidden = !tool.letter;
  document.getElementById('pe-gate-state-row').hidden = !tool.gateState;
  document.getElementById('pe-direction-row').hidden = !tool.direction;
  let hint = tool.hint;
  if (tool.kind === 'Finish' && leadsOn)
    hint = `This part leads on to '${next.card.headingText}', so it has one Finish, on an edge but not a corner. The ship comes in across from it on the next board.`;
  document.getElementById('pe-tool-hint').textContent = hint;
  document.getElementById('pe-edge-ring').hidden = !(tool.kind === 'Finish' && leadsOn);
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

}

// Drawn at the art's own size, for CSS to scale up exactly as it does the art, so that their pixels line
// up, the same as in the game. Redrawn every frame while open, because Streams are always moving.
function drawPuzzleBoard(timeMs) {
  if (!puzzleEditor) return;

  const canvas = document.getElementById('pe-canvas');
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (puzzleEditor.look) {
    puzzleEditor.image ??= context.createImageData(PUZZLE_ART_PX, PUZZLE_ART_PX);
    const objects = puzzleEditor.objects;
    WeavePuzzle.renderBoard(puzzleEditor.image, objects, puzzleEditor.look, {
      timeMs,
      rotatorTimeMs: timeMs,
      switchesActive: !objects.some((object) => object.kind === 'Key'),
      showInvisible: true,
    });
    context.putImageData(puzzleEditor.image, 0, 0);

    const start = objects.find((object) => object.kind === 'Start');
    if (start && puzzleEditor.shipImage) {
      context.imageSmoothingEnabled = false;
      context.drawImage(
        puzzleEditor.shipImage,
        start.col * PUZZLE_TILE_PX + (PUZZLE_TILE_PX - PUZZLE_SHIP_WIDTH) / 2,
        start.row * PUZZLE_TILE_PX + (PUZZLE_TILE_PX - PUZZLE_SHIP_HEIGHT) / 2,
        PUZZLE_SHIP_WIDTH,
        PUZZLE_SHIP_HEIGHT
      );
    }
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
    ...(tool.gateState && puzzleEditor.gateOpen ? { open: true } : {}),
    ...(tool.canHide && puzzleEditor.invisible ? { invisible: true } : {}),
  };
}

function applyPuzzleTool(cell, erasing) {
  let objects = puzzleEditor.objects;

  // A part that leads on has one way through it, on an edge, so placing its Finish moves it, like Start.
  if (!erasing && puzzleEditor.tool === 'Finish' && puzzleEditor.neighbours?.leadsOn) {
    if (!WeavePuzzle.exitDirectionOf(cell)) {
      showToast(`This part leads on to '${puzzleEditor.neighbours.next.card.headingText}', so its Finish goes on an edge of the board, not a corner.`, true);
      return;
    }
    objects = objects.filter((object) => object.kind !== 'Finish');
  }

  puzzleEditor.objects = erasing
    ? WeavePuzzle.eraseObject(objects, cell)
    : WeavePuzzle.placeObject(objects, buildPuzzleObject(cell));
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
