// main.js
// John Oestmann
// All JS functionality for The Weave Explorer in here
//
// Navigation: fly the ship with Arrow Keys or a gamepad stick (light turning
// inertia, mostly-instant thrust). Press Z (keyboard) or A (gamepad) to
// interact with whatever location the ship is currently near - starts/pauses
// its music, or travels to its linked page. When that location has extra
// nested locations tucked inside its card (a multi-part story), press X
// (keyboard) or X (gamepad) to step between them without having to move.
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
let activeNode = null;   // whichever card is currently shown (a root, or one of its chain)
// performance.now() timestamp of the moment activeNode last changed identity (null while no
// card is active) - see CARD_FOCUS_DELAY_MS in updateCamera: the camera only starts heading
// toward a card once it's stayed the *same* activeNode this long, so passing near a location (or
// quickly X-cycling through a chain) doesn't drag the camera around - only actually stopping on
// one does.
let activeNodeSince = null;
let activeRoot = null;   // the top-level node the ship is currently within range of
let chainIndex = 0;      // activeNode's position within activeRoot's chain

// Globe wraparound (see window.__weavePage, emitted per-page by PageConfigScriptRenderer).
// worldWidth/worldHeight are the page's authoritative world size - not document.body's actual
// scrollWidth/Height, which for a wrapping page is 3x larger once the ghost tiles below exist.
let weavePage = { wraps: false, globeEffect: false, worldWidth: 0, worldHeight: 0, defaultSpawnX: null, defaultSpawnY: null, listeningRadiusPx: null };
// Top-level node element -> its 8 ghost clones (one per non-center tile in the 3x3 wrap grid).
// Only populated when weavePage.wraps is true.
let ghostRoots = new Map();

// Cosmetic globe-curvature hint (Page.GlobeEffect - see updateGlobeEffect). Independent of
// weavePage.wraps: it's a purely screen-space effect, so it works the same whether or not this
// page actually wraps. Every top-level node icon that should get the effect (the real one, plus
// every ghost tile's copy on a wrapping page) - built once at load rather than re-queried every
// frame.
let globeEffectIcons = [];

// Ship tuning
const SHIP_WIDTH = 40;
const INTERACT_RADIUS = 100;

// Location-zoned audio tuning (see updateLocationAudio). LISTEN_RADIUS_FALLBACK mirrors
// WeaveProject's own schema default (105px) - used only if a page somehow loads without
// window.__weavePage.listeningRadiusPx (e.g. an export from before this existed).
// PRELOAD_RADIUS_MULTIPLIER controls how much earlier (as a multiple of the audible radius) a
// track starts buffering than it needs to actually be heard - location tracks are commonly
// hosted at an external URL (see Card.Audio.Url), so buffering has to have a head start on
// becoming audible or there'd be a silent gap right as a location should start fading in.
const LISTEN_INNER_RADIUS = INTERACT_RADIUS; // full volume within this distance - matches card-open range
const LISTEN_RADIUS_FALLBACK = 105;
const PRELOAD_RADIUS_MULTIPLIER = 3;
let listenRadius = LISTEN_RADIUS_FALLBACK;
let preloadRadius = LISTEN_RADIUS_FALLBACK * PRELOAD_RADIUS_MULTIPLIER;
const AUDIO_VOLUME_EASE = 0.85; // per-second retention factor, same Math.pow(x, dt) shape as TURN_DAMPING
const TURN_ACCEL = 0.006;
const TURN_DAMPING = 0.86;
const MAX_TURN_SPEED = 0.055;
const THRUST_ACCEL = 0.3;
const LINEAR_DAMPING = 0.965;
const MAX_SPEED = 6.5;
const GAMEPAD_DEADZONE = 0.2;
const STICKY_MARGIN = 15;

// Camera tuning. The camera doesn't track the ship 1:1 - it eases toward a target point that
// leads the ship by LOOK_AHEAD_FRACTION of the viewport in whichever direction it's currently
// facing, so more of what's ahead is visible than what's behind (2/3 ahead, 1/3 behind - see
// updateCamera). CAMERA_EASE is a per-second retention factor (same Math.pow(x, dt) shape as
// TURN_DAMPING/LINEAR_DAMPING above) - without easing, the look-ahead point itself swings with
// every small change in ship.angle, which read as camera "shake" whenever the ship turned or
// reversed thrust.
const LOOK_AHEAD_FRACTION = 1 / 6; // fraction of viewport width/height, applied per-axis
const CAMERA_EASE = 0.95;
const CARD_FOCUS_EASE = 0.97; // slower than CAMERA_EASE - settling on a card should read as deliberate, not a snap
const CARD_FOCUS_DELAY_MS = 450;

// Ship state
let shipEl;
let ship = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  angle: -Math.PI / 2, // sprite's forward (top of image) starts facing "up"
  angularVel: 0,
};

