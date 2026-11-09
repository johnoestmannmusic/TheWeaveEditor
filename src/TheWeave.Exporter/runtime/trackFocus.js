// trackFocus.js
// John Oestmann
// Track Focus: a track's album art, title and poetry, the transitions into and out of it, and the page's side of
// its puzzle board - starting and leaving it, scrolling between connected boards, the ship and its contrails, and
// the push hint. The board itself is played by board.js.
//
// Part of the page script, split from main.js by concern. Every part shares one set of page-wide names, loaded in
// order after main.js - see main.js for the page's state and setup. Part of the canonical shared runtime owned by
// TheWeave.Exporter - generated into every exported site's jsx/ folder, not hand-edited there.

// Track Focus: a full-screen view of the current track - album art on the left, title and poetry on
// the right, over the dimmed map and a blown-up, blurred copy of the art that gives the whole screen
// its palette. Its music carries on playing, since the ship stays exactly where it is (see
// updateLocationAudio). A multi-part location's later parts are only reachable here - see
// cycleChainNode.
//
// Appended to <html>, not <body>, for the same reason as #modalBackdrop - see #screenFrame's
// comment in buildScreenFrame.
function openTrackFocus(){
  if (trackFocusEl || !activeNode || focusTransition || nodeMeta.get(activeRoot)?.locked) return;

  // The card's own cover on the map, which grows into Track Focus's art. Its art is already loaded, so there's
  // nothing to wait for.
  let cardCover = nodeMeta.get(activeNode).info.querySelector(':scope > .songCover');

  trackFocusEl = document.createElement('div');
  trackFocusEl.id = 'trackFocus';

  renderTrackFocus();
  updateTrackFocusScale();
  document.documentElement.appendChild(trackFocusEl);
  runFocusTransition(() => growFromCard(trackFocusEl, cardCover, false));
}

