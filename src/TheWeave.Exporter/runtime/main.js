// main.js
// John Oestmann
// All JS functionality for The Weave Explorer in here
//
// Navigation: walk the ship one square at a time with Arrow Keys, a gamepad D-pad, or a gamepad
// stick - hold a direction to keep going, let go to stop on the square you're heading into (see
// sokoban.js, which owns the movement itself). Press Z (keyboard) or A (gamepad) to interact with
// whatever location the ship is standing on - travels to its linked page, or opens a track's Track
// Focus screen. When that location has extra nested locations tucked inside its card (a multi-part
// story), press X (keyboard) or X (gamepad) to step between them without having to move.
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
let activeNode = null;   // whichever card is currently shown (a root, or one of its chain)
// performance.now() timestamp of the moment activeNode last changed identity (null while no
// card is active) - see CARD_FOCUS_DELAY_MS in updateCamera: the camera only starts heading
// toward a card once it's stayed the *same* activeNode this long, so passing near a location (or
// quickly X-cycling through a chain) doesn't drag the camera around - only actually stopping on
// one does.
let activeNodeSince = null;
let activeRoot = null;   // the top-level node the ship is currently within range of
let chainIndex = 0;      // activeNode's position within activeRoot's chain

// The page's own config (see window.__weavePage, emitted per-page by PageConfigScriptRenderer) -
// worldWidth/worldHeight are the page's authoritative world size, and grid is the board of squares
// the ship walks (see loadPageConfig).
let weavePage = { globeEffect: false, worldWidth: 0, worldHeight: 0, defaultSpawnX: null, defaultSpawnY: null, listeningRadiusPx: null, isHomePage: false, grid: null };

// Cosmetic globe-curvature hint (Page.GlobeEffect - see updateGlobeEffect). A purely screen-space
// effect. Every top-level node icon that should get the effect - built once at load rather than
// re-queried every frame.
let globeEffectIcons = [];

// Ship tuning
const SHIP_WIDTH = 40;
const NODE_ICON_SIZE = 48; // matches .nodeImage's width in main.css
const STEP_MS = 240; // how long walking one square takes
const MS_PER_FRAME = 1000 / 60; // loop()'s dt is measured in 60fps frames
// Sprite rotation for each direction sokoban.js can be facing.
const FACING_ANGLES = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };

// Location-zoned audio tuning (see updateLocationAudio). LISTEN_RADIUS_FALLBACK mirrors
// WeaveProject's own schema default (105px) - used only if a page somehow loads without
// window.__weavePage.listeningRadiusPx (e.g. an export from before this existed).
// PRELOAD_RADIUS_MULTIPLIER controls how much earlier (as a multiple of the audible radius) a
// track starts buffering than it needs to actually be heard - location tracks are commonly
// hosted at an external URL (see Card.Audio.Url), so buffering has to have a head start on
// becoming audible or there'd be a silent gap right as a location should start fading in.
const LISTEN_INNER_RADIUS = 100; // full volume within this distance
const LISTEN_RADIUS_FALLBACK = 105;
const PRELOAD_RADIUS_MULTIPLIER = 3;
let listenRadius = LISTEN_RADIUS_FALLBACK;
let preloadRadius = LISTEN_RADIUS_FALLBACK * PRELOAD_RADIUS_MULTIPLIER;
const AUDIO_VOLUME_EASE = 0.85; // per-second retention factor, applied as Math.pow(x, dt)
// Well above a typical stick's resting drift: pushing it now picks one of four whole directions
// (see readPadDirection) rather than a proportional amount of anything, so a light, accidental lean
// shouldn't walk the ship anywhere.
const GAMEPAD_DEADZONE = 0.5;

