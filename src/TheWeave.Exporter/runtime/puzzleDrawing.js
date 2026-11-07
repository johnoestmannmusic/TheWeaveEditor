// puzzleDrawing.js
// John Oestmann
// Drawing a puzzle board: each kind of object's Standard drawing, sprites made from drawings in the album's
// colours, their depth, and renderBoard, which draws a whole board as plain pixel data.
// Knows nothing about the DOM. One of the parts of WeavePuzzle, brought together by puzzle.js - see there.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated into every exported
// site's jsx/ folder, and linked into the Editor, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./puzzleRules.js'), require('./puzzleColours.js'));
  else root.WeavePuzzleDrawing = factory(root.WeavePuzzleRules, root.WeavePuzzleColours);
})(this, function (WeavePuzzleRules, WeavePuzzleColours) {

  const { DIRECTION_DELTAS, LANTERN_REACH, exitDirectionOf, isFloor } = WeavePuzzleRules;
  const { PALETTE_MIN_CONTRAST, TILE_PX, hexToColor, lightnessOf, mixTexture, standardMix } = WeavePuzzleColours;

  // ---------- drawing ----------

  // How long a Stream's liquid takes to flow one whole square. Its pattern repeats every square, so a run of them
  // flows on from one to the next without a seam.
  const STREAM_CYCLE_MS = 900;
  // A Rotator tile's chevrons: how far apart they are, and how long they take to move a square, as fast as things
  // on it do.
  const STREAM_LINE_SPACING = 8;
  const ROTATOR_CYCLE_MS = 1000;
  // A Stream's channel, across a square: from its bank on one side to its bank on the other.
  const STREAM_BANK_LOW = 3;
  const STREAM_BANK_HIGH = TILE_PX - 1 - STREAM_BANK_LOW;
  // Each streak running down a Stream: where it is across the channel, where along it starts, how long it is, how
  // far it wanders from side to side as it goes, and whether its leading pixel glints.
  const STREAM_STREAKS = [
    { across: 7, start: 0, length: 7, wander: 1, glint: true },
    { across: 11, start: 14, length: 5, wander: 1, glint: false },
    { across: 15, start: 6, length: 8, wander: 1, glint: true },
    { across: 18, start: 19, length: 4, wander: 0, glint: false },
  ];
  // Darker ripples between the streaks, for the body of the liquid.
  const STREAM_RIPPLES = [
    { across: 9, start: 9, length: 4, wander: 1 },
    { across: 13, start: 21, length: 6, wander: 1 },
    { across: 6, start: 17, length: 3, wander: 0 },
  ];

  // Each letter as 7 rows of 5 pixels.
  const PIXEL_LETTERS = {
    A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
    C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
    E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
    G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
    I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
    K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
    M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
    O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
    Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
    S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
    U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
    W: '10001 10001 10001 10101 10101 11011 10001', X: '10001 10001 01010 00100 01010 10001 10001',
    Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  };

  // Each shape as whether a pixel of a square is inside it, measuring from the square's center.
  const SHAPES = {
    octagon: (dx, dy) => Math.abs(dx) <= 11 && Math.abs(dy) <= 11 && Math.abs(dx) + Math.abs(dy) <= 16,
    octagonHole: (dx, dy) => Math.abs(dx) <= 7 && Math.abs(dy) <= 7 && Math.abs(dx) + Math.abs(dy) <= 10,
    roundedSquare: (dx, dy) => {
      let cornerX = Math.max(0, Math.abs(dx) - 6), cornerY = Math.max(0, Math.abs(dy) - 6);
      return Math.abs(dx) <= 9.5 && Math.abs(dy) <= 9.5 && cornerX * cornerX + cornerY * cornerY <= 3.5 * 3.5;
    },
    circle: (dx, dy) => dx * dx + dy * dy <= 10.8 * 10.8,
    diamond: (dx, dy) => Math.abs(dx) + Math.abs(dy) <= 12,
    triangle: (dx, dy) => dy >= -9.5 && dy <= 9.5 && Math.abs(dx) <= (dy + 10.5) * 0.55,
    // A ring with eight teeth.
    gear: (dx, dy) => {
      let radius = Math.hypot(dx, dy);
      let tooth = Math.cos(Math.atan2(dy, dx) * 8) > 0;
      return radius >= 3.5 && radius <= (tooth ? 11.5 : 8.5);
    },
    star: (dx, dy) => Math.abs(dx) <= 11.5 && Math.abs(dy) <= 11.5 && Math.sqrt(Math.abs(dx)) + Math.sqrt(Math.abs(dy)) <= 4.1,
  };

  const SPRITE_SHAPES = { Wall: 'octagon', Gate: 'octagon', Finish: 'roundedSquare', Switch: 'circle', Teleporter: 'diamond', Key: 'triangle', RotatorSwitch: 'gear', Lantern: 'star' };
  const SPRITE_ROLES = { Wall: 'wall', Gate: 'gate', Finish: 'finish', Switch: 'gate', Teleporter: 'teleporter', Key: 'key', Stream: 'stream', RotatorTile: 'rotator', RotatorSwitch: 'rotator', Lantern: 'lantern', PushBlock: 'block', JumpTile: 'jump', ResetSwitch: 'reset', Pipe: 'wall', PipeSwitch: 'pipe', Archeton: 'archeton', Laser: 'archeton' };

  function maskOf(test){
    let mask = [];
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) mask.push(test(x + 0.5 - TILE_PX / 2, y + 0.5 - TILE_PX / 2));
    }
    return mask;
  }

  // Whether a pixel of a mask is on its edge: inside it, with something outside it right next to it.
  function isEdge(mask, x, y){
    let inside = (ax, ay) => ax >= 0 && ax < TILE_PX && ay >= 0 && ay < TILE_PX && mask[ay * TILE_PX + ax];
    return inside(x, y) && !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1));
  }

  function drawPixelLetter(sprite, letter, color, halo, scale){
    let rows = PIXEL_LETTERS[letter]?.split(' ');
    if (!rows) return;

    let left = Math.floor((TILE_PX - 5 * scale) / 2), top = Math.floor((TILE_PX - 7 * scale) / 2);
    let isLetter = (x, y) => {
      let col = Math.floor((x - left) / scale), row = Math.floor((y - top) / scale);
      return rows[row]?.[col] === '1';
    };

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (isLetter(x, y)) sprite[y * TILE_PX + x] = color;
        else if (halo && (isLetter(x - 1, y) || isLetter(x + 1, y) || isLetter(x, y - 1) || isLetter(x, y + 1))) sprite[y * TILE_PX + x] = halo;
      }
    }
  }

  // ---------- drawings ----------

  // What each character of a drawing paints: nothing, the outline colour, the light colour, the drawing's mix
  // laid out in the album's grain, or one of the mix's colours (darkest first) on its own.
  const PAINTS = { clear: '.', outline: 'O', light: 'H', grain: 'G', colors: ['1', '2', '3', '4'] };

  // Floor tiles that move what's on them, and are animated to show it. Each is drawn flowing right, and turned for
  // the other directions: a Still layer that stays put, and a Flow layer that runs along it, wrapping around, so a
  // line of them flows on from one square to the next. A Stream also has a Bend, for where another pours into it
  // from its left - see streamJoins.
  const ANIMATED_KINDS = ['Stream', 'RotatorTile'];

  // Objects with a direction, drawn pointing right and turned the way they point, as animated tiles are.
  const TURNED_KINDS = ['JumpTile', 'Pipe', 'Archeton', 'Laser'];

  // Every kind of object drawn from a drawing.
  const DRAWN_KINDS = [...Object.keys(SPRITE_SHAPES), 'PushBlock', ...TURNED_KINDS.filter(kind => kind !== 'Laser'), 'ResetSwitch', 'PipeSwitch', ...ANIMATED_KINDS, 'Laser'];

  const standardDrawings = new Map();

  // The drawing each kind has unless the project's library redraws it: its shape, outlined, in its standard
  // mix. Its id is the kind's own name, which is also how a library tells its redrawn Standard ones apart.
  function standardDrawing(kind){
    if (!standardDrawings.has(kind)) {
      let pixelsOf = (test) => {
        let mask = maskOf(test);
        let paints = '';
        for (let y = 0; y < TILE_PX; y++) {
          for (let x = 0; x < TILE_PX; x++) paints += !mask[y * TILE_PX + x] ? PAINTS.clear : isEdge(mask, x, y) ? PAINTS.outline : PAINTS.grain;
        }
        return paints;
      };

      let drawing;
      if (kind === 'Stream') drawing = { id: kind, kind, name: 'Standard', ...standardStreamLayers(), mix: standardMix('stream') };
      else if (kind === 'RotatorTile') drawing = { id: kind, kind, name: 'Standard', ...standardRotatorLayers(), mix: standardMix('rotator') };
      else if (kind === 'PushBlock') drawing = { id: kind, kind, name: 'Standard', pixels: standardPushBlockPixels(), mix: standardMix('block') };
      else if (kind === 'JumpTile') drawing = { id: kind, kind, name: 'Standard', pixels: standardJumpTilePixels(), mix: standardMix('jump') };
      else if (kind === 'ResetSwitch') drawing = { id: kind, kind, name: 'Standard', pixels: standardResetSwitchPixels(), mix: standardMix('reset') };
      else if (kind === 'Pipe') drawing = { id: kind, kind, name: 'Standard', pixels: standardPipePixels(), mix: standardMix('wall') };
      else if (kind === 'Laser') drawing = { id: kind, kind, name: 'Standard', pixels: standardLaserPixels(), mix: standardMix('archeton') };
      else if (kind === 'Archeton') drawing = { id: kind, kind, name: 'Standard', pixels: standardArchetonPixels(), mix: standardMix('archeton') };
      else if (kind === 'PipeSwitch') drawing = { id: kind, kind, name: 'Standard', pixels: standardPipeSwitchPixels(), mix: standardMix('pipe') };
      else {
        let body = SHAPES[SPRITE_SHAPES[kind]];
        drawing = { id: kind, kind, name: 'Standard', pixels: pixelsOf(body), mix: standardMix(SPRITE_ROLES[kind]) };
        if (kind === 'Gate') drawing.openPixels = pixelsOf((dx, dy) => body(dx, dy) && !SHAPES.octagonHole(dx, dy));
      }
      standardDrawings.set(kind, drawing);
    }
    return standardDrawings.get(kind);
  }

  // A layer of paints from a function of where each pixel is, flowing right: u along the flow, v across it.
  function layerOf(paintAt){
    let paints = '';
    for (let v = 0; v < TILE_PX; v++) {
      for (let u = 0; u < TILE_PX; u++) paints += paintAt(u, v);
    }
    return paints;
  }

  // A Stream's Standard layers: running liquid in its colours, so that the album decides whether it's water, lava
  // or anything else. A channel, outlined where it meets the floor and darker along its banks, with lighter
  // streaks and darker ripples wandering along it, and the odd glint.
  function standardStreamLayers(){
    // Its channel, straight through or bending in from the left, with the banks along its edges and the deeper
    // liquid just inside them. Beyond the square counts as more channel, since that's where it carries on.
    let channelPaints = (inChannel) => {
      let within = (u, v) => u < 0 || v < 0 || u >= TILE_PX || v >= TILE_PX || inChannel(u, v);
      let isBank = (u, v) => within(u, v) && (!within(u - 1, v) || !within(u + 1, v) || !within(u, v - 1) || !within(u, v + 1));
      return layerOf((u, v) => {
        if (!inChannel(u, v)) return PAINTS.clear;
        if (isBank(u, v)) return PAINTS.outline;
        if (isBank(u - 1, v) || isBank(u + 1, v) || isBank(u, v - 1) || isBank(u, v + 1)) return '1';
        return '3';
      });
    };
    let inBand = (v) => v >= STREAM_BANK_LOW && v <= STREAM_BANK_HIGH;
    let pixels = channelPaints((u, v) => inBand(v));
    let bendPixels = channelPaints((u, v) => u >= STREAM_BANK_LOW && (inBand(v) || (v < STREAM_BANK_LOW && u <= STREAM_BANK_HIGH)));

    let wrap = (value) => ((value % TILE_PX) + TILE_PX) % TILE_PX;
    let onLine = (line, u, v) => {
      let into = wrap(u - line.start);
      if (into >= line.length) return null;
      return v === line.across + Math.round(Math.sin(u / TILE_PX * Math.PI * 2) * line.wander) ? into : null;
    };
    let flowPixels = layerOf((u, v) => {
      let paint = PAINTS.clear;
      for (const line of STREAM_RIPPLES) if (onLine(line, u, v) !== null) paint = '2';
      for (const line of STREAM_STREAKS) {
        let into = onLine(line, u, v);
        if (into !== null) paint = line.glint && into === line.length - 1 ? PAINTS.light : '4';
      }
      return paint;
    });
    return { pixels, bendPixels, flowPixels };
  }

  // A Push Block's Standard drawing: a metal plate, bevelled, with a panel seam inset around its middle, where its
  // symbol goes (see drawSymbol), and a rivet in each corner.
  function standardPushBlockPixels(){
    let inPlate = (u, v) => {
      let dx = Math.abs(u - 11.5), dy = Math.abs(v - 11.5);
      let cornerX = Math.max(0, dx - 7.5), cornerY = Math.max(0, dy - 7.5);
      return dx <= 10.5 && dy <= 10.5 && cornerX * cornerX + cornerY * cornerY <= 9;
    };
    let rivets = [[4, 4], [19, 4], [4, 19], [19, 19]];
    return layerOf((u, v) => {
      if (!inPlate(u, v)) return PAINTS.clear;
      if (!inPlate(u - 1, v) || !inPlate(u + 1, v) || !inPlate(u, v - 1) || !inPlate(u, v + 1)) return PAINTS.outline;
      if (!inPlate(u - 2, v) || !inPlate(u, v - 2)) return '4';
      if (!inPlate(u + 2, v) || !inPlate(u, v + 2)) return '1';
      if (rivets.some(([x, y]) => x === u && y === v)) return PAINTS.light;
      let seam = (u === 5 || u === 18) && v >= 5 && v <= 18 || (v === 5 || v === 18) && u >= 5 && u <= 18;
      if (seam) return '2';
      // Brushed: faint lighter streaks running across it.
      return v % 4 === 2 && (u * 5 + v) % 7 > 2 ? '4' : '3';
    });
  }

  // A Jump Tile's Standard drawing, pointing right: a pad lying on the floor with a double chevron on it, each with
  // a darker edge below.
  function standardJumpTilePixels(){
    let onPad = (u, v) => u >= 0 && v >= 0 && u < TILE_PX && v < TILE_PX && SHAPES.roundedSquare(u + 0.5 - TILE_PX / 2, v + 0.5 - TILE_PX / 2);
    let onChevron = (u, v) => [5, 11].some(start => {
      let across = Math.abs(v - 11.5);
      let along = u - start - (5.5 - across);
      return across <= 5.5 && along >= -1 && along <= 0.5;
    });
    return layerOf((u, v) => {
      if (!onPad(u, v)) return PAINTS.clear;
      if (!onPad(u - 1, v) || !onPad(u + 1, v) || !onPad(u, v - 1) || !onPad(u, v + 1)) return PAINTS.outline;
      if (onChevron(u, v)) return '4';
      if (onChevron(u, v - 1)) return '1';
      return '2';
    });
  }

  // A Reset Switch's Standard drawing: a pad lying on the floor, like a Jump Tile's, with two arrows chasing each
  // other round anticlockwise, each with a darker edge below. One arc runs over the top and down the left, ending
  // in a head pointing down, and the other under the bottom and up the right, ending in one pointing up.
  function standardResetSwitchPixels(){
    let onPad = (u, v) => u >= 0 && v >= 0 && u < TILE_PX && v < TILE_PX && SHAPES.roundedSquare(u + 0.5 - TILE_PX / 2, v + 0.5 - TILE_PX / 2);
    let middle = (TILE_PX - 1) / 2;
    let inner = 3.9, outer = 5.9;
    // Each arc's span, in degrees anticlockwise from pointing right, its head at the end of it.
    let arcs = [[70, 180], [250, 360]];
    let onArrow = (u, v) => {
      let radius = Math.hypot(u - middle, v - middle);
      let degrees = (Math.atan2(middle - v, u - middle) * 180 / Math.PI + 360) % 360;
      if (radius >= inner && radius <= outer && arcs.some(([from, to]) => degrees >= from && degrees <= to)) return true;
      return arcs.some(([, to]) => {
        let angle = to * Math.PI / 180;
        let du = u - (middle + Math.cos(angle) * (inner + outer) / 2);
        let dv = v - (middle - Math.sin(angle) * (inner + outer) / 2);
        // How far along the way the arc is heading, and how far to either side of it.
        let along = -du * Math.sin(angle) - dv * Math.cos(angle);
        let across = du * Math.cos(angle) - dv * Math.sin(angle);
        // Its ends sit between half-pixels, so that it comes out the same either way round.
        return along >= -0.6 && along <= 3.6 && Math.abs(across) <= 3 - along * 0.95;
      });
    };
    return layerOf((u, v) => {
      if (!onPad(u, v)) return PAINTS.clear;
      if (!onPad(u - 1, v) || !onPad(u + 1, v) || !onPad(u, v - 1) || !onPad(u, v + 1)) return PAINTS.outline;
      if (onArrow(u, v)) return '4';
      if (onArrow(u, v - 1)) return '1';
      return '2';
    });
  }

  // A Pipe's Standard drawing, lying across: a Wall's top and bottom edges with the middle hollowed out, running
  // right across the square so that a line of them joins up. Turned to stand up.
  function standardPipePixels(){
    return layerOf((u, v) => {
      if (v === 2 || v === 6 || v === 17 || v === 21) return PAINTS.outline;
      if (v === 3) return '4';
      if (v === 20) return '1';
      if ((v > 3 && v < 6) || (v > 17 && v < 20)) return PAINTS.grain;
      return PAINTS.clear;
    });
  }

  // An Archeton's Standard drawing, looking right, and turned whichever way it faces: a mechanical eyeball, a metal
  // rim around a pale eye, with its iris and pupil looking out and a glint on it.
  function standardArchetonPixels(){
    let middle = (TILE_PX - 1) / 2;
    return layerOf((u, v) => {
      let fromMiddle = Math.hypot(u - middle, v - middle);
      if (fromMiddle > 10.8) return PAINTS.clear;
      if (fromMiddle > 9.8) return PAINTS.outline;
      if (fromMiddle > 7.8) return PAINTS.grain;
      if (fromMiddle > 7) return PAINTS.outline;
      let fromIris = Math.hypot(u - (middle + 2.5), v - middle);
      if (u === 13 && v === 9) return PAINTS.light;
      if (fromIris <= 1.8) return PAINTS.outline;
      if (fromIris <= 4.2) return '2';
      return v > middle + 3 ? '3' : '4';
    });
  }

  // A laser's Standard drawing, one square of it running right, and on across the next square: a band of the light
  // colour with the Archeton's lightest shade either side of it.
  function standardLaserPixels(){
    return layerOf((u, v) => {
      if (v === 11 || v === 12) return PAINTS.light;
      if (v === 10 || v === 13) return '4';
      return PAINTS.clear;
    });
  }

  // A Pipe Switch's Standard drawing: a Reset Switch's pad, with two lines across it in place of its arrows, each
  // with a darker edge below.
  function standardPipeSwitchPixels(){
    let onPad = (u, v) => u >= 0 && v >= 0 && u < TILE_PX && v < TILE_PX && SHAPES.roundedSquare(u + 0.5 - TILE_PX / 2, v + 0.5 - TILE_PX / 2);
    let onLine = (u, v) => u >= 6 && u <= 17 && (v === 8 || v === 9 || v === 14 || v === 15);
    return layerOf((u, v) => {
      if (!onPad(u, v)) return PAINTS.clear;
      if (!onPad(u - 1, v) || !onPad(u + 1, v) || !onPad(u, v - 1) || !onPad(u, v + 1)) return PAINTS.outline;
      if (onLine(u, v)) return '4';
      if (onLine(u, v - 1)) return '1';
      return '2';
    });
  }

  // A Rotator tile's Standard layers: two rails, with chevrons between them pointing along them.
  function standardRotatorLayers(){
    let pixels = layerOf((u, v) => {
      if (v === 1 || v === 3 || v === 20 || v === 22) return PAINTS.outline;
      return v === 2 || v === 21 ? PAINTS.grain : PAINTS.clear;
    });
    let flowPixels = layerOf((u, v) => {
      if (v <= 3 || v >= 20) return PAINTS.clear;
      let fromMiddle = Math.floor(Math.abs(v - (TILE_PX - 1) / 2));
      let moved = (u + fromMiddle) % STREAM_LINE_SPACING;
      if (moved > 3) return PAINTS.clear;
      return moved === 0 || moved === 3 ? PAINTS.outline : PAINTS.grain;
    });
    return { pixels, flowPixels };
  }

  // The drawing an object is drawn with: its variant from the library, or else its kind's Standard one, as
  // the library has it if it's been redrawn.
  // An Archeton is drawn with whichever drawing its definition says (look.archetons), rather than one of its own.
  function drawingFor(look, object){
    let find = (id) => look.drawings?.find(drawing => drawing.id === id && drawing.kind === object.kind);
    let definition = object.kind === 'Archeton' || object.kind === 'Laser' ? look.archetons?.find(d => d.id === object.archeton) : null;
    // One drawn on its own, like a thumbnail or in the Drawings view, has no definition, so it's its own variant.
    let fromDefinition = object.kind === 'Archeton' ? definition?.drawing : object.kind === 'Laser' ? definition?.laserDrawing : null;
    let variant = fromDefinition ?? object.variant;
    return (variant && find(variant)) || find(object.kind) || standardDrawing(object.kind);
  }

  function paintColor(paint, mix, index, outline, light){
    if (paint === PAINTS.outline) return outline;
    if (paint === PAINTS.light) return light;
    if (paint === PAINTS.grain) return mix.colors[mix.pixels[index]];
    let color = PAINTS.colors.indexOf(paint);
    return color === -1 ? null : mix.colors[Math.min(color, mix.colors.length - 1)];
  }

  // A square's worth of pixels for one object: a colour per pixel, or null where it's see-through.
  function buildSprite(object, look, switchesActive){
    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);

    let isOpenGate = object.kind === 'Gate' && object.open;
    let isDim = object.kind === 'Switch' && !switchesActive;

    let drawing = drawingFor(look, object);
    let paints = isOpenGate ? drawing.openPixels ?? standardDrawing('Gate').openPixels : drawing.pixels;
    let mix = mixTexture(look, drawing.mix);
    let turn = TURNED_KINDS.includes(object.kind) ? FLOW_TURNS[object.direction] ?? FLOW_TURNS.Right : null;

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let index = y * TILE_PX + x;
        let [u, v] = turn ? turn(x, y) : [x, y];
        let color = paintColor(paints[v * TILE_PX + u], mix, index, outline, light);
        if (!color) continue;
        // De-activated: every other pixel gives way to the outline's colour, the classic look of something disabled.
        sprite[index] = isDim && (x + y) % 2 === 0 ? outline : color;
      }
    }

    if (object.kind === 'Gate' || object.kind === 'Switch' || object.kind === 'Teleporter') {
      // Whichever of the art's lightest and darkest colours stands out from this shape the most. An open
      // Gate's letter has only the art behind it, so that one gets a dark edge to stand out from it.
      let fill = mix.colors[mix.main];
      let useDark = Math.abs(lightnessOf(fill) - lightnessOf(outline)) >= Math.abs(lightnessOf(fill) - lightnessOf(light));
      // Twice the alphabet's size where it fits. A diamond narrows too quickly for that, so its stays small.
      let scale = object.kind === 'Teleporter' ? 1 : 2;
      if (isOpenGate || isDim) drawPixelLetter(sprite, object.letter, light, outline, scale);
      else drawPixelLetter(sprite, object.letter, useDark ? outline : light, null, scale);
    }

    if (object.kind === 'PushBlock') {
      // In the light colour, unless the block's own colour is too near it to show, as with a Gate's letter.
      let fill = mix.colors[mix.main];
      let tooLight = Math.abs(lightnessOf(fill) - lightnessOf(light)) < PALETTE_MIN_CONTRAST;
      let lightest = mix.colors[mix.colors.length - 1];
      drawSymbol(sprite, object.symbol, tooLight ? outline : light, tooLight || lightest === fill ? null : lightest);
    }

    // A lit Lantern glows: a halo of the light colour just outside it, and a fainter, dithered one beyond that.
    if (object.kind === 'Lantern' && object.lit) sprite = glowing(sprite, light);

    // Turned before its depth is added, so that its raised edge stays at the bottom whichever way round it is.
    if (object.spin) sprite = spunBy(sprite, object.spin);

    let solid = object.kind === 'Wall' || object.kind === 'PushBlock' || object.kind === 'Archeton' || (object.kind === 'Gate' && !isOpenGate);
    return addDepth(sprite, look, solid, mix, outline, light);
  }

  function glowing(sprite, light){
    let drawn = (x, y) => x >= 0 && y >= 0 && x < TILE_PX && y < TILE_PX && !!sprite[y * TILE_PX + x];
    let near = (x, y, reach) => {
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (Math.abs(dx) + Math.abs(dy) <= reach && drawn(x + dx, y + dy)) return true;
      return false;
    };
    let glow = [...sprite];
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (drawn(x, y)) continue;
        if (near(x, y, 1) || (near(x, y, 2) && (x + y) % 2 === 0)) glow[y * TILE_PX + x] = light;
      }
    }
    return glow;
  }

  // A Rotator Switch turns clockwise while the ship stands on it, in SPIN_STEPS steps a turn, each one's sprite kept
  // like any other. An object's spin is how many steps round it is.
  const SPIN_STEPS = 32;
  const SPIN_TURN_MS = 2000;

  // Which step of its turn a Rotator Switch is at, after being stood on for ms.
  function spinAt(ms){
    return Math.floor(ms / (SPIN_TURN_MS / SPIN_STEPS)) % SPIN_STEPS;
  }

  // A square's pixels turned clockwise about its middle, each pixel taken from wherever it turned from.
  function spunBy(sprite, steps){
    let angle = steps / SPIN_STEPS * Math.PI * 2;
    let cos = Math.cos(angle), sin = Math.sin(angle);
    let middle = (TILE_PX - 1) / 2;
    let spun = new Array(TILE_PX * TILE_PX).fill(null);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let dx = x - middle, dy = y - middle;
        let fromX = Math.round(middle + dx * cos + dy * sin);
        let fromY = Math.round(middle - dx * sin + dy * cos);
        if (fromX >= 0 && fromX < TILE_PX && fromY >= 0 && fromY < TILE_PX) spun[y * TILE_PX + x] = sprite[fromY * TILE_PX + fromX];
      }
    }
    return spun;
  }

  // A Push Block's symbol, as a hollow outline 9 pixels across, so that two that match read at a glance.
  const SYMBOLS = {
    Circle: '..XXXXX.. .X.....X. X.......X X.......X X.......X X.......X X.......X .X.....X. ..XXXXX..',
    Cross: 'X.......X .X.....X. ..X...X.. ...X.X... ....X.... ...X.X... ..X...X.. .X.....X. X.......X',
    Triangle: '....X.... ....X.... ...X.X... ...X.X... ..X...X.. ..X...X.. .X.....X. .X.....X. XXXXXXXXX',
    Square: 'XXXXXXXXX X.......X X.......X X.......X X.......X X.......X X.......X X.......X XXXXXXXXX',
    Star: '....X.... ...X.X... XXX...XXX X.......X .X.....X. ..X...X.. .X..X..X. .X.X.X.X. .XX...XX.',
  };
  const SYMBOL_PX = 9;

  // The symbol drawn in the light colour, glowing like neon: a halo just outside it, side by side with it, in glow (the
  // block's own lightest shade). Only outside, so that a hollow symbol stays hollow, and its shape stays clear.
  function drawSymbol(sprite, symbol, color, glow){
    let rows = SYMBOLS[symbol]?.split(' ');
    if (!rows) return;
    let start = Math.floor((TILE_PX - SYMBOL_PX) / 2);
    let on = (x, y) => rows[y - start]?.[x - start] === 'X';

    // Everything that can be reached from the edge of the square without crossing the symbol is outside it.
    let outside = new Set();
    let queue = [[0, 0]];
    while (queue.length > 0) {
      let [x, y] = queue.pop();
      let key = y * TILE_PX + x;
      if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX || outside.has(key) || on(x, y)) continue;
      outside.add(key);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let glowing = glow && outside.has(y * TILE_PX + x) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1));
        if (on(x, y)) sprite[y * TILE_PX + x] = color;
        else if (glowing) sprite[y * TILE_PX + x] = glow;
      }
    }
  }

  // ---------- depth ----------

  // Objects are drawn with depth, worked out from their flat sprite in their own colours, so that any drawing gets
  // it and it stays pixel art. Solid ones, that block the way, stand up like blocks seen from slightly above: their
  // top drawn RAISED_PX higher, into the square above, with a darker front face below it, a lit top-left edge, and a
  // dithered shadow. The ones stepped onto lie on the floor, with just the lit edge and a smaller shadow. look.depth
  // 'flat' leaves them as drawn, for the Editor's painter, where every pixel has to be where it's painted.
  const RAISED_PX = 3;

  // The light and dark that depth is shaded with: the mix's own lightest and darkest, or, for a mix of only one
  // colour, the art's lightest and darkest.
  function depthShades(mix, outline, light){
    return mix.colors.length > 1
      ? { lit: mix.colors[mix.colors.length - 1], dark: mix.colors[0] }
      : { lit: light, dark: outline };
  }

  // A sprite with depth added. One that rises above its square has extra rows on top, how many being its rise.
  function addDepth(flat, look, solid, mix, outline, light){
    if (look.depth === 'flat') return flat;

    let { lit, dark } = depthShades(mix, outline, light);
    let rise = solid ? RAISED_PX : 0;
    let sprite = new Array(TILE_PX * (TILE_PX + rise)).fill(null);
    // x and y in the square's own pixels, y going negative into the rows above it.
    let flatAt = (x, y) => x >= 0 && x < TILE_PX && y >= 0 && y < TILE_PX ? flat[y * TILE_PX + x] : null;
    let set = (x, y, color) => { sprite[(y + rise) * TILE_PX + x] = color; };

    // The front face: everything the object covers on its way up, darker, outlined where it meets the floor.
    if (rise) {
      let covered = (x, y) => { for (let k = 0; k <= rise; k++) if (flatAt(x, y + k)) return true; return false; };
      for (let y = -rise; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          if (!covered(x, y)) continue;
          set(x, y, !covered(x - 1, y) || !covered(x + 1, y) || !covered(x, y + 1) ? outline : dark);
        }
      }
    }

    // The face itself, lifted by its rise, lit along its top-left just inside its outline.
    let face = (x, y) => flatAt(x, y + rise);
    let insideAt = (x, y) => { let color = face(x, y); return color && color !== outline; };
    for (let y = -rise; y < TILE_PX - rise; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let color = face(x, y);
        if (!color) continue;
        if (mix.colors.includes(color) && (!insideAt(x - 1, y) || !insideAt(x, y - 1))) color = lit;
        set(x, y, color);
      }
    }

    // A dithered shadow down and to the right, on the floor within the square: smaller under something lying on it.
    let offset = solid ? 2 : 1;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if ((x + y) % 2 !== 0 || sprite[(y + rise) * TILE_PX + x]) continue;
        if (flatAt(x - offset, y - offset)) set(x, y, outline);
      }
    }

    sprite.rise = rise;
    return sprite;
  }

  // Which of a Stream's layers its square is drawn from: straight through, if a Stream flows in from straight
  // behind it or none flows in from anywhere (where a Stream begins, it runs in from the edge), and bending in from
  // either side that a Stream pours in from. So a run of them reads as one channel, a bend opens towards whatever
  // pours into it, and two side by side stay apart.
  function streamJoins(object, streams){
    let { x, y } = DIRECTION_DELTAS[object.direction];
    let flowsIn = (dx, dy) => {
      let from = streams.get((object.col + dx) + ',' + (object.row + dy));
      return !!from && DIRECTION_DELTAS[from].x === -dx && DIRECTION_DELTAS[from].y === -dy;
    };
    // Its left and right, looking downstream.
    let left = flowsIn(y, -x), right = flowsIn(-y, x);
    return { back: flowsIn(-x, -y) || (!left && !right), left, right };
  }

  // Where a pixel of a square is in a drawing flowing right, for a tile flowing each way: u along the flow and v
  // across it, so the drawing's top is always on the flow's left.
  const FLOW_TURNS = {
    Right: (x, y) => [x, y],
    Down: (x, y) => [y, TILE_PX - 1 - x],
    Left: (x, y) => [TILE_PX - 1 - x, TILE_PX - 1 - y],
    Up: (x, y) => [TILE_PX - 1 - y, x],
  };

  const isLiquid = (paint) => paint !== PAINTS.clear && paint !== PAINTS.outline;

  // A Stream or Rotator tile, turned to the way it flows, its Flow layer moved phase pixels along. A Stream's Flow
  // only shows on its liquid, so that it keeps to the channel round a bend; a Rotator tile's shows anywhere. Where
  // a Stream's straight and bending channels meet, liquid wins over a bank, and a bank over nothing.
  function buildAnimatedSprite(object, look, phase, joins = { back: true, left: false, right: false }){
    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let drawing = drawingFor(look, object);
    let standard = standardDrawing(object.kind);
    let still = drawing.pixels;
    let bend = drawing.bendPixels ?? standard.bendPixels;
    let flow = drawing.flowPixels ?? standard.flowPixels;
    let isStream = object.kind === 'Stream';
    let mix = mixTexture(look, drawing.mix);
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);
    let turn = FLOW_TURNS[object.direction] ?? FLOW_TURNS.Right;
    let rank = (paint) => paint === undefined ? -1 : isLiquid(paint) ? 2 : paint === PAINTS.outline ? 1 : 0;

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let [u, v] = turn(x, y);
        let paint = still[v * TILE_PX + u];
        if (isStream) {
          let layers = [joins.back ? paint : undefined, joins.left ? bend[v * TILE_PX + u] : undefined, joins.right ? bend[(TILE_PX - 1 - v) * TILE_PX + u] : undefined];
          paint = layers.reduce((best, layer) => rank(layer) > rank(best) ? layer : best, undefined) ?? PAINTS.clear;
        }
        let moving = flow[v * TILE_PX + (((u - phase) % TILE_PX) + TILE_PX) % TILE_PX];
        if (moving !== PAINTS.clear && (!isStream || isLiquid(paint))) paint = moving;

        let index = y * TILE_PX + x;
        sprite[index] = paintColor(paint, mix, index, outline, light);
      }
    }
    return sprite;
  }

  // A drawing's layer on its own, flowing right, for the Drawings view to paint on: Still or Bend, or Flow over the
  // Still layer, shown wherever it's painted, so that nothing painted is hidden.
  function renderDrawingLayer(image, drawing, look, layer){
    let standard = standardDrawing(drawing.kind);
    let mix = mixTexture(look, drawing.mix);
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);
    let base = layer === 'bend' ? drawing.bendPixels ?? standard.bendPixels : drawing.pixels;
    let flow = layer === 'flow' ? drawing.flowPixels ?? standard.flowPixels : null;
    image.data.fill(0);
    for (let index = 0; index < TILE_PX * TILE_PX; index++) {
      let paint = flow && flow[index] !== PAINTS.clear ? flow[index] : base[index];
      let color = paintColor(paint, mix, index, outline, light);
      if (color) image.data.set([color.r, color.g, color.b, 255], (Math.floor(index / TILE_PX) * image.width + index % TILE_PX) * 4);
    }
  }

  // Sprites are only worth working out once per look, since there are only so many things to be drawn.
  const spriteCaches = new WeakMap();

  function spriteKey(object, switchesActive, streamPhase, rotatorPhase, joins){
    if (object.kind === 'Stream') return `Stream|${object.variant ?? ''}|${object.direction}|${streamPhase}|${joins.back}|${joins.left}|${joins.right}`;
    if (object.kind === 'RotatorTile') return `RotatorTile|${object.variant ?? ''}|${object.direction}|${rotatorPhase}`;
    return `${object.kind}|${object.variant ?? ''}|${object.letter ?? ''}|${object.symbol ?? ''}|${object.direction ?? ''}|${object.kind === 'Gate' && !!object.open}|${object.kind === 'Switch' && !switchesActive}|${!!object.lit}|${object.spin ?? 0}|${object.archeton ?? ''}`;
  }

  function spriteFor(object, look, switchesActive, streamPhase, rotatorPhase, streams, finishPhase = 0){
    let cache = spriteCaches.get(look);
    if (!cache) spriteCaches.set(look, cache = new Map());

    let joins = object.kind === 'Stream' ? streamJoins(object, streams) : null;
    // A Finish on an edge has arrows running towards it - see withFinishArrows.
    let exit = object.kind === 'Finish' ? exitDirectionOf({ col: Math.round(object.col), row: Math.round(object.row) }) : null;
    let arrowPhase = exit ? finishPhase % FINISH_ARROW_SPACING : 0;
    let key = spriteKey(object, switchesActive, streamPhase, rotatorPhase, joins) + (exit ? `|${exit}|${arrowPhase}` : '');
    let sprite = cache.get(key);
    if (!sprite) {
      if (object.kind === 'Stream') sprite = buildAnimatedSprite(object, look, streamPhase, joins);
      else if (object.kind === 'RotatorTile') sprite = buildAnimatedSprite(object, look, rotatorPhase);
      else sprite = buildSprite(object, look, switchesActive);
      if (exit) sprite = withFinishArrows(sprite, look, exit, arrowPhase);
      cache.set(key, sprite);
    }
    return sprite;
  }

  // A Finish on the board's edge is where the ship leaves, so chevrons run across its pad towards that edge, round
  // and round like a carousel, to say so at a glance. They're FINISH_ARROW_SPACING pixels apart, moving a pixel
  // at a time, and kept inside the pad, never over its outline. In whichever of the light and outline colours stands
  // out more from the pad.
  const FINISH_ARROW_SPACING = 8;
  const FINISH_ARROW_CYCLE_MS = 1200;

  function withFinishArrows(sprite, look, exit, phase){
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);
    let rise = sprite.rise ?? 0;
    let same = (a, b) => a && b && a.r === b.r && a.g === b.g && a.b === b.b;
    let at = (x, y) => x >= 0 && y >= 0 && x < TILE_PX && y < TILE_PX + rise ? sprite[y * TILE_PX + x] : null;
    // Inside the pad: drawn, not outline, and with the same all round it.
    let inside = (x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
      let color = at(x + dx, y + dy);
      return color && !same(color, outline);
    });

    let padColors = [];
    for (let y = rise; y < TILE_PX + rise; y++) for (let x = 0; x < TILE_PX; x++) if (inside(x, y)) padColors.push(at(x, y));
    if (padColors.length === 0) return sprite;
    let padLightness = padColors.reduce((sum, color) => sum + lightnessOf(color), 0) / padColors.length;
    let color = Math.abs(padLightness - lightnessOf(light)) >= Math.abs(padLightness - lightnessOf(outline)) ? light : outline;

    // A chevron pointing right, 2 pixels thick, every FINISH_ARROW_SPACING pixels along, moved on by phase.
    let middle = (TILE_PX - 1) / 2;
    let onChevron = (u, v) => {
      let across = Math.abs(v - middle);
      if (across > 4) return false;
      let along = ((u - phase + Math.floor(across)) % FINISH_ARROW_SPACING + FINISH_ARROW_SPACING) % FINISH_ARROW_SPACING;
      return along < 2;
    };
    let turn = FLOW_TURNS[exit];

    let arrowed = [...sprite];
    arrowed.rise = rise;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (!inside(x, y + rise)) continue;
        let [u, v] = turn(x, y);
        if (onChevron(u, v)) arrowed[(y + rise) * TILE_PX + x] = color;
      }
    }
    return arrowed;
  }

  // For the Editor, where something invisible still has to be seen: every other pixel of it, see-through.
  function ghostOf(sprite){
    let rise = sprite.rise ?? 0;
    let ghost = sprite.map((color, i) => (Math.floor(i / TILE_PX) + rise + i % TILE_PX) % 2 === 0 ? color : null);
    ghost.rise = rise;
    return ghost;
  }

  // A sprite that rises above its square starts that many rows higher. Nothing is drawn from below clipBottom, which
  // is how something sinking into its square disappears into the ground. opacity below 1 lays it over whatever's
  // already there, partly see-through, which is how something fades in or out.
  function blit(image, sprite, left, top, clipBottom = Infinity, opacity = 1){
    let { data, width, height } = image;
    top -= sprite.rise ?? 0;
    for (let y = 0; y < sprite.length / TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let color = sprite[y * TILE_PX + x];
        let px = left + x, py = top + y;
        if (!color || px < 0 || px >= width || py < 0 || py >= height || py >= clipBottom) continue;
        let i = (py * width + px) * 4;
        if (opacity >= 1) {
          data[i] = color.r;
          data[i + 1] = color.g;
          data[i + 2] = color.b;
          data[i + 3] = 255;
          continue;
        }
        let under = data[i + 3] / 255 * (1 - opacity);
        let total = opacity + under;
        data[i] = (color.r * opacity + data[i] * under) / total;
        data[i + 1] = (color.g * opacity + data[i + 1] * under) / total;
        data[i + 2] = (color.b * opacity + data[i + 2] * under) / total;
        data[i + 3] = total * 255;
      }
    }
  }

  // Draws a whole board into RGBA pixel data the size of the album art, to be scaled up exactly as the art
  // is, so that every pixel of every object lands on one of the art's. Floor tiles go first, so that whatever's
  // on one sits on top of it. Start isn't drawn, since that's where the ship itself goes.
  //
  // look is { palette, textures, drawings }, drawings being the project's library (see drawingFor). Options:
  // - timeMs drives a Stream's animation, and rotatorTimeMs a Rotator tile's, which only moves when it's told to.
  // - switchesActive says whether Switches work yet.
  // - along and rotatorAlong are how far objects are through moving from their fromCol and fromRow, for
  //   ones in play, depending on which kind of tile moved them. They move in whole pixels, like everything else.
  // - showInvisible draws anything invisible and unrevealed as a ghost, rather than leaving it out.
  // - pushAlong is how far a Push Block being pushed is through its glide, along with the ship, and returnAlong how far
  //   one a closing Gate is sending back is through its glide, and slideAlong how far a Slide Bug is through its slide.
  // - An object's own sink, from 0 to 1, is how far it's sunk into its square, after matching - see sinkMatches.
  // - An object's own spin is how far round clockwise it's turned, as a Rotator Switch does while stood on - see spinAt.
  // - An object's own fade, from 0 to 1, is how much of it shows, as a Reset Switch's sweep passes - see resetSweepAt.
  // - beams ([{ from, to }]) draws an Archeton's laser from one square to another - see createPuzzleGame's beams.
  // - reaches ([{ col, row }]) outlines each square an Archeton's Beam reaches - see createPuzzleGame's reaches.
  // - pulses ([{ col, row, radius }]) draws each lit Lantern's pulse: a ring radius pixels out from its square's middle.
  // - pushHint ({ col, row, direction, bob }) shows that the Push Block on that square can be pushed: an arrow just
  //   past it, pointing the way it would go, bob pixels further out as it bobs.
  // - originY moves the whole board down by that many pixels, to leave room for objects rising above row 0.
  // Objects are drawn top row first, so that one rising into the square above it (see addDepth) is drawn over
  // whatever's there.
  function renderBoard(image, objects, look, options = {}){
    image.data.fill(0);

    let phaseOf = (timeMs, cycle) => Math.floor(((timeMs ?? 0) % cycle) / cycle * TILE_PX);
    let streamPhase = phaseOf(options.timeMs, STREAM_CYCLE_MS);
    let rotatorPhase = phaseOf(options.rotatorTimeMs, ROTATOR_CYCLE_MS);
    let finishPhase = phaseOf(options.timeMs, FINISH_ARROW_CYCLE_MS);
    // Where every Stream is, and which way it flows, for how they join up - see streamJoins.
    let streams = new Map(objects.filter(object => object.kind === 'Stream').map(object => [object.col + ',' + object.row, object.direction]));
    let switchesActive = options.switchesActive ?? true;

    let alongFor = (object) => (object.glide === 'rotator' ? options.rotatorAlong : object.glide === 'push' ? options.pushAlong
      : object.glide === 'return' ? options.returnAlong : object.glide === 'slide' ? options.slideAlong : options.along) ?? 1;
    let drawnRow = (object) => object.fromRow === undefined ? object.row : object.fromRow + (object.row - object.fromRow) * alongFor(object);
    let floorsFirst = objects
      .filter(object => object.kind !== 'Start')
      // A Gate goes under a Push Block sitting in it.
      .sort((a, b) => isFloor(b) - isFloor(a) || drawnRow(a) - drawnRow(b) || (b.kind === 'Gate') - (a.kind === 'Gate'));

    for (const object of floorsFirst) {
      let hidden = object.invisible && !object.revealed;
      if (hidden && !options.showInvisible) continue;

      let along = alongFor(object);
      let col = object.fromCol === undefined ? object.col : object.fromCol + (object.col - object.fromCol) * along;
      let row = object.fromRow === undefined ? object.row : object.fromRow + (object.row - object.fromRow) * along;
      let sprite = spriteFor(object, look, switchesActive, streamPhase, rotatorPhase, streams, finishPhase);
      let top = Math.round(row * TILE_PX) + (options.originY ?? 0);
      let sunk = Math.round((object.sink ?? 0) * TILE_PX);
      let opacity = object.fade ?? 1;
      if (opacity <= 0) continue;
      blit(image, hidden ? ghostOf(sprite) : sprite, Math.round(col * TILE_PX), top + sunk, object.sink ? top + TILE_PX : Infinity, opacity);
    }

    if (options.pushHint) drawPushHint(image, options.pushHint, look, options.originY ?? 0);
    for (const pulse of options.pulses ?? []) drawPulse(image, pulse, look, options.originY ?? 0);
    for (const cell of options.reaches ?? []) drawReach(image, cell, look, options.originY ?? 0);
    for (const beam of options.beams ?? []) drawBeam(image, beam, look, options.originY ?? 0);
  }

  // A square an Archeton's Beam reaches, outlined just inside its edge in the light colour, with the outline colour
  // just inside that, so that it shows up on any art, laid partly over whatever's there: where it's dangerous to be
  // reads at a glance.
  function drawReach(image, cell, look, originY){
    let light = hexToColor(look.palette.light);
    let dark = hexToColor(look.palette.outline);
    let { data, width, height } = image;
    let left = cell.col * TILE_PX + 1, top = cell.row * TILE_PX + 1 + originY;
    let size = TILE_PX - 2;
    for (let y = top; y < top + size; y++) {
      for (let x = left; x < left + size; x++) {
        let ring = Math.min(x - left, left + size - 1 - x, y - top, top + size - 1 - y);
        if (ring > 1 || x < 0 || y < 0 || x >= width || y >= height) continue;
        let color = ring === 0 ? light : dark;
        let opacity = ring === 0 ? 0.9 : 0.6;
        let i = (y * width + x) * 4;
        let under = data[i + 3] / 255 * (1 - opacity);
        let total = opacity + under;
        data[i] = (color.r * opacity + data[i] * under) / total;
        data[i + 1] = (color.g * opacity + data[i + 1] * under) / total;
        data[i + 2] = (color.b * opacity + data[i + 2] * under) / total;
        data[i + 3] = total * 255;
      }
    }
  }

  // An Archeton's laser: its Laser drawing, a square at a time from the square past the Archeton to the beam's end,
  // turned the way it runs, and a little see-through, so what's under it still shows.
  const LASER_OPACITY = 0.75;

  function drawBeam(image, beam, look, originY){
    let dCol = Math.sign(beam.to.col - beam.from.col), dRow = Math.sign(beam.to.row - beam.from.row);
    let direction = dCol > 0 ? 'Right' : dCol < 0 ? 'Left' : dRow > 0 ? 'Down' : 'Up';
    let sprite = spriteFor({ kind: 'Laser', direction, archeton: beam.archeton }, look, true, 0, 0, null);
    let col = beam.from.col, row = beam.from.row;
    while (col !== beam.to.col || row !== beam.to.row) {
      col += dCol;
      row += dRow;
      blit(image, sprite, col * TILE_PX, row * TILE_PX + originY, Infinity, LASER_OPACITY);
    }
  }


  // How far a lit Lantern's pulse spreads, in pixels: as far as it reaches.
  const PULSE_REACH_PX = LANTERN_REACH * TILE_PX;

  // A Lantern's pulse: a ring of the light colour around its square's middle, radius pixels out, fading as it spreads.
  function drawPulse(image, pulse, look, originY){
    let light = hexToColor(look.palette.light);
    let { data, width, height } = image;
    let middleX = (pulse.col + 0.5) * TILE_PX, middleY = (pulse.row + 0.5) * TILE_PX + originY;
    let opacity = 0.85 * (1 - pulse.radius / PULSE_REACH_PX);
    if (opacity <= 0) return;
    let reach = Math.ceil(pulse.radius + 2);
    for (let py = Math.max(0, Math.floor(middleY - reach)); py < Math.min(height, middleY + reach); py++) {
      for (let px = Math.max(0, Math.floor(middleX - reach)); px < Math.min(width, middleX + reach); px++) {
        if (Math.abs(Math.hypot(px + 0.5 - middleX, py + 0.5 - middleY) - pulse.radius) > 1) continue;
        let i = (py * width + px) * 4;
        let under = data[i + 3] / 255 * (1 - opacity);
        let total = opacity + under;
        data[i] = (light.r * opacity + data[i] * under) / total;
        data[i + 1] = (light.g * opacity + data[i + 1] * under) / total;
        data[i + 2] = (light.b * opacity + data[i + 2] * under) / total;
        data[i + 3] = total * 255;
      }
    }
  }

  // An arrow pointing right, before it's turned the way a push would go.
  const PUSH_ARROW = ['...X...', '...XX..', 'XXXXXX.', 'XXXXXXX', 'XXXXXX.', '...XX..', '...X...'];
  const PUSH_ARROW_PX = 7;

  // The arrow just past a Push Block on the side it would be pushed to, in the light colour outlined in the dark.
  function drawPushHint(image, hint, look, originY){
    let light = hexToColor(look.palette.light);
    let outline = hexToColor(look.palette.outline);
    let last = PUSH_ARROW_PX - 1;
    let size = PUSH_ARROW_PX + 2;
    let turn = { Right: (u, v) => [u, v], Down: (u, v) => [last - v, u], Left: (u, v) => [last - u, last - v], Up: (u, v) => [v, last - u] }[hint.direction];
    if (!turn) return;

    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let on = (x, y) => {
      for (let v = 0; v < PUSH_ARROW_PX; v++) {
        for (let u = 0; u < PUSH_ARROW_PX; u++) {
          let [tx, ty] = turn(u, v);
          if (tx === x && ty === y && PUSH_ARROW[v][u] === 'X') return true;
        }
      }
      return false;
    };
    for (let y = -1; y <= PUSH_ARROW_PX; y++) {
      for (let x = -1; x <= PUSH_ARROW_PX; x++) {
        let color = on(x, y) ? light : [-1, 0, 1].some(dy => [-1, 0, 1].some(dx => on(x + dx, y + dy))) ? outline : null;
        if (color) sprite[(y + 1) * TILE_PX + x + 1] = color;
      }
    }

    let gap = 1 + (hint.bob ?? 0);
    let middle = Math.floor((TILE_PX - size) / 2);
    let left = hint.col * TILE_PX, top = hint.row * TILE_PX + originY;
    let placed = {
      Right: [left + TILE_PX + gap, top + middle],
      Left: [left - size - gap, top + middle],
      Down: [left + middle, top + TILE_PX + gap],
      Up: [left + middle, top - size - gap],
    }[hint.direction];
    blit(image, sprite, placed[0], placed[1]);
  }

  return { renderBoard, spinAt, SPIN_STEPS, PULSE_REACH_PX, PAINTS, DRAWN_KINDS, ANIMATED_KINDS, TURNED_KINDS, SYMBOLS, SPRITE_ROLES, standardDrawing, renderDrawingLayer, RAISED_PX };
});