// (Re)builds the screen for activeNode. Everything shown is read from that node's card already in the
// page, rather than being rendered a second time per node. :scope matters here: a chain member's card
// contains every later member's whole card (see the README's nesting section), so a plain
// querySelector could find the wrong track's.
function renderTrackFocus(){
  let info = nodeMeta.get(activeNode).info;
  let cover = info.querySelector(':scope > .songCover');
  let title = info.querySelector(':scope > h3');
  let lines = info.querySelectorAll(':scope > .poetry-text > .poetry-line');
  let download = info.querySelector(':scope > .poetry-text > .poetry-download a');
  let lockedBy = partLockedBy(activeNode);

  trackFocusEl.replaceChildren();

  let content = document.createElement('div');
  content.id = 'trackFocusContent';

  if (cover) {
    trackFocusEl.appendChild(buildFocusBackdrop(cover));

    // The art and its board go together in one layer, which slides out of the frame when moving on to the
    // next part's board - see startBoardScroll. Styled by class rather than id, because the layer sliding
    // out keeps its look but gives up its ids to the one sliding in.
    let frame = document.createElement('div');
    frame.id = 'trackFocusArt';

    let slide = document.createElement('div');
    slide.id = 'trackFocusArtSlide';
    slide.className = 'trackFocusArtSlide';
    frame.appendChild(slide);

    let art = document.createElement('img');
    art.src = cover.src;
    slide.appendChild(art);

    // Where the 10x10 board laid over the art goes, sized to exactly match it - see startBoardGame,
    // and updateTrackFocusScale for the tile size it gets to work with.
    let board = document.createElement('div');
    board.id = 'trackFocusBoard';
    board.className = 'trackFocusBoard';
    if (boardMover) {
      if (boardGame) {
        boardObjectsCanvas = document.createElement('canvas');
        boardDrawnKey = null; // a new canvas has nothing drawn on it yet
        boardObjectsCanvas.id = 'trackFocusBoardObjects';
        boardObjectsCanvas.className = 'trackFocusBoardObjects';
        boardObjectsCanvas.width = WeavePuzzle.ART_PX;
        boardObjectsCanvas.height = WeavePuzzle.ART_PX;
        boardObjectsImage = boardObjectsCanvas.getContext('2d').createImageData(WeavePuzzle.ART_PX, WeavePuzzle.ART_PX);
        board.appendChild(boardObjectsCanvas);
      }
      board.appendChild(boardContrails.canvas);
      board.appendChild(buildBoardShip());
    }
    slide.appendChild(board);
    if (lockedBy) frame.appendChild(buildArtLabel('Locked'));

    content.appendChild(frame);
  }

  let text = document.createElement('div');
  text.id = 'trackFocusText';

  // Nothing of a locked part gives itself away: not its name, its poem, or its download.
  let heading = document.createElement('h2');
  heading.textContent = lockedBy ? 'Locked' : (title ? title.textContent : '');
  text.appendChild(heading);

  if (lockedBy) {
    let hint = document.createElement('div');
    hint.id = 'trackFocusLockedHint';
    hint.textContent = 'Solve ' + nodeMeta.get(lockedBy).info.querySelector(':scope > h3').textContent + ' to unlock this.';
    text.appendChild(hint);
  }

  let puzzle = nodeMeta.get(activeNode).puzzle;
  if (puzzle && isPuzzleSolved(puzzle) && !boardMover) {
    let solved = document.createElement('div');
    solved.id = 'trackFocusSolved';
    solved.textContent = 'Solved';
    text.appendChild(solved);
  }

  if (!lockedBy) lines.forEach(line => text.appendChild(line.cloneNode(true)));

  let actions = document.createElement('div');
  actions.id = 'trackFocusActions';
  if (boardMover) {
    if (boardGame) actions.appendChild(buildTrackFocusAction('[ Restart ]', 'img/ui/key_x.gif', restartBoardGame));
    actions.appendChild(buildTrackFocusAction('[ Back ]', 'img/ui/key_c.gif', leaveBoardGame));
  } else {
    if (cover && !lockedBy) actions.appendChild(buildTrackFocusAction('[ Enter ]', 'img/ui/key_z.gif', startBoardGame));
    if (nodeMeta.get(activeRoot).chain.length > 1) {
      actions.appendChild(buildTrackFocusAction('[ Switch ]', 'img/ui/key_x.gif', cycleChainNode));
    }
    actions.appendChild(buildTrackFocusAction('[ Back ]', 'img/ui/key_c.gif', closeTrackFocus));
    // Only reachable from here for a chain's later parts, since their cards never open on the map.
    if (download && !lockedBy) actions.appendChild(download.cloneNode(true));
  }
  text.appendChild(actions);

  content.appendChild(text);
  trackFocusEl.appendChild(content);

  // Clicking anywhere that isn't the art or the text dismisses it, same as a modal's backdrop.
  // Not while playing, though: nobody should lose their place on the board to a stray click.
  content.addEventListener('click', (e) => {
    if (e.target === content && !boardMover) closeTrackFocus();
  });

  trackFocusEl.classList.toggle('boardPlaying', boardMover !== null);
  // The line of key hints is measured for where the board goes - see updateTrackFocusScale.
  if (trackFocusEl.isConnected) updateTrackFocusScale();
  trackFocusEl.classList.toggle('partLocked', lockedBy !== null);
}

// A word across the middle of the album art.
function buildArtLabel(text){
  let label = document.createElement('div');
  label.className = 'trackFocusArtLabel';
  label.textContent = text;
  return label;
}

function buildTrackFocusAction(label, hint, onClick){
  let action = document.createElement('span');
  action.className = 'trackFocusAction';

  let text = document.createElement('span');
  text.textContent = label;
  text.addEventListener('click', onClick);
  action.appendChild(text);

  let hintImg = document.createElement('img');
  hintImg.className = 'keyHint';
  hintImg.src = hint;
  action.appendChild(hintImg);

  return action;
}

// A no-op when it isn't open, so every way of closing it can just call this. Always comes back to the
// location's first part: that's the only card the map ever shows, and the music should match it.
function closeTrackFocus(){
  if (!trackFocusEl || focusTransition) return;

  let closing = trackFocusEl;
  let cardCover = nodeMeta.get(activeRoot).info.querySelector(':scope > .songCover');
  runFocusTransition(() => growFromCard(closing, cardCover, true)).then(() => {
    closing.remove();
    trackFocusEl = null;
    activeNode = activeRoot;
    chainIndex = 0;
  });
}

// ---------- transitions ----------

// How long Track Focus takes to open or close, and to flip over between its art and its board.
const FOCUS_OPEN_MS = 450;
const FOCUS_FLIP_MS = 400;
// How far away the flip's perspective is, in art frames, which decides how much the near edge grows as it turns.
const FOCUS_FLIP_PERSPECTIVE = 4;

