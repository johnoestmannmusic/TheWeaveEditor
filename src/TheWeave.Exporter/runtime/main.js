// main.js
// John Oestmann
// All JS functionality for The Weave Explorer in here
//
// Navigation: walk the ship one square at a time with Arrow Keys, a gamepad D-pad, or a gamepad
// stick - hold a direction to keep going, let go to stop on the square you're heading into (see
// sokoban.js, which owns the movement itself). Press Z (keyboard) or A (gamepad) to interact with
// whatever location the ship is standing on - travels to its linked page, or opens a track's Track
// Focus screen. When that location has extra nested locations tucked inside its card (a multi-part
// story), press X (keyboard) or X (gamepad) in Track Focus to step between them. Z / A in Track Focus
// starts the Sokoban board over the album art, and C (keyboard) or B (gamepad) backs out of it. X / X
// restarts the board's puzzle, and solving one unlocks the location's next part and moves on to it.
//
// This file is the canonical shared runtime owned by TheWeave.Exporter - it's
// generated into every exported site's jsx/main.js, not hand-edited there.

// DEBUGGER
let debugging = false; // True turns on debugging
let debugImg;

// Page setup
let nodeList;
let nodeMeta = new Map(); // node element -> { img, info, persistent, isModal, isTopLevel, chain }
let tutorialSwitch = "on";

// CardSize.Modal cards (a screen-centered popup, e.g. a tutorial/news card - see loadNodes'
// isModal handling and #modalBackdrop in main.css) pending/currently shown, in document order.
// Z/gamepad A closes modalQueue[0] and reveals the next one instead of doing their usual
// onInteract()/cycleChainNode() - see bindInput/updateInput - for as long as this is non-empty.
let modalQueue = [];
let modalBackdrop = null;
// The open Track Focus screen's root element, or null while it's closed - see openTrackFocus.
let trackFocusEl = null;
let trackFocusScale = 1; // scale the art is drawn at - see updateTrackFocusScale
// The Sokoban board's own mover and ship while it's being played, null otherwise - see startBoardGame.
let boardMover = null;
let boardShipEl = null;
let boardContrails = null;
// While a track's puzzle is being played: its rules (see puzzle.js's createPuzzleGame), the canvas its
// objects are drawn on, and how far through the current Stream tick it is. Null for a track with no puzzle.
let boardGame = null;
let boardObjectsCanvas = null;
let boardObjectsImage = null; // the art-sized pixels drawn onto that canvas - see drawBoardObjects
let boardStreamMs = 0;
// A Rotator tile's clocks: how long the ship has been on its Switch since things last moved, how long since
// they last moved at all, for their glide, and the total it's been active, for its animation.
let boardRotatorActiveMs = 0;
let boardRotatorGlideMs = 0;
let boardRotatorClockMs = 0;
let boardSolvedMs = null; // how long ago it was solved, while pausing there before returning to Track Focus
let activeNode = null;   // the current track: activeRoot, or the chain member Track Focus is on
let activeRoot = null;   // the top-level node the ship is currently within range of
let chainIndex = 0;      // activeNode's position within activeRoot's chain
let arrivalRoot = null;  // the node back to The Weave the ship arrived on and hasn't left yet - see noteArrivalRoot

// The page's own config (see window.__weavePage, emitted per-page by PageConfigScriptRenderer) -
// worldWidth/worldHeight are the page's authoritative world size, and grid is the board of squares
// the ship walks (see loadPageConfig).
let weavePage = { globeEffect: false, worldWidth: 0, worldHeight: 0, defaultSpawnX: null, defaultSpawnY: null, isHomePage: false, grid: null, screen: null };


// Ship tuning
const SHIP_WIDTH = 40;
const SHIP_HEIGHT = SHIP_WIDTH * 16 / 12; // keeps img/ui/pilot-ship.png's 12x16 shape
const NODE_ICON_SIZE = 48; // matches .nodeImage's width in main.css
const STEP_MS = 240; // how long walking one square takes
const MS_PER_FRAME = 1000 / 60; // loop()'s dt is measured in 60fps frames
// Sprite rotation for each direction sokoban.js can be facing.
const FACING_ANGLES = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };

// Contrail tuning (see createContrails). The offset, width and hidden length are in pixels of
// img/ui/pilot-ship.png, whatever size it's drawn at: its two engines are 2.5 of them either side of
// center, and its tail is 8 behind it. CONTRAIL_TURN_SQUARES sets how long a stretch of path each turn
// is rounded over, in squares, and CONTRAIL_FADE_STEPS how many separate opacities its fade is drawn
// with. Orange reads as thrusters in space, while white-grey reads as vapor over a planet.
const CONTRAIL_OFFSET = 2.5;
const CONTRAIL_WIDTH = 1;
const CONTRAIL_UNDER_SHIP = 7;
const CONTRAIL_TURN_SQUARES = 1;
const CONTRAIL_FADE_STEPS = 24;
const CONTRAIL_LIFE_MS = 1250;
const CONTRAIL_SPACE = { color: 'rgb(255, 140, 40)', opacity: 0.85 };
const CONTRAIL_PLANET = { color: 'rgb(240, 240, 245)', opacity: 0.8 };

// Location audio tuning (see updateLocationAudio). PRELOAD_SQUARES controls how many steps away a
// track starts buffering - location tracks are commonly hosted at an external URL (see
// Card.Audio.Url), so buffering has to have a head start on the ship arriving or there'd be a silent
// gap right as a location should start fading in. AUDIO_VOLUME_EASE is a per-frame retention factor,
// applied as Math.pow(x, dt): at this value, crossing a square without stopping (one STEP_MS) swells
// to about half volume, and stopping on one reaches full volume in about a second.
const PRELOAD_SQUARES = 3;
const AUDIO_VOLUME_EASE = 0.95;
// Well above a typical stick's resting drift: pushing it now picks one of four whole directions
// (see readPadDirection) rather than a proportional amount of anything, so a light, accidental lean
// shouldn't walk the ship anywhere.
const GAMEPAD_DEADZONE = 0.5;

// The view: one static screen of the map at a time (see updateView). SOURCE_SCREEN_WIDTH/HEIGHT are
// one screen's size in the map art's own pixels, which only its shape matters for - see
// updateViewScale. CARD_SCREEN_MARGIN keeps an open card from touching the screen's edge - see placeCard.
const SOURCE_SCREEN_WIDTH = 250;
const SOURCE_SCREEN_HEIGHT = 133;
const SCREEN_SLIDE_MS = 300;
const CARD_SCREEN_MARGIN = 8;

// Ship state - x/y/angle are copied from playerMover every frame (see syncShipToMover), which is
// what actually decides where the ship is.
let shipEl;
let ship = {
  x: 0,
  y: 0,
  angle: FACING_ANGLES.up, // sprite's forward (top of image) starts facing "up"
};
let playerMover = null; // see sokoban.js's createMover - built by initShip

// "col,row" -> the top-level node sitting on that square (see indexNodesByCell), which is how the
// ship finds out what it's standing on.
let rootByCell = new Map();

// View state, in world coordinates: where the top-left of the picture is right now (position), and
// the slide underway to a new screen, if any.
let view = { position: null, slide: null, scale: 1, offsetX: 0, offsetY: 0 };
let screenFrameEl = null; // see buildScreenFrame
let minimap = null; // see buildMinimap
let mapContrails = null; // the ship's on the map - see buildMapContrails

// Input state
const KEY_DIRECTIONS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
let padDirection = null; // whichever direction the gamepad is currently holding on playerMover
// Start out as held: each page is a fresh load, so a button held through a Travel has to be let go
// before it counts again, or holding A would bounce between two pages for as long as it's held.
let gamepadInteractWasDown = true;
let gamepadCycleWasDown = true;
let gamepadBackWasDown = true;
let lastFrameTime = null;

// Order of initialization
document.addEventListener('DOMContentLoaded', function() {
  // loadPageConfig runs first: initShip needs the grid it builds. A crossfade effect's own #bgmap2
  // is already present in the static markup regardless of this order (PageRenderer renders it
  // whenever Page.SecondaryBackground is set, which CrossfadeLayerEffect keeps in sync with - see
  // ProjectEditing's SyncSecondaryBackground).
  loadPageConfig();
  applyPageEffects();
  initShip();
  loadNodes();
  indexNodesByCell();
  noteArrivalRoot();
  buildScreenFrame();
  buildMinimap();
  buildMapContrails();
  updateViewScale();
  placePersistentCards();
  bindInput();
  claimOwnFocus();
  requestAnimationFrame(loop);

  // DEBUGGER
  if (debugging){
    debugImg = new Image(48,48);
    debugImg.src = "./img/node-debug.png";
    document.body.appendChild(debugImg);
    console.log("DEBUGGER TURNED ON");

    document.addEventListener('mousemove', (e) => debug(e));
    document.addEventListener('mousedown', (e) => debugClick(e));
  }

})

// DEBUGGER
function debug(e){
  let x = e.pageX - 40;
  let y = e.pageY - 40;
  debugImg.style.left = (x + "px");
  debugImg.style.top = (y + "px");
}

function debugClick(e){
  let x = e.pageX - 40;
  let y = e.pageY - 40;
  console.log(document.title + " | DEBUG CLICK | left: "+x+"px; top: "+y + "px;");
}

function clamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}