// Camera state - the eased point (tracking either the ship or a focused card) updateCamera
// scrolls to keep centered. Canonical (unshifted) world coordinates, exactly like ship.x/y - see
// updateCamera.
let camera = { x: 0, y: 0, initialized: false };
// The separately-eased look-ahead bias added on top of camera.x/y - see updateCamera for why
// this has to stay decoupled from camera.x/y's own (wrapped) easing.
let lookAhead = { x: 0, y: 0, initialized: false };
// Whether updateCamera is currently tracking a focused card (set at the end of every call) -
// consulted by showChainMember so X-cycling while already settled on a card doesn't re-arm
// CARD_FOCUS_DELAY_MS and revert to ship-tracking before panning to the next member.
let cameraFocused = false;

// Input state
let keyState = {};
let turnInput = 0;
let thrustInput = 0;
let gamepadInteractWasDown = false;
let gamepadCycleWasDown = false;
let lastFrameTime = null;

// Order of initialization
document.addEventListener('DOMContentLoaded', function() {
  // Effects run first because a crossfade effect creates #bgmap2 dynamically - loadPageConfig
  // (sizes it) and buildWrapGhosts (tiles it) both need it to already exist.
  applyPageEffects();
  loadPageConfig();
  initShip();
  loadNodes();
  if (weavePage.wraps) {
    shiftTopLevelNodesForWrap();
    buildWrapGhosts();
  }
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

// Reads window.__weavePage (absent only on pages exported before this existed - falls back to
// today's document size and no wrap) and makes the world size real: body and both background
// layers get explicitly sized to it, rather than relying on whatever size the background image
// happens to be. This is what per-page WorldWidthPx/HeightPx actually needs to work in the
// exported site (the editor canvas already honors it - see app.js's worldW/worldH).
//
// On a wrapping page, the real background is also *positioned* at (worldWidth, worldHeight)
// instead of (0, 0) - see the big comment on buildWrapGhosts() for why: browsers never extend a
// document's scrollable region into negative coordinates, so putting anything at a negative
// offset makes it permanently unreachable by scrolling, full stop (confirmed empirically, not
// assumed). shiftTopLevelNodesForWrap() applies the same shift to every real node once they
// exist (loadNodes() hasn't run yet at this point).
function loadPageConfig(){
  let cfg = window.__weavePage;

  weavePage.wraps = cfg ? !!cfg.wraps : false;
  weavePage.globeEffect = cfg ? !!cfg.globeEffect : false;
  weavePage.worldWidth = cfg ? cfg.worldWidth : document.body.scrollWidth;
  weavePage.worldHeight = cfg ? cfg.worldHeight : document.body.scrollHeight;
  // Page.DefaultSpawnX/Y - where initShip() puts the ship when this page is opened with no
  // travel/query-string position at all (e.g. a bare URL, or the shell's iframe on first load).
  // Null/undefined (no Page override configured) leaves these null - initShip() itself falls
  // back to its own hardcoded default in that case.
  weavePage.defaultSpawnX = cfg && cfg.defaultSpawnX != null ? cfg.defaultSpawnX : null;
  weavePage.defaultSpawnY = cfg && cfg.defaultSpawnY != null ? cfg.defaultSpawnY : null;

  // WeaveProject.ListeningRadiusPx - project-wide, not per-page (see updateLocationAudio).
  // Floored well above LISTEN_INNER_RADIUS so the fade math there never divides by ~0, even if
  // the project value is missing, zero, or set below the card-open radius by mistake.
  weavePage.listeningRadiusPx = cfg && cfg.listeningRadiusPx != null ? cfg.listeningRadiusPx : null;
  listenRadius = Math.max(weavePage.listeningRadiusPx || LISTEN_RADIUS_FALLBACK, LISTEN_INNER_RADIUS + 1);
  preloadRadius = listenRadius * PRELOAD_RADIUS_MULTIPLIER;

  document.body.style.width = weavePage.worldWidth + "px";
  document.body.style.height = weavePage.worldHeight + "px";

  let shiftX = weavePage.wraps ? weavePage.worldWidth : 0;
  let shiftY = weavePage.wraps ? weavePage.worldHeight : 0;

  for (const id of ['bgmap', 'bgmap2']) {
    let img = document.getElementById(id);
    if (!img) continue;
    img.style.width = weavePage.worldWidth + "px";
    img.style.height = weavePage.worldHeight + "px";
    img.style.left = shiftX + "px";
    img.style.top = shiftY + "px";
  }
}

// Moves every real top-level node from canonical [0, worldWidth) x [0, worldHeight) - the space
// ship.x/y and every authored Node.X/Y live in - into the same (worldWidth, worldHeight)-shifted
// render space loadPageConfig() already put the background in. Nested chain members ride along
// for free (they're positioned relative to their parent's card, not the world - see the README's
// nesting section), so only top-level nodes need touching.
//
// ship.x/y and getNodeCenter()-based proximity math are deliberately left reading/writing
// canonical (unshifted) coordinates throughout - wrappedDelta()'s result is unaffected by adding
// a whole worldWidth/worldHeight to one side of the subtraction (it's a mod-worldWidth
// operation), so shifting *only* what's actually drawn - this function, renderShip(),
// updateCamera() - leaves the whole proximity/interaction logic layer untouched and still correct.
function shiftTopLevelNodesForWrap(){
  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;
    let left = parseFloat(node.style.left) || 0;
    let top = parseFloat(node.style.top) || 0;
    node.style.left = (left + weavePage.worldWidth) + "px";
    node.style.top = (top + weavePage.worldHeight) + "px";
  });
}

