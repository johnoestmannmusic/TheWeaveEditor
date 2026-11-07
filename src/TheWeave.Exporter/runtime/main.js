// main.js
// John Oestmann
// The Weave Explorer's page script: its state, setup and frame loop
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
// The page script is split by concern into several files, all sharing one set of page-wide names: this one holds the
// page's state, its setup and the frame loop, and loads first, followed in order by loading.js, cards.js, map.js,
// audio.js, trackFocus.js and effects.js. Setup only runs once they've all loaded.
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
// The puzzle boardGame is being played from: what it's drawn with. Kept rather than looked up from activeNode, which
// moves on to the next part before the board has finished flipping away - see finishBoardLevel.
let boardPuzzle = null;
let boardObjectsCanvas = null;
let boardObjectsImage = null; // the art-sized pixels drawn onto that canvas - see drawBoardObjects
// The board being played - see board.js. boardGame and boardMover are its game and its ship's mover.
let boardPlay = null;
// What was drawn last, so that a board that looks just as it did isn't drawn again - see drawBoardObjects.
let boardDrawnKey = null;
let boardSolvedMs = null; // how long ago it was solved, while pausing there before returning to Track Focus
// Each part's board as it was last left, while crossing between connected boards: part -> { game, cell }.
// Forgotten on leaving the board - see crossBoard.
let boardVisits = new Map();
// While one part's board scrolls across to the next's: the two slide layers, the edge it's crossing, and how
// far through - see startBoardScroll.
let boardScroll = null;
let activeNode = null;   // the current track: activeRoot, or the chain member Track Focus is on
let activeRoot = null;   // the top-level node the ship is currently within range of
let chainIndex = 0;      // activeNode's position within activeRoot's chain
let arrivalRoot = null;  // the node back to The Weave the ship arrived on and hasn't left yet - see noteArrivalRoot

// The page's own config (see window.__weavePage, emitted per-page by PageConfigScriptRenderer) -
// worldWidth/worldHeight are the page's authoritative world size, and grid is the board of squares
// the ship walks (see loadPageConfig).
let weavePage = { id: '', globeEffect: false, worldWidth: 0, worldHeight: 0, defaultSpawnX: null, defaultSpawnY: null, isHomePage: false, grid: null, screen: null };


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
let fog = null; // what's still unexplored on a planet - see buildFog

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
  // Before anything puts a transform on <body> - see initLoadingScreen.
  initLoadingScreen();

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
  buildFog();
  buildMinimap();
  buildMapContrails();
  updateViewScale();
  refreshNodeLocks();
  placePersistentCards();
  bindInput();
  claimOwnFocus();
  trackPageLoading();
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

  weavePage.id = cfg.id ?? '';
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
  // Moved by its transform alone, which the browser can do without laying the page out again - see renderShip.
  shipEl.style.left = "0px";
  shipEl.style.top = "0px";
  document.body.appendChild(shipEl);

  renderShip();
}

function loadNodes() {

  // Create an array of all location nodes
  nodeList = document.querySelectorAll(".node");

  nodeList.forEach(curNode => {

    let curImg = curNode.querySelector(".nodeImage");
    let curInfo = curNode.querySelector(".floatInfo");
    // A race's icon is a different colour, so it takes a different turn to go green once completed - see main.css.
    if (curImg?.getAttribute('src').includes('race')) curNode.classList.add('raceNode');

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
      // A top-level location's own stages, and its requirements' - see refreshNodeLocks.
      stages: curNode.dataset.stages ? JSON.parse(curNode.dataset.stages) : [],
      requires: curNode.dataset.requires ? JSON.parse(curNode.dataset.requires) : [],
      locked: false,
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

function loop(timestamp){
  // The next frame is asked for first, so that if anything goes wrong in this one, the game carries on rather
  // than freezing for good. The error still shows in the browser's console.
  requestAnimationFrame(loop);

  if (lastFrameTime === null) lastFrameTime = timestamp;
  let dt = clamp((timestamp - lastFrameTime) / (1000 / 60), 0, 3);
  lastFrameTime = timestamp;

  updateInput();
  updateMapCovered();
  updateShip(dt);
  if (!mapCovered) {
    updateFog(dt * MS_PER_FRAME);
    updateView(dt * MS_PER_FRAME);
    updateMapContrails(dt * MS_PER_FRAME);
    updateMinimap();
  }
  updateBoardGame(dt * MS_PER_FRAME);
  updateNodeProximity();
  updateLocationAudio(dt);
  updateHubMusicSignal();
}