// Reads window.__weavePage and makes the world size real: body and both background layers get
// explicitly sized to it, rather than relying on whatever size the background image happens to
// be. This is what per-page WorldWidthPx/HeightPx actually needs to work in the exported site (the
// editor canvas already honors it - see app.js's worldW/worldH). Also builds the page's grid of
// walkable squares, from the geometry GridLayout worked out for this page's map.
function loadPageConfig(){
  let cfg = window.__weavePage;

  weavePage.globeEffect = !!cfg.globeEffect;
  weavePage.worldWidth = cfg.worldWidth;
  weavePage.worldHeight = cfg.worldHeight;
  weavePage.grid = WeaveSokoban.createGrid(cfg.grid);
  weavePage.screen = cfg.screen;
  // Page.DefaultSpawnX/Y - where initShip() puts the ship when this page is opened with no
  // travel/query-string position at all (e.g. a bare URL, or the shell's iframe on first load).
  // Null/undefined (no Page override configured) leaves these null - initShip() itself falls
  // back to its own hardcoded default in that case.
  weavePage.defaultSpawnX = cfg.defaultSpawnX ?? null;
  weavePage.defaultSpawnY = cfg.defaultSpawnY ?? null;

  // Whether this is WeaveProject.HomePageId's own page - see updateHubMusicSignal.
  weavePage.isHomePage = !!cfg.isHomePage;

  document.body.style.width = weavePage.worldWidth + "px";
  document.body.style.height = weavePage.worldHeight + "px";

  for (const id of ['bgmap', 'bgmap2']) {
    let img = document.getElementById(id);
    if (!img) continue;
    img.style.width = weavePage.worldWidth + "px";
    img.style.height = weavePage.worldHeight + "px";
  }
}

// The dark surround that hides everything outside the current screen, including the neighbouring
// screens, and, on a page with Page.GlobeEffect, the edge vignette (see #globeVignette in main.css).
//
// Appended to <html>, deliberately *not* document.body - body gets a `transform` every frame (see
// updateView), and per the CSS spec a `transform` on an ancestor changes what a `position: fixed`
// descendant is contained by: instead of the viewport, it becomes the *transformed ancestor's own
// box* - here, the whole world, not the screen. <html> itself never gets a transform, so a fixed child
// of it is immune to that.
function buildScreenFrame(){
  screenFrameEl = document.createElement('div');
  screenFrameEl.id = 'screenFrame';

  if (weavePage.globeEffect) {
    let vignette = document.createElement('div');
    vignette.id = 'globeVignette';
    screenFrameEl.appendChild(vignette);
  }

  document.documentElement.appendChild(screenFrameEl);
}

// Set up the ship's starting square (from URL params, or a sane default) and the DOM element that
// represents it. Whatever position that comes to, it snaps to the nearest square - a travel link
// or page default is free to say roughly where, not exactly which square.
function initShip() {

  let params = new URLSearchParams(document.location.search);
  let startX = parseInt(params.get("x"));
  let startY = parseInt(params.get("y"));
  let destX  = parseInt(params.get("destX"));
  let destY  = parseInt(params.get("destY"));
  tutorialSwitch = params.get("tutorial");

  // The same square a planet is entered from - see GridLayout.EntrySquare.
  let entry = weavePage.grid.centerOf({ col: 0, row: 0 });
  let spawnX = entry.x;
  let spawnY = entry.y;

  if (!isNaN(destX) && !isNaN(destY)) {
    spawnX = destX;
    spawnY = destY;
  } else if (!isNaN(startX) && !isNaN(startY)) {
    spawnX = startX;
    spawnY = startY;
  } else if (weavePage.defaultSpawnX !== null && weavePage.defaultSpawnY !== null) {
    // Page.DefaultSpawnX/Y (see loadPageConfig) - this page's own configured spot for "opened
    // with nothing telling it where to put the ship", e.g. a bare URL or the shell's iframe on
    // first load.
    spawnX = weavePage.defaultSpawnX;
    spawnY = weavePage.defaultSpawnY;
  }

  playerMover = WeaveSokoban.createMover(weavePage.grid, {
    cell: weavePage.grid.cellAt(spawnX, spawnY),
    stepMs: STEP_MS,
  });
  syncShipToMover();

  console.log("PARAMS | x: " + startX + " y: " + startY + " | destX: " + destX + " destY: " + destY + " | tutorial: " + tutorialSwitch);

  shipEl = document.createElement('img');
  shipEl.id = 'playerShip';
  shipEl.className = 'playerShip';
  shipEl.src = 'img/ui/pilot-ship.png';
  document.body.appendChild(shipEl);

  renderShip();
}

function loadNodes() {

  // Create an array of all location nodes
  nodeList = document.querySelectorAll(".node");

  nodeList.forEach(curNode => {

    let curImg = curNode.querySelector(".nodeImage");
    let curInfo = curNode.querySelector(".floatInfo");

    // Tutorial / shrine intro cards stay open on load like before, and are
    // otherwise left alone by the proximity system (only the interact
    // button will toggle them shut once the ship is near them). Driven by
    // a data attribute (rather than hardcoded ids) so any node can opt in.
    let persistent = curNode.dataset.persistent === "true";

    // A CardSize.Modal card (see main.css's #modalBackdrop comment) is a screen-centered popup,
    // not a world location - shown/hidden entirely through modalQueue below, on its own timing,
    // rather than the plain display:'' every other persistent card gets here. Its .floatInfo is
    // reparented to <html> so its `position: fixed` is relative to the real viewport instead of
    // <body> - <body> gets a `transform` applied every frame by updateView(), which (per the CSS spec) makes any `position: fixed` descendant fixed
    // relative to *that transformed box* instead of the viewport. This is the exact same trap
    // buildScreenFrame() already had to work around for #screenFrame - see its own comment for
    // the full mechanics. (A modal card with nested child locations isn't supported: they'd move
    // out of curNode along with curInfo here, so cycleChainNode's querySelectorAll('.node')
    // would never find them - fine for a tutorial/news popup, not a multi-part location.)
    let isModal = curNode.dataset.modal === "true";
    if (isModal) {
      document.documentElement.appendChild(curInfo);

      // The "[ Close ]" action PageRenderer renders for every modal card (see its own comment) -
      // clicking it does the same thing Z/gamepad A or clicking the backdrop already does.
      let closeAction = curInfo.querySelector('.modal-close-action');
      if (closeAction) closeAction.addEventListener('click', closeCurrentModal);
    } else if (persistent && tutorialSwitch !== "off") {
      curInfo.style.display = '';
      curNode.classList.add('cardOpen'); // see setCardOpen()'s own comment
    }

    let curAudio = curInfo.querySelector('.songPlayer');

    nodeMeta.set(curNode, {
      img: curImg,
      info: curInfo,
      persistent: persistent,
      isModal: isModal,
      modalId: curNode.dataset.modalId ?? null, // only set for isModal nodes - see PageRenderer
      // A nested "next page" story node lives inside its parent's .floatInfo
      // card rather than out on the map - .closest('.node') starting from
      // the parent finds that ancestor for those, and finds nothing for a
      // node whose parent is <body>.
      isTopLevel: !curNode.parentElement.closest(".node"),
      chain: null, // filled in below, top-level nodes only
      // This node's .songPlayer (null if it has none) - see updateLocationAudio, which is the
      // only thing driving a non-modal node's audio now (a modal's own <audio controls> is left
      // to the visitor, untouched by that system). audioPreloaded latches true the first time
      // this element's buffering is kicked off, so that only ever happens once per element.
      audio: curAudio,
      audioPreloaded: false,
      // Whether this node's Travel action leads back to the project's home page - see
      // updateHubMusicSignal, which fades the shell's hub theme in as the ship approaches one.
      travelHome: curNode.dataset.travelHome === "true",
      puzzle: curNode.dataset.puzzle ? JSON.parse(curNode.dataset.puzzle) : null,
    });

    if (curAudio && !isModal) curAudio.volume = 0; // updateLocationAudio eases this up from silence

    // The card's own "[ Enter ]" action (see PageRenderer) - same thing as Z/gamepad A. :scope so a
    // chain member's card never binds a nested member's action instead.
    let focusAction = curInfo.querySelector(':scope > .poetry-text > .poetry-focus .focus-action');
    if (focusAction) focusAction.addEventListener('click', openTrackFocus);

  });

  // A multi-part location's nested nodes aren't reachable by walking to them - X in Track Focus
  // instead steps through each top-level node's own chain (itself, then every descendant,
  // depth-first). Branching Children would flatten into one cycle order here too, though in practice
  // these are linear chains.
  nodeMeta.forEach((meta, node) => {
    if (meta.isTopLevel)
      meta.chain = [node, ...node.querySelectorAll(".node")];
  });

  // Modal cards (CardSize.Modal) show one at a time, in document order, regardless of ship
  // position - closeCurrentModal() (wired to Z/gamepad A - see bindInput/updateInput) advances
  // to the next one, and marks it seen (see hasSeenModal) so it doesn't come back on a later
  // page within the same visit - just traveling to a planet and back shouldn't re-show it.
  // tutorialSwitch's "off" already governs whether a *persistent* card shows at all here, same
  // opt-out every other persistent card gets (see the loop above).
  nodeMeta.forEach((meta, node) => {
    if (meta.isTopLevel && meta.isModal && meta.persistent && tutorialSwitch !== "off" && !hasSeenModal(meta.modalId))
      modalQueue.push(node);
  });
  showCurrentModal();

};