// Globe wrap, the visual half: tiles the background(s) and every top-level node into a static
// 3x3 grid (8 ghost copies plus the real, center tile) around the shifted real content, offset
// by whole world-size steps - so the full grid spans non-negative render coordinates
// [0, 3*worldWidth) x [0, 3*worldHeight): the west/north tiles sit exactly at 0, not at a
// negative offset a browser would refuse to ever scroll to. The browser's own scrollable
// overflow already extends to include them - same mechanism that makes document.body.scrollWidth
// pick up #bgmap today - so no extra CSS/layout work is needed beyond appending more
// absolutely-positioned elements. Combined with updateShip() keeping ship.x/y wrapped into
// canonical [0, worldWidth) and updateCamera()/renderShip()'s matching +worldWidth/+worldHeight
// render offset, the ship can fly straight through what looks like an edge and the camera just
// keeps scrolling into the neighboring (ghost) tile - which is pixel-identical to the
// wrapped-around real content, so there's nothing to detect or teleport.
const WRAP_TILE_OFFSETS = [-1, 0, 1];

function buildWrapGhosts(){
  let backgrounds = ['bgmap', 'bgmap2']
    .map(id => document.getElementById(id))
    .filter(img => img);

  let topLevelNodes = [];
  nodeMeta.forEach((meta, node) => { if (meta.isTopLevel && !meta.isModal) topLevelNodes.push(node); });

  for (const dx of WRAP_TILE_OFFSETS) {
    for (const dy of WRAP_TILE_OFFSETS) {
      if (dx === 0 && dy === 0) continue;

      let offsetX = dx * weavePage.worldWidth;
      let offsetY = dy * weavePage.worldHeight;

      for (const bg of backgrounds) cloneBackgroundTile(bg, offsetX, offsetY);

      for (const node of topLevelNodes) {
        let ghost = cloneNodeTile(node, offsetX, offsetY);
        if (!ghostRoots.has(node)) ghostRoots.set(node, []);
        ghostRoots.get(node).push(ghost);
      }
    }
  }
}

// offsetX/offsetY are relative to img's own current (already-shifted) position, not absolute -
// matching cloneNodeTile below, and what actually keeps every tile's math consistent.
function cloneBackgroundTile(img, offsetX, offsetY){
  let clone = img.cloneNode(true);
  clone.removeAttribute('id');
  let baseLeft = parseFloat(img.style.left) || 0;
  let baseTop = parseFloat(img.style.top) || 0;
  clone.style.left = (baseLeft + offsetX) + "px";
  clone.style.top = (baseTop + offsetY) + "px";
  document.body.appendChild(clone);
}

function cloneNodeTile(node, offsetX, offsetY){
  let clone = node.cloneNode(true);
  let baseLeft = parseFloat(node.style.left) || 0;
  let baseTop = parseFloat(node.style.top) || 0;
  clone.style.left = (baseLeft + offsetX) + "px";
  clone.style.top = (baseTop + offsetY) + "px";
  document.body.appendChild(clone);
  return clone;
}

// Mirrors a top-level node's whole chain (icon + card visibility, per member) onto every one of
// its 8 ghost clones - called anywhere hideChain/showChainMember/onInteract's informational-card
// toggle change that state, so a card opened near a seam looks open on every visual copy of it,
// not just the real one. Ghost chain members are found by re-walking each clone the same way
// loadNodes() built the real chain (cloneNode(true) preserves document order exactly, so zipping
// by index is reliable) rather than kept as precomputed state, since this only runs on user
// interaction, not every frame.
function syncGhosts(root){
  let ghosts = ghostRoots.get(root);
  if (!ghosts) return;

  let realChain = nodeMeta.get(root).chain;

  for (const ghostRoot of ghosts) {
    let ghostChain = [ghostRoot, ...ghostRoot.querySelectorAll(".node")];
    for (let i = 0; i < realChain.length; i++) {
      let realMeta = nodeMeta.get(realChain[i]);
      ghostChain[i].querySelector(".nodeImage").src = realMeta.img.src;
      ghostChain[i].querySelector(".floatInfo").style.display = realMeta.info.style.display;
      ghostChain[i].classList.toggle('cardOpen', realChain[i].classList.contains('cardOpen'));
    }
  }
}

