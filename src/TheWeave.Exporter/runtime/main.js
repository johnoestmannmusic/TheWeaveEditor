// main.js
// John Oestmann
// All JS functionality for The Weave Explorer in here
//
// Navigation: walk the ship one square at a time with Arrow Keys, a gamepad D-pad, or a gamepad
// stick - hold a direction to keep going, let go to stop on the square you're heading into (see
// sokoban.js, which owns the movement itself). Press Z (keyboard) or A (gamepad) to interact with
// whatever location the ship is standing on - travels to its linked page, or opens a track's Track
// Focus screen. When that location has extra nested locations tucked inside its card (a multi-part
// story), press X (keyboard) or X (gamepad) in Track Focus to step between them.
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
let activeNode = null;   // the current track: activeRoot, or the chain member Track Focus is on
let activeRoot = null;   // the top-level node the ship is currently within range of
let chainIndex = 0;      // activeNode's position within activeRoot's chain

// The page's own config (see window.__weavePage, emitted per-page by PageConfigScriptRenderer) -
// worldWidth/worldHeight are the page's authoritative world size, and grid is the board of squares
// the ship walks (see loadPageConfig).
let weavePage = { globeEffect: false, worldWidth: 0, worldHeight: 0, defaultSpawnX: null, defaultSpawnY: null, isHomePage: false, grid: null, screen: null };


// Ship tuning
const SHIP_WIDTH = 40;
const NODE_ICON_SIZE = 48; // matches .nodeImage's width in main.css
const STEP_MS = 240; // how long walking one square takes
const MS_PER_FRAME = 1000 / 60; // loop()'s dt is measured in 60fps frames
// Sprite rotation for each direction sokoban.js can be facing.
const FACING_ANGLES = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };

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
// one screen's size in the map art's own pixels, which is what the picture is drawn at a whole-number
// multiple of. CARD_SCREEN_MARGIN keeps an open card from touching the screen's edge - see placeCard.
const SOURCE_SCREEN_WIDTH = 250;
const SOURCE_SCREEN_HEIGHT = 125;
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

// Input state
const KEY_DIRECTIONS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
let padDirection = null; // whichever direction the gamepad is currently holding on playerMover
let gamepadInteractWasDown = false;
let gamepadCycleWasDown = false;
let gamepadBackWasDown = false;
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
  buildScreenFrame();
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
  // Screens start at the left edge of the map, label strip included, but below its top label strip.
  weavePage.screen = { width: cfg.screen.width, height: cfg.screen.height, originY: cfg.grid.originY };
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

  let spawnX = 120;
  let spawnY = 120;

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
    });

    if (curAudio && !isModal) curAudio.volume = 0; // updateLocationAudio eases this up from silence

    // The card's own "[ Focus ]" action (see PageRenderer) - same thing as Z/gamepad A. :scope so a
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
    if (direction || e.key === 'z' || e.key === 'Z' || e.key === 'x' || e.key === 'X') {
      e.preventDefault();
    }

    if (direction) playerMover.press(direction);

    if ((e.key === 'z' || e.key === 'Z') && !e.repeat) onInteractButton();
    if ((e.key === 'x' || e.key === 'X') && !e.repeat) cycleChainNode();
    if (e.key === 'Escape' && !e.repeat) closeTrackFocus();
  });

  document.addEventListener('keyup', (e) => {
    let direction = KEY_DIRECTIONS[e.key];
    if (direction) playerMover.release(direction);
  });

  window.addEventListener('resize', updateTrackFocusScale);
  window.addEventListener('resize', updateViewScale);

  // A key released while another window has focus never fires keyup here - without this, the ship
  // would keep walking until it hit the edge of the map.
  window.addEventListener('blur', () => {
    playerMover.releaseAll();
    padDirection = null;
  });

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
      if (bDown && !gamepadBackWasDown) closeTrackFocus();
      gamepadBackWasDown = bDown;

      // Standard gamepad mapping: button 2 is X (Xbox) / Square (PlayStation).
      let xDown = !!(pad.buttons[2] && pad.buttons[2].pressed);
      if (xDown && !gamepadCycleWasDown) cycleChainNode();
      gamepadCycleWasDown = xDown;

      break; // only the first connected gamepad drives the ship
    }
  }

  if (nextPadDirection !== padDirection) {
    if (padDirection) playerMover.release(padDirection);
    if (nextPadDirection) playerMover.press(nextPadDirection);
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
  shipEl.style.top = (ship.y - SHIP_WIDTH / 2) + "px";
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
}

function startSlide(to){
  view.slide = { from: view.position, to, elapsed: 0 };
}

// The top-left corner, in world coordinates, of the screen a square is on.
function screenOriginOf(cell){
  let center = weavePage.grid.centerOf(cell);
  let screen = weavePage.screen;
  return {
    x: Math.floor(center.x / screen.width) * screen.width,
    y: screen.originY + Math.floor((center.y - screen.originY) / screen.height) * screen.height,
  };
}