// How long past its end an animation is given before it's finished off anyway - see playFocusAnimation.
const FOCUS_OVERDUE_MS = 1000;

// Whether a transition is playing, which holds everything else back until it's done - see runFocusTransition.
let focusTransition = false;

function prefersReducedMotion(){
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Plays an animation on an element, resolving once it's done and taken off again. Without the element, or for a
// visitor who's asked for reduced motion, it's done straight away.
function playFocusAnimation(element, keyframes, ms, { easing = 'ease-in-out', delay = 0 } = {}){
  if (!element || prefersReducedMotion() || !element.animate) return Promise.resolve();
  let animation = element.animate(keyframes, { duration: ms, delay, easing, fill: 'both' });
  // Never waited on for longer than it should take, so a transition can't ever hold the game up.
  let overdue = new Promise(resolve => setTimeout(resolve, delay + ms + FOCUS_OVERDUE_MS));
  return Promise.race([animation.finished.catch(() => {}), overdue]).then(() => animation.cancel());
}

// Runs a transition, holding input back until it's over. Anything pressed meanwhile is let go of at the end,
// so a key held through a flip doesn't set the ship off the moment it lands.
async function runFocusTransition(transition){
  focusTransition = true;
  try {
    await transition();
  } finally {
    focusTransition = false;
    releaseDirections();
  }
}

// The art again, behind everything, just to lend Track Focus its palette: drawn once into a canvas only a few pixels
// across, which the browser smooths as it stretches it over the screen. That looks like a heavy blur of the art,
// without the cost of blurring the whole screen every frame.
const FOCUS_BACKDROP_PX = 12;

function buildFocusBackdrop(cover){
  let canvas = document.createElement('canvas');
  canvas.id = 'trackFocusBackdrop';
  canvas.width = FOCUS_BACKDROP_PX;
  canvas.height = FOCUS_BACKDROP_PX;
  let draw = () => {
    let context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(cover, 0, 0, FOCUS_BACKDROP_PX, FOCUS_BACKDROP_PX);
  };
  if (cover.complete && cover.naturalWidth) draw();
  else cover.addEventListener('load', draw, { once: true });
  return canvas;
}

// A card's cover on the map growing into Track Focus's art while everything else fades in, or the other way
// round when closing. A card that isn't on screen has nothing to grow from, so everything just fades.
function growFromCard(focusEl, cardCover, closing){
  let art = focusEl.querySelector('#trackFocusArt');
  let text = focusEl.querySelector('#trackFocusText');
  let backdrop = focusEl.querySelector('#trackFocusBackdrop');
  let from = cardCover?.getBoundingClientRect();
  let to = art?.getBoundingClientRect();
  let order = (frames) => closing ? [...frames].reverse() : frames;

  let animations = [
    playFocusAnimation(focusEl, order([
      { backgroundColor: 'rgba(0, 0, 0, 0)', backdropFilter: 'blur(0px)', webkitBackdropFilter: 'blur(0px)' },
      { backgroundColor: 'rgba(0, 0, 0, 0.82)', backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)' },
    ]), FOCUS_OPEN_MS),
    playFocusAnimation(backdrop, order([{ opacity: 0 }, { opacity: 0.25 }]), FOCUS_OPEN_MS),
    // The text comes in once the art's most of the way there, and goes first when closing.
    playFocusAnimation(text, order([{ opacity: 0 }, { opacity: 1 }]), FOCUS_OPEN_MS * (closing ? 0.4 : 0.6), { delay: closing ? 0 : FOCUS_OPEN_MS * 0.4 }),
  ];

  // Closing, everything is left where it ends up, since each animation is taken off as it finishes, and Track
  // Focus only goes once they all have: otherwise whatever finished first would show again meanwhile.
  let rest = (element, styles) => { if (closing && element) Object.assign(element.style, styles); };
  rest(focusEl, { backgroundColor: 'rgba(0, 0, 0, 0)', backdropFilter: 'none', webkitBackdropFilter: 'none' });
  rest(backdrop, { opacity: '0' });
  rest(text, { opacity: '0' });

  if (art && from && from.width > 0 && to.width > 0) {
    let shrunk = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`;
    rest(art, { transform: shrunk, transformOrigin: '0 0', boxShadow: 'none' });
    if (cardCover) cardCover.style.visibility = 'hidden';
    // Closing on a later part of a location, whose art isn't the card's, it fades into the card's own cover as
    // it shrinks, so that it lands as the picture that's really there.
    if (closing) {
      let landing = document.createElement('img');
      landing.className = 'trackFocusLanding';
      landing.src = cardCover.src;
      landing.style.opacity = '1';
      art.appendChild(landing);
      animations.push(playFocusAnimation(landing, [{ opacity: 0 }, { opacity: 1 }], FOCUS_OPEN_MS, { easing: 'ease-in' }));
    }
    animations.push(playFocusAnimation(art, order([
      { transform: shrunk, transformOrigin: '0 0', boxShadow: 'none' },
      { transform: 'none', transformOrigin: '0 0' },
    ]), FOCUS_OPEN_MS).then(() => { if (cardCover) cardCover.style.visibility = ''; }));
  } else {
    rest(art, { opacity: '0' });
    animations.push(playFocusAnimation(art, order([{ opacity: 0 }, { opacity: 1 }]), FOCUS_OPEN_MS));
  }
  return Promise.all(animations);
}

// Flips the art over, like turning a card, to or from the board on its back. It turns edge-on, the screen
// changes underneath it (change), and it turns the rest of the way round, moving to wherever the art is in the new
// layout across the whole flip. Done in two halves so that the art never shows mirrored, and there's no back to
// keep in step with the front. The text fades out over the first half, and the new text in over the second.
async function flipFocus(change, toPlaying){
  let art = document.getElementById('trackFocusArt');
  let text = document.getElementById('trackFocusText');
  if (!art || prefersReducedMotion()) {
    change();
    return;
  }

  // Where the art will be, from a look at the new layout without drawing it.
  let before = art.getBoundingClientRect();
  trackFocusEl.classList.toggle('boardPlaying', toPlaying);
  let after = art.getBoundingClientRect();
  trackFocusEl.classList.toggle('boardPlaying', !toPlaying);
  let half = { x: (after.left - before.left) / 2, y: (after.top - before.top) / 2 };
  let perspective = `perspective(${Math.round(before.width * FOCUS_FLIP_PERSPECTIVE)}px)`;

  await Promise.all([
    playFocusAnimation(art, [
      { transform: `${perspective} translate(0, 0) rotateY(0deg)` },
      { transform: `${perspective} translate(${half.x}px, ${half.y}px) rotateY(90deg)` },
    ], FOCUS_FLIP_MS / 2, { easing: 'ease-in' }),
    playFocusAnimation(text, [{ opacity: 1 }, { opacity: 0 }], FOCUS_FLIP_MS / 2),
  ]);

  // Hidden for the moment between the halves, so that the old art never shows face on again.
  art.style.visibility = 'hidden';
  change();

  await Promise.all([
    playFocusAnimation(document.getElementById('trackFocusArt'), [
      { transform: `${perspective} translate(${-half.x}px, ${-half.y}px) rotateY(-90deg)` },
      { transform: `${perspective} translate(0, 0) rotateY(0deg)` },
    ], FOCUS_FLIP_MS / 2, { easing: 'ease-out' }),
    playFocusAnimation(document.getElementById('trackFocusText'), [{ opacity: 0 }, { opacity: 1 }], FOCUS_FLIP_MS / 2),
  ]);
}

// The part's title over its board for its first few seconds, then fading away - see main.css's
// .trackFocusBoardTitle. Shown on starting a puzzle, and on moving from one part's to another's.
function showBoardTitle(){
  let frame = document.getElementById('trackFocusArt');
  let title = nodeMeta.get(activeNode).info.querySelector(':scope > h3')?.textContent;
  if (!frame || !title) return;

  frame.querySelector('.trackFocusBoardTitle')?.remove();
  let label = buildArtLabel(title);
  label.classList.add('trackFocusBoardTitle');
  label.addEventListener('animationend', () => label.remove());
  frame.appendChild(label);
}

// Album art is 240x240, on a 10x10 board of 24-source-pixel tiles. Picks the largest size that fits with
// tiles a whole number of screen pixels wide, so the board's squares are always exact. The art itself is
// only perfectly crisp at a whole-number scale, so one of those wins if it's within
// TRACK_FOCUS_SNAP_FRACTION of the space available.
const TRACK_FOCUS_ART_PX = 240;
const TRACK_FOCUS_BOARD_SQUARES = 10;
const BOARD_TILE_PX = TRACK_FOCUS_ART_PX / TRACK_FOCUS_BOARD_SQUARES;
const TRACK_FOCUS_MAX_HEIGHT_FRACTION = 0.92;
const TRACK_FOCUS_MAX_WIDTH_FRACTION = 0.55;
const TRACK_FOCUS_SNAP_FRACTION = 0.95;
// The gap between the board and its line of key hints while it's played, in the art's own pixels - see main.css.
const BOARD_HINTS_GAP_LINES = 4;

function updateTrackFocusScale(){
  if (!trackFocusEl) return;

  let available = Math.min(
    window.innerHeight * TRACK_FOCUS_MAX_HEIGHT_FRACTION,
    window.innerWidth * TRACK_FOCUS_MAX_WIDTH_FRACTION
  );
  let wholeScale = Math.floor(available / TRACK_FOCUS_ART_PX);
  let tile = wholeScale * TRACK_FOCUS_ART_PX >= available * TRACK_FOCUS_SNAP_FRACTION
    ? wholeScale * BOARD_TILE_PX
    : Math.floor(available / TRACK_FOCUS_BOARD_SQUARES);
  tile = Math.max(BOARD_TILE_PX, tile);
  trackFocusScale = tile / BOARD_TILE_PX;

  trackFocusEl.style.setProperty('--focus-line', Math.max(1, Math.round(trackFocusScale)) + 'px');
  trackFocusEl.style.setProperty('--focus-cell', tile + 'px');

  // Worked out here rather than left to CSS centering, which could land the art on a half pixel, and
  // its tiles with it. The left margin matches the top one, up to one tile - past that, the text can
  // make better use of the space.
  let top = Math.max(0, Math.floor((window.innerHeight - tile * TRACK_FOCUS_BOARD_SQUARES) / 2));
  trackFocusEl.style.setProperty('--focus-top', top + 'px');
  trackFocusEl.style.setProperty('--focus-left', Math.min(top, tile) + 'px');
  // Where the art sits centred while its board's being played, on a whole pixel like the rest. Higher up than
  // otherwise, so that it and the line of key hints under it are centred together, and the hints stay on screen.
  let board = tile * TRACK_FOCUS_BOARD_SQUARES;
  let hints = trackFocusEl.querySelector('#trackFocusActions');
  let hintsHeight = hints ? Math.ceil(hints.getBoundingClientRect().height) + BOARD_HINTS_GAP_LINES * Math.max(1, Math.round(trackFocusScale)) : 0;
  trackFocusEl.style.setProperty('--focus-centre', Math.max(0, Math.floor((window.innerWidth - board) / 2)) + 'px');
  trackFocusEl.style.setProperty('--focus-play-top', Math.max(0, Math.floor((window.innerHeight - board - hintsHeight) / 2)) + 'px');
}

// The Sokoban board: the ship walking a 10x10 grid over the album art, on the same reusable movement
// as the map (see sokoban.js). Everything is measured in the art's own pixels, then multiplied up by
// trackFocusScale to draw, so a window resize mid-game has nothing to rebuild and the ship always
// matches the art's pixel size. A track with a puzzle adds its rules to that - see buildBoardGame.
// How long a solved puzzle stays on screen. One that leads on to the next part's board only rests a moment before
// scrolling across to it. The board's own timings are puzzle.js's BOARD_TIMING - see board.js.
const BOARD_SCROLL_DELAY_MS = 150;
const BOARD_SCROLL_MS = 600;
const BOARD_SCROLL_DELTAS = { Up: { x: 0, y: -1 }, Down: { x: 0, y: 1 }, Left: { x: -1, y: 0 }, Right: { x: 1, y: 0 } };
const BOARD_SOLVED_PAUSE_MS = 800;
// img/ui/pilot-ship.png's own size.
const BOARD_SHIP_WIDTH = 12;
const BOARD_SHIP_HEIGHT = 16;

function startBoardGame(){
  if (!trackFocusEl || boardMover || focusTransition || !document.getElementById('trackFocusBoard') || partLockedBy(activeNode)) return;

  releaseDirections();
  runFocusTransition(() => flipFocus(() => {
    buildBoardGame();
    renderTrackFocus();
    renderBoardShip();
    showBoardTitle();
  }, true));
}

// Everything that starts fresh, whether that's starting the board or restarting it. facing is the way the ship
// starts out facing, if not up. visit is a board to carry on from instead, as it was left - see crossBoard - or
// just where to put the ship on a fresh one. Either way the ship is simply there, without arriving.
function buildBoardGame(facing, visit){
  let puzzle = nodeMeta.get(activeNode).puzzle;
  boardPuzzle = puzzle;
  boardSolvedMs = null;
  boardScroll = null;
  boardDrawnKey = null;

  boardPlay = WeaveBoard.createBoardPlay({
    puzzle,
    game: visit?.game ?? null,
    cell: visit?.cell ?? null,
    facing,
    hooks: {
      onEvent: onBoardEvent,
      onJump: () => {
        releaseDirections();
        breakContrails(boardContrails, boardMover.position);
      },
      onTeleported: () => breakContrails(boardContrails, boardMover.position),
      onLanded: () => {
        breakContrails(boardContrails, boardMover.position);
        releaseDirections();
      },
      onBlocked: onBoardBlocked,
    },
  });
  boardGame = boardPlay.game;
  boardMover = boardPlay.mover;
  boardContrails = createContrails(BOARD_SHIP_WIDTH / 12, BOARD_TILE_PX, boardMover.position);
}


function restartBoardGame(){
  if (!boardGame) return;

  boardVisits.delete(activeNode);
  releaseDirections();
  buildBoardGame();
  renderTrackFocus();
  renderBoardShip();
}


// Acts on what's just happened on the board, once board.js has: the page's own part of it.
function onBoardEvent(event){
  if (event.teleportTo) breakContrails(boardContrails, boardMover.position);
  if (event.finished) {
    markPuzzleSolved(nodeMeta.get(activeNode).puzzle);
    releaseDirections();
    if (connectedExit(chainIndex)) {
      boardSolvedMs = BOARD_SOLVED_PAUSE_MS - BOARD_SCROLL_DELAY_MS;
    } else {
      boardSolvedMs = 0;
      document.getElementById('trackFocusArt').appendChild(buildArtLabel('Solved'));
    }
  }
}

// Moves on from a solved board, like the next level of a game: straight into the next part's puzzle if it
// has one, or back to Track Focus to show what was unlocked if it doesn't. The last part just stays put. A
// board that's connected to the next scrolls across to it, as if they were side by side.
function finishBoardLevel(){
  let chain = nodeMeta.get(activeRoot).chain;
  let next = chain[chainIndex + 1];
  let exit = connectedExit(chainIndex);

  if (next && exit) {
    crossBoard(exit, chainIndex + 1);
  } else if (next && nodeMeta.get(next).puzzle) {
    chainIndex++;
    activeNode = next;
    releaseDirections();
    buildBoardGame();
    renderTrackFocus();
    showSceneLoading(trackFocusEl.querySelector('.trackFocusArtSlide > img'));
    renderBoardShip();
    showBoardTitle();
  } else {
    if (next) {
      chainIndex++;
      activeNode = next;
    }
    leaveBoardGame();
  }
}

// Pushing off the edge of a board, between connected boards: from a part's Start back across to the part
// before, onto its Finish, or from a solved Finish across to the next part again. So the ship can always cross
// back and forth, whatever has moved around on either board since.
function onBoardBlocked(cell, direction){
  if (!boardGame || boardSolvedMs !== null || boardScroll) return;
  let pushed = PUZZLE_DIRECTIONS[direction];
  let isAt = (object) => object && object.col === cell.col && object.row === cell.row;
  let here = nodeMeta.get(activeNode).puzzle;

  let back = chainIndex > 0 ? connectedExit(chainIndex - 1) : null;
  if (back && WeavePuzzle.exitDirectionOf(cell) === pushed && pushed === OPPOSITE_DIRECTIONS[back]
      && isAt(here.objects.find(object => object.kind === 'Start'))) {
    crossBoard(pushed, chainIndex - 1);
    return;
  }

  let ahead = connectedExit(chainIndex);
  if (ahead === pushed && isPuzzleSolved(here) && isAt(here.objects.find(object => object.kind === 'Finish')))
    crossBoard(pushed, chainIndex + 1);
}

const PUZZLE_DIRECTIONS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
const OPPOSITE_DIRECTIONS = { Up: 'Down', Down: 'Up', Left: 'Right', Right: 'Left' };

// Scrolls from this part's board across to a connected one's, the ship crossing the gap with them. This board
// is remembered as it's left, and the other picks up as it was last left, if it has been: otherwise it starts
// fresh with the ship coming in on the square across from where it left this one.
function crossBoard(exit, toIndex){
  let chain = nodeMeta.get(activeRoot).chain;
  boardVisits.set(activeNode, { game: boardGame, cell: boardMover.cell });

  let across = crossedTo(boardMover.cell, exit);
  chainIndex = toIndex;
  activeNode = chain[toIndex];
  let visit = boardVisits.get(activeNode) ?? { game: null, cell: across };

  let leaving = document.getElementById('trackFocusArtSlide');
  releaseDirections();
  buildBoardGame(exit.toLowerCase(), visit);
  renderTrackFocus();
  // A scroll is its own transition, and covering it would hide it.
  startBoardScroll(leaving, exit);
  renderBoardShip();
  showBoardTitle();
}

// The square on the next board across from one on this board's edge, leaving it in a direction.
function crossedTo(cell, exit){
  let last = TRACK_FOCUS_BOARD_SQUARES - 1;
  if (exit === 'Left') return { col: last, row: cell.row };
  if (exit === 'Right') return { col: 0, row: cell.row };
  if (exit === 'Up') return { col: cell.col, row: last };
  return { col: cell.col, row: 0 };
}

// The edge a part's board leads off to the next part's, if they're connected: its one Finish is on an edge, and
// the next part's Start is directly across from it. Otherwise null, and moving on is a plain jump.
function connectedExit(index){
  let chain = nodeMeta.get(activeRoot).chain;
  let next = chain[index + 1];
  let here = nodeMeta.get(chain[index]).puzzle;
  let there = next ? nodeMeta.get(next).puzzle : null;
  let entrance = WeavePuzzle.entranceAfter(here);
  let start = there?.objects.find(object => object.kind === 'Start');
  if (!entrance || !start || start.col !== entrance.col || start.row !== entrance.row) return null;
  return WeavePuzzle.exitDirectionOf(here.objects.find(object => object.kind === 'Finish'));
}

// Slides the board just left out of the frame, and the next part's in behind it from the far side, like
// walking between map screens. The ship crosses the gap onto the entrance as they go. The leaving layer is
// left as it was, a still picture of the moment it was finished, but without its ship, which is now the one
// crossing over.
function startBoardScroll(leaving, exit){
  leaving.querySelector('.trackFocusBoardShip')?.remove();
  for (const element of [leaving, ...leaving.querySelectorAll('[id]')]) element.removeAttribute('id');
  document.getElementById('trackFocusArt').prepend(leaving);
  boardScroll = { leaving, entering: document.getElementById('trackFocusArtSlide'), exit, ms: 0 };
  positionBoardScroll();
}

function boardScrollProgress(){
  let t = Math.min(1, boardScroll.ms / BOARD_SCROLL_MS);
  return t * t * (3 - 2 * t);
}

function positionBoardScroll(){
  let eased = boardScrollProgress();
  let delta = BOARD_SCROLL_DELTAS[boardScroll.exit];
  boardScroll.leaving.style.transform = `translate(${-delta.x * eased * 100}%, ${-delta.y * eased * 100}%)`;
  boardScroll.entering.style.transform = `translate(${delta.x * (1 - eased) * 100}%, ${delta.y * (1 - eased) * 100}%)`;
}

// Nothing else moves while the boards scroll, and whatever's pressed during it is let go of at the end.
function updateBoardScroll(dtMs){
  boardScroll.ms += dtMs;
  positionBoardScroll();
  renderBoardShip();
  drawBoardObjects();

  if (boardScroll.ms >= BOARD_SCROLL_MS) {
    boardScroll.leaving.remove();
    boardScroll.entering.style.transform = '';
    boardScroll = null;
    releaseDirections();
    renderBoardShip();
  }
}

// Flips back over from the board to the art, and the text alongside it.
function leaveBoardGame(){
  if (!boardMover || focusTransition) return;

  boardScroll = null;
  boardVisits.clear();
  releaseDirections();
  runFocusTransition(() => flipFocus(() => {
    boardMover = null;
    boardShipEl = null;
    boardContrails = null;
    boardGame = null;
    boardPlay = null;
    boardPuzzle = null;
    boardObjectsCanvas = null;
    boardObjectsImage = null;
    boardSolvedMs = null;
    renderTrackFocus();
  }, false));
}

function buildBoardShip(){
  boardShipEl = document.createElement('img');
  boardShipEl.id = 'trackFocusBoardShip';
  boardShipEl.className = 'trackFocusBoardShip';
  boardShipEl.src = 'img/ui/pilot-ship.png';
  return boardShipEl;
}

// How much bigger the ship looks at the top of a Jump Tile's leap - see board.js.
const BOARD_JUMP_RISE = 0.4;




function updateBoardGame(dtMs){
  if (!boardPlay) return;

  boardPlay.animate(dtMs);

  // Nothing moves while the board's still flipping in, though it's drawn as it turns.
  if (focusTransition) {
    drawBoardObjects();
    renderBoardShip();
    return;
  }

  if (boardScroll) {
    updateBoardScroll(dtMs);
    return;
  }

  // Holds still for a moment on a solved board, then moves on - see finishBoardLevel.
  if (boardSolvedMs !== null) {
    boardSolvedMs += dtMs;
    updateBoardContrails(dtMs);
    drawBoardObjects();
    if (boardSolvedMs >= BOARD_SOLVED_PAUSE_MS) finishBoardLevel();
    return;
  }

  boardPlay.step(dtMs);
  renderBoardShip();
  if (!boardPlay.jump && !boardPlay.teleport) updateBoardContrails(dtMs);
  drawBoardObjects();
}





// Everything on the board, at the art's own size, for CSS to scale up exactly as it does the art, so that their
// pixels line up - see board.js's frame. Only drawn when it would look any different from last time.
function drawBoardObjects(){
  if (!boardGame || !boardObjectsCanvas || !boardPuzzle) return;

  let { list, options, key } = boardPlay.frame(performance.now(), { pushHints: boardPushHints() });
  if (key === boardDrawnKey) return;
  boardDrawnKey = key;
  WeavePuzzle.renderBoard(boardObjectsImage, list, boardPuzzle, options);
  boardObjectsCanvas.getContext('2d').putImageData(boardObjectsImage, 0, 0);
}

function updateBoardContrails(dtMs){
  updateContrails(boardContrails, boardMover.position, boardMover.facing, dtMs);

  // Keeps up with a window resize here, since this is already measured against trackFocusScale every frame.
  let size = Math.round(TRACK_FOCUS_ART_PX * trackFocusScale);
  if (boardContrails.canvas.width !== size) {
    boardContrails.canvas.width = size;
    boardContrails.bounds = null;
    boardContrails.canvas.height = size;
  }

  drawContrails(boardContrails, trackFocusScale, 0, 0);
}

// The arrows saying which Push Blocks next to the ship could be pushed - see board.js's pushHints - but not while the
// board's flipping, scrolling to the next, or paused on being solved.
function boardPushHints(){
  if (!boardPlay || boardScroll || focusTransition || boardSolvedMs !== null) return [];
  return boardPlay.pushHints(performance.now());
}

function renderBoardShip(){
  // In mid-air from a Jump Tile: along a straight line between the squares, growing towards the middle of it.
  // Going between Teleporters: spinning, and faded, as it crosses - see board.js's shipPosition.
  let { x, y, t, spin, opacity } = boardPlay.shipPosition();
  let position = { x, y };
  let leap = t === null ? 1 : 1 + BOARD_JUMP_RISE * Math.sin(Math.PI * t);
  // Crossing the gap from the last board's Finish onto this one's entrance, while the boards scroll.
  if (boardScroll) {
    let delta = BOARD_SCROLL_DELTAS[boardScroll.exit];
    let behind = (1 - boardScrollProgress()) * BOARD_TILE_PX;
    position = { x: position.x - delta.x * behind, y: position.y - delta.y * behind };
  }
  let width = Math.round(BOARD_SHIP_WIDTH * trackFocusScale);
  let height = Math.round(BOARD_SHIP_HEIGHT * trackFocusScale);
  boardShipEl.style.width = width + "px";
  boardShipEl.style.height = height + "px";
  boardShipEl.style.left = (position.x * trackFocusScale - width / 2) + "px";
  boardShipEl.style.top = (position.y * trackFocusScale - height / 2) + "px";
  // Sprite's forward points "up" at rest, same as the map ship - see renderShip.
  boardShipEl.style.transform = "rotate(" + (FACING_ANGLES[boardMover.facing] + Math.PI / 2 + spin) + "rad) scale(" + leap + ")";
  boardShipEl.style.opacity = opacity;
}