// Camera tuning. The camera doesn't track the ship 1:1 - it eases toward a target point that
// leads the ship by LOOK_AHEAD_FRACTION of the viewport in whichever direction it's currently
// facing, so more of what's ahead is visible than what's behind (2/3 ahead, 1/3 behind - see
// updateCamera). CAMERA_EASE is a per-second retention factor, applied as Math.pow(x, dt) - without
// easing, the look-ahead point would snap across the screen every time the ship turned to face a
// new direction.
const LOOK_AHEAD_FRACTION = 1 / 6; // fraction of viewport width/height, applied per-axis
const CAMERA_EASE = 0.95;
const CARD_FOCUS_EASE = 0.97; // slower than CAMERA_EASE - settling on a card should read as deliberate, not a snap
const CARD_FOCUS_DELAY_MS = 450;

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

// Camera state - the eased point (tracking either the ship or a focused card) updateCamera
// scrolls to keep centered.
let camera = { x: 0, y: 0, initialized: false };
// The separately-eased look-ahead bias added on top of camera.x/y - see updateCamera.
let lookAhead = { x: 0, y: 0, initialized: false };
// Whether updateCamera is currently tracking a focused card (set at the end of every call) -
// consulted by showChainMember so X-cycling while already settled on a card doesn't re-arm
// CARD_FOCUS_DELAY_MS and revert to ship-tracking before panning to the next member.
let cameraFocused = false;

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
  if (weavePage.globeEffect) buildGlobeEffect();
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
  // Page.DefaultSpawnX/Y - where initShip() puts the ship when this page is opened with no
  // travel/query-string position at all (e.g. a bare URL, or the shell's iframe on first load).
  // Null/undefined (no Page override configured) leaves these null - initShip() itself falls
  // back to its own hardcoded default in that case.
  weavePage.defaultSpawnX = cfg.defaultSpawnX ?? null;
  weavePage.defaultSpawnY = cfg.defaultSpawnY ?? null;

  // WeaveProject.ListeningRadiusPx - project-wide, not per-page (see updateLocationAudio).
  // Floored well above LISTEN_INNER_RADIUS so the fade math there never divides by ~0, even if
  // the project value is missing, zero, or set below the inner radius by mistake.
  weavePage.listeningRadiusPx = cfg.listeningRadiusPx ?? null;
  listenRadius = Math.max(weavePage.listeningRadiusPx || LISTEN_RADIUS_FALLBACK, LISTEN_INNER_RADIUS + 1);
  preloadRadius = listenRadius * PRELOAD_RADIUS_MULTIPLIER;

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

// Sets up the cosmetic globe-curvature hint (Page.GlobeEffect): a fixed vignette overlay (see
// #globeVignette in main.css) plus the per-frame icon scale/fade updateGlobeEffect() drives.
// Only ever called when weavePage.globeEffect is true.
function buildGlobeEffect(){
  nodeMeta.forEach((meta, node) => {
    if (meta.isTopLevel && !meta.isModal) globeEffectIcons.push(meta.img);
  });

  // Appended to <html>, deliberately *not* document.body - body gets a `transform` applied every
  // frame (updateCamera's sub-pixel scroll correction), and per the CSS spec a `transform` on an
  // ancestor changes what a `position: fixed` descendant is contained by: instead of the
  // viewport, it becomes the *transformed ancestor's own box* - here, the whole (huge)
  // world, not the screen. A child of body would size itself to that instead of the viewport,
  // which is what made the vignette look "attached to the background" rather than the screen.
  // <html> itself never gets a transform, so a fixed child of it is immune to that regardless of
  // what body does.
  let vignette = document.createElement("div");
  vignette.id = "globeVignette";
  document.documentElement.appendChild(vignette);
}

// Purely cosmetic, screen-space only - never touches ship/camera/proximity math, and safe to
// call every frame regardless of dt (there's nothing to be time-consistent about: it's just a
// direct function of the current, already-eased scroll position). Every top-level node icon
// (not the .floatInfo cards themselves - see buildGlobeEffect) scales down and fades slightly
// as it nears the screen edge, to read as falling away over a curved horizon; #globeVignette
// (see main.css) supplies the matching edge darkening. Reads every icon's rect before writing
// any style (two separate loops below) so the browser can batch all the layout reads together
// instead of alternating read/write and forcing a reflow per icon.
const GLOBE_EFFECT_INNER = 0.45; // fraction of the screen half-diagonal where falloff begins
const GLOBE_EFFECT_OUTER = 1.05; // fraction where falloff finishes (just past the true edge)
const GLOBE_EFFECT_MIN_SCALE = 0.65;
const GLOBE_EFFECT_MIN_OPACITY = 0.35;