// Sets up the cosmetic globe-curvature hint (Page.GlobeEffect): a fixed vignette overlay (see
// #globeVignette in main.css) plus the per-frame icon scale/fade updateGlobeEffect() drives.
// Only ever called when weavePage.globeEffect is true. Ghost tiles are already built by this
// point (see DOMContentLoaded), so ghostRoots is complete if this page also wraps; on a
// non-wrapping page ghostRoots is empty and globeEffectIcons ends up holding just the real
// top-level icons, which is exactly what a bounded (non-wrapping) map that still wants the
// vignette/fisheye look needs.
function buildGlobeEffect(){
  nodeMeta.forEach((meta, node) => {
    if (meta.isTopLevel && !meta.isModal) globeEffectIcons.push(meta.img);
  });
  ghostRoots.forEach(ghosts => {
    for (const ghost of ghosts) {
      let img = ghost.querySelector(".nodeImage");
      if (img) globeEffectIcons.push(img);
    }
  });

  // Appended to <html>, deliberately *not* document.body - body gets a `transform` applied every
  // frame (updateCamera's sub-pixel scroll correction), and per the CSS spec a `transform` on an
  // ancestor changes what a `position: fixed` descendant is contained by: instead of the
  // viewport, it becomes the *transformed ancestor's own box* - here, the whole (huge, tiled)
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

// Shortest signed distance from a to b along one axis of a world that wraps at `size` - e.g.
// two points 10px apart across the seam of a 3000px-wide world return 10, not 2990. Used so
// proximity/interaction reach a node through its nearest ghost copy instead of only the literal,
// possibly-far-away real one.
function wrappedDelta(diff, size){
  let d = diff % size;
  if (d > size / 2) d -= size;
  if (d < -size / 2) d += size;
  return d;
}

// Applies wrappedDelta to both axes when this page wraps; passes an [dx, dy] pair through
// unchanged otherwise. Only used for distance comparisons (see updateNodeProximity) - never for
// anything that needs an actual position, since the "shortest path" isn't a real point.
function wrappedOffset(dx, dy){
  return weavePage.wraps
    ? [wrappedDelta(dx, weavePage.worldWidth), wrappedDelta(dy, weavePage.worldHeight)]
    : [dx, dy];
}

// Set up the ship's starting position (from URL params, or a sane default)
// and the DOM element that represents it.
function initShip() {

  let params = new URLSearchParams(document.location.search);
  let startX = parseInt(params.get("x"));
  let startY = parseInt(params.get("y"));
  let destX  = parseInt(params.get("destX"));
  let destY  = parseInt(params.get("destY"));
  tutorialSwitch = params.get("tutorial");

  if (!isNaN(destX) && !isNaN(destY)) {
    ship.x = destX;
    ship.y = destY;
  } else if (!isNaN(startX) && !isNaN(startY)) {
    ship.x = startX;
    ship.y = startY;
  } else if (weavePage.defaultSpawnX !== null && weavePage.defaultSpawnY !== null) {
    // Page.DefaultSpawnX/Y (see loadPageConfig) - this page's own configured spot for "opened
    // with nothing telling it where to put the ship", e.g. a bare URL or the shell's iframe on
    // first load.
    ship.x = weavePage.defaultSpawnX;
    ship.y = weavePage.defaultSpawnY;
  } else {
    ship.x = 120;
    ship.y = 120;
  }

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
    });

    if (curAudio) {
      if (!isModal) curAudio.volume = 0; // updateLocationAudio eases this up from silence
      curAudio.addEventListener('play', notifyShellOfTrackState);
      curAudio.addEventListener('pause', notifyShellOfTrackState);
      curAudio.addEventListener('ended', notifyShellOfTrackState);
    }

  });

  // Tell the persistent shell (see shell.js) whether *any* location's song is currently
  // playing on this page, so it can duck/restore its own looping background track. A no-op
  // when this page isn't actually embedded in the shell's iframe (e.g. opened directly) -
  // window.parent is just window itself then, so nothing is listening on the other end anyway.
  // Called once up front too (immediately reports "nothing playing"), which is what makes a
  // fresh page load - including one arrived at by traveling away while a track was left
  // running - correctly tell the shell to fade back in.
  notifyShellOfTrackState();

  // A multi-part location's nested nodes aren't reachable by flying to them
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

function notifyShellOfTrackState(){
  if (window.parent === window) return;

  let anyPlaying = Array.from(document.querySelectorAll('.songPlayer'))
    .some(audio => !audio.paused && !audio.ended);

  window.parent.postMessage({ source: 'weave-track', playing: anyPlaying }, '*');
}

// Tells the shell the visitor has actually interacted with this page - keyboard or gamepad
// input, same as notifyShellOfTrackState's own "is a real track playing" signal, this is what
// lets the shell unmute its background track (autoplay policies require a genuine gesture, and
// a keypress that lands inside this iframe is one even though the shell's own top-level
// document never directly saw it - see shell.js's bindBackgroundMusic). Sent at most once per
// page load; every input source that can trigger it shares this one flag.
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