// Maps every top-level node to the square it sits on, for updateNodeProximity and
// updateLocationAudio. Reads the authored position rather than a live measurement, since this runs
// before images have loaded and an unloaded icon doesn't have its real height yet. A nested node
// never gets an entry: it's reached by X from its root, not by being walked to.
function indexNodesByCell(){
  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;

    let x = (parseFloat(node.style.left) || 0) + NODE_ICON_SIZE / 2;
    let y = (parseFloat(node.style.top) || 0) + NODE_ICON_SIZE / 2;
    meta.cell = weavePage.grid.cellAt(x, y);
    let key = cellKey(meta.cell);
    if (!rootByCell.has(key)) rootByCell.set(key, node);
  });
}

function cellKey(cell){
  return cell.col + "," + cell.row;
}

// A planet is entered standing right on its node back to The Weave. That node stays asleep until the
// ship has stepped off it - see updateNodeProximity - so arriving doesn't open its card, or leave Z
// one press away from going straight back.
function noteArrivalRoot(){
  let root = rootByCell.get(cellKey(playerMover.cell));
  if (root && nodeMeta.get(root).travelHome) arrivalRoot = root;
}

// sessionStorage (not localStorage) so a modal comes back on a genuinely new visit - opening the
// site again after closing the tab/browser - but not on every page loaded during the *same*
// visit, which is what "travel to a planet and back re-opens it" actually meant: each page is a
// real, separate document load (see this whole site's multi-page architecture), so nothing short
// of storage remembers this across them. Wrapped defensively because storage access can throw
// in some embedding contexts (a locked-down file:// origin, a browser with storage blocked) -
// treated as "never seen" on read and silently ignored on write, so a modal card degrades to
// "shows every time" there rather than breaking the page.
const MODAL_SEEN_KEY_PREFIX = "weave-modal-seen:";

function hasSeenModal(modalId){
  if (!modalId) return false;
  try {
    return sessionStorage.getItem(MODAL_SEEN_KEY_PREFIX + modalId) === "true";
  } catch (e) {
    return false;
  }
}

function markModalSeen(modalId){
  if (!modalId) return;
  try {
    sessionStorage.setItem(MODAL_SEEN_KEY_PREFIX + modalId, "true");
  } catch (e) {
    // storage unavailable - the modal will just show again next page load, see header above.
  }
}

// Shows modalQueue[0] (a no-op if the queue is empty - e.g. every page load with no modal card
// due, or none left to show), creating the dimming backdrop on first use. Clicking the backdrop
// itself also dismisses the current modal, same as Z/gamepad A - a common enough modal
// convention that leaving it out would read as a missing feature, not a deliberate omission.
function showCurrentModal(){
  if (modalQueue.length === 0) return;

  if (!modalBackdrop) {
    modalBackdrop = document.createElement('div');
    modalBackdrop.id = 'modalBackdrop';
    modalBackdrop.addEventListener('click', closeCurrentModal);
    document.documentElement.appendChild(modalBackdrop);
  }

  nodeMeta.get(modalQueue[0]).info.style.display = '';
}

// Dismisses modalQueue[0] and reveals the next queued modal, if any; removes the backdrop once
// none are left. Bound to Z/gamepad A while the queue is non-empty (see bindInput/updateInput) -
// callers don't need to check modalQueue.length themselves first, this is already a no-op on an
// empty queue.
function closeCurrentModal(){
  if (modalQueue.length === 0) return;

  let meta = nodeMeta.get(modalQueue[0]);
  meta.info.style.display = 'none';
  markModalSeen(meta.modalId);
  modalQueue.shift();

  if (modalQueue.length > 0) {
    showCurrentModal();
  } else if (modalBackdrop) {
    modalBackdrop.remove();
    modalBackdrop = null;
  }
}

// Tells the shell the visitor has actually interacted with this page - keyboard or gamepad
// input. This is what lets the shell unmute its hub-theme track (autoplay policies require a
// genuine gesture, and a keypress that lands inside this iframe is one even though the shell's
// own top-level document never directly saw it - see shell.js's bindBackgroundMusic). Sent at
// most once per page load; every input source that can trigger it shares this one flag.
let shellInteractionNotified = false;
function notifyShellOfInteraction(){
  if (shellInteractionNotified || window.parent === window) return;
  shellInteractionNotified = true;
  window.parent.postMessage({ source: 'weave-interaction' }, '*');
}

// When this page is embedded in the persistent shell's iframe (see shell.js), arrow-key movement
// needs real keyboard events to land in THIS document, not the shell's. The shell tries to
// help by calling this iframe's contentWindow.focus() from the outside, but that's a parent
// reaching into a child - browsers are free to silently ignore it as focus-stealing protection,
// and Chrome in particular does exactly that whenever the two documents don't share an origin
// (which is every local file:// export, since Chrome gives each file:// document its own
// opaque origin - confirmed empirically, not assumed). Left unclaimed, focus stays on the
// <iframe> element itself in the shell's own document, and the browser's default action for
// arrow keys on a focused, scrollable iframe is to nudge *its own viewport* by a small native
// increment - which is exactly what reads as "the page slides around a little, ship staying
// still": the game's own keydown listener below never sees the event at all.
//
// The fix is for this document to claim its own focus instead of waiting to be given it - a
// frame focusing itself is always allowed, regardless of cross-origin embedding, since nothing
// is reaching across the boundary. document.body needs a tabindex to be focusable at all (plain
// <body> isn't by default); preventScroll avoids any incidental scroll-into-view side effect
// from the focus() call itself.
function claimOwnFocus(){
  document.body.setAttribute('tabindex', '-1');
  document.body.focus({ preventScroll: true });
}

