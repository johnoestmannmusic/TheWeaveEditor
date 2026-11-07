// map.js
// John Oestmann
// The planet map: input from keys and gamepads, the ship walking it, the view and its screens, contrails, the
// minimap, fog over what's unexplored, and which location the ship is standing on.
//
// Part of the page script, split from main.js by concern. Every part shares one set of page-wide names, loaded in
// order after main.js - see main.js for the page's state and setup. Part of the canonical shared runtime owned by
// TheWeave.Exporter - generated into every exported site's jsx/ folder, not hand-edited there.

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
  // Sprite's forward points "up" (angle -90deg) at rest, so offset by +90deg. Only written when it's changed.
  let transform = "translate(" + (ship.x - SHIP_WIDTH / 2) + "px, " + (ship.y - SHIP_HEIGHT / 2) + "px) rotate(" + (ship.angle + Math.PI / 2) + "rad)";
  if (transform === renderedShipTransform) return;
  renderedShipTransform = transform;
  shipEl.style.transform = transform;
}
let renderedShipTransform = null;

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
  let transform = "translate(" + x + "px, " + y + "px) scale(" + view.scale + ")";
  if (transform !== view.transform) {
    view.transform = transform;
    document.body.style.transform = transform;
  }
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
  mapContrails.bounds = null; // resizing clears it
  mapContrails.left = null;
  mapContrails.canvas.width = pictureWidth;
  mapContrails.canvas.height = pictureHeight;
  mapContrails.canvas.style.width = (pictureWidth / view.scale) + "px";
  mapContrails.canvas.style.height = (pictureHeight / view.scale) + "px";
}

function updateMapContrails(dtMs){
  updateContrails(mapContrails, ship, playerMover.facing, dtMs);

  // Exactly over the picture, whatever rounding the body's transform had this frame - see updateView. Only written
  // when it moves, as writing it lays the page out again.
  let left = ((view.offsetX - view.translateX) / view.scale) + "px";
  let top = ((view.offsetY - view.translateY) / view.scale) + "px";
  if (left !== mapContrails.left || top !== mapContrails.top) {
    mapContrails.left = left;
    mapContrails.top = top;
    mapContrails.canvas.style.left = left;
    mapContrails.canvas.style.top = top;
  }

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

  // Only the part the trails cover, last frame and this one, is cleared, so that's all the browser repaints.
  let bounds = contrailBounds(trail, scale, originX, originY);
  let last = trail.bounds;
  trail.bounds = bounds;
  let clear = last && bounds
    ? { left: Math.min(last.left, bounds.left), top: Math.min(last.top, bounds.top), right: Math.max(last.right, bounds.right), bottom: Math.max(last.bottom, bounds.bottom) }
    : last ?? bounds;
  if (clear) context.clearRect(clear.left, clear.top, clear.right - clear.left, clear.bottom - clear.top);
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
// The part of its canvas a trail's points cover this frame, with room for the line's width, or null if none.
function contrailBounds(trail, scale, originX, originY){
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rail of trail.rails) {
    if (rail.points.length === 0) continue;
    for (const point of withStretchToShip(trail, rail)) {
      let x = originX + point.x * scale, y = originY + point.y * scale;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return null;
  let margin = CONTRAIL_WIDTH * trail.shipPixel * scale + 4;
  return { left: Math.floor(left - margin), top: Math.floor(top - margin), right: Math.ceil(right + margin), bottom: Math.ceil(bottom + margin) };
}

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
    meta.minimapIcon = icon;
    if (meta.img.getAttribute('src').includes('race')) icon.classList.add('raceNode');
  });

  // Over the minimap's locations, so an unexplored one stays hidden there too - see buildFog.
  let fogCanvas = null;
  if (fog) {
    fogCanvas = document.createElement('canvas');
    fogCanvas.id = 'minimapFog';
    fogCanvas.width = fog.canvas.width;
    fogCanvas.height = fog.canvas.height;
    el.appendChild(fogCanvas);
    fog.minimapCanvas = fogCanvas;
    fogCanvas.getContext('2d').drawImage(fog.canvas, 0, 0);
  }

  let screen = document.createElement('div');
  screen.id = 'minimapScreen';
  el.appendChild(screen);

  screenFrameEl.appendChild(el);
  minimap = { el, image, fog: fogCanvas, nodes, screen, scale: 1, top: 0 };
}

// ---------- fog ----------

// How many world pixels one of the map image's own pixels covers, which is what the fog is drawn at, so that
// it lines up with the map's pixels.
function mapPixelSize(){
  return weavePage.screen.width / SOURCE_SCREEN_WIDTH;
}

