// puzzle.js
// John Oestmann
// Sokoban puzzles played over a track's album art: what each object looks like, what colours they're
// drawn in, the rules for placing them on a board, and the rules for playing one. Knows nothing about
// the DOM - callers pass in plain pixel data, and get plain pixel data back. Shared by the Editor's
// Puzzle Editor and the exported site, so that a puzzle looks the same in both.
//
// This file is part of the canonical shared runtime owned by TheWeave.Exporter - it's generated into
// every exported site's jsx/puzzle.js, not hand-edited there.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WeavePuzzle = factory();
})(this, function () {

  const BOARD_SIZE = 10;
  // Where the ship begins on a board that hasn't said otherwise.
  const DEFAULT_START = { col: 5, row: 9 };
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const DIRECTION_DELTAS = {
    Up: { x: 0, y: -1 },
    Down: { x: 0, y: 1 },
    Left: { x: -1, y: 0 },
    Right: { x: 1, y: 0 },
  };

  function isAt(object, cell){
    return object.col === cell.col && object.row === cell.row;
  }

  // ---------- placing objects ----------

  // A board with one more object on it, leaving the original alone. A square holds one object plus
  // optionally a Stream under it, so anything new replaces only what it would otherwise share the
  // square with, and there's only ever one Start. The ship always needs somewhere to begin, so nothing
  // else can replace Start - it has to be moved out of the way first.
  function placeObject(objects, object){
    let isStream = object.kind === 'Stream';
    if (!isStream && object.kind !== 'Start' && objects.some(other => other.kind === 'Start' && isAt(other, object))) return objects;
    return [
      ...objects.filter(other => {
        if (object.kind === 'Start' && other.kind === 'Start') return false;
        return !(isAt(other, object) && (other.kind === 'Stream') === isStream);
      }),
      object,
    ];
  }

  // A board with the top thing on a square removed: an object first, then the Stream it was on. Start
  // stays, for the same reason it can't be replaced.
  function eraseObject(objects, cell){
    let here = objects.filter(other => isAt(other, cell) && other.kind !== 'Start');
    let top = here.find(other => other.kind !== 'Stream') ?? here[0];
    return objects.filter(other => other !== top);
  }

  // The letter a new object most likely wants: a Teleporter's unfinished pair, a Gate's missing Switch,
  // or otherwise the first letter that kind hasn't used.
  function suggestLetter(objects, kind){
    let letters = (wanted) => objects.filter(o => o.kind === wanted).map(o => o.letter);
    let firstUnused = (...used) => LETTERS.find(letter => !used.flat().includes(letter)) ?? LETTERS[0];

    if (kind === 'Teleporter') {
      let teleporters = letters('Teleporter');
      return teleporters.find(letter => teleporters.filter(l => l === letter).length === 1) ?? firstUnused(teleporters);
    }

    let gates = letters('Gate');
    let switches = letters('Switch');
    if (kind === 'Switch') return gates.find(letter => !switches.includes(letter)) ?? firstUnused(gates, switches);
    return switches.find(letter => !gates.includes(letter)) ?? firstUnused(gates, switches);
  }

  // ---------- playing ----------

  const OPPOSITES = { Up: 'Down', Down: 'Up', Left: 'Right', Right: 'Left' };
  // sokoban.js's directions are lower case, and a puzzle's are capitalized as they are in the project file.
  const MOVER_DIRECTIONS = { Up: 'up', Down: 'down', Left: 'left', Right: 'right' };
  const PUZZLE_DIRECTIONS = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };

  // Whether a puzzle can be solved at all, which is what decides if it can hold anything back.
  function hasFinish(puzzle){
    return !!puzzle && puzzle.objects.some(object => object.kind === 'Finish');
  }

  // One playthrough of a puzzle. Holds where everything is, and answers what happens next - the caller
  // owns the ship's actual movement, through sokoban.js's canEnter and onArrive hooks.
  function createPuzzleGame(puzzle) {
    let streams = new Map();
    let objects = [];
    let start = { col: DEFAULT_START.col, row: DEFAULT_START.row };

    for (const object of puzzle.objects) {
      if (object.kind === 'Stream') streams.set(cellKey(object), object.direction);
      else if (object.kind === 'Start') start = { col: object.col, row: object.row };
      else objects.push({ ...object, fromCol: object.col, fromRow: object.row, open: !!object.open });
    }

    let shipCell = start;
    let solved = false;

    function cellKey(cell){
      return cell.col + "," + cell.row;
    }

    function objectAt(cell){
      return objects.find(object => isAt(object, cell)) ?? null;
    }

    function switchesActive(){
      return !objects.some(object => object.kind === 'Key');
    }

    function isSolid(object){
      return object.kind === 'Wall' || (object.kind === 'Gate' && !object.open);
    }

    function nextCell(cell, direction){
      let delta = DIRECTION_DELTAS[direction];
      return { col: cell.col + delta.x, row: cell.row + delta.y };
    }

    // What standing on a square does to the board, and where that leaves the ship: null, or
    // { teleportTo } or { finished } for the caller to act on.
    function arriveAt(cell){
      shipCell = cell;
      let object = objectAt(cell);
      if (!object) return null;

      switch (object.kind) {
        case 'Key':
          objects.splice(objects.indexOf(object), 1);
          return null;

        case 'Switch':
          if (!switchesActive()) return null;
          for (const gate of objects) {
            if (gate.kind === 'Gate' && gate.letter === object.letter) gate.open = !gate.open;
          }
          return null;

        case 'Teleporter': {
          let partners = objects.filter(other => other.kind === 'Teleporter' && other.letter === object.letter);
          if (partners.length !== 2) return null;
          let partner = partners.find(other => other !== object);
          let destination = { col: partner.col, row: partner.row };
          shipCell = destination;
          return { teleportTo: destination };
        }

        case 'Finish':
          solved = true;
          return { finished: true };
      }

      return null;
    }

    // Which objects on Streams can move this tick, all at once, so a full loop keeps circulating.
    // Starts from everything that might, then takes out whatever turns out to be blocked, until
    // what's left can all really go.
    function resolveStreamMoves(occupiedByShip){
      let moves = new Map();
      for (const object of objects) {
        let direction = streams.get(cellKey(object));
        if (!direction) continue;
        let to = nextCell(object, direction);
        if (streams.has(cellKey(to))) moves.set(object, to);
      }

      let changed = true;
      while (changed) {
        changed = false;
        for (const [object, to] of moves) {
          let occupant = objectAt(to);
          let occupantLeaving = occupant && moves.has(occupant);
          let swapping = occupantLeaving && isAt(moves.get(occupant), object);
          let shipInTheWay = isSolid(object) && occupiedByShip.some(cell => isAt(cell, to));
          let contested = [...moves].some(([other, otherTo]) => other !== object && isAt(otherTo, to) && objects.indexOf(other) < objects.indexOf(object));

          if ((occupant && !occupantLeaving) || swapping || shipInTheWay || contested) {
            moves.delete(object);
            changed = true;
          }
        }
      }

      return moves;
    }

    return {
      start,
      get objects(){ return objects; },
      get shipCell(){ return shipCell; },
      get isSolved(){ return solved; },
      get switchesActive(){ return switchesActive(); },
      streams: puzzle.objects.filter(object => object.kind === 'Stream'),

      // For sokoban.js's canEnter. A Stream holds a ship until it pushes it off: the only way to leave
      // one is the way it's going. It can't be stepped onto head-on either.
      canEnter(from, to, moverDirection){
        let direction = PUZZLE_DIRECTIONS[moverDirection];
        let holding = streams.get(cellKey(from));
        if (holding && holding !== direction) return false;
        if (streams.get(cellKey(to)) === OPPOSITES[direction]) return false;
        let object = objectAt(to);
        return !(object && isSolid(object));
      },

      shipArrivedAt: arriveAt,

      // Which way a Stream is carrying a ship on this square, as sokoban.js's direction, or null.
      carryDirection(cell){
        let direction = streams.get(cellKey(cell));
        return direction ? MOVER_DIRECTIONS[direction] : null;
      },

      // Moves everything on a Stream along by a square. shipHeadingTo is the square the ship is
      // stepping onto, if it's moving. Returns what something moving under a stationary ship did, in
      // the same form as shipArrivedAt.
      tick(shipHeadingTo){
        for (const object of objects) {
          object.fromCol = object.col;
          object.fromRow = object.row;
        }

        let occupied = shipHeadingTo ? [shipCell, shipHeadingTo] : [shipCell];
        let moves = resolveStreamMoves(occupied);
        for (const [object, to] of moves) {
          object.col = to.col;
          object.row = to.row;
        }

        let cameUnder = !shipHeadingTo && [...moves.keys()].some(object => isAt(object, shipCell));
        return cameUnder ? arriveAt(shipCell) : null;
      },
    };
  }

  // ---------- colours ----------

  // How many groups of similar colours an album's art gets split into before choosing from them.
  const PALETTE_GROUPS = 24;
  // A group smaller than this share of the art's pixels is too much of a speck to represent it.
  const PALETTE_MIN_SHARE = 0.002;
  // How much the board dims the art behind it (see main.css's .boardPlaying), and how different in
  // lightness from that a fill colour has to be to stand out.
  const PALETTE_ART_DIMMING = 0.65;
  const PALETTE_MIN_CONTRAST = 25;

  function toHex(color){
    return '#' + [color.r, color.g, color.b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function lightnessOf(color){
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  }

  function vividnessOf(color){
    return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  }

  // Roughly how different two colours look, weighting channels by how much the eye responds to them.
  function colorDistance(a, b){
    return Math.sqrt(2 * (a.r - b.r) ** 2 + 4 * (a.g - b.g) ** 2 + 3 * (a.b - b.b) ** 2);
  }

  // Splits the colours into groups, always cutting the group with the widest spread of any channel at its
  // midpoint by pixel count, and returns each group's most common exact colour.
  function groupColors(counts){
    let groups = [[...counts.values()]];

    while (groups.length < PALETTE_GROUPS) {
      let widest = null;
      for (const group of groups) {
        if (group.length < 2) continue;
        for (const channel of ['r', 'g', 'b']) {
          let values = group.map(color => color[channel]);
          let spread = Math.max(...values) - Math.min(...values);
          if (!widest || spread > widest.spread) widest = { group, channel, spread };
        }
      }
      if (!widest || widest.spread === 0) break;

      let sorted = [...widest.group].sort((a, b) => a[widest.channel] - b[widest.channel]);
      let half = sorted.reduce((sum, color) => sum + color.count, 0) / 2;
      let split = 1;
      for (let walked = sorted[0].count; split < sorted.length - 1 && walked < half; split++) walked += sorted[split].count;

      groups.splice(groups.indexOf(widest.group), 1, sorted.slice(0, split), sorted.slice(split));
    }

    return groups.map(group => {
      let main = group.reduce((best, color) => color.count > best.count ? color : best);
      return { r: main.r, g: main.g, b: main.b, count: group.reduce((sum, color) => sum + color.count, 0) };
    });
  }

  // Chooses every colour a puzzle is drawn in from an album's art (RGBA bytes, as canvas's getImageData
  // gives), each one an exact colour from the art. Each object's shape is what really tells it apart, with
  // an outline taken from the art's darkest colour keeping it readable on anything, so art with few colours
  // in it still works. Otherwise: the rarest things on a board get the most eye-catching colours, and each
  // new choice is whichever differs most from those already made.
  function pickPalette(pixels){
    let counts = new Map();
    let total = 0;
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      let key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      let color = counts.get(key);
      if (color) color.count++;
      else counts.set(key, { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], count: 1 });
      total++;
    }
    if (total === 0) counts.set(0, { r: 0, g: 0, b: 0, count: 1 });

    let groups = groupColors(counts);
    let usable = groups.filter(group => group.count >= total * PALETTE_MIN_SHARE);
    if (usable.length === 0) usable = groups;

    let byLightness = [...usable].sort((a, b) => lightnessOf(a) - lightnessOf(b));
    let outline = byLightness[0];
    let light = byLightness[byLightness.length - 1];

    // Fill colours have to show up on the art, which is dimmed behind the board. A strong colour can do
    // that with less of a difference in lightness.
    let average = usable.reduce((sum, group) => sum + lightnessOf(group) * group.count, 0) / usable.reduce((sum, group) => sum + group.count, 0);
    let dimmedArt = average * PALETTE_ART_DIMMING;
    let fills = usable.filter(group => {
      let contrast = Math.abs(lightnessOf(group) - dimmedArt);
      let clearOfOutline = lightnessOf(group) - lightnessOf(outline) >= PALETTE_MIN_CONTRAST;
      return clearOfOutline && (contrast >= PALETTE_MIN_CONTRAST || (contrast >= PALETTE_MIN_CONTRAST / 2 && vividnessOf(group) >= 110));
    });
    if (fills.length === 0) fills = usable;

    let chosen = [];
    let choose = (score) => {
      let candidates = fills.filter(group => !chosen.includes(group));
      if (candidates.length === 0) candidates = fills;
      let best = candidates.reduce((winner, group) => score(group) > score(winner) ? group : winner);
      chosen.push(best);
      return best;
    };
    let vivid = (group) => vividnessOf(group) + lightnessOf(group) * 0.4;
    let different = (group) => chosen.length === 0
      ? vivid(group)
      : Math.min(...chosen.map(other => colorDistance(group, other))) + vivid(group) * 0.5;

    let finish = choose(vivid);
    let key = choose(different);
    let teleporter = choose(different);
    let gate = choose(different); // a Gate and its Switch are one idea, so they share a colour
    let stream = choose(different);
    // The most common object, so the one thing here that shouldn't be shouting: the plainest of what's left.
    let wall = choose((group) => lightnessOf(group) * 0.5 - vividnessOf(group) + (chosen.length ? Math.min(...chosen.map(other => colorDistance(group, other))) * 0.25 : 0));

    return {
      wall: toHex(wall),
      finish: toHex(finish),
      gate: toHex(gate),
      switch: toHex(gate),
      teleporter: toHex(teleporter),
      stream: toHex(stream),
      key: toHex(key),
      outline: toHex(outline),
      light: toHex(light),
    };
  }

  // ---------- textures ----------

  // One square of the board, and the album art, in the art's own pixels.
  const TILE_PX = 24;
  const ART_PX = TILE_PX * BOARD_SIZE;

  // Every role that has a texture of its own. A Switch shares its Gate's, as it does its colour.
  const TEXTURE_ROLES = ['wall', 'finish', 'gate', 'teleporter', 'stream', 'key'];
  // The shades a texture is made of, by how far they're aimed from its main colour in lightness, and how
  // much of the texture each covers. A shade only exists if the art really has a colour like it.
  const TEXTURE_SHADES = [
    { offset: -30, share: 0.15 },
    { offset: -14, share: 0.25 },
    { offset: 0, share: 0.45 },
    { offset: 16, share: 0.15 },
  ];
  // How close a colour in the art has to be to count as a shade of one, or towards finding a patch of it.
  const TEXTURE_SHADE_DISTANCE = 110;
  const TEXTURE_PATCH_DISTANCE = 70;
  const TEXTURE_PATCH_STEP = 4;

  function hexToColor(hex){
    let value = parseInt(hex.slice(1), 16);
    return { r: value >> 16, g: (value >> 8) & 255, b: value & 255 };
  }

  // Generates each object's texture from an album's art (RGBA bytes, width x height): the pattern of light
  // and dark from wherever the art has the most of that object's colour, recoloured in shades of that
  // colour that are also exact colours from the art. So it carries the album's own grain and dithering, but
  // still reads as that object, rather than blending into the art behind it.
  function pickTextures(pixels, width, height, palette){
    let colors = new Map();
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      let key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      colors.set(key, (colors.get(key) ?? 0) + 1);
    }
    let artColors = [...colors.keys()].map(key => ({ r: key >> 16, g: (key >> 8) & 255, b: key & 255 }));

    let textures = {};
    for (const role of TEXTURE_ROLES) {
      let color = hexToColor(palette[role]);
      let { ramp, baseIndex } = pickShades(color, artColors);
      let patch = findPatch(pixels, width, height, color);
      textures[role] = { ramp: ramp.map(toHex), pixels: patternOf(pixels, width, height, patch, ramp.length, baseIndex) };
    }
    return textures;
  }

  // The art's colours nearest each shade wanted, darkest first, with no shade repeated.
  function pickShades(color, artColors){
    let near = artColors.filter(other => colorDistance(other, color) <= TEXTURE_SHADE_DISTANCE);
    let shades = [];
    let baseIndex = 0;

    for (const shade of TEXTURE_SHADES) {
      if (shade.offset === 0) {
        baseIndex = shades.length;
        shades.push(color);
        continue;
      }
      let wanted = lightnessOf(color) + shade.offset;
      let best = null;
      for (const other of near) {
        let miss = Math.abs(lightnessOf(other) - wanted);
        if (miss <= Math.abs(shade.offset) / 2 && (!best || miss < best.miss)) best = { other, miss };
      }
      if (best) shades.push(best.other);
    }
    return { ramp: shades, baseIndex };
  }

  // The top-left of the square of art holding the most of a colour, using a running total of matching
  // pixels so that trying every position stays quick.
  function findPatch(pixels, width, height, color){
    let totals = new Int32Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let i = (y * width + x) * 4;
        let matches = colorDistance({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }, color) <= TEXTURE_PATCH_DISTANCE ? 1 : 0;
        totals[(y + 1) * (width + 1) + x + 1] = matches + totals[y * (width + 1) + x + 1] + totals[(y + 1) * (width + 1) + x] - totals[y * (width + 1) + x];
      }
    }

    let best = { x: 0, y: 0, score: -1 };
    for (let y = 0; y + TILE_PX <= height; y += TEXTURE_PATCH_STEP) {
      for (let x = 0; x + TILE_PX <= width; x += TEXTURE_PATCH_STEP) {
        let bottom = y + TILE_PX, right = x + TILE_PX, row = width + 1;
        let score = totals[bottom * row + right] - totals[y * row + right] - totals[bottom * row + x] + totals[y * row + x];
        if (score > best.score) best = { x, y, score };
      }
    }
    return best;
  }

  // A patch of art as one digit per pixel, each the index of the shade to draw there. Stretches the patch's
  // own range of lightness across the shades, so that even a nearly flat patch shows its pattern.
  function patternOf(pixels, width, height, patch, shadeCount, baseIndex){
    let values = [];
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let i = (Math.min(patch.y + y, height - 1) * width + Math.min(patch.x + x, width - 1)) * 4;
        values.push(lightnessOf({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }));
      }
    }

    let sorted = [...values].sort((a, b) => a - b);
    let flat = sorted[0] === sorted[sorted.length - 1];

    // How far through the patch's lightness each shade ends, sharing the shades that do exist in proportion.
    let shades = TEXTURE_SHADES.slice(0, shadeCount);
    let walked = 0;
    let total = shades.reduce((sum, shade) => sum + shade.share, 0);
    let limits = shades.map(shade => {
      walked += shade.share / total;
      return sorted[Math.min(sorted.length - 1, Math.floor(walked * sorted.length))];
    });

    return values.map(value => {
      if (flat) return baseIndex;
      let index = limits.findIndex(limit => value <= limit);
      return index === -1 ? shadeCount - 1 : index;
    }).join('');
  }

  // ---------- drawing ----------

  // How long a Stream's cross-lines take to move one whole square, and how far apart they are.
  const STREAM_CYCLE_MS = 900;
  const STREAM_LINE_SPACING = 8;

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
  };

  const SPRITE_SHAPES = { Wall: 'octagon', Gate: 'octagon', Finish: 'roundedSquare', Switch: 'circle', Teleporter: 'diamond', Key: 'triangle' };
  const SPRITE_ROLES = { Wall: 'wall', Gate: 'gate', Finish: 'finish', Switch: 'gate', Teleporter: 'teleporter', Key: 'key', Stream: 'stream' };

  // What colour a role's pixel at x, y of a square is: its texture's shade there, or its plain colour for a
  // puzzle saved before it had textures.
  function roleColorAt(look, role, x, y){
    let texture = look.textures?.[role];
    let shade = texture?.pixels?.[y * TILE_PX + x];
    return hexToColor(shade !== undefined ? texture.ramp[Number(shade)] : look.palette[role] ?? look.palette.wall);
  }

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

  // A square's worth of pixels for one object: a colour per pixel, or null where it's see-through.
  function buildSprite(object, look, switchesActive){
    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let role = SPRITE_ROLES[object.kind];
    let outline = hexToColor(look.palette.outline);
    let light = hexToColor(look.palette.light);

    let isOpenGate = object.kind === 'Gate' && object.open;
    let isDim = object.kind === 'Switch' && !switchesActive;

    let body = SHAPES[SPRITE_SHAPES[object.kind]];
    let test = isOpenGate ? (dx, dy) => body(dx, dy) && !SHAPES.octagonHole(dx, dy) : body;
    let mask = maskOf(test);

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (!mask[y * TILE_PX + x]) continue;
        // De-activated: every other pixel gives way to the outline's colour, the classic look of something disabled.
        let dimmed = isDim && (x + y) % 2 === 0;
        sprite[y * TILE_PX + x] = isEdge(mask, x, y) || dimmed ? outline : roleColorAt(look, role, x, y);
      }
    }

    if (object.kind === 'Gate' || object.kind === 'Switch' || object.kind === 'Teleporter') {
      // Whichever of the art's lightest and darkest colours stands out from this shape the most. An open
      // Gate's letter has only the art behind it, so that one gets a dark edge to stand out from it.
      let fill = hexToColor(look.palette[role]);
      let useDark = Math.abs(lightnessOf(fill) - lightnessOf(outline)) >= Math.abs(lightnessOf(fill) - lightnessOf(light));
      // Twice the alphabet's size where it fits. A diamond narrows too quickly for that, so its stays small.
      let scale = object.kind === 'Teleporter' ? 1 : 2;
      if (isOpenGate || isDim) drawPixelLetter(sprite, object.letter, light, outline, scale);
      else drawPixelLetter(sprite, object.letter, useDark ? outline : light, null, scale);
    }

    return sprite;
  }

  // A Stream's two rails running in its direction of travel, with cross-lines between them moving along.
  function buildStreamSprite(direction, look, phase){
    let sprite = new Array(TILE_PX * TILE_PX).fill(null);
    let delta = DIRECTION_DELTAS[direction];
    let horizontal = delta.x !== 0;
    let forward = delta.x + delta.y > 0;
    let outline = hexToColor(look.palette.outline);

    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let along = horizontal ? x : y;
        let across = horizontal ? y : x;
        let color = null;

        let rail = across <= 5 ? across - 2 : across - 18;
        if (rail >= 0 && rail <= 3 && (across <= 5 || across >= 18)) {
          color = rail === 0 || rail === 3 ? outline : roleColorAt(look, 'stream', x, y);
        } else if (across > 5 && across < 18) {
          let moved = ((forward ? along - phase : along + phase) % STREAM_LINE_SPACING + STREAM_LINE_SPACING) % STREAM_LINE_SPACING;
          if (moved <= 3) color = moved === 0 || moved === 3 ? outline : roleColorAt(look, 'stream', x, y);
        }

        sprite[y * TILE_PX + x] = color;
      }
    }
    return sprite;
  }

  // Sprites are only worth working out once per look, since there are only so many things to be drawn.
  const spriteCaches = new WeakMap();

  function spriteFor(object, look, switchesActive, streamPhase){
    let cache = spriteCaches.get(look);
    if (!cache) spriteCaches.set(look, cache = new Map());

    let key = object.kind === 'Stream'
      ? `Stream|${object.direction}|${streamPhase}`
      : `${object.kind}|${object.letter ?? ''}|${object.kind === 'Gate' && !!object.open}|${object.kind === 'Switch' && !switchesActive}`;

    let sprite = cache.get(key);
    if (!sprite) {
      sprite = object.kind === 'Stream' ? buildStreamSprite(object.direction, look, streamPhase) : buildSprite(object, look, switchesActive);
      cache.set(key, sprite);
    }
    return sprite;
  }

  function blit(image, sprite, left, top){
    let { data, width, height } = image;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        let color = sprite[y * TILE_PX + x];
        let px = left + x, py = top + y;
        if (!color || px < 0 || px >= width || py < 0 || py >= height) continue;
        let i = (py * width + px) * 4;
        data[i] = color.r;
        data[i + 1] = color.g;
        data[i + 2] = color.b;
        data[i + 3] = 255;
      }
    }
  }

  // Draws a whole board into RGBA pixel data the size of the album art, to be scaled up exactly as the art
  // is, so that every pixel of every object lands on one of the art's. Streams go first, so that whatever's
  // on one sits on top of it. Start isn't drawn, since that's where the ship itself goes.
  //
  // look is { palette, textures }. options.timeMs drives a Stream's animation, options.switchesActive says
  // whether Switches work yet, and options.along is how far objects are through moving from their fromCol
  // and fromRow, for ones in play. They move in whole pixels, like everything else here.
  function renderBoard(image, objects, look, options = {}){
    image.data.fill(0);

    let phase = Math.floor(((options.timeMs ?? 0) % STREAM_CYCLE_MS) / STREAM_CYCLE_MS * TILE_PX) % STREAM_LINE_SPACING;
    let switchesActive = options.switchesActive ?? true;
    let along = options.along ?? 1;

    let streamsFirst = objects
      .filter(object => object.kind !== 'Start')
      .sort((a, b) => (b.kind === 'Stream') - (a.kind === 'Stream'));

    for (const object of streamsFirst) {
      let col = object.fromCol === undefined ? object.col : object.fromCol + (object.col - object.fromCol) * along;
      let row = object.fromRow === undefined ? object.row : object.fromRow + (object.row - object.fromRow) * along;
      blit(image, spriteFor(object, look, switchesActive, phase), Math.round(col * TILE_PX), Math.round(row * TILE_PX));
    }
  }

  return { BOARD_SIZE, DEFAULT_START, LETTERS, TILE_PX, ART_PX, placeObject, eraseObject, suggestLetter, pickPalette, pickTextures, renderBoard, hasFinish, createPuzzleGame };
});