function bindInput(){

  document.addEventListener('keydown', (e) => {
    notifyShellOfInteraction();

    // Stops the browser's own default handling of these keys (page/iframe scroll for the
    // arrows, in particular) from ever competing with the game's own movement - see
    // claimOwnFocus's header for the failure mode this guards against.
    let direction = KEY_DIRECTIONS[e.key];
    // Not with Ctrl/Cmd held, which is still the browser's own copy (of a poem in Track Focus, say).
    let backKey = (e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey;
    if (direction || backKey || e.key === 'z' || e.key === 'Z' || e.key === 'x' || e.key === 'X') {
      e.preventDefault();
    }

    // Not on e.repeat: a key held since before the board started shouldn't reach its new mover.
    if (direction && !e.repeat) activeMover().press(direction);

    if ((e.key === 'z' || e.key === 'Z') && !e.repeat) onInteractButton();
    if ((e.key === 'x' || e.key === 'X') && !e.repeat) onSwitchButton();
    if (backKey && !e.repeat) onBackButton();
  });

  document.addEventListener('keyup', (e) => {
    let direction = KEY_DIRECTIONS[e.key];
    if (direction) activeMover().release(direction);
  });

  window.addEventListener('resize', updateTrackFocusScale);
  window.addEventListener('resize', updateViewScale);

  // A key released while another window has focus never fires keyup here - without this, the ship
  // would keep walking until it hit the edge of the map.
  window.addEventListener('blur', releaseDirections);

  // Gamepads don't fire events for stick movement, so they're polled each
  // frame in updateInput() instead - nothing to bind here besides buttons,
  // which are also polled for the same reason (press-and-release edges).
}

// getGamepads() throws (SecurityError) rather than just returning nothing when the Gamepad API
// is denied by permissions policy - notably, an opaque-origin iframe (which is what every
// file://-opened exported site's shell iframe is - confirmed empirically) can never be granted
// it via the shell's own <iframe allow="gamepad">, no matter what that attribute says. Left
// uncaught, that exception would escape updateInput() and loop() entirely, which - since an
// uncaught exception in a requestAnimationFrame callback stops that callback from ever rescheduling
// itself - would silently kill keyboard controls and the whole render loop too, not just gamepad
// support. Tracking this in a flag (rather than a try/catch every single frame forever) means the
// one denial is paid once; every frame after that just skips straight past gamepad polling, leaving
// keyboard movement completely unaffected.
let gamepadSupported = true;

// Keyboard directions go straight to playerMover as they happen (see bindInput) - only the gamepad
// needs polling, feeding playerMover the same press/release events whenever its direction changes.
function updateInput(){

  let pads = null;
  if (gamepadSupported && navigator.getGamepads) {
    try {
      pads = navigator.getGamepads();
    } catch (e) {
      gamepadSupported = false;
    }
  }

  let nextPadDirection = null;

  if (pads) {
    for (let i = 0; i < pads.length; i++) {
      let pad = pads[i];
      if (!pad) continue;

      nextPadDirection = readPadDirection(pad);
      if (nextPadDirection) notifyShellOfInteraction();

      let aDown = !!(pad.buttons[0] && pad.buttons[0].pressed);
      if (aDown) notifyShellOfInteraction();
      if (aDown && !gamepadInteractWasDown) onInteractButton();
      gamepadInteractWasDown = aDown;

      // Standard gamepad mapping: button 1 is B (Xbox) / Circle (PlayStation).
      let bDown = !!(pad.buttons[1] && pad.buttons[1].pressed);
      if (bDown && !gamepadBackWasDown) onBackButton();
      gamepadBackWasDown = bDown;

      // Standard gamepad mapping: button 2 is X (Xbox) / Square (PlayStation).
      let xDown = !!(pad.buttons[2] && pad.buttons[2].pressed);
      if (xDown && !gamepadCycleWasDown) onSwitchButton();
      gamepadCycleWasDown = xDown;

      break; // only the first connected gamepad drives the ship
    }
  }

  if (nextPadDirection !== padDirection) {
    if (padDirection) activeMover().release(padDirection);
    if (nextPadDirection) activeMover().press(nextPadDirection);
    padDirection = nextPadDirection;
  }
}

// One of the four directions, or null: the D-pad if it's pressed (standard gamepad mapping: buttons
// 12-15), otherwise whichever axis the stick is pushed furthest along.
function readPadDirection(pad){
  if (pad.buttons[12] && pad.buttons[12].pressed) return 'up';
  if (pad.buttons[13] && pad.buttons[13].pressed) return 'down';
  if (pad.buttons[14] && pad.buttons[14].pressed) return 'left';
  if (pad.buttons[15] && pad.buttons[15].pressed) return 'right';

  let ax = pad.axes[0] || 0;
  let ay = pad.axes[1] || 0;
  if (Math.max(Math.abs(ax), Math.abs(ay)) < GAMEPAD_DEADZONE) return null;
  if (Math.abs(ax) > Math.abs(ay)) return ax > 0 ? 'right' : 'left';
  return ay > 0 ? 'down' : 'up';
}

function updateShip(dt){

  let dtMs = dt * MS_PER_FRAME;

  // A modal card or Track Focus traps input entirely while it's showing - the ship simply doesn't
  // move, and a press made underneath it doesn't suddenly fire the moment it closes.
  if (isScreenCovered()) {
    playerMover.clearQueue();
    return;
  }

  // New moves wait while the view slides to a new screen - see updateView.
  if (view.slide) playerMover.finishStep(dtMs);
  else playerMover.update(dtMs);

  syncShipToMover();
  renderShip();
}

// Whichever mover the arrow keys, D-pad and stick are currently driving.
function activeMover(){
  return boardMover ?? playerMover;
}

// Forgets every held direction, including any a new mover should never inherit.
function releaseDirections(){
  activeMover().releaseAll();
  padDirection = null;
}

function syncShipToMover(){
  let position = playerMover.position;
  ship.x = position.x;
  ship.y = position.y;
  ship.angle = FACING_ANGLES[playerMover.facing];
}

function renderShip(){
  // Deliberately *not* rounded: rounding would make a steady glide visibly alternate between
  // neighboring whole pixel steps, which is its own kind of shake - a single small sprite sitting at
  // a sub-pixel offset is far less noticeable than that.
  shipEl.style.left = (ship.x - SHIP_WIDTH / 2) + "px";
  shipEl.style.top = (ship.y - SHIP_HEIGHT / 2) + "px";
  // Sprite's forward points "up" (angle -90deg) at rest, so offset by +90deg
  shipEl.style.transform = "rotate(" + (ship.angle + Math.PI / 2) + "rad)";
}

// The map is split into static screens (see GridLayout.ScreenColumns) rather than following the ship:
// the view only moves when the ship walks onto a new one, then slides there over SCREEN_SLIDE_MS. The
// slide starts as soon as the ship *sets off* for the new screen, so the two travel together.
function updateView(dtMs){
  let target = screenOriginOf(playerMover.cell);

  if (!view.position) {
    view.position = target;
  } else if (view.slide) {
    if (target.x !== view.slide.to.x || target.y !== view.slide.to.y) startSlide(target);
  } else if (target.x !== view.position.x || target.y !== view.position.y) {
    startSlide(target);
  }

  if (view.slide) {
    view.slide.elapsed = Math.min(view.slide.elapsed + dtMs, SCREEN_SLIDE_MS);
    let t = view.slide.elapsed / SCREEN_SLIDE_MS;
    let eased = t * t * (3 - 2 * t);
    view.position = {
      x: view.slide.from.x + (view.slide.to.x - view.slide.from.x) * eased,
      y: view.slide.from.y + (view.slide.to.y - view.slide.from.y) * eased,
    };
    if (view.slide.elapsed === SCREEN_SLIDE_MS) view.slide = null;
  }

  let x = Math.round(view.offsetX - view.position.x * view.scale);
  let y = Math.round(view.offsetY - view.position.y * view.scale);
  document.body.style.transform = "translate(" + x + "px, " + y + "px) scale(" + view.scale + ")";
  view.translateX = x;
  view.translateY = y;
}

function startSlide(to){
  view.slide = { from: view.position, to, elapsed: 0 };
}

// The top-left corner, in world coordinates, of the screen a square is on.
function screenOriginOf(cell){
  let screen = weavePage.screen;
  return {
    x: Math.floor(weavePage.grid.centerOf(cell).x / screen.width) * screen.width,
    y: screen.tops[Math.floor(cell.row * screen.tops.length / weavePage.grid.rows)],
  };
}

// Fits the picture to the window, normally by filling its width, and centers it, with #screenFrame's
// surround filling whatever's left. Not a whole-number multiple of the art's own pixels: at most scales
// that would leave a good chunk of the window unused, and the art's pixels drawing a screen pixel wider
// or narrower than each other isn't noticeable on these maps.
function updateViewScale(){
  let fit = Math.min(
    window.innerWidth / SOURCE_SCREEN_WIDTH,
    window.innerHeight / SOURCE_SCREEN_HEIGHT
  );
  let pictureWidth = Math.round(SOURCE_SCREEN_WIDTH * fit);
  let pictureHeight = Math.round(SOURCE_SCREEN_HEIGHT * fit);

  view.scale = pictureWidth / weavePage.screen.width;
  view.offsetX = Math.floor((window.innerWidth - pictureWidth) / 2);
  view.offsetY = Math.floor((window.innerHeight - pictureHeight) / 2);

  screenFrameEl.style.left = view.offsetX + "px";
  screenFrameEl.style.top = view.offsetY + "px";
  screenFrameEl.style.width = pictureWidth + "px";
  screenFrameEl.style.height = pictureHeight + "px";

  layoutMinimap(pictureWidth);
  layoutMapContrails(pictureWidth, pictureHeight);
}

// The ship's contrails: one from each engine, following the path it took, sweeping around its corners,
// and fading out over CONTRAIL_LIFE_MS. A set of them works in whatever coordinates its ship moves in,
// given how big one of the sprite's pixels and one square are there, so the map and the Sokoban board
// share all of this. They're drawn on a canvas in screen pixels, so that they stay as crisp as the ship.
//
// They follow the average of the last stretch of the ship's path, rather than the ship itself. The ship
// turns a sharp corner, but that average sweeps around it in an even curve, and because it's already
// behind the ship by then, nothing already drawn ever has to change for that to happen.
function createContrails(shipPixel, squareSize, start){
  let canvas = document.createElement('canvas');
  canvas.className = 'contrails';

  let sampleCount = Math.round(squareSize * CONTRAIL_TURN_SQUARES / shipPixel);

  return {
    canvas,
    context: canvas.getContext('2d'),
    look: weavePage.isHomePage ? CONTRAIL_SPACE : CONTRAIL_PLANET,
    shipPixel,
    // side: which way this engine is from the path, looking along it.
    rails: [{ side: -1, points: [] }, { side: 1, points: [] }],
    head: { x: start.x, y: start.y }, // the last place the ship was seen
    // The ship's path so far, in evenly spaced samples, one sprite pixel apart, over the stretch being averaged.
    samples: Array.from({ length: sampleCount }, () => ({ x: start.x, y: start.y })),
    toNextSample: shipPixel,
    average: { x: start.x, y: start.y },
    direction: null, // which way along the path average is heading
    drawn: false, // whether the canvas has anything on it - see drawContrails
    clock: 0, // only runs while the page does, so a tab left in the background fades nothing
  };
}

// On the map, above its own layers and below every location and the ship.
function buildMapContrails(){
  mapContrails = createContrails(SHIP_WIDTH / 12, weavePage.grid.cellWidth, ship);
  document.body.appendChild(mapContrails.canvas);
}

// Exactly the size of the picture on screen, once the body's transform has scaled it.
function layoutMapContrails(pictureWidth, pictureHeight){
  mapContrails.canvas.width = pictureWidth;
  mapContrails.canvas.height = pictureHeight;
  mapContrails.canvas.style.width = (pictureWidth / view.scale) + "px";
  mapContrails.canvas.style.height = (pictureHeight / view.scale) + "px";
}

function updateMapContrails(dtMs){
  updateContrails(mapContrails, ship, playerMover.facing, dtMs);

  // Exactly over the picture, whatever rounding the body's transform had this frame - see updateView.
  mapContrails.canvas.style.left = ((view.offsetX - view.translateX) / view.scale) + "px";
  mapContrails.canvas.style.top = ((view.offsetY - view.translateY) / view.scale) + "px";

  drawContrails(mapContrails, view.scale, view.translateX - view.offsetX, view.translateY - view.offsetY);
}

function updateContrails(trail, position, facing, dtMs){
  trail.clock += dtMs;

  let head = trail.head;
  if (position.x !== head.x || position.y !== head.y) {
    // A turn can fall in the middle of a frame, leaving the ship off to one side of where it was. The
    // corner it went around is where its old line meets its new one.
    if (position.x !== head.x && position.y !== head.y) {
      let nowVertical = facing === 'up' || facing === 'down';
      let corner = nowVertical ? { x: position.x, y: head.y } : { x: head.x, y: position.y };
      walkContrails(trail, head, corner);
      head = corner;
    }
    walkContrails(trail, head, position);
    trail.head = { x: position.x, y: position.y };
  }

  for (const rail of trail.rails) {
    while (rail.points.length > 0 && trail.clock - rail.points[0].born > CONTRAIL_LIFE_MS) {
      rail.points.shift();
    }
  }
}

// Samples the ship's path along one straight move. It goes by distance rather than by frame, so that a
// turn is rounded the same however the frames happened to fall.
function walkContrails(trail, from, to){
  let length = Math.hypot(to.x - from.x, to.y - from.y);
  let along = trail.toNextSample;

  while (along <= length) {
    addContrailSample(trail, from.x + (to.x - from.x) * along / length, from.y + (to.y - from.y) * along / length);
    along += trail.shipPixel;
  }

  trail.toNextSample = along - length;
}

function addContrailSample(trail, x, y){
  let samples = trail.samples;
  samples.shift();
  samples.push({ x, y });

  trail.average = {
    x: samples.reduce((sum, sample) => sum + sample.x, 0) / samples.length,
    y: samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length,
  };

  // The average moves along the line between the two ends of what it's averaging. Having doubled back,
  // those are in the same place for a moment, and there's no direction to speak of.
  let toNewest = { x: x - samples[0].x, y: y - samples[0].y };
  let distance = Math.hypot(toNewest.x, toNewest.y);
  if (distance === 0) return;
  let direction = { x: toNewest.x / distance, y: toNewest.y / distance };

  // Doubling back also flips that direction around. Each engine's contrail stays on its own side of the
  // line, rather than jumping across to the other one.
  if (trail.direction && direction.x * trail.direction.x + direction.y * trail.direction.y < 0) {
    for (const rail of trail.rails) rail.side = -rail.side;
  }
  trail.direction = direction;

  for (const rail of trail.rails) {
    rail.points.push({ ...contrailPointAt(trail, rail, trail.average, direction), born: trail.clock, afterBreak: rail.broken });
    rail.broken = false;
  }
}

// For a ship that's jumped straight somewhere: what's been drawn fades where it is, and what comes next
// starts afresh from the new place, with nothing streaking across the board between them.
function breakContrails(trail, position){
  trail.head = { x: position.x, y: position.y };
  trail.average = { x: position.x, y: position.y };
  trail.samples = trail.samples.map(() => ({ x: position.x, y: position.y }));
  trail.toNextSample = trail.shipPixel;
  trail.direction = null;
  for (const rail of trail.rails) rail.broken = rail.points.length > 0;
}

// Where an engine's contrail is, level with a point on the path heading in a direction.
function contrailPointAt(trail, rail, point, direction){
  let offset = CONTRAIL_OFFSET * trail.shipPixel * rail.side;
  return { x: point.x - direction.y * offset, y: point.y + direction.x * offset };
}

// scale takes the trail's coordinates to screen pixels, and originX/Y is where its (0, 0) lands on the canvas.
function drawContrails(trail, scale, originX, originY){
  let { canvas, context, look } = trail;

  // Touching a canvas makes the browser repaint it, and anything blurred over it, so a ship that's had
  // nothing to show for a while leaves it alone.
  let anything = trail.rails.some(rail => rail.points.length > 0);
  if (!anything && !trail.drawn) return;
  trail.drawn = anything;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = look.color;
  context.lineJoin = 'round';
  context.lineWidth = Math.max(1, Math.round(CONTRAIL_WIDTH * trail.shipPixel * scale));

  for (const rail of trail.rails) {
    if (rail.points.length > 0) drawContrail(trail, withStretchToShip(trail, rail), scale, originX, originY);
  }
  context.globalAlpha = 1;
}

// A contrail's points, plus the stretch from the newest of them on to wherever the ship's sprite hides it,
// which is what pivots smoothly while the ship is going around a corner.
function withStretchToShip(trail, rail){
  let points = rail.points;
  let toShip = { x: trail.head.x - trail.average.x, y: trail.head.y - trail.average.y };
  let distance = Math.hypot(toShip.x, toShip.y);
  let visible = distance - CONTRAIL_UNDER_SHIP * trail.shipPixel;
  if (visible <= 0) return points;

  let direction = { x: toShip.x / distance, y: toShip.y / distance };
  // Against the path's own direction when doubling back, where rail.side has been flipped to match that.
  if (!trail.direction || direction.x * trail.direction.x + direction.y * trail.direction.y < 0) return points;

  let end = { x: trail.average.x + direction.x * visible, y: trail.average.y + direction.y * visible };
  return [...points, { ...contrailPointAt(trail, rail, end, direction), born: points[points.length - 1].born }];
}

// One opacity per stroke, so each run of points that have faded the same amount is drawn as one line:
// overlapping strokes would show as darker beads along it, with the line being see-through.
function drawContrail(trail, points, scale, originX, originY){
  let context = trail.context;

  // Whole pixels for an even width and half pixels for an odd one are what keep a straight stretch crisp.
  let snap = context.lineWidth % 2 === 0 ? 0 : 0.5;
  let toScreenX = (x) => Math.round(originX + x * scale) + snap;
  let toScreenY = (y) => Math.round(originY + y * scale) + snap;
  let fadeStepOf = (point) => Math.ceil(Math.max(0, 1 - (trail.clock - point.born) / CONTRAIL_LIFE_MS) * CONTRAIL_FADE_STEPS);

  let i = 0;
  while (i < points.length - 1) {
    let step = fadeStepOf(points[i + 1]);

    context.beginPath();
    context.moveTo(toScreenX(points[i].x), toScreenY(points[i].y));
    while (i < points.length - 1 && fadeStepOf(points[i + 1]) === step && !points[i + 1].afterBreak) {
      i++;
      context.lineTo(toScreenX(points[i].x), toScreenY(points[i].y));
    }
    // Nothing joins the two sides of a break - see breakContrails.
    if (points[i + 1]?.afterBreak) i++;

    context.globalAlpha = trail.look.opacity * step / CONTRAIL_FADE_STEPS;
    context.stroke();
  }
}

// The minimap, in the bottom-right corner of the screen: the whole map, the screen currently in view,
// and the map's locations, so the player can see where they are in the larger world. Lives
// inside #screenFrame, so it stays put while the world moves underneath it, and anything covering the
// whole window covers it too. Its picture is cropped to the same top and bottom edges the screens
// themselves show - see GridLayout.ScreenTops.
function buildMinimap(){
  let el = document.createElement('div');
  el.id = 'minimap';

  let image = document.createElement('img');
  image.id = 'minimapImage';
  image.src = document.getElementById('bgmap').src;
  el.appendChild(image);

  let nodes = [];
  nodeMeta.forEach((meta) => {
    if (!meta.isTopLevel || meta.isModal) return;
    let icon = document.createElement('img');
    icon.className = 'minimapNode';
    icon.src = meta.img.getAttribute('src');
    el.appendChild(icon);
    nodes.push({ icon, center: weavePage.grid.centerOf(meta.cell) });
  });

  let screen = document.createElement('div');
  screen.id = 'minimapScreen';
  el.appendChild(screen);

  screenFrameEl.appendChild(el);
  minimap = { el, image, nodes, screen, scale: 1, top: 0 };
}

// A single map's minimap takes MINIMAP_WIDTH_FRACTION of the picture's width. A wider map keeps the same
// scale, so its squares match, until it reaches MINIMAP_MAX_WIDTH_FRACTION, then shrinks to fit that.
const MINIMAP_WIDTH_FRACTION = 0.16;
const MINIMAP_MAX_WIDTH_FRACTION = 0.24;
const MINIMAP_MARGIN_FRACTION = 0.008;
// A location's icon, relative to one of the minimap's own squares.
const MINIMAP_NODE_SQUARES = 0.55;

function layoutMinimap(pictureWidth){
  let screen = weavePage.screen;
  let screensAcross = weavePage.worldWidth / screen.width;
  let width = Math.round(pictureWidth * Math.min(MINIMAP_WIDTH_FRACTION * screensAcross / 2, MINIMAP_MAX_WIDTH_FRACTION));

  minimap.scale = width / weavePage.worldWidth;
  minimap.top = screen.tops[0];
  let height = (screen.tops[screen.tops.length - 1] + screen.height - minimap.top) * minimap.scale;
  let margin = Math.round(pictureWidth * MINIMAP_MARGIN_FRACTION);

  minimap.el.style.width = width + "px";
  minimap.el.style.height = Math.round(height) + "px";
  minimap.el.style.right = margin + "px";
  minimap.el.style.bottom = margin + "px";

  minimap.image.style.width = width + "px";
  minimap.image.style.height = (weavePage.worldHeight * minimap.scale) + "px";
  minimap.image.style.top = (-minimap.top * minimap.scale) + "px";

  minimap.screen.style.width = (screen.width * minimap.scale) + "px";
  minimap.screen.style.height = (screen.height * minimap.scale) + "px";

  let square = width / weavePage.grid.columns;
  let nodeSize = Math.max(3, Math.round(square * MINIMAP_NODE_SQUARES));
  for (const node of minimap.nodes) {
    node.icon.style.width = nodeSize + "px";
    node.icon.style.height = nodeSize + "px";
    node.icon.style.left = (node.center.x * minimap.scale - nodeSize / 2) + "px";
    node.icon.style.top = ((node.center.y - minimap.top) * minimap.scale - nodeSize / 2) + "px";
  }
}

function updateMinimap(){
  minimap.screen.style.left = (view.position.x * minimap.scale) + "px";
  minimap.screen.style.top = ((view.position.y - minimap.top) * minimap.scale) + "px";

  minimap.el.classList.toggle('minimapFaded', isMinimapInTheWay());
}

// The corner it sits in is still part of the map. Whenever the ship, a location, or an open card is
// underneath it, it fades back rather than hiding them.
function isMinimapInTheWay(){
  let box = minimap.el.getBoundingClientRect();

  let overlaps = (left, top, right, bottom) =>
    right > box.left && left < box.right && bottom > box.top && top < box.bottom;

  // A world-space box, on the screen.
  let overlapsWorld = (x, y, halfWidth, halfHeight) => {
    let centerX = view.offsetX + (x - view.position.x) * view.scale;
    let centerY = view.offsetY + (y - view.position.y) * view.scale;
    return overlaps(
      centerX - halfWidth * view.scale, centerY - halfHeight * view.scale,
      centerX + halfWidth * view.scale, centerY + halfHeight * view.scale
    );
  };

  if (overlapsWorld(ship.x, ship.y, SHIP_WIDTH / 2, SHIP_HEIGHT / 2)) return true;

  for (const node of minimap.nodes) {
    if (overlapsWorld(node.center.x, node.center.y, NODE_ICON_SIZE / 2, NODE_ICON_SIZE / 2)) return true;
  }

  if (activeRoot) {
    let card = nodeMeta.get(activeRoot).info.getBoundingClientRect();
    if (overlaps(card.left, card.top, card.right, card.bottom)) return true;
  }

  return false;
}

// Which top-level location the ship is standing on drives the open card - a multi-part location's
// nested nodes aren't out on the map to walk to, so they never compete here.
// This only decides *which root*, resetting back to the start of its chain whenever the root itself
// changes. Only counts
// once the ship has actually stopped, so holding a direction straight across a node doesn't flash
// its card open and shut on the way past.
function updateNodeProximity(){

  let standingOn = rootByCell.get(cellKey(playerMover.cell)) ?? null;
  if (standingOn !== arrivalRoot) arrivalRoot = null;

  let root = (playerMover.isMoving || standingOn === arrivalRoot) ? null : standingOn;

  if (root !== activeRoot) {
    if (activeRoot) hideLocation(activeRoot);
    activeRoot = root;
    chainIndex = 0;
    if (activeRoot) showLocation(activeRoot);
  }
}

// Location music: a root's own track (or whichever chain member the player has X-cycled to - see
// cycleChainNode) plays while the ship is on that root's square, and only then. "On" means the
// square nearest the ship right now, so it changes halfway through a step rather than at either end
// of it. Walking straight across a square gets a soft swell rather than the whole track - see
// AUDIO_VOLUME_EASE.
//
// Every other (non-active) member of the same chain is eased toward 0 right alongside the active
// one, rather than snapped to pause immediately - that's what makes X-cycling from a root to a
// child (or back) read as a crossfade instead of a hard cut.
function updateLocationAudio(dt){
  let ease = 1 - Math.pow(AUDIO_VOLUME_EASE, dt);
  let shipCell = weavePage.grid.cellAt(ship.x, ship.y);

  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;

    // Start buffering before the track needs to be audible - see PRELOAD_SQUARES's own comment on
    // why. The whole chain preloads together (not just whichever member happens to be active right
    // now) so stepping into a child with X once close doesn't hit a cold, unbuffered element.
    let squaresAway = Math.abs(meta.cell.col - shipCell.col) + Math.abs(meta.cell.row - shipCell.row);
    if (squaresAway <= PRELOAD_SQUARES) {
      for (const member of meta.chain) {
        let memberMeta = nodeMeta.get(member);
        if (memberMeta.audio && !memberMeta.audioPreloaded) {
          memberMeta.audioPreloaded = true;
          memberMeta.audio.preload = 'auto';
          memberMeta.audio.load();
        }
      }
    }

    let activeMember = (node === activeRoot && activeNode) ? playableMember(activeNode) : node;

    for (const member of meta.chain) {
      let memberMeta = nodeMeta.get(member);
      let audio = memberMeta.audio;
      if (!audio) continue;

      let target = (squaresAway === 0 && member === activeMember) ? 1 : 0;
      audio.volume += (target - audio.volume) * ease;
      if (audio.volume < 0.004) audio.volume = 0;

      if (audio.volume > 0) {
        if (audio.paused) audio.play().catch(() => {});
      } else if (!audio.paused) {
        audio.pause();
      }
    }
  });
}