// How far around the ship a planet's fog clears: the same circle as a Lantern's on a board (see puzzle.js's
// LANTERN_REACH), 3 squares out straight, and fewer on the diagonals.
const FOG_REACH = 3.5;
const FOG_FADE_MS = 400;
const FOG_KEY_PREFIX = "weave-fog:";
// The same as #screenFrame's surround, so unexplored map runs on into it.
const FOG_COLOR = [17, 17, 17];

// A planet's unexplored squares are covered, and clear as the ship comes within reach of them, for good:
// what's been explored is kept in localStorage, like solved puzzles. The Weave itself is never fogged. Drawn
// at the map's own pixel size, so the checkered edge between explored and unexplored is part of its pixel art.
function buildFog(){
  if (weavePage.isHomePage) return;

  let pixel = mapPixelSize();
  let canvas = document.createElement('canvas');
  canvas.id = 'fog';
  canvas.width = Math.round(weavePage.worldWidth / pixel);
  canvas.height = Math.round(weavePage.worldHeight / pixel);
  canvas.style.width = weavePage.worldWidth + "px";
  canvas.style.height = weavePage.worldHeight + "px";
  document.body.appendChild(canvas);

  // Which pixels of the fog each column and row of squares covers, worked out once, so that a redraw only has to
  // touch the squares whose fog has changed. Past the grid's own edges, the nearest square's.
  let grid = weavePage.grid;
  let spansOf = (count, length, cellOf) => {
    let spans = Array.from({ length: count }, () => ({ from: Infinity, to: -1 }));
    for (let i = 0; i < length; i++) {
      let span = spans[cellOf(i)];
      span.from = Math.min(span.from, i);
      span.to = Math.max(span.to, i);
    }
    return spans;
  };

  fog = {
    canvas,
    minimapCanvas: null, // see buildMinimap
    image: canvas.getContext('2d').createImageData(canvas.width, canvas.height),
    colSpans: spansOf(grid.columns, canvas.width, (x) => grid.cellAt((x + 0.5) * pixel, 0).col),
    rowSpans: spansOf(grid.rows, canvas.height, (y) => grid.cellAt(0, (y + 0.5) * pixel).row),
    explored: loadExplored(),
    edge: null, // the unexplored squares bordering the explored, worked out again only when more are revealed
    fading: new Map(), // "col,row" -> { left, wasEdge }, for squares just revealed
    drawn: new Map(), // "col,row" -> how its fog was last drawn, so that only changes are redrawn - see drawFog
    at: null, // the square last revealed around
  };

  revealAround(grid.cellAt(ship.x, ship.y), false);
  drawFog();
}

function loadExplored(){
  try {
    return WeaveSokoban.decodeCells(weavePage.grid, localStorage.getItem(FOG_KEY_PREFIX + weavePage.id));
  } catch (e) {
    return new Set(); // storage unavailable - see isPuzzleSolved
  }
}

function saveExplored(){
  try {
    localStorage.setItem(FOG_KEY_PREFIX + weavePage.id, WeaveSokoban.encodeCells(weavePage.grid, fog.explored));
  } catch (e) {
    // storage unavailable - see isPuzzleSolved
  }
}

// Reveals everything within reach of a square. Returns whether that was anything new.
function revealAround(cell, fade){
  fog.at = cell;
  let edge = fog.edge ?? WeaveSokoban.edgeOf(weavePage.grid, fog.explored);
  let revealed = false;

  for (const near of WeaveSokoban.cellsWithin(weavePage.grid, cell, FOG_REACH)) {
    let key = cellKey(near);
    if (fog.explored.has(key)) continue;
    fog.explored.add(key);
    if (fade) fog.fading.set(key, { left: FOG_FADE_MS, wasEdge: edge.has(key) });
    revealed = true;
  }
  if (revealed || !fog.edge) fog.edge = WeaveSokoban.edgeOf(weavePage.grid, fog.explored);
  return revealed;
}

// Counts the square nearest the ship, so the fog opens halfway through a step rather than at either end.
function updateFog(dtMs){
  if (!fog) return;

  let changed = false;
  let cell = weavePage.grid.cellAt(ship.x, ship.y);
  if (cell.col !== fog.at.col || cell.row !== fog.at.row) {
    if (revealAround(cell, true)) {
      saveExplored();
      changed = true;
    }
  }

  for (const [key, fading] of fog.fading) {
    fading.left -= dtMs;
    if (fading.left <= 0) fog.fading.delete(key);
    changed = true;
  }

  if (changed) drawFog();
}