// Picks the largest whole multiple of the art's own pixels that fits the window, so the map stays
// crisp, and centers the picture, with #screenFrame's surround filling whatever's left.
function updateViewScale(){
  let multiple = Math.max(1, Math.floor(Math.min(
    window.innerWidth / SOURCE_SCREEN_WIDTH,
    window.innerHeight / SOURCE_SCREEN_HEIGHT
  )));
  let pictureWidth = SOURCE_SCREEN_WIDTH * multiple;
  let pictureHeight = SOURCE_SCREEN_HEIGHT * multiple;

  view.scale = pictureWidth / weavePage.screen.width;
  view.offsetX = Math.floor((window.innerWidth - pictureWidth) / 2);
  view.offsetY = Math.floor((window.innerHeight - pictureHeight) / 2);

  screenFrameEl.style.left = view.offsetX + "px";
  screenFrameEl.style.top = view.offsetY + "px";
  screenFrameEl.style.width = pictureWidth + "px";
  screenFrameEl.style.height = pictureHeight + "px";
}

// Which top-level location the ship is standing on drives the open card - a multi-part location's
// nested nodes aren't out on the map to walk to, so they never compete here.
// This only decides *which root*, resetting back to the start of its chain whenever the root itself
// changes. Only counts
// once the ship has actually stopped, so holding a direction straight across a node doesn't flash
// its card open and shut on the way past.
function updateNodeProximity(){

  let root = playerMover.isMoving ? null : (rootByCell.get(cellKey(playerMover.cell)) ?? null);

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

    let activeMember = (node === activeRoot && activeNode) ? activeNode : node;

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

// Whether Track Focus may move on from this chain member. The one place a "solve this part's
// Sokoban first" rule goes - nothing is locked yet.
function canAdvanceChain(member){
  return true;
}

// X (keyboard) / X (gamepad): in Track Focus, step to the next part of the current location, wrapping
// back to the first. Its music crossfades on its own, since updateLocationAudio follows activeNode.
function cycleChainNode(){
  if (!trackFocusEl) return;

  let chain = nodeMeta.get(activeRoot).chain;
  if (chain.length <= 1 || !canAdvanceChain(activeNode)) return;

  chainIndex = (chainIndex + 1) % chain.length;
  activeNode = chain[chainIndex];
  renderTrackFocus();
}

// Whether something is covering the whole screen, leaving the map underneath out of reach.
function isScreenCovered(){
  return modalQueue.length > 0 || trackFocusEl !== null;
}

// Z (keyboard) / A (gamepad). Whatever is covering the screen takes this over entirely: a modal
// card (see modalQueue) first, then Track Focus - closing it, never onInteract().
function onInteractButton(){
  if (modalQueue.length > 0) closeCurrentModal();
  else if (trackFocusEl) closeTrackFocus();
  else onInteract();
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

    // Empty for now: where a 10x10 board laid over the art goes, sized to exactly match it - see
    // updateTrackFocusScale for the tile size it gets to work with.
    let board = document.createElement('div');
    board.id = 'trackFocusBoard';
    frame.appendChild(board);

    content.appendChild(frame);
  }

  let text = document.createElement('div');
  text.id = 'trackFocusText';

  let heading = document.createElement('h2');
  heading.textContent = title ? title.textContent : '';
  text.appendChild(heading);

  lines.forEach(line => text.appendChild(line.cloneNode(true)));

  let actions = document.createElement('div');
  actions.id = 'trackFocusActions';
  if (nodeMeta.get(activeRoot).chain.length > 1) {
    actions.appendChild(buildTrackFocusAction('[ Next ]', 'img/ui/key_x.gif', cycleChainNode));
  }
  actions.appendChild(buildTrackFocusAction('[ Close ]', 'img/ui/key_z.gif', closeTrackFocus));
  // Only reachable from here for a chain's later parts, since their cards never open on the map.
  if (download) actions.appendChild(download.cloneNode(true));
  text.appendChild(actions);

  content.appendChild(text);
  trackFocusEl.appendChild(content);

  // Clicking anywhere that isn't the art or the text dismisses it, same as a modal's backdrop.
  content.addEventListener('click', (e) => {
    if (e.target === content) closeTrackFocus();
  });
}

function buildTrackFocusAction(label, hintSrc, onClick){
  let action = document.createElement('span');
  action.className = 'trackFocusAction';

  let text = document.createElement('span');
  text.textContent = label;
  text.addEventListener('click', onClick);
  action.appendChild(text);

  let hint = document.createElement('img');
  hint.className = 'keyHint';
  hint.src = hintSrc;
  action.appendChild(hint);

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

// Album art is 240x240, and only stays crisp - with whole-pixel tiles for a 10x10 board over it, 24
// source pixels each - at a whole-number scale. So that's what this picks: the largest that fits.
const TRACK_FOCUS_ART_PX = 240;
const TRACK_FOCUS_BOARD_SQUARES = 10;
const TRACK_FOCUS_MAX_HEIGHT_FRACTION = 0.8;
const TRACK_FOCUS_MAX_WIDTH_FRACTION = 0.45;

function updateTrackFocusScale(){
  if (!trackFocusEl) return;

  let available = Math.min(
    window.innerHeight * TRACK_FOCUS_MAX_HEIGHT_FRACTION,
    window.innerWidth * TRACK_FOCUS_MAX_WIDTH_FRACTION
  );
  let scale = Math.max(1, Math.floor(available / TRACK_FOCUS_ART_PX));

  trackFocusEl.style.setProperty('--focus-scale', scale);
  trackFocusEl.style.setProperty('--focus-cell', (TRACK_FOCUS_ART_PX / TRACK_FOCUS_BOARD_SQUARES * scale) + 'px');
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
  updateNodeProximity();
  updateLocationAudio(dt);
  updateHubMusicSignal();

  requestAnimationFrame(loop);
}