// The part whose music should be playing while Track Focus is on this one. A locked part keeps its music to
// itself until it's unlocked, so the last part that's open carries on instead.
function playableMember(member){
  return partLockedBy(member) ?? member;
}

// Tells the persistent shell (see shell.js) how audible its "hub theme" track
// (WeaveProject.BackgroundMusicPath) should be right now: full ambient volume while this is the
// home page itself, or on the square of a node whose Travel action leads back to the home page (see
// PageRenderer's data-travel-home marker) - so stepping onto one of those "return to the hub" nodes
// previews the hub theme before you actually leave. Silent anywhere else; shell.js eases between the
// two. A no-op when this page isn't embedded in the shell's iframe at all (e.g. opened directly),
// same guard as notifyShellOfInteraction.
function updateHubMusicSignal(){
  if (window.parent === window) return;

  let audibility = 0;

  if (weavePage.isHomePage) {
    audibility = 1;
  } else {
    let root = rootByCell.get(cellKey(weavePage.grid.cellAt(ship.x, ship.y)));
    if (root && nodeMeta.get(root).travelHome) audibility = 1;
  }

  window.parent.postMessage({ source: 'weave-hub-music', audibility }, '*');
}

// Marks whether a node's card is currently open, driving .node.cardOpen (see main.css) so an
// open card's own icon-bearing .node paints above every plain (closed) .node - without this,
// nearby nodes on the map stack purely by document order and can draw their icon over this
// card's cover art/content. Kept as a single setter (rather than each call site touching
// classList directly) so it can't drift out of sync with the display toggle it always pairs with.
function setCardOpen(node, meta, open){
  meta.info.style.display = open ? '' : 'none';
  node.classList.toggle('cardOpen', open);
  if (open) placeCard(node, meta);
}