// Unexplored squares solid, the ones bordering what's explored checkered, and anything just revealed fading
// out from whichever of those it was. Only the squares whose fog looks different from last time are redrawn, and
// only the part of the picture they cover is sent to the canvas.
function drawFog(){
  let { image, colSpans, rowSpans, explored, fading, drawn, edge } = fog;
  let [r, g, b] = FOG_COLOR;
  let data = image.data;
  let width = image.width;
  let left = Infinity, top = Infinity, right = -1, bottom = -1;

  for (let row = 0; row < rowSpans.length; row++) {
    for (let col = 0; col < colSpans.length; col++) {
      let key = col + "," + row;
      // How it looks: its opacity, and whether it's only every other pixel, as the checkered edge is.
      let alpha, checkered;
      if (!explored.has(key)) {
        alpha = 255;
        checkered = edge.has(key);
      } else if (fading.has(key)) {
        let { left: msLeft, wasEdge } = fading.get(key);
        alpha = Math.round(255 * msLeft / FOG_FADE_MS);
        checkered = wasEdge;
      } else {
        alpha = 0;
        checkered = false;
      }
      let look = alpha * 2 + (checkered ? 1 : 0);
      if (drawn.get(key) === look) continue;
      drawn.set(key, look);

      let xs = colSpans[col], ys = rowSpans[row];
      if (xs.to < 0 || ys.to < 0) continue;
      for (let y = ys.from; y <= ys.to; y++) {
        for (let x = xs.from; x <= xs.to; x++) {
          let i = (y * width + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = !checkered || (x + y) % 2 === 0 ? alpha : 0;
        }
      }
      left = Math.min(left, xs.from);
      right = Math.max(right, xs.to);
      top = Math.min(top, ys.from);
      bottom = Math.max(bottom, ys.to);
    }
  }
  if (right < 0) return;

  fog.canvas.getContext('2d').putImageData(image, 0, 0, left, top, right - left + 1, bottom - top + 1);
  if (fog.minimapCanvas) {
    let context = fog.minimapCanvas.getContext('2d');
    context.clearRect(0, 0, fog.minimapCanvas.width, fog.minimapCanvas.height);
    context.drawImage(fog.canvas, 0, 0);
  }
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
  if (minimap.fog) {
    minimap.fog.style.width = minimap.image.style.width;
    minimap.fog.style.height = minimap.image.style.height;
    minimap.fog.style.top = minimap.image.style.top;
  }

  minimap.screen.style.width = (screen.width * minimap.scale) + "px";
  minimap.screen.style.height = (screen.height * minimap.scale) + "px";
  // Measured again when it's next needed, and the overlap checked again, now that it's somewhere new.
  minimap.box = null;
  minimap.lastKey = null;

  let square = width / weavePage.grid.columns;
  let nodeSize = Math.max(3, Math.round(square * MINIMAP_NODE_SQUARES));
  for (const node of minimap.nodes) {
    node.icon.style.width = nodeSize + "px";
    node.icon.style.height = nodeSize + "px";
    node.icon.style.left = (node.center.x * minimap.scale - nodeSize / 2) + "px";
    node.icon.style.top = ((node.center.y - minimap.top) * minimap.scale - nodeSize / 2) + "px";
  }
}

// Only does anything when something it depends on has moved: the view, the ship, or which card is open. Writing
// styles and then measuring the page every frame would make the browser lay it out again every frame.
function updateMinimap(){
  let key = `${view.position.x},${view.position.y},${Math.round(ship.x)},${Math.round(ship.y)},${view.scale}`;
  if (key === minimap.lastKey && activeRoot === minimap.lastRoot) return;
  minimap.lastKey = key;
  minimap.lastRoot = activeRoot;

  minimap.screen.style.left = (view.position.x * minimap.scale) + "px";
  minimap.screen.style.top = ((view.position.y - minimap.top) * minimap.scale) + "px";

  let faded = isMinimapInTheWay();
  if (faded !== minimap.faded) {
    minimap.faded = faded;
    minimap.el.classList.toggle('minimapFaded', faded);
  }
}

// The corner it sits in is still part of the map. Whenever the ship, a location, or an open card is
// underneath it, it fades back rather than hiding them.
function isMinimapInTheWay(){
  // Where it sits only changes with the window's size - see layoutMinimap.
  let box = minimap.box ??= minimap.el.getBoundingClientRect();

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
