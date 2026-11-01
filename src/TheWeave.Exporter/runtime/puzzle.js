// puzzle.js
// John Oestmann
// Sokoban puzzles played over a track's album art: what each object looks like, what colours they're
// drawn in, the rules for placing them on a board, and the rules for playing one. Knows nothing about
// the DOM - callers pass in a canvas context or plain pixel data. Shared by the Editor's Puzzle Editor
// and the exported site, so that a puzzle looks the same in both.
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
      else objects.push({ ...object, fromCol: object.col, fromRow: object.row, open: false });
    }

    let shipCell = start;
    let solved = false;

    function cellKey(cell){
      return cell.col + "," + cell.row;
    }

    function objectAt(cell){
      return objects.find(object => isAt(object, cell)) ?? null;
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
          if (objects.some(other => other.kind === 'Key')) return null;
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
      streams: puzzle.objects.filter(object => object.kind === 'Stream'),

      // For sokoban.js's canEnter. A Stream can't be walked against, whether already on it or coming
      // onto it head-on.
      canEnter(from, to, moverDirection){
        let direction = PUZZLE_DIRECTIONS[moverDirection];
        let against = streams.get(cellKey(from)) === OPPOSITES[direction] || streams.get(cellKey(to)) === OPPOSITES[direction];
        if (against) return false;
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

  function hexLightness(hex){
    let value = parseInt(hex.slice(1), 16);
    return lightnessOf({ r: value >> 16, g: (value >> 8) & 255, b: value & 255 });
  }

  // ---------- drawing ----------

  // How long a Stream's cross-lines take to move one whole square, and how many there are in one.
  const STREAM_CYCLE_MS = 900;
  const STREAM_LINES = 3;

  function polygon(ctx, cx, cy, radius, sides, turn){
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      let angle = turn + i * 2 * Math.PI / sides;
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }
    ctx.closePath();
  }

  function roundedSquare(ctx, cx, cy, half, corner){
    let left = cx - half, right = cx + half, top = cy - half, bottom = cy + half;
    ctx.beginPath();
    ctx.moveTo(left + corner, top);
    ctx.arcTo(right, top, right, bottom, corner);
    ctx.arcTo(right, bottom, left, bottom, corner);
    ctx.arcTo(left, bottom, left, top, corner);
    ctx.arcTo(left, top, right, top, corner);
    ctx.closePath();
  }

  function fillAndOutline(ctx, fill, palette, tile){
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, tile * 0.07);
    ctx.fillStyle = fill;
    ctx.strokeStyle = palette.outline;
    ctx.fill();
    ctx.stroke();
  }

  function drawLetter(ctx, letter, fill, palette, cx, cy, tile, font){
    // Whichever of the art's lightest and darkest colours stands out from this shape the most.
    let useDark = Math.abs(hexLightness(fill) - hexLightness(palette.outline)) >= Math.abs(hexLightness(fill) - hexLightness(palette.light));
    ctx.fillStyle = useDark ? palette.outline : palette.light;
    ctx.font = `bold ${Math.round(tile * 0.46)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter ?? '', cx, cy + tile * 0.02);
  }

  function drawStream(ctx, direction, palette, x, y, tile, timeMs){
    let delta = DIRECTION_DELTAS[direction];
    let along = delta.x !== 0;
    let inset = tile * 0.14;
    let lineWidth = Math.max(1, tile * 0.07);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, tile, tile);
    ctx.clip();

    let drawLines = (color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'butt';
      ctx.beginPath();

      // The two rails, running in the direction of travel.
      for (const side of [inset, tile - inset]) {
        if (along) {
          ctx.moveTo(x, y + side);
          ctx.lineTo(x + tile, y + side);
        } else {
          ctx.moveTo(x + side, y);
          ctx.lineTo(x + side, y + tile);
        }
      }

      // The lines between them, moving along.
      let spacing = tile / STREAM_LINES;
      let phase = ((timeMs % STREAM_CYCLE_MS) / STREAM_CYCLE_MS) * tile;
      for (let i = -1; i <= STREAM_LINES; i++) {
        let moved = (i * spacing + phase) % tile;
        let forward = moved < 0 ? moved + tile : moved;
        let at = (delta.x + delta.y) > 0 ? forward : tile - forward;
        if (along) {
          ctx.moveTo(x + at, y + inset);
          ctx.lineTo(x + at, y + tile - inset);
        } else {
          ctx.moveTo(x + inset, y + at);
          ctx.lineTo(x + tile - inset, y + at);
        }
      }

      ctx.stroke();
    };

    drawLines(palette.outline, lineWidth * 2.2);
    drawLines(palette.stream, lineWidth);
    ctx.restore();
  }

  // Draws one object into the square whose top-left corner is at x, y. options.timeMs drives a Stream's
  // animation, options.shipImage is what to draw for Start, and options.font is the font for letters.
  function drawObject(ctx, object, palette, x, y, tile, options = {}){
    let cx = x + tile / 2;
    let cy = y + tile / 2;
    let radius = tile * 0.43;
    let font = options.font ?? 'sans-serif';

    switch (object.kind) {
      case 'Wall':
        polygon(ctx, cx, cy, radius, 8, Math.PI / 8);
        fillAndOutline(ctx, palette.wall, palette, tile);
        break;

      case 'Gate':
        polygon(ctx, cx, cy, radius, 8, Math.PI / 8);
        if (object.open) {
          // Just the frame of itself, to show that it can be walked through.
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(1, tile * 0.14);
          ctx.strokeStyle = palette.outline;
          ctx.stroke();
          ctx.lineWidth = Math.max(1, tile * 0.07);
          ctx.strokeStyle = palette.gate;
          ctx.stroke();
          drawLetter(ctx, object.letter, palette.outline, palette, cx, cy, tile, font);
        } else {
          fillAndOutline(ctx, palette.gate, palette, tile);
          drawLetter(ctx, object.letter, palette.gate, palette, cx, cy, tile, font);
        }
        break;

      case 'Finish':
        roundedSquare(ctx, cx, cy, tile * 0.36, tile * 0.13);
        fillAndOutline(ctx, palette.finish, palette, tile);
        break;

      case 'Switch':
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.92, 0, Math.PI * 2);
        fillAndOutline(ctx, palette.switch, palette, tile);
        drawLetter(ctx, object.letter, palette.switch, palette, cx, cy, tile, font);
        break;

      case 'Teleporter':
        polygon(ctx, cx, cy, tile * 0.47, 4, 0);
        fillAndOutline(ctx, palette.teleporter, palette, tile);
        drawLetter(ctx, object.letter, palette.teleporter, palette, cx, cy, tile, font);
        break;

      case 'Key':
        polygon(ctx, cx, cy + tile * 0.05, radius, 3, -Math.PI / 2);
        fillAndOutline(ctx, palette.key, palette, tile);
        break;

      case 'Stream':
        drawStream(ctx, object.direction, palette, x, y, tile, options.timeMs ?? 0);
        break;

      case 'Start':
        if (options.shipImage) {
          let height = tile * 0.8;
          let width = height * 12 / 16;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(options.shipImage, cx - width / 2, cy - height / 2, width, height);
        }
        break;
    }
  }

  // Everything on a board, Streams first, so that whatever's on one sits on top of it.
  function drawObjects(ctx, objects, palette, tile, options = {}){
    let streamsFirst = [...objects].sort((a, b) => (b.kind === 'Stream') - (a.kind === 'Stream'));
    for (const object of streamsFirst) {
      drawObject(ctx, object, palette, object.col * tile, object.row * tile, tile, options);
    }
  }

  return { BOARD_SIZE, DEFAULT_START, LETTERS, placeObject, eraseObject, suggestLetter, pickPalette, drawObject, drawObjects, hasFinish, createPuzzleGame };
});