// When this page is embedded in the persistent shell's iframe (see shell.js), arrow-key flight
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
    keyState[e.key] = true;
    notifyShellOfInteraction();

    // Stops the browser's own default handling of these keys (page/iframe scroll for the
    // arrows, in particular) from ever competing with the game's own movement - see
    // claimOwnFocus's header for the failure mode this guards against.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
      || e.key === 'z' || e.key === 'Z' || e.key === 'x' || e.key === 'X') {
      e.preventDefault();
    }

    // A modal card (see modalQueue) takes over Z entirely while it's showing - closing it,
    // never onInteract() - and blocks X too, so cycling a location chain underneath it isn't
    // possible while it's still covering the screen.
    if ((e.key === 'z' || e.key === 'Z') && !e.repeat) {
      if (modalQueue.length > 0) closeCurrentModal();
      else onInteract();
    }
    if ((e.key === 'x' || e.key === 'X') && !e.repeat && modalQueue.length === 0) {
      cycleChainNode();
    }
  });

  document.addEventListener('keyup', (e) => {
    keyState[e.key] = false;
  });

  // Gamepads don't fire events for stick movement, so they're polled each
  // frame in updateInput() instead - nothing to bind here besides buttons,
  // which are also polled for the same reason (press-and-release edges).
}

// getGamepads() throws (SecurityError) rather than just returning nothing when the Gamepad API
// is denied by permissions policy - notably, an opaque-origin iframe (which is what every
// file://-opened exported site's shell iframe is - confirmed empirically) can never be granted
// it via the shell's own <iframe allow="gamepad">, no matter what that attribute says. Left
// uncaught, that exception would escape updateInput() and loop() entirely, which - since it's
// thrown before turnInput/thrustInput are even set at the bottom of this function, and since an
// uncaught exception in a requestAnimationFrame callback stops that callback from ever
// rescheduling itself - would silently kill keyboard controls and the whole render loop too,
// not just gamepad support. Tracking this in a flag (rather than a try/catch every single
// frame forever) means the one denial is paid once; every frame after that just skips straight
// past gamepad polling, leaving keyboard flight completely unaffected.
let gamepadSupported = true;

function updateInput(){

  let turn = 0;
  let thrust = 0;

  if (keyState['ArrowLeft'])  turn  -= 1;
  if (keyState['ArrowRight']) turn  += 1;
  if (keyState['ArrowUp'])    thrust += 1;
  if (keyState['ArrowDown'])  thrust -= 1;

  let pads = null;
  if (gamepadSupported && navigator.getGamepads) {
    try {
      pads = navigator.getGamepads();
    } catch (e) {
      gamepadSupported = false;
    }
  }

  if (pads) {
    for (let i = 0; i < pads.length; i++) {
      let pad = pads[i];
      if (!pad) continue;

      let ax = pad.axes[0] || 0;
      let ay = pad.axes[1] || 0;
      if (Math.abs(ax) > GAMEPAD_DEADZONE) { turn += ax; notifyShellOfInteraction(); }
      if (Math.abs(ay) > GAMEPAD_DEADZONE) { thrust -= ay; notifyShellOfInteraction(); }

      // Same modal takeover as the keyboard's Z/X handling in bindInput() - see its comment.
      let aDown = !!(pad.buttons[0] && pad.buttons[0].pressed);
      if (aDown) notifyShellOfInteraction();
      if (aDown && !gamepadInteractWasDown) {
        if (modalQueue.length > 0) closeCurrentModal();
        else onInteract();
      }
      gamepadInteractWasDown = aDown;

      // Standard gamepad mapping: button 2 is X (Xbox) / Square (PlayStation).
      let xDown = !!(pad.buttons[2] && pad.buttons[2].pressed);
      if (xDown && !gamepadCycleWasDown && modalQueue.length === 0) cycleChainNode();
      gamepadCycleWasDown = xDown;

      break; // only the first connected gamepad drives the ship
    }
  }

  turnInput = clamp(turn, -1, 1);
  thrustInput = clamp(thrust, -1, 1);
}