// Keeps a card fully inside its node's screen, now that there's no camera to bring it into view. It
// goes where it was authored if that fits; otherwise it flips to the other side of the icon, then
// slides up or down as needed. Works from the authored offset every time, so a card that had to move
// doesn't stay moved for no reason.
function placeCard(node, meta){
  let info = meta.info;
  if (meta.cardLeft === undefined) {
    meta.cardLeft = parseFloat(info.style.left) || 0;
    meta.cardTop = parseFloat(info.style.top) || 0;
  }

  let nodeX = parseFloat(node.style.left) || 0;
  let nodeY = parseFloat(node.style.top) || 0;
  let screen = screenOriginOf(meta.cell);
  let screenRight = screen.x + weavePage.screen.width - CARD_SCREEN_MARGIN;
  let screenBottom = screen.y + weavePage.screen.height - CARD_SCREEN_MARGIN;

  let x = nodeX + meta.cardLeft;
  let y = nodeY + meta.cardTop;

  if (x + info.offsetWidth > screenRight) {
    // The same gap from the icon's left edge as the authored position has from its right.
    x = nodeX - (meta.cardLeft - NODE_ICON_SIZE) - info.offsetWidth;
  }

  x = clamp(x, screen.x + CARD_SCREEN_MARGIN, screenRight - info.offsetWidth);
  y = clamp(y, screen.y + CARD_SCREEN_MARGIN, screenBottom - info.offsetHeight);

  info.style.left = (x - nodeX) + "px";
  info.style.top = (y - nodeY) + "px";
}

// A persistent card is already open by the time anything knows where screens are - see loadNodes.
function placePersistentCards(){
  nodeMeta.forEach((meta, node) => {
    if (meta.isTopLevel && !meta.isModal && meta.persistent && meta.info.style.display !== 'none') {
      placeCard(node, meta);
    }
  });
}

// Closes a location's card when the ship leaves it.
function hideLocation(root){
  let meta = nodeMeta.get(root);
  if (!meta.persistent) {
    setCardOpen(root, meta, false);
    meta.img.src = 'img/node.png';
  }
  activeNode = null;
}

// Opens a location's card once the ship stops on it. Always the root's own: a chain's later parts
// are only ever reached in Track Focus (see cycleChainNode), so their cards never open on the map.
function showLocation(root){
  let meta = nodeMeta.get(root);
  if (!meta.persistent) {
    setCardOpen(root, meta, true);
    meta.img.src = 'img/node-active.png';
  }
  activeNode = root;
}

// A location's parts are levels: each is locked until the puzzle of every part before it is solved. Returns
// the earliest part still holding this one back, or null if it's unlocked. A part with no puzzle, or one with
// no Finish, can't be solved, so it holds nothing back - otherwise what's after it could never be reached.
function partLockedBy(member){
  let chain = nodeMeta.get(activeRoot).chain;
  for (const earlier of chain.slice(0, chain.indexOf(member))) {
    let puzzle = nodeMeta.get(earlier).puzzle;
    if (WeavePuzzle.hasFinish(puzzle) && !isPuzzleSolved(puzzle)) return earlier;
  }
  return null;
}

// localStorage (not sessionStorage, as with hasSeenModal) because what a visitor has unlocked should
// still be unlocked when they come back. Wrapped defensively for the same reasons as hasSeenModal, which
// degrades to having to solve it again next time rather than breaking the page. Remembered for the page's
// lifetime as well, for when storage isn't available at all.
const PUZZLE_SOLVED_KEY_PREFIX = "weave-puzzle-solved:";
const solvedThisPage = new Set();

