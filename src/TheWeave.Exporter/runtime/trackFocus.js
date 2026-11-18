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
//
// warped opens a location a Puzzle Warp has just taken the player to (see openWarpedBoard): a way in its own location's
// requirements don't hold back, and without the grow-from-the-card transition, since nothing on the map was clicked.
function openTrackFocus({ warped = false } = {}){
  if (trackFocusEl || !activeNode || focusTransition || (!warped && nodeMeta.get(activeRoot)?.locked)) return;

  // The card's own cover on the map, which grows into Track Focus's art. Its art is already loaded, so there's
  // nothing to wait for.
  let cardCover = nodeMeta.get(activeNode).info.querySelector(':scope > .songCover');

  trackFocusEl = document.createElement('div');
  trackFocusEl.id = 'trackFocus';

  renderTrackFocus();
  updateTrackFocusScale();
  document.documentElement.appendChild(trackFocusEl);
  if (!warped) runFocusTransition(() => growFromCard(trackFocusEl, cardCover, false));
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
      board.appendChild(buildBoardReflections());
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
  // A Puzzle Warp in progress only belongs to the board it led to: starting any other board (a restart of that one
  // aside) means the trip is over, and Back shouldn't take the player back through it. See warpToLocation.
  let pending = loadWarpPending();
  if (pending && pending.toNode !== puzzle.id) clearWarpPending();

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
  if (event.puzzleWarp) {
    // Out of the board's own step: rebuild it (a warp to this page's own location) or load another page, neither of
    // which can happen inside the mover's update - see warpToLocation.
    let target = event.puzzleWarp;
    releaseDirections();
    setTimeout(() => warpToLocation(target), 0);
    return;
  }
  if (event.finished) {
    markPuzzleSolved(nodeMeta.get(activeNode).puzzle);
    // Solving the location a warp led to is what keeps the player on this planet - see leaveBoardGame.
    let pending = loadWarpPending();
    if (pending && pending.toNode === nodeMeta.get(activeNode).puzzle.id) clearWarpPending();
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
function onBoardBlocked(cell, to, direction){
  // Only a step off the edge of the board crosses to another one; anything in the way on it isn't that.
  if (to || !boardGame || boardSolvedMs !== null || boardScroll) return;
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

// ---------- Puzzle Warps ----------

// A Puzzle Warp leaves a board for another location's puzzle, and leaving that one without solving it comes back - so
// what the page was doing when it left is kept in sessionStorage, not in memory: a warp to another planet is a real
// page load, and the page that left has nothing left to remember it with. `toNode` is what tells a later Back whether
// this trip is the one it is backing out of - see leaveBoardGame.
const WARP_PENDING_KEY = "weave-puzzle-warp";

function loadWarpPending(){
  try {
    let saved = sessionStorage.getItem(WARP_PENDING_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
}

function saveWarpPending(pending){
  try { sessionStorage.setItem(WARP_PENDING_KEY, JSON.stringify(pending)); } catch (e) { /* storage unavailable - the trip back is simply lost, as it is without it */ }
}

function clearWarpPending(){
  try { sessionStorage.removeItem(WARP_PENDING_KEY); } catch (e) { /* see saveWarpPending */ }
}

// A location's element by its id, which the page carries on every location with a puzzle - see PageRenderer's
// BuildPuzzleAttr. CSS.escape for a slug with anything odd in it.
function warpNodeElement(nodeId){
  return nodeId ? document.querySelector(`.node[data-node-id="${CSS.escape(nodeId)}"]`) : null;
}

// What the ship does when it stands on a Puzzle Warp: the player is taken out of this puzzle and into the target
// location's, wherever that is. Leaving that one without solving it comes back to this square, with this board as it
// starts; solving it keeps the player on the new planet. A warp ignores a location's requirements and a part's order.
function warpToLocation(target){
  if (!boardMover || focusTransition || !target?.node) return;

  saveWarpPending({
    fromPage: weavePage.file,
    fromNode: activeNode.dataset.nodeId,
    fromCell: { col: boardMover.cell.col, row: boardMover.cell.row },
    fromX: parseFloat(activeRoot.style.left) || 0,
    fromY: parseFloat(activeRoot.style.top) || 0,
    toPage: target.page,
    toNode: target.node,
  });

  releaseDirections();
  breakContrails(boardContrails, boardMover.position);

  // The same page: the other board is right here, so there's nothing to load. Otherwise the page the warp leads to is
  // opened standing on that location - see enterWarpedPage, which picks it up from the query.
  if (target.page === weavePage.file) {
    let node = warpNodeElement(target.node);
    if (node && openWarpedBoard(node)) return;
  }
  window.location.href = `${target.page}?warp=${encodeURIComponent(target.node)}&x=${Math.round(target.x ?? 0)}&y=${Math.round(target.y ?? 0)}`;
}

// Opens a location's board straight away, wherever the player came from: Track Focus already open (a warp on this
// page) or not yet (a page load that arrived by warping). The board starts as the puzzle starts, with the ship on its
// Start, or on `cell` where a return trip puts it back on the warp square.
function openWarpedBoard(node, cell = null){
  let root = node;
  for (let up = node.parentElement?.closest('.node'); up; up = up.parentElement?.closest('.node')) root = up;
  let meta = nodeMeta.get(root);
  let index = meta?.chain.indexOf(node) ?? -1;
  if (!meta || index < 0 || !nodeMeta.get(node)?.puzzle) return false;

  // A warp is a way in its location's requirements don't hold back, so it isn't locked for this visit either.
  meta.locked = false;
  activeRoot = root;
  activeNode = node;
  chainIndex = index;
  boardVisits.clear();
  releaseDirections();

  if (!trackFocusEl) openTrackFocus({ warped: true });
  buildBoardGame(undefined, cell ? { cell } : null);
  renderTrackFocus();
  updateTrackFocusScale();
  renderBoardShip();
  showBoardTitle();
  return true;
}

// Back on a board a warp led to, unsolved: come back to the square it was left from. On this page that's the board
// itself, starting again; on another it's a page load that puts the ship back on the location and opens the board
// there - see enterWarpedPage.
function returnToWarpSquare(pending){
  clearWarpPending();
  if (pending.fromPage === weavePage.file) {
    let node = warpNodeElement(pending.fromNode);
    if (node && openWarpedBoard(node, pending.fromCell)) return;
  }
  window.location.href = `${pending.fromPage}?warpBack=${encodeURIComponent(pending.fromNode)}`
    + `&cell=${pending.fromCell.col},${pending.fromCell.row}&x=${Math.round(pending.fromX ?? 0)}&y=${Math.round(pending.fromY ?? 0)}`;
}

// Where a page load lands when a Puzzle Warp brought the player here: ?warp=<location> is the warp's own arrival,
// ?warpBack=<location>&cell=<col>,<row> is the trip back to the square the warp was stepped on. Anything else is an
// ordinary page load, and any warp still remembered belongs to a trip the player has left behind.
function enterWarpedPage(){
  let params = new URLSearchParams(document.location.search);
  let arriving = params.get("warp");
  let returning = params.get("warpBack");
  let nodeId = arriving ?? returning;
  if (!nodeId) { clearWarpPending(); return; }

  let node = warpNodeElement(nodeId);
  if (!node || !nodeMeta.get(node)?.puzzle) { clearWarpPending(); return; }

  let cell = null;
  let [col, row] = (params.get("cell") ?? "").split(",").map(Number);
  if (Number.isInteger(col) && Number.isInteger(row)) cell = { col, row };
  if (returning) clearWarpPending();
  openWarpedBoard(node, cell);
}


// Scrolls from this part's board across to a connected one's, the ship crossing the gap with them. This board
// is remembered as it's left, and the other picks up as it was last left, if it has been: otherwise it starts
// fresh with the ship coming in on the square across from where it left this one.
function crossBoard(exit, toIndex){
  let chain = nodeMeta.get(activeRoot).chain;
  boardVisits.set(activeNode, { game: boardGame, cell: boardMover.cell });

  // Onward, always the next part's Start - see puzzle.js's crossingCell. A board here can be finished by a reflection
  // standing off at the far side of a pane, and then the ship is nowhere near the edge it is crossing from, so its own
  // square would put it down in the wrong place on the next board.
  let across = WeavePuzzle.crossingCell({
    next: nodeMeta.get(chain[toIndex]).puzzle,
    from: boardMover.cell,
    exit,
    onward: toIndex > chainIndex,
  });
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

  // A board a Puzzle Warp led to, left without solving it, goes back to the square it came from. Solving it is what
  // keeps the player here - see warpToLocation.
  let pending = loadWarpPending();
  if (pending && pending.toNode === boardPuzzle?.id) {
    if (!isPuzzleSolved({ id: pending.toNode })) { returnToWarpSquare(pending); return; }
    clearWarpPending();
  }

  boardScroll = null;
  boardVisits.clear();
  releaseDirections();
  runFocusTransition(() => flipFocus(() => {
    boardMover = null;
    boardShipEl = null;
    boardReflectionsEl = null;
    boardRefusedSilhouettes = null;
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

// A box for the reflections - one ship picture per pane showing one, tinted and see-through by main.css - panes facing
// each other show two, and a reflection in another pane's line shows a third, so how many there are is only known once
// the board's playing. See renderBoardReflections.
function buildBoardReflections(){
  boardReflectionsEl = document.createElement('div');
  boardReflectionsEl.id = 'trackFocusBoardReflections';
  boardReflectionsEl.className = 'boardReflections';
  return boardReflectionsEl;
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
  // A flashing obstruction blinks, which isn't part of the frame's key, so the board is drawn every frame while it does.
  let flashing = boardPlay.refusedFlash;
  if (!flashing && key === boardDrawnKey) return;
  if (!flashing) boardDrawnKey = key;
  WeavePuzzle.renderBoard(boardObjectsImage, list, boardPuzzle, options);
  boardObjectsCanvas.getContext('2d').putImageData(boardObjectsImage, 0, 0);
  drawSightLines();
  drawRefusedFlash();
}

// The line of sight from the ship to each reflection, dotted and faint, so it's plain which pane is showing it and how
// far away it is - and stronger when the reflection is what's refusing to let the ship move. A pane in line with the
// ship but with something between can't show a reflection at all, so its line runs only as far as whatever's in the way.
function drawSightLines(){
  let reflections = boardPlay.game?.reflections ?? [];
  let blocked = boardPlay.game?.blockedSights ?? [];
  if (!boardObjectsCanvas || (!reflections.length && !blocked.length)) return;
  let context = boardObjectsCanvas.getContext('2d');
  let ship = boardPlay.shipPosition();
  let refused = boardPlay.refusedFlash;
  let tile = BOARD_TILE_PX;
  context.save();
  context.lineWidth = 2;
  context.strokeStyle = refused ? 'rgba(255, 154, 60, 0.8)' : 'rgba(255, 154, 60, 0.25)';
  context.setLineDash(refused ? [3, 2] : [3, 3]);
  if (reflections.length) {
    context.beginPath();
    for (const reflection of reflections) {
      const line = WeavePuzzle.reflectionSightLine(reflection, ship, tile);
      context.moveTo(Math.round(line.from.x), Math.round(line.from.y));
      context.lineTo(Math.round(line.to.x), Math.round(line.to.y));
    }
    context.stroke();
  }

  if (blocked.length) {
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255, 154, 60, 0.35)';
    context.setLineDash([1, 2]);
    context.beginPath();
    for (const { blocker } of blocked) {
      context.moveTo(Math.round(ship.x), Math.round(ship.y));
      context.lineTo(Math.round((blocker.col + 0.5) * tile), Math.round((blocker.row + 0.5) * tile));
    }
    context.stroke();
  }
  context.restore();
}

// A step refused because a reflection couldn't follow leaves whatever stopped it flashing on the ship's side, on the
// square it tried to walk into, in the same orange as the reflection - so it's plain where the space is taken up.
function drawRefusedFlash(){
  let flash = boardPlay?.refusedFlash;
  if (!flash) return;
  let context = boardObjectsCanvas.getContext('2d');
  let tile = BOARD_TILE_PX;
  let life = 1 - flash.ms / flash.durationMs;
  let silhouette = flash.object ? refusedSilhouette(flash.object, boardPuzzle) : null;
  let blink = Math.max(0, life) * (Math.floor(flash.ms / 90) % 2 === 0 ? 0.75 : 0.3);
  context.save();
  context.imageSmoothingEnabled = false;
  if (silhouette) {
    context.globalAlpha = blink;
    context.drawImage(silhouette, 0, 0, tile, tile, Math.round(flash.col * tile), Math.round(flash.row * tile), tile, tile);
  }
  context.globalAlpha = Math.max(0, life);
  context.strokeStyle = '#ff9a3c';
  context.lineWidth = 2;
  context.strokeRect(Math.round(flash.col * tile) + 1, Math.round(flash.row * tile) + 1, tile - 2, tile - 2);
  context.restore();
}

// Whatever stopped the ship, as the reflection sees it, for that flash: its own picture in the reflection's orange, on
// its own and see-through everywhere else. Kept once drawn, since a flash always shows the same thing.
let boardRefusedSilhouettes = null;

function refusedSilhouette(object, look){
  if (!look) return null;
  boardRefusedSilhouettes ??= new Map();
  let key = [object.kind, object.symbol, object.letter, object.archeton, object.direction, object.open].join('|');
  let silhouette = boardRefusedSilhouettes.get(key);
  if (silhouette) return silhouette;
  silhouette = document.createElement('canvas');
  silhouette.width = WeavePuzzle.ART_PX;
  silhouette.height = WeavePuzzle.ART_PX;
  let context = silhouette.getContext('2d');
  let image = context.createImageData(WeavePuzzle.ART_PX, WeavePuzzle.ART_PX);
  WeavePuzzle.renderBoard(image, [{ ...object, col: 0, row: 0, fromCol: 0, fromRow: 0 }], look, {});
  context.putImageData(image, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = '#ff9a3c';
  context.fillRect(0, 0, WeavePuzzle.ART_PX, WeavePuzzle.ART_PX);
  boardRefusedSilhouettes.set(key, silhouette);
  return silhouette;
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
  renderBoardReflections();
}

// Where a Reflect Mimic shows the ship's reflection, from puzzleRules.js's reflections and reflectionPosition: each moved
// to wherever its pane mirrors where its source is being drawn, so the whole chain glides with the ship. Extra pictures
// keep their element and hide, so a board that shows three and then one doesn't rebuild them every frame.
function renderBoardReflections(){
  if (!boardReflectionsEl || !boardPlay) return;
  let reflections = boardPlay.game?.reflections ?? [];
  let position = boardPlay.shipPosition();
  let width = Math.round(BOARD_SHIP_WIDTH * trackFocusScale);
  let height = Math.round(BOARD_SHIP_HEIGHT * trackFocusScale);
  while (boardReflectionsEl.children.length < reflections.length) {
    let image = document.createElement('img');
    image.className = 'trackFocusBoardShip boardReflection';
    image.src = 'img/ui/pilot-ship.png';
    boardReflectionsEl.appendChild(image);
  }
  for (let index = 0; index < boardReflectionsEl.children.length; index++) {
    let image = boardReflectionsEl.children[index];
    let reflection = reflections[index];
    image.style.display = reflection ? "" : "none";
    if (!reflection) continue;
    let mirrored = WeavePuzzle.reflectionPosition(reflection, position, BOARD_TILE_PX);
    image.style.width = width + "px";
    image.style.height = height + "px";
    image.style.left = (mirrored.x * trackFocusScale - width / 2) + "px";
    image.style.top = (mirrored.y * trackFocusScale - height / 2) + "px";
    // Facing back at the ship when it faces the pane, and the way it's going when it walks along the pane's line: its
    // picture points up at rest, as the ship's does - see puzzleRules.js's reflectionFacing.
    image.style.transform = "rotate(" + (FACING_ANGLES[WeavePuzzle.reflectionFacing(reflection, boardMover.facing)] + Math.PI / 2) + "rad)";
  }
}