function updateShip(dt){

  // A modal card (see modalQueue) traps input entirely while it's showing - the ship simply
  // doesn't move, rather than quietly accumulating velocity from held keys that would otherwise
  // suddenly release the moment the modal closes.
  if (modalQueue.length > 0) return;

  // Turning has a little momentum rather than snapping instantly
  ship.angularVel += turnInput * TURN_ACCEL * dt;
  ship.angularVel *= Math.pow(TURN_DAMPING, dt);
  ship.angularVel = clamp(ship.angularVel, -MAX_TURN_SPEED, MAX_TURN_SPEED);
  ship.angle += ship.angularVel * dt;

  // Thrust along facing direction, with light drag
  if (thrustInput !== 0) {
    ship.vx += Math.cos(ship.angle) * THRUST_ACCEL * thrustInput * dt;
    ship.vy += Math.sin(ship.angle) * THRUST_ACCEL * thrustInput * dt;
  }
  ship.vx *= Math.pow(LINEAR_DAMPING, dt);
  ship.vy *= Math.pow(LINEAR_DAMPING, dt);

  let speed = Math.hypot(ship.vx, ship.vy);
  if (speed > MAX_SPEED) {
    ship.vx = (ship.vx / speed) * MAX_SPEED;
    ship.vy = (ship.vy / speed) * MAX_SPEED;
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  if (weavePage.wraps) {
    let preWrapX = ship.x;
    let preWrapY = ship.y;
    ship.x = ((ship.x % weavePage.worldWidth) + weavePage.worldWidth) % weavePage.worldWidth;
    ship.y = ((ship.y % weavePage.worldHeight) + weavePage.worldHeight) % weavePage.worldHeight;
    // camera.x/y track ship.x/y continuously across many frames of easing (see updateCamera) -
    // completely separately from this modulo. Left alone, the instant ship.x/y actually wraps
    // here, camera.x/y would keep gliding along their old, now-unmoored continuous trajectory
    // while the ship jumps back into canonical range under them, so the two drift apart by a
    // full world-size step. Applying the exact same correction keeps camera.x/y in sync - since
    // it happens in lockstep with ship.x/y's own jump, nothing camera.x/y was already smoothly
    // doing (following the ship, or holding on a focused card) gets disturbed; a genuine
    // no-op (0 correction) on every frame that isn't an actual wrap.
    camera.x += ship.x - preWrapX;
    camera.y += ship.y - preWrapY;
  } else {
    ship.x = clamp(ship.x, 0, document.body.scrollWidth);
    ship.y = clamp(ship.y, 0, document.body.scrollHeight);
  }

  renderShip();
}

function renderShip(){
  // Matches the render-space shift applied to real content/updateCamera on a wrapping page (see
  // loadPageConfig/shiftTopLevelNodesForWrap) - without it the ship renders a full world-size
  // away from wherever the camera is actually looking.
  let renderX = weavePage.wraps ? ship.x + weavePage.worldWidth : ship.x;
  let renderY = weavePage.wraps ? ship.y + weavePage.worldHeight : ship.y;

  // Deliberately *not* rounded, unlike the scroll target in updateCamera - the world content
  // (background, nodes) is all static, already-integer-positioned markup, so rounding only the
  // scroll keeps it crisp; the ship is the one thing that actually needs to move smoothly every
  // frame. Rounding it too was tried and reverted: MAX_SPEED (6.5px/frame) isn't a whole number,
  // so snapping the ship's position to the nearest pixel every frame doesn't read as smoother -
  // it visibly alternates 6px/7px/6px/7px steps instead of a steady 6.5px glide, which is its own
  // kind of shake. A single small, already-anti-aliased (it's rotated via CSS transform) sprite
  // sitting at a sub-pixel offset is far less noticeable than that stepping.
  shipEl.style.left = (renderX - SHIP_WIDTH / 2) + "px";
  shipEl.style.top = (renderY - SHIP_WIDTH / 2) + "px";
  // Sprite's forward points "up" (angle -90deg) at rest, so offset by +90deg
  shipEl.style.transform = "rotate(" + (ship.angle + Math.PI / 2) + "rad)";
}

// dt defaults to 1 because the one call site that omits it (initShip's very first call) always
// takes the "not yet initialized" snap path below, which doesn't use dt at all.
//
// This is split into two independently-eased pieces - *what* the camera tracks (camera.x/y,
// wrapped/canonical, matching ship.x/y's own coordinate space) and *how far ahead of that it
// leads* (lookAhead.x/y, a small plain offset) - because merging them caused a real bug: adding
// the look-ahead directly to ship.x before easing let the sum legitimately exceed
// [0, worldWidth) whenever the ship was merely close to an edge (not actually wrapping), and
// running that sum through the same wrapped-shortest-path logic the *ship's own* discontinuous
// wrap needs made it alias to the canonically-equivalent point on the far side of the map -
// invisible for the tiled, periodic background (it looks the same either way), but not for the
// ship: a single, non-tiled element rendered straight off the real, un-aliased ship.x/y, which
// would end up nowhere near where the camera had just settled. Keeping the look-ahead as a
// separate, always-small, never-wrapped offset - added only once, at the very end, after
// camera.x/y has already resolved to a true, un-aliased position - avoids the whole class of bug.
function updateCamera(dt = 1){
  // What the camera tracks: the ship's own (canonical) position, unless a card is open *and the
  // player has actually settled on it* (the same activeNode for CARD_FOCUS_DELAY_MS - see setter
  // sites in showChainMember/hideChain), in which case it tracks that card's actual rendered
  // center instead. The delay is deliberate: without it, merely flying near a location - or
  // quickly X-cycling through a chain - would drag the camera around before the player had any
  // intention of reading that particular card. Most needed for a deeper chain member (X-cycled
  // multi-part location), whose card can sit well away from the node itself once its own
  // Card.Offset stacks on top of every ancestor's. Reads getBoundingClientRect() rather than
  // re-deriving the offset math, so it's automatically correct for any card size/offset/nesting
  // depth - un-shifted back out of render-space to match ship.x/y's own canonical convention (see
  // loadPageConfig/shiftTopLevelNodesForWrap for that shift), for the same alias-avoidance reason
  // as above. A straight center-on-card (rather than the minimal shift needed to only just bring
  // it inside the viewport) is deliberate too - the minimal-shift version tended to leave the
  // card pinned against whichever edge it had been overflowing, i.e. in a corner, instead of
  // settling somewhere comfortable.
  let focused = false;
  let trackX = ship.x;
  let trackY = ship.y;
  let easeFactor = CAMERA_EASE;

  // thrustInput === 0 is a live, continuous condition (not just checked once) - holding
  // accelerate means the player is driving past, not settling to look, so focus is withheld the
  // whole time it's held, and drops out immediately (back to plain ship-tracking) the instant
  // it's pressed again even mid-focus. It's deliberately not folded into activeNodeSince's own
  // delay/reset bookkeeping - accelerating doesn't invalidate *how long this has been the active
  // node* (X-cycling while thrusting still shouldn't re-arm CARD_FOCUS_DELAY_MS once released),
  // it just independently gates whether that settled state is allowed to pull the camera in.
  if (thrustInput === 0 && activeNode && activeNodeSince !== null && performance.now() - activeNodeSince >= CARD_FOCUS_DELAY_MS) {
    let info = nodeMeta.get(activeNode).info;
    if (info.style.display !== 'none') {
      let rect = info.getBoundingClientRect();
      let shiftX = weavePage.wraps ? weavePage.worldWidth : 0;
      let shiftY = weavePage.wraps ? weavePage.worldHeight : 0;
      trackX = rect.left + rect.width / 2 + window.scrollX - shiftX;
      trackY = rect.top + rect.height / 2 + window.scrollY - shiftY;
      focused = true;
      easeFactor = CARD_FOCUS_EASE;
    }
  }
  cameraFocused = focused;

  if (!camera.initialized) {
    camera.x = trackX;
    camera.y = trackY;
    camera.initialized = true;
  } else if (weavePage.wraps) {
    // Ease along the *shortest wrapped path* toward the tracked point, not the raw straight-line
    // distance - otherwise the moment ship.x/y itself wraps (a discontinuous jump in canonical
    // terms - see updateShip), the eased camera would try to visibly glide all the way across the
    // map instead of the short way round. Continuously re-targeting trackX every frame (rather
    // than committing to a fixed start/end pan) is deliberate: if the ship carries a little
    // momentum past a node during CARD_FOCUS_DELAY_MS before the card settles, this just curves
    // smoothly toward wherever the real target is *now* instead of first finishing a trip toward
    // a since-stale point and then visibly reversing.
    let ease = 1 - Math.pow(easeFactor, dt);
    camera.x += wrappedDelta(trackX - camera.x, weavePage.worldWidth) * ease;
    camera.y += wrappedDelta(trackY - camera.y, weavePage.worldHeight) * ease;

    // Defensive: re-express camera.x/y via whichever periodic representative sits closest to
    // trackX/trackY, so it can never drift more than half a world-size away from what it's
    // actually tracking, regardless of how it got there. The per-frame wrap-sync correction in
    // updateShip handles the common case (the ship's own gradual, natural wrap) already, but
    // wrappedDelta's "shortest path" is only ever a *small step* toward the right periodic
    // class - given a sufficiently large one-off gap (camera.x left over from tracking something
    // very different, e.g. right after a focus change) it can take many frames of tiny steps to
    // fully arrive, and past a few worldWidths out camera.x is numerically outside the actual
    // rendered 3x3 tile grid the whole time it's converging - i.e. pointed at nothing. This is a
    // no-op whenever camera.x/y are already close to trackX/trackY, which is the normal case.
    camera.x = trackX + wrappedDelta(camera.x - trackX, weavePage.worldWidth);
    camera.y = trackY + wrappedDelta(camera.y - trackY, weavePage.worldHeight);
  } else {
    let ease = 1 - Math.pow(easeFactor, dt);
    camera.x += (trackX - camera.x) * ease;
    camera.y += (trackY - camera.y) * ease;
  }

  // Lead the ship by a fraction of the viewport in whichever direction it's currently facing (and
  // not at all while focused on a card), so flying feels like more of the world ahead is visible
  // than what's behind (2/3 ahead, 1/3 behind: the ship sits 1/3 of the way from the trailing
  // edge along its heading, which means the *camera's* center has to sit ahead of the ship by
  // (1/2 - 1/3) = 1/6 of the viewport). Each axis uses its own viewport dimension (not a single
  // shared magnitude) so a purely-horizontal or purely-vertical heading gets the exact 2/3-1/3
  // split rather than one skewed by the viewport's aspect ratio. Eased on its own (plain, no
  // wrapping needed - it's always a small bounded vector, never a world position) so a sudden
  // heading change doesn't yank the view - this is what actually keeps turning/thrust-reversal
  // from reading as camera "shake".
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

  // Wrapping pages: camera.x/y are canonical, matching ship.x/y (see above), but the real content
  // sits at document scroll-coordinates [worldWidth, 2*worldWidth) - the west/north ghost tile
  // occupies [0, worldWidth) instead. Shifting by +worldWidth/+worldHeight accounts for that,
  // matching renderShip's own shift. The look-ahead offset is added last, in this same
  // already-un-aliased render space, exactly where the ship itself actually renders.
  let targetX = (weavePage.wraps ? camera.x + weavePage.worldWidth : camera.x) + lookAhead.x;
  let targetY = (weavePage.wraps ? camera.y + weavePage.worldHeight : camera.y) + lookAhead.y;

  let clampedX = clamp(targetX - window.innerWidth / 2, 0, maxScrollX);
  let clampedY = clamp(targetY - window.innerHeight / 2, 0, maxScrollY);

  // window.scrollTo() turns out to only have whole-pixel precision in practice - confirmed
  // directly (a minimal test page, no game code involved): Chrome silently rounds whatever
  // fractional value is passed here before it's readable back via window.scrollX/Y, regardless of
  // what's passed in. That's invisible for a *constant* rate of travel (rounding a steadily-
  // increasing value just steps it forward a whole pixel at a time, on average tracking the true
  // rate correctly - see renderShip's ship.x/y, which travel at exactly MAX_SPEED and are
  // deliberately left unrounded for this reason), but whenever the rate of change *itself* isn't
  // a whole number of pixels/frame - which during active turning it practically never is, since
  // the look-ahead vector's rate of change traces a sinusoid, not a line - the rounding lands on
  // a different side of the true value frame to frame in a way that reads as a faint stepping,
  // and it now affects everything on screen (ship included - the ship's own position is
  // unrounded, but it's still rendered *relative to* this same rounded scroll).
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

// Which top-level location the ship is currently near drives proximity - a
// multi-part location's nested nodes aren't out on the map to fly near (see
// getNodeCenter), so they never compete here. Once a root is active, X steps
// through its chain (see cycleChainNode); this only decides *which root*,
// resetting back to the start of its chain whenever the root itself changes.
function updateNodeProximity(){

  let closestRoot = null;
  let closestDist = INTERACT_RADIUS;

  nodeMeta.forEach((meta, node) => {
    if (!meta.isTopLevel || meta.isModal) return;

    let center = getNodeCenter(meta);
    let d = Math.hypot(...wrappedOffset(ship.x - center.x, ship.y - center.y));
    if (d < closestDist) {
      closestDist = d;
      closestRoot = node;
    }
  });

  // Stick with the current root unless it's out of range or something is
  // meaningfully closer - avoids flickering between two nearby locations.
  if (activeRoot && closestRoot !== activeRoot) {
    let rootCenter = getNodeCenter(nodeMeta.get(activeRoot));
    let rootDist = Math.hypot(...wrappedOffset(ship.x - rootCenter.x, ship.y - rootCenter.y));
    if (rootDist < INTERACT_RADIUS && rootDist <= closestDist + STICKY_MARGIN) {
      closestRoot = activeRoot;
    }
  }

  if (closestRoot !== activeRoot) {
    if (activeRoot) hideChain(activeRoot);
    activeRoot = closestRoot;
    chainIndex = 0;
    if (activeRoot) showChainMember(activeRoot, 0);
  }
}

// Location-zoned music: every top-level root's own track (or whichever chain member the player
// has X-cycled to - see cycleChainNode) fades in as the ship approaches that root's center, up
// to full volume within LISTEN_INNER_RADIUS (the same distance that already opens the card), and
// fades to silent by listenRadius. listenRadius is one shared, project-configured value (see
// loadPageConfig) rather than something computed from node spacing here - the editor is
// responsible for keeping it small enough that no two locations' audible zones overlap.
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
    let d = Math.hypot(...wrappedOffset(ship.x - center.x, ship.y - center.y));

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
  if (weavePage.wraps) syncGhosts(root);
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
  if (weavePage.wraps) syncGhosts(root);
}

// X (keyboard) / X (gamepad): step to the next location in the current
// root's chain - the way to reach a multi-part location's later parts
// without flying the ship into their (screen-space, card-relative) icons.
function cycleChainNode(){
  if (!activeRoot) return;

  let chain = nodeMeta.get(activeRoot).chain;
  if (chain.length <= 1) return;

  // Cancel any residual drift so browsing a multi-part location's chain
  // doesn't require also fighting momentum to stay within INTERACT_RADIUS -
  // easy to coast out of range between presses otherwise.
  ship.vx = 0;
  ship.vy = 0;

  chainIndex = (chainIndex + 1) % chain.length;
  showChainMember(activeRoot, chainIndex);
}

function onInteract(){
  if (!activeNode) return;

  let meta = nodeMeta.get(activeNode);
  let travelLink = meta.info.querySelector('.poetry-travel a');

  if (travelLink) {
    window.location.href = travelLink.getAttribute('href');
  } else if (!meta.audio) {
    // Informational-only card (e.g. tutorial) - interact just toggles it
    setCardOpen(activeNode, meta, meta.info.style.display === 'none');
    if (weavePage.wraps) syncGhosts(activeRoot);
  }
  // A card with location audio and no travel link has nothing left for Z to do - the music
  // itself is proximity-driven now (see updateLocationAudio), not toggled by interact.
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

function applyCrossfadeEffect(fx){
  let layer = document.createElement('img');
  layer.id = 'bgmap2';
  layer.className = 'pannable';
  layer.src = fx.imagePath;
  layer.style.opacity = '0%';
  document.body.appendChild(layer);

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
  if (weavePage.globeEffect) updateGlobeEffect();

  requestAnimationFrame(loop);
}