function isPuzzleSolved(puzzle){
  if (solvedThisPage.has(puzzle.id)) return true;
  try {
    return localStorage.getItem(PUZZLE_SOLVED_KEY_PREFIX + puzzle.id) === "true";
  } catch (e) {
    return false;
  }
}

function markPuzzleSolved(puzzle){
  solvedThisPage.add(puzzle.id);
  try {
    localStorage.setItem(PUZZLE_SOLVED_KEY_PREFIX + puzzle.id, "true");
  } catch (e) {
    // storage unavailable - see above.
  }
}

// X (keyboard) / X (gamepad): restarts the puzzle on the board, otherwise steps through a location's parts.
function onSwitchButton(){
  if (boardMover) restartBoardGame();
  else cycleChainNode();
}

// X (keyboard) / X (gamepad): in Track Focus, step to the next part of the current location, wrapping
// back to the first. A locked part can be stepped to, but only shows that it's locked - see
// renderTrackFocus. Music crossfades on its own, since updateLocationAudio follows activeNode.
function cycleChainNode(){
  if (!trackFocusEl || boardMover) return;

  let chain = nodeMeta.get(activeRoot).chain;
  if (chain.length <= 1) return;

  chainIndex = (chainIndex + 1) % chain.length;
  activeNode = chain[chainIndex];
  renderTrackFocus();
}

// Whether something is covering the whole screen, leaving the map underneath out of reach.
function isScreenCovered(){
  return modalQueue.length > 0 || trackFocusEl !== null;
}

// Z (keyboard) / A (gamepad). Whatever is covering the screen takes this over entirely: a modal
// card (see modalQueue) first, then Track Focus, which starts its board. It has no use on the board
// itself yet.
function onInteractButton(){
  if (modalQueue.length > 0) closeCurrentModal();
  else if (boardMover) return;
  else if (trackFocusEl) startBoardGame();
  else onInteract();
}

// C (keyboard) / B (gamepad): back out one level, from the board to Track Focus to the map.
function onBackButton(){
  if (boardMover) leaveBoardGame();
  else closeTrackFocus();
}

function onInteract(){
  if (!activeNode) return;

  let meta = nodeMeta.get(activeNode);
  let travelLink = meta.info.querySelector('.poetry-travel a');

  if (travelLink) {
    window.location.href = travelLink.getAttribute('href');
  } else if (meta.audio) {
    openTrackFocus();
  } else {
    // Informational-only card (e.g. tutorial) - interact just toggles it
    setCardOpen(activeNode, meta, meta.info.style.display === 'none');
  }
}

// Track Focus: a full-screen view of the current track - album art on the left, title and poetry on
// the right, over the dimmed map and a blown-up, blurred copy of the art that gives the whole screen
// its palette. Its music carries on playing, since the ship stays exactly where it is (see
// updateLocationAudio). A multi-part location's later parts are only reachable here - see
// cycleChainNode.
//
// Appended to <html>, not <body>, for the same reason as #modalBackdrop - see #screenFrame's
// comment in buildScreenFrame.
function openTrackFocus(){
  if (trackFocusEl || !activeNode) return;

  trackFocusEl = document.createElement('div');
  trackFocusEl.id = 'trackFocus';

  renderTrackFocus();
  updateTrackFocusScale();
  document.documentElement.appendChild(trackFocusEl);
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
    let backdrop = document.createElement('img');
    backdrop.id = 'trackFocusBackdrop';
    backdrop.src = cover.src;
    trackFocusEl.appendChild(backdrop);

    let frame = document.createElement('div');
    frame.id = 'trackFocusArt';

    let art = document.createElement('img');
    art.src = cover.src;
    frame.appendChild(art);

    // Where the 10x10 board laid over the art goes, sized to exactly match it - see startBoardGame,
    // and updateTrackFocusScale for the tile size it gets to work with.
    let board = document.createElement('div');
    board.id = 'trackFocusBoard';
    if (boardMover) {
      if (boardGame) {
        boardObjectsCanvas = document.createElement('canvas');
        boardObjectsCanvas.id = 'trackFocusBoardObjects';
        boardObjectsCanvas.width = WeavePuzzle.ART_PX;
        boardObjectsCanvas.height = WeavePuzzle.ART_PX;
        boardObjectsImage = boardObjectsCanvas.getContext('2d').createImageData(WeavePuzzle.ART_PX, WeavePuzzle.ART_PX);
        board.appendChild(boardObjectsCanvas);
      }
      board.appendChild(boardContrails.canvas);
      board.appendChild(buildBoardShip());
    }
    frame.appendChild(board);
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
    actions.appendChild(buildTrackFocusAction('[ Back ]', BACK_KEY_HINT, leaveBoardGame));
  } else {
    if (cover && !lockedBy) actions.appendChild(buildTrackFocusAction('[ Enter ]', 'img/ui/key_z.gif', startBoardGame));
    if (nodeMeta.get(activeRoot).chain.length > 1) {
      actions.appendChild(buildTrackFocusAction('[ Switch ]', 'img/ui/key_x.gif', cycleChainNode));
    }
    actions.appendChild(buildTrackFocusAction('[ Back ]', BACK_KEY_HINT, closeTrackFocus));
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
  trackFocusEl.classList.toggle('partLocked', lockedBy !== null);
}

// A word across the middle of the album art.
function buildArtLabel(text){
  let label = document.createElement('div');
  label.className = 'trackFocusArtLabel';
  label.textContent = text;
  return label;
}

// The key hint for an action with no drawn key to show: there's no img/ui/key_c.gif, so main.css's
// .drawnKeyHint draws this one to match the others.
const BACK_KEY_HINT = 'C';

function buildTrackFocusAction(label, hint, onClick){
  let action = document.createElement('span');
  action.className = 'trackFocusAction';

  let text = document.createElement('span');
  text.textContent = label;
  text.addEventListener('click', onClick);
  action.appendChild(text);

  if (hint === BACK_KEY_HINT) {
    let hintKey = document.createElement('span');
    hintKey.className = 'keyHint drawnKeyHint';
    hintKey.textContent = hint;
    action.appendChild(hintKey);
  } else {
    let hintImg = document.createElement('img');
    hintImg.className = 'keyHint';
    hintImg.src = hint;
    action.appendChild(hintImg);
  }

  return action;
}

// A no-op when it isn't open, so every way of closing it can just call this. Always comes back to the
// location's first part: that's the only card the map ever shows, and the music should match it.
function closeTrackFocus(){
  if (!trackFocusEl) return;
  trackFocusEl.remove();
  trackFocusEl = null;
  activeNode = activeRoot;
  chainIndex = 0;
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
}

// The Sokoban board: the ship walking a 10x10 grid over the album art, on the same reusable movement
// as the map (see sokoban.js). Everything is measured in the art's own pixels, then multiplied up by
// trackFocusScale to draw, so a window resize mid-game has nothing to rebuild and the ship always
// matches the art's pixel size. A track with a puzzle adds its rules to that - see buildBoardGame.
const BOARD_STEP_MS = 180;
// How long something on a Stream or Rotator tile takes to move a square, and how long a solved puzzle stays
// on screen.
const BOARD_STREAM_TICK_MS = 360;
const BOARD_ROTATOR_TICK_MS = 1000;
const BOARD_SOLVED_PAUSE_MS = 800;
// img/ui/pilot-ship.png's own size.
const BOARD_SHIP_WIDTH = 12;
const BOARD_SHIP_HEIGHT = 16;

function startBoardGame(){
  if (!trackFocusEl || boardMover || !document.getElementById('trackFocusBoard') || partLockedBy(activeNode)) return;

  releaseDirections();
  buildBoardGame();
  renderTrackFocus();
  renderBoardShip();
}

// Everything that starts fresh, whether that's starting the board or restarting it.
function buildBoardGame(){
  let puzzle = nodeMeta.get(activeNode).puzzle;
  boardGame = puzzle ? WeavePuzzle.createPuzzleGame(puzzle) : null;
  boardStreamMs = 0;
  boardRotatorActiveMs = 0;
  boardRotatorGlideMs = BOARD_ROTATOR_TICK_MS;
  boardRotatorClockMs = 0;
  boardSolvedMs = null;

  boardMover = WeaveSokoban.createMover(
    WeaveSokoban.createGrid({
      columns: TRACK_FOCUS_BOARD_SQUARES,
      rows: TRACK_FOCUS_BOARD_SQUARES,
      cellWidth: BOARD_TILE_PX,
      cellHeight: BOARD_TILE_PX,
    }),
    {
      cell: boardGame ? boardGame.start : WeavePuzzle.DEFAULT_START,
      stepMs: BOARD_STEP_MS,
      canEnter: boardGame ? boardGame.canEnter : undefined,
      onArrive: boardGame ? (cell) => {
        onBoardEvent(boardGame.shipArrivedAt(cell));
        carryBoardShip();
      } : undefined,
    }
  );
  boardContrails = createContrails(BOARD_SHIP_WIDTH / 12, BOARD_TILE_PX, boardMover.position);
}

function restartBoardGame(){
  if (!boardGame) return;

  releaseDirections();
  buildBoardGame();
  renderTrackFocus();
  renderBoardShip();
}