function updateGlobeEffect(){
  let halfW = window.innerWidth / 2;
  let halfH = window.innerHeight / 2;

  let falloffs = globeEffectIcons.map(icon => {
    let rect = icon.getBoundingClientRect();
    let dx = (rect.left + rect.width / 2 - halfW) / halfW;
    let dy = (rect.top + rect.height / 2 - halfH) / halfH;
    let r = Math.hypot(dx, dy);
    return clamp((r - GLOBE_EFFECT_INNER) / (GLOBE_EFFECT_OUTER - GLOBE_EFFECT_INNER), 0, 1);
  });

  for (let i = 0; i < globeEffectIcons.length; i++) {
    let t = falloffs[i];
    let scale = 1 - t * (1 - GLOBE_EFFECT_MIN_SCALE);
    let opacity = 1 - t * (1 - GLOBE_EFFECT_MIN_OPACITY);
    globeEffectIcons[i].style.transform = "scale(" + scale + ")";
    globeEffectIcons[i].style.opacity = opacity;
  }
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
  updateCamera();
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
    // <body> - <body> gets a `transform` applied every frame by updateCamera()'s sub-pixel
    // scroll correction, which (per the CSS spec) makes any `position: fixed` descendant fixed
    // relative to *that transformed box* instead of the viewport. This is the exact same trap
    // buildGlobeEffect() already had to work around for #globeVignette - see its own comment for
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
      // The X-cycle hint PageRenderer renders as a direct child of this node, if this node is
      // part of a chain at all (:scope so a nested chain member's own .chainHint isn't picked up
      // instead - see updateChainHint()). null for a node that's never part of any chain.
      chainHint: curNode.querySelector(':scope > .chainHint') ?? null,
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

  // A multi-part location's nested nodes aren't reachable by walking to them
  // directly (see getNodeCenter) - the X button instead steps through each
  // top-level node's own chain (itself, then every descendant, depth-first)
  // without the ship needing to move. Branching Children would flatten into
  // one cycle order here too, though in practice these are linear chains.
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

// Maps every top-level node to the square it sits on, for updateNodeProximity. Reads the authored
// position rather than getNodeCenter()'s live measurement, since this runs before images have
// loaded and an unloaded icon doesn't have its real height yet. A nested node never gets an entry:
// it's reached by X from its root, not by being walked to.
function indexNodesByCell(){
  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;

    let x = (parseFloat(node.style.left) || 0) + NODE_ICON_SIZE / 2;
    let y = (parseFloat(node.style.top) || 0) + NODE_ICON_SIZE / 2;
    let key = cellKey(weavePage.grid.cellAt(x, y));
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

// World-space center of a node's icon. Measured from the .nodeImage itself
// (not the wrapping .node div, which - like everything on this site - is
// position:absolute with no in-flow children, so it has no intrinsic size
// of its own to measure). Computed live rather than cached because some
// nodes are nested inside another node's card (e.g. a "next page" story
// node placed a little further into Salanth Town Gardens' info panel on
// Ouros) - their real position only resolves once that ancestor card is
// open, and is relative to it rather than to the map.
function getNodeCenter(meta){
  let rect = meta.img.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX + rect.width / 2,
    y: rect.top + window.scrollY + rect.height / 2,
  };
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
    if ((e.key === 'x' || e.key === 'X') && !e.repeat && !isScreenCovered()) cycleChainNode();
    if (e.key === 'Escape' && !e.repeat) closeTrackFocus();
  });

  document.addEventListener('keyup', (e) => {
    let direction = KEY_DIRECTIONS[e.key];
    if (direction) playerMover.release(direction);
  });

  window.addEventListener('resize', updateTrackFocusScale);

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
      if (xDown && !gamepadCycleWasDown && !isScreenCovered()) cycleChainNode();
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

  // A modal card or Track Focus traps input entirely while it's showing - the ship simply doesn't
  // move, and a press made underneath it doesn't suddenly fire the moment it closes.
  if (isScreenCovered()) {
    playerMover.clearQueue();
    return;
  }

  playerMover.update(dt * MS_PER_FRAME);
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
  // Deliberately *not* rounded, unlike the scroll target in updateCamera - the world content
  // (background, nodes) is all static, already-integer-positioned markup, so rounding only the
  // scroll keeps it crisp; the ship is the one thing that actually needs to move smoothly every
  // frame. Rounding it too would make a steady glide visibly alternate between neighboring whole
  // pixel steps, which is its own kind of shake - a single small sprite sitting at a sub-pixel
  // offset is far less noticeable than that.
  shipEl.style.left = (ship.x - SHIP_WIDTH / 2) + "px";
  shipEl.style.top = (ship.y - SHIP_WIDTH / 2) + "px";
  // Sprite's forward points "up" (angle -90deg) at rest, so offset by +90deg
  shipEl.style.transform = "rotate(" + (ship.angle + Math.PI / 2) + "rad)";
}

// dt defaults to 1 because the one call site that omits it (initShip's very first call) always
// takes the "not yet initialized" snap path below, which doesn't use dt at all.
//
// This is split into two independently-eased pieces - *what* the camera tracks (camera.x/y) and
// *how far ahead of that it leads* (lookAhead.x/y, a small plain offset) - so a change of heading
// and a change of target each ease at their own rate.
function updateCamera(dt = 1){
  // What the camera tracks: the ship's own position, unless a card is open *and the player has
  // actually settled on it* (the same activeNode for CARD_FOCUS_DELAY_MS - see setter sites in
  // showChainMember/hideChain), in which case it tracks that card's actual rendered center instead.
  // The delay is deliberate: without it, quickly X-cycling through a chain would drag the camera
  // around before the player had any intention of reading that particular card. Reads
  // getBoundingClientRect() rather than re-deriving the offset math, so it's automatically correct
  // for any card size/offset/nesting depth. A straight center-on-card (rather than the minimal
  // shift needed to only just bring it inside the viewport) is deliberate too - the minimal-shift
  // version tended to leave the card pinned against whichever edge it had been overflowing, i.e. in
  // a corner, instead of settling somewhere comfortable.
  let focused = false;
  let trackX = ship.x;
  let trackY = ship.y;
  let easeFactor = CAMERA_EASE;

  // !isMoving is a live, continuous condition (not just checked once) - a card only ever opens once
  // the ship has stopped, but walking off again should drop back to plain ship-tracking immediately.
  if (!playerMover.isMoving && activeNode && activeNodeSince !== null && performance.now() - activeNodeSince >= CARD_FOCUS_DELAY_MS) {
    let info = nodeMeta.get(activeNode).info;
    if (info.style.display !== 'none') {
      let rect = info.getBoundingClientRect();
      trackX = rect.left + rect.width / 2 + window.scrollX;
      trackY = rect.top + rect.height / 2 + window.scrollY;
      focused = true;
      easeFactor = CARD_FOCUS_EASE;
    }
  }
  cameraFocused = focused;

  if (!camera.initialized) {
    camera.x = trackX;
    camera.y = trackY;
    camera.initialized = true;
  } else {
    let ease = 1 - Math.pow(easeFactor, dt);
    camera.x += (trackX - camera.x) * ease;
    camera.y += (trackY - camera.y) * ease;
  }

  // Lead the ship by a fraction of the viewport in whichever direction it's currently facing (and
  // not at all while focused on a card), so more of the world ahead is visible than what's behind
  // (2/3 ahead, 1/3 behind: the ship sits 1/3 of the way from the trailing edge along its heading,
  // which means the *camera's* center has to sit ahead of the ship by (1/2 - 1/3) = 1/6 of the
  // viewport). Each axis uses its own viewport dimension (not a single shared magnitude) so a
  // heading gets the exact 2/3-1/3 split rather than one skewed by the viewport's aspect ratio.
  // Eased on its own so turning to face a new direction doesn't yank the view.
  let desiredLookX = focused ? 0 : Math.cos(ship.angle) * window.innerWidth * LOOK_AHEAD_FRACTION;
  let desiredLookY = focused ? 0 : Math.sin(ship.angle) * window.innerHeight * LOOK_AHEAD_FRACTION;

  if (!lookAhead.initialized) {
    lookAhead.x = desiredLookX;
    lookAhead.y = desiredLookY;
    lookAhead.initialized = true;
  } else {
    let lookEase = 1 - Math.pow(CAMERA_EASE, dt);
    lookAhead.x += (desiredLookX - lookAhead.x) * lookEase;
    lookAhead.y += (desiredLookY - lookAhead.y) * lookEase;
  }

  let maxScrollX = Math.max(0, document.body.scrollWidth - window.innerWidth);
  let maxScrollY = Math.max(0, document.body.scrollHeight - window.innerHeight);

  let targetX = camera.x + lookAhead.x;
  let targetY = camera.y + lookAhead.y;

  let clampedX = clamp(targetX - window.innerWidth / 2, 0, maxScrollX);
  let clampedY = clamp(targetY - window.innerHeight / 2, 0, maxScrollY);

  // window.scrollTo() turns out to only have whole-pixel precision in practice - confirmed
  // directly (a minimal test page, no game code involved): Chrome silently rounds whatever
  // fractional value is passed here before it's readable back via window.scrollX/Y, regardless of
  // what's passed in. Whenever the camera is easing, its rate of change isn't a whole number of
  // pixels/frame, so the rounding lands on a different side of the true value frame to frame in a
  // way that reads as a faint stepping, and it affects everything on screen (ship included - the
  // ship's own position is unrounded, but it's still rendered *relative to* this same rounded
  // scroll).
  //
  // A CSS translate on body supplies exactly the fractional remainder scrollTo() rounded away.
  // This is purely a paint-time adjustment - it doesn't disturb the scroll mechanism's own
  // (coarse, integer) positioning or clamping above, and every getBoundingClientRect() call
  // elsewhere (proximity, card-focus tracking) already reflects it automatically, so nothing else
  // needs to change to account for it.
  window.scrollTo(clampedX, clampedY);
  document.body.style.transform =
    "translate(" + (window.scrollX - clampedX) + "px, " + (window.scrollY - clampedY) + "px)";
}