// A Stream carries a ship on it, one square at a time, whatever's being pressed - see puzzle.js's canEnter.
function carryBoardShip(){
  if (!boardGame || boardSolvedMs !== null) return;

  let carry = boardGame.carryDirection(boardMover.cell);
  if (carry) boardMover.queue(carry);
}

// Acts on what puzzle.js says just happened to the ship.
function onBoardEvent(event){
  if (!event) return;

  if (event.teleportTo) {
    boardMover.teleport(event.teleportTo);
    breakContrails(boardContrails, boardMover.position);
  }
  if (event.finished) {
    markPuzzleSolved(nodeMeta.get(activeNode).puzzle);
    boardSolvedMs = 0;
    releaseDirections();
    document.getElementById('trackFocusArt').appendChild(buildArtLabel('Solved'));
  }
}

// Moves on from a solved board, like the next level of a game: straight into the next part's puzzle if it
// has one, or back to Track Focus to show what was unlocked if it doesn't. The last part just stays put.
function finishBoardLevel(){
  let chain = nodeMeta.get(activeRoot).chain;
  let next = chain[chainIndex + 1];
  if (next) {
    chainIndex++;
    activeNode = next;
  }

  if (next && nodeMeta.get(next).puzzle) {
    releaseDirections();
    buildBoardGame();
    renderTrackFocus();
    renderBoardShip();
  } else {
    leaveBoardGame();
  }
}

function leaveBoardGame(){
  if (!boardMover) return;

  releaseDirections();
  boardMover = null;
  boardShipEl = null;
  boardContrails = null;
  boardGame = null;
  boardObjectsCanvas = null;
  boardObjectsImage = null;
  boardSolvedMs = null;
  renderTrackFocus();
}

function buildBoardShip(){
  boardShipEl = document.createElement('img');
  boardShipEl.id = 'trackFocusBoardShip';
  boardShipEl.src = 'img/ui/pilot-ship.png';
  return boardShipEl;
}

function updateBoardGame(dtMs){
  if (!boardMover) return;

  // Holds still for a moment on a solved board, then moves on - see finishBoardLevel.
  if (boardSolvedMs !== null) {
    boardSolvedMs += dtMs;
    updateBoardContrails(dtMs);
    drawBoardObjects();
    if (boardSolvedMs >= BOARD_SOLVED_PAUSE_MS) finishBoardLevel();
    return;
  }

  boardMover.update(dtMs);

  if (boardGame && boardSolvedMs === null) {
    // For a ship that's come to rest on a Stream: pushing against something, say, or after a restart.
    // Reaching one on the way is handled as it arrives, so that it never pauses - see carryBoardShip.
    if (!boardMover.isMoving) {
      let carry = boardGame.carryDirection(boardMover.cell);
      if (carry) boardMover.queue(carry);
    }

    boardStreamMs += dtMs;
    while (boardStreamMs >= BOARD_STREAM_TICK_MS && boardSolvedMs === null) {
      boardStreamMs -= BOARD_STREAM_TICK_MS;
      onBoardEvent(boardGame.tick(boardMover.isMoving ? boardMover.cell : null));
    }

    updateBoardRotators(dtMs);
  }

  renderBoardShip();
  updateBoardContrails(dtMs);
  drawBoardObjects();
}

// Rotator tiles only move while the ship is stopped on their Switch, once it's been there a whole tick. A
// move underway when it leaves still finishes.
function updateBoardRotators(dtMs){
  boardRotatorGlideMs = Math.min(BOARD_ROTATOR_TICK_MS, boardRotatorGlideMs + dtMs);

  if (boardMover.isMoving || !boardGame.onRotatorSwitch) {
    boardRotatorActiveMs = 0;
    return;
  }

  boardRotatorActiveMs += dtMs;
  boardRotatorClockMs += dtMs;
  if (boardRotatorActiveMs >= BOARD_ROTATOR_TICK_MS && boardSolvedMs === null) {
    boardRotatorActiveMs -= BOARD_ROTATOR_TICK_MS;
    boardRotatorGlideMs = 0;
    onBoardEvent(boardGame.tickRotators(null));
  }
}

// Everything on the board, at the art's own size, for CSS to scale up exactly as it does the art, so that
// their pixels line up. Redrawn every frame, because Streams are always moving, and something on one glides
// between its last square and its new one over a whole tick.
function drawBoardObjects(){
  if (!boardGame || !boardObjectsCanvas) return;

  let puzzle = nodeMeta.get(activeNode).puzzle;
  WeavePuzzle.renderBoard(boardObjectsImage, [...boardGame.floors, ...boardGame.objects], puzzle, {
    timeMs: performance.now(),
    rotatorTimeMs: boardRotatorClockMs,
    switchesActive: boardGame.switchesActive,
    along: boardStreamMs / BOARD_STREAM_TICK_MS,
    rotatorAlong: boardRotatorGlideMs / BOARD_ROTATOR_TICK_MS,
  });
  boardObjectsCanvas.getContext('2d').putImageData(boardObjectsImage, 0, 0);
}

function updateBoardContrails(dtMs){
  updateContrails(boardContrails, boardMover.position, boardMover.facing, dtMs);

  // Keeps up with a window resize here, since this is already measured against trackFocusScale every frame.
  let size = Math.round(TRACK_FOCUS_ART_PX * trackFocusScale);
  if (boardContrails.canvas.width !== size) {
    boardContrails.canvas.width = size;
    boardContrails.canvas.height = size;
  }

  drawContrails(boardContrails, trackFocusScale, 0, 0);
}

function renderBoardShip(){
  let position = boardMover.position;
  let width = Math.round(BOARD_SHIP_WIDTH * trackFocusScale);
  let height = Math.round(BOARD_SHIP_HEIGHT * trackFocusScale);
  boardShipEl.style.width = width + "px";
  boardShipEl.style.height = height + "px";
  boardShipEl.style.left = (position.x * trackFocusScale - width / 2) + "px";
  boardShipEl.style.top = (position.y * trackFocusScale - height / 2) + "px";
  // Sprite's forward points "up" at rest, same as the map ship - see renderShip.
  boardShipEl.style.transform = "rotate(" + (FACING_ANGLES[boardMover.facing] + Math.PI / 2) + "rad)";
}

// Generic per-page visual effects (drifting sprites, a cross-fading second
// background layer) - replaces what used to be hand-written inline <script>
// blocks per page. The exporter emits window.__weaveEffects only on pages
// that actually have effects configured; pages with none get no script tag
// and this function is a no-op.
function applyPageEffects(){
  if (!window.__weaveEffects) return;

  window.__weaveEffects.forEach(fx => {
    if (fx.type === "crossfade") {
      applyCrossfadeEffect(fx);
    } else if (fx.type === "drift") {
      applyDriftEffect(fx);
    }
  });
}

// #bgmap2 already exists in the static markup - PageRenderer renders it whenever
// Page.SecondaryBackground is set, and CrossfadeLayerEffect.ImagePath is always kept in sync
// with that (see ProjectEditing's SyncSecondaryBackground), so this animates the existing
// element rather than creating a second one. Creating a duplicate here used to be the actual
// bug: getElementById elsewhere (loadPageConfig, sizing it; buildWrapGhosts, tiling it) only
// ever finds the first, static #bgmap2 in document order, so the freshly-created second one -
// the one this function was calling .animate() on - never got sized or positioned at all, while
// the properly-positioned static one sat there forever at its unanimated inline opacity:0%.
function applyCrossfadeEffect(fx){
  let layer = document.getElementById('bgmap2');
  if (!layer) return;

  layer.animate(
    [{ opacity: fx.opacityFrom }, { opacity: fx.opacityTo }],
    {
      duration: fx.durationMs,
      direction: fx.direction || 'alternate',
      iterations: Infinity,
      easing: fx.easing || 'ease-in-out',
    }
  );
}

function applyDriftEffect(fx){

  let outer = document.createElement('div');
  outer.style.left = fx.x + "px";
  outer.style.top = fx.y + "px";
  if (fx.blendMode) outer.style.mixBlendMode = fx.blendMode;

  let img = document.createElement('img');
  img.className = 'effect-drift-sprite';
  img.src = fx.imagePath;
  outer.appendChild(img);

  document.body.appendChild(outer);

  if (fx.driftX) {
    img.animate(
      { transform: "translateX(" + fx.driftX.toPx + "px)" },
      {
        duration: fx.driftX.durationMs,
        direction: fx.driftX.direction || 'alternate-reverse',
        iterations: Infinity,
        easing: fx.driftX.easing || 'ease-in-out',
      }
    );
  }

  if (fx.driftY) {
    outer.animate(
      [
        { transform: "translateY(" + fx.driftY.fromPx + "px)" },
        { transform: "translateY(" + fx.driftY.toPx + "px)" },
      ],
      {
        duration: fx.driftY.durationMs,
        direction: fx.driftY.direction || 'alternate',
        iterations: Infinity,
        easing: fx.driftY.easing || 'ease-in-out',
      }
    );
  }
}

function loop(timestamp){
  if (lastFrameTime === null) lastFrameTime = timestamp;
  let dt = clamp((timestamp - lastFrameTime) / (1000 / 60), 0, 3);
  lastFrameTime = timestamp;

  updateInput();
  updateShip(dt);
  updateView(dt * MS_PER_FRAME);
  updateMapContrails(dt * MS_PER_FRAME);
  updateMinimap();
  updateBoardGame(dt * MS_PER_FRAME);
  updateNodeProximity();
  updateLocationAudio(dt);
  updateHubMusicSignal();

  requestAnimationFrame(loop);
}