// Which top-level location the ship is standing on drives the open card - a multi-part location's
// nested nodes aren't out on the map to walk to (see getNodeCenter), so they never compete here.
// Once a root is active, X steps through its chain (see cycleChainNode); this only decides *which
// root*, resetting back to the start of its chain whenever the root itself changes. Only counts
// once the ship has actually stopped, so holding a direction straight across a node doesn't flash
// its card open and shut on the way past.
function updateNodeProximity(){

  let root = playerMover.isMoving ? null : (rootByCell.get(cellKey(playerMover.cell)) ?? null);

  if (root !== activeRoot) {
    if (activeRoot) hideChain(activeRoot);
    activeRoot = root;
    chainIndex = 0;
    if (activeRoot) showChainMember(activeRoot, 0);
  }
}

// Location-zoned music: every top-level root's own track (or whichever chain member the player
// has X-cycled to - see cycleChainNode) fades in as the ship approaches that root's center, up
// to full volume within LISTEN_INNER_RADIUS, and fades to silent by listenRadius. listenRadius is
// one shared, project-configured value (see loadPageConfig) rather than something computed from node
// spacing here - the editor is responsible for keeping it small enough that no two locations'
// audible zones overlap.
//
// Distance is measured to the *root* even when a deeper chain member is the one actually
// sounding, since only top-level nodes have a real map position (see getNodeCenter) - a nested
// chain member's music is "the root's location, a different track," not a different place.
//
// Every other (non-active) member of the same chain is eased toward 0 right alongside the active
// one, rather than snapped to pause immediately - that's what makes X-cycling from a root to a
// child (or back) read as a crossfade instead of a hard cut.
function updateLocationAudio(dt){
  let ease = 1 - Math.pow(AUDIO_VOLUME_EASE, dt);

  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;

    let center = getNodeCenter(meta);
    let d = Math.hypot(ship.x - center.x, ship.y - center.y);

    // Start buffering well before the track needs to be audible - see PRELOAD_RADIUS_MULTIPLIER's
    // own comment on why (external-URL tracks need a head start). The whole chain preloads
    // together (not just whichever member happens to be active right now) so stepping into a
    // child with X once close doesn't hit a cold, unbuffered element.
    if (d <= preloadRadius) {
      for (const member of meta.chain) {
        let memberMeta = nodeMeta.get(member);
        if (memberMeta.audio && !memberMeta.audioPreloaded) {
          memberMeta.audioPreloaded = true;
          memberMeta.audio.preload = 'auto';
          memberMeta.audio.load();
        }
      }
    }

    let audibility = clamp((listenRadius - d) / (listenRadius - LISTEN_INNER_RADIUS), 0, 1);
    let activeMember = (node === activeRoot && activeNode) ? activeNode : node;

    for (const member of meta.chain) {
      let memberMeta = nodeMeta.get(member);
      let audio = memberMeta.audio;
      if (!audio) continue;

      let target = (member === activeMember) ? audibility : 0;
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
// home page itself, otherwise the same distance-based fade curve updateLocationAudio uses,
// applied to the closest node whose Travel action leads back to the home page (see
// PageRenderer's data-travel-home marker) - so approaching one of those "return to the hub"
// nodes previews the hub theme before you actually arrive. A no-op when this page isn't embedded
// in the shell's iframe at all (e.g. opened directly), same guard as notifyShellOfInteraction.
function updateHubMusicSignal(){
  if (window.parent === window) return;

  let audibility = 0;

  if (weavePage.isHomePage) {
    audibility = 1;
  } else {
    nodeMeta.forEach((meta, node) => {
      if (!meta.isTopLevel || meta.isModal || !meta.travelHome) return;

      let center = getNodeCenter(meta);
      let d = Math.hypot(ship.x - center.x, ship.y - center.y);
      let a = clamp((listenRadius - d) / (listenRadius - LISTEN_INNER_RADIUS), 0, 1);
      if (a > audibility) audibility = a;
    });
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
}

// Closes every card in a root's chain - used when the ship leaves it entirely. (Cycling
// within the same root doesn't call this - see showChainMember.)
function hideChain(root){
  for (const node of nodeMeta.get(root).chain) {
    let meta = nodeMeta.get(node);
    if (meta.chainHint) meta.chainHint.style.display = 'none';
    if (!meta.persistent) {
      setCardOpen(node, meta, false);
      meta.img.src = 'img/node.png';
    }
  }
  activeNode = null;
  activeNodeSince = null;
}

// Shows chain[index] and clears activeNode/img back to every OTHER member. Nested cards
// live inside their parent's own .floatInfo (that's how "parent-card-relative" positioning
// works), so a nested card's own display:'' does nothing while an ancestor card containing
// it is display:none - every ancestor from the root down to the target has to stay open too
// (chain[0..index] here), not just the target itself. Anything past the target closes, in
// case this is stepping backward from a deeper member.
function showChainMember(root, index){
  let chain = nodeMeta.get(root).chain;
  for (let i = 0; i < chain.length; i++) {
    let meta = nodeMeta.get(chain[i]);
    // Cleared unconditionally (even for a persistent member, and regardless of index) - reset
    // below to the one actual "next" member, the only case that should ever show it.
    if (meta.chainHint) meta.chainHint.style.display = 'none';
    if (meta.persistent) continue;
    setCardOpen(chain[i], meta, i <= index);
    meta.img.src = (i === index) ? 'img/node-active.png' : 'img/node.png';
  }
  // The X-cycle hint belongs on whichever member is next, never the active one itself - wraps
  // back to chain[0] past the last member, since cycleChainNode's own %chain.length does too.
  if (chain.length > 1) {
    let nextHint = nodeMeta.get(chain[(index + 1) % chain.length]).chainHint;
    if (nextHint) nextHint.style.display = 'block';
  }
  // Only re-arm the settle delay when the camera isn't already focused on a card - otherwise
  // X-cycling to the next chain member while already settled would revert to ship-tracking and
  // force another CARD_FOCUS_DELAY_MS wait before panning to it. When cameraFocused is true,
  // activeNodeSince is left exactly as it is (already well past the delay threshold), so
  // updateCamera's focus condition stays true on the very next frame and its continuous
  // re-targeting (see updateCamera) picks up the new activeNode's card and eases straight there.
  //
  // The `activeNodeSince === null` half matters for a genuine root change: hideChain() always
  // nulls activeNodeSince unconditionally right before this runs (called from
  // updateNodeProximity when switching roots), so if the *previous* root happened to be focused,
  // cameraFocused would still read true here even though it no longer describes anything - without
  // this check the reset gets skipped, activeNodeSince stays permanently null, and the new root
  // can never focus at all.
  if (activeNode !== chain[index] && (activeNodeSince === null || !cameraFocused)) activeNodeSince = performance.now();
  activeNode = chain[index];
}

// X (keyboard) / X (gamepad): step to the next location in the current
// root's chain - the way to reach a multi-part location's later parts,
// since they aren't out on the map to walk to.
function cycleChainNode(){
  if (!activeRoot) return;

  let chain = nodeMeta.get(activeRoot).chain;
  if (chain.length <= 1) return;

  chainIndex = (chainIndex + 1) % chain.length;
  showChainMember(activeRoot, chainIndex);
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

// Track Focus: a full-screen view of the active track (whichever chain member X has landed on) -
// album art on the left, title and poetry on the right, over the dimmed map and a blown-up, blurred
// copy of the art that gives the whole screen its palette. Its music carries on playing, since the
// ship stays exactly where it is (see updateLocationAudio).
//
// Everything shown is read from the card already in the page, rather than being rendered a second
// time per node. :scope matters here: a chain member's card contains every later member's whole
// card (see the README's nesting section), so a plain querySelector could find the wrong track's.
//
// Appended to <html>, not <body>, for the same reason as #modalBackdrop - see #globeVignette's
// comment in buildGlobeEffect.
function openTrackFocus(){
  if (trackFocusEl || !activeNode) return;

  let info = nodeMeta.get(activeNode).info;
  let cover = info.querySelector(':scope > .songCover');
  let title = info.querySelector(':scope > h3');
  let lines = info.querySelectorAll(':scope > .poetry-text > .poetry-line');

  trackFocusEl = document.createElement('div');
  trackFocusEl.id = 'trackFocus';

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

  let close = document.createElement('div');
  close.id = 'trackFocusClose';
  let closeLabel = document.createElement('span');
  closeLabel.textContent = '[ Close ]';
  closeLabel.addEventListener('click', closeTrackFocus);
  let closeHint = document.createElement('img');
  closeHint.className = 'keyHint';
  closeHint.src = 'img/ui/key_z.gif';
  close.append(closeLabel, closeHint);
  text.appendChild(close);

  content.appendChild(text);
  trackFocusEl.appendChild(content);

  // Clicking anywhere that isn't the art or the text dismisses it, same as a modal's backdrop.
  content.addEventListener('click', (e) => {
    if (e.target === content) closeTrackFocus();
  });

  updateTrackFocusScale();
  document.documentElement.appendChild(trackFocusEl);
}

// A no-op when it isn't open, so every way of closing it can just call this.
function closeTrackFocus(){
  if (!trackFocusEl) return;
  trackFocusEl.remove();
  trackFocusEl = null;
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
  updateCamera(dt);
  updateNodeProximity();
  updateLocationAudio(dt);
  updateHubMusicSignal();
  if (weavePage.globeEffect) updateGlobeEffect();

  requestAnimationFrame(loop);
}
